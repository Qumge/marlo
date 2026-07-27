"""开场问句 —— 以及模型知不知道自己问过什么。

界面上的开场白一直是纯前端组件（SessionIntro），从不调模型。所以要改的不是
"别调模型"，是让模型在收到"产品软广视频"这四个字时，知道这是在回答什么。

今天的设计里，任务卡通过 onPrefill 把一整句自洽的提示词填进输入框，模型收到
的是完整的一句话。换成开放提问之后，用户的第一句回答离开那个问题就没有意义。
"""
from __future__ import annotations

from coworker.agents.cowork import COWORK_INSTRUCTIONS


def test_the_persona_knows_it_opened_with_a_question():
    # 没有这一行，用户的第一句回答就是一段无上下文的碎片。
    lowered = COWORK_INSTRUCTIONS.lower()
    assert "opened" in lowered or "first message" in lowered
    assert "reply" in lowered or "answer" in lowered


def test_it_describes_the_question_without_quoting_it():
    # 复述界面原文会和 i18n 漂移：文案改了、提示词没改，模型就在讲另一个问题。
    # 描述意图不会漂。
    assert "今天想做点什么" not in COWORK_INSTRUCTIONS
    assert "What takes most of your week" not in COWORK_INSTRUCTIONS


def test_it_says_to_start_not_to_interview():
    # 开放提问最容易退化成连环追问。一个白领答完"每天发视频太累"，想要的是
    # 有人开始动手，不是再答五个问题。
    lowered = COWORK_INSTRUCTIONS.lower()
    assert "enough to start" in lowered or "then start" in lowered


def test_the_code_persona_is_untouched():
    # 本次改动只影响 Marlo。开发者角色的提示词一个字不动。
    from coworker.agents.code import CODE_INSTRUCTIONS

    assert "opened this conversation" not in CODE_INSTRUCTIONS.lower()
