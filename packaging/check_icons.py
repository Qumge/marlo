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

# Windows 的控制台默认 cp1252，编码不了中文 —— 守卫会因为【自己的提示语】崩掉，
# 报出来的是 UnicodeEncodeError，和它要检查的事情毫无关系。
#
# check_i18n.py 头上写着同一段话，因为那边先撞过一次。2026-08-01 这边又撞了一次：
# 给托盘图标那条检查加了中文输出（"tray: 字形占 90.9%…"）却没抄这一段，于是
# v0.5.0 的 Windows 发版构建挂在 icon check 上 —— 报的正是这个错，而图标本身没问题。
#
# 防这类"抄了一半"的办法不是记住，是让测试自己发现新守卫：
# tests/test_check_i18n.py 的名单已经从手写改成扫 packaging/check_*.py。
for _s in (sys.stdout, sys.stderr):
    try:
        _s.reconfigure(encoding="utf-8", errors="replace")
    except (AttributeError, ValueError):  # 非 TTY / 老版本
        pass

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
    return check_tray_fill()


# 菜单栏图标的大小 = 【字形在画布里的占比】，不是画布大小。
#
# tray-icon 在 macOS 上把整张画布缩到 18pt 高（platform_impl/macos/mod.rs 里
# icon_height: f64 = 18.0），缩的是画布不是字形。0.4.5 的 tray.png 是手工导出的，
# 字形只占 44×44 的 63.6%，那 36% 的透明边距原样进了菜单栏 —— 可见标记 11.5pt，
# 而旁边 1Password 是 16pt 出头。owner 的原话是"要大一点，类似 1password"。
#
# 这条量的是 tray.rgba：Rust 用 include_bytes! 嵌的就是它，PNG 只是给人看的副本。
# 生成脚本是 packaging/make_tray_icon.py。
TRAY_SIDE = 44
TRAY_MIN_FILL = 0.85


def check_tray_fill() -> int:
    raw = ICONS / "tray.rgba"
    if not raw.is_file():
        print(f"{raw.name} 不见了 —— Rust 侧 include_bytes! 会编译不过", file=sys.stderr)
        return 1

    data = raw.read_bytes()
    want = TRAY_SIDE * TRAY_SIDE * 4
    if len(data) != want:
        print(f"{raw.name}: {len(data)} 字节，应为 {want}（{TRAY_SIDE}×{TRAY_SIDE} RGBA）"
              f"\nlib.rs 里的 Image::new(..., {TRAY_SIDE}, {TRAY_SIDE}) 要跟着改。", file=sys.stderr)
        return 1

    rows = [y for y in range(TRAY_SIDE)
            if any(data[(y * TRAY_SIDE + x) * 4 + 3] for x in range(TRAY_SIDE))]
    cols = [x for x in range(TRAY_SIDE)
            if any(data[(y * TRAY_SIDE + x) * 4 + 3] for y in range(TRAY_SIDE))]
    if not rows or not cols:
        print(f"{raw.name}: 整张全透明", file=sys.stderr)
        return 1

    fill = max(rows[-1] - rows[0] + 1, cols[-1] - cols[0] + 1) / TRAY_SIDE
    if fill < TRAY_MIN_FILL:
        print(f"tray 字形只占画布 {fill:.1%}（下限 {TRAY_MIN_FILL:.0%}）——"
              f" 菜单栏里会显示成 {18 * fill:.1f}pt，比同类应用小一号。"
              f"\n重新生成：python3 packaging/make_tray_icon.py", file=sys.stderr)
        return 1

    print(f"tray: 字形占 {fill:.1%}，菜单栏约 {18 * fill:.1f}pt")
    return 0


if __name__ == "__main__":
    sys.exit(main())
