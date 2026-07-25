"""Qumge device authorization (RFC 8628) — server-side flow. No network: httpx is mocked at
the transport (`httpx.Client`) boundary via fake client objects injected either directly
(device_flow unit tests) or by monkeypatching `httpx.Client` (manager/REST wiring tests, since
the manager never threads a `client=` kwarg through).

The property that matters most here: neither endpoint response, nor any value returned to a
caller (manager method or REST route), ever carries the API key or the device_code. That's
asserted explicitly in several tests below, not just implied by the shape of the code.
"""

from __future__ import annotations

import json
import time

import httpx
import pytest
from fastapi.testclient import TestClient

from coworker.qumge import device_flow
from coworker.server.app import create_app
from coworker.server.manager import SessionManager


# ------------------------------------------------------------------------------------------
# Fakes — a minimal httpx-shaped response/client, no real transport involved.
# ------------------------------------------------------------------------------------------


class FakeResponse:
    def __init__(self, status_code=200, json_data=None):
        self.status_code = status_code
        self._json = json_data if json_data is not None else {}

    def json(self):
        return self._json

    def raise_for_status(self):
        if self.status_code >= 400:
            request = httpx.Request("POST", "https://qumge.com/device/code")
            raise httpx.HTTPStatusError(
                "error", request=request, response=httpx.Response(self.status_code, request=request)
            )


class FakeClient:
    """Injectable stand-in for `httpx.Client` — consumes queued responses/exceptions in order."""

    def __init__(self, responses):
        self._responses = list(responses)
        self.requests: list[tuple[str, dict | None]] = []

    def post(self, url, json=None, **kwargs):
        self.requests.append((url, json))
        item = self._responses.pop(0)
        if isinstance(item, Exception):
            raise item
        return item

    def close(self):
        pass


def _start_payload(
    device_code="dc-1", user_code="ABCD-1234", interval=5, expires_in=900
):
    return FakeResponse(
        200,
        {
            "device_code": device_code,
            "user_code": user_code,
            "verification_uri": "https://qumge.com/device",
            "verification_uri_complete": f"https://qumge.com/device?user_code={user_code}",
            "expires_in": expires_in,
            "interval": interval,
        },
    )


class _ClientFactory:
    """Stands in for the `httpx.Client` class itself: each call (`httpx.Client(timeout=...)`)
    returns a fresh one-shot client backed by a shared response queue, mirroring how
    device_flow.start()/exchange() each open-and-close their own client when no client= is
    passed (as the manager calls them)."""

    def __init__(self, responses):
        self._responses = list(responses)
        self.requests: list[tuple[str, dict | None]] = []

    def __call__(self, **kwargs):
        return _OneShotClient(self)


class _OneShotClient:
    def __init__(self, factory: "_ClientFactory"):
        self._factory = factory

    def post(self, url, json=None, **kwargs):
        self._factory.requests.append((url, json))
        item = self._factory._responses.pop(0)
        if isinstance(item, Exception):
            raise item
        return item

    def close(self):
        pass


def _patch_client(monkeypatch, responses):
    factory = _ClientFactory(responses)
    monkeypatch.setattr(device_flow.httpx, "Client", factory)
    return factory


# ------------------------------------------------------------------------------------------
# device_flow.base_url()
# ------------------------------------------------------------------------------------------


def test_base_url_defaults_to_qumge_dot_com(monkeypatch):
    monkeypatch.delenv("QUMGE_BASE_URL", raising=False)
    assert device_flow.base_url() == "https://qumge.com"


def test_base_url_overridable_for_tests_and_staging(monkeypatch):
    monkeypatch.setenv("QUMGE_BASE_URL", "https://staging.qumge.com/")
    assert device_flow.base_url() == "https://staging.qumge.com"  # trailing slash trimmed


# ------------------------------------------------------------------------------------------
# device_flow.start()
# ------------------------------------------------------------------------------------------


def test_start_posts_to_device_code_and_returns_the_payload():
    fake = FakeClient([_start_payload()])

    flow = device_flow.start(client=fake)

    assert fake.requests[0][0] == "https://qumge.com/device/code"
    assert flow.device_code == "dc-1"
    assert flow.user_code == "ABCD-1234"
    assert flow.verification_uri == "https://qumge.com/device"
    assert flow.verification_uri_complete == "https://qumge.com/device?user_code=ABCD-1234"
    assert flow.interval == 5
    assert flow.expires_at > time.time()


def test_start_sends_device_name_when_given():
    fake = FakeClient([_start_payload()])
    device_flow.start("my-mac", client=fake)
    assert fake.requests[0][1] == {"device_name": "my-mac"}


def test_start_omits_device_name_when_not_given():
    fake = FakeClient([_start_payload()])
    device_flow.start(client=fake)
    assert fake.requests[0][1] == {}


# ------------------------------------------------------------------------------------------
# device_flow.exchange() — RFC 8628 error mapping
# ------------------------------------------------------------------------------------------


@pytest.mark.parametrize(
    "rfc_error,expected_state",
    [
        ("authorization_pending", "pending"),
        ("slow_down", "slow_down"),
        ("access_denied", "denied"),
        ("expired_token", "expired"),
        ("invalid_grant", "error"),
        ("some_future_error_code", "error"),  # unknown errors fail safe, not silently swallowed
    ],
)
def test_exchange_maps_each_rfc_error(rfc_error, expected_state):
    fake = FakeClient([FakeResponse(400, {"error": rfc_error})])
    state, token = device_flow.exchange("dc-1", client=fake)
    assert state == expected_state
    assert token is None


def test_exchange_success_returns_connected_and_the_token():
    fake = FakeClient(
        [FakeResponse(200, {"access_token": "qm-secret-key", "token_type": "bearer"})]
    )
    state, token = device_flow.exchange("dc-1", client=fake)
    assert state == "connected"
    assert token == "qm-secret-key"


def test_exchange_sends_the_device_code():
    fake = FakeClient([FakeResponse(400, {"error": "authorization_pending"})])
    device_flow.exchange("dc-42", client=fake)
    assert fake.requests[0] == ("https://qumge.com/device/token", {"device_code": "dc-42"})


def test_exchange_400_with_unparseable_body_is_error():
    class _UnparseableResponse:
        status_code = 400

        def json(self):
            raise ValueError("not json")

    state, token = device_flow.exchange("dc-1", client=FakeClient([_UnparseableResponse()]))
    assert state == "error"
    assert token is None


def test_exchange_network_error_reports_pending_not_error():
    """A transient blip must not end the flow — the code is good for 15 minutes and the user
    may still be mid-approval, so a caught httpx error is reported as pending, never error."""
    fake = FakeClient([httpx.ConnectError("boom")])
    state, token = device_flow.exchange("dc-1", client=fake)
    assert state == "pending"
    assert token is None


# ------------------------------------------------------------------------------------------
# Manager wiring: start_qumge_device / poll_qumge_device
# ------------------------------------------------------------------------------------------


def _manager(tmp_path):
    return SessionManager(data_dir=tmp_path / "data")


def test_start_qumge_device_returns_payload_and_stores_the_flow(tmp_path, monkeypatch):
    _patch_client(monkeypatch, [_start_payload()])
    mgr = _manager(tmp_path)

    result = mgr.start_qumge_device("my-mac")

    assert result["user_code"] == "ABCD-1234"
    assert result["verification_uri"] == "https://qumge.com/device"
    assert (
        result["verification_uri_complete"]
        == "https://qumge.com/device?user_code=ABCD-1234"
    )
    assert result["interval"] == 5
    # computed from expires_at - now(); allow for the few microseconds of test execution
    assert 895 <= result["expires_in"] <= 900
    # the security property: device_code never in the value handed back to the caller
    assert "device_code" not in result
    assert "dc-1" not in json.dumps(result)
    # ... but the flow itself, including device_code, is retained server-side for polling
    assert mgr._qumge_flow is not None
    assert mgr._qumge_flow.device_code == "dc-1"


def test_poll_with_no_flow_in_progress_is_an_error(tmp_path):
    mgr = _manager(tmp_path)
    assert mgr.poll_qumge_device() == {
        "status": "error",
        "error": "no sign-in in progress",
    }


def test_poll_authorization_pending(tmp_path, monkeypatch):
    _patch_client(
        monkeypatch,
        [_start_payload(interval=5), FakeResponse(400, {"error": "authorization_pending"})],
    )
    mgr = _manager(tmp_path)
    mgr.start_qumge_device()

    assert mgr.poll_qumge_device() == {"status": "pending", "interval": 5}
    assert mgr._qumge_flow is not None  # flow survives a pending poll


def test_poll_slow_down_widens_the_interval(tmp_path, monkeypatch):
    """The test proves the widening, rather than assuming it: interval must visibly grow
    across polls, and a subsequent pending poll must use the widened value."""
    _patch_client(
        monkeypatch,
        [
            _start_payload(interval=5),
            FakeResponse(400, {"error": "slow_down"}),
            FakeResponse(400, {"error": "authorization_pending"}),
        ],
    )
    mgr = _manager(tmp_path)
    mgr.start_qumge_device()
    assert mgr._qumge_flow.interval == 5

    first = mgr.poll_qumge_device()
    assert first == {"status": "pending", "interval": 10}
    assert mgr._qumge_flow.interval == 10  # actually widened, not just reported wider once

    second = mgr.poll_qumge_device()
    assert second == {"status": "pending", "interval": 10}  # stays widened


def test_poll_access_denied_clears_the_flow(tmp_path, monkeypatch):
    _patch_client(
        monkeypatch, [_start_payload(), FakeResponse(400, {"error": "access_denied"})]
    )
    mgr = _manager(tmp_path)
    mgr.start_qumge_device()

    assert mgr.poll_qumge_device() == {"status": "denied"}
    assert mgr._qumge_flow is None
    # a further poll finds nothing in progress rather than re-reporting denied
    assert mgr.poll_qumge_device()["status"] == "error"


def test_poll_expired_token_clears_the_flow(tmp_path, monkeypatch):
    _patch_client(
        monkeypatch, [_start_payload(), FakeResponse(400, {"error": "expired_token"})]
    )
    mgr = _manager(tmp_path)
    mgr.start_qumge_device()

    assert mgr.poll_qumge_device() == {"status": "expired"}
    assert mgr._qumge_flow is None


def test_poll_invalid_grant_is_an_error_and_clears_the_flow(tmp_path, monkeypatch):
    _patch_client(
        monkeypatch, [_start_payload(), FakeResponse(400, {"error": "invalid_grant"})]
    )
    mgr = _manager(tmp_path)
    mgr.start_qumge_device()

    result = mgr.poll_qumge_device()
    assert result["status"] == "error"
    assert mgr._qumge_flow is None


def test_poll_past_local_expiry_reports_expired_without_another_network_call(
    tmp_path, monkeypatch
):
    factory = _patch_client(monkeypatch, [_start_payload(expires_in=900)])
    mgr = _manager(tmp_path)
    mgr.start_qumge_device()
    mgr._qumge_flow.expires_at = time.time() - 1  # force local expiry

    assert mgr.poll_qumge_device() == {"status": "expired"}
    assert mgr._qumge_flow is None
    assert len(factory.requests) == 1  # only the start() call — no exchange() was attempted


def test_poll_connected_stores_key_via_set_provider_and_hides_it_from_the_caller(
    tmp_path, monkeypatch
):
    _patch_client(
        monkeypatch,
        [
            _start_payload(),
            FakeResponse(200, {"access_token": "qm-super-secret-key", "token_type": "bearer"}),
        ],
    )
    mgr = _manager(tmp_path)
    mgr.start_qumge_device()

    result = mgr.poll_qumge_device()

    assert result == {"status": "connected"}
    # the security property: the key is never in the value handed back to the caller
    assert "qm-super-secret-key" not in json.dumps(result)
    # ... yet it did land in the provider:qumge profile, through set_provider (not a raw write)
    stored = mgr.secrets.get("provider:qumge")
    assert stored["api_key"] == "qm-super-secret-key"
    assert stored["base_url"] == "https://qumge.com/v1"
    assert mgr._qumge_flow is None


def test_poll_connected_goes_through_set_provider_not_a_raw_secretstore_write(
    tmp_path, monkeypatch
):
    """set_provider does more than persist the key: it rebuilds the cached client and offers
    the recommended model. Assert that side effect happened, proving the manager routed
    through set_provider rather than calling secrets.put directly."""
    _patch_client(
        monkeypatch,
        [_start_payload(), FakeResponse(200, {"access_token": "qm-key", "token_type": "bearer"})],
    )
    mgr = _manager(tmp_path)
    mgr.start_qumge_device()
    mgr.poll_qumge_device()

    assert "qumge:anthropic/claude-sonnet-4.6" in mgr._curated_models()


def test_starting_a_second_flow_abandons_the_first(tmp_path, monkeypatch):
    """Polling after a second start() must use the NEW device_code — even if the server
    would have happily connected the old (now-abandoned) one."""

    class _ScriptedClient:
        """Routes /device/code through a queue (one entry per start()) and answers
        /device/token based on which device_code is actually presented, regardless of
        call order — so we can prove the old code is never retried."""

        def __init__(self, start_responses, connects_only_for):
            self._start_responses = list(start_responses)
            self._connects_only_for = connects_only_for
            self.requests: list[tuple[str, dict | None]] = []

        def __call__(self, **kwargs):
            return self

        def post(self, url, json=None, **kwargs):
            self.requests.append((url, json))
            if url.endswith("/device/code"):
                return self._start_responses.pop(0)
            code = (json or {}).get("device_code")
            if code == self._connects_only_for:
                return FakeResponse(
                    200, {"access_token": "leaked-old-key", "token_type": "bearer"}
                )
            return FakeResponse(400, {"error": "authorization_pending"})

        def close(self):
            pass

    client = _ScriptedClient(
        start_responses=[
            _start_payload(device_code="dc-old", user_code="OLD-CODE"),
            _start_payload(device_code="dc-new", user_code="NEW-CODE"),
        ],
        connects_only_for="dc-old",  # simulates: the user approved the FIRST code
    )
    monkeypatch.setattr(device_flow.httpx, "Client", client)
    mgr = _manager(tmp_path)

    mgr.start_qumge_device()  # flow #1: dc-old
    first_flow = mgr._qumge_flow
    mgr.start_qumge_device()  # flow #2 discards #1: dc-new
    assert mgr._qumge_flow is not first_flow
    assert mgr._qumge_flow.device_code == "dc-new"

    result = mgr.poll_qumge_device()

    # the server would have connected dc-old, but the manager no longer has it to offer
    assert result["status"] == "pending"
    assert client.requests[-1] == (
        "https://qumge.com/device/token",
        {"device_code": "dc-new"},
    )
    assert mgr.secrets.get("provider:qumge") is None


# ------------------------------------------------------------------------------------------
# REST wiring: /v1/qumge/device/start, /v1/qumge/device/poll
# ------------------------------------------------------------------------------------------


def _rest_client(mgr):
    return TestClient(create_app(mgr))


def test_rest_start_route_never_returns_device_code(tmp_path, monkeypatch):
    _patch_client(monkeypatch, [_start_payload()])
    mgr = _manager(tmp_path)
    client = _rest_client(mgr)

    resp = client.post("/v1/qumge/device/start", json={"device_name": "my-mac"})

    assert resp.status_code == 200
    body = resp.json()
    assert body["user_code"] == "ABCD-1234"
    assert "device_code" not in body
    assert "dc-1" not in resp.text


def test_rest_start_route_defaults_device_name_to_none_with_empty_body(tmp_path, monkeypatch):
    _patch_client(monkeypatch, [_start_payload()])
    mgr = _manager(tmp_path)
    client = _rest_client(mgr)

    resp = client.post("/v1/qumge/device/start")

    assert resp.status_code == 200
    assert resp.json()["user_code"] == "ABCD-1234"


def test_rest_poll_route_reports_pending(tmp_path, monkeypatch):
    _patch_client(
        monkeypatch,
        [_start_payload(), FakeResponse(400, {"error": "authorization_pending"})],
    )
    mgr = _manager(tmp_path)
    client = _rest_client(mgr)
    client.post("/v1/qumge/device/start")

    resp = client.get("/v1/qumge/device/poll")

    assert resp.status_code == 200
    assert resp.json() == {"status": "pending", "interval": 5}


def test_rest_poll_route_never_returns_the_key(tmp_path, monkeypatch):
    _patch_client(
        monkeypatch,
        [_start_payload(), FakeResponse(200, {"access_token": "qm-wire-secret", "token_type": "bearer"})],
    )
    mgr = _manager(tmp_path)
    client = _rest_client(mgr)
    client.post("/v1/qumge/device/start")

    resp = client.get("/v1/qumge/device/poll")

    assert resp.status_code == 200
    assert resp.json() == {"status": "connected"}
    assert "qm-wire-secret" not in resp.text
    assert mgr.secrets.get("provider:qumge")["api_key"] == "qm-wire-secret"
