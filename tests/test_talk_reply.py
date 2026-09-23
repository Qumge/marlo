"""用话回答卡片（owner 2026-09-23）：卡片等着时用户说的话能当回答 —— 这里钉住服务端这一侧。

- 审批事件带 tap_only：删了 / 付了就收不回来的操作，必须点按钮（语音偶尔会听错）
- 用户没说是也没说否（「把第二段改一下再发」）：卡片按「不同意」收掉，原话跟着这次
  拒绝一起回到模型手里 —— 服务端在 Marlo 运行中会拒收新消息，所以话必须搭这一趟车
"""

from __future__ import annotations

import json

import pytest

from coworker.engine import ApprovalOutcome, EventType, TurnEngine
from coworker.permissions import Mode, PermissionEngine
from coworker.providers import AssistantTurn, ModelCapabilities, ProviderClient, ToolCall
from coworker.talk import needs_tap
from coworker.tools import ToolRegistry

import aisuite as ai


@pytest.mark.parametrize(
    "name,args",
    [
        ("run_shell", {"command": "rm -rf 报销/2025"}),
        ("run_shell", {"command": "cd x && rm old.txt"}),
        ("run_shell", {"command": "git reset --hard HEAD~3"}),
        ("run_shell", {"command": "git push --force origin main"}),
        ("gmail_delete_message", {"id": "1"}),
        ("drive_trash_file", {"id": "1"}),
        ("calendar_delete_event", {"id": "1"}),
        ("stripe_create_refund", {"charge": "ch_1"}),
        ("stripe_create_payout", {}),
        ("mcp__bank__transfer_funds", {}),
    ],
)
def test_irreversible_actions_need_a_tap(name, args):
    assert needs_tap(name, args) is True


@pytest.mark.parametrize(
    "name,args",
    [
        ("send_message", {"text": "hi"}),
        ("gmail_send", {"to": "a@b.c"}),
        ("write_file", {"path": "a.md"}),
        ("run_shell", {"command": "ls -la"}),
        ("run_shell", {"command": "python report.py --format=docx"}),
        ("run_shell", {"command": "echo 'confirm the transfer later' > note.txt"}),
        ("calendar_create_event", {}),
    ],
)
def test_everything_else_can_be_answered_by_voice(name, args):
    assert needs_tap(name, args) is False


def test_a_human_only_floor_always_needs_a_tap():
    assert needs_tap("write_file", {"path": ".git/hooks/pre-commit"}, human_only=True) is True


# -- the engine side ---------------------------------------------------------------------


class _Scripted(ProviderClient):
    def __init__(self, name, args):
        self.turn, self.name, self.args = 0, name, args

    def complete(self, *, model, messages, tools=None, **settings):
        self.turn += 1
        if self.turn == 1:
            return AssistantTurn(text="", tool_calls=[ToolCall(id="t1", name=self.name, arguments=self.args)])
        return AssistantTurn(text="done", tool_calls=[])

    def capabilities(self, model):
        return ModelCapabilities(tools=True)


def _registry():
    def send_message(text: str) -> dict:
        """Send a message."""
        return {"ok": True}

    def run_shell(command: str) -> dict:
        """Run a command."""
        return {"ok": True}

    reg = ToolRegistry()
    for fn in (send_message, run_shell):
        reg.register(
            ai.tool(fn, metadata=ai.ToolMetadata(category="messaging", risk_level="high", capabilities=[fn.__name__]))
        )
    return reg


def _engine(tmp_path, name, args, approver):
    return TurnEngine(
        provider=_Scripted(name, args),
        registry=_registry(),
        permissions=PermissionEngine(workspace_root=tmp_path, mode=Mode.INTERACTIVE),
        model="m",
        approver=approver,
    )


@pytest.mark.asyncio
async def test_the_card_event_says_whether_a_tap_is_needed(tmp_path):
    async def deny(request):
        return ApprovalOutcome.DENY

    eng = _engine(tmp_path, "run_shell", {"command": "rm -rf old"}, deny)
    events = [e async for e in eng.run("clean up")]
    card = next(e for e in events if e.type is EventType.PERMISSION_REQUIRED)
    assert card.data["tap_only"] is True

    eng = _engine(tmp_path, "run_shell", {"command": "python make_report.py"}, deny)
    events = [e async for e in eng.run("make the report")]
    card = next(e for e in events if e.type is EventType.PERMISSION_REQUIRED)
    assert card.data["tap_only"] is False


@pytest.mark.asyncio
async def test_what_the_user_said_rides_back_with_the_denial(tmp_path):
    holder = {}

    async def deny_with_words(request):
        # The server hands the words to the engine just before resolving the card.
        holder["eng"].set_user_reply("把第二段改一下再发")
        return ApprovalOutcome.DENY

    eng = _engine(tmp_path, "run_shell", {"command": "python send_draft.py"}, deny_with_words)
    holder["eng"] = eng
    [e async for e in eng.run("send it")]
    result = next(m for m in eng.messages if m.get("role") == "tool")
    body = json.loads(result["content"]) if result["content"].startswith("{") else result["content"]
    text = json.dumps(body, ensure_ascii=False)
    assert "把第二段改一下再发" in text
    # One reply, one card: it never leaks into the next denial.
    assert eng._user_reply is None


@pytest.mark.asyncio
async def test_a_plain_denial_carries_no_words(tmp_path):
    async def deny(request):
        return ApprovalOutcome.DENY

    eng = _engine(tmp_path, "run_shell", {"command": "python send_draft.py"}, deny)
    [e async for e in eng.run("send it")]
    result = next(m for m in eng.messages if m.get("role") == "tool")
    assert "user_said" not in result["content"]
