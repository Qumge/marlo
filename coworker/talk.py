"""用话回答卡片的服务端判据（owner 2026-09-23）。

Marlo 的用户平时是说话（打字或语音），只有授权时才点一下；卡片等着的时候，一句「发吧」
「先别发」也算回答（判是 / 否在前端，只认词表，见 surfaces/gui/src/replyIntent.ts）。

例外是【删了 / 付了就收不回来】的操作：必须点按钮。语音识别偶尔会听错 ——
把「先别删」听成「删」，这种错的代价没法挽回。needs_tap 就是这条例外的判据，
它进审批事件（tap_only），前端据此不接受口头回答。

判据故意收得窄：只拦删除和付款两类，外加已有的 human_only 地板。发消息、写文件、
建日程这些都能口头答 —— 拦得太宽，「用话回答」就名存实亡了。
"""

from __future__ import annotations

import re
from typing import Any, Optional

# 工具名里带这些词的：连接器 / MCP 的删除、清空、付款、转账、退款。
# 按词边界（下划线、双下划线、点、横线）切，免得 "undelete" / "transferable" 这种误伤。
_TAP_WORDS = {
    "delete", "remove", "trash", "purge", "erase", "destroy", "wipe",
    "pay", "payment", "payout", "charge", "refund", "transfer", "purchase", "withdraw",
}

# run_shell 里的破坏性命令：删文件、硬重置、强推、清空。只看【命令词】所在的位置
# （行首或 && ; | 之后），不看引号里的正文 —— echo "稍后确认转账" 不是转账。
_SHELL_DESTRUCTIVE = re.compile(
    r"(?:^|&&|\|\||;|\|)\s*(?:sudo\s+)?"
    r"(?:rm|rmdir|unlink|shred|srm|del|erase|rd|truncate"
    r"|git\s+(?:reset\s+--hard|clean\b|push\s+(?:[^;&|]*\s)?(?:-f|--force)\b|branch\s+-D))\b"
)


def _words(name: str) -> set[str]:
    return {w for w in re.split(r"[^a-z]+", name.lower()) if w}


def needs_tap(tool_name: str, arguments: Optional[dict[str, Any]] = None, *, human_only: bool = False) -> bool:
    """True = 这张审批卡只能点按钮确认，不接受口头回答。"""
    if human_only:
        return True
    if tool_name == "run_shell":
        command = str((arguments or {}).get("command", ""))
        return bool(_SHELL_DESTRUCTIVE.search(command))
    return bool(_words(tool_name) & _TAP_WORDS)
