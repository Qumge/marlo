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


def test_qumge_matrix_and_compat_lists_are_in_lockstep():
    """matrix.py 和 manager.py 的两份 qumge 清单必须【一模一样】。

    matrix.py 的注释一直写着"keep the two lists in lockstep"，但拦着的只有能力那
    一半（上面那条）——【成员】那一半没有任何东西在看。于是 2026-08-03 修
    claude-opus-4-6 这个错 id 时，两处得靠人记得都改；漏一处的症状是模型能出现在
    选择器里、点下去却被网关拒，而两份清单看起来都"有这一条"。

    这条只查两份之间对不对得上，不出网。"这个 id 网关上到底存不存在"要问 qumge，
    在 packaging/check_model_matrix.py 里 —— CI 是 hermetic 的，不在这里做。
    """
    from coworker.providers.matrix import MATRIX

    in_matrix = {k[len("qumge:") :] for k in MATRIX if k.startswith("qumge:")}
    assert in_matrix == set(SessionManager.COMPAT_MODELS["qumge"])


def test_qumge_claude_and_gpt_models_get_vision_and_pdf():
    # Concrete sanity check alongside the property above: a Qumge-routed Claude/GPT model
    # must look exactly as capable as talking to Claude/GPT directly.
    assert capabilities_for("qumge:anthropic/claude-sonnet-4.6").vision is True
    assert capabilities_for("qumge:anthropic/claude-sonnet-4.6").pdf is True
    assert capabilities_for("qumge:openai/gpt-5.6-sol").vision is True
    assert capabilities_for("qumge:openai/gpt-5.6-sol").pdf is True


def test_qumge_default_model_is_actually_offered():
    """新用户连上 qumge 之后拿到的默认模型，必须在 COMPAT_MODELS 里。

    连接流程是：configure_provider 读 recommended_model -> 如果它在
    _suggested_models 里就 add_model 并设为默认。recommended_model 写了一个
    清单外的值，新用户连上之后【默认模型不会被设置】，composer 里空着 ——
    而这个失败是静默的：provider 配好了、界面没报错、就是发不出消息。

    2026-07-28 还有一个同形状的 bug 刚修：list_models 给出的 id 少了厂商段，
    网关直接 400。id 的形状只有真正要吃它的那端说了算。
    """
    from coworker.providers.registry import get_descriptor
    from coworker.server.manager import SessionManager

    rec = get_descriptor("qumge").recommended_model
    assert rec, "qumge 没有推荐模型 —— 新用户连上之后没有默认模型可用"
    assert rec in SessionManager.COMPAT_MODELS["qumge"], (
        f"推荐模型 {rec!r} 不在 COMPAT_MODELS['qumge'] 里，"
        f"新用户连上之后默认模型不会被设置"
    )


def test_qumge_default_is_the_cheap_tier():
    """默认档必须是便宜的那一档 —— 这是产品决定，不是随手挑的。

    Marlo 的用户是中小商家的白领，不会为了跑几件杂活选每 Mtok 五美元的模型。
    默认值就是绝大多数人实际用的那个。

    2026-07-28 实测（三件白领活各三轮）：deepseek-v4-flash 9/9、28 秒；
    claude-sonnet-5 7/9、62 秒（两轮把中文专名写成形近字）。便宜 21 倍而且更准。
    把默认改回贵档之前，先把那九轮重跑一遍。
    """
    from coworker.providers.registry import get_descriptor

    assert get_descriptor("qumge").recommended_model == "deepseek/deepseek-v4-flash"
