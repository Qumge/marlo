"""清单里的下载地址指向哪儿 —— 这决定了没有代理的用户能不能装上、能不能更新。

github.com 在国内直连不通（2026-07-27 实测 30 秒超时），而清单和安装包原本【全在
GitHub 上】。--base-url 把它们换到 R2 镜像（自定义域名，实测 2 秒可达）。
"""
from __future__ import annotations

import json
import subprocess
import sys
from pathlib import Path

SCRIPT = Path(__file__).parent / "make_update_manifest.py"
ASSETS = ["Marlo-macos-arm64.app.tar.gz", "Marlo-windows-setup.exe"]


def build(tmp_path, *extra):
    dist = tmp_path / "dist"
    dist.mkdir()
    for a in ASSETS:
        (dist / a).write_bytes(b"x")
        (dist / (a + ".sig")).write_text("SIGNATURE\n")
    out = dist / "latest.json"
    r = subprocess.run(
        [sys.executable, str(SCRIPT), "--version", "0.3.4", "--tag", "v0.3.4",
         "--repo", "Qumge/marlo", "--dist", str(dist), "--out", str(out), *extra],
        capture_output=True, text=True,
    )
    assert r.returncode == 0, r.stderr
    return json.loads(out.read_text())


def test_without_a_mirror_it_still_points_at_github(tmp_path):
    # fork 和没配镜像的构建必须照常工作 —— 镜像是可选的。
    m = build(tmp_path)
    for p in m["platforms"].values():
        assert p["url"].startswith("https://github.com/Qumge/marlo/releases/download/v0.3.4/")


def test_with_a_mirror_every_url_moves(tmp_path):
    m = build(tmp_path, "--base-url", "https://cdn.qumge.com/marlo")
    assert m["platforms"], "没有平台条目，这个测试什么也没证明"
    for name, p in m["platforms"].items():
        assert p["url"].startswith("https://cdn.qumge.com/marlo/v0.3.4/"), name
        assert "github.com" not in p["url"], f"{name} 还指着 GitHub —— 没代理的用户下不动"


def test_the_tag_stays_pinned(tmp_path):
    # 绝不能指向 latest/：清单必须引用【它自己发布的那批】产物，否则半发布状态下
    # 会混版本。
    m = build(tmp_path, "--base-url", "https://cdn.qumge.com/marlo")
    for p in m["platforms"].values():
        assert "/v0.3.4/" in p["url"] and "/latest/" not in p["url"]


def test_a_trailing_slash_does_not_double_up(tmp_path):
    m = build(tmp_path, "--base-url", "https://cdn.qumge.com/marlo/")
    for p in m["platforms"].values():
        assert "//v0.3.4" not in p["url"].replace("https://", "")


def test_signatures_still_travel(tmp_path):
    # 镜像换的是地址，不是信任链：签名仍然要在，客户端仍然按 pubkey 校验。
    m = build(tmp_path, "--base-url", "https://cdn.qumge.com/marlo")
    for p in m["platforms"].values():
        assert p["signature"] == "SIGNATURE"
