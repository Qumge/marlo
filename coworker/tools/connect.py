"""`request_connector` —— 在对话里要一个账号的授权。

连接器页不是主路径。一般用户在聊天里一步步推进，推到需要他的邮箱或某个服务
时，Marlo 该【就地】要，而不是让他自己走到设置页去找一个开关。

和 request_directory 一样，这个工具会被 TurnEngine 拦截：发出
CONNECTOR_REQUESTED 事件，等用户在卡片上决定，然后把结果作为工具返回值交回
agent。这里的函数体只是 schema 的载体 + 没接 requester 时的兜底。

形状刻意与 request_directory 一致：那条路已经跑通、前端有卡片，一致意味着
卡片能照抄，也意味着后面"技能声明它需要什么连接"不用再发明第三种机制。

【连接器名字来自允许集，不是模型自由输入】：模型会编名字，编出来的会变成一张
"授权 xyz"的卡片摆在用户面前。用户不知道 xyz 是什么，但他会以为是我们要的 ——
那比一个工具报错糟得多。
"""

from __future__ import annotations

from typing import Any

from aisuite.agents import ToolMetadata, tool


def request_connector_tool(available: list[str]) -> Any:
    # 排序 + 去重：schema 进模型的提示词，顺序不稳会让缓存失效，重复项是噪声。
    names = sorted(set(available))

    def request_connector(connector: str, reason: str = "") -> dict:
        """Ask the user to connect one of their accounts, right here in the conversation.
        Use this the moment you need something you cannot reach — their mailbox, their
        calendar, a service a skill depends on. Say in `reason`, in one plain sentence,
        what you will do with it. Never tell the user to go and find a settings page:
        ask here, and carry on once they say yes.
        """
        if connector not in names:
            return {"connected": False, "error": f"unknown connector: {connector}"}
        # 真正的处理在 engine 里（要一次 GUI 的往返）。这里只在没接 requester
        # 的 surface 上跑到 —— 必须报错，不能返回 connected=True 让 agent 以为
        # 连上了，然后去调一个没有凭据的 API。
        return {
            "connected": False,
            "error": "connector requests aren't available in this surface",
        }

    t = tool(
        request_connector,
        metadata=ToolMetadata(
            category="connect",
            risk_level="low",
            capabilities=["request_connector"],
            description=(
                "Ask the user to connect one of their accounts, in the conversation, "
                "the moment you need something you cannot reach."
            ),
        ),
    )
    # 显式 schema：enum 把允许集写死，模型在生成时就被挡住，而不是靠运行时兜底。
    t.__coworker_schema__ = {
        "type": "function",
        "function": {
            "name": "request_connector",
            "description": (
                "Ask the user to connect one of their accounts, right here in the "
                "conversation. Use this the moment you need something you cannot reach. "
                "Do not tell the user to go and find a settings page."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "connector": {
                        "type": "string",
                        "enum": names,
                        "description": "Which account to ask for.",
                    },
                    "reason": {
                        "type": "string",
                        "description": "One plain sentence: what you will do with it.",
                    },
                },
                "required": ["connector", "reason"],
            },
        },
    }
    return t
