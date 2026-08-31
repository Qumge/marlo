#!/usr/bin/env python3
"""Fail the build if a user-facing string still calls the product OpenWorker.

0.2.1 installed as Marlo, showed the Marlo icon in the Dock, opened, and said
"Welcome to OpenWorker". The rename had covered packaging — product name, bundle
identifier, installer names — and no copy at all. Nothing failed: the build
succeeded, every test passed, the app ran. It just used the wrong name.

Four kinds of OpenWorker legitimately stay. The point of listing them is that
widening the list has to be a decision someone makes, not a rename someone
forgot:

  "OpenWorker Cloud" / api.openworker.com
      A service this project does not operate. Renaming it would tell users
      their connector tokens are brokered by us when they are not.

  X-OpenWorker-Token / openworker-server
      Wire protocol and sidecar binary name. Renaming either breaks the
      GUI/sidecar handshake for no user-visible gain.

  publisher === "OpenWorker" / "openworker"
      Matched against data the upstream gallery returns.

  @OpenWorker
      That bot's real Slack handle.

This lives beside check_icons.py rather than in vitest because `npm run build`
type-checks everything under src/, and a test reaching for node:fs needs
@types/node — which this package deliberately does not carry. The first version
of this check was a vitest test and it broke the release build on both
platforms.
"""
import re
import sys
from pathlib import Path

# 同上：这个检查器也会打中文（"内部名字出现在句子里"），Windows 控制台是 cp1252。
for _s in (sys.stdout, sys.stderr):
    try:
        _s.reconfigure(encoding="utf-8", errors="replace")
    except (AttributeError, ValueError):
        pass

ROOT = Path(__file__).resolve().parent.parent

# The first version of this check scanned only surfaces/gui/src, so the rename it
# was guarding stopped at the language boundary and left the old name in the tray
# menu, its tooltip, the pages the sidecar serves on localhost, the client name an
# MCP provider shows on its consent screen, and the folder created in the user's
# home. All of those a person reads directly.
ROOTS = [
    ROOT / "surfaces/gui/src",
    ROOT / "surfaces/gui/src-tauri/src",
    ROOT / "surfaces/gui/src-tauri",  # Info.plist — see below
    ROOT / "coworker",
    # packaging/ was never scanned, including by the file this check lives in.
    # The DMG install window said "Install OpenWorker" through eleven releases:
    # the words were baked into a committed PNG, which no check can read and no
    # diff can show. They are drawn from make_dmg_background.py now, so they are
    # text, and text is what this file is for.
    ROOT / "packaging",
]
# Build outputs, not source. packaging/dist holds the frozen sidecar's vendored
# dependencies — thousands of files, none of them ours, several of which say
# "Install ..." in an entirely unrelated sense.
EXCLUDE_DIRS = {"dist", "build", "node_modules", "__pycache__"}
# .plist is here because src-tauri/Info.plist carries the NS*UsageDescription
# strings macOS prints inside its own permission dialogs. Those named OpenWorker
# through five releases: a system prompt asking for your Documents folder on
# behalf of a product you never installed is what malware looks like, and no
# check reached the file.
# .json 是 2026-08-31 补的。i18n 迁到上游的 locales/*.json 之后，界面上每一条文案
# 都住在 JSON 里，而这个后缀表当时不含 .json —— 上游那两份各带 38 处 OpenWorker，
# 会一路绿灯发给用户。我们原来的 en.ts / zh.ts 是 .ts，一直被扫着：这份覆盖是
# 【迁移静默弄丢的】，不是本来就没有。和 .plist 那条是同一类错误 —— 判据停在了
# 文件格式的边界上，而用户读到的字符串不认识那条边界。
SUFFIXES = {".ts", ".tsx", ".css", ".rs", ".py", ".plist", ".json"}


def _is_self(path: Path) -> bool:
    """This file names every allowed OpenWorker in order to allow it.

    Scanning packaging/ brought the checker into its own scope, where its
    documentation of the four legitimate cases reads as eleven violations.
    """
    return path.name == "check_branding.py"


def _is_test(path: Path) -> bool:
    """Test files ship to nobody, so nothing in one is a user-facing string.

    They were scanned at first, with a named exemption per offender — a persona
    fixture, then a test whose whole job is asserting the account menu never says
    OpenWorker, which the guard read as the app saying it. A guard that has to be
    told about each test as it is written trains the next person to widen ALLOWED
    instead, which is the one list that must stay expensive to add to.
    """
    # testing/ 下的是测试替身和夹具，docstring 里写着 "not shipped to users"。
    return ".test." in path.name or "testing" in path.parts

# Everything under components/connectors/ describes OpenWorker Cloud's brokered
# OAuth: which service holds the client secret, which app the user approves on
# GitHub (@ocw-agent), which bot name appears in Slack. Renaming those would be a
# false statement about who handles a user's tokens, not a branding update.
#
# The rename that shipped in 0.2.2 did exactly that — "OpenWorker handles the
# OAuth for 20+ tools" became "Marlo handles the OAuth for 20+ tools", one screen
# before the app sends the user to opencoworker.us.auth0.com.
EXEMPT_DIRS = {"connectors"}

# zh-text.ts 是【按英文原文索引的译文表】—— 它的每一个键都是别处某个 .tsx 里逐字
# 存在的字符串，而那个位置已经被这个守卫判过一次了。
#
# 2026-08-01 回填 148 条译文时撞上这件事：connectors/ 目录整个是豁免的（那里的
# "OpenWorker Cloud"、"approve OpenWorker there" 描述的是真实的代授权链路，改名
# 等于对用户撒谎 —— 0.2.2 就这么错过一次）。译文搬进目录表之后，同样的句子掉出了
# 那个目录，于是守卫开始拦【它自己刚判过合法的东西】。
#
# 豁免要跟着【字符串】走，不是跟着目录走。所以这张表在这里跳过，判据仍然施加在
# 原文所在的那个文件上。
#
# 【残余风险，以及它是怎么被堵住的】有人可能在【译文】里写进一个原文没有的品牌名。
# check_i18n_text.mjs 因此同时检查【反方向】：表里的键必须在源码里真实存在。
# 键都是真的，值就是那个键的译文，而不是一段没人看过的新文案。
# tauri.conf.json 是 2026-08-31 和 .json 一起进来的，理由和 zh-text.ts 相反：
# 那份【必须】留着上游的名字。品牌走 overlay（tauri.marlo.conf.json，见 21cd141），
# 上游那份保持字节相同，本文件末尾的 check_tauri_overlay() 正是在守这一条。把它
# 改名会让那个检查红，而且下次合并会平白多出一处冲突 —— 两个检查会打起来。
# locales/{en,zh}.json 和 tauri.conf.json 同理：它们【必须】和上游字节相同，品牌走
# locales/*.marlo.json overlay（见 src/localeOverlay.ts）。逐行扫它们只会报出上游
# 自己的文案，而用户看到的是【合并之后】的结果 —— 那个由下面的
# check_locale_overlay() 管，它报的是"这条上游文案带产品名，overlay 却没覆盖"。
EXEMPT_FILES = {"zh-text.ts", "tauri.conf.json", "en.json", "zh.json"}

# 白名单管不到的一类：字符串本身合法，但【用错了地方】。
#
# 2026-07-28：自动化页对用户说 "Runs only while openworker-server is up"。
# openworker-server 在 ALLOWED 里（它是 sidecar 的二进制名和进程间协议名，改了
# 会断握手），所以上面那套检查一路放行——可用户不知道那是什么，也不该知道。
#
# 判据是【它出现在一句给人读的话里】：前后有普通英文单词围着，而不是作为一个
# 路径/命令/常量独立出现。
SENTENCE_LEAKS = [
    re.compile(r"[a-z]{3,}\s+openworker-(?:server|desktop)\s+[a-z]{2,}"),
    # 【第二条是 CJK 盲区，2026-08-31 补】上面那条要求进程名两边是英文单词，所以
    # 它只看得见英文那一句。同一条文案的中文版（"仅在 openworker-server 运行时执行"）
    # 从 0.4.0 中文界面上线起就一直在，而守卫一路是绿的 —— 判据停在了语言边界上，
    # 而用户读到的句子不认识那条边界。和 .json 那条是同一类错误。
    re.compile(r"[\u4e00-\u9fff]\s*openworker-(?:server|desktop)\s*[\u4e00-\u9fff]"),
]

# 两个检查器互查会打起来：check_i18n.py 的白名单里列着一串专名（含 OpenWorker），
# 那是判据不是界面文案。跳过 packaging/ 自己。
SELF_CHECKS = {"check_i18n.py", "check_branding.py"}

ALLOWED = [
    # 标识符里的产品名，不是给人读的字符串：上游 2026-08 新增的 onOpenWorker prop
    # （BoardPanel / RightRail / App 一路传下去）。判据是【前后紧挨着标识符字符】——
    # 用户读到的字符串两边不会是 on/= 这种。改名它等于改上游的 API。
    re.compile(r"[A-Za-z0-9_]OpenWorker|OpenWorker[A-Za-z0-9_]"),
    re.compile(r"OpenWorker Cloud"),
    re.compile(r"openworker\.com"),
    re.compile(r"X-OpenWorker-Token"),
    re.compile(r"openworker-server"),
    re.compile(r'publisher === "OpenWorker"'),
    re.compile(r'"openworker"'),
    re.compile(r"@OpenWorker"),
    re.compile(r"OpenWorker sidecar token"),  # the server's own error string
    # The connector sign-in card: OpenWorker Cloud brokers this OAuth, not us.
    re.compile(r"OpenWorker handles the OAuth"),
    # 【搬进 i18n 会丢掉 EXEMPT_DIRS 的豁免】—— 这是好事：目录豁免是按位置给的，
    # 而字符串一旦集中到 i18n/，就得逐条说明理由。下面三条都是这么冒出来的。
    #
    # 用户在 Slack 里装的那个 app 就叫 OpenWorker，@ 它的时候打的也是这个名字。
    # 这一屏正是在教他怎么装、怎么 @。
    re.compile(r"Getting started with Slack & OpenWorker"),
    re.compile(r"Slack 与 OpenWorker 上手"),
    # "Curated coworkers from the OpenWorker team" 的中文。这个角色库【确实】是
    # 上游策展的，说成 Marlo 团队精选是把别人的工作算到自己头上。
    re.compile(r"OpenWorker 团队精选"),
    # 同一句话的中文。2026-07-28 把这句从 Onboarding.tsx 里搬进 i18n 时，守卫立刻
    # 报了出来 —— 它只认英文那条原文。留 OpenWorker 的理由和英文侧【一模一样】：
    # client secret 真在 OpenWorker Cloud 手上，下一步就把用户送到
    # opencoworker.us.auth0.com。翻成 Marlo 是在告诉用户一件假事。
    re.compile(r"OAuth 由 OpenWorker 代办"),
    # The coworker gallery is curated upstream — publisher === "OpenWorker".
    re.compile(r"from the OpenWorker team"),
    # What opencoworker.us.auth0.com actually calls the app it signs you into.
    # Quoted in the comments explaining why the connector step is hidden.
    re.compile(r"OpenWorker Desktop"),
    # The Slack bot's own rename history, which is why [ocw:…] ids stay parseable.
    re.compile(r"the bot's rebrand"),
    re.compile(r"to OpenWorker \(2026-07-22\)"),
]


def main() -> int:
    missing = [str(r) for r in ROOTS if not r.is_dir()]
    if missing:
        print("source directories not found: " + ", ".join(missing), file=sys.stderr)
        return 1

    offenders = []
    scanned = 0

    for src in ROOTS:
        for path in sorted(src.rglob("*")):
            if path.suffix not in SUFFIXES or not path.is_file():
                continue
            if _is_self(path) or _is_test(path) or path.name in EXEMPT_FILES:
                continue
            if EXCLUDE_DIRS & set(path.parts):
                continue
            if EXEMPT_DIRS & set(path.relative_to(src).parts[:-1]):
                continue
            scanned += 1
            _scan(path, src, offenders)

    rc = _report(scanned, offenders)
    return check_tauri_overlay() or check_locale_overlay() or rc


# tauri.conf.json 现在【和上游字节相同】，品牌值全部搬进 tauri.marlo.conf.json，构建时
# 用 --config 叠上去（Tauri 的合并语义）。这么做是为了让上游每次发版改 version 那一行时
# 不再和我们撞车 —— 那个冲突每次内容都一样，做一辈子也不会变得更容易。
#
# 代价是多了一种【静默失效】：谁忘了传 --config，构建出来的就是一个叫 OpenWorker、
# 指向上游更新源的 .app —— 它能签名、能安装、能启动，然后把用户更新到别人的产品上。
# 没有任何测试会看见这件事。所以这里检查两件不变量：
#   1. overlay 里那几个键确实是我们的（不是从上游那边抄回来的）
#   2. 每一处会调 tauri build/dev 的地方都带上了这个 overlay
_BRAND_KEYS = {
    "productName": "Marlo",
    # 没有它，Contents/MacOS 里的可执行文件叫 cargo 那个 crate 名 openworker-desktop——
    # 活动监视器、崩溃报告、"强制退出"列表里露出来的都是上游的名字。.app 叫 Marlo 而
    # 进程叫别的，这一条靠肉眼永远发现不了（是一次新用户走查里看见的）。
    "mainBinaryName": "Marlo",
    "identifier": "com.qumge.marlo",
}


def check_tauri_overlay() -> int:
    import json

    conf = ROOT / "surfaces/gui/src-tauri/tauri.conf.json"
    overlay = ROOT / "surfaces/gui/src-tauri/tauri.marlo.conf.json"
    if not overlay.is_file():
        print(f"{overlay.name} 不见了 —— 构建会打出上游品牌的包", file=sys.stderr)
        return 1

    data = json.loads(overlay.read_text(encoding="utf-8"))
    bad = [f"{k}={data.get(k)!r}（应为 {v!r}）" for k, v in _BRAND_KEYS.items() if data.get(k) != v]
    for ep in data.get("plugins", {}).get("updater", {}).get("endpoints", []):
        if "openworker" in ep.lower():
            bad.append(f"updater endpoint 指向上游：{ep}")
    if bad:
        print(f"{overlay.name} 里的品牌值不对：", file=sys.stderr)
        print("\n".join(f"  {b}" for b in bad), file=sys.stderr)
        return 1

    # 上游那份仍然写着 OpenWorker 是【预期的】—— 它就该和上游一样。真正要防的是
    # 有人把品牌值写回去，两处各留一份，然后开始漂。
    base = json.loads(conf.read_text(encoding="utf-8"))
    if base.get("productName") == _BRAND_KEYS["productName"]:
        print(f"{conf.name} 里又出现了品牌名 —— 它应当和上游保持字节相同，"
              f"品牌只写在 {overlay.name}", file=sys.stderr)
        return 1

    # 会调 tauri build/dev 的地方必须带 overlay，否则打出来的是上游品牌的包。
    callers = {
        ROOT / "packaging/build_dmg.sh",
        ROOT / "packaging/build_windows.ps1",
    }
    missing = [
        p.name for p in sorted(callers)
        if p.is_file() and "tauri build" in p.read_text(encoding="utf-8")
        and overlay.name not in p.read_text(encoding="utf-8")
    ]
    if missing:
        print(f"这些地方调了 tauri build 但没传 {overlay.name}："
              f"{', '.join(missing)} —— 会打出上游品牌的包", file=sys.stderr)
        return 1

    print(f"branding: tauri 品牌 overlay 就位（{conf.name} 与上游一致）")
    return 0


def check_locale_overlay() -> int:
    """上游文案里的产品名，overlay 都盖住了吗？

    locales/{en,zh}.json 与上游字节相同（冲突恒为 0，见 localeOverlay.ts），所以
    逐行扫它们没有意义 —— 用户看到的是叠加之后的结果。这里判的就是叠加之后：上游
    某条文案带 OpenWorker 而 overlay 没覆盖它，那句就会原样显示给用户。

    这条检查是 2026-08-31 跟着 overlay 一起加的。在它之前，把 zh.json 恢复成上游
    原样的那一刻，52 条产品名【瞬间回到了界面上】，而普通扫描把它们报成了 52 条
    违规——方向对，位置错：该修的不是那两个文件，是 overlay 漏了。
    """
    import json

    loc = ROOT / "surfaces/gui/src/locales"
    missing = []
    for lang in ("en", "zh"):
        base_f, over_f = loc / f"{lang}.json", loc / f"{lang}.marlo.json"
        if not base_f.is_file() or not over_f.is_file():
            print(f"locales/{lang}.json 或它的 overlay 不见了", file=sys.stderr)
            return 1

        def flat(d, prefix=""):
            out = {}
            for k, v in d.items():
                key = f"{prefix}{k}"
                out.update(flat(v, key + ".")) if isinstance(v, dict) else out.setdefault(key, v)
            return out

        base = flat(json.loads(base_f.read_text(encoding="utf-8")))
        over = flat(json.loads(over_f.read_text(encoding="utf-8")))
        for key, val in base.items():
            if not isinstance(val, str):
                continue
            merged = over.get(key, val)
            if not isinstance(merged, str):
                continue
            if any(p.search(merged) for p in SENTENCE_LEAKS):
                missing.append(f"  {lang}.json:{key}  [内部名字出现在句子里] {merged}")
                continue
            if "OpenWorker" not in merged or any(p.search(merged) for p in ALLOWED):
                continue
            missing.append(f"  {lang}.json:{key}  {merged}")

    if missing:
        print(f"{len(missing)} 条上游文案带着产品名，而 locales/*.marlo.json 没有覆盖："
              f"\n" + "\n".join(missing), file=sys.stderr)
        print("\n改 overlay，不要改 locales/{en,zh}.json —— 那两份要和上游字节相同。",
              file=sys.stderr)
        return 1
    print("branding: locales overlay 盖住了上游文案里的产品名")
    return 0


def _scan(path: Path, src: Path, offenders: list) -> None:
    if path.name in SELF_CHECKS:
        return
    for lineno, line in enumerate(path.read_text(encoding="utf-8").splitlines(), 1):
        # 注释不是用户可见字符串 —— 它们解释 fork 历史时会正当地提到上游的名字。
        stripped = line.strip()
        is_comment = stripped.startswith(("//", "///", "#", "*"))

        # ALLOWED 管不到的一类：字符串本身合法，但出现在一句给人读的话里。
        if not is_comment and any(p.search(line) for p in SENTENCE_LEAKS):
            offenders.append(
                f"  {path.relative_to(src)}:{lineno}  [内部名字出现在句子里] {stripped}"
            )
            continue

        if "OpenWorker" not in line:
            continue
        if any(p.search(line) for p in ALLOWED):
            continue
        offenders.append(f"  {path.relative_to(src)}:{lineno}  {stripped}")


def _report(scanned: int, offenders: list) -> int:
    # A path change that makes this scan nothing must fail, not pass silently.
    if scanned < 100:
        print(f"only {scanned} files scanned — the check would pass vacuously", file=sys.stderr)
        return 1

    if offenders:
        print(f"{len(offenders)} user-facing string(s) still say OpenWorker:", file=sys.stderr)
        print("\n".join(offenders), file=sys.stderr)
        print("\nIf one of these genuinely names the upstream service or protocol, "
              "add it to ALLOWED in this file — deliberately.", file=sys.stderr)
        return 1

    print(f"branding: {scanned} files, no stray product name")
    return 0


if __name__ == "__main__":
    sys.exit(main())
