"""SessionManager 上与 Qumge 有关的方法 —— 设备码登录。

搬出 manager.py 不是分类癖：那是上游活跃维护的文件（分叉至今他们改过 8 次），
我们往里加了 118 行。每次上游更新都要手工合一遍，合的还是设备码登录这种和
他们完全无关的东西。新文件永远不会冲突。

【依赖 self 上的两样东西】，写在这里而不是靠 TYPE_CHECKING 假装解耦：

    self.secrets       SecretStore —— 读回写好的 provider 档案
    self.set_provider  写入 key 并重建缓存的客户端

也就是说这个 mixin 只能和 SessionManager 一起用。写清楚比假装通用好。
"""
from __future__ import annotations

import time
from typing import Any, Optional


class QumgeManagerMixin:
    # -- Qumge device sign-in ---------------------------------------------------
    # One flow at a time. Starting another abandons the previous one rather than tracking
    # both: two pending sign-ins on one machine is a user who clicked twice, and the one
    # they are looking at is the one that should win.
    _qumge_flow: Optional["qumge_device.Flow"] = None

    def start_qumge_device(self, device_name: Optional[str] = None) -> dict[str, Any]:
        from ..qumge import device_flow as qumge_device
        import httpx

        # qumge.com's /device/code is unreachable (dead network) or capped (20/hour) often
        # enough to plan for: uncaught, either one raised out of this method, through the
        # FastAPI route, as an unhandled 500 — the panel had nothing better to say than
        # "Something went wrong connecting to Qumge." `kind` lets the panel phrase the two
        # differently; retrying ("Try again") asks for a fresh code every time, so an
        # impatient user runs straight into the rate limit if it isn't called out.
        try:
            flow = qumge_device.start(device_name)
        except httpx.HTTPStatusError as exc:
            if exc.response is not None and exc.response.status_code == 429:
                return {
                    "status": "error",
                    "kind": "rate_limited",
                    "error": "Too many sign-in attempts — qumge.com allows a few per hour. Wait a bit and try again.",
                }
            code = exc.response.status_code if exc.response is not None else "unknown"
            return {
                "status": "error",
                "kind": "unreachable",
                "error": f"Qumge returned an unexpected error (HTTP {code}).",
            }
        except httpx.HTTPError:
            return {
                "status": "error",
                "kind": "unreachable",
                "error": "Couldn't reach qumge.com — check your network and try again.",
            }
        self._qumge_flow = flow
        # device_code is deliberately absent: the GUI has no use for it and every value we
        # hand the webview is a value that can leak from it.
        return {
            "user_code": flow.user_code,
            "verification_uri": flow.verification_uri,
            "verification_uri_complete": flow.verification_uri_complete,
            "interval": flow.interval,
            "expires_in": max(0, int(flow.expires_at - time.time())),
        }

    def poll_qumge_device(self) -> dict[str, Any]:
        from ..qumge import device_flow as qumge_device

        flow = self._qumge_flow
        if flow is None:
            return {"status": "error", "error": "no sign-in in progress"}
        if time.time() >= flow.expires_at:
            self._qumge_flow = None
            return {"status": "expired"}

        state, token = qumge_device.exchange(flow.device_code)

        if state == "slow_down":
            flow.interval += 5
            return {"status": "pending", "interval": flow.interval}
        if state == "pending":
            return {"status": "pending", "interval": flow.interval}
        if state in ("denied", "expired"):
            self._qumge_flow = None
            return {"status": state}
        if state == "connected" and token:
            # Go through set_provider rather than writing the SecretStore directly, so the
            # cached client is rebuilt and the recommended model is offered exactly the way
            # it would be for a key typed in by hand.
            res = self.set_provider(
                "qumge",
                {"api_key": token, "base_url": f"{qumge_device.base_url()}/v1"},
            )
            self._qumge_flow = None
            if not res.get("ok"):
                return {"status": "error", "error": res.get("error")}

            # Signing in brings the models AND the skill catalog. Without this the
            # product's second half never arrives: SkillLoader reads two local
            # directories, so qumge.com's curated SKILL.md files were reachable
            # only by hand-copying one in.
            #
            # Best-effort on purpose — a catalog that failed to register must not
            # turn a successful sign-in into an error the user cannot act on.
            #
            # Nothing is reloaded here: mcp.json is read when a session starts, and
            # sign-in happens before the first one. Connecting from Settings
            # mid-session picks it up on the next session, the same as any other
            # edit to that file.
            try:
                from ..qumge import skills_mcp

                skills_mcp.ensure_installed(qumge_device.base_url())
            except Exception:
                pass

            return {"status": "connected"}

        self._qumge_flow = None
        return {"status": "error", "error": state}
