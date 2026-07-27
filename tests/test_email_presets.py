"""邮箱上手：域名预设 + 按服务商的分步指引。

这一屏是整个上手流程里【唯一】要求用户离开 Marlo 去别的网站操作的地方，也是最
容易放弃的一处。两件事决定它成不成立：

  1. 命中预设 —— 用户只填地址和密码，不用去查 IMAP 主机和端口；
  2. 只显示他那一家的步骤 —— 不是四家一起摆出来让他自己认领。

预设表原来只有 Gmail / iCloud / Fastmail，而 Marlo 面向的是国内白领。
"""
from __future__ import annotations

import pytest

from coworker.connectors.descriptors import get_descriptor
from coworker.connectors.email_tools import _PRESETS, resolve_servers

# 目标用户真正在用的。少一个，那批人打开表单看到的就是"IMAP 主机（高级）"。
MUST_COVER = [
    "qq.com", "foxmail.com", "163.com", "126.com", "outlook.com",
    "hotmail.com", "gmail.com", "icloud.com",
]


@pytest.mark.parametrize("domain", MUST_COVER)
def test_the_domains_our_users_actually_use_are_presets(domain):
    servers, _ = resolve_servers({"address": f"someone@{domain}"})
    assert servers is not None, f"{domain} 没有预设 —— 这批用户要手填 IMAP"
    assert servers.imap_host and servers.smtp_host, domain


def test_every_preset_has_a_sane_shape():
    # 端口填错的表现是【连接卡住】而不是报错，所以在这里拦。
    for domain, s in _PRESETS.items():
        assert s.imap_port in (993, 143), f"{domain} 的 IMAP 端口是 {s.imap_port}"
        assert s.smtp_port in (465, 587, 25), f"{domain} 的 SMTP 端口是 {s.smtp_port}"
        assert "." in s.imap_host and "." in s.smtp_host, domain


def test_explicit_fields_still_win_over_a_preset():
    # 高级设置的存在意义：预设错了或服务商特殊时，用户能覆盖它。
    servers, _ = resolve_servers(
        {"address": "someone@qq.com", "imap_host": "mail.corp.example.com"}
    )
    assert servers.imap_host == "mail.corp.example.com"


def test_unknown_domain_gets_no_preset_rather_than_a_wrong_one():
    servers, _ = resolve_servers({"address": "someone@weird-corp.example"})
    assert servers is None or not servers.imap_host, "给了一个猜的服务器 —— 连不上还查不出为什么"


# -- 分步指引 ------------------------------------------------------------------


def test_hints_exist_for_the_big_providers():
    hints = get_descriptor("email").provider_hints
    for d in ("gmail.com", "qq.com", "163.com", "outlook.com", "icloud.com"):
        assert d in hints, f"{d} 没有分步指引"
        h = hints[d]
        assert h["steps"] and h["url"].startswith("https://"), d


def test_hints_say_授权码_for_the_chinese_providers():
    # QQ / 网易发的东西【叫授权码】，不叫 app password。用错词会让用户在设置页里
    # 找一个不存在的东西 —— 这正是这一屏最贵的失败方式。
    hints = get_descriptor("email").provider_hints
    for d in ("qq.com", "163.com"):
        assert any("授权码" in s for s in hints[d]["steps"]), d


def test_the_generic_instructions_stay_short():
    # 通用说明只留【与所有人都相关】的。服务商各自的步骤在 provider_hints 里 ——
    # 一屏同时讲四家，用户得先判断哪条是说自己的。
    d = get_descriptor("email")
    assert len(d.instructions) <= 2, f"通用说明又长回去了：{len(d.instructions)} 条"


def test_every_hinted_domain_also_has_a_preset():
    # 给了步骤却没有预设，用户照着做完还是要手填 IMAP —— 走到最后一步才卡住。
    hints = get_descriptor("email").provider_hints
    for domain in hints:
        servers, _ = resolve_servers({"address": f"x@{domain}"})
        assert servers and servers.imap_host, f"{domain} 有指引但没预设"
