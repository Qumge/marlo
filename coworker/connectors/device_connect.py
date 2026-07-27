"""对【我们自己的】服务做设备码授权（RFC 8628）。

qumge/device_flow.py 做的是同一件事，但它只对 qumge.com 一家、而且换来的是
provider key。这里要的是通用的：任何一个在 descriptors 里声明了
`device_auth_base` 的连接器，都走同一条路，换来的是那个服务的 api_token。

第一个用它的是 AutoWhisper。之后每加一个自家产品，就是 descriptors 里加一条，
不是再写一遍状态机。

状态机照抄 device_flow.py，包括那条最容易被合并掉的：`slow_down` 和 `pending`
必须分开。RFC 8628 §3.5 要求调用方在 slow_down 上【加宽】轮询间隔 —— 把两者
合成一个，会让一个已经打太快的客户端继续打太快。
"""
from __future__ import annotations

import socket
import time
from dataclasses import dataclass
from typing import Optional

import httpx

TIMEOUT = 15.0


@dataclass
class DeviceFlow:
    connector: str
    device_code: str  # 机密 —— 不出这个进程
    user_code: str  # 给用户看的
    verification_uri: str
    verification_uri_complete: str
    interval: int
    expires_at: float


def start(
    base_url: str,
    connector: str,
    device_name: Optional[str] = None,
    *,
    client: Optional[httpx.Client] = None,
) -> DeviceFlow:
    # 只有这一侧能说出"这台机器"叫什么。没有显式名字时退回主机名，好过让
    # 每台设备都在批准页上显示为"这台设备"。
    device_name = device_name or socket.gethostname()
    owns = client is None
    client = client or httpx.Client(timeout=TIMEOUT)
    try:
        r = client.post(
            f"{base_url.rstrip('/')}/device/code",
            json={"device_name": device_name},
        )
        r.raise_for_status()
        d = r.json()
        return DeviceFlow(
            connector=connector,
            device_code=d["device_code"],
            user_code=d["user_code"],
            verification_uri=d["verification_uri"],
            verification_uri_complete=d.get("verification_uri_complete")
            or d["verification_uri"],
            interval=int(d.get("interval") or 5),
            expires_at=time.time() + int(d.get("expires_in") or 900),
        )
    finally:
        if owns:
            client.close()


def exchange(
    base_url: str, device_code: str, *, client: Optional[httpx.Client] = None
) -> tuple[str, Optional[str]]:
    """轮询一次。返回 (state, token)。

    state ∈ connected | pending | slow_down | denied | expired | error

    `slow_down` 与 `pending` 分开是 RFC 8628 §3.5 的要求：调用方收到它必须加宽
    间隔。合成一个，会让一个已经打太快的客户端继续打太快。
    """
    owns = client is None
    client = client or httpx.Client(timeout=TIMEOUT)
    try:
        r = client.post(
            f"{base_url.rstrip('/')}/device/token", json={"device_code": device_code}
        )
        if r.status_code == 200:
            return "connected", r.json().get("access_token")

        # RFC 8628 §3.5：这些是带 `error` 字段的 400，不是携带失败的 200。
        err = ""
        try:
            err = (r.json() or {}).get("error") or ""
        except ValueError:
            pass
        return {
            "authorization_pending": "pending",
            "slow_down": "slow_down",
            "access_denied": "denied",
            "expired_token": "expired",
            "invalid_grant": "error",
        }.get(err, "error"), None
    except httpx.HTTPError:
        # 一次网络抖动不该结束整个流程 —— 码在 15 分钟内有效，用户可能正在
        # 批准页上。报 pending，让下一次轮询再试。
        return "pending", None
    finally:
        if owns:
            client.close()
