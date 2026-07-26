"""How much credit is left, and where to add more.

Marlo is pay-as-you-go and said nothing about money anywhere. The first thing a
user would have learned about their balance is a request failing — and a 402
from a gateway is not something a person can act on.

Two sources, deliberately:

  GET /v1/balance          the number before any work has been done, plus the
                           top-up URL, which ships from the server so a checkout
                           path that moves cannot strand installs.
  X-Balance-Remaining      on every inference response. Free, always current,
                           and it means the figure updates as the user works
                           instead of only when something polls.

Failures are silent. A balance that could not be fetched is a number missing
from a corner of the screen; turning that into an error in front of someone who
is trying to get work done would be worse than the gap.
"""
from __future__ import annotations

import os
from typing import Any, Optional

import httpx

from ..secrets import SecretStore

DEFAULT_BASE_URL = "https://qumge.com"
_TIMEOUT = 10.0


def base_url() -> str:
    return (os.environ.get("QUMGE_BASE_URL") or DEFAULT_BASE_URL).rstrip("/")


def _api_key(secrets: SecretStore) -> Optional[str]:
    profile = secrets.get("provider:qumge") or {}
    key = (profile.get("api_key") or "").strip()
    return key or None


def fetch(secrets: SecretStore) -> Optional[dict[str, Any]]:
    """Current balance, or None when it cannot be known.

    None covers every reason equally — not signed in, offline, server down,
    unreadable body — because the caller does the same thing with all of them:
    shows nothing.
    """
    key = _api_key(secrets)
    if not key:
        return None
    try:
        r = httpx.get(
            f"{base_url()}/v1/balance",
            headers={"Authorization": f"Bearer {key}"},
            timeout=_TIMEOUT,
        )
        if r.status_code != 200:
            return None
        data = r.json()
    except Exception:
        return None

    if not isinstance(data, dict) or "balance_micro_usd" not in data:
        return None

    micro = int(data.get("balance_micro_usd") or 0)
    return {
        "balance_micro_usd": micro,
        "balance": micro / 1_000_000.0,
        "currency": data.get("currency") or "USD",
        "topup_url": data.get("topup_url") or f"{base_url()}/en/gateway/topup/new",
        # The threshold is here, not in the GUI, so the warning and the number it
        # is based on cannot drift apart. A dollar is roughly a handful of turns
        # on a good model — enough warning to act, not so much that it nags.
        "low": micro < 1_000_000,
    }
