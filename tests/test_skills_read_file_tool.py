"""read_skill_file：读已装技能文件夹里的附带文件（2026-09-14）。

技能按整个文件夹装（SKILL.md + REFERENCE.md / scripts/…），而 read_file 只认工作区 ——
全局技能文件夹不在里面，load_skill 返回的 resources_path 没有工具读得到。装上了却读
不到，和没装一样。

盯的是：读得到文件夹里的文件；读不到文件夹外面；文件不存在时说清楚有哪些；
agent 真的拿到了这个工具。
"""
from __future__ import annotations

import pytest

from coworker.agents.base import AgentContext
from coworker.catalog import capability
from coworker.skills import SkillLoader
from coworker.tools.skills_catalog import catalog_tools


def _tools(loader):
    return {t.__name__: t for t in
            [getattr(x, "__wrapped__", None) or x for x in catalog_tools(loader)]}


@pytest.fixture
def skills_root(tmp_path):
    root = tmp_path / "skills"
    folder = root / "pdf"
    (folder / "scripts").mkdir(parents=True)
    (folder / "SKILL.md").write_text("---\nname: pdf\n---\n\nRead FORMS.md.\n", encoding="utf-8")
    (folder / "FORMS.md").write_text("# Forms\n", encoding="utf-8")
    (folder / "scripts" / "fill.py").write_text("print('fill')\n", encoding="utf-8")
    (tmp_path / "secret.txt").write_text("nope", encoding="utf-8")
    return root


def test_reads_files_shipped_inside_the_skill_folder(skills_root):
    read = _tools(SkillLoader([skills_root]))["read_skill_file"]

    assert read("pdf", "FORMS.md")["content"] == "# Forms\n"
    assert read("pdf", "scripts/fill.py")["content"] == "print('fill')\n"


@pytest.mark.parametrize("bad", ["../secret.txt", "../../secret.txt", "/etc/passwd",
                                 "scripts/../../secret.txt", "..\\secret.txt"])
def test_cannot_read_outside_the_skill_folder(skills_root, bad):
    out = _tools(SkillLoader([skills_root]))["read_skill_file"]("pdf", bad)

    assert "error" in out
    assert "content" not in out


def test_a_missing_file_lists_what_the_folder_does_have(skills_root):
    out = _tools(SkillLoader([skills_root]))["read_skill_file"]("pdf", "REFERENCE.md")

    assert "no such file" in out["error"]
    assert "FORMS.md" in out["files"] and "scripts/fill.py" in out["files"]


def test_unknown_skill_says_so(skills_root):
    out = _tools(SkillLoader([skills_root]))["read_skill_file"]("nope", "FORMS.md")

    assert "unknown skill" in out["error"]


def test_cowork_actually_gets_read_skill_file():
    ctx = AgentContext(skill_loader=SkillLoader([]))
    names = {getattr(getattr(t, "__wrapped__", t), "__name__", "") for t in
             capability("skills_catalog").build(ctx)}

    assert "read_skill_file" in names, names
