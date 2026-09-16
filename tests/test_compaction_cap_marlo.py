"""Marlo 的压缩触发上限（2026-09-16）。

上游 compaction.py 的 cap 是 250_000。Marlo 的默认模型窗口是 100 万 token
（deepseek-v4.1-flash），触发线 = min(0.8 × 窗口, cap) 因此一直落在 cap 上 —— 25 万，
实际上等于不压缩：owner 的会话里每一步都在重发整段历史（生产实测某小时平均输入 78k），
既慢又贵。

这些测试钉的是【我们有意改小了】。上游那条 `trigger_tokens(1_000_000) == DEFAULT_CAP_TOKENS`
用的是常量，cap 改回去它照样绿 —— 所以那条证明不了这件事，需要这里的字面值。
"""
from __future__ import annotations

from coworker.compaction import (
    DEFAULT_CAP_TOKENS,
    DEFAULT_CONTEXT_WINDOW,
    should_compact,
    trigger_tokens,
)


def test_the_cap_is_marlos_60k_not_upstreams_250k():
    assert DEFAULT_CAP_TOKENS == 60_000


def test_a_million_token_window_still_compacts_early():
    # 这是 Marlo 的默认模型那一档：窗口 100 万，80% 是 80 万，cap 必须赢
    assert trigger_tokens(1_000_000) == 60_000


def test_the_session_that_prompted_this_would_now_compact():
    # 生产实测：某小时平均输入 78,571 token —— 旧 cap 下它离触发线还差 17 万
    assert should_compact(78_571, 1_000_000) is True
    assert should_compact(78_571, 1_000_000, cap_tokens=250_000) is False


def test_only_windows_below_75k_still_go_by_percentage():
    """【这个 cap 的影响面要说清楚】60k 的上限会盖住【所有窗口大于 7.5 万】的模型，
    不只是 100 万窗口那一档：0.8 × 75_000 = 60_000 就是分界线。

    第一版测试写的是「小窗口模型不受影响」并断言 trigger_tokens(None) == 0.8×128k —— 红了，
    红得对：没指定窗口时按 128k 算，80% 是 102,400，现在会被 cap 压到 60k。写进这里而不是
    悄悄改掉断言，是因为这正是这次改动的代价：窗口 12.8 万的模型可用原文从 10.2 万降到 6 万。"""
    assert trigger_tokens(64_000) == int(0.8 * 64_000) == 51_200  # 低于分界线，百分比说了算
    assert trigger_tokens(75_000) == 60_000  # 分界线上，两者相等
    assert trigger_tokens(DEFAULT_CONTEXT_WINDOW) == 60_000  # 128k 默认窗口：cap 赢，压到 6 万


def test_an_explicit_user_setting_still_wins():
    # 设置里调过 cap 的用户不受这个默认值影响（Settings ▸ 上下文压缩）
    assert trigger_tokens(1_000_000, cap_tokens=200_000) == 200_000
