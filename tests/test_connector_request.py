"""在对话里要一个账号的授权。

连接器页不是主路径 —— 一般用户在聊天里一步步推进，推到需要他的邮箱或某个
服务时，Marlo 该【就地】要，而不是让他自己走到设置页去找一个开关。

形状照抄 request_directory：事件 → 用户在卡片上决定 → 结果回到工具。那条路
已经跑通并且前端有卡片，一致意味着卡片能照抄，也意味着后面"技能声明它需要
什么连接"不用再发明第三种机制。

断言的重点在【不该发生什么】：模型编出来的连接器名字不能变成一张卡片摆在
用户面前，没有 requester 时工具不能假装成功。
"""
from __future__ import annotations

from coworker.events import EventType
from coworker.tools.connect import request_connector_tool


def _fn(t):
    """从 aisuite 的 tool 包装里取回可调用的函数体。"""
    return getattr(t, "__wrapped__", t)


def test_the_event_type_exists_and_matches_the_directory_shape():
    # 前端按字符串分支，两处必须逐字一致。
    assert EventType.CONNECTOR_REQUESTED.value == "connector_requested"


def test_an_unknown_connector_is_an_error_not_a_prompt():
    # 模型会编名字。编出来的会变成一张"授权 xyz"的卡片摆在用户面前 ——
    # 那比工具报错糟得多：用户不知道 xyz 是什么，但他会以为是我们要的。
    out = _fn(request_connector_tool(["gmail", "outlook"]))("xyz", "because")
    assert "error" in out
    assert "xyz" in out["error"]


def test_a_known_connector_without_a_requester_fails_loudly():
    # 没接 requester 的场景（无头 surface）必须报错，不能返回 connected=True
    # 让 agent 以为连上了然后去调一个没有凭据的 API。
    out = _fn(request_connector_tool(["gmail"]))("gmail", "read your mail")
    assert out["connected"] is False
    assert out["error"]


def test_the_schema_pins_the_connector_names():
    # 允许集写进 schema，模型在生成时就被挡住，而不是靠运行时兜底。
    t = request_connector_tool(["gmail", "outlook"])
    props = t.__coworker_schema__["function"]["parameters"]["properties"]
    assert props["connector"]["enum"] == ["gmail", "outlook"]
    assert "reason" in t.__coworker_schema__["function"]["parameters"]["required"]


def test_the_name_list_is_sorted_and_deduped():
    # schema 进模型的提示词，顺序不稳会让缓存失效；重复项是喂给模型的噪声。
    t = request_connector_tool(["outlook", "gmail", "gmail"])
    assert t.__coworker_schema__["function"]["parameters"]["properties"]["connector"]["enum"] == [
        "gmail",
        "outlook",
    ]


# -- 接线 ---------------------------------------------------------------------
# 注册一个没人组装的能力，等于没有这个能力。documents 那次就是这么漏的：
# catalog 里加了，工厂没组装，工具在 agent 手里根本不存在。

def test_marlo_actually_gets_the_tool(tmp_path):
    from coworker.agents.base import AgentContext
    from coworker.agents.cowork import cowork_tool_factory

    names = {
        getattr(t, "__name__", "") for t in cowork_tool_factory(AgentContext(workspace=str(tmp_path)))
    }
    assert "request_connector" in names


def test_the_offered_names_are_real_connectors(tmp_path):
    # enum 必须来自真实目录，不能是手抄的一串字符串——手抄的会和 descriptors.py
    # 漂移，然后模型点名一个已经改名的连接器。
    from coworker.agents.base import AgentContext
    from coworker.agents.cowork import cowork_tool_factory
    from coworker.connectors.descriptors import DESCRIPTORS

    tools = {getattr(t, "__name__", ""): t for t in cowork_tool_factory(AgentContext(workspace=str(tmp_path)))}
    enum = tools["request_connector"].__coworker_schema__["function"]["parameters"]["properties"][
        "connector"
    ]["enum"]
    real = {d.name for d in DESCRIPTORS}
    assert enum, "允许集不能是空的"
    assert set(enum) <= real, f"不在目录里的名字: {set(enum) - real}"


def test_the_code_persona_does_not_get_it(tmp_path):
    # 本计划只影响 Marlo。开发者角色不需要在对话里要邮箱。
    from coworker.agents.base import AgentContext
    from coworker.agents.code import code_agent

    names = {
        getattr(t, "__name__", "")
        for t in code_agent().tool_factory(AgentContext(workspace=str(tmp_path)))
    }
    assert "request_connector" not in names


# -- engine 侧：两次等待 -------------------------------------------------------

import asyncio

import pytest

from coworker.engine import TurnEngine


class _Call:
    """最小的 ToolCall 替身。"""

    def __init__(self, connector="gmail", reason="read your mail"):
        self.id = "tc1"
        self.name = "request_connector"
        self.arguments = {"connector": connector, "reason": reason}


async def _drain(engine, call):
    return [e async for e in engine._handle_connector_request(call)]


def test_without_a_requester_it_reports_failure_not_success():
    # 无头 surface（自动化、后台唤醒）没有人能点浏览器。这时候必须报错——
    # 返回 connected=True 会让 agent 去调一个没有凭据的 API。
    eng = TurnEngine.__new__(TurnEngine)
    eng.connector_requester = None
    eng.messages = []
    eng._audit = lambda *a, **k: None

    events = asyncio.run(_drain(eng, _Call()))
    kinds = [e.type.value for e in events]
    assert "connector_requested" not in kinds, "没人能应答时不该弹卡片"
    assert kinds[-1] == "tool_finished"
    assert events[-1].data["status"] == "denied"


def test_it_emits_the_card_before_waiting():
    # 顺序要紧：先发完整卡片（界面画出 title / user_code），再等。
    # 卡片经 requester._card_queue 进 engine 事件流。
    import asyncio as _asyncio

    seen = []
    card_q: _asyncio.Queue = _asyncio.Queue()

    async def requester(args, tool_call_id=None):
        await card_q.put(
            {
                "connector": "gmail",
                "title": "Gmail",
                "reason": "read your mail",
                "brokered_by": "OpenWorker Cloud",
                "user_code": "",
            }
        )
        seen.append("waited")
        return {"connected": True}

    requester._card_queue = card_q  # type: ignore[attr-defined]

    eng = TurnEngine.__new__(TurnEngine)
    eng.connector_requester = requester
    eng.messages = []
    eng._audit = lambda *a, **k: None

    async def _interruptible(coro, interrupted=None):
        return await coro

    eng._interruptible = _interruptible

    events = asyncio.run(_drain(eng, _Call()))
    assert events[0].type.value == "connector_requested"
    assert events[0].data["connector"] == "gmail"
    assert events[0].data["title"] == "Gmail"
    assert events[0].data["brokered_by"] == "OpenWorker Cloud"
    assert seen == ["waited"]
    assert events[-1].data["status"] == "ok"


def test_manual_only_connector_does_not_emit_a_card():
    # email / API token 等没有一键路径：不该弹 Connect 卡片，只回 tool 结果。
    async def requester(args, tool_call_id=None):
        return {
            "connected": False,
            "needs_manual_setup": True,
            "error": "Email (IMAP) has no one-click sign-in in chat",
        }

    requester._card_queue = asyncio.Queue()  # type: ignore[attr-defined]

    eng = TurnEngine.__new__(TurnEngine)
    eng.connector_requester = requester
    eng.messages = []
    eng._audit = lambda *a, **k: None

    async def _interruptible(coro, interrupted=None):
        return await coro

    eng._interruptible = _interruptible

    events = asyncio.run(_drain(eng, _Call(connector="email")))
    kinds = [e.type.value for e in events]
    assert "connector_requested" not in kinds
    assert kinds[-1] == "tool_finished"
    assert events[-1].data["status"] == "denied"
    assert any("needs_manual_setup" in str(m) or "no one-click" in str(m) for m in eng.messages)


def test_a_decline_is_denied_not_an_error():
    # 用户说不要，是一个正常结果。agent 该换条路，而不是把它当故障重试。
    async def requester(args, tool_call_id=None):
        return {"connected": False, "reason": "the user declined the request"}

    eng = TurnEngine.__new__(TurnEngine)
    eng.connector_requester = requester
    eng.messages = []
    eng._audit = lambda *a, **k: None

    async def _interruptible(coro, interrupted=None):
        return await coro

    eng._interruptible = _interruptible

    events = asyncio.run(_drain(eng, _Call()))
    assert events[-1].data["status"] == "denied"
    # 工具结果进了消息历史，agent 读得到原因
    assert any("declined" in str(m) for m in eng.messages)


def test_requester_exception_still_writes_a_tool_result():
    """搬家漏注入 → NameError。异常不能吃掉 tool 结果，否则下一轮 OpenAI 400。"""

    async def requester(args, tool_call_id=None):
        raise NameError("_route is not defined")

    eng = TurnEngine.__new__(TurnEngine)
    eng.connector_requester = requester
    eng.messages = []
    eng._audit = lambda *a, **k: None

    async def _interruptible(coro, interrupted=None):
        return await coro

    eng._interruptible = _interruptible

    events = asyncio.run(_drain(eng, _Call()))
    assert events[-1].type.value == "tool_finished"
    assert events[-1].data["status"] == "denied"
    tool_msgs = [m for m in eng.messages if m.get("role") == "tool"]
    assert len(tool_msgs) == 1
    assert tool_msgs[0]["tool_call_id"] == "tc1"
    assert "NameError" in tool_msgs[0]["content"] or "_route" in tool_msgs[0]["content"]
