"""Qumge 相关的 HTTP 路由：余额、账号、设备码登录。

搬出 app.py 不是分类癖：那是上游活跃维护的文件（分叉至今他们改过 10 次），
我们的四个路由散落在他们的路由表中间——一个在 providers 上面，两个在下面。
散着的改动就是散着的 hunk，每一个都是一次要人判断的合并。新文件永不冲突。

【这是这个仓库第一次用 APIRouter】。app.py 里其余全是 @app.get 直接挂。
好处是后面每加一块自家服务都能照这个走；代价是第一次要验准——路由没挂上
的话，单测照样过（测试直接调函数），线上却是 404。所以搬完必须真起一次
sidecar 打一遍端点。

工厂函数而不是模块级 router：这些路由闭包着 manager，模块级装饰器拿不到它。
"""
from __future__ import annotations

from typing import Any

from fastapi import APIRouter


def qumge_router(manager: Any) -> APIRouter:
    router = APIRouter()

    @router.get("/v1/qumge/balance")
    def qumge_balance() -> dict[str, Any]:
        """Credit left, and where to add more. `{"balance": null}` when it cannot
        be known — not signed in, offline, server down. The GUI shows nothing in
        that case rather than an error in front of someone trying to work."""
        from . import balance as qumge_balance_mod

        return {"balance": qumge_balance_mod.fetch(manager.secrets)}

    @router.get("/v1/qumge/account")
    def qumge_account() -> dict[str, Any]:
        """Whose account this is, and what it has left — what the sidebar footer
        renders. `signed_in` is answered from the SecretStore, so going offline
        never demotes a signed-in user to a signed-out one."""
        from . import account as qumge_account_mod

        return qumge_account_mod.status(manager.secrets)

    # -- Qumge device sign-in (RFC 8628) ----------------------------------------
    @router.post("/v1/qumge/device/start")
    def qumge_device_start(body: dict | None = None) -> dict[str, Any]:
        return manager.start_qumge_device((body or {}).get("device_name"))

    @router.get("/v1/qumge/device/poll")
    def qumge_device_poll() -> dict[str, Any]:
        return manager.poll_qumge_device()

    return router
