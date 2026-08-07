"""POST /v1/connectors/{name}/device-connect —— 设置页那个「一键」按钮打的路由。

【为什么这个文件是新的】：2026-08-01 把这条路由从 coworker/server/app.py 搬进
coworker/server/connect_routes.py（上游改得最勤的 Python 文件之一，我们每多一行
就多一处合并时要人判断的地方）。搬之前先验有没有测试盯着 —— 把返回值改坏，
54 条相关测试全绿。也就是说这条路由【一直没有测试】：test_device_connect.py 量的
是 descriptors 里的字段，不是 HTTP 这一层。

搬一段没人盯着的代码，等于把它搬进黑箱：搬错了要等用户告诉你。所以补在这里。

断言的重点是两条不变量：
  1. 没有 device_auth_base 的连接器不能凭空开出一个设备码流程
  2. device_code 是机密，绝不出这个进程 —— 响应里只有给人看的 user_code
"""
from __future__ import annotations

import pytest
from fastapi.testclient import TestClient

from coworker.server import SessionManager, create_app


@pytest.fixture
def client(tmp_path, monkeypatch):
    monkeypatch.setenv("COWORKER_STATE_DIR", str(tmp_path / "state"))
    manager = SessionManager(workspace=tmp_path)
    with TestClient(create_app(manager)) as c:
        yield c


def test_route_is_mounted(client):
    """搬家之后最容易出的错：文件搬走了，include_router 忘了加 —— 于是 404。

    断言"不是 404"而不是"200"：这条路由对未知连接器返回的是 200 + ok:False
    （见下一条），404 才是没挂上。
    """
    r = client.post("/v1/connectors/nope/device-connect")
    assert r.status_code != 404, "connect_router 没挂上 create_app"


def test_unknown_connector_is_refused_not_started(client):
    body = client.post("/v1/connectors/nope/device-connect").json()
    assert body["ok"] is False
    assert "device sign-in" in body["error"]


def test_connector_without_device_auth_base_is_refused(client):
    """gmail 走的是 OAuth，不是设备码。拿它开设备码流程等于对用户撒谎。"""
    body = client.post("/v1/connectors/gmail/device-connect").json()
    assert body["ok"] is False


def test_user_code_goes_out_device_code_never_does(client, monkeypatch):
    """RFC 8628：user_code 必须显示给用户核对，device_code 是机密。

    只开浏览器不给码，等于让用户闭着眼睛点同意；把 device_code 也发出去，
    等于把凭证交给任何能读到这个响应的东西。
    """
    from coworker.connectors import device_connect

    class _Flow:
        user_code = "WDJB-MJHT"
        device_code = "SECRET-DEVICE-CODE"
        verification_uri_complete = "https://example.invalid/activate?user_code=WDJB-MJHT"
        interval = 5

    monkeypatch.setattr(device_connect, "start", lambda base, name: _Flow())
    # 别真开浏览器，也别让后台轮询跑起来。
    monkeypatch.setattr(
        device_connect, "exchange", lambda base, code: ("expired", None)
    )
    import webbrowser

    monkeypatch.setattr(webbrowser, "open", lambda url: True)

    body = client.post("/v1/connectors/autowhisper/device-connect").json()
    assert body["ok"] is True
    assert body["user_code"] == "WDJB-MJHT"
    assert "WDJB-MJHT" in body["verification_uri"]
    assert "SECRET-DEVICE-CODE" not in repr(body), "device_code 不能出这个进程"


# -- make_connector_requester -------------------------------------------------
# 2026-08 搬家时漏了把 websocket 闭包传进工厂，运行时 NameError：assistant 已
# 带着 tool_calls 落盘，tool 结果永远写不进去，用户下一句就撞 OpenAI 400。
# 这些测试把"工厂必须显式注入、注入后能发卡并等"钉死。


def test_requester_factory_requires_injected_helpers():
    """漏传依赖必须在【构造时】就失败，不能拖到用户点了连接才 NameError。"""
    import inspect

    from coworker.server.connect_routes import make_connector_requester

    params = inspect.signature(make_connector_requester).parameters
    for required in ("route", "visibility", "mirror", "parse_json", "connect_managed"):
        assert required in params, f"factory must take {required}= explicitly"
        assert params[required].kind is inspect.Parameter.KEYWORD_ONLY
        assert params[required].default is inspect.Parameter.empty


def test_email_imap_is_manual_setup_not_a_connect_card(tmp_path, monkeypatch):
    """「链接邮箱」走 email 描述符时：没有一键 OAuth，不该弹 Connect 再 400/死胡同。"""
    import asyncio

    monkeypatch.setenv("COWORKER_STATE_DIR", str(tmp_path / "state"))
    from coworker.server import SessionManager
    from coworker.server.connect_routes import make_connector_requester

    manager = SessionManager(workspace=tmp_path)
    cards: list[dict] = []

    async def on_card(data):
        cards.append(data)

    async def connect_managed(name, body=None):
        raise AssertionError("email must not call managed OAuth")

    requester = make_connector_requester(
        manager,
        "s1",
        route=lambda: "default",
        visibility=lambda: "inline",
        mirror=lambda _i: asyncio.sleep(0),
        parse_json=lambda s: {},
        connect_managed=connect_managed,
        on_card=on_card,
        inbox_visibility_inbox="inbox",
    )
    result = asyncio.run(
        requester({"connector": "email", "reason": "read mail"}, "tc1")
    )
    assert result.get("connected") is False
    assert result.get("needs_manual_setup") is True
    assert "Settings" in result.get("error", "")
    assert cards == [], "no Connect card for form-only connectors"
    assert manager.inbox.pending("s1") == []


def test_gmail_managed_paused_is_manual_setup_not_a_connect_card(tmp_path, monkeypatch):
    """Gmail 一键暂停（CASA）：直接告诉 agent 走手动，不骗用户点 Connect。"""
    import asyncio

    monkeypatch.setenv("COWORKER_STATE_DIR", str(tmp_path / "state"))
    from coworker.server import SessionManager
    from coworker.server.connect_routes import make_connector_requester

    manager = SessionManager(workspace=tmp_path)
    requester = make_connector_requester(
        manager,
        "s1",
        route=lambda: "default",
        visibility=lambda: "inline",
        mirror=lambda _i: asyncio.sleep(0),
        parse_json=lambda s: {},
        connect_managed=lambda n, b=None: (_ for _ in ()).throw(AssertionError()),
        inbox_visibility_inbox="inbox",
    )
    result = asyncio.run(
        requester({"connector": "gmail", "reason": "read mail"}, "tc1")
    )
    assert result.get("needs_manual_setup") is True
    assert "coming soon" in result.get("error", "").lower() or "manually" in result.get(
        "error", ""
    ).lower()


def test_requester_decline_path_uses_injected_helpers_not_globals(tmp_path, monkeypatch):
    """用户拒绝连接：注入的 helpers 真的被调用，且不依赖 app.py 闭包。

    用 slack（managed 且未 paused）才能走到发卡 + wait；gmail 现已 managed_paused。
    """
    import asyncio
    import json

    monkeypatch.setenv("COWORKER_STATE_DIR", str(tmp_path / "state"))
    from coworker.server import SessionManager
    from coworker.server.connect_routes import make_connector_requester

    manager = SessionManager(workspace=tmp_path)
    session_id = "s1"
    seen: dict[str, int] = {"route": 0, "visibility": 0, "mirror": 0, "card": 0}

    def route():
        seen["route"] += 1
        return "default"

    def visibility():
        seen["visibility"] += 1
        return "inline"

    async def mirror(_item):
        seen["mirror"] += 1

    def parse_json(s: str) -> dict:
        return json.loads(s) if s else {}

    async def connect_managed(name, body=None):
        raise AssertionError("decline must not open the browser")

    async def on_card(data):
        seen["card"] += 1
        assert data["title"]
        assert data["brokered_by"] == "OpenWorker Cloud"

    requester = make_connector_requester(
        manager,
        session_id,
        route=route,
        visibility=visibility,
        mirror=mirror,
        parse_json=parse_json,
        connect_managed=connect_managed,
        on_card=on_card,
        inbox_visibility_inbox="inbox",
    )

    async def _run():
        task = asyncio.create_task(
            requester({"connector": "slack", "reason": "post updates"}, "tc1")
        )
        # Wait until the inbox item is parked, then decline it.
        for _ in range(50):
            await asyncio.sleep(0.02)
            pending = manager.inbox.pending(session_id)
            if pending:
                manager.inbox.resolve(
                    pending[-1].id, json.dumps({"connected": False})
                )
                break
        else:
            task.cancel()
            raise AssertionError("inbox item never appeared — helpers likely broken")
        return await task

    result = asyncio.run(_run())
    assert result == {"connected": False, "reason": "the user declined the request"}
    assert seen["route"] == 1
    assert seen["visibility"] == 1
    assert seen["card"] == 1
    # inline visibility → mirror is not called
    assert seen["mirror"] == 0
