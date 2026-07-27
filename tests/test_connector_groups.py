"""连接列表的分组和死胡同标注。

规格 D：一个列表，按用户认得的东西分组（邮件/日历/聊天/文件与网盘/网页/其他），
这个版本连不上的要标注或隐藏，不留死胡同。

分组放在后端而不是前端一张映射表：加新连接器时前端那张表会漏，而漏掉的表现是
它悄悄掉进"其他"——没人会发现。
"""
from __future__ import annotations

import pytest

from coworker.connectors.descriptors import DESCRIPTORS, get_descriptor

VALID_GROUPS = {"mail", "calendar", "chat", "files", "web", "other"}


def test_every_group_is_one_the_ui_knows():
    # 前端只认这六个 key。写一个别的，那个连接器会连标题都没有地方显示。
    for d in DESCRIPTORS:
        assert d.group in VALID_GROUPS, f"{d.name} 的 group 是 {d.group!r}"


@pytest.mark.parametrize("name,group", [
    ("email", "mail"), ("gmail", "mail"), ("outlook", "mail"),
    ("google_calendar", "calendar"),
    ("slack", "chat"), ("telegram", "chat"), ("discord", "chat"), ("whatsapp", "chat"),
    ("dropbox", "files"), ("box", "files"), ("google_drive", "files"),
    ("browser", "web"),
])
def test_the_ones_a_white_collar_user_looks_for_are_grouped(name, group):
    # 这几个是白领旅程真正会用到的。掉进"其他"意味着他得在 23 个里翻。
    assert get_descriptor(name).group == group


def test_autowhisper_is_not_hidden_in_other():
    # 我们自己的产品掉进"其他"是最不该发生的——推荐路径正好依赖它被看见。
    # （它不属于邮件/日历/聊天，所以 other 是对的位置，但这条盯着它至少【可用】。）
    d = get_descriptor("autowhisper")
    assert d.available, "autowhisper 不可用了 —— 推荐路径的终点没了"


# -- 死胡同 --------------------------------------------------------------------
#
# 前端的判据（ConnectorsList.blocked）：managed_paused 且 auth == "oauth" 且
# fields <= 1 —— 也就是【没有别的路可走】。这里从后端一侧盯同一个事实，两边一起
# 漂的概率远小于各自漂。


def _is_dead_end(d) -> bool:
    return bool(getattr(d, "managed_paused", False)) and d.auth == "oauth" and len(d.fields) <= 1


def test_the_google_three_are_the_known_dead_ends():
    # 上游审核卡着的就这三个。多出来的要么是新卡住的（该知道），要么是判据漂了。
    dead = {d.name for d in DESCRIPTORS if getattr(d, "available", True) and _is_dead_end(d)}
    assert dead == {"gmail", "google_calendar", "google_drive"}, dead


def test_a_connector_with_a_manual_path_is_never_a_dead_end():
    # 判据是"没有别的路"，不是"managed_paused 为真"。还能手填 token 的不算死胡同
    # ——把它标成"等服务商"会让本来能连的人不去连。
    for d in DESCRIPTORS:
        if len(d.fields) > 1:
            assert not _is_dead_end(d), f"{d.name} 有手填字段却被判成死胡同"


def test_email_stays_connectable_because_it_is_the_way_around_gmail():
    # Gmail 是死胡同时，用户唯一的出路是 Email(IMAP)。它要是也断了，整条邮件
    # 路径就没了。
    d = get_descriptor("email")
    assert d.available and not _is_dead_end(d)
    assert d.auth == "app_password"
