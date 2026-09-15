"""Signing in to Qumge must also attach its skill catalog.

This failure is silent. Without the entry the app works exactly as before —
sessions start, models answer, nothing errors — and the only symptom is that
asking for a skill finds nothing, forever. Nobody would trace that back to a
missing line in mcp.json.
"""
from __future__ import annotations

import asyncio
import json
from types import SimpleNamespace

import pytest

from coworker.mcp.config import global_mcp_path, put_global_server, read_global
from coworker.permissions import Mode, PermissionEngine
from coworker.qumge import skills_mcp
from coworker.risk import RiskClass, classify


@pytest.fixture(autouse=True)
def _isolated_state(tmp_path, monkeypatch):
    monkeypatch.setenv("COWORKER_STATE_DIR", str(tmp_path))
    yield


def test_installs_the_catalog_server_on_a_fresh_config():
    assert skills_mcp.ensure_installed("https://qumge.com") is True

    servers = read_global()
    assert skills_mcp.SERVER_NAME in servers
    entry = servers[skills_mcp.SERVER_NAME]
    assert entry["url"] == "https://qumge.com/mcp"
    assert entry["type"] == "http"
    # Searching a public catalog is a read. Prompting for approval on every
    # "is there a skill for…" would make the feature worse than not having it.
    assert entry["requires_approval"] is False


def test_the_parser_actually_reads_what_we_wrote():
    """The key has to survive the round trip, not just appear in the file.

    This shipped wrong: skills_mcp wrote "requiresApproval" and the parser reads
    "requires_approval", so every skill lookup prompted for approval. The
    original test asserted only the key it had just written — it would have
    passed for any spelling, including one the parser ignores entirely.
    """
    from coworker.mcp.config import load_mcp_servers

    skills_mcp.ensure_installed("https://qumge.com")
    defs = {d.name: d for d in load_mcp_servers()}

    entry = defs[skills_mcp.SERVER_NAME]
    assert entry.transport == "http"
    assert entry.url == "https://qumge.com/mcp"
    assert entry.enabled is True
    assert entry.requires_approval is False, (
        "the parsed def, not the file — a spelling the parser ignores leaves this True "
        "and puts an approval modal in front of every catalog search"
    )


def test_a_trailing_slash_does_not_produce_a_double_slash():
    skills_mcp.ensure_installed("https://qumge.com/")
    assert read_global()[skills_mcp.SERVER_NAME]["url"] == "https://qumge.com/mcp"


def test_reconnecting_never_overwrites_what_the_user_edited():
    put_global_server(
        skills_mcp.SERVER_NAME,
        {"type": "http", "url": "https://my-mirror.example/mcp", "enabled": False},
    )

    assert skills_mcp.ensure_installed("https://qumge.com") is False

    entry = read_global()[skills_mcp.SERVER_NAME]
    # Both halves matter: a user who pointed this at their own mirror keeps it,
    # and a user who turned it off does not get it switched back on by signing
    # in again.
    assert entry["url"] == "https://my-mirror.example/mcp"
    assert entry["enabled"] is False


def test_other_servers_survive():
    put_global_server("something-else", {"type": "stdio", "command": "echo"})
    skills_mcp.ensure_installed("https://qumge.com")

    servers = read_global()
    assert "something-else" in servers
    assert skills_mcp.SERVER_NAME in servers


def test_the_file_it_writes_is_the_standard_mcpServers_shape():
    # Paste-compatible with Claude Desktop and Cursor is a documented property of
    # this file; writing a private shape into it would break that quietly.
    skills_mcp.ensure_installed("https://qumge.com")
    raw = json.loads(global_mcp_path().read_text())
    assert skills_mcp.SERVER_NAME in raw["mcpServers"]


# -- 自家服务：出上游的 MCP 地板 ----------------------------------------------------
# 上游 OPE-136 把所有 category="mcp" 的工具焊在 EXTERNAL 上，`requires_approval: false`
# 只再免掉「需审批」模式里的卡片。对内置的技能目录，这意味着 Discuss/Plan 里搜不了技能、
# 自动审批里每次搜都要过一遍审阅器、连接器页挂一条「迁移遗留开关」的横幅。
# owner 2026-09-15 定：它是自家服务，不问也不拦。
#
# 测的是【接线】：prepare_mcp_tools 真实装配出来的工具，再过真实的 PermissionEngine。
# 只测 is_first_party 的话，判据对了而没接上，用户看到的照样是审批卡片。
def _fake_tool(name):
    return SimpleNamespace(name=name, description=f"qumge {name}", inputSchema={"type": "object"})


def _wired(tmp_path, monkeypatch, url):
    from coworker.server.manager import SessionManager

    monkeypatch.delenv("QUMGE_BASE_URL", raising=False)
    put_global_server(
        skills_mcp.SERVER_NAME, {"type": "http", "url": url, "requires_approval": False}
    )
    manager = SessionManager(data_dir=tmp_path / "data")

    async def fake_ensure(server):
        return SimpleNamespace(tools=[_fake_tool("search_skills"), _fake_tool("get_skill")])

    monkeypatch.setattr(manager.mcp, "ensure", fake_ensure)
    tools = asyncio.run(manager.prepare_mcp_tools("s1"))
    metas = {t.__aisuite_tool_metadata__.name: t.__aisuite_tool_metadata__ for t in tools}
    assert metas, "没装配出任何工具 —— 这条测试自己坏了，先修它"
    return manager, metas


@pytest.mark.parametrize(
    "mode", [Mode.DISCUSS, Mode.PLAN, Mode.INTERACTIVE, Mode.AUTO_APPROVE], ids=lambda m: m.value
)
def test_the_catalog_never_asks_and_is_never_denied(tmp_path, monkeypatch, mode):
    _, metas = _wired(tmp_path, monkeypatch, "https://qumge.com/mcp")
    engine = PermissionEngine(workspace_root=tmp_path, mode=mode)
    for name, meta in metas.items():
        assert classify(name, meta) is RiskClass.READ, name
        d = engine.evaluate(name, {"query": "excel"}, meta)
        # needs_user 为假：自动审批模式里也不该交给审阅器（那是每次搜索多一次模型调用）
        assert d.allowed and not d.needs_user, f"{mode.value}: {name} → {d.reason}"


def test_a_lookalike_server_stays_on_the_floor(tmp_path, monkeypatch):
    # 用户把它指到自己的镜像，或者自定义服务器恰好也叫这个名字：那不是第一手知道的东西。
    _, metas = _wired(tmp_path, monkeypatch, "https://my-mirror.example/mcp")
    discuss = PermissionEngine(workspace_root=tmp_path, mode=Mode.DISCUSS)
    for name, meta in metas.items():
        assert classify(name, meta) is RiskClass.EXTERNAL, name
        assert not discuss.evaluate(name, {}, meta).allowed


def test_no_legacy_migration_banner_for_the_catalog(tmp_path, monkeypatch):
    from coworker.server.manager import SessionManager

    monkeypatch.delenv("QUMGE_BASE_URL", raising=False)
    skills_mcp.ensure_installed("https://qumge.com")
    manager = SessionManager(data_dir=tmp_path / "data")
    assert manager.mcp_trust(skills_mcp.SERVER_NAME)["legacy_dont_ask"] is False

    # 对照：同一个开关挂在别的服务器上，横幅照旧 —— 没有把这条提示整个弄没。
    put_global_server(
        "someone-else",
        {"type": "http", "url": "https://x.example/mcp", "requires_approval": False},
    )
    assert manager.mcp_trust("someone-else")["legacy_dont_ask"] is True
