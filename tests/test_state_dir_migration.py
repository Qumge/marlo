"""状态目录从 coworker 改名到 marlo，带一次迁移。

`~/.config/coworker` 是 fork 自 OpenWorker 时留下的。里面装着用户的【全部】东西：
对话、模型密钥、连接器 token、定时任务。所以这次迁移的失败模式不是"路径不好看"，
是"用户打开来发现全空了"。

因此这组测试的重点在【失败路径】，不是顺利那条：
  - 新目录已经存在 -> 绝不覆盖
  - 搬不动（权限/跨设备/被占）-> 继续用老的，不能返回一个空的新路径
  - 并发（shell 和 sidecar 同时起）-> 谁先搬完都行，另一个不能报错
  - 老的不存在 -> 就是全新安装，直接用新的
"""
from __future__ import annotations

import os
from pathlib import Path

import pytest

import coworker.secrets as sec


@pytest.fixture(autouse=True)
def clean_env(monkeypatch):
    monkeypatch.delenv("MARLO_STATE_DIR", raising=False)
    monkeypatch.delenv("COWORKER_STATE_DIR", raising=False)


@pytest.fixture
def home(monkeypatch, tmp_path):
    monkeypatch.setattr(Path, "home", staticmethod(lambda: tmp_path))
    monkeypatch.setattr(sec.sys, "platform", "darwin")
    return tmp_path


def _seed_old(home: Path, marker: str = "secrets.json") -> Path:
    old = home / ".config" / "coworker"
    old.mkdir(parents=True)
    (old / marker).write_text("the user's whole life", encoding="utf-8")
    return old


def test_a_fresh_install_just_uses_the_new_name(home):
    d = sec.state_dir()
    assert d == home / ".config" / "marlo"
    assert not (home / ".config" / "coworker").exists()


def test_an_existing_install_is_moved_over(home):
    _seed_old(home)
    d = sec.state_dir()
    assert d == home / ".config" / "marlo"
    assert (d / "secrets.json").read_text(encoding="utf-8") == "the user's whole life"
    assert not (home / ".config" / "coworker").exists()


def test_migrating_twice_is_a_no_op(home):
    _seed_old(home)
    first = sec.state_dir()
    (first / "added-after.txt").write_text("x", encoding="utf-8")
    second = sec.state_dir()
    assert first == second
    assert (second / "added-after.txt").exists()


def test_an_existing_new_dir_is_never_clobbered(home):
    # 两个目录都在（用户手动建过，或上一次迁移只搬了一半）。老的绝不能盖掉新的
    # —— 那是把当前正在用的状态换成一份旧的。
    _seed_old(home)
    new = home / ".config" / "marlo"
    new.mkdir(parents=True)
    (new / "current.json").write_text("in use", encoding="utf-8")

    d = sec.state_dir()
    assert d == new
    assert (new / "current.json").read_text(encoding="utf-8") == "in use"
    assert not (new / "secrets.json").exists()
    # 老的原地不动 —— 没搬走就不能删。
    assert (home / ".config" / "coworker" / "secrets.json").exists()


def test_a_failed_move_keeps_using_the_old_dir(home, monkeypatch):
    # 这是最重要的一条。迁移失败还返回新路径的话，用户打开来是空的，
    # 会以为东西全没了 —— 而它们其实好好地躺在老目录里。
    _seed_old(home)

    def boom(*a, **k):
        raise OSError("cross-device link")

    monkeypatch.setattr(sec.os, "rename", boom)
    d = sec.state_dir()
    assert d == home / ".config" / "coworker"
    assert (d / "secrets.json").exists()


def test_a_race_between_shell_and_sidecar_is_not_an_error(home, monkeypatch):
    # shell 和 sidecar 会同时起，两边各有一份实现。一个搬完了，另一个的 rename
    # 会 FileNotFoundError —— 那不是错误，是"已经好了"。
    _seed_old(home)
    real = sec.os.rename

    def move_then_vanish(src, dst):
        real(src, dst)              # 模拟另一个进程抢先搬完
        raise FileNotFoundError(src)

    monkeypatch.setattr(sec.os, "rename", move_then_vanish)
    assert sec.state_dir() == home / ".config" / "marlo"


def test_both_env_overrides_still_win(home, monkeypatch):
    _seed_old(home)
    monkeypatch.setenv("COWORKER_STATE_DIR", str(home / "explicit"))
    assert sec.state_dir() == home / "explicit"
    # 老名字仍然认：测试和 sidecar 里到处在用，改掉等于毫无收益地弄坏一堆东西。
    monkeypatch.setenv("MARLO_STATE_DIR", str(home / "newer"))
    assert sec.state_dir() == home / "newer"
    # 有 env 时不该顺手把老目录搬走。
    assert (home / ".config" / "coworker").is_dir()
