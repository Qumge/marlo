"""The account row's model — and specifically, when it is allowed to say
"not signed in".

The bug this replaces: the footer reported sign-in to a third party's cloud
while rendering this account's balance next to it, so a signed-in user read
"Not signed in" beside their own $19.12. The interesting assertions here are all
negative — the states where the row must NOT claim someone is signed out.
"""
from __future__ import annotations

import httpx
import pytest

from coworker.qumge import account as qa
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
        return httpx.Response(status, json=payload, request=httpx.Request("GET", url))

    monkeypatch.setattr(qb.httpx, "get", fake_get)


def _ok(**over):
    return {"email": "someone@example.com", "balance_micro_usd": 19_120_000, **over}


# -- the happy path -----------------------------------------------------------

def test_it_names_the_account_and_the_balance(monkeypatch):
    _stub(monkeypatch, payload=_ok())
    got = qa.status(_signed_in())
    assert got["signed_in"] is True
    assert got["email"] == "someone@example.com"
    assert got["balance"]["balance_micro_usd"] == 19_120_000


def test_signed_out_is_a_state_not_an_error(monkeypatch):
    def fake_get(*a, **k):
        raise AssertionError("must not call the network without a key")

    monkeypatch.setattr(qb.httpx, "get", fake_get)
    got = qa.status(SecretStore())
    assert got == {"signed_in": False, "email": None, "balance": None}


# -- the states that must never read as signed out ----------------------------

@pytest.mark.parametrize(
    "kwargs",
    [
        {"raises": httpx.ConnectError("offline")},
        {"raises": httpx.ReadTimeout("slow")},
        {"status": 500},
        {"status": 200, "payload": {"unexpected": "shape"}},
    ],
)
def test_a_key_on_disk_means_signed_in_whatever_the_network_says(monkeypatch, kwargs):
    # This is the whole point of deciding `signed_in` locally. Derive it from a
    # successful balance call and every tunnel, flaky café wifi and server blip
    # tells the user they have been logged out.
    _stub(monkeypatch, **kwargs)
    got = qa.status(_signed_in())
    assert got["signed_in"] is True
    assert got["balance"] is None


def test_a_401_still_reads_as_signed_in(monkeypatch):
    # Deliberate. A revoked or rotated key is a real signed-out state, but it is
    # indistinguishable here from a server that is briefly rejecting everything,
    # and guessing wrong wipes the row for someone whose account is fine. The
    # honest failure is a missing balance, not a missing identity.
    _stub(monkeypatch, status=401)
    assert qa.status(_signed_in())["signed_in"] is True


def test_zero_credit_is_not_signed_out(monkeypatch):
    _stub(monkeypatch, payload=_ok(balance_micro_usd=0))
    got = qa.status(_signed_in())
    assert got["signed_in"] is True
    assert got["balance"]["balance_micro_usd"] == 0
    assert got["balance"]["low"] is True


# -- the email cache ----------------------------------------------------------

def test_the_name_survives_going_offline(monkeypatch):
    secrets = _signed_in()
    _stub(monkeypatch, payload=_ok())
    assert qa.status(secrets)["email"] == "someone@example.com"

    # Same store, network gone. Without the cache the row would swap a name for
    # a placeholder every time a poll failed — a footer that flickers between
    # two identities reads as broken, not as offline.
    _stub(monkeypatch, raises=httpx.ConnectError("offline"))
    assert qa.status(secrets)["email"] == "someone@example.com"


def test_caching_the_name_does_not_disturb_the_key(monkeypatch):
    # _remember_email writes back into the profile that holds the credential.
    # A put() of just the email would sign the user out to record a display
    # string.
    secrets = _signed_in()
    _stub(monkeypatch, payload=_ok())
    qa.status(secrets)

    profile = secrets.get("provider:qumge")
    assert profile["api_key"] == "sk_qumge_test"
    assert profile["base_url"] == "https://qumge.com/v1"
    assert profile["email"] == "someone@example.com"


def test_a_new_address_replaces_the_remembered_one(monkeypatch):
    secrets = _signed_in()
    _stub(monkeypatch, payload=_ok())
    qa.status(secrets)

    _stub(monkeypatch, payload=_ok(email="other@example.com"))
    assert qa.status(secrets)["email"] == "other@example.com"
    assert secrets.get("provider:qumge")["email"] == "other@example.com"


def test_an_old_server_without_the_field_still_gives_a_balance(monkeypatch):
    # Servers and desktop installs move independently; a build that only renders
    # the row when it knows the address would go blank against yesterday's API.
    _stub(monkeypatch, payload={"balance_micro_usd": 4_250_000})
    got = qa.status(_signed_in())
    assert got["signed_in"] is True
    assert got["email"] is None
    assert got["balance"]["balance"] == pytest.approx(4.25)


def test_an_empty_email_is_absence_not_a_name(monkeypatch):
    _stub(monkeypatch, payload=_ok(email="  "))
    assert qa.status(_signed_in())["email"] is None
