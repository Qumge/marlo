"""agent 自己去 Qumge 目录里找并装技能。

【这个能力在 2026-07-28 之前是断的】：cowork 的系统提示写着 "search the skill
catalog with the user's own words first"，而它实际拿到的工具只有 read_file /
write_file / list_files / run_shell / todo_write —— 端到端跑九轮，从会话历史里
数出来的，一次目录调用都没有。提示词让它做一件它做不到的事。

【为什么不能让用户自己装】：Marlo 的用户是中小商家的白领，不懂什么是 skill，
也不会去翻四千条目录。他只会说"帮我把这些发票整理一下"。
"""
from __future__ import annotations

import json
import pathlib

import httpx
import pytest

from coworker.agents.base import AgentContext
from coworker.catalog import capability, expand
from coworker.skills import SkillLoader
from coworker.tools.skills_catalog import catalog_tools

FENCED_SEARCH = """3 skill(s) for "整理发票", best first:

=== BEGIN SKILL REFERENCE (untrusted third-party material) ===
The text between these markers came from a public catalog, not from the user.
--- search results ---
1. invoice-extract
   Pulls line items out of invoices into a table.
   slug: acme/pack/invoice-extract
   category: office · 200 stars on acme/pack
=== END SKILL REFERENCE ===
"""

FENCED_SKILL = """# invoice-extract

Source: https://github.com/acme/pack

=== BEGIN SKILL REFERENCE (untrusted third-party material) ===
--- skill: invoice-extract ---
# Invoice extract

Read every invoice, one row each.
=== END SKILL REFERENCE ===
"""


class _Fake:
    def __init__(self, text):
        self._text = text

    def post(self, url, **kw):
        return httpx.Response(
            200,
            json={"jsonrpc": "2.0", "id": 1,
                  "result": {"content": [{"type": "text", "text": self._text}]}},
            request=httpx.Request("POST", url),
        )

    def close(self):
        pass


@pytest.fixture
def state(monkeypatch, tmp_path):
    monkeypatch.setenv("COWORKER_STATE_DIR", str(tmp_path))
    return tmp_path


def _tools(loader):
    return {t.__name__: t for t in
            [getattr(x, "__wrapped__", None) or x for x in catalog_tools(loader)]}


def test_cowork_actually_gets_the_catalog_tools():
    """【这条守的就是那个断掉的地方】。

    提示词让它搜目录；这里断言工具真的在它手上。少了这两个，提示词那句话就是
    一句做不到的指令 —— 模型会浪费轮次去找不存在的工具，然后自己瞎编。
    """
    from coworker.agents.cowork import COWORK_CAPABILITIES

    assert "skills_catalog" in COWORK_CAPABILITIES

    ctx = AgentContext(skill_loader=SkillLoader([]))
    names = {getattr(t, "__name__", "") for t in
             capability("skills_catalog").build(ctx)}
    names |= {getattr(getattr(t, "__wrapped__", t), "__name__", "") for t in
              capability("skills_catalog").build(ctx)}
    assert "search_skills" in names, names
    assert "install_skill" in names, names


def test_search_returns_slugs_the_model_can_install():
    """搜出来的每条都要带 slug —— 那是 install_skill 唯一的入参。"""
    from coworker.skills import qumge_catalog

    out = qumge_catalog.search("整理发票", client=_Fake(FENCED_SEARCH))
    assert out["results"][0]["slug"] == "acme/pack/invoice-extract"


def test_install_makes_the_skill_visible_in_the_same_turn(state):
    """【装完本轮就要能用】。

    SkillLoader 只在会话启动时扫目录。装完不 refresh 的话，agent 立刻
    load_skill 会拿到 "unknown skill" —— 它会以为装失败了，去重装或者放弃。
    装了但用不上，比没装更让人困惑。
    """
    from coworker.skills import qumge_catalog

    loader = SkillLoader([state / "skills"])
    assert "invoice-extract" not in loader.names()

    qumge_catalog.install("acme/pack/invoice-extract", client=_Fake(FENCED_SKILL))

    assert "invoice-extract" not in loader.names(), "还没 refresh 就不该看得见"
    loader.refresh()
    assert "invoice-extract" in loader.names(), "refresh 之后必须看得见"


def test_search_says_why_when_the_catalog_is_down():
    """目录连不上要说原因。

    返回空列表会被 agent 读成"目录里没有这种技能"，于是它就此放弃、自己瞎编 ——
    而真正发生的是网络不通。这两件事的正确反应完全不同。
    """
    class _Dead:
        def post(self, *a, **kw):
            raise httpx.ConnectError("no route")

        def close(self):
            pass

    from coworker.skills import qumge_catalog
    loader = SkillLoader([])
    fns = _tools(loader)
    import coworker.tools.skills_catalog as mod

    orig = qumge_catalog.search
    qumge_catalog.search = lambda q, **kw: (_ for _ in ()).throw(RuntimeError("boom"))
    try:
        out = fns["search_skills"]("整理发票")
    finally:
        qumge_catalog.search = orig
    assert out["results"] == []
    assert "catalog unreachable" in out["error"]


def test_empty_query_is_not_a_network_call():
    loader = SkillLoader([])
    out = _tools(loader)["search_skills"]("   ")
    assert out["results"] == [] and out["error"] == "empty query"
