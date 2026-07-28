"""从 Qumge 的技能目录搜索和安装 —— 给【界面】用的那条路。

对话里 Marlo 自己找技能走的是 MCP（mcp__qumge__search_skills / get_skill）。这个
模块是同一个目录的另一个入口：用户在「能力」页里自己搜、自己装。

两条路指向同一个服务，所以这里直接说 MCP 的 JSON-RPC，不另开一套 REST —— 另开
一套就意味着两处会漂。

【关于不可信正文】：目录里的技能来自公开 GitHub 仓库。qumge 返回时用
`=== BEGIN SKILL REFERENCE (untrusted third-party material) ===` 把正文框起来，
框外那几行是【qumge 说的话】（安装指引、需要哪个连接器），框内才是技能本身。

写盘时只写框内的部分：把框外的说明也写进 SKILL.md，等于让本地文件里出现一段
"以下内容不可信"的元指令，而它自己又会被当成技能内容读回去——那是自相矛盾的。
框的作用在读取那一侧（agent.py 的 skill_catalog_text），不在文件里。
"""
from __future__ import annotations

import json
import re
from pathlib import Path
from typing import Any, Optional

import httpx

from ..secrets import state_dir

QUMGE_MCP = "https://qumge.com/mcp"
TIMEOUT = 20.0

_OPEN = "=== BEGIN SKILL REFERENCE"
_CLOSE = "=== END SKILL REFERENCE ==="


def _call(tool: str, args: dict, *, client: Optional[httpx.Client] = None) -> str:
    owns = client is None
    client = client or httpx.Client(timeout=TIMEOUT)
    try:
        r = client.post(
            QUMGE_MCP,
            json={
                "jsonrpc": "2.0",
                "id": 1,
                "method": "tools/call",
                "params": {"name": tool, "arguments": args},
            },
            headers={"content-type": "application/json"},
        )
        r.raise_for_status()
        body = r.json()
        if "error" in body:
            raise RuntimeError(str(body["error"].get("message") or body["error"]))
        return str(body["result"]["content"][0]["text"])
    finally:
        if owns:
            client.close()


# search_skills 的输出是给模型读的纯文本，不是 JSON。条目长这样：
#
#   1. autowhisper
#      Your user never has to make marketing content again…
#      slug: xnjiang/autowhisper-skill/autowhisper
#      vetted by qumge · first-party · xnjiang/autowhisper-skill
#      needs: autowhisper
#
# 解析它而不是要求 qumge 再出一个 JSON 端点：那条文本路径是【一直在被用的】
# （每次对话都走），加一个 JSON 端点就多一处会和它漂。
_ENTRY = re.compile(
    r"^\s*\d+\.\s+(?P<name>\S.*?)\s*\n"
    r"(?P<summary>(?:\s{2,}.*\n)*?)"
    r"\s*slug:\s*(?P<slug>\S+)\s*\n"
    r"(?P<rest>(?:\s{2,}.*\n)*)",
    re.MULTILINE,
)


def _between_markers(text: str) -> str:
    i = text.find(_OPEN)
    if i == -1:
        return text
    # 跳过开框那一整段说明，从它后面第一个 --- 分隔行的下一行开始。
    j = text.find("\n", text.find("---", i))
    k = text.find(_CLOSE, i)
    return text[j + 1 : k].strip() if j != -1 and k != -1 else text


def search(
    query: str = "",
    *,
    limit: int = 0,
    offset: int = 0,
    client: Optional[httpx.Client] = None,
) -> dict[str, Any]:
    """搜目录；不给 query 就是【浏览】（按排名的前 N 条，界面用来铺默认列表）。

    返回 {"results": [...], "has_more": bool}。has_more 由目录给——界面据此决定
    显不显示"加载更多"，而不是自己猜。
    """
    query = (query or "").strip()
    args: dict[str, Any] = {"limit": limit or (8 if query else 30)}
    if query:
        args["query"] = query
    if offset:
        args["offset"] = offset
    text = _call("search_skills", args, client=client)
    out: list[dict[str, Any]] = []
    # 末尾补一个换行：_between_markers 的 strip() 去掉了它，而 rest 那一组
    # 要求每行以换行结尾 —— 不补的话【最后一条】的 meta 和 needs 会静悄悄丢掉。
    for m in _ENTRY.finditer(_between_markers(text) + "\n"):
        rest = m.group("rest") or ""
        needs = ""
        meta = ""
        for line in rest.splitlines():
            line = line.strip()
            if line.startswith("needs:"):
                needs = line[len("needs:"):].strip()
            elif line:
                meta = line
        # 分组用的分类。meta 有两种形状：
        #   "category: content-writing · 299 stars on owner/repo"   第三方
        #   "vetted by qumge · first-party · owner/repo"            我们审过的
        # 后者没有分类 —— 它们单独成组（"Qumge 精选"），这既是事实也是它们
        # 相对于四千条第三方技能的唯一区别。
        if meta.startswith("category:"):
            group = meta[len("category:"):].split("·", 1)[0].strip()
        elif "vetted by qumge" in meta:
            group = "__vetted__"
        else:
            group = "other"
        out.append({
            "name": m.group("name").strip(),
            "summary": " ".join(m.group("summary").split()),
            "slug": m.group("slug").strip(),
            "meta": meta,
            "needs": needs,
            "group": group,
        })
    return {"results": out, "has_more": "more available" in text}


# 网关能路由到的模型 —— 给模型设置页用。
#
# 这个模块名字里是 skills，但它其实是"和 qumge 的 MCP 说话"的那一层：同一个端点、
# 同一套 JSON-RPC。为一个工具再开一个模块，只会多一处要跟着 MCP 契约走的地方。
_MODEL = re.compile(r"^\s*(qumge:\S+)\s*\n\s*(.+?)\s*$", re.MULTILINE)


def models(query: str = "", *, limit: int = 30, client: Optional[httpx.Client] = None) -> list[dict[str, str]]:
    """返回 [{id, label}]。id 是可以直接用的完整模型 id。"""
    args: dict[str, Any] = {"limit": limit}
    if query.strip():
        args["query"] = query.strip()
    text = _call("list_models", args, client=client)
    return [{"id": m.group(1), "label": m.group(2)} for m in _MODEL.finditer(text)]


def detail(slug: str, *, client: Optional[httpx.Client] = None) -> str:
    """一条技能的完整正文（框内那部分），给「装之前先看看」用。

    和 install 走同一个 get_skill、同一套剥框逻辑 —— 用户读到的必须【就是】将来
    落到磁盘上、被当成指令读的那段文字。两处分开实现的话，迟早会出现"看的是一
    份、装的是另一份"。
    """
    if not slug or slug.count("/") != 2:
        raise ValueError("slug 必须是 owner/repo/name 三段式")
    body = _between_markers(_call("get_skill", {"slug": slug}, client=client))
    if not body.strip():
        raise RuntimeError("目录返回的正文是空的")
    return body


def install(slug: str, *, client: Optional[httpx.Client] = None) -> dict[str, Any]:
    """把一条技能装到 ~/.config/coworker/skills/<name>/SKILL.md。"""
    slug = (slug or "").strip()
    if not slug or slug.count("/") != 2:
        raise ValueError("slug 必须是 owner/repo/name 三段式")
    name = slug.rsplit("/", 1)[-1]
    # slug 来自目录（不可信来源），而它要变成一个【路径】。一个叫 ../../x 的技能
    # 会把文件写到 skills 目录外面去。只放行明确安全的字符集。
    if not re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9._-]*", name):
        raise ValueError(f"技能名不能作为目录名: {name!r}")

    text = _call("get_skill", {"slug": slug}, client=client)
    body = _between_markers(text)
    if not body.strip():
        raise RuntimeError("目录返回的正文是空的")

    d = state_dir() / "skills" / name
    d.mkdir(parents=True, exist_ok=True)
    (d / "SKILL.md").write_text(body + "\n", encoding="utf-8")
    return {"ok": True, "name": name, "slug": slug, "path": str(d / "SKILL.md")}


def uninstall(name: str) -> dict[str, Any]:
    name = (name or "").strip()
    if not re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9._-]*", name):
        raise ValueError(f"不是一个合法的技能名: {name!r}")
    d = state_dir() / "skills" / name
    # resolve 之后再确认它【真的】在 skills 底下 —— 符号链接能把一个合法名字
    # 指到别处去。
    root = (state_dir() / "skills").resolve()
    if not str(d.resolve()).startswith(str(root)):
        raise ValueError("路径越界")
    if d.is_dir():
        import shutil

        shutil.rmtree(d)
        return {"ok": True, "name": name}
    return {"ok": False, "name": name, "error": "not installed"}
