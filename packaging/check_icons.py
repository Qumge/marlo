#!/usr/bin/env python3
"""Fail the build if any bundled icon is 16-bit-per-channel PNG.

Marlo 0.2.0 shipped an app that aborted on every launch, on every machine:

    Failed to setup app: invalid icon: The specified dimensions (32x32)
    don't match the number of pixels supplied by the `rgba` argument (2048).
    For those dimensions, the expected pixel count is 1024.

icons/32x32.png had been exported at 16 bits per channel. Decoded that is
32*32*4*2 = 8192 bytes; Tauri reads the buffer as 8-bit RGBA, computes
8192/4 = 2048 pixels, and refuses an icon that should hold 1024. The panic
happens inside `did_finish_launching`, an ObjC callback Rust cannot unwind
out of, so it aborts before a window ever appears.

Nothing else catches this. The PNGs open correctly in every viewer, the
dimensions are right, `cargo test` passes, the bundle signs and notarises,
and `spctl` accepts it. The only symptom is that the app does not start.
"""
import struct
import sys
from pathlib import Path

ICONS = Path(__file__).resolve().parent.parent / "surfaces/gui/src-tauri/icons"

PNG_MAGIC = b"\x89PNG\r\n\x1a\n"


def bit_depth(path: Path) -> int:
    """Bit depth from the IHDR chunk, which a valid PNG always puts first."""
    data = path.read_bytes()
    if data[:8] != PNG_MAGIC:
        raise ValueError(f"{path.name} is not a PNG")
    # 8 magic + 4 length + 4 "IHDR" + 4 width + 4 height = byte 24
    return struct.unpack(">B", data[24:25])[0]


def main() -> int:
    if not ICONS.is_dir():
        print(f"icons directory not found: {ICONS}", file=sys.stderr)
        return 1

    offenders = []
    checked = 0
    for png in sorted(ICONS.glob("*.png")):
        depth = bit_depth(png)
        checked += 1
        if depth != 8:
            offenders.append((png.name, depth))

    if not checked:
        print(f"no PNGs found in {ICONS} — the check would pass vacuously", file=sys.stderr)
        return 1

    if offenders:
        print(f"{len(offenders)} icon(s) are not 8-bit — the app will abort on launch:", file=sys.stderr)
        for name, depth in offenders:
            print(f"  {name}: {depth} bits per channel", file=sys.stderr)
        print("\nRegenerate them: npx tauri icon <1024x1024 8-bit source.png>", file=sys.stderr)
        return 1

    print(f"icons: {checked} PNGs, all 8-bit")
    return 0


if __name__ == "__main__":
    sys.exit(main())
