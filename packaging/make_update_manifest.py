#!/usr/bin/env python3
"""Compose the Tauri updater manifest (latest.json) from staged release artifacts.

Run by the release CI job after all platform builds are staged in one directory:

    python3 make_update_manifest.py --version 0.1.2 --tag v0.1.2 \
        --repo andrewyng/aisuite --dist dist/ --out dist/latest.json

Looks for the updater artifacts by their STABLE names (the same names release.yml
uploads):

    Marlo-macos-arm64.app.tar.gz(.sig)   -> platforms["darwin-aarch64"]
    Marlo-macos-x64.app.tar.gz(.sig)     -> platforms["darwin-x86_64"]
    Marlo-windows-setup.exe(.sig)        -> platforms["windows-x86_64"]

URLs point at the TAG-pinned download path, never at `latest/` — a manifest must
reference exactly the artifacts it shipped with, or a half-published release would
mix versions.

`--base-url` 把下载地址换到镜像上（R2 + 自定义域名）。为什么需要：github.com 在
国内直连不通（实测 30 秒超时），而更新清单和安装包原本【全在 GitHub 上】——对一个
没有代理的用户，装不上也更新不了。给了 --base-url 就用 <base>/<tag>/<asset>，
不给就还是 GitHub（fork 和没配镜像的构建照常工作）。 Platforms whose artifact or .sig is
missing are SKIPPED with a warning (e.g. a mac-only hotfix release), so shipped apps
on other platforms simply see no update rather than a broken one.

The desktop app finds this file at the repo's releases/latest/download/latest.json —
see tauri.conf.json `plugins.updater.endpoints`.
"""

from __future__ import annotations

import argparse
import datetime
import json
import pathlib
import sys

# stable asset name -> Tauri platform key
ARTIFACTS = {
    "Marlo-macos-arm64.app.tar.gz": "darwin-aarch64",
    # Intel：release.yml 的 matrix 从 7-28 起就在 macos-15-intel 上产出
    # Marlo-macos-x64.app.tar.gz，但这张表里一直没有它 —— 于是 Intel 用户装完
    # 之后【永远收不到自动更新】，而发布流程一路是绿的。上游 0.1.7 加同一行时
    # 才暴露出来：我们比他们更早支持 Intel，却漏了更新清单这一半。
    "Marlo-macos-x64.app.tar.gz": "darwin-x86_64",
    "Marlo-windows-setup.exe": "windows-x86_64",
}


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--version", required=True, help="bare version, e.g. 0.1.2")
    ap.add_argument(
        "--tag", required=True, help="git tag the assets live under, e.g. v0.1.2"
    )
    ap.add_argument("--repo", required=True, help="owner/name, e.g. andrewyng/aisuite")
    ap.add_argument(
        "--dist", required=True, type=pathlib.Path, help="staged artifacts dir"
    )
    ap.add_argument("--out", required=True, type=pathlib.Path)
    ap.add_argument(
        "--notes", default="", help="release notes line shown in the update prompt"
    )
    ap.add_argument(
        "--base-url",
        default="",
        help="镜像根地址，如 https://cdn.qumge.com/marlo。给了就用 <base>/<tag>/<asset>，"
        "不给就回落到 GitHub releases。",
    )
    args = ap.parse_args()

    platforms: dict[str, dict[str, str]] = {}
    for asset, platform in ARTIFACTS.items():
        artifact = args.dist / asset
        sig = args.dist / (asset + ".sig")
        if not artifact.exists():
            print(
                f"warning: {asset} not in {args.dist} — skipping {platform}",
                file=sys.stderr,
            )
            continue
        if not sig.exists():
            print(
                f"warning: {asset} has no .sig — skipping {platform} (unsigned updates never install)",
                file=sys.stderr,
            )
            continue
        base = args.base_url.rstrip("/")
        url = (
            f"{base}/{args.tag}/{asset}"
            if base
            else f"https://github.com/{args.repo}/releases/download/{args.tag}/{asset}"
        )
        platforms[platform] = {"signature": sig.read_text().strip(), "url": url}

    if not platforms:
        print(
            "error: no signed updater artifacts found — refusing to write an empty manifest",
            file=sys.stderr,
        )
        return 1

    manifest = {
        "version": args.version,
        "notes": args.notes,
        "pub_date": datetime.datetime.now(datetime.timezone.utc)
        .isoformat(timespec="seconds")
        .replace("+00:00", "Z"),
        "platforms": platforms,
    }
    args.out.write_text(json.dumps(manifest, indent=2) + "\n")
    print(f"wrote {args.out} ({', '.join(sorted(platforms))})")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
