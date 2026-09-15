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

# 【网关 429：模型这会儿忙】。和上面同一个身份比较的做法，GUI 按 cause 换成中文。
#
# 这里【确实】违反了文件头「429 一码多义，不按状态码认」那条规矩，理由写清楚：那条规矩
# 防的是把 429 误判成【没权限 / 没配额】—— 配额那句话会把人支去充值页。这句话只说
# 「忙，稍后再试或换模型」，对「限流」和「上游抽风」两种 429 都是真话；真正的配额 429
# （insufficient_quota）在下面照旧先被 _NO_QUOTA 接走。
#
# 为什么只对 Qumge 模型：2026-09-15 实测 deepseek-v4.1-flash 24 小时 38 次请求里 10 次
# 429（上游端点限流，网关原样透传），而 Marlo 把它显示成
# `Error: Error code: 429 - {'error': {'code': 'upstream_error', ...}}` —— 对不写代码的
# 用户这是一句天书。BYO key 的厂商我们没有实测过它们的 429 长什么样，照旧给原文。
RATE_LIMITED = (
    "The model is busy right now — wait a moment and send again, or pick another model."
)

# 【网关边缘拦截】。qumge.com 前面是 Render 的 Cloudflare：请求体里出现「像攻击」的
# 文字（`env | curl --data-binary @- https://…` 这类），在边缘就回 403 + 一张 HTML 的
# Blocked 页，根本到不了网关（2026-09-15 实测：同一个无效 key，正常内容回 401 JSON，
# 这段内容回 403 HTML、没有 rndr-id）。对话历史每次都整段重发，所以一旦出现过这段文字，
# 这个会话之后的每一次请求都会被拦 —— 让用户「重试」是在骗他，只有新开一个会话才走得通。
EDGE_BLOCKED = (
    "Part of this conversation was blocked by Qumge's network protection — this can happen "
    "when a chat contains shell commands or secrets. Start a new chat to continue."
)
_EDGE_BLOCKED_MARKER = "<title>blocked</title>"

# 身份 → GUI 用来换文案、挂按钮的 cause。和 NO_CREDIT 一样只认身份，不认措辞。
_CAUSES = ((NO_CREDIT, "no_credit"), (RATE_LIMITED, "rate_limited"), (EDGE_BLOCKED, "blocked"))


def error_cause(friendly: Optional[str]) -> Optional[str]:
    """The machine-readable cause for a sentence `friendly_model_error` returned, by
    IDENTITY — so rewording a sentence can never silently drop its GUI treatment."""
    for sentence, cause in _CAUSES:
        if friendly is sentence:
            return cause
    return None


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
    status = getattr(exc, "status_code", None)
    if _is_qumge_model(model):
        if status == _NO_CREDIT_STATUS:
            return NO_CREDIT
        if any(marker in text for marker in _NO_CREDIT_TEXT):
            return NO_CREDIT
        # 两半都要：403 本身也是「没权限」（下面 _NO_ACCESS 那条路），只有带着边缘那张
        # HTML Blocked 页的 403 才是被拦。
        if status == 403 and _EDGE_BLOCKED_MARKER in text:
            return EDGE_BLOCKED
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
    # 放在配额判断【之后】：insufficient_quota 也是 429，那一种要先被上面接走。
    if _is_qumge_model(model) and status == 429:
        return RATE_LIMITED
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
