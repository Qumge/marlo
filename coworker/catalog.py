"""Vetted tool catalog — the stable ``id → capability`` layer a persona references.

A *capability* bundles a group of tools (the existing ``tools/`` factories) behind a stable
id, plus what session context it needs (``requires``) and the risk classes it can produce
(``risk``, used by the Phase 2 install-consent screen). ``expand(ids, context)`` turns a
persona's ``tools:`` list into concrete callables, skipping capabilities whose context
prerequisites aren't met (e.g. no shell without an executor) — matching the per-agent
factories that used to assemble tools by hand.

The catalog is **platform-owned and closed**: third parties get breadth from us adding
vetted capabilities here and from MCP, never by adding entries. MCP tools are *not* in the
catalog (see ``PERMISSIONS-AND-INBOX.md``).
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Callable

import aisuite as ai

from .agents.base import AgentContext
from .risk import RiskClass
from .tools.connect import request_connector_tool
from .tools.documents import document_tools
from .tools.files import file_tools
from .tools.git import git_tools
from .tools.search import search_tools
from .tools.shell import shell_tools
from .tools.todo import todo_tools

# Context prerequisites a capability may require, mapped to a predicate over AgentContext.
_REQUIREMENTS: dict[str, Callable[[AgentContext], bool]] = {
    "workspace": lambda c: c.workspace is not None,
    "executor": lambda c: c.executor is not None,
    "todo": lambda c: c.todo is not None,
}


@dataclass(frozen=True)
class Capability:
    id: str
    name: str  # human label (consent screen)
    description: str
    build: Callable[[AgentContext], list]
    requires: tuple[str, ...] = ()
    risk: tuple[RiskClass, ...] = (RiskClass.READ,)

    def available(self, context: AgentContext) -> bool:
        return all(_REQUIREMENTS[r](context) for r in self.requires)


# -- capability builders --------------------------------------------------------
# These reproduce, exactly, what the Code and Cowork agent factories assembled by hand.


def _code_files(context: AgentContext) -> list:
    """Repo-oriented files: single-root, line-numbered/windowed `read_file`. Our `grep` and
    windowed `read_file` replace aisuite's slower `search_files` / `read_file`/`read_file_lines`.
    """
    ws = str(context.workspace)
    replaced = {"search_files", "read_file", "read_file_lines"}
    files = [
        t
        for t in ai.toolkits.files(root=ws, allow_write=True)
        if getattr(t, "__name__", "") not in replaced
    ]
    return [*files, *file_tools(ws)]


# 知识工作角色【不给】补丁类工具。
#
# 理由是用户看到什么：一个白领点开审批卡片，看到的是
#
#     @@ -12,7 +12,7 @@
#     -　　本合同自双方签署之日起生效
#     +　　本合同自双方盖章之日起生效
#
# 这是给程序员看的东西。改成整文件重写（write_file）之后，卡片能说
# 「我要改 合同概览.docx」并给出结果摘要 —— 这才是他能判断该不该点的形式。
#
# 代价说清楚：整文件重写要把全文重新吐一遍，长文档更费 token，而且模型
# 复述时可能改动没打算改的地方。对白领的文档场景（几页纸）这个代价可以接受；
# 对一个几千行的源文件不行 —— 所以 `code` 角色走的是 code_files，补丁工具
# 原样保留（见 _code_files）。
#
# .docx / .xlsx 本来就不走这条路：它们由 documents 能力的 write_docx /
# write_xlsx 生成，补丁对二进制格式从来就没意义。
_PATCH_TOOLS = {"apply_patch", "apply_unified_diff", "replace_in_file"}


def _files(context: AgentContext) -> list:
    """Knowledge-work files: multi-root aware (reads/writes across the session's roots), keeps
    aisuite's `read_file`/`read_file_lines`. Our `grep` replaces the slow `search_files`, and
    the patch tools are dropped entirely — see _PATCH_TOOLS above.
    """
    ws = str(context.workspace)
    file_kwargs = (
        {"roots": context.roots} if context.roots else {"root": ws, "allow_write": True}
    )
    dropped = {"search_files", *_PATCH_TOOLS}
    return [
        t
        for t in ai.toolkits.files(**file_kwargs)
        if getattr(t, "__name__", "") not in dropped
    ]


def _connect(context: AgentContext) -> list:
    """request_connector —— 在对话里要一个账号的授权。

    连接器页不是主路径：一般用户在聊天里一步步推进，推到需要他的邮箱时，
    Marlo 该就地要，而不是让他自己走到设置页去找开关。

    允许集从真实目录取，不手抄：手抄的一串字符串会和 descriptors.py 漂移，
    然后模型点名一个已经改名的连接器，用户看到一张说不通的卡片。
    available=False 的（占位/未上线）不进来——要一个连不上的东西是死胡同。
    """
    from .connectors.descriptors import DESCRIPTORS

    names = [d.name for d in DESCRIPTORS if getattr(d, "available", True)]
    return [request_connector_tool(names)]


def _skills_catalog(context: AgentContext) -> list:
    """search_skills / install_skill —— 让 agent 自己去 Qumge 的目录里找技能。

    【为什么必须给】：cowork 的提示词一直写着 "search the skill catalog with the
    user's own words first"，而它实际拿到的工具里没有任何能碰目录的东西 ——
    2026-07-28 跑端到端时从会话历史数出来的：九轮只用了 read_file / write_file /
    list_files / run_shell / todo_write。提示词让它做一件它做不到的事。

    【为什么不能让用户自己装】：Marlo 的用户是中小商家的白领，不懂什么是 skill，
    也不会去翻四千条目录。他只会说"帮我把这些发票整理一下"。找技能这件事要是
    需要他先做，这个目录对他就等于不存在。

    loader 由 agent.py 建好后塞进 context —— 装完要 refresh 它，本轮才用得上。
    """
    loader = getattr(context, "skill_loader", None)
    if loader is None:
        return []
    from .tools.skills_catalog import catalog_tools

    return catalog_tools(loader)


def _documents(context: AgentContext) -> list:
    """write_docx / write_xlsx — the formats a deliverable is actually handed over in.

    Separate from `files` on purpose: those write text, these write binary Office
    formats through bundled libraries, and a persona that should not be producing
    Word documents can decline the capability without losing read/write.
    """
    return document_tools(str(context.workspace))


def _git(context: AgentContext) -> list:
    ws = str(context.workspace)
    return [*ai.toolkits.git(root=ws), *git_tools(ws)]  # git_status, git_diff, git_log


def _search(context: AgentContext) -> list:
    return search_tools(str(context.workspace))  # grep (ripgrep, .gitignore-aware)


def _shell(context: AgentContext) -> list:
    return shell_tools(context.executor)  # run_shell + background task tools


def _todo(context: AgentContext) -> list:
    return todo_tools(context.todo)  # todo_write (drives the Progress panel)


_CAPS: list[Capability] = [
    Capability(
        id="code_files",
        name="Code files",
        description="Read & edit files in a single repo workspace (line-numbered reads).",
        build=_code_files,
        requires=("workspace",),
        risk=(RiskClass.READ, RiskClass.WRITE_LOCAL),
    ),
    Capability(
        id="files",
        name="Files",
        description="Read & edit files across the session's workspace folders.",
        build=_files,
        requires=("workspace",),
        risk=(RiskClass.READ, RiskClass.WRITE_LOCAL),
    ),
    Capability(
        id="documents",
        name="Documents",
        description="Write Word (.docx) and Excel (.xlsx) files — what a deliverable is handed over as.",
        build=_documents,
        requires=("workspace",),
        risk=(RiskClass.WRITE_LOCAL,),
    ),
    Capability(
        id="skills_catalog",
        name="Skill catalog",
        description="Search Qumge's public skill catalog and install what fits the task.",
        build=_skills_catalog,
        requires=(),
        risk=(RiskClass.READ, RiskClass.WRITE_LOCAL),
    ),
    Capability(
        id="connect",
        name="Connect accounts",
        description="Ask the user, in the conversation, to connect an account you need.",
        build=_connect,
        requires=(),
        risk=(RiskClass.READ,),
    ),
    Capability(
        id="git",
        name="Git",
        description="Inspect git state and history (status, diff, log).",
        build=_git,
        requires=("workspace",),
        risk=(RiskClass.READ,),
    ),
    Capability(
        id="search",
        name="Search",
        description="Fast code/content search (grep).",
        build=_search,
        requires=("workspace",),
        risk=(RiskClass.READ,),
    ),
    Capability(
        id="shell",
        name="Shell",
        description="Run shell commands in a persistent session.",
        build=_shell,
        requires=("executor",),
        risk=(RiskClass.EXEC,),
    ),
    Capability(
        id="todo",
        name="Task list",
        description="Maintain a visible task/progress list.",
        build=_todo,
        requires=("todo",),
        risk=(RiskClass.READ,),
    ),
]

CATALOG: dict[str, Capability] = {c.id: c for c in _CAPS}


def capability(cap_id: str) -> Capability:
    cap = CATALOG.get(cap_id)
    if cap is None:
        raise KeyError(f"Unknown capability id: {cap_id!r}")
    return cap


def expand(ids: list[str], context: AgentContext) -> list:
    """Expand a persona's ``tools:`` id list into concrete tool callables for this context.
    Capabilities whose context prerequisites aren't met are skipped (no shell without an
    executor, no files without a workspace) — exactly like the old hand-written factories.
    """
    tools: list = []
    for cap_id in ids:
        cap = capability(cap_id)
        if cap.available(context):
            tools.extend(cap.build(context))
    return tools


def risk_summary(ids: list[str]) -> set[RiskClass]:
    """The union of risk classes a tool list can produce — for the install-consent screen."""
    out: set[RiskClass] = set()
    for cap_id in ids:
        out.update(capability(cap_id).risk)
    return out
