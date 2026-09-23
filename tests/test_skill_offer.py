"""Marlo 缺一个技能时，先问用户「要不要装」—— 而不是悄悄装上（owner 2026-09-23）。

用户平时只是跟 Marlo 说话；只有需要授权的时候才点一下。装一个技能 = 给 Marlo 一项
新能力，这是用户的决定：卡片（或者一句「装吧」）就是那次授权。

这里钉住引擎这一侧的规矩：
- 同意了才真的去装（执行的是已注册的 install_skill 本体，装完刷新 loader 那套不变）
- 拒绝是正常结局：不装、告诉模型别再问、这一个对话里同一个技能不再弹卡
- 已经装过的不弹卡
- 没接 offerer 的场景（TUI、测试）照旧直接装
"""

from __future__ import annotations

import asyncio
import json

import pytest

from coworker.engine import EventType, TurnEngine
from coworker.permissions import Mode, PermissionEngine
from coworker.providers import AssistantTurn, ModelCapabilities, ProviderClient, ToolCall
from coworker.server.manager import SessionManager
from coworker.tools import ToolRegistry

import aisuite as ai


class _Scripted(ProviderClient):
    """Calls the given tool calls one per turn, then says done."""

    def __init__(self, calls):
        self.turn, self.calls = 0, calls

    def complete(self, *, model, messages, tools=None, **settings):
        self.turn += 1
        if self.turn <= len(self.calls):
            name, args = self.calls[self.turn - 1]
            return AssistantTurn(
                text="", tool_calls=[ToolCall(id=f"t{self.turn}", name=name, arguments=args)]
            )
        return AssistantTurn(text="done", tool_calls=[])

    def capabilities(self, model):
        return ModelCapabilities(tools=True)


def _registry(installed: list):
    def install_skill(slug: str, title: str = "", why: str = "") -> dict:
        """Install a skill."""
        installed.append(slug)
        return {"ok": True, "name": slug.rsplit("/", 1)[-1]}

    reg = ToolRegistry()
    reg.register(
        ai.tool(
            install_skill,
            metadata=ai.ToolMetadata(category="skills", risk_level="low", capabilities=["install_skill"]),
        )
    )
    return reg


PPT = {"slug": "anthropics/skills/pptx", "title": "PPT 制作", "why": "把内容排成一份季度汇报 PPT"}


def _engine(tmp_path, offerer, calls, installed):
    return TurnEngine(
        provider=_Scripted(calls),
        registry=_registry(installed),
        permissions=PermissionEngine(workspace_root=tmp_path, mode=Mode.BYPASS_APPROVALS),
        model="m",
        skill_offerer=offerer,
    )


async def _run(engine):
    return [e async for e in engine.run("帮我做一个季度汇报的PPT")]


def _results(engine):
    return [m for m in engine.messages if m.get("role") == "tool"]


@pytest.mark.asyncio
async def test_the_user_is_asked_first_and_yes_installs(tmp_path):
    installed: list = []
    seen = {}

    async def offerer(args, tool_call_id=None):
        seen.update(args)
        return {"approved": True}

    eng = _engine(tmp_path, offerer, [("install_skill", PPT)], installed)
    events = await _run(eng)
    offer = [e for e in events if e.type is EventType.SKILL_OFFERED]
    # Even in the most hands-off mode the card still comes: installing is consent.
    assert offer and offer[0].data["title"] == "PPT 制作" and offer[0].data["why"].startswith("把内容")
    assert offer[0].data["slug"] == "anthropics/skills/pptx"
    assert installed == ["anthropics/skills/pptx"]
    assert '"ok": true' in _results(eng)[0]["content"]


@pytest.mark.asyncio
async def test_no_is_a_plain_outcome_and_is_not_asked_again(tmp_path):
    installed: list = []
    asked = []

    async def offerer(args, tool_call_id=None):
        asked.append(args["slug"])
        return {"approved": False}

    eng = _engine(tmp_path, offerer, [("install_skill", PPT), ("install_skill", PPT)], installed)
    events = await _run(eng)
    assert installed == []
    assert asked == ["anthropics/skills/pptx"]  # the second ask never reached the user
    assert len([e for e in events if e.type is EventType.SKILL_OFFERED]) == 1
    first, second = _results(eng)
    assert "declined" in first["content"] and "say plainly" in first["content"]
    assert "already declined" in second["content"]


@pytest.mark.asyncio
async def test_what_the_user_said_instead_reaches_the_model(tmp_path):
    """「有没有更简单的办法？」不是是也不是否：卡片按「没装」收掉，原话交给模型。"""

    async def offerer(args, tool_call_id=None):
        return {"approved": False, "feedback": "有没有更简单的办法？"}

    eng = _engine(tmp_path, offerer, [("install_skill", PPT)], [])
    await _run(eng)
    content = json.loads(_results(eng)[0]["content"])
    assert content["user_said"] == "有没有更简单的办法？" and content["installed"] is False


@pytest.mark.asyncio
async def test_an_installed_skill_is_not_offered(tmp_path):
    installed: list = []

    async def offerer(args, tool_call_id=None):  # pragma: no cover - must not be called
        raise AssertionError("asked about a skill that is already installed")

    offerer.installed = lambda slug: "pptx"  # type: ignore[attr-defined]
    eng = _engine(tmp_path, offerer, [("install_skill", PPT)], installed)
    events = await _run(eng)
    assert not [e for e in events if e.type is EventType.SKILL_OFFERED]
    assert installed == []
    assert "already_installed" in _results(eng)[0]["content"]
    assert "load_skill" in _results(eng)[0]["content"]


@pytest.mark.asyncio
async def test_without_an_offerer_the_tool_installs_directly(tmp_path):
    installed: list = []
    eng = _engine(tmp_path, None, [("install_skill", PPT)], installed)
    events = await _run(eng)
    assert not [e for e in events if e.type is EventType.SKILL_OFFERED]
    assert installed == ["anthropics/skills/pptx"]


# -- the manager's Inbox-backed offerer (background turns, and the live card's durable twin) --


@pytest.fixture
def manager(tmp_path, monkeypatch):
    monkeypatch.setenv("COWORKER_STATE_DIR", str(tmp_path / "state"))
    ws = tmp_path / "repo"
    ws.mkdir()
    yield SessionManager(data_dir=tmp_path / "data", workspace=str(ws))


@pytest.mark.asyncio
async def test_the_offer_parks_in_the_inbox_and_the_answer_comes_back(manager):
    offer = manager.inbox_skill_offerer("s1", "cowork")
    task = asyncio.create_task(offer(dict(PPT), "t1"))
    pending = []
    for _ in range(50):
        await asyncio.sleep(0.02)
        pending = manager.inbox.list(session_id="s1", state="pending")
        if pending:
            break
    assert pending, "the offer never reached the Inbox"
    item = pending[0]
    assert item.kind == "tool"
    assert item.data["skill"] == "anthropics/skills/pptx" and item.data["title"] == "PPT 制作"
    assert item.body == "把内容排成一份季度汇报 PPT"
    manager.inbox.resolve(item.id, '{"approved": true}')
    assert (await task)["approved"] is True


@pytest.mark.asyncio
async def test_a_typed_reply_rides_back_as_feedback(manager):
    offer = manager.inbox_skill_offerer("s1", "cowork")
    task = asyncio.create_task(offer(dict(PPT), "t1"))
    for _ in range(50):
        await asyncio.sleep(0.02)
        pending = manager.inbox.list(session_id="s1", state="pending")
        if pending:
            break
    manager.inbox.resolve(pending[0].id, '{"approved": false, "feedback": "先用简单的"}')
    result = await task
    assert result == {"approved": False, "feedback": "先用简单的"}


def test_the_catalog_tool_asks_for_words_the_user_understands():
    """模型给卡片写标题和理由 —— 目录里的名字（xlsx / pptx）和英文简介用户看不懂。"""
    from coworker.tools.skills_catalog import catalog_tools

    class _Loader:
        def refresh(self):
            pass

    tools = {t.__name__: t for t in catalog_tools(_Loader())}
    import inspect

    params = inspect.signature(tools["install_skill"]).parameters
    assert {"slug", "title", "why"} <= set(params)
    doc = tools["install_skill"].__doc__ or ""
    assert "Install without asking" not in doc
    assert "write_docx" in doc and "write_xlsx" in doc  # don't offer what Marlo already does
