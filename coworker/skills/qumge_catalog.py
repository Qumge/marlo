"""从 Qumge 的技能目录搜索和安装 —— 给【界面】用的那条路。

对话里 Marlo 自己找技能走的是 MCP（mcp__qumge__search_skills / get_skill）。这个
模块是同一个目录的另一个入口：用户在「技能」页里自己搜、自己装。

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


# 目录搜不到中文时会翻成英文再搜，表头写着实际搜的词：
#
#   5 skill(s) for "营销内容自动生成" (searched in English as "marketing content
#   generation"), best first:
#
# 【必须把它接出来给用户看】：不接的话，一个用中文搜的人得到一屏英文标题的结果，
# 没有任何东西解释这是怎么来的——也就没法判断翻得对不对。对话那条路上模型能读到
# 这句话，界面这条路上读不到，因为解析只看框内。
_TRANSLATED = re.compile(r'\(searched in English as "([^"]+)"\)')


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
    m = _TRANSLATED.search(text.split("\n", 1)[0])
    return {
        "results": out,
        "has_more": "more available" in text,
        # 没翻就是空串，界面据此决定显不显示那行说明。
        "searched_as": m.group(1) if m else "",
    }


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


def _split_front_matter(body: str) -> tuple[str, str, str]:
    """目录返回的是一整份 SKILL.md（自带 frontmatter）。SkillStore.create 要的是
    拆开的 name / description / instructions —— 它自己负责写 frontmatter。

    拆不出来就回退：name 用 slug 的末段，description 留空，全文当正文。一条
    frontmatter 写坏了的技能仍然应该能装上，只是列表里没有那句说明。"""
    name = description = ""
    instructions = body
    if body.startswith("---"):
        end = body.find("\n---", 3)
        if end != -1:
            for line in body[3:end].splitlines():
                if ":" not in line:
                    continue
                k, v = line.split(":", 1)
                k, v = k.strip().lower(), v.strip()
                if k == "name" and v:
                    name = v
                elif k == "description":
                    description = v
            instructions = body[end + 4 :].lstrip("\n")
    return name, description, instructions


def install(slug: str, *, client: Optional[httpx.Client] = None) -> dict[str, Any]:
    """把目录里的一条技能装成一个【普通的全局技能】。

    【为什么走 SkillStore 而不是自己写文件】原来这里是 mkdir + write_text，和上游
    的技能仓库各写各的。它们恰好写同一个目录（folder-is-truth），所以能看见彼此 ——
    但只是"能看见"：名字校验、作用域、重名处理、frontmatter 的形状，全是两套。
    两套迟早会分叉，而分叉的症状是"从目录装的技能在设置里表现得和别的不一样"。

    走 store 之后白拿：validate_name（64 字符上限 + 字符集）、重名报错而不是静默
    覆盖、source 字段（设置页的技能列表据此显示来源）、以及上游以后加的任何东西。
    """
    slug = (slug or "").strip()
    if not slug or slug.count("/") != 2:
        raise ValueError("slug 必须是 owner/repo/name 三段式")
    tail = slug.rsplit("/", 1)[-1]

    text = _call("get_skill", {"slug": slug}, client=client)
    body = _between_markers(text)
    if not body.strip():
        raise RuntimeError("目录返回的正文是空的")

    name, description, instructions = _split_front_matter(body)
    # frontmatter 里的 name 也来自目录（不可信）。validate_name 会拦掉不能做目录名
    # 的东西（含 ../ 的、超长的），但这里先用 slug 末段兜底：拆不出 name 时不能
    # 拿空字符串去建目录。
    name = name or tail

    from .store import SkillStore

    store = SkillStore()
    res = store.create(
        name=name,
        description=description,
        instructions=instructions,
        source=f"qumge:{slug}",
    )
    # create 返回的是【文件夹】，我们的契约一直是 SKILL.md 本身（调用方拿它去读
    # 刚装的内容）。补上文件名，别让接口跟着内部实现走。
    return {
        "ok": True,
        "name": res["name"],
        "slug": slug,
        "path": str(Path(res["path"]) / "SKILL.md"),
    }


def uninstall(name: str) -> dict[str, Any]:
    """同样走 SkillStore。

    原来这里自己 rmtree，带一段手写的越界检查（resolve 之后比对前缀）。store 的
    _folder_of 做同一件事而且更严：符号链接指到作用域外的，它当"不存在"处理而不是
    跟过去。两份等价的安全检查里，早晚有一份会漏掉后来加的情况。

    【两类失败必须分开】名字非法（../evil、带斜杠、超长）要【抛】—— 那是调用方
    传错了东西，静默当成"没装"会把一次越界尝试伪装成一次平常的未命中。而"确实
    没装"只是没装，返回 ok:False 就够。

    store.delete 对两者都抛，所以这里靠 validate_name 先把名字这一关单独走一遍：
    过不了的原样抛出，过了的再去删，删不到才算"没装"。
    """
    from .store import SkillStore, validate_name

    validate_name(name or "")  # 名字非法 -> ValueError，交给调用方
    try:
        SkillStore().delete(name.strip())
    except (FileNotFoundError, KeyError, ValueError):
        return {"ok": False, "name": name, "error": "not installed"}
    return {"ok": True, "name": name}
