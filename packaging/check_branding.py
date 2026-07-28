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
SUFFIXES = {".ts", ".tsx", ".css", ".rs", ".py", ".plist"}


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
]

# 两个检查器互查会打起来：check_i18n.py 的白名单里列着一串专名（含 OpenWorker），
# 那是判据不是界面文案。跳过 packaging/ 自己。
SELF_CHECKS = {"check_i18n.py", "check_branding.py"}

ALLOWED = [
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
            if _is_self(path) or _is_test(path):
                continue
            if EXCLUDE_DIRS & set(path.parts):
                continue
            if EXEMPT_DIRS & set(path.relative_to(src).parts[:-1]):
                continue
            scanned += 1
            _scan(path, src, offenders)

    return _report(scanned, offenders)


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
