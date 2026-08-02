#!/usr/bin/env python3
"""界面上写死的英文字符串不能再增加。

0.3.8 的中文界面里，「自动化」整页是英文，设置页 28 处、上手引导 19 处。而它们
不是一次疏忽——107 个组件里只有 41 个走了 i18n，也没有任何东西拦着新写的英文。
今天补完一页，明天写新界面时又会漏回去。

【棘轮，不是一刀切】：现存的写死字符串记在 i18n_baseline.txt 里，这个检查只拦
【新增】。一次性全拦会把所有开发堵死，然后被人加进白名单绕过去——那张表一旦变
便宜就没用了（改名守卫的注释里写着同一件事）。

判据是"它会被人读到"，所以只看两处：
  1. JSX 的文本节点：>Save changes<
  2. 面向用户的属性：placeholder / title / aria-label

不看 className、data-testid、href 这些——它们是给机器看的，翻译它们只会弄坏东西。
"""
from __future__ import annotations

import json
import re
import sys
from pathlib import Path

# Windows 的控制台默认 cp1252，编码不了中文 —— 守卫会因为【自己的提示语】崩掉，
# 报出来的是 UnicodeEncodeError，和它要检查的事情毫无关系（CI 上实测过一次）。
# 一个因为打印失败而挂掉的检查器，比没有检查器更让人困惑。
for _s in (sys.stdout, sys.stderr):
    try:
        _s.reconfigure(encoding="utf-8", errors="replace")
    except (AttributeError, ValueError):  # 非 TTY / 老版本
        pass

ROOT = Path(__file__).resolve().parent.parent
SRC = ROOT / "surfaces" / "gui" / "src"
BASELINE = Path(__file__).resolve().parent / "i18n_baseline.txt"

# JSX 文本节点：>Some words< —— 至少两个词，或一个首字母大写的词。
# 两个否定环视排掉类型签名：`=> Promise<boolean>` 里的 Promise 不是界面文字，
# 而第一版把它算了进来（基线里躺着 5 条 Promise）。同一个错我在替换脚本里也
# 犯过，那次是把 `=> Promise<void>` 改成了 `=> {t("…")}<void>`，直接编译不过。
#   (?<![=!<>-])>  前一个字符不是 = ! < > -（排除 =>、->）
#   <(?![A-Za-z])  后面不是标识符（排除泛型 <boolean>、<T>）
_TEXT = re.compile(
    r"(?<![=!<>-])>\s*([A-Z][A-Za-z]*(?:[  ][A-Za-z][A-Za-z'’,.!?—-]*){0,10})\s*<(?![A-Za-z])"
)
# 面向用户的属性
_ATTR = re.compile(r'\b(?:placeholder|title|aria-label)="([^"{}]{2,80})"')

# 【守卫的第三个盲区】：JSX 文本节点的 `>` 和文字【不在同一行】——
#
#   <button
#     className="..."
#     onClick={...}
#   >
#     Use your own API key instead
#   </button>
#
# 上面两条正则都是【逐行】跑的（scan 里 for line in splitlines），所以只要元素带
# 属性、Prettier 一换行，它的文字就彻底看不见了。而带属性的多行元素是这个代码库
# 里最常见的形状。
#
# 后果实测：0.4.1 发出去之后，上手引导第一屏（新用户看到的第一个界面）整段是
# 英文——"Connect to Qumge to get started…"、"Use your own API key instead"、
# "Skip setup"——而守卫报的是"基线 29 条，无新增"。同一个文件里 welcomeTo 和
# beta 是走 t() 的，所以连"这个文件没做 i18n"都不成立。
#
# 这是守卫第二次给出虚假的安心（第一次是下面的数据数组）。一个有盲区的守卫比没有
# 守卫更糟：它让人以为已经做完了。
#
# 修法：整份文件按 > … < 匹配一次，允许中间跨行。不能直接放宽上面的 _TEXT ——
# 那条逐行跑还有行号可报。
# 【跨行 + 含表达式】。_TEXT_ML 的字符类里排掉了 {}，_INTERP 又是逐行的，于是
#
#   <div className="…">
#     Marlo v{update.version} is ready to install.
#   </div>
#
# 两条都看不见。2026-07-28 清完 219 条、守卫报 0 之后，是【渲染出来扫 DOM】那把
# 尺子把它逮住的 —— 源码那把尺子当时是全绿的。两把独立的尺子，这就是理由。
_TEXT_ML_INTERP = re.compile(
    r"(?<![=!<>-])>\s*\n\s*([^<>\n]*\{[^{}\n]*\}[^<>\n]*)\s*\n\s*<(?![A-Za-z])"
)

_TEXT_ML = re.compile(
    r"(?<![=!<>-])>\s*\n\s*([A-Z\u2018\u2019\u201c\u201d][^<>{}\n]{2,120}?)\s*\n\s*<(?![A-Za-z])"
)

# 【第五、第六个盲区】：JSX 文本被 {expr} 截断，以及裸字符串字面量。
#
#   <div>Marlo v{update.version} is ready to install.</div>     ← 被表达式截断
#   {busy ? "Downloading…" : "Restart to update"}               ← 三元里的字面量
#   setToast("Stopped: max iterations reached.")                ← 传给函数的字面量
#
# 前四条规则都是在给"英文出现的形状"列清单，而 JSX 的形状列不完 —— 每补一条就
# 又冒出一种。这两条改成【反过来】：默认全抓，靠 ALLOWED 和下面的排除规则收敛。
#
# ATTR_KILL 把代码属性的【整个值】挖掉（className / data-testid / d / viewBox…）。
# 只挖属性名是不够的：值还留在行里，会被当成文案（第一版就是这样，1129 条噪声）。
_ATTR_KILL = re.compile(
    r'\b(?:className|data-testid|key|id|href|src|role|type|xmlns|d|viewBox|fill|stroke|style)'
    r'\s*=\s*"[^"]*"'
)
_BARE = re.compile(r'"([^"\n]{4,300})"')
_INTERP = re.compile(r"(?<![=!<>-])>([^<>\n]*\{[^{}\n]*\}[^<>\n]*)<(?![A-Za-z])")
_ENG = re.compile(r"\b[A-Za-z]{2,}\b")


def _looks_like_prose(s: str) -> bool:
    """是给人读的句子，还是代码？"""
    s = s.strip()
    if len(_ENG.findall(s)) < 2:
        return False
    if re.fullmatch(r"[a-z0-9_\-./:\s]+", s):          # id / 路径 / 事件名
        return False
    if s.startswith(("http", "/", "./", "../", "#")):
        return False
    if re.search(r"[{}<>=;]|\bpx-|\btext-\[|\bflex\b|rounded|border-", s):  # 残留的 css
        return False
    if re.search(r"[()\[\]]\s*[?&|.]|[?&|]\s*[\w.]+\(|\)\s*$|^\s*\)", s):  # 跨过代码匹配出来的
        return False
    # tailwind 类名串（"bg-accentSoft text-accent font-semibold"）：每个词都是
    # 一个类。上面那条只挡了 text-[…] 这种带方括号的，挡不住 text-warnInk。
    if all(re.fullmatch(r"[a-z][\w-]*(?:-[\w./\[\]%]+)?|!?[a-z]+-[\w./\[\]%]+", w)
           for w in s.split()) and re.search(r"-", s):
        return False
    # 逗号分隔的扩展名/mime 列表（<input accept=…>）
    if re.fullmatch(r"[\w*/.,\s-]+", s) and s.count(",") >= 2:
        return False
    # npm 包名
    if s.startswith("@") and "/" in s:
        return False
    # 以逗号或运算符【开头】的：正则从一个字符串的收尾引号吃到下一个的开头引号，
    # 中间那截是代码（`, path: d.path ||`）。真正的文案不会这么开头。
    if re.match(r"^\s*[,;:|&?]", s) or re.search(r"(\|\||&&|\?\?)\s*$", s):
        return False
    return True


# 【守卫的第四个盲区】：模板字符串。
#
#   {`Connect ${c.title} with one click`}
#   title={`${n} awaiting your attention`}
#
# 反引号里的英文照样渲染给用户看，而上面三条正则一条都匹配不到（它们只认双引号和
# >…<）。2026-07-28 owner 截图问"模态框标题怎么是英文"时，界面上是「连接 Google
# Calendar」旁边一个英文按钮 —— 全中文界面里夹着英文，而守卫报"无新增"。
#
# 判据：反引号里【去掉所有 ${...} 之后仍然有英文单词】。纯插值（`${a}:${b}`）、
# 路径、URL、className 不算。
_TPL = re.compile(r"`([^`\n]*\$\{[^`\n]*)`")
_TPL_BAD = re.compile(r"(className|data-testid|aria-|key=|/v1/|https?://|\.json|Bearer )")
_TPL_WORD = re.compile(r"[A-Za-z]{3,}\s")

# 【守卫的盲区】：写死的界面文字不只在 JSX 里，也在【数据数组】里 ——
#
#   const SET_TABS = [{ key: "models", label: "Models", ... }]
#   const TEMPLATES = [{ title: "GitHub digest", blurb: "Merged PRs and ..." }]
#
# 它们照样渲染给用户看，但既不是 JSX 文本也不是属性，上面两条正则都扫不到。
# 0.4.0 发出去之后 owner 一眼看到设置页左栏和自动化模板还是英文 —— 而守卫报的是
# "无新增"。一个有盲区的守卫会让人以为已经做完了。
_DATA = re.compile(r'\b(?:label|title|blurb|name|description|summary|hint)\s*:\s*"([^"]{3,90})"')

# 这些不是界面文案：专名、协议词、单位、以及只由符号/数字组成的。
# 【第七个盲区，在判据本身】：下面第一条原来写的是 `^(Marlo|Qumge|…)\b` ——
# 【任何以品牌名开头的句子都被豁免】。于是 "Marlo v{update.version} is ready to
# install." 这种整句英文，只因为第一个词是 Marlo 就彻底隐形。
#
# 白名单要豁免的是"这个字符串【就是】一个专名"，不是"它以专名开头"。改成：把所有
# 专名抠掉之后，剩下的英文单词少于两个才豁免。
_BRANDS = re.compile(
    r"\b(Marlo|Qumge|OpenWorker|Gmail|Slack|Notion|GitHub|GitLab|Jira|Outlook|"
    r"Telegram|Discord|WhatsApp|Dropbox|Box|Stripe|Asana|HubSpot|Linear|Figma|"
    r"Canva|Zendesk|Confluence|QuickBooks|DocuSign|ClickUp|Attio|PostHog|Mixpanel|"
    r"Amplitude|Apollo|Hunter|AutoWhisper|MCP|IMAP|SMTP|OAuth|API|URL|JSON|PDF|"
    r"Ollama|Claude|OpenAI|Anthropic|Gemini|DeepSeek|Windows|macOS|Word|Excel|"
    r"Google|Calendar|Bedrock|Vertex|OpenRouter)\b"
)


def _brands_only(s: str) -> bool:
    """抠掉所有专名之后，还剩下句子吗？"""
    rest = _BRANDS.sub(" ", s)
    return len(re.findall(r"\b[A-Za-z]{2,}\b", rest)) < 2


ALLOWED = [
    re.compile(r"^(Marlo|Qumge|OpenWorker|Gmail|Slack|Notion|GitHub|GitLab|Jira|Outlook|"
               r"Telegram|Discord|WhatsApp|Dropbox|Box|Stripe|Asana|HubSpot|Linear|Figma|"
               r"Canva|Zendesk|Confluence|QuickBooks|DocuSign|ClickUp|Attio|PostHog|Mixpanel|"
               r"Amplitude|Apollo|Hunter|AutoWhisper|MCP|IMAP|SMTP|OAuth|API|URL|JSON|PDF|"
               r"Ollama|Claude|OpenAI|Anthropic|Gemini|DeepSeek|Windows|macOS|Word|Excel)\b"),
    re.compile(r"^[\W\d]+$"),
    # 域名（provider 的控制台地址）：console.anthropic.com、platform.openai.com…
    # 翻译它们等于给用户一个打不开的地址。
    re.compile(r"^[a-z0-9-]+(\.[a-z0-9-]+)+$"),
    # 连接器/厂商的品牌名。翻了会让人对不上自己在别处见到的那个东西。
    # 内置角色名（Coworker / Chat / Code）。它们和【用户自定义的 persona 名】走同一
    # 条渲染路径 —— 那一处套 t() 的话，找不到键的自定义名字（Ops、我的助理…）会
    # 直接消失。测试抓到过一次：Ops 不见了。要翻它们得先把两条路径分开。
    re.compile(r"^(Coworker|Chat|Code)$"),
    # 已经是 i18n 键了：camelCase、无空格（tplGithubDigest、navModels）。
    # 数据数组里存【键】而不是英文，渲染时才 t(key) —— 常量因此保持纯数据，
    # 不需要 hook。守卫认不出这一点的话，会把已经做完的事再报一遍。
    re.compile(r"^[a-z][a-zA-Z0-9]*$"),
    # 全小写、无空格的：连接器 id / provider key（gmail、google_calendar、slack）。
    # 它们出现在 name: "gmail" 这种字段里 —— 是 key 不是文案，翻了会让查找失败。
    re.compile(r"^[a-z][a-z0-9_-]*$"),
    # SVG 的 preserveAspectRatio 值、打包器的 worker 路径：都是给机器看的。
    re.compile(r"^(xMidYMid slice|pdfjs-dist/.*)$"),
    # 模拟 Slack 截图里那个虚构的工作区名（和 Emma W / Priya N 同一类）。
    re.compile(r"^Lumina Labs$"),
    # 路径和快捷键：翻了就不对了。~/Marlo 是真实目录名，/path/to/your/project 是
    # 让人照着替换的样例，Esc 是键帽上印的字。
    re.compile(r"^(~/Marlo|/path/to/your/project|Esc)$"),
    # SlackHowItWorks 里那张【模拟 Slack 截图】的外壳：人名、频道输入框、APP 徽章。
    # 消息正文已经翻了（那是在演示 Marlo 做什么，中文用户要读得懂）；外壳保留英文
    # 是因为它要看起来像一张 Slack 截图 —— 组件注释里写着这是刻意的。
    re.compile(r"^(Emma W|Priya N|APP|Message #launch-room)$"),
    re.compile(r"^(Clay|Close|Descript|Docusign|Salesforce|Together AI|Fireworks AI|"
               r"Z AI \(GLM\)|Kimi \(Moonshot AI\)|Qwen \(Alibaba\)|xAI \(Grok\)|"
               r"MiniMax|Meta \(Muse Spark\)|Connector)$"),
]


# 【两把尺子的边界】2026-08-01 起，界面英文有两条翻译路径：
#
#   t("key")  —— 我们自己写的组件。键比原文稳定，支持带参数的函数值。这把尺子管它。
#   tx(原文)  —— 上游的 JSX，由构建期 transform 自动包起来（i18n-transform.ts），
#                译文按【原文】索引存在 i18n/zh-text.ts。那把尺子是
#                packaging/check_i18n_text.mjs，判据和 transform 共用一份 AST 规则。
#
# 走第二条路的字符串，在源码里【就是裸英文】—— 那正是它的目的：上游的文件一个字节
# 都不改，合并才不冲突。所以这把尺子看到它们必须闭嘴，否则两把尺子会互相要求对方
# 不可能满足的事：这把要求"改成 t()"，那把要求"保持原文"。
#
# 判据是"zh-text.ts 里有没有它"，不是"在哪个文件里"：翻过了就是翻过了，走哪条路
# 不改变用户看到的东西。
def _by_text_translated() -> set[str]:
    p = SRC / "i18n" / "zh-text.ts"
    if not p.is_file():
        return set()
    out = set()
    for m in re.finditer(r'^\s{2}("(?:[^"\\]|\\.)*")\s*:', p.read_text(encoding="utf-8"), re.M):
        try:
            out.add(json.loads(m.group(1)))
        except ValueError:
            pass
    return out


_BY_TEXT = _by_text_translated()


def _allowed(s: str) -> bool:
    """豁免吗？专名【组成的】字符串豁免；以专名【开头的句子】不豁免。"""
    if s in _BY_TEXT:
        return True
    # 【第十一类假阳性】JSX 文本被 {expr} 截断时，这把尺子报的是【整段】
    #   >Bundled files: {upload.files.join(", ")}<
    # 而 AST 那把尺子（check_i18n_text.mjs）看到的是被表达式切开的真实文本节点
    #   "Bundled files:"   ← 它已经在 zh-text.ts 里了
    # 两把尺子对同一处给出不同的字符串，结果是一条【永远改不掉】的记录：按这里报的
    # 去翻，AST 那边不认；按那边翻了，这里还在报。
    #
    # 判据：按【表达式切开】之后的每一段，都要在 zh-text.ts 里。
    #
    # 粒度很重要，第一版写错过：把整段拼成一个字符串去查表。AST 那边看到的是
    #   "Marlo v{u.version} is ready to install."  ->  ["Marlo v", "is ready to install."]
    # 两个独立的文本节点、两个独立的键。拼起来查等于查一个不存在的键，于是
    # 「翻过了的」不被豁免，而「只翻了一半的」反而可能蒙混过关。
    if "{" in s:
        parts = [p.strip() for p in re.split(r"\{[^{}]*\}", s)]
        parts = [p for p in parts if re.search(r"[A-Za-z]{2}", p)]
        if parts and all(p in _BY_TEXT for p in parts):
            return True
    # 文件选择器的 accept 值（".zip,.md"）：给浏览器看的，翻了会让上传框失效。
    if re.fullmatch(r"\.[a-z0-9]+(\s*,\s*\.[a-z0-9]+)*", s.strip()):
        return True
    # 【第十二类假阳性】嵌套的模板字符串。_TPL 是非贪婪地找一对反引号，遇到
    #   `/${skill}${text ? ` ${text}` : ""}`
    # 会在【内层】那个反引号处截断，报出半截 "`/${skill}${text ?`"。
    # 那半截既不是文案也不可能被翻译 —— 它是一条永远改不掉的记录。
    # 判据是【括号不配对】，不是"剩下没有英文单词" —— 后者试过，不成立：截断后
    # 剩下的 skill、text 是变量名，长得和英文单词一模一样。而 ${ 比 } 多，是
    # "这段是从中间切开的"的直接证据，一段完整的文案不会这样。
    # 必须【本身含 ${】才算模板串片段。第一版只比 ${ 和 } 的个数，于是
    # "Marlo v{u.version} is ready to install." 也被豁免了（它有一个 } 没有 ${）——
    # 那是 JSX 插值不是模板串，而且是这个守卫最经典的一条命中，守卫自己的测试
    # 当场变红。判据要同时满足：是模板串，且括号不配对。
    if "${" in s and s.count("${") != s.count("}"):
        return True
    if _brands_only(s):
        return True
    return any(a.match(s) for a in ALLOWED[1:])


def _is_test(p: Path) -> bool:
    return ".test." in p.name


# 【JSX 块注释】。逐行那几条规则会跳过以 // 开头的行，也会切掉行尾的 //，但
# {/* … */} 一条都挡不住 —— 它既不以 // 开头，里面的散文又长得和界面文案一模一样。
#
#   {/* The bar is the context-window fill; pairing it with the session TOTAL read as
#       "total is N% of the window", which it never was. */}
#
# 上游 0.1.7 带进来这一段，守卫就报了一条【永远改不掉】的："total is N% of the window"。
# 它不在界面上，翻译它没有意义，加进 ALLOWED 是把一条注释写进白名单——两条路都不对。
#
# 这是假阳性，方向和前面九个盲区相反，但代价一样：一个会报不存在的问题的守卫，
# 和一个会漏真问题的守卫，都在教人忽略它。
_JSX_COMMENT = re.compile(r"\{\s*/\*.*?\*/\s*\}", re.S)


def scan() -> list[str]:
    found: list[str] = []
    for path in sorted(SRC.rglob("*.tsx")):
        if _is_test(path):
            continue
        text = _JSX_COMMENT.sub("", path.read_text(encoding="utf-8"))
        # as_posix()：Windows 上分隔符是反斜杠，而基线里存的是正斜杠 —— 不统一
        # 的话整份基线在那个平台上全被当成新增（CI 实测 184 条全报，构建挂掉）。
        rel = path.relative_to(SRC).as_posix()
        # 跨行的文本节点：整份文件扫一次（逐行永远看不到它们）。
        for m in _TEXT_ML_INTERP.finditer(text):
            body = m.group(1)
            plain = re.sub(r"\{[^{}]*\}", " ", body).strip()
            if _looks_like_prose(plain) and 't("' not in body:
                sm = " ".join(body.split())
                if not _allowed(sm):
                    found.append(f"{rel}: >{sm}<")
        for m in _TEXT_ML.finditer(text):
            sm = " ".join(m.group(1).split())
            if len(sm) >= 3 and not _allowed(sm):
                found.append(f"{rel}: {sm}")
        for lineno, line in enumerate(text.splitlines(), 1):
            stripped = line.strip()
            if stripped.startswith(("//", "*", "/*")):
                continue
            # 【行尾注释也要切掉】。原来只跳过整行注释，于是
            #   create?: boolean; // "New project" mode: …
            # 里那个引号字符串被当成了界面文案。替换脚本已经只改代码部分，守卫
            # 这边漏了同一件事 —— 两边判据不一致，守卫就会报一条永远改不掉的。
            j = line.find("//")
            if j != -1:
                line = line[:j]
            clean = _ATTR_KILL.sub("", line)
            for m in _BARE.finditer(clean):
                sm = m.group(1).strip()
                if _looks_like_prose(sm) and not _allowed(sm):
                    found.append(f"{rel}: {sm}")
            for m in _INTERP.finditer(clean):
                body = m.group(1)
                plain = re.sub(r"\{[^{}]*\}", " ", body).strip()
                if _looks_like_prose(plain) and 't("' not in body:
                    sm = " ".join(body.split())
                    if not _allowed(sm):
                        found.append(f"{rel}: >{sm}<")
            if not _TPL_BAD.search(line):
                for m in _TPL.finditer(line):
                    body = m.group(1)
                    plain = re.sub(r"\$\{[^}]*\}", " ", body)
                    if _TPL_WORD.search(plain) and 't("' not in body:
                        sm = " ".join(body.split())
                        if not _allowed(sm):
                            found.append(f"{rel}: `{sm}`")
            for m in (*_TEXT.finditer(line), *_ATTR.finditer(line), *_DATA.finditer(line)):
                s = m.group(1).strip()
                if len(s) < 3 or _allowed(s):
                    continue
                found.append(f"{rel}: {s}")
    return sorted(set(found))


def main() -> int:
    # 【验扫描器，不是验数量】。
    #
    # 原来这里写的是"扫出的条数 < 20 就报错"，用来抓"SRC 路径改了、什么都没扫到"。
    # 但它把【没东西可找】和【找的方式坏了】当成同一件事 —— 2026-07-28 把欠账从
    # 162 条清到 1 条时，这个检查立刻把构建挂掉了，理由是"形同虚设"。
    #
    # 要防的失效是"路径不对"，而它直接表现为【一个文件都没读到】。所以量文件数，
    # 不量命中数：命中数归零是这个守卫成功的样子，不该是它失败的样子。
    files = [p for p in SRC.rglob("*.tsx") if not _is_test(p)]
    if len(files) < 50:
        print(f"只扫到 {len(files)} 个 .tsx —— 路径大概不对（SRC={SRC}）", file=sys.stderr)
        return 1

    found = scan()

    if not BASELINE.exists():
        BASELINE.write_text("\n".join(found) + "\n", encoding="utf-8")
        print(f"i18n: 建立基线 {len(found)} 条 -> {BASELINE.name}")
        return 0

    base = set(BASELINE.read_text(encoding="utf-8").split("\n")) - {""}
    new = [f for f in found if f not in base]
    gone = len(base) - len([f for f in found if f in base])

    if new:
        print(f"{len(new)} 条新的写死英文（界面文案要走 i18n）：", file=sys.stderr)
        print("\n".join(f"  {n}" for n in new[:20]), file=sys.stderr)
        print("\n翻译它：加进 i18n/en.ts 和 zh.ts，用 t(\"key\")。"
              "\n如果它真的不是界面文案（专名、协议词），加进这个文件的 ALLOWED。"
              f"\n【不要】把它加进 {BASELINE.name} —— 那张表只减不增。", file=sys.stderr)
        return 1

    print(f"i18n: 基线 {len(base)} 条，无新增" + (f"，已消掉 {gone} 条" if gone else ""))
    if gone:
        print(f"     记得更新基线：python3 {Path(__file__).name} --rebaseline")
    return 0


if __name__ == "__main__":
    if "--rebaseline" in sys.argv:
        BASELINE.write_text("\n".join(scan()) + "\n", encoding="utf-8")
        print(f"基线已重建：{len(scan())} 条")
        raise SystemExit(0)
    raise SystemExit(main())
