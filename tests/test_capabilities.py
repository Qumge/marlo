"""Qumge is a pass-through gateway: `qumge:<vendor>/<model-id>` must behave exactly like
the underlying model, capability-wise, as if it were reached through its own native
provider prefix. Before the fix, `capabilities_for` only recognized "anthropic"/"gemini"
as a bare provider prefix and matched OpenAI/compat vendors by NAME — "qumge" satisfied
neither, so every Qumge model silently fell to the conservative all-False default (see
`coworker/providers/capabilities.py`). That is a correctness bug with real UX fallout:
`coworker/engine.py` strips images to a placeholder and skips native PDF ingestion for
any model whose capabilities read `vision=False`/`pdf=False` — including models that can
plainly see.

This is written as a PROPERTY over `SessionManager.COMPAT_MODELS["qumge"]` rather than
four hardcoded literals so a fifth Qumge model added there later is checked automatically,
with no test edit required.
"""

from __future__ import annotations

from coworker.providers.capabilities import capabilities_for
from coworker.server.manager import SessionManager


def _native_id(compat_id: str) -> str:
    """The id this same model would be reached by through its OWN vendor's native
    provider prefix (not through Qumge) — e.g. "anthropic/claude-sonnet-4.6" (Qumge's
    catalog naming) -> "anthropic:claude-sonnet-4-6" would be the curated form, but we
    don't need to guess the curated matrix's exact spelling: `capabilities_for` resolves
    ANY "<provider>:<rest>" by provider-level heuristics when there's no exact matrix
    entry, so a straight "/" -> ":" swap (OpenAI's bare/unprefixed convention aside)
    reaches the same capability decision the real native id would.
    """
    vendor, _, rest = compat_id.partition("/")
    return rest if vendor == "openai" else f"{vendor}:{rest}"


def test_qumge_models_match_native_capabilities():
    for compat_id in SessionManager.COMPAT_MODELS["qumge"]:
        qumge_caps = capabilities_for(f"qumge:{compat_id}")
        native_caps = capabilities_for(_native_id(compat_id))
        assert qumge_caps.vision == native_caps.vision, (
            f"{compat_id}: vision {qumge_caps.vision} != native {native_caps.vision}"
        )
        assert qumge_caps.pdf == native_caps.pdf, (
            f"{compat_id}: pdf {qumge_caps.pdf} != native {native_caps.pdf}"
        )
        assert (
            qumge_caps.parallel_tool_calls == native_caps.parallel_tool_calls
        ), (
            f"{compat_id}: parallel_tool_calls {qumge_caps.parallel_tool_calls} "
            f"!= native {native_caps.parallel_tool_calls}"
        )


def test_qumge_claude_and_gpt_models_get_vision_and_pdf():
    # Concrete sanity check alongside the property above: a Qumge-routed Claude/GPT model
    # must look exactly as capable as talking to Claude/GPT directly.
    assert capabilities_for("qumge:anthropic/claude-sonnet-4.6").vision is True
    assert capabilities_for("qumge:anthropic/claude-sonnet-4.6").pdf is True
    assert capabilities_for("qumge:openai/gpt-5.6-sol").vision is True
    assert capabilities_for("qumge:openai/gpt-5.6-sol").pdf is True
