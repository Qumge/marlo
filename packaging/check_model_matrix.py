#!/usr/bin/env python3
"""我们写死的 qumge 模型 id，在网关上必须真的存在。

2026-08-03：`qumge:anthropic/claude-opus-4-6` 在两个地方躺了不知道多久 —— 网关上
那一条叫 `claude-opus-4.6`，点号不是连字符。而它是【默认勾上的】，任何一个新用户
在选择器里点中它，请求都会被网关拒。

这类错不是靠细心能避免的：精选表是我们手写的，网关的清单是 qumge 在动的，两边
之间原本没有任何东西在对账。人只会在用户报错之后才发现。

【为什么不是一条 pytest】.github/workflows/ci.yml 开头就写着那三个 job 是 hermetic
的（no model or network needed）。往里面塞一个要出网的检查，等于把 CI 的可靠性押
在 qumge 的可达性上：网络抖一下就红，红得多了就没人看了。所以这里是一个独立脚本，
挂在【定时】job 和发版脚本上 —— 漂移是按 qumge 的时钟发生的，不是按我们提交的
时钟，一天查一次足够。

【连不上 ≠ 漂移】查不成就退出 0，只在【真的查到了清单、而某个 id 不在里面】时才
退出 1。一个会因为网络问题弄红构建的检查，最后的下场是被人加 `|| true` 绕过去，
那时它比不存在更糟。
"""
from __future__ import annotations

import sys
from pathlib import Path

for _s in (sys.stdout, sys.stderr):
    try:
        _s.reconfigure(encoding="utf-8", errors="replace")
    except (AttributeError, ValueError):  # 非 TTY / 老版本
        pass

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))


def ours() -> dict[str, list[str]]:
    """我们写死了 qumge id 的每一处 —— id -> 出现在哪些地方。

    直接 import 而不是正则扫文件：清单换个写法（拆成常量、改成推导）正则就瞎了，
    而瞎掉的表现是"检查通过"。
    """
    from coworker.config import DEFAULT_MODEL
    from coworker.providers.matrix import MATRIX
    from coworker.server.manager import SessionManager

    found: dict[str, list[str]] = {}
    for mid in (k for k in MATRIX if k.startswith("qumge:")):
        found.setdefault(mid, []).append("providers/matrix.py")
    for tail in SessionManager.COMPAT_MODELS.get("qumge", []):
        found.setdefault(f"qumge:{tail}", []).append("server/manager.py")
    # 默认模型漂掉是最坏的一种：每一个新用户开箱就踩。
    if DEFAULT_MODEL.startswith("qumge:"):
        found.setdefault(DEFAULT_MODEL, []).append("config.py DEFAULT_MODEL")
    return found


def main() -> int:
    mine = ours()
    if not mine:
        print("model-matrix: 没有写死的 qumge id，无需对账")
        return 0

    from coworker.skills import qumge_catalog

    try:
        # 用 app 自己那条解析路径，不另写一份：解析要是坏了，这里也该看得见。
        # 【60 不是随便选的】list_models 的 schema 原话是 "Default 20, max 60."，
        # 超出的值被服务端悄悄夹住 —— 这里原来写 500，读起来像是在拿全量，其实
        # 拿到的一直是【最常用的 60 条】。下面的 missing 因此要逐个再确认一次。
        live = {m["id"] for m in qumge_catalog.models("", limit=60)["models"]}
    except Exception as exc:  # noqa: BLE001
        print(f"model-matrix: 连不上 qumge，这次没查成（{exc}）")
        return 0

    if not live:
        # 六十条同时消失的可能性远低于"网关或解析出了问题"。当成没查成，别把一次
        # 基础设施故障报成"我们写的每一个 id 都错了"。
        print("model-matrix: 网关没返回任何模型，这次没查成")
        return 0

    # 【报之前逐个再确认一次】上面那份清单最多 60 条，而网关上远不止（探一轮就能
    # 摸出一百多个）。一个写死的 id 只要不在【最常用的那 60 条】里，就会在这里被
    # 当成"不存在"—— 而这个脚本报出来的话是"点下去会被网关拒"，那是一句会让人去
    # 追一个不存在的漂移的谎。按 id 的尾段单独搜一次，真的搜不到才算漂了。
    for mid in sorted(m for m in mine if m not in live):
        try:
            hits = qumge_catalog.models(mid.split("/", 1)[-1], limit=60)["models"]
        except Exception:  # noqa: BLE001
            # 单独这一次查询挂了，不能升级成"这个 id 不存在"—— 和上面同一个道理。
            live.add(mid)
            continue
        live.update(m["id"] for m in hits)

    missing = sorted(m for m in mine if m not in live)
    if not missing:
        # 【不说"网关共 N 个"】那个数是我们这一趟见到的条数，不是网关的总数 ——
        # 一次最多问到 60 个，总数只有 qumge 自己知道。这个脚本的整个存在理由就是
        # 不让一个假数字在无人复核的地方待着。
        print(f"model-matrix: {len(mine)} 个写死的 id 都在网关上")
        return 0

    print(f"model-matrix: {len(missing)} 个写死的 id 在网关上【不存在】——")
    for m in missing:
        print(f"  {m}")
        print(f"      出现在: {', '.join(mine[m])}")
        # 猜一个最接近的：漂移几乎都是标点/版本号的小差别（4-6 vs 4.6），
        # 直接把候选摆出来比让人自己去翻 60 条快得多。
        tail = m.split("/", 1)[-1]
        stem = "".join(c for c in tail.lower() if c.isalnum())[:12]
        near = sorted(x for x in live if stem[:8] and stem[:8] in "".join(
            c for c in x.lower() if c.isalnum()))
        if near:
            print(f"      网关上像是: {', '.join(near[:4])}")
    print("\n这些模型会出现在选择器里，但点下去会被网关拒。")
    return 1


if __name__ == "__main__":
    raise SystemExit(main())
