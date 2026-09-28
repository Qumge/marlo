"""qumge 的 MCP 工具现在随文本一起给 structuredContent。

目录的契约是【工具名 + outputSchema + HTTP API】，文本是给模型读的、不是给程序解
析的。所以这里改成优先读结构化，只在它没带的时候退回原来的正则。

这个模块盯的是：
  1. 结构化那条路和老路（解析文本）给出【同一个结果】—— 界面不该感知到数据来源
     换了；
  2. 真的在读结构化，而不是"碰巧两边一样"；
  3. 附带文件的越界检查在结构化那条路上照旧生效（结构化同样是不可信的第三方内容）。

fixture 是线上 tools/call 的完整 JSON-RPC 响应（文本和结构化都在里面），不是手写
的 —— 手写的样本只能证明自洽，证明不了和线上对得上。
"""
from __future__ import annotations

import json
import os
import tempfile
from pathlib import Path

import httpx
import pytest

from coworker.skills import qumge_catalog as q

FIXTURES = Path(__file__).parent / "fixtures" / "qumge"


class _Replay:
    """原样回放一个抓下来的 result；keep_structured=False 时摘掉 structuredContent。

    摘掉那一次模拟的是【没带结构化的 qumge】（老版本、或者某次返回没带上）——正好
    拿来对照两条路的结果是不是同一个。
    """

    def __init__(self, name: str, *, keep_structured: bool = True):
        result = json.loads((FIXTURES / name).read_text(encoding="utf-8"))["result"]
        if not keep_structured:
            result = {k: v for k, v in result.items() if k != "structuredContent"}
        self.result = result
        self.calls: list[dict] = []

    def post(self, url, **kw):
        self.calls.append(kw["json"]["params"])
        return httpx.Response(
            200,
            json={"jsonrpc": "2.0", "id": 1, "result": self.result},
            request=httpx.Request("POST", url),
        )

    def close(self):
        pass

    @property
    def structured(self) -> dict:
        return self.result["structuredContent"]


@pytest.fixture
def state(monkeypatch, tmp_path):
    monkeypatch.setenv("COWORKER_STATE_DIR", str(tmp_path))
    return tmp_path


def _both_paths(name: str, call):
    """同一个响应跑两遍：一遍带结构化，一遍只有文本。"""
    return call(_Replay(name)), call(_Replay(name, keep_structured=False))


# ---------------------------------------------------------------- search


@pytest.mark.parametrize("name, call", [
    ("search_skills_video.json", lambda c: q.search("video", client=c)),
    ("search_skills_translated.json", lambda c: q.search("产品软广视频", client=c)),
    ("search_skills_browse.json", lambda c: q.search(client=c)),
])
def test_search_is_the_same_with_and_without_structured_content(name, call):
    with_structured, text_only = _both_paths(name, call)

    assert with_structured == text_only
    assert with_structured["results"], "抓下来的样本本身要有内容"


def test_search_reads_the_structured_content_when_it_is_there():
    """【证明它真在读结构化】把结构化里的名字改掉、文本不动，结果要跟着结构化走。"""
    replay = _Replay("search_skills_video.json")
    replay.structured["results"][0]["name"] = "renamed-by-structured"
    replay.structured["results"][0]["summary"] = "summary from structured"
    replay.structured["results"][0]["needs"] = ["alpha", "beta"]

    first = q.search("video", client=replay)["results"][0]

    assert first["name"] == "renamed-by-structured"
    assert first["summary"] == "summary from structured"
    # 数组 join 成文本里那种字符串形状：多条用逗号分隔。
    assert first["needs"] == "alpha, beta"


def test_search_takes_has_more_and_the_translation_from_structured():
    replay = _Replay("search_skills_video.json")
    replay.structured["has_more"] = True
    replay.structured["searched_in_english_as"] = "video"

    r = q.search("视频", client=replay)

    assert r["has_more"] is True
    assert r["searched_as"] == "video"


def test_missing_structured_content_falls_back_to_the_text_parser():
    """老版本 qumge：响应里没有 structuredContent —— 退回正则，结果照旧。"""
    r = q.search("video", client=_Replay("search_skills_video.json", keep_structured=False))

    assert [x["name"] for x in r["results"]][:2] == ["video-use", "autowhisper"]
    assert r["results"][1]["needs"] == "autowhisper"


def test_when_the_catalog_starts_sending_a_group_it_is_read_from_structured():
    """分组字段（分类 key / qumge 精选）qumge 还没给，文本里有。

    给了就按结构化来 —— 按【字段】探测，不按版本号、不按日期。
    """
    replay = _Replay("search_skills_video.json")
    results = replay.structured["results"]
    results[0]["category"] = "automation-workflow"   # 这一条文本里也是这个分类
    results[1]["vetted"] = True                      # autowhisper，qumge 自己的

    r = q.search("video", client=replay)["results"]

    assert r[0]["group"] == "automation-workflow"
    assert r[0]["meta"].startswith("category: automation-workflow")
    assert r[1]["group"] == "__vetted__"
    assert "vetted by qumge" in r[1]["meta"]


# ---------------------------------------------------------------- models


def test_models_is_the_same_with_and_without_structured_content():
    with_structured, text_only = _both_paths("list_models.json", lambda c: q.models(client=c))

    assert with_structured == text_only
    assert len(with_structured["models"]) > 1
    assert with_structured["total"] == 292


def test_models_reads_the_structured_content_when_it_is_there():
    replay = _Replay("list_models.json")
    first = replay.structured["models"][0]
    first["name"] = "anthropic: Renamed Opus"
    first["input_price_per_mtok_usd"] = 1.0
    first["output_price_per_mtok_usd"] = 2.0
    first["vision"] = False
    replay.structured["total"] = 7

    r = q.models(client=replay)
    row = r["models"][0]

    assert row["name"] == "Renamed Opus"          # 厂商前缀照旧摘掉（单独成列）
    assert row["vendor"] == "anthropic"           # provider 就是 slug
    assert row["price"] == "$1.00/$2.00 per Mtok"
    assert row["vision"] is False
    assert r["total"] == 7


def test_models_price_keeps_the_wording_the_catalog_uses():
    """$0.325 在文本里写成 "$0.32" —— 结构化那条路要还原【同一个样子】。

    差一分钱就会让同一个模型因为数据来源不同而在界面上的价格不一样。
    """
    replay = _Replay("list_models.json")
    replay.structured["models"][0]["input_price_per_mtok_usd"] = 0.325
    replay.structured["models"][0]["output_price_per_mtok_usd"] = 1.95

    assert q.models(client=replay)["models"][0]["price"] == "$0.32/$1.95 per Mtok"


# ---------------------------------------------------------------- detail


def test_detail_is_the_same_with_and_without_structured_content():
    with_structured, text_only = _both_paths(
        "get_skill.json", lambda c: q.detail("openai/skills/pdf", client=c)
    )

    assert with_structured == text_only
    assert with_structured.startswith("# PDF Skill")


def test_detail_reads_the_structured_skill_md_when_it_is_there():
    replay = _Replay("get_skill.json")
    replay.structured["skill_md"] = "# from structured\n\nBody."

    assert q.detail("openai/skills/pdf", client=replay) == "# from structured\n\nBody."


# ---------------------------------------------------------------- install


def test_install_is_the_same_with_and_without_structured_content(state):
    with_structured = q.install("openai/skills/pdf", client=_Replay("get_skill_files.json"))

    os.environ["COWORKER_STATE_DIR"] = tempfile.mkdtemp()
    text_only = q.install(
        "openai/skills/pdf", client=_Replay("get_skill_files.json", keep_structured=False)
    )

    # path 里带着各自的临时目录 —— 比其余字段，再比落盘的每一个字节。
    assert {k: v for k, v in with_structured.items() if k != "path"} == {
        k: v for k, v in text_only.items() if k != "path"
    }
    assert with_structured["files"] == ["agents/openai.yaml", "LICENSE.txt"]

    for rel in ["SKILL.md", "agents/openai.yaml", "LICENSE.txt"]:
        assert (Path(with_structured["path"]).parent / rel).read_bytes() == (
            Path(text_only["path"]).parent / rel
        ).read_bytes(), rel


def test_install_reads_the_structured_files_when_they_are_there(state):
    replay = _Replay("get_skill_files.json")
    replay.structured["skill_md"] = "---\nname: pdf\n---\n\nFrom structured."
    replay.structured["files"] = [{"path": "notes.txt", "content": "hello"}]

    r = q.install("openai/skills/pdf", client=replay)
    folder = Path(r["path"]).parent

    assert r["files"] == ["notes.txt"]
    assert (folder / "notes.txt").read_text(encoding="utf-8") == "hello\n"
    assert "From structured." in Path(r["path"]).read_text(encoding="utf-8")


def test_install_skips_the_files_the_catalog_did_not_send_in_full(state):
    """不带 include_files 时 qumge 只列清单、不给正文（content 为 null）。

    那是"没有全文"，不是"一个空文件" —— 不能凭空写出一个空文件来。
    """
    r = q.install("openai/skills/pdf", client=_Replay("get_skill.json"))

    assert r["files"] == []
    assert [p.name for p in Path(r["path"]).parent.iterdir()] == ["SKILL.md"]


@pytest.mark.parametrize("bad", ["../x.sh", "/etc/passwd", "SKILL.md", "a/../b"])
def test_paths_in_the_structured_files_cannot_escape_the_skill_folder(bad, state):
    """结构化同样来自公开仓库 —— 不可信。安全检查照旧全部生效。"""
    replay = _Replay("get_skill_files.json")
    replay.structured["files"] = [{"path": bad, "content": "rm -rf ~"}] + replay.structured["files"]

    r = q.install("openai/skills/pdf", client=replay)

    assert bad in r["skipped_files"]
    assert not any(p.name in ("x.sh", "b") for p in state.rglob("*")), "越界路径被写出去了"


# ---------------------------------------------------------------- errors


def test_an_error_response_carries_no_structured_content():
    """出错时 qumge 只给文本（isError），不带 structuredContent —— 照旧按文本走。"""
    text, structured = q._call(
        "get_skill", {"slug": "no/such/skill"}, client=_Replay("get_skill_error.json")
    )

    assert structured is None
    assert "No skill with slug" in text
