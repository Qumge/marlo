#!/usr/bin/env python3
"""上游漂移报告：我们改过的文件里，哪些上游也在动。

这个仓库是一个 fork（上游见 git remote），上游会继续发版。脚本回答的不是
"现在冲突了吗"——分叉当天冲突永远为零，那个答案永远是真的也永远没用——而是"下次上游动的
时候，哪里会疼"。

## 指标是 hunk 数 × 上游对该文件的提交数，这一点走了三次弯路

一开始按【文件数】：我们改了 93 个上游文件，其中 41 个是纯改名，于是判断
"收敛那 41 个"。错——合并冲突按行判定，不按文件。

改成【行数 × 上游提交数】：对我们【新增】的代码是对的（api.ts 108 行、
manager.py 118 行，搬走之后各降到 4 行和 18 行）。但对我们【替换】上游功能
的地方是错的：账号行抽成组件后，删掉上游 228 行也被算成 228 分，指标反而
上升——而实际的解冲突成本是下降的（从"两份代码交织要逐行判断"变成"我们整块
删了，保留删除即可"）。

最后是【hunk 数 × 上游提交数】。一个 hunk 就是一处连续的冲突区域，也就是
一次要人做判断的地方。删掉一整块 = 1 个 hunk；散在 11 处各改一行 = 11 个
hunk。这才对得上真实成本。

这段历史留在这里，是因为下一个人很可能同样先想到"文件数"。

## 怎么用

    python3 packaging/check_upstream_drift.py

不进 CI 的必跑项：它要 fetch upstream（网络），而且输出是给人看的判断材料，
不是通过/失败。每周一次，或者上游发版时跑。

退出码永远是 0，除非 git 本身出错——把它做成"失败"会逼人去调低标准，而这个
脚本存在的意义正是让人看见真实数字。
"""
from __future__ import annotations

import subprocess
import sys

UPSTREAM = "upstream/main"
TOP_N = 12


def git(*args: str) -> str:
    return subprocess.run(
        ["git", *args], capture_output=True, text=True, check=True
    ).stdout


def main() -> int:
    try:
        subprocess.run(["git", "fetch", "upstream"], capture_output=True, check=True)
        base = git("merge-base", "HEAD", UPSTREAM).strip()
    except subprocess.CalledProcessError as exc:
        print(f"git 出错（是否配了 upstream remote？）：{exc}", file=sys.stderr)
        return 1

    ahead = len(git("rev-list", f"{base}..HEAD").split())
    behind = len(git("rev-list", f"{base}..{UPSTREAM}").split())
    print(f"共同祖先 {base[:8]}   我们领先 {ahead}，落后 {behind}")
    if behind == 0:
        print("上游自分叉以来还没动过 —— 这是搬走热文件里代码的最便宜时刻。")
    print()

    rows = []
    for path in git("diff", "--name-only", "--diff-filter=M", f"{base}..HEAD").split("\n"):
        if not path:
            continue
        hunks = git("diff", "-U0", f"{base}..HEAD", "--", path).count("\n@@")
        churn = len(git("log", "--oneline", base, "--", path).strip().split("\n")) if git(
            "log", "--oneline", base, "--", path
        ).strip() else 0
        rows.append((hunks * churn, hunks, churn, path))

    rows.sort(reverse=True)
    total = sum(r[0] for r in rows)

    print(f"{'文件':<48}{'hunk':>6}{'上游提交':>10}{'风险':>8}")
    print("-" * 72)
    for score, hunks, churn, path in rows[:TOP_N]:
        print(f"{path[:48]:<48}{hunks:>6}{churn:>10}{score:>8}")
    if len(rows) > TOP_N:
        print(f"…… 另外 {len(rows) - TOP_N} 个文件，合计 {sum(r[0] for r in rows[TOP_N:])} 分")
    print("-" * 72)
    print(f"{'总风险分':<48}{'':>6}{'':>10}{total:>8}")
    print()
    print("怎么读：分高 = 下次上游改这个文件时，要人手工判断的地方多。")
    print("降低它的办法是把【我们新增的】代码搬到新文件（新文件永不冲突）；")
    print("【替换上游功能】的地方搬不掉，但抽成独立组件能让解冲突从逐行判断")
    print("变成一次性的取舍。")
    print()
    print("已知的、故意不动的：")
    print("  surfaces/gui/src/App.tsx —— 上游改得最勤，但我们只改了 32 行，")
    print("      拆它的收益不抵风险。这是决定，不是遗漏。")
    return 0


if __name__ == "__main__":
    sys.exit(main())
