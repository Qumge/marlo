"""Friendly translation of model access + quota failures.

The picker now defaults to brand-new flagships (GPT-5.6 Sol, Claude Fable 5), and not every
account can use them: OpenAI is still rolling GPT-5.6 out per-organization, and both vendors
reject calls once quota/credits run out. Those failures arrive as terse SDK exceptions
wrapping JSON error bodies; this maps the well-known shapes to one actionable sentence.
Anything unrecognized returns None and the caller surfaces the raw error unchanged.

Matching is on the error BODY text (error codes/types), not just HTTP status — a 404 also
means "wrong base_url" and a 429 also means "slow down", and neither of those should be
dressed up as an access problem.
"""

from __future__ import annotations

from typing import Optional
from urllib.parse import urlparse

# Error-body markers, verbatim from the vendors' error codes/messages:
# OpenAI: {"error": {"code": "model_not_found", "message": "The model `X` does not exist or
#   you do not have access to it."}} (404/403) and {"code": "insufficient_quota"} (429).
# Anthropic: {"type": "not_found_error", "message": "model: X"} (404),
#   {"type": "permission_error"} (403), and "credit balance is too low" (400).
_NO_ACCESS = (
    "model_not_found",
    "does not exist or you do not have access",
    "does not have access to model",
    "permission_error",
    "permission denied",
)
_NO_QUOTA = (
    "insufficient_quota",
    "exceeded your current quota",
    "credit balance is too low",
    "billing hard limit",
)

# Gateway 402. Matched on the STATUS CODE, unlike everything else in this module.
#
# The rule at the top of this file ("match on the body, not just the status") exists
# because 404 and 429 are each two different problems wearing one number — a 404 is
# also a wrong base_url, a 429 is also plain rate limiting. 402 Payment Required has
# no second meaning, so the code IS the diagnosis, and matching on it means we never
# have to guess how the gateway words its body (or re-guess when it rewords it).
_NO_CREDIT_STATUS = 402
_NO_CREDIT_TEXT = ("insufficient balance", "insufficient_balance", "payment required")

# MODULE-LEVEL and interpolation-free on purpose. The caller has to tell "is this the
# out-of-credit failure?" so it can offer a top-up button, and the only two ways to
# answer that are this constant's identity or a substring match on the sentence below.
# A substring match makes the wording a silent contract: reword it and `error_kind`
# quietly stops being set, with no test going red. `friendly is NO_CREDIT` cannot rot.
NO_CREDIT = (
    "Your Qumge balance is empty — add credit to keep going. "
    "The amount and the top-up link are in the account row at the bottom of the sidebar."
)


def _is_qumge_model(model: str) -> bool:
    """Mirrors the GUI's `isQumgeModel` (useQumgeAccount.ts): a prefix test, not a
    substring or provider-list lookup — this router's convention is that a bare id
    ("gpt-5.6-sol") belongs to OpenAI and every Qumge-routed id carries the "qumge:"
    prefix. NO_CREDIT names Qumge by name and points at Qumge's sidebar account row,
    so a 402 from a BYO-key provider (corporate proxy, metered relay) must NOT be
    read through it — that would tell the user their Qumge balance is empty and send
    them to a sidebar row that, being signed out, shows them nothing."""
    return model.startswith("qumge:")


def friendly_model_error(model: str, exc: Exception) -> Optional[str]:
    """One actionable sentence for "your account can't use this model" failures, or None."""
    text = str(exc).lower()
    no_access = (
        f"Your account doesn't have access to {model} — new models can roll out "
        "gradually or require a plan upgrade. Pick a different model, or check "
        "the provider's console for availability."
    )
    if _is_qumge_model(model):
        if getattr(exc, "status_code", None) == _NO_CREDIT_STATUS:
            return NO_CREDIT
        if any(marker in text for marker in _NO_CREDIT_TEXT):
            return NO_CREDIT
    if any(marker in text for marker in _NO_QUOTA):
        return (
            f"Your account is out of quota for {model} — add credits or raise the limit "
            "in the provider's billing console, or pick a different model."
        )
    if any(marker in text for marker in _NO_ACCESS):
        return no_access
    # Anthropic's 404 body is just "model: <id>" under type not_found_error; require both
    # halves so unrelated 404s (bad base_url, deleted resource) keep their raw message.
    if "not_found_error" in text and f"model: {model.split(':')[-1].lower()}" in text:
        return no_access
    return None


def no_credit_topup_url(exc: Exception) -> Optional[str]:
    """Pull the top-up link out of a Qumge no-credit (402) response body:
    `{"error": {...}, "topup_url": "https://...", "docs_url": "https://..."}`.

    THE TRAP: the OpenAI SDK's `APIStatusError.body` is the UNWRAPPED `error`
    sub-object (`{"code": ..., "message": ...}`) — `topup_url` is a sibling of
    `error`, not inside it, so `.body` never has it. The only place the full
    body survives is `exc.response.json()`. Reach for `.body` here and this
    silently returns None forever, tests included, since a hand-built
    exception can't reproduce an SDK behavior it doesn't call.

    Fully guarded: `response` can be absent (a non-HTTP or hand-built
    exception), `.json()` can raise on a non-JSON body, and the key can be
    missing — any of those is just "no link", not a bug. The result also has
    to be a plausible http(s) URL: this ends up in `openExternal`, so a
    hostile or malformed body (`javascript:...`, a bare string, `null`) must
    not come back as something clickable.

    NOT gated on the model — unlike `friendly_model_error`, the caller here
    already knows this is a Qumge 402 before it asks for the link.
    """
    response = getattr(exc, "response", None)
    if response is None:
        return None
    try:
        body = response.json()
    except Exception:
        return None
    if not isinstance(body, dict):
        return None
    url = body.get("topup_url")
    if not isinstance(url, str):
        return None
    parsed = urlparse(url)
    if parsed.scheme not in ("http", "https") or not parsed.netloc:
        return None
    return url
