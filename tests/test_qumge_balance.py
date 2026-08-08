"""Credit lookup — and, more importantly, what it does when it cannot look.

Every failure here has to be silent. A balance chip that turns into an error
banner because the network blipped is worse than no chip: the user was mid-task,
nothing is wrong with their work, and the app just shouted at them about itself.
"""
from __future__ import annotations

import httpx
import pytest

from coworker.qumge import balance as qb
from coworker.secrets import SecretStore


@pytest.fixture(autouse=True)
def _state(tmp_path, monkeypatch):
    monkeypatch.setenv("COWORKER_STATE_DIR", str(tmp_path))
    monkeypatch.delenv("QUMGE_BASE_URL", raising=False)
    yield


def _signed_in() -> SecretStore:
    s = SecretStore()
    s.put("provider:qumge", {"api_key": "sk_qumge_test", "base_url": "https://qumge.com/v1"})
    return s


def _stub(monkeypatch, *, status=200, payload=None, raises=None):
    def fake_get(url, **kwargs):
        if raises:
            raise raises
        req = httpx.Request("GET", url)
        return httpx.Response(status, json=payload, request=req)

    monkeypatch.setattr(qb.httpx, "get", fake_get)


def test_returns_none_when_not_signed_in(monkeypatch):
    called = {"n": 0}

    def fake_get(*a, **k):
        called["n"] += 1
        raise AssertionError("must not call the network without a key")

    monkeypatch.setattr(qb.httpx, "get", fake_get)
    assert qb.fetch(SecretStore()) is None
    assert called["n"] == 0


def test_reads_the_balance_and_the_topup_url(monkeypatch):
    _stub(monkeypatch, payload={
        "balance_micro_usd": 4_250_000, "balance": 4.25,
        "currency": "USD", "topup_url": "https://qumge.com/en/gateway/topup/new",
    })
    got = qb.fetch(_signed_in())
    assert got["balance_micro_usd"] == 4_250_000
    assert got["balance"] == pytest.approx(4.25)
    assert got["topup_url"].endswith("/topup/new")
    assert got["low"] is False


def test_low_is_decided_here_not_in_the_gui(monkeypatch):
    # The threshold and the number it judges have to live together, or a later
    # change to one leaves the warning firing at the wrong figure.
    _stub(monkeypatch, payload={"balance_micro_usd": 250_000})
    assert qb.fetch(_signed_in())["low"] is True

    _stub(monkeypatch, payload={"balance_micro_usd": 1_000_000})
    assert qb.fetch(_signed_in())["low"] is False, "exactly $1 is not yet low"


def test_zero_is_a_number_not_an_absence(monkeypatch):
    # The state the user most needs to see. Returning None here would hide the
    # chip at precisely the moment it matters.
    _stub(monkeypatch, payload={"balance_micro_usd": 0})
    got = qb.fetch(_signed_in())
    assert got is not None
    assert got["balance_micro_usd"] == 0
    assert got["low"] is True


@pytest.mark.parametrize(
    "kwargs",
    [
        {"status": 401},
        {"status": 500},
        {"status": 200, "payload": {"unexpected": "shape"}},
        {"status": 200, "payload": None},
        {"raises": httpx.ConnectError("offline")},
        {"raises": httpx.ReadTimeout("slow")},
    ],
)
def test_every_failure_is_silent(monkeypatch, kwargs):
    _stub(monkeypatch, **kwargs)
    assert qb.fetch(_signed_in()) is None


def test_a_missing_topup_url_still_leaves_somewhere_to_go(monkeypatch):
    # The server ships this so a checkout path that moves cannot strand old
    # installs — but an old server that omits it must not leave the user with a
    # warning and no way to act on it.
    _stub(monkeypatch, payload={"balance_micro_usd": 0})
    assert "topup" in qb.fetch(_signed_in())["topup_url"]


def test_can_spend_is_true_with_credit(monkeypatch):
    _stub(monkeypatch, payload={"balance_micro_usd": 2_500_000, "currency": "USD"})
    assert qb.fetch(_signed_in())["can_spend"] is True


def test_can_spend_is_false_at_exactly_zero(monkeypatch):
    """新注册账号就是这个状态 —— 第一层闸门唯一会触发的场景。"""
    _stub(monkeypatch, payload={"balance_micro_usd": 0, "currency": "USD"})
    bal = qb.fetch(_signed_in())
    assert bal["can_spend"] is False
    assert bal["low"] is True  # 两层叠加，不互斥


def test_unknown_balance_carries_no_can_spend_at_all(monkeypatch):
    """None 而不是 {"can_spend": False}。GUI 的「拿不到就不拦」整条规则
    都建立在这上面：没有这个键，就没有任何东西能把闸门关上。"""
    _stub(monkeypatch, raises=httpx.ConnectError("offline"))
    assert qb.fetch(_signed_in()) is None


def test_can_spend_and_low_are_independent_judgements(monkeypatch):
    """250_000 落在两条线中间：低于一美元所以 low 为 True，但还没到零所以
    can_spend 仍是 True。专门防住 `can_spend = not low` 这种「省一行」的
    实现 —— 那种写法在 0 和 $2.5 两端都能蒙混过关，只有这个中间值会把它
    拆穿：0 和 $2.5 处两个判据碰巧一致，唯独这里它们必须分道扬镳。"""
    _stub(monkeypatch, payload={"balance_micro_usd": 250_000, "currency": "USD"})
    bal = qb.fetch(_signed_in())
    assert bal["low"] is True
    assert bal["can_spend"] is True
