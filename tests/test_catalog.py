"""Phase 0 gate — the vetted tool catalog.

Asserts capabilities register, ``expand`` reproduces the Code and Cowork toolsets exactly
(the equivalence net for the build_tools refactor), context prerequisites are honored
(no shell without an executor, no files without a workspace), and the Code/Cowork file-tool
distinction (single-root numbered reader vs multi-root) is preserved."""

from __future__ import annotations

import pytest

from coworker.agents.base import AgentContext
from coworker.agents.code import CODE_CAPABILITIES, code_agent
from coworker.agents.cowork import COWORK_CAPABILITIES, cowork_agent
from coworker.catalog import CATALOG, capability, expand, risk_summary
from coworker.risk import RiskClass
from coworker.tools.todo import TodoList

# Expected toolset for each surface — the frozen equivalence contract for the refactor.
CODE_TOOLS = {
    "list_files",
    "write_file",
    "apply_unified_diff",
    "apply_patch",
    "replace_in_file",
    "read_file",  # numbered/windowed (single-root)
    "git_status",
    "git_diff",
    "git_log",
    "grep",
    "run_shell",
    "shell_task_output",
    "shell_task_kill",
    "todo_write",
}
COWORK_TOOLS = {
    "request_connector",  # 在对话里要账号授权：连接器页不是主路径
    "list_files",
    "read_file",  # aisuite (multi-root)
    "read_file_lines",
    "write_file",
    # 【没有补丁工具】。一个白领在审批卡片上看到 @@ -12,7 +12,7 @@ 是给程序员
    # 看的东西；整文件重写让卡片能说"我要改 合同概览.docx"并给结果摘要。
    # code 角色仍然有（见 CODE_TOOLS）——几千行的源文件重写不起。
    "grep",
    "run_shell",
    "shell_task_output",
    "shell_task_kill",
    "todo_write",
    # The `documents` capability. Cowork exists to produce a deliverable, and a
    # deliverable is handed over as .docx or .xlsx — markdown and csv are what a
    # developer wants. Code does NOT get these: a repo has no use for Word.
    "write_docx",
    "write_xlsx",
}


def _names(tools) -> set:
    return {getattr(t, "__name__", "") for t in tools}


def _full_context(tmp_path) -> AgentContext:
    return AgentContext(workspace=tmp_path, executor=object(), todo=TodoList())


def test_catalog_registers_expected_ids():
    assert {"code_files", "files", "git", "search", "shell", "todo"} <= set(CATALOG)
    for cap in CATALOG.values():
        assert cap.id and cap.name and callable(cap.build)


def test_expand_code_matches_expected(tmp_path):
    tools = expand(CODE_CAPABILITIES, _full_context(tmp_path))
    assert _names(tools) == CODE_TOOLS


def test_expand_cowork_matches_expected(tmp_path):
    tools = expand(COWORK_CAPABILITIES, _full_context(tmp_path))
    assert _names(tools) == COWORK_TOOLS


def test_agents_use_catalog(tmp_path):
    # The agent factories build through the catalog now — same result as direct expand.
    ctx = _full_context(tmp_path)
    assert _names(code_agent().build_tools(ctx)) == CODE_TOOLS
    assert _names(cowork_agent().build_tools(ctx)) == COWORK_TOOLS


PATCH_TOOLS = {"apply_patch", "apply_unified_diff", "replace_in_file"}


def test_patch_tools_are_for_code_only(tmp_path):
    """补丁工具只给 code 角色。

    上面两个常量是【期望值】——单独改它们，等于把测试改成迎合代码。这一条守的是
    分界本身：知识工作角色一个补丁工具都不能有，code 角色三个都得在。

    理由是用户看到什么。一个白领点开审批卡片，看到

        @@ -12,7 +12,7 @@
        -　　本合同自双方签署之日起生效
        +　　本合同自双方盖章之日起生效

    这是给程序员看的。整文件重写之后，卡片才能说"我要改 合同概览.docx"。
    """
    ctx = _full_context(tmp_path)
    cowork = _names(cowork_agent().build_tools(ctx))
    code = _names(code_agent().build_tools(ctx))

    assert not (PATCH_TOOLS & cowork), f"Marlo 又拿到补丁工具了: {PATCH_TOOLS & cowork}"
    assert PATCH_TOOLS <= code, f"code 角色丢了补丁工具: {PATCH_TOOLS - code}"
    # 拿掉之后必须还有【写】的手段，否则这个角色只能读。
    assert "write_file" in cowork
    assert {"write_docx", "write_xlsx"} <= cowork


def test_file_capability_distinction(tmp_path):
    # Code drops read_file_lines (folded into the windowed reader); Cowork keeps it (multi-root).
    code = _names(expand(["code_files"], _full_context(tmp_path)))
    cowork = _names(expand(["files"], _full_context(tmp_path)))
    assert "read_file_lines" not in code
    assert "read_file_lines" in cowork
    assert "read_file" in code and "read_file" in cowork


def test_requirements_skip_unavailable(tmp_path):
    # No executor → no shell; no todo → no todo_write; no workspace → no files/git/search.
    no_exec = AgentContext(workspace=tmp_path, executor=None, todo=TodoList())
    assert "run_shell" not in _names(expand(CODE_CAPABILITIES, no_exec))
    assert "todo_write" in _names(expand(CODE_CAPABILITIES, no_exec))

    no_todo = AgentContext(workspace=tmp_path, executor=object(), todo=None)
    assert "todo_write" not in _names(expand(CODE_CAPABILITIES, no_todo))
    assert "run_shell" in _names(expand(CODE_CAPABILITIES, no_todo))

    no_ws = AgentContext(workspace=None, executor=object(), todo=TodoList())
    names = _names(expand(CODE_CAPABILITIES, no_ws))
    assert names == {"run_shell", "shell_task_output", "shell_task_kill", "todo_write"}


def test_risk_summary():
    assert risk_summary(["shell"]) == {RiskClass.EXEC}
    assert risk_summary(["code_files"]) == {RiskClass.READ, RiskClass.WRITE_LOCAL}
    assert risk_summary(["git", "search"]) == {RiskClass.READ}


def test_unknown_capability_raises():
    with pytest.raises(KeyError):
        capability("does_not_exist")
