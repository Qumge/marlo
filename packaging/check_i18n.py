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
    re.compile(r"^(Clay|Close|Descript|Docusign|Salesforce|Together AI|Fireworks AI|"
               r"Z AI \(GLM\)|Kimi \(Moonshot AI\)|Qwen \(Alibaba\)|xAI \(Grok\)|"
               r"MiniMax|Meta \(Muse Spark\)|Connector)$"),
]


def _is_test(p: Path) -> bool:
    return ".test." in p.name


def scan() -> list[str]:
    found: list[str] = []
    for path in sorted(SRC.rglob("*.tsx")):
        if _is_test(path):
            continue
        text = path.read_text(encoding="utf-8")
        # as_posix()：Windows 上分隔符是反斜杠，而基线里存的是正斜杠 —— 不统一
        # 的话整份基线在那个平台上全被当成新增（CI 实测 184 条全报，构建挂掉）。
        rel = path.relative_to(SRC).as_posix()
        for lineno, line in enumerate(text.splitlines(), 1):
            stripped = line.strip()
            if stripped.startswith(("//", "*", "/*")):
                continue
            for m in (*_TEXT.finditer(line), *_ATTR.finditer(line), *_DATA.finditer(line)):
                s = m.group(1).strip()
                if len(s) < 3 or any(a.match(s) for a in ALLOWED):
                    continue
                found.append(f"{rel}: {s}")
    return sorted(set(found))


def main() -> int:
    found = scan()
    # 路径改动让它扫不到东西时必须失败，不能静默通过（和 check_branding 同一条）。
    if len(found) < 20:
        print(f"只扫出 {len(found)} 条 —— 这个检查形同虚设，先看路径对不对", file=sys.stderr)
        return 1

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
