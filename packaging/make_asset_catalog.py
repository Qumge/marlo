#!/usr/bin/env python3
"""Compile the app icon into an asset catalog, before `tauri build` signs anything.

Since macOS 26, an app whose only icon is a legacy CFBundleIconFile gets the
compatibility treatment: the artwork is shrunk and set on a pale rounded plate.
Marlo looked inset and washed out beside every other icon in the Dock — not
because the .icns was wrong (it is full-bleed red, corner pixels included) but
because nothing in the bundle told macOS it could be drawn as a modern icon.

The evidence came first. Every app on this machine that fills its tile —
Podcasts, Notes, 1Password — carries CFBundleIconName and a Resources/Assets.car;
Marlo carried neither. Injecting a compiled catalog into an installed copy made
the plate disappear.

This writes Assets.car into src-tauri/, where bundle.resources picks it up and
CFBundleIconName (src-tauri/Info.plist) names it. Ordering is the whole point:
0.2.6 built the catalog and edited Info.plist AFTER `tauri build` had signed,
notarised and stapled the bundle, which invalidated the ticket — `stapler
validate` on the .app went from "worked" to exit 65 while the DMG stayed
stapled. Producing the catalog first lets Tauri sign a bundle that is already
complete.

actool lives inside Xcode, not the Command Line Tools. Without it this exits 0
after a warning: an icon on a plate is ugly, not broken, and must not stop a
release.
"""
from __future__ import annotations  # `str | None` on the system python3 (3.9 on some runners)

import json
import shutil
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SOURCE_ICON = ROOT / "surfaces/gui/src-tauri/icons/icon.png"
# bundle.resources maps this to Contents/Resources/Assets.car.
OUTPUT = ROOT / "surfaces/gui/src-tauri/gen/Assets.car"

# macOS asset catalogs want these ten; actool rejects the set if any is missing.
SIZES = [(s, sc) for s in (16, 32, 128, 256, 512) for sc in (1, 2)]


def find_actool() -> str | None:
    for xcode in ("/Applications/Xcode.app", "/Applications/Xcode-beta.app"):
        candidate = Path(xcode) / "Contents/Developer/usr/bin/actool"
        if candidate.is_file():
            return str(candidate)
    return shutil.which("actool")


def main() -> int:
    actool = find_actool()
    if not actool:
        print("    WARNING: actool not found (needs Xcode, not just the Command Line Tools) —"
              " shipping the legacy icon, which macOS 26+ draws on a pale plate")
        # A stale catalog from an earlier machine would ship an icon that no longer
        # matches icons/icon.png, so clear it rather than leave it behind.
        OUTPUT.unlink(missing_ok=True)
        return 0

    if not SOURCE_ICON.is_file():
        print(f"source icon not found: {SOURCE_ICON}", file=sys.stderr)
        return 1

    work = OUTPUT.parent / ".iconset-build"
    iconset = work / "Assets.xcassets/AppIcon.appiconset"
    compiled = work / "compiled"
    shutil.rmtree(work, ignore_errors=True)
    iconset.mkdir(parents=True)
    compiled.mkdir(parents=True)

    images = []
    for size, scale in SIZES:
        px = size * scale
        name = f"icon_{size}x{size}@{scale}x.png"
        subprocess.run(
            ["sips", "-s", "format", "png", "-z", str(px), str(px),
             str(SOURCE_ICON), "--out", str(iconset / name)],
            check=True, capture_output=True,
        )
        images.append({"size": f"{size}x{size}", "idiom": "mac",
                       "filename": name, "scale": f"{scale}x"})
    (iconset / "Contents.json").write_text(
        json.dumps({"images": images, "info": {"version": 1, "author": "xcode"}}, indent=2)
    )

    subprocess.run(
        [actool, "--compile", str(compiled), "--app-icon", "AppIcon",
         "--output-partial-info-plist", str(compiled / "partial.plist"),
         "--platform", "macosx", "--minimum-deployment-target", "12.0",
         "--enable-on-demand-resources", "NO",
         str(work / "Assets.xcassets")],
        check=True, capture_output=True,
    )

    car = compiled / "Assets.car"
    if not car.is_file():
        print("actool produced no Assets.car", file=sys.stderr)
        return 1

    OUTPUT.parent.mkdir(parents=True, exist_ok=True)
    shutil.copy2(car, OUTPUT)
    size_kb = OUTPUT.stat().st_size // 1024
    shutil.rmtree(work, ignore_errors=True)
    print(f"    {OUTPUT.relative_to(ROOT)} ({size_kb} KB) — CFBundleIconName=AppIcon is in Info.plist")
    return 0


if __name__ == "__main__":
    sys.exit(main())
