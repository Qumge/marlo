"""Signing in to Qumge must also attach its skill catalog.

This failure is silent. Without the entry the app works exactly as before —
sessions start, models answer, nothing errors — and the only symptom is that
asking for a skill finds nothing, forever. Nobody would trace that back to a
missing line in mcp.json.
"""
from __future__ import annotations

import json

import pytest

from coworker.mcp.config import global_mcp_path, put_global_server, read_global
from coworker.qumge import skills_mcp


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
