#!/usr/bin/env python3
"""Compile the app icon into an asset catalog, so macOS stops framing it.

On macOS 26 and later an app whose only icon is a legacy CFBundleIconFile gets
the compatibility treatment: the artwork is shrunk and set on a pale rounded
plate. Marlo shipped that way and looked inset and washed out beside every other
icon in the Dock — not because the .icns was wrong (it is full-bleed red, corner
pixels included) but because nothing in the bundle told macOS it could be
treated as a modern icon.

The evidence, gathered before writing any of this: every app on this machine
that fills its tile — Podcasts, Notes, 1Password — carries CFBundleIconName and
a Resources/Assets.car. Marlo carried neither. Injecting a compiled catalog into
an installed copy made the plate disappear.

Tauri has no hook for this, so packaging does it: build an AppIcon.appiconset
from icons/icon.png, run actool, and drop Assets.car into the bundle alongside
the CFBundleIconName key.

actool lives inside Xcode, not the Command Line Tools. Without Xcode this exits
0 after a warning: an icon on a plate is ugly, not broken, and it must not stop
a release.
"""
from __future__ import annotations  # `str | None` on the system python3 (3.9 on some runners)

import json
import plistlib
import shutil
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SOURCE_ICON = ROOT / "surfaces/gui/src-tauri/icons/icon.png"

# macOS asset catalogs want these ten; actool rejects the set if any is missing.
SIZES = [(s, sc) for s in (16, 32, 128, 256, 512) for sc in (1, 2)]


def find_actool() -> str | None:
    for xcode in ("/Applications/Xcode.app", "/Applications/Xcode-beta.app"):
        candidate = Path(xcode) / "Contents/Developer/usr/bin/actool"
        if candidate.is_file():
            return str(candidate)
    found = shutil.which("actool")
    return found


def main() -> int:
    if len(sys.argv) != 2:
        print(f"usage: {Path(sys.argv[0]).name} <path to .app>", file=sys.stderr)
        return 2
    app = Path(sys.argv[1])
    if not app.is_dir():
        print(f"app bundle not found: {app}", file=sys.stderr)
        return 1

    actool = find_actool()
    if not actool:
        print("    WARNING: actool not found (needs Xcode, not just the Command Line Tools) —"
              " shipping the legacy icon, which macOS 26+ draws on a pale plate")
        return 0

    if not SOURCE_ICON.is_file():
        print(f"source icon not found: {SOURCE_ICON}", file=sys.stderr)
        return 1

    work = app.parent / ".marlo-iconset"
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

    partial = compiled / "partial.plist"
    subprocess.run(
        [actool, "--compile", str(compiled), "--app-icon", "AppIcon",
         "--output-partial-info-plist", str(partial),
         "--platform", "macosx", "--minimum-deployment-target", "12.0",
         "--enable-on-demand-resources", "NO",
         str(work / "Assets.xcassets")],
        check=True, capture_output=True,
    )

    car = compiled / "Assets.car"
    if not car.is_file():
        print("actool produced no Assets.car", file=sys.stderr)
        return 1

    resources = app / "Contents/Resources"
    shutil.copy2(car, resources / "Assets.car")
    icns = compiled / "AppIcon.icns"
    if icns.is_file():
        shutil.copy2(icns, resources / "AppIcon.icns")

    # CFBundleIconName is the key that opts the app into the modern treatment;
    # CFBundleIconFile stays for macOS versions that predate it.
    info_path = app / "Contents/Info.plist"
    info = plistlib.loads(info_path.read_bytes())
    info["CFBundleIconName"] = "AppIcon"
    if icns.is_file():
        info["CFBundleIconFile"] = "AppIcon"
    info_path.write_bytes(plistlib.dumps(info))

    size_kb = (resources / "Assets.car").stat().st_size // 1024
    shutil.rmtree(work, ignore_errors=True)
    print(f"    asset catalog installed ({size_kb} KB), CFBundleIconName=AppIcon")
    return 0


if __name__ == "__main__":
    sys.exit(main())
