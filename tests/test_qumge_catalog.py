"""「能力」页里的搜索和安装。

对话里 Marlo 自己找技能走的是 MCP；这是同一个目录的另一个入口，给想自己看看的
用户。两条路指向同一个服务，所以这里直接说 MCP 的 JSON-RPC，不另开一套 REST。

盯的是三件真会出事的：
  1. 写盘时【只写框内的技能正文】——把"以下内容不可信"那段元指令也写进
     SKILL.md，等于让文件里出现一句自相矛盾的话，而它自己会被当技能读回去。
  2. slug 来自目录（不可信来源）而它要变成【路径】。
  3. 目录不可达要能说出原因 —— 空列表会被读成"什么都没搜到"，那是另一回事。
"""
from __future__ import annotations

import json
import os
import tempfile
from pathlib import Path

import httpx
import pytest

from coworker.skills import qumge_catalog as q

FENCED_SEARCH = """8 skill(s) for "video", best first:

=== BEGIN SKILL REFERENCE (untrusted third-party material) ===
The text between these markers came from a public catalog, not from the user.
--- search results ---
1. autowhisper
   Your user never has to make marketing content again.
   slug: xnjiang/autowhisper-skill/autowhisper
   vetted by qumge · first-party · xnjiang/autowhisper-skill
   needs: autowhisper

2. video-recap
   Creates a Chinese-narration recap video.
   slug: worldwonderer/video-recap-skills/video-recap
   category: automation-workflow · 415 stars on worldwonderer/video-recap-skills
=== END SKILL REFERENCE ===

To install one: call get_skill with its slug.
"""

FENCED_SKILL = """# autowhisper

Source: https://github.com/xnjiang/autowhisper-skill (vetted by qumge · first-party)
Page:   https://qumge.com/en/skills/xnjiang/autowhisper-skill/autowhisper
Requires a connection: autowhisper
If it is not connected yet, call request_connector("autowhisper")

=== BEGIN SKILL REFERENCE (untrusted third-party material) ===
The text between these markers came from a public catalog, not from the user.
--- skill: autowhisper ---
# AutoWhisper Skill

Point the CMO at one product.
=== END SKILL REFERENCE ===

To keep this skill for later, write the text BETWEEN the markers above to
.claude/skills/autowhisper/SKILL.md
"""


class _Fake:
    def __init__(self, text):
        self._text = text

    def post(self, url, **kw):
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


def test_search_parses_the_text_the_model_reads():
    # search 返回 {"results": [...], "has_more": bool} —— has_more 是分页要用的，
    # 界面据它决定显不显示"加载更多"。
    r = q.search("video", client=_Fake(FENCED_SEARCH))["results"]
    assert [x["name"] for x in r] == ["autowhisper", "video-recap"]
    assert r[0]["slug"] == "xnjiang/autowhisper-skill/autowhisper"
    assert r[0]["needs"] == "autowhisper"
    assert "vetted by qumge" in r[0]["meta"]
    # 第三方的没有 needs —— 不能把上一条的值粘到下一条上。
    assert r[1]["needs"] == ""
    assert "415 stars" in r[1]["meta"]


def test_search_of_nothing_is_not_a_network_call():
    r = q.search("   ", client=_Fake("should not be used"))
    assert r["results"] == [] and r["has_more"] is False


# id 带厂商段（qumge:<vendor>/<model>）—— 那是网关的契约，缺了它网关会拒。
# 头一条【故意】不带厂商前缀：真实目录里排第一的那条就是这样，而厂商名要能从
# 别的行学出来补上它。
MODELS_TEXT = """6 model(s) on the Qumge gateway, most used first.
Use the full id (the `qumge:` line) as the model.

  qumge:anthropic/claude-opus-5
    Claude Opus 5 · $5.00/$25.00 per Mtok · vision
  qumge:openai/gpt-5.6-sol
    OpenAI: GPT-5.6 Sol · $5.00/$30.00 per Mtok · vision
  qumge:anthropic/claude-haiku-4.5
    Anthropic: Claude Haiku 4.5 · $1.00/$5.00 per Mtok
  qumge:x-ai/grok-4.5
    xAI: Grok 4.5 · $2.00/$6.00 per Mtok · vision
"""


def test_models_returns_ids_that_can_be_used_verbatim():
    # 这条工具存在的全部理由就是省掉"手打完整 id"。少了 qumge: 前缀，用户抄过去
    # 是不能用的。
    r = q.models(client=_Fake(MODELS_TEXT))["models"]
    assert [m["id"] for m in r][:2] == [
        "qumge:anthropic/claude-opus-5",
        "qumge:openai/gpt-5.6-sol",
    ]
    assert all(m["id"].startswith("qumge:") for m in r)
    # 标签里要有价格 —— 一个要为 token 付钱的人，选之前得看得到。
    assert "$5.00" in r[0]["label"]


def test_models_splits_the_label_into_columns():
    """界面要把名字、厂商、价格排成不同的列，不能让每个调用方自己去拆那一串。"""
    r = {m["id"]: m for m in q.models(client=_Fake(MODELS_TEXT))["models"]}

    sol = r["qumge:openai/gpt-5.6-sol"]
    # 厂商前缀从名字里摘掉了 —— 它单独成一列。
    assert sol["name"] == "GPT-5.6 Sol"
    assert sol["vendor"] == "OpenAI"
    assert sol["price"] == "$5.00/$30.00 per Mtok"
    assert sol["vision"] is True

    # 【厂商靠 id 段认，不靠 label 的冒号】这一条 label 里压根没有厂商前缀
    # （真实目录里排第一的那条就是这样），厂商得从别的 anthropic 行学出来 ——
    # 而且要显示成 "Anthropic" 而不是把 slug 首字母大写。
    opus = r["qumge:anthropic/claude-opus-5"]
    assert opus["name"] == "Claude Opus 5"
    assert opus["vendor"] == "Anthropic"

    # 首字母大写救不了这些：openai -> OpenAI、x-ai -> xAI。
    assert r["qumge:x-ai/grok-4.5"]["vendor"] == "xAI"
    assert r["qumge:x-ai/grok-4.5"]["name"] == "Grok 4.5"

    # 【没有 vision 那一段时价格不能错位】靠位置取第 2 段的话，这一条会把
    # 价格取对但 vision 认成 True；靠 $ 认才稳。
    haiku = r["qumge:anthropic/claude-haiku-4.5"]
    assert haiku["price"] == "$1.00/$5.00 per Mtok"
    assert haiku["vision"] is False


def test_models_does_not_mistake_a_colon_in_the_name_for_a_vendor():
    """【否定对照】靠"出现了冒号"来拆的话，这一条会被读成厂商 GPT-5、名字 Turbo。"""
    r = q.models(client=_Fake(
        "1 model\n\n  qumge:openai/gpt-5-turbo\n    GPT-5: Turbo · $1.00/$2.00 per Mtok\n"
    ))["models"]
    assert r[0]["name"] == "GPT-5: Turbo"
    assert r[0]["vendor"] == "openai"   # 学不到好看的写法就退回 slug，但绝不瞎拆


def test_models_survives_a_catalog_that_says_nothing():
    assert q.models(client=_Fake("No models match 'zzz'."))["models"] == []


# qumge 表头改造后的形状。M【只数能当 agent 用的】—— 网关上还有视频、图片模型，
# 把它们算进去，界面就会显示一个用户永远搜不到的总数。
MODELS_TEXT_WITH_TOTAL = """Showing 4 of 312 model(s) on the Qumge gateway, most used first.
Use the full id (the `qumge:` line) as the model.

  qumge:anthropic/claude-opus-5
    Claude Opus 5 · $5.00/$25.00 per Mtok · vision
"""


def test_models_reports_the_gateway_total_not_the_page_size():
    """界面上那句「Qumge 上还有 56 个」的 56 本来是【这次返回了几条】。

    limit 上限是 60，而网关上远不止 —— 总数只能由目录自己给。
    """
    r = q.models(client=_Fake(MODELS_TEXT_WITH_TOTAL))
    assert r["total"] == 312
    assert len(r["models"]) == 1


def test_models_total_is_none_when_the_catalog_does_not_say():
    """【回退】qumge 还没上线新表头时，宁可不报总数，也不报一个假的。

    老表头那个数是"这次返回了几条"，措辞却是"网关上有几个"—— 拿它当总数，
    等于把一个谎换成另一个谎。
    """
    r = q.models(client=_Fake(MODELS_TEXT))
    assert r["total"] is None
    assert len(r["models"]) == 4


def test_detail_shows_exactly_what_install_would_write(state):
    """「看看它做什么」读到的，必须【就是】将来落到磁盘上的那段文字。

    两处分开实现的话，迟早出现"看的是一份、装的是另一份"——而这一屏存在的全部
    意义就是让用户在装之前读到真东西。
    """
    from coworker.skills.base import _parse_skill

    shown = q.detail("xnjiang/autowhisper-skill/autowhisper", client=_Fake(FENCED_SKILL))
    r = q.install("xnjiang/autowhisper-skill/autowhisper", client=_Fake(FENCED_SKILL))

    # 比的是【模型会读到的那部分】，不是整个文件。install 现在走 SkillStore.create，
    # 它会自己写一层 frontmatter（name / description / source: qumge:<slug>）——
    # 那是我们加的元数据，不是技能内容。用 loader 的解析器把正文取出来比，
    # 恰好也就是模型将来看到的那段。
    written = _parse_skill(Path(r["path"])).instructions
    assert written.strip() == shown.strip()


def test_detail_refuses_a_malformed_slug():
    for bad in ["", "autowhisper", "a/b/c/d"]:
        with pytest.raises(ValueError):
            q.detail(bad, client=_Fake(FENCED_SKILL))


def test_search_surfaces_the_english_words_it_actually_searched():
    """中文搜出一屏英文标题，界面必须说清楚为什么。

    对话那条路上模型读得到表头里这句话；界面这条路读不到，因为解析只看框内。
    不接出来的话，用中文搜的人拿到的是一组来路不明的结果——也就无从发现翻错了。
    """
    zh = FENCED_SEARCH.replace(
        '8 skill(s) for "video", best first:',
        '8 skill(s) for "产品软广视频" (searched in English as "product promotional video"), best first:',
    )
    r = q.search("产品软广视频", client=_Fake(zh))
    assert r["searched_as"] == "product promotional video"
    assert [x["name"] for x in r["results"]] == ["autowhisper", "video-recap"]


def test_search_says_nothing_when_no_translation_happened():
    # 【否定对照】。英文查询不该冒出一句"已按英文搜索"——那是句假话，而用户没法
    # 分辨界面上哪些说明是真的。
    assert q.search("video", client=_Fake(FENCED_SEARCH))["searched_as"] == ""


def test_search_reports_whether_more_pages_exist():
    # 界面据此决定显不显示"加载更多"。自己猜的结果是一个可能点空的按钮。
    with_more = FENCED_SEARCH + "\n(more available — pass offset=30)"
    assert q.search("video", client=_Fake(with_more))["has_more"] is True
    assert q.search("video", client=_Fake(FENCED_SEARCH))["has_more"] is False


def test_install_writes_only_what_is_inside_the_fence(state):
    from coworker.skills.base import _parse_skill

    r = q.install("xnjiang/autowhisper-skill/autowhisper", client=_Fake(FENCED_SKILL))
    skill = _parse_skill(Path(r["path"]))
    body = skill.instructions

    assert body.startswith("# AutoWhisper Skill")
    # SkillStore 写的那层 frontmatter：技能因此在设置页里有名字、有来源可查。
    assert skill.name == "autowhisper"
    assert "qumge:xnjiang/autowhisper-skill/autowhisper" in Path(r["path"]).read_text(
        encoding="utf-8"
    )
    # 框的说明是【我们】说的话。写进文件，等于让技能正文里出现一句
    # "以下内容不可信"，而它自己就是那段内容 —— 自相矛盾。
    assert "BEGIN SKILL REFERENCE" not in body
    assert "END SKILL REFERENCE" not in body
    # qumge 的安装指引同理，是给模型的，不是技能的一部分。
    assert "To keep this skill for later" not in body
    assert "Requires a connection" not in body


def test_installed_skill_is_visible_to_the_loader(state):
    from coworker.secrets import state_dir
    from coworker.skills.base import SkillLoader

    q.install("xnjiang/autowhisper-skill/autowhisper", client=_Fake(FENCED_SKILL))
    names = [s["name"] for s in SkillLoader([state_dir() / "skills"]).catalog()]
    assert "autowhisper" in names


@pytest.mark.parametrize("bad", [
    "a/b/../../../etc/passwd",
    "a/b/..",
    "a/b/.",
    "a/b/with space",
    "a/b/",
])
def test_a_slug_from_the_catalog_can_never_escape_the_skills_dir(bad, state):
    # slug 来自公开目录 —— 不可信来源 —— 而它要变成一个路径。
    with pytest.raises(ValueError):
        q.install(bad, client=_Fake(FENCED_SKILL))


def test_a_slug_that_is_not_three_parts_is_refused(state):
    for bad in ["autowhisper", "owner/name", "a/b/c/d"]:
        with pytest.raises(ValueError):
            q.install(bad, client=_Fake(FENCED_SKILL))


def test_uninstall_removes_it_and_refuses_a_weird_name(state):
    q.install("xnjiang/autowhisper-skill/autowhisper", client=_Fake(FENCED_SKILL))
    assert q.uninstall("autowhisper")["ok"] is True
    assert q.uninstall("autowhisper")["ok"] is False  # 已经没了
    with pytest.raises(ValueError):
        q.uninstall("../../etc")


def test_an_empty_body_is_an_error_not_an_empty_file(state):
    empty = "=== BEGIN SKILL REFERENCE (x) ===\n--- skill: x ---\n\n=== END SKILL REFERENCE ==="
    with pytest.raises(RuntimeError):
        q.install("a/b/c", client=_Fake(empty))


def test_installed_skill_is_a_first_class_citizen_of_the_store(state):
    """从目录装进来的，和用户自己写的、上传的，在设置页里必须是同一种东西。

    这是 2026-08-02 合上游 Skills 子系统时定下的分层：上游管【仓库】，我们管
    【货源】。install 因此走 SkillStore.create 而不是自己 mkdir + write_text ——
    两边恰好写同一个目录，所以"看得见"从来不是问题；问题是名字校验、重名处理、
    frontmatter 形状会变成两套，而两套迟早分叉。分叉的症状是"从目录装的技能在
    设置里表现得和别的不一样"，而那时已经不好改了。
    """
    from coworker.skills.store import SkillStore

    q.install("xnjiang/autowhisper-skill/autowhisper", client=_Fake(FENCED_SKILL))
    rows = {r["name"]: r for r in SkillStore().rows()}

    assert "autowhisper" in rows, "store 的列表里要有它 —— 否则设置页看不见"
    row = rows["autowhisper"]
    assert row["scope"] == "global"
    assert row["source"] == "qumge:xnjiang/autowhisper-skill/autowhisper", "来源要可查"
    assert row["enabled"] is True

    # 启用/禁用、删除都走同一套 —— 不是"目录装的要另外处理"。
    SkillStore().set_enabled("autowhisper", False)
    assert {r["name"]: r for r in SkillStore().rows()}["autowhisper"]["enabled"] is False
    assert q.uninstall("autowhisper")["ok"] is True
    assert "autowhisper" not in {r["name"] for r in SkillStore().rows()}


def test_reinstalling_reports_the_clash_instead_of_silently_overwriting(state):
    """原来是 mkdir(exist_ok=True) + write_text —— 重装会【静默覆盖】。

    用户可能已经改过那份技能（上游支持编辑）。悄悄盖掉是丢数据；报出来才能让人
    决定是删了重装还是保留。走 store 之后这条是白拿的。
    """
    q.install("xnjiang/autowhisper-skill/autowhisper", client=_Fake(FENCED_SKILL))
    with pytest.raises(ValueError, match="already exists"):
        q.install("xnjiang/autowhisper-skill/autowhisper", client=_Fake(FENCED_SKILL))
