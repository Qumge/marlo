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
