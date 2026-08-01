#!/usr/bin/env python3
"""Render the macOS menu-bar (tray) icon from the app icon.

【为什么要有这个脚本】：tray.png 是手工导出的，字形只占 44×44 画布的 63.6%
（bbox 28×28）。而 tray-icon crate 在 macOS 上【把整张画布缩到 18pt 高】：

    let icon_height: f64 = 18.0;
    let icon_width = (width as f64) / (height as f64 / icon_height);
    nsimage.setSize(NSSize::new(icon_width, icon_height));
    —— tray-icon-0.23.1/src/platform_impl/macos/mod.rs

缩的是画布不是字形，所以那 36% 的透明边距原样带进菜单栏：18pt × 63.6% ≈ 11.5pt
的可见标记，旁边 1Password 是 16pt 出头。看上去就是"我们的图标小一号"。

结论：菜单栏图标的大小 = 字形在画布里的占比。这里把它拉到 GLYPH/CANVAS，并且从
512px 的源图重新采样 —— 直接把 28px 的旧图放大到 40px 会糊。

模板图（icon_as_template(true)）只有黑 + alpha：菜单栏自己按深浅色反相着色，所以
彩色版的蓝底变成不透明的黑，白色的 chevron 变成【挖空】。
"""
from __future__ import annotations

import sys
from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parent.parent
ICONS = ROOT / "surfaces" / "gui" / "src-tauri" / "icons"
SOURCE = ICONS / "icon.png"

CANVAS = 44          # Rust 侧 Image::new(..., 44, 44) 要对上
GLYPH = 40           # 44 的 90.9% -> 菜单栏里约 16.4pt（旧版 11.5pt）

# 源图里的两个颜色：底色的蓝、chevron 的白。
BRAND = (37, 99, 235)


def build() -> Image.Image:
    src = Image.open(SOURCE).convert("RGBA")
    r, _g, _b, a = src.split()

    # whiteness：蓝底 R=37，白字形 R=255。用红通道分开两者，边缘的抗锯齿也跟着
    # 线性过渡 —— 阈值化会让 chevron 长出锯齿。
    lo, hi = BRAND[0], 255
    white = r.point(lambda v: max(0, min(255, round((v - lo) * 255 / (hi - lo)))))

    # 圆盘的覆盖率减掉 chevron 的覆盖率。
    alpha = Image.eval(a, lambda v: v)
    alpha = Image.composite(Image.new("L", src.size, 0), alpha, white)

    glyph = Image.new("RGBA", src.size, (0, 0, 0, 0))
    glyph.putalpha(alpha)

    box = alpha.getbbox()
    if box is None:
        raise SystemExit(f"{SOURCE.name} 里没有不透明像素")
    glyph = glyph.crop(box).resize((GLYPH, GLYPH), Image.LANCZOS)

    out = Image.new("RGBA", (CANVAS, CANVAS), (0, 0, 0, 0))
    off = (CANVAS - GLYPH) // 2
    out.paste(glyph, (off, off))
    return out


def main() -> int:
    out = build()
    png = ICONS / "tray.png"
    rgba = ICONS / "tray.rgba"
    # 8 位/通道：16 位的 PNG 会让 Tauri 在启动时 abort（见 check_icons.py）。
    out.save(png, format="PNG", bits=8)
    rgba.write_bytes(out.tobytes())

    bbox = out.getchannel("A").getbbox()
    frac = 100 * (bbox[2] - bbox[0]) / CANVAS
    print(f"tray: {CANVAS}×{CANVAS}，字形占 {frac:.1f}% -> 菜单栏约 {18 * frac / 100:.1f}pt")
    print(f"  {png.relative_to(ROOT)}")
    print(f"  {rgba.relative_to(ROOT)} ({rgba.stat().st_size} bytes)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
