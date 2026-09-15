"""Marlo：对话会话默认「完全放手」，自动化照旧（owner 2026-09-15）。

测的是【启动路径】，不是 Config 的一个默认值：桌面外壳（src-tauri/src/lib.rs）启动
sidecar 时只传 `--host` / `--port`，模式完全来自 run.main 里 argparse 的默认值 →
config.mode → SessionManager.mode → 新会话。Config 的默认值改了而 argparse 那头没接上，
test_config.py 照样是绿的，用户看到的还是「动手前先问我」。
"""
from __future__ import annotations

import sys
from types import SimpleNamespace

from coworker.permissions import Mode, PermissionEngine


def _launch_like_the_desktop_shell(tmp_path, monkeypatch, config_toml: str | None = None):
    from coworker.server import run as server_run

    state = tmp_path / "state"
    state.mkdir(parents=True, exist_ok=True)
    if config_toml is not None:
        (state / "config.toml").write_text(config_toml)
    monkeypatch.setenv("COWORKER_STATE_DIR", str(state))
    monkeypatch.setenv("COWORKER_API_TOKEN", "t")  # Tauri 给的内存 token，不落盘
    monkeypatch.setattr(server_run, "_exit_when_orphaned", lambda: None)
    seen = {}
    monkeypatch.setitem(
        sys.modules, "uvicorn", SimpleNamespace(run=lambda app, **kw: seen.update(app=app))
    )
    # 和 lib.rs 传的参数一模一样：只有 host 和 port
    server_run.main(["--host", "127.0.0.1", "--port", "0"])
    return seen["app"].state.manager


def test_the_desktop_launch_path_starts_chats_in_bypass(tmp_path, monkeypatch):
    manager = _launch_like_the_desktop_shell(tmp_path, monkeypatch)
    assert manager.mode is Mode.BYPASS_APPROVALS

    # 而且它真的意味着「不问」：一条普通命令直接放行，不出卡片
    engine = PermissionEngine(workspace_root=tmp_path, mode=manager.mode)
    d = engine.evaluate("run_shell", {"command": "ls"}, None)
    assert d.allowed and not d.needs_user, d.reason


def test_hard_floors_still_hold_in_the_default(tmp_path, monkeypatch):
    # 默认放手不等于没有底线：保存技能（持久授权）仍然要人点头
    manager = _launch_like_the_desktop_shell(tmp_path, monkeypatch)
    engine = PermissionEngine(workspace_root=tmp_path, mode=manager.mode)
    d = engine.evaluate("save_skill", {"name": "x"}, None)
    assert not d.allowed and d.needs_user and d.human_only


def test_a_users_own_config_still_wins(tmp_path, monkeypatch):
    # 默认值只是默认值：自己在全局 config.toml 里写了「先问」的人，照旧先问
    manager = _launch_like_the_desktop_shell(tmp_path, monkeypatch, 'mode = "interactive"\n')
    assert manager.mode is Mode.INTERACTIVE


def test_automations_keep_asking(tmp_path, monkeypatch):
    """owner 同日定「自动化照旧」：没人在电脑前的定时任务，审批照旧进收件箱。
    对话默认放手之后，这条钉住它没有被顺带改掉。"""
    from coworker.automation import Schedule, ScheduledTask
    from coworker.providers import AssistantTurn, ModelCapabilities, ProviderClient
    from coworker.server import SessionManager

    class _Provider(ProviderClient):
        def complete(self, *, model, messages, tools=None, **settings):
            return AssistantTurn(text="ok", finish_reason="stop")

        def capabilities(self, model):
            return ModelCapabilities()

    monkeypatch.setenv("COWORKER_STATE_DIR", str(tmp_path / "state"))
    ws = tmp_path / "ws"
    ws.mkdir()
    # 管理器本身按新默认跑在 bypass 上 —— 自动化必须不继承它
    manager = SessionManager(
        data_dir=tmp_path / "data", provider=_Provider(), mode=Mode.BYPASS_APPROVALS
    )
    task = ScheduledTask(
        title="Daily brief",
        instructions="search the web and brief me",
        schedule=Schedule(kind="cron", cron="10 19 * * *"),
        workspace=str(ws),
        agent="cowork",
    )
    manager.task_store.save(task)

    engine = manager._build_task_engine(task, session_id="__run__test")
    assert engine.permissions.mode is Mode.INTERACTIVE
