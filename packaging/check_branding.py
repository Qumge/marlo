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

SRC = Path(__file__).resolve().parent.parent / "surfaces/gui/src"
SUFFIXES = {".ts", ".tsx", ".css"}
EXEMPT_FILES = {"Sidebar.test.tsx"}  # persona fixture, not copy

# Everything under components/connectors/ describes OpenWorker Cloud's brokered
# OAuth: which service holds the client secret, which app the user approves on
# GitHub (@ocw-agent), which bot name appears in Slack. Renaming those would be a
# false statement about who handles a user's tokens, not a branding update.
#
# The rename that shipped in 0.2.2 did exactly that — "OpenWorker handles the
# OAuth for 20+ tools" became "Marlo handles the OAuth for 20+ tools", one screen
# before the app sends the user to opencoworker.us.auth0.com.
EXEMPT_DIRS = {"connectors"}

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
]


def main() -> int:
    if not SRC.is_dir():
        print(f"source directory not found: {SRC}", file=sys.stderr)
        return 1

    offenders = []
    scanned = 0

    for path in sorted(SRC.rglob("*")):
        if path.suffix not in SUFFIXES or not path.is_file():
            continue
        if path.name in EXEMPT_FILES:
            continue
        if EXEMPT_DIRS & set(path.relative_to(SRC).parts[:-1]):
            continue
        scanned += 1

        for lineno, line in enumerate(path.read_text(encoding="utf-8").splitlines(), 1):
            if "OpenWorker" not in line:
                continue
            if any(p.search(line) for p in ALLOWED):
                continue
            rel = path.relative_to(SRC)
            offenders.append(f"  {rel}:{lineno}  {line.strip()}")

    # A path change that makes this scan nothing must fail, not pass silently.
    if scanned < 20:
        print(f"only {scanned} files scanned under {SRC} — the check would pass vacuously",
              file=sys.stderr)
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
