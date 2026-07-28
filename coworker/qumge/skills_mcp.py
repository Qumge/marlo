"""Attach Qumge's skill catalog to the agent, as an MCP server.

The product is an agent, our models, and our skills. The models arrived with the
device flow; the skills did not. SkillLoader reads two local directories and
nothing else, so the 4,500-odd curated SKILL.md files on qumge.com were reachable
only by a person downloading one and dropping it into
~/.config/marlo/skills by hand — which no one Marlo is built for will do.

Both halves of the bridge already existed and were never joined. qumge.com serves
`search_skills` / `get_skill` / `list_categories` over MCP at POST /mcp, and this
app speaks MCP. So this is a config entry, not a subsystem: written when the user
connects, alongside the API key, so a session that has models also has the
catalog.

Stateless and unauthenticated by design (see the server's own header): searching a
public catalog needs no session and no key, which is why this can be a plain URL
with no token to leak into mcp.json.

Not overwritten if the user has already edited it. An entry they disabled stays
disabled — reconnecting is not consent to re-enable something they turned off.
"""
from __future__ import annotations

from ..mcp.config import put_global_server, read_global

SERVER_NAME = "qumge-skills"


def default_config(base_url: str) -> dict:
    return {
        "type": "http",
        "url": f"{base_url.rstrip('/')}/mcp",
        # Read-only lookups against a public catalog: no approval prompt for
        # searching, which would otherwise interrupt every "is there a skill
        # for…" with a modal about a GET.
        "requires_approval": False,
    }


def ensure_installed(base_url: str) -> bool:
    """Add the catalog server unless the user's config already mentions it.

    Returns True when it was written. False means it was already there — including
    when the user disabled it, which this must not undo.
    """
    if SERVER_NAME in read_global():
        return False
    put_global_server(SERVER_NAME, default_config(base_url))
    return True
