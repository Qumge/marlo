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


def _call(
    tool: str, args: dict, *, client: Optional[httpx.Client] = None
) -> tuple[str, Optional[dict[str, Any]]]:
    """调一次工具，返回 (文本, 结构化)。

    结构化是 qumge 随文本一起给的 structuredContent（工具在 tools/list 里用
    outputSchema 声明了它）。它给程序读，文本给模型读 —— 我们优先用结构化，只在
    它【没有】时退回解析文本：老版本 qumge、或者某次返回没带上，都不该让我们瞎。

    没有时返回 None。出错时（isError: true）qumge 本来就不带结构化，调用方照旧
    按文本处理。
    """
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
        result = body["result"]
        structured = result.get("structuredContent")
        # 只认对象。qumge 以后换形状的话，这里退回文本，不会把别的类型当结构化用。
        if not isinstance(structured, dict):
            structured = None
        return str(result["content"][0]["text"]), structured
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


# 表头的总数：`Showing 60 of 312 model(s) on the Qumge gateway, most used first.`
#
# 【为什么不能用老表头那个数】老表头是 `60 model(s) on the Qumge gateway`，而那个
# 60 就是【这次返回了几条】—— 问它要 5 条，它就说网关上有 5 个模型。limit 的上限
# 是 60，网关上远不止，所以总数只能由目录自己给。给不出就是 None，界面退回不报
# 总数的文案：不报，好过报一个假的。
_TOTAL = re.compile(r"^\s*Showing\s+\d+\s+of\s+(\d+)\b")


def _between_markers(text: str) -> str:
    i = text.find(_OPEN)
    if i == -1:
        return text
    # 跳过开框那一整段说明，从它后面第一个 --- 分隔行的下一行开始。
    j = text.find("\n", text.find("---", i))
    k = text.find(_CLOSE, i)
    return text[j + 1 : k].strip() if j != -1 and k != -1 else text


def _skill_md(text: str, structured: Optional[dict[str, Any]]) -> str:
    """get_skill 的 SKILL.md 正文：优先取结构化，没有就剥文本的框。

    两者是同一个东西 —— 同一个响应里的两个视图。用结构化只是不再依赖框的措辞。
    """
    if isinstance(structured, dict) and isinstance(structured.get("skill_md"), str):
        return structured["skill_md"]
    return _between_markers(text)


def _repo_slug(url: Any) -> str:
    """https://github.com/owner/repo -> owner/repo。拼展示文字时才用得到。"""
    if not isinstance(url, str):
        return ""
    m = re.match(r"https?://github\.com/([^/]+/[^/]+?)/?$", url.strip())
    return m.group(1) if m else ""


def _stars_tail(repo: str, stars: Any) -> str:
    """`N stars on owner/repo`（没有 repo 就只写星数）。拼 meta 时才用得到。"""
    if not isinstance(stars, int):
        return ""
    return f"{stars} stars on {repo}" if repo else f"{stars} stars"


def _search_meta_and_group(
    item: dict[str, Any], fallback: dict[str, Any]
) -> tuple[str, str]:
    """一条结果的展示文字（meta）和分组。

    【顺序要紧：先 vetted、后 category】精选条目【也带分类】—— 结构化比文本信息
    多，是有意为之。先看 category 的话，我们审过的那些会被当成普通第三方技能，
    「Qumge 精选」那一组就没了。文本那条路的语义也是这个次序。

    两个字段都要按【字段探测】：哪次返回带了就用哪次，没带就用文本那行兜底
    （老版本 qumge 两个都没有）。

    返回值里的 group 是界面用来分栏的：分类 key、"__vetted__"，或者 "other"。
    """
    if item.get("vetted") is True:
        repo = _repo_slug(item.get("source_url"))
        return " · ".join(p for p in ("vetted by qumge · first-party", repo) if p), "__vetted__"
    category = item.get("category")
    if isinstance(category, str) and category:
        repo = _repo_slug(item.get("source_url"))
        meta = " · ".join(p for p in (f"category: {category}", _stars_tail(repo, item.get("stars"))) if p)
        return meta, category
    if fallback.get("meta"):
        return str(fallback["meta"]), str(fallback.get("group") or "other")
    # 连文本都没有（不该发生）：结构化里能拼多少拼多少，分组退到 other。
    return _stars_tail(_repo_slug(item.get("source_url")), item.get("stars")), "other"


def _search_result(item: dict[str, Any], fallback: dict[str, Any]) -> dict[str, Any]:
    """一条结构化结果 -> Marlo 现有的返回形状（和文本解析那条路【逐字段一样】）。

    界面不知道这次数据是从哪来的：两条路都得给出同一组键、同样的值。needs 在结构
    化里是数组，这里 join 成文本里那种字符串（多条用逗号分隔）。
    """
    needs = item.get("needs")
    if isinstance(needs, list):
        needs = ", ".join(str(n) for n in needs)
    else:
        needs = str(fallback.get("needs", ""))
    meta, group = _search_meta_and_group(item, fallback)
    return {
        "name": str(item.get("name") or fallback.get("name", "")).strip(),
        "summary": " ".join(str(item.get("summary") or fallback.get("summary", "")).split()),
        "slug": str(item.get("slug") or fallback.get("slug", "")).strip(),
        "meta": meta,
        "needs": needs,
        "group": group,
    }


def _parse_search_text(text: str) -> list[dict[str, Any]]:
    """从文本里抠出每一条（老版本 / 没带结构化时的唯一来源）。

    结构化回来时这一份也照跑：分组字段还没有，而且它是结构化缺字段时逐条的兜底。
    """
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
    return out


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
    text, structured = _call("search_skills", args, client=client)

    parsed = _parse_search_text(text)
    results = structured.get("results") if isinstance(structured, dict) else None
    if isinstance(results, list):
        # 文本那份按 slug 索引，供结构化里缺字段（分组、needs…）时逐条兜底。
        by_slug = {r["slug"]: r for r in parsed}
        out: list[dict[str, Any]] = []
        for i, item in enumerate(results):
            fallback = by_slug.get(str(item.get("slug", "")) if isinstance(item, dict) else "")
            if fallback is None:
                fallback = parsed[i] if i < len(parsed) else {}
            out.append(_search_result(item, fallback) if isinstance(item, dict) else dict(fallback))
    else:
        out = parsed

    # has_more / 翻译说明：结构化里有就照它的，没有就退回文本那一句。
    if isinstance(structured, dict) and isinstance(structured.get("has_more"), bool):
        has_more = structured["has_more"]
    else:
        has_more = "more available" in text
    if isinstance(structured, dict) and "searched_in_english_as" in structured:
        translated = structured.get("searched_in_english_as")
        searched_as = translated if isinstance(translated, str) else ""
    else:
        m = _TRANSLATED.search(text.split("\n", 1)[0])
        searched_as = m.group(1) if m else ""
    return {
        "results": out,
        "has_more": has_more,
        # 没翻就是空串，界面据此决定显不显示那行说明。
        "searched_as": searched_as,
    }


# 网关能路由到的模型 —— 给模型设置页用。
#
# 这个模块名字里是 skills，但它其实是"和 qumge 的 MCP 说话"的那一层：同一个端点、
# 同一套 JSON-RPC。为一个工具再开一个模块，只会多一处要跟着 MCP 契约走的地方。
_MODEL = re.compile(r"^\s*(qumge:\S+)\s*\n\s*(.+?)\s*$", re.MULTILINE)


def _norm(s: str) -> str:
    """抹掉大小写和标点，用来比对"这段文字是不是那个厂商的名字"。

    OpenAI/openai、xAI/x-ai、Z.ai/z-ai —— 三种写法都要认成同一个。
    """
    return re.sub(r"[^a-z0-9]", "", s.lower())


def _vendor_slug(model_id: str) -> str:
    """qumge:anthropic/claude-opus-4.6 -> anthropic。

    厂商从 **id** 里取，不从 label 里取：id 的形状是网关自己的契约（它的说明里
    写着"qumge: 后面是 provider/model，缺了 provider 就拒绝"），而 label 的厂商
    前缀时有时无 —— 排在第一的那条就没有。
    """
    tail = model_id.split(":", 1)[1] if ":" in model_id else model_id
    return tail.split("/", 1)[0] if "/" in tail else ""


def _fmt_usd(value: Any) -> Optional[str]:
    """每 Mtok 的价格 -> "$5.00" 这样的展示写法。

    从【数字】格式化，不照抄目录文本里的写法：文本是给模型读的措辞，不是契约。
    取整规则可能和文本差一分钱（0.325 这种），可以接受 —— 价格是界面展示，本来就
    该由 Marlo 按自己的规则从数字渲染。
    """
    try:
        return f"{float(value):.2f}"
    except (TypeError, ValueError):
        return None


def _model_price(model: dict[str, Any]) -> str:
    """结构化里的两个数字 -> "$5.00/$25.00 per Mtok"；缺一个就返回空串。"""
    inp = _fmt_usd(model.get("input_price_per_mtok_usd"))
    outp = _fmt_usd(model.get("output_price_per_mtok_usd"))
    return f"${inp}/${outp} per Mtok" if inp is not None and outp is not None else ""


def models(
    query: str = "",
    *,
    limit: int = 30,
    client: Optional[httpx.Client] = None,
) -> dict[str, Any]:
    """返回 {"models": [...], "total": int | None}。

    每条模型是 {id, name, vendor, price, vision, label}：id 可以直接用，其余几个是
    把 label 那一整串拆开的结果。

    【为什么拆】界面要把它们排成不同的列：名字是主角，厂商和价格是次要信息。
    糊成一个字符串的话，每个调用方都得自己再拆一遍,而拆法散在各处必然会漂。
    label 原样留着当兜底。

    【total 是网关上的总数，不是这次返回了几条】limit 上限是 60，而网关上远不止
    ——「还有多少个」这件事界面自己数不出来，只能由目录给。
    """
    args: dict[str, Any] = {"limit": limit}
    if query.strip():
        args["query"] = query.strip()
    text, structured = _call("list_models", args, client=client)

    # 文本那份按 id 索引：老版本 / 没带结构化时它是唯一来源，结构化少了某个字段时
    # 它也是逐条的兜底。
    text_rows = [(m.group(1), m.group(2)) for m in _MODEL.finditer(text)]
    by_id: dict[str, dict[str, Any]] = {}
    for mid, label in text_rows:
        parts = [p.strip() for p in label.split(" · ")]
        by_id[mid] = {
            "head": parts[0] if parts else label,
            # 价格靠 $ 认，不靠位置：没有 vision 那一段的模型（60 条里有 13 条）
            # 位置就错了一位，而错位的结果是把 "vision" 当成价格显示出去。
            "price": next((p for p in parts[1:] if p.startswith("$")), ""),
            "vision": "vision" in parts,
            "label": label,
        }

    # 每行统一成 (id, 展示名, 厂商 slug, 价格, 是否支持图片, 原样 label)。
    rows: list[tuple[str, str, str, str, bool, str]] = []
    smodels = structured.get("models") if isinstance(structured, dict) else None
    if isinstance(smodels, list):
        for m in smodels:
            if not isinstance(m, dict):
                continue
            mid = str(m.get("id") or "")
            fb = by_id.get(mid, {})
            slug = str(m.get("provider") or _vendor_slug(mid))
            head = str(m.get("name") or fb.get("head") or "")
            price = _model_price(m) or str(fb.get("price", ""))
            vision = m.get("vision") if isinstance(m.get("vision"), bool) else bool(fb.get("vision"))
            label = str(fb.get("label") or " · ".join(p for p in (head, price, "vision" if vision else "") if p))
            rows.append((mid, head, slug, price, vision, label))
    else:
        for mid, label in text_rows:
            fb = by_id[mid]
            rows.append((mid, fb["head"], _vendor_slug(mid), fb["price"], fb["vision"], label))

    # slug -> 好看的厂商名，从这一批（展示名，结构化里也带着厂商前缀）自己学出来。
    # 把 slug 首字母大写会得到 "Openai"、"X-ai"、"Z-ai"，而目录里写的是
    # OpenAI / xAI / Z.ai。学出来的表还能补上目录漏掉前缀的那几条，并且 qumge
    # 以后加新厂商时不用我们跟着改表。
    vendors: dict[str, str] = {}
    for mid, head, slug, _price, _vision, _label in rows:
        if slug and ": " in head:
            pre = head.split(": ", 1)[0].strip()
            # 【只认对得上 id 的那一段】靠"出现了冒号"来判断的话，一个叫
            # "GPT-5: Turbo" 的模型会被拆成厂商 GPT-5、名字 Turbo。
            if _norm(pre) == _norm(slug):
                vendors.setdefault(slug, pre)

    out: list[dict[str, Any]] = []
    for mid, head, slug, price, vision, label in rows:
        name = head
        if ": " in name and _norm(name.split(": ", 1)[0]) == _norm(slug):
            name = name.split(": ", 1)[1].strip()
        out.append({
            "id": mid,
            "name": name,
            "vendor": vendors.get(slug, slug),
            "price": price,
            "vision": vision,
            "label": label,
        })
    if isinstance(structured, dict) and isinstance(structured.get("total"), int):
        total: Optional[int] = structured["total"]
    else:
        m = _TOTAL.match(text)
        total = int(m.group(1)) if m else None
    return {"models": out, "total": total}


def detail(slug: str, *, client: Optional[httpx.Client] = None) -> str:
    """一条技能的完整正文（框内那部分），给「装之前先看看」用。

    和 install 走同一个 get_skill、同一套剥框逻辑 —— 用户读到的必须【就是】将来
    落到磁盘上、被当成指令读的那段文字。两处分开实现的话，迟早会出现"看的是一
    份、装的是另一份"。
    """
    if not slug or slug.count("/") != 2:
        raise ValueError("slug 必须是 owner/repo/name 三段式")
    text, structured = _call("get_skill", {"slug": slug}, client=client)
    # 结构化里 skill_md 就是框内那段正文（和 _between_markers(text) 同一个东西）。
    # 结构化没带时才剥文本。
    body = _skill_md(text, structured)
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


# 【整目录】（2026-09-14）qumge 的 get_skill 在 SKILL.md 那段之后，给技能目录里的
# 每个其他文件各一段、各自带框：
#
#   === BEGIN SKILL REFERENCE (untrusted third-party material) ===
#   ...
#   --- file: scripts/fill_form.py ---
#   <文件内容>
#   === END SKILL REFERENCE ===
#
# 正文会让 agent 去读同目录的 FORMS.md、跑 scripts/…。只装 SKILL.md 等于装半个技能 ——
# qumge 的判分实测把 anthropics/skills/pdf 判成「单独装不上」，就是因为这个。
#
# SKILL.md 那段永远是第一段（_between_markers 只取它），所以老版本的解析照旧只拿到
# 正文；附带文件由下面这几个函数另外处理。
_FILE_HEADER = re.compile(r"^--- file: (.+?) ---$", re.MULTILINE)
MAX_EXTRA_FILES = 60
MAX_EXTRA_BYTES = 2_000_000


def _file_sections(text: str) -> list[tuple[str, str]]:
    """SKILL.md 那段之后每个「--- file: <path> ---」段 → (path, 内容)。"""
    out: list[tuple[str, str]] = []
    first_close = text.find(_CLOSE)
    if first_close == -1:
        return out
    pos = first_close + len(_CLOSE)
    while True:
        opening = text.find(_OPEN, pos)
        if opening == -1:
            return out
        closing = text.find(_CLOSE, opening)
        if closing == -1:
            return out
        header = _FILE_HEADER.search(text, opening, closing)
        if header:
            body = text[header.end() : closing]
            body = body[1:] if body.startswith("\n") else body
            out.append((header.group(1).strip(), body.rstrip("\n") + "\n"))
        pos = closing + len(_CLOSE)


def _structured_file_sections(
    structured: Optional[dict[str, Any]]
) -> Optional[list[tuple[str, str]]]:
    """结构化里的附带文件 -> [(path, 内容)]；没有 files 字段就返回 None。

    content 为 null 的项跳过：不带 include_files 时 qumge 只列清单、不给全文，
    那不是"一个空文件"。返回 None（而不是 []）是为了和"有 files 字段但一条都
    没给全"区分开 —— 前者才退回解析文本。

    路径和内容都来自公开仓库，和文本那条路一样【不可信】：这一步只做搬运，越界
    路径、数量和体量上限由 _write_extra_files 照旧把关。
    """
    if not isinstance(structured, dict) or not isinstance(structured.get("files"), list):
        return None
    out: list[tuple[str, str]] = []
    for f in structured["files"]:
        if not isinstance(f, dict):
            continue
        path, content = f.get("path"), f.get("content")
        if not isinstance(path, str) or not isinstance(content, str):
            continue
        # 和文本那条路同一个收尾，两条路写出来的字节才会一模一样。
        out.append((path, content.rstrip("\n") + "\n"))
    return out


def _safe_parts(raw: str) -> Optional[list[str]]:
    """目录给的路径（不可信）→ 技能文件夹内的相对路径片段；可能越界的一律 None。

    同 slug 那条：这串字来自公开仓库，而它要变成磁盘上的路径。"""
    if not raw or len(raw) > 240 or "\\" in raw or raw.startswith("/") or re.match(r"^[A-Za-z]:", raw):
        return None
    parts = raw.split("/")
    if any(p in ("", ".", "..") for p in parts):
        return None
    if len(parts) == 1 and parts[0].lower() == "skill.md":
        return None  # SKILL.md 由 SkillStore 写（带 frontmatter 和 source），附带文件不许盖掉它
    return parts


def _write_extra_files(folder: Path, sections: list[tuple[str, str]]) -> tuple[list[str], list[str]]:
    """把附带文件写进刚建好的技能文件夹。返回 (写了的, 跳过的)。

    只写内容、不设执行位 —— 脚本要跑，照常走 run_shell 的审批。"""
    written: list[str] = []
    skipped: list[str] = []
    total = 0
    root = folder.resolve()
    for index, (raw, content) in enumerate(sections):
        parts = _safe_parts(raw)
        data = content.encode("utf-8")
        if parts is None or index >= MAX_EXTRA_FILES or total + len(data) > MAX_EXTRA_BYTES:
            skipped.append(raw)
            continue
        target = root.joinpath(*parts).resolve()
        if not target.is_relative_to(root):  # 例如文件夹里某一层是指向外面的符号链接
            skipped.append(raw)
            continue
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_bytes(data)
        total += len(data)
        written.append("/".join(parts))
    return written, skipped


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

    # include_files：附带文件的全文要显式要（qumge 默认只列清单 —— 通用 agent 调 get_skill
    # 的返回会进模型上下文）。这里是本地解析后写盘，不进上下文，所以要全量。
    text, structured = _call("get_skill", {"slug": slug, "include_files": True}, client=client)
    body = _skill_md(text, structured)
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
    # 附带文件写在 SkillStore 建好的文件夹里（store.create 只写 SKILL.md，而 store 是上游的
    # 文件 —— 按 overlay 规矩，我们的东西放在自己的模块里）。
    sections = _structured_file_sections(structured)
    if sections is None:
        sections = _file_sections(text)
    files, skipped = _write_extra_files(Path(res["path"]), sections)
    # create 返回的是【文件夹】，我们的契约一直是 SKILL.md 本身（调用方拿它去读
    # 刚装的内容）。补上文件名，别让接口跟着内部实现走。
    return {
        "ok": True,
        "name": res["name"],
        "slug": slug,
        "path": str(Path(res["path"]) / "SKILL.md"),
        "files": files,
        "skipped_files": skipped,
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


# 用途包（bundles / install_bundle，对应 qumge 的 list_bundles / get_bundle）
# 2026-09-14 撤掉：手工拼的「一组技能干成一件事」挑得不准，「技能」页只列技能。
