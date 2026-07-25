"""Qumge device authorization (RFC 8628) — the network half of Marlo's sign-in.

This lives on the server, not in the GUI, for two reasons. qumge.com sends no CORS headers
and this app ships no Tauri HTTP plugin, so a webview fetch would be blocked outright. And
keeping it here means the issued API key never crosses into the webview at all — a key in a
webview is a key in a devtools console.

Knows nothing about FastAPI or SessionManager: it speaks HTTP and returns plain values, so
it can be tested without a server.
"""

from __future__ import annotations

import os
import time
from dataclasses import dataclass
from typing import Optional

import httpx

DEFAULT_BASE_URL = "https://qumge.com"
TIMEOUT = 15.0


def base_url() -> str:
    """Overridable so tests and a staging deploy can retarget without touching callers."""
    return (os.environ.get("QUMGE_BASE_URL") or DEFAULT_BASE_URL).rstrip("/")


@dataclass
class Flow:
    device_code: str          # secret — never leaves this process
    user_code: str            # shown to the user
    verification_uri: str
    verification_uri_complete: str
    interval: int
    expires_at: float


def start(device_name: Optional[str] = None, *, client: Optional[httpx.Client] = None) -> Flow:
    owns = client is None
    client = client or httpx.Client(timeout=TIMEOUT)
    try:
        r = client.post(
            f"{base_url()}/device/code",
            json={"device_name": device_name} if device_name else {},
        )
        r.raise_for_status()
        d = r.json()
        return Flow(
            device_code=d["device_code"],
            user_code=d["user_code"],
            verification_uri=d["verification_uri"],
            verification_uri_complete=d["verification_uri_complete"],
            interval=int(d.get("interval") or 5),
            expires_at=time.time() + int(d.get("expires_in") or 900),
        )
    finally:
        if owns:
            client.close()


def exchange(
    device_code: str, *, client: Optional[httpx.Client] = None
) -> tuple[str, Optional[str]]:
    """Poll once. Returns (state, access_token).

    state is one of: connected | pending | slow_down | denied | expired | error.
    `slow_down` is kept distinct from `pending` because RFC 8628 requires the caller to
    widen its interval on it — collapsing the two would make a client that is already
    polling too fast keep polling too fast.
    """
    owns = client is None
    client = client or httpx.Client(timeout=TIMEOUT)
    try:
        r = client.post(f"{base_url()}/device/token", json={"device_code": device_code})
        if r.status_code == 200:
            return "connected", r.json().get("access_token")

        # RFC 8628 §3.5: these are 400s carrying an `error` field, not 200s with a failure.
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
        # A transient network blip must not end the flow — the code is valid for 15 minutes
        # and the user may still be mid-approval. Report pending and let the next poll try.
        return "pending", None
    finally:
        if owns:
            client.close()
