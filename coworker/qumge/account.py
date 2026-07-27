"""Who is signed in to Qumge — the one thing the account row is supposed to say.

The sidebar footer is where a person looks to find out whose account this is and
what it has left. It used to report sign-in to OpenWorker Cloud: a third party
whose connectors this build does not support, and not the account that pays for
the models. Someone signed in to Qumge, with their balance rendered two
centimetres to the right, read "Not signed in".

Two facts arrive by different routes, deliberately:

  signed_in   local. A key is in the SecretStore or it isn't. Never a network
              question, or every offline moment would read as a signed-out one
              and reintroduce the bug in a new costume.
  email       from the server, cached. The device flow hands back an access
              token and says nothing about who approved it, so /v1/balance
              naming the account is the only source. Cached so a failed poll
              leaves the row showing the same name rather than flickering
              between an address and a placeholder.
"""
from __future__ import annotations

from typing import Any, Optional

from ..secrets import SecretStore
from . import balance as qumge_balance

_PROFILE = "provider:qumge"


def _cached_email(secrets: SecretStore) -> Optional[str]:
    profile = secrets.get(_PROFILE) or {}
    return (profile.get("email") or "").strip() or None


def _remember_email(secrets: SecretStore, email: str) -> None:
    """Store the address alongside the key it belongs to.

    Read-modify-write rather than put(): the profile holds the api_key and
    base_url, and replacing it wholesale to record a display string would sign
    the user out.
    """
    profile = dict(secrets.get(_PROFILE) or {})
    if not profile.get("api_key") or profile.get("email") == email:
        return
    profile["email"] = email
    secrets.put(_PROFILE, profile)


def status(secrets: SecretStore) -> dict[str, Any]:
    """The account row's whole model: signed in, as whom, with how much left.

    Always returns a dict. Signed out is a state to render, not an error — and
    the failures underneath (offline, server down, an old server with no email
    field) each degrade to a missing field rather than to a missing answer.
    """
    if not qumge_balance.signed_in(secrets):
        return {"signed_in": False, "email": None, "balance": None}

    bal = qumge_balance.fetch(secrets)
    email = (bal or {}).get("email") or _cached_email(secrets)
    if bal and bal.get("email"):
        _remember_email(secrets, bal["email"])

    return {"signed_in": True, "email": email, "balance": bal}
