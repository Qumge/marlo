"""设备码一键授权：设置页的那个按钮，和对话里 agent 主动要账号的那条路。

【为什么单独一个文件】：这两块原本长在 coworker/server/app.py 里 —— 一个 115 行的
connector_requester、一个 66 行的路由。那个文件是上游改得最勤的 Python 文件之一
（分叉以来 13 个提交），我们每在里面多一行，下次合并就多一处要人逐行判断的地方。

搬出来之后上游怎么改 app.py 都和这两块无关：新文件永不冲突。app.py 那边只剩两处
挂载点 —— 一行 include_router，一行工厂调用。这也是 qumge/routes.py 已经在用的做法。

【为什么不能更简单地内联】：两个函数都要闭包住 manager（还有 session_id），所以这里
是工厂函数而不是模块级定义。

【工厂必须显式注入】：原先 connector_requester 住在 websocket handler 里，能直接
看到 `_route` / `_visibility` / `_mirror` / `_parse_json`。搬走之后这些名字【不再】
在作用域里 —— 调用时 NameError，assistant 已经带着 tool_calls 落盘，tool 结果却
永远写不进去，下一轮用户一说话就撞上 OpenAI 的 400：
  "An assistant message with 'tool_calls' must be followed by tool messages…"
所以 route / visibility / mirror / parse_json / connect_managed / on_card 一律从外面
传进来，工厂自己不偷任何闭包。
"""
from __future__ import annotations

import asyncio
from typing import Any, Awaitable, Callable, Optional

from fastapi import APIRouter

# 浏览器里的 OAuth 要人操作：切窗口、登录、点同意。三分钟是"人还在弄"和
# "人已经走开了"之间一个诚实的界线；轮询间隔跟 GUI 的 tab 轮询同量级。
CONNECT_TIMEOUT_S = 180
CONNECT_POLL_S = 2.0

# Session-scoped helpers the websocket handler already owns. Injected so this
# module never reaches back into app.py's closures.
RouteFn = Callable[[], str]
VisibilityFn = Callable[[], str]
MirrorFn = Callable[[Any], Awaitable[None]]
ParseJsonFn = Callable[[str], dict[str, Any]]
ConnectManagedFn = Callable[[str, Optional[dict]], Awaitable[dict[str, Any]]]
# Full card payload (title / brokered_by / user_code / …) once the path is known.
# Engine also receives this so CONNECTOR_REQUESTED is not half-empty.
OnCardFn = Callable[[dict[str, Any]], Awaitable[None]]
# MCP-backed one-click (local OAuth, no broker).
ConnectMcpFn = Callable[[str], Awaitable[dict[str, Any]]]


def connect_router(manager: Any) -> APIRouter:
    """设置页 ▸「连接」里的一键授权按钮打到这里。"""
    router = APIRouter()

    @router.post("/v1/connectors/{name}/device-connect")
    async def connector_device_connect(name: str) -> dict[str, Any]:
        """设置页里的一键授权，给声明了 device_auth_base 的自家服务用。

        【为什么要有这个】：设备码流程本来就实现了，但【只有 agent 能发起】——
        它走的是 connect_requester 那条路：agent 调工具 → 发一张带 user_code 的
        卡片 → 用户点头。而「连接」设置页里，一键按钮只在 c.mcp 或 c.managed 时
        渲染，两者 AutoWhisper 都不是。

        于是界面上出现了一句做不到的话：AutoWhisper 的说明第一条写着
        「一键：在浏览器里批准一次，之后不用再管」，而那一屏上只有一个 token 输入框。
        用户读完去找按钮，找不到。

        返回 user_code 是【必须的】：设备码流程要求用户在浏览器里核对这串码和
        屏幕上的一致，否则他没法确认自己批准的是这台机器。只开浏览器不给码，
        等于让他闭着眼睛点同意。
        """
        from ..connectors.descriptors import get_descriptor
        from ..connectors import device_connect

        d = get_descriptor(name)
        base = getattr(d, "device_auth_base", "") if d else ""
        if not base:
            return {"ok": False, "error": f"{name} has no device sign-in path"}

        try:
            flow = await asyncio.to_thread(device_connect.start, base, name)
        except Exception as exc:
            return {"ok": False, "error": f"could not start sign-in: {exc}"}

        async def _finish() -> None:
            """后台跑完剩下的：开浏览器 + 轮询 + 存 token。

            前端拿到 user_code 就返回，不等这一趟 —— 浏览器那一步可能要几分钟，
            HTTP 请求挂在那里等只会超时。连接状态由「连接」页自己的轮询接上。
            """
            import webbrowser

            webbrowser.open(flow.verification_uri_complete)
            interval = flow.interval
            deadline = asyncio.get_event_loop().time() + CONNECT_TIMEOUT_S
            while asyncio.get_event_loop().time() < deadline:
                await asyncio.sleep(interval)
                state, token = await asyncio.to_thread(
                    device_connect.exchange, base, flow.device_code
                )
                if state == "connected" and token:
                    await asyncio.to_thread(
                        manager.connect_connector, name, {"api_token": token}
                    )
                    return
                if state == "slow_down":
                    # RFC 8628 §3.5：收到它必须【加宽】间隔，不是照原速再来一次。
                    interval += 5
                elif state in ("denied", "expired", "error"):
                    return

        asyncio.create_task(_finish())
        # device_code 是机密，不出这个进程 —— 只把给人看的那串码交出去。
        return {
            "ok": True,
            "started": True,
            "user_code": flow.user_code,
            "verification_uri": flow.verification_uri_complete,
        }

    return router


def _one_click_kind(d: Any) -> str:
    """Which in-chat one-click path this descriptor supports, if any.

    Returns one of: "device" | "managed" | "mcp" | "" (manual / form only).
    Showing a Connect button for "" is a dead end: after the user agrees we used
    to call connect_managed and get "has no managed OAuth path" (email, stripe, …).
    """
    if getattr(d, "device_auth_base", ""):
        return "device"
    if getattr(d, "managed", False) and not getattr(d, "managed_paused", False):
        return "managed"
    if getattr(d, "mcp_url", ""):
        return "mcp"
    return ""


def make_connector_requester(
    manager: Any,
    session_id: str,
    *,
    route: RouteFn,
    visibility: VisibilityFn,
    mirror: MirrorFn,
    parse_json: ParseJsonFn,
    connect_managed: ConnectManagedFn,
    on_card: Optional[OnCardFn] = None,
    connect_mcp: Optional[ConnectMcpFn] = None,
    inbox_visibility_inbox: str = "inbox",
):
    """对话里 agent 调 request_connector 时走的那条路（engine 通过这个回调发卡）。

    `route` / `visibility` / `mirror` / `parse_json` 跟 directory_requester 同源，
    由 websocket handler 注入；`connect_managed` 是一键 OAuth 的入口（打开浏览器
    + 返回 ok）；`on_card` 在路径和设备码都就绪后发完整卡片（含 title /
    brokered_by / user_code）；`connect_mcp` 是 MCP 一键路径。
    """

    card_queue: asyncio.Queue = asyncio.Queue()

    async def _emit_card(card: dict[str, Any]) -> None:
        # Engine drains `_card_queue` to yield CONNECTOR_REQUESTED with full fields.
        await card_queue.put(card)
        if on_card is not None:
            await on_card(card)

    async def connector_requester(args: dict, tool_call_id=None) -> dict:
        """两次等待，这是它比 directory_requester 复杂的唯一原因。

        第一次等用户在卡片上点头。第二次等浏览器里的 OAuth 真的完成 ——
        connect-managed 只负责【打开】浏览器，完成是异步回来的（GUI 那边
        靠 tab 的轮询发现，见 ManageTabs.tsx 的 oneClick 注释）。

        两次都等，是因为 agent 需要一个确定的答案：它拿到 connected=True
        就继续干活，拿到 False 就换条路。返回"已经开始了，你等等"对一个
        正在做事的 agent 毫无用处。
        """
        import asyncio as _asyncio

        from ..connectors import device_connect
        from ..connectors.descriptors import get_descriptor

        name = str(args.get("connector", "")).strip()
        reason = str(args.get("reason", ""))
        d = get_descriptor(name)
        if d is None:
            return {"connected": False, "error": f"unknown connector: {name}"}

        # 已经连上了就别再问一遍 —— 用户点过的东西不该再弹一次。
        if any(
            c.get("name") == name and c.get("connected")
            for c in manager.list_connectors()
        ):
            return {"connected": True, "already": True}

        kind = _one_click_kind(d)

        # Managed but paused (e.g. Gmail CASA): a Connect button would only open
        # a "coming soon" error after the user already said yes — refuse early so
        # the agent can guide manual setup instead of faking a one-click card.
        if getattr(d, "managed", False) and getattr(d, "managed_paused", False):
            return {
                "connected": False,
                "error": (
                    f"one-click connect for {d.title} is coming soon — "
                    "connect manually in Settings → Connectors for now"
                ),
                "needs_manual_setup": True,
                "connector": name,
                "title": d.title,
            }

        # Form-only (IMAP email, API tokens, …): no browser round-trip exists.
        # Never show a Connect card that will fail with "no managed OAuth path".
        if not kind:
            return {
                "connected": False,
                "error": (
                    f"{d.title} has no one-click sign-in in chat — it needs a form "
                    f"in Settings → Connectors (auth: {d.auth}). Walk the user "
                    "through that setup here, or open Settings for them to fill in."
                ),
                "needs_manual_setup": True,
                "connector": name,
                "title": d.title,
            }

        # 两条授权路径，卡片上要说的话不一样，所以在【发卡之前】就分岔。
        #
        #   device  → 我们自己的服务。先起设备码流程，把 user_code 印在卡片上。
        #   managed → 借道 OpenWorker Cloud。卡片必须写明中转方。
        #   mcp     → 本机 MCP OAuth，无第三方中转。
        device_base = getattr(d, "device_auth_base", "") if kind == "device" else ""
        flow = None
        data: dict[str, Any] = {
            "connector": name,
            "title": d.title,
            "brokered_by": "OpenWorker Cloud" if kind == "managed" else "",
        }

        if kind == "device":
            try:
                flow = await _asyncio.to_thread(
                    device_connect.start, device_base, name
                )
            except Exception as exc:  # 起不来就别发一张点了没用的卡片
                return {"connected": False, "error": f"could not start sign-in: {exc}"}
            data["user_code"] = flow.user_code
            data["verification_uri"] = flow.verification_uri_complete

        # Full card BEFORE wait: title / broker / device code must be on the first paint.
        await _emit_card(
            {
                "connector": name,
                "title": d.title,
                "reason": reason,
                "brokered_by": data.get("brokered_by", ""),
                "user_code": data.get("user_code", ""),
                "verification_uri": data.get("verification_uri", ""),
            }
        )

        item = manager.inbox.add_connector(
            session_id,
            f"Connect {d.title}?",
            body=reason,
            inbox=route(),
            visibility=visibility(),
            data=data,
            tool_call_id=tool_call_id,
        )
        if item.state == "pending":
            manager.persist_session(session_id)
            if item.visibility == inbox_visibility_inbox:
                await mirror(item)

        resp = parse_json(await manager.inbox.wait(item.id))
        if not resp.get("connected"):
            return {"connected": False, "reason": "the user declined the request"}

        # 第二次等待：浏览器那一趟。点头之后【才】开浏览器 —— 提前开等于
        # 在用户同意之前就把他推去一个授权页。
        import webbrowser

        deadline = _asyncio.get_event_loop().time() + CONNECT_TIMEOUT_S

        if kind == "device" and flow is not None:
            webbrowser.open(flow.verification_uri_complete)
            interval = flow.interval
            while _asyncio.get_event_loop().time() < deadline:
                await _asyncio.sleep(interval)
                state, token = await _asyncio.to_thread(
                    device_connect.exchange, device_base, flow.device_code
                )
                if state == "connected" and token:
                    res = await _asyncio.to_thread(
                        manager.connect_connector, name, {"api_token": token}
                    )
                    if not res.get("ok"):
                        return {
                            "connected": False,
                            "error": res.get("error", "could not store the token"),
                        }
                    return {"connected": True}
                if state == "slow_down":
                    interval += 5
                elif state in ("denied", "expired", "error"):
                    return {"connected": False, "reason": f"sign-in {state}"}
        elif kind == "managed":
            res = await connect_managed(name, {})
            if not res.get("ok"):
                return {
                    "connected": False,
                    "error": res.get("error", "could not start the connect"),
                }
            while _asyncio.get_event_loop().time() < deadline:
                if any(
                    c.get("name") == name and c.get("connected")
                    for c in manager.list_connectors()
                ):
                    return {"connected": True}
                await _asyncio.sleep(CONNECT_POLL_S)
        elif kind == "mcp":
            if connect_mcp is None:
                return {
                    "connected": False,
                    "error": "MCP one-click connect isn't available here",
                }
            res = await connect_mcp(name)
            if not res.get("ok"):
                return {
                    "connected": False,
                    "error": res.get("error", "could not start MCP connect"),
                }
            while _asyncio.get_event_loop().time() < deadline:
                if any(
                    c.get("name") == name and c.get("connected")
                    for c in manager.list_connectors()
                ):
                    return {"connected": True}
                await _asyncio.sleep(CONNECT_POLL_S)

        # 超时不是"失败"，是"还没回来"——说清楚，别让 agent 以为用户拒绝了。
        return {
            "connected": False,
            "error": (
                f"{d.title} was not connected within {CONNECT_TIMEOUT_S}s "
                "— the browser step may still be open"
            ),
        }

    # Engine drains this so CONNECTOR_REQUESTED carries title / user_code / broker.
    connector_requester._card_queue = card_queue  # type: ignore[attr-defined]
    return connector_requester
