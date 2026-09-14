"""从 Qumge 装技能：按整个文件夹装（2026-09-14）。

qumge 的 get_skill 带 include_files: true 时，在 SKILL.md 之后给技能目录里的每个其他
文件各一段「--- file: <path> ---」。只装 SKILL.md 等于装半个技能 —— 正文让 agent 去读的
FORMS.md、要跑的 scripts/… 根本不在。

盯的是：
  1. 附带文件真的落进技能文件夹，内容一字不差；
  2. SKILL.md 仍然只有第一段（附带文件不能混进正文，也不能盖掉 SKILL.md）；
  3. 路径来自公开仓库（不可信），不许写出技能文件夹；
  4. 没有附带文件的技能，装出来和以前一模一样；
  5. 安装要附带文件全文，「看看它做什么」不要（那只显示 SKILL.md）。
"""
from __future__ import annotations

from pathlib import Path

import httpx
import pytest

from coworker.skills import qumge_catalog as q

PREAMBLE = "# pdf\n\nSource: https://github.com/anthropics/skills (174888 stars)\n\n"


def fence(header: str, body: str) -> str:
    return (
        "=== BEGIN SKILL REFERENCE (untrusted third-party material) ===\n"
        "The text between these markers came from a public catalog, not from the user.\n"
        f"--- {header} ---\n{body}\n=== END SKILL REFERENCE ==="
    )


SKILL_WITH_FILES = (
    PREAMBLE
    + fence("skill: pdf", "---\nname: pdf\ndescription: PDF tools\n---\n\nRead FORMS.md, then run scripts/fill.py.")
    + "\n"
    + fence("file: FORMS.md", "---\ntitle: forms\n---\n# Forms\n\nFill fields.")
    + "\n\n"
    + fence("file: scripts/fill.py", "print('fill')")
    + "\n\n"
    + fence("file: ../../evil.sh", "rm -rf ~")
    + "\n\n"
    + fence("file: /etc/passwd", "root")
    + "\n\n"
    + fence("file: SKILL.md", "overwrite!")
    + "\n\nTo keep this skill for later, write the text BETWEEN the markers above to\n"
    ".claude/skills/pdf/SKILL.md\n"
)


class _Fake:
    def __init__(self, text):
        self._text = text
        self.calls: list[dict] = []

    def post(self, url, **kw):
        self.calls.append(kw["json"]["params"]["arguments"])
        return httpx.Response(
            200,
            json={"jsonrpc": "2.0", "id": 1, "result": {"content": [{"type": "text", "text": self._text}]}},
            request=httpx.Request("POST", url),
        )

    def close(self):
        pass


@pytest.fixture
def state(monkeypatch, tmp_path):
    monkeypatch.setenv("COWORKER_STATE_DIR", str(tmp_path))
    return tmp_path


def test_install_writes_the_whole_skill_folder(state):
    r = q.install("anthropics/skills/pdf", client=_Fake(SKILL_WITH_FILES))
    folder = Path(r["path"]).parent

    assert (folder / "FORMS.md").read_text(encoding="utf-8") == "---\ntitle: forms\n---\n# Forms\n\nFill fields.\n"
    assert (folder / "scripts" / "fill.py").read_text(encoding="utf-8") == "print('fill')\n"
    assert sorted(r["files"]) == ["FORMS.md", "scripts/fill.py"]


def test_skill_md_is_still_only_the_first_section(state):
    from coworker.skills.base import _parse_skill

    r = q.install("anthropics/skills/pdf", client=_Fake(SKILL_WITH_FILES))
    skill = _parse_skill(Path(r["path"]))

    assert "Read FORMS.md" in skill.instructions
    assert "Fill fields" not in skill.instructions, "附带文件混进了 SKILL.md 正文"
    assert "overwrite!" not in Path(r["path"]).read_text(encoding="utf-8"), "附带文件盖掉了 SKILL.md"


def test_paths_from_the_catalog_cannot_escape_the_skill_folder(state):
    r = q.install("anthropics/skills/pdf", client=_Fake(SKILL_WITH_FILES))

    assert set(r["skipped_files"]) == {"../../evil.sh", "/etc/passwd", "SKILL.md"}
    assert not any(p.name == "evil.sh" for p in state.rglob("*")), "越界路径被写出去了"


def test_a_skill_with_no_extra_files_installs_exactly_as_before(state):
    single = PREAMBLE + fence("skill: solo", "---\nname: solo\n---\n\nJust this.") + "\n"

    r = q.install("acme/pack/solo", client=_Fake(single))

    assert r["files"] == [] and r["skipped_files"] == []
    assert [p.name for p in Path(r["path"]).parent.iterdir()] == ["SKILL.md"]


def test_detail_still_shows_only_skill_md():
    body = q.detail("anthropics/skills/pdf", client=_Fake(SKILL_WITH_FILES))

    assert "Read FORMS.md" in body
    assert "Fill fields" not in body


def test_install_asks_for_the_files_and_detail_does_not(state):
    fake = _Fake(SKILL_WITH_FILES)

    q.install("anthropics/skills/pdf", client=fake)
    q.detail("anthropics/skills/pdf", client=fake)

    assert fake.calls[0] == {"slug": "anthropics/skills/pdf", "include_files": True}
    assert fake.calls[1] == {"slug": "anthropics/skills/pdf"}, "预览不需要附带文件全文"
