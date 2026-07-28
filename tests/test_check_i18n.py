"""i18n 守卫本身的测试。

这个守卫在 CI 上把 Windows 构建挂掉过一次：它用 `path.relative_to(SRC)` 记路径，
而 Windows 上分隔符是反斜杠、基线里存的是正斜杠 —— 184 条基线【全部】被当成新增。

守卫在某个平台上恒失败，比没有守卫更糟：它会被人当成噪音关掉。
"""
from __future__ import annotations

import importlib.util
import sys
from pathlib import Path

import pytest

SPEC = importlib.util.spec_from_file_location(
    "check_i18n", Path(__file__).resolve().parent.parent / "packaging" / "check_i18n.py"
)
mod = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(mod)


def test_paths_are_recorded_with_forward_slashes():
    """这是把 Windows 构建挂掉的那一条。

    【在 macOS 上直接跑 scan() 验不了它】：POSIX 的 relative_to 本来就给正斜杠，
    所以断言"没有反斜杠"永远通过——第一版就是这样，negative control 拆掉
    as_posix() 之后测试照样绿。要验就得让路径【真的】表现得像 Windows。
    """
    import pathlib as _pl

    win = _pl.PureWindowsPath("components/connectors/SlackDetail.tsx")
    # 守卫必须把它规成正斜杠；直接 str() 会得到反斜杠。
    assert "\\" in str(win), "样本本身不像 Windows 路径，这条测试证明不了什么"
    assert win.as_posix() == "components/connectors/SlackDetail.tsx"

    # 再确认守卫【用的就是】as_posix，而不是碰巧在这台机器上对。
    src = (Path(__file__).resolve().parent.parent / "packaging" / "check_i18n.py").read_text(
        encoding="utf-8"
    )
    assert ".relative_to(SRC).as_posix()" in src, (
        "守卫没有规范化路径分隔符 —— Windows 上整份基线会被当成新增"
    )

    for entry in mod.scan():
        assert "\\" not in entry.split(":", 1)[0], entry


def test_the_baseline_matches_what_the_scan_finds_today():
    # 基线漂了（有人翻译完忘了 --rebaseline，或反过来），下一次 CI 才发现。
    base = set(mod.BASELINE.read_text(encoding="utf-8").split("\n")) - {""}
    found = set(mod.scan())
    assert not (found - base), f"有 {len(found - base)} 条没进基线也没翻译"


def test_brand_names_are_not_flagged():
    # 把 Gmail、Slack 这些当成"没翻译"会让守卫吵到没人看。
    found = mod.scan()
    for name in ("Gmail", "Slack", "GitHub", "Marlo", "MCP", "IMAP"):
        assert not any(e.endswith(f": {name}") for e in found), name


def test_comments_are_not_scanned():
    # 注释里出现英文句子是正常的，它们不会被用户读到。
    assert not any("//" in e for e in mod.scan())


def test_an_empty_scan_fails_loudly():
    # 路径改动让它扫不到东西时必须失败 —— 一个静默通过的守卫等于没有守卫。
    original = mod.SRC
    try:
        mod.SRC = Path("/nonexistent")
        assert mod.main() == 1
    finally:
        mod.SRC = original
