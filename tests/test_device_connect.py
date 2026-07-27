"""AutoWhisper：我们自己的产品作为一个连接器。

和那 6 个借道 OpenWorker Cloud 的不同 —— 这条链路整条是我们的：授权页上写的
是我们的名字，没有第三方经手 token，不用等谁过审。它是「连接」这一格里唯一
别人复刻不了的部分。

断言的重点是【别把两条路混起来】：授权卡片上的中转方是从这些字段推出来的，
写错等于对用户撒谎 —— 凭空说"由 X 中转"而实际没有，是自己制造一个不信任的
理由。
"""
from __future__ import annotations

from coworker.connectors.descriptors import DESCRIPTORS, get_descriptor


def test_autowhisper_is_in_the_catalog():
    d = get_descriptor("autowhisper")
    assert d is not None
    assert d.title
    assert d.available, "不可用的连接器进不了 request_connector 的允许集"


def test_it_does_not_claim_to_be_brokered_by_openworker():
    d = get_descriptor("autowhisper")
    assert d.managed is False, "它不经 OpenWorker Cloud"
    assert d.device_auth_base.startswith("https://"), "它有自己的设备码入口"


def test_manual_paste_stays_available():
    # descriptors.py 里写着的不变量：手动粘 token 永远保留，一键只是额外的
    # 一条路，不是替代（本地自足的开源流程是神圣的）。
    d = get_descriptor("autowhisper")
    assert d.auth == "api_token"
    assert any(f.key == "api_token" for f in d.fields)


def test_the_device_base_points_at_the_host_that_actually_serves_it():
    """域名写错一个字，整条授权链就是死的，而卡片上不会说为什么。

    2026-07-27 真踩过：descriptors 里写的是 autowhisper.ai，而
      autowhisper.xyz/device/code  POST → 200，真发出 user_code
      autowhisper.ai/device/code   POST → 405（裸响应，没有 Rails 头）
    .ai 后面不是这个应用；AutoWhisper 的 config.hosts 白名单里【只有】
    autowhisper.xyz 和 www.autowhisper.xyz。

    这条测不了网络（单测不该联网），但它能拦住"又写回 .ai"这一种。
    """
    d = get_descriptor("autowhisper")
    assert d.device_auth_base == "https://autowhisper.xyz", (
        f"device_auth_base 是 {d.device_auth_base} —— 服务在 autowhisper.xyz 上，"
        "写别的域名等于让用户点了授权卡片拿到 405"
    )


def test_no_device_base_uses_a_bare_or_http_host():
    # 设备码流程里走的是 token：明文 http 等于把它交给任何一个中间人。
    for d in DESCRIPTORS:
        base = getattr(d, "device_auth_base", "")
        if base:
            assert base.startswith("https://"), f"{d.name}: {base}"
            assert not base.endswith("/"), f"{d.name} 末尾多了斜杠，拼出来会是双斜杠"


def test_the_openworker_ones_do_not_grow_a_device_base():
    # 反过来也别串：借道的那几个不该冒出一个自己的设备码入口。
    for name in ("outlook", "notion", "slack"):
        assert get_descriptor(name).device_auth_base == "", name


def test_exactly_one_of_the_two_paths_per_connector():
    # managed（经第三方）和 device_auth_base（我们自己的）是互斥的两条路。
    # 同时为真的连接器，卡片不知道该说什么。
    for d in DESCRIPTORS:
        assert not (
            getattr(d, "managed", False) and getattr(d, "device_auth_base", "")
        ), f"{d.name} 同时声明了两条授权路径"


# -- 设备码状态机 --------------------------------------------------------------

import httpx
import pytest

from coworker.connectors import device_connect


class _FakeClient:
    def __init__(self, status, payload):
        self._status, self._payload = status, payload
        self.calls = []

    def post(self, url, **kw):
        self.calls.append(url)
        return httpx.Response(
            self._status, json=self._payload, request=httpx.Request("POST", url)
        )

    def close(self):
        pass


def test_start_returns_what_the_card_needs():
    c = _FakeClient(200, {
        "device_code": "secret", "user_code": "K7M2-QP4X",
        "verification_uri": "https://autowhisper.xyz/en/device",
        "verification_uri_complete": "https://autowhisper.xyz/en/device?user_code=K7M2-QP4X",
        "interval": 5, "expires_in": 900,
    })
    f = device_connect.start("https://autowhisper.xyz", "autowhisper", "Mac", client=c)
    assert f.user_code == "K7M2-QP4X"
    assert f.connector == "autowhisper"
    assert f.verification_uri_complete.endswith("K7M2-QP4X")
    assert f.expires_at > 0


def test_slow_down_is_not_collapsed_into_pending():
    # RFC 8628 §3.5：调用方收到 slow_down 必须【加宽】间隔。合成一个，会让
    # 一个已经打太快的客户端继续打太快。
    c = _FakeClient(400, {"error": "slow_down"})
    assert device_connect.exchange("https://x", "dc", client=c) == ("slow_down", None)

    c = _FakeClient(400, {"error": "authorization_pending"})
    assert device_connect.exchange("https://x", "dc", client=c) == ("pending", None)


@pytest.mark.parametrize("err,state", [
    ("access_denied", "denied"),
    ("expired_token", "expired"),
    ("invalid_grant", "error"),
    ("something_new", "error"),
])
def test_every_rfc_error_maps_to_a_state(err, state):
    c = _FakeClient(400, {"error": err})
    assert device_connect.exchange("https://x", "dc", client=c)[0] == state


def test_connected_carries_the_token():
    c = _FakeClient(200, {"access_token": "tok", "token_type": "bearer"})
    assert device_connect.exchange("https://x", "dc", client=c) == ("connected", "tok")


def test_a_network_blip_is_pending_not_a_dead_flow():
    # 码有 15 分钟有效期，用户可能正站在批准页上。一次抖动不该把流程判死。
    class _Boom:
        def post(self, *a, **k):
            raise httpx.ConnectError("blip")

        def close(self):
            pass

    assert device_connect.exchange("https://x", "dc", client=_Boom()) == ("pending", None)
