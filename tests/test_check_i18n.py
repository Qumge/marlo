"""i18n 守卫本身的测试。

这个守卫在 CI 上把 Windows 构建挂掉过一次：它用 `path.relative_to(SRC)` 记路径，
而 Windows 上分隔符是反斜杠、基线里存的是正斜杠 —— 184 条基线【全部】被当成新增。

守卫在某个平台上恒失败，比没有守卫更糟：它会被人当成噪音关掉。
"""
from __future__ import annotations

import importlib.util
import os
import sys
from pathlib import Path

import pytest

SPEC = importlib.util.spec_from_file_location(
    "check_i18n", Path(__file__).resolve().parent.parent / "packaging" / "check_i18n.py"
)
mod = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(mod)


def test_paths_are_recorded_with_forward_slashes():
    """这是把 Windows 构建挂掉的那一条。

    【在 macOS 上直接跑 scan() 验不了它】：POSIX 的 relative_to 本来就给正斜杠，
    所以断言"没有反斜杠"永远通过——第一版就是这样，negative control 拆掉
    as_posix() 之后测试照样绿。要验就得让路径【真的】表现得像 Windows。
    """
    import pathlib as _pl

    win = _pl.PureWindowsPath("components/connectors/SlackDetail.tsx")
    # 守卫必须把它规成正斜杠；直接 str() 会得到反斜杠。
    assert "\\" in str(win), "样本本身不像 Windows 路径，这条测试证明不了什么"
    assert win.as_posix() == "components/connectors/SlackDetail.tsx"

    # 再确认守卫【用的就是】as_posix，而不是碰巧在这台机器上对。
    src = (Path(__file__).resolve().parent.parent / "packaging" / "check_i18n.py").read_text(
        encoding="utf-8"
    )
    assert ".relative_to(SRC).as_posix()" in src, (
        "守卫没有规范化路径分隔符 —— Windows 上整份基线会被当成新增"
    )

    for entry in mod.scan():
        assert "\\" not in entry.split(":", 1)[0], entry


def test_the_guards_survive_a_cp1252_console():
    """守卫会打中文，而 Windows 控制台默认 cp1252。

    CI 上实测挂过一次：路径的 bug 修好后，它换成因为【自己的提示语】编码不了而
    崩掉，报 UnicodeEncodeError —— 和它要检查的事情毫无关系。一个因为打印失败而
    挂掉的检查器，比没有检查器更让人困惑。

    在 macOS 上直接跑验不了（这里是 UTF-8），得把子进程的编码真的换掉。
    """
    import subprocess

    root = Path(__file__).resolve().parent.parent
    for script in ("check_i18n.py", "check_branding.py"):
        r = subprocess.run(
            [sys.executable, str(root / "packaging" / script)],
            env={**os.environ, "PYTHONIOENCODING": "cp1252"},
            capture_output=True, text=True, cwd=root,
        )
        assert r.returncode == 0, f"{script} 在 cp1252 下挂了：{r.stderr[-400:]}"
        assert "UnicodeEncodeError" not in r.stderr, script


def test_the_baseline_matches_what_the_scan_finds_today():
    # 基线漂了（有人翻译完忘了 --rebaseline，或反过来），下一次 CI 才发现。
    base = set(mod.BASELINE.read_text(encoding="utf-8").split("\n")) - {""}
    found = set(mod.scan())
    assert not (found - base), f"有 {len(found - base)} 条没进基线也没翻译"


def test_it_sees_text_whose_bracket_is_on_another_line():
    """`>` 和文字不在同一行时也要能看见。

    这是 0.4.1 漏掉整个上手引导的原因：两条正则都逐行跑，而带属性的元素被 Prettier
    一换行，文字就到了下一行 ——

        <button
          className="..."
        >
          Use your own API key instead
        </button>

    带属性的多行元素是这个代码库里最常见的形状，不是边角情况。守卫当时报的是
    「基线 29 条，无新增」，而新用户看到的第一屏整段是英文。

    【为什么单独测这一条】：现成的 test_the_baseline_matches_what_the_scan_finds_today
    只断言"没有基线之外的新东西"。把这个分支拆掉，scan() 结果变成基线的子集，那条
    测试照样通过 —— 它拦不住守卫【变弱】，而变弱正是这里出过的事。
    """
    sample = (
        '<button\n'
        '  className="x"\n'
        '  onClick={f}\n'
        '>\n'
        '  Use your own API key instead\n'
        '</button>\n'
    )
    import tempfile

    with tempfile.TemporaryDirectory() as d:
        src = Path(d)
        (src / "Fixture.tsx").write_text(sample, encoding="utf-8")
        original = mod.SRC
        try:
            mod.SRC = src
            found = [f.split(": ", 1)[1] for f in mod.scan()]
        finally:
            mod.SRC = original
    assert "Use your own API key instead" in found, found

    # 逐行那条【看不见】它 —— 这才说明上面那条不是多余的。
    assert not any(mod._TEXT.search(line) for line in sample.splitlines())


def test_it_sees_english_inside_template_literals():
    """反引号里的英文照样渲染给用户看。

    0.4.2 那张截图上，全中文界面里是「连接 Google Calendar」旁边一个英文按钮
    "Connect Google Calendar with one click" —— 它是 `Connect ${c.title} with one
    click`，三条正则一条都匹配不到（它们只认双引号和 >…<）。守卫报"无新增"。

    判据是【去掉所有 ${...} 之后仍然有英文单词】：纯插值和路径不算。已经调了 t(
    的也不算 —— 那是做完了，不是漏了（嵌套模板会被外层正则截出一段，看着像漏）。
    """
    import tempfile

    sample = (
        'const a = <button>{`Connect ${c.title} with one click`}</button>;\n'
        'const b = `${host}:${port}`;\n'                       # 纯插值，不算
        'const c2 = <b>{`${t("artifacts")} ${n}`}</b>;\n'      # 已经走 t()，不算
        'const d = <img className={`w-${n} h-${n}`} />;\n'     # className，不算
    )
    with tempfile.TemporaryDirectory() as d:
        src = Path(d)
        (src / "Fixture.tsx").write_text(sample, encoding="utf-8")
        original = mod.SRC
        try:
            mod.SRC = src
            found = [f.split(": ", 1)[1] for f in mod.scan()]
        finally:
            mod.SRC = original
    assert any("with one click" in f for f in found), found
    assert not any("host" in f or "artifacts" in f or "w-" in f for f in found), found


def test_it_sees_bare_literals_and_text_split_by_expressions():
    """最后两种形状：三元/函数参数里的字符串，和被 {expr} 截断的文本。

    前四条规则都是在给"英文出现的形状"列清单，而 JSX 的形状列不完 —— 每补一条
    又冒出一种。UpdateBanner 一个文件里就有三种：`Marlo v{update.version} is
    ready to install.`（被表达式截断）、`{busy ? "Downloading…" : "Restart to
    update"}`（三元里的字面量）、以及后面跟着条件块的多行文本。

    所以这两条反过来做：默认全抓，靠 _looks_like_prose 和 ALLOWED 收敛。
    """
    import tempfile

    sample = (
        'const a = <div>Marlo v{u.version} is ready to install.</div>;\n'
        'const b = <span>{busy ? "Downloading now…" : "Restart to update"}</span>;\n'
        'const c2 = <div className="flex items-center gap-2 rounded-full" />;\n'   # css，不算
        'const d = <a href="https://example.com/some/path" />;\n'                  # url，不算
        'const e = el.setAttribute("data-role", "menu-item");\n'                   # 全小写 id，不算
    )
    with tempfile.TemporaryDirectory() as d:
        src = Path(d)
        (src / "Fixture.tsx").write_text(sample, encoding="utf-8")
        original = mod.SRC
        try:
            mod.SRC = src
            found = [f.split(": ", 1)[1] for f in mod.scan()]
        finally:
            mod.SRC = original
    assert any("ready to install" in f for f in found), found
    assert any("Restart to update" in f for f in found), found
    # 噪声：css / url / 小写 id 一条都不该进来
    assert not any("rounded-full" in f or "example.com" in f or "menu-item" in f for f in found), found


def test_it_still_ignores_type_signatures_across_lines():
    # 跨行匹配放宽了边界，别把 `=> Promise<void>` 这类又收回来（基线里躺过 5 条）。
    for src in ("const f = () =>\n  doThing<void>\n", "type A = Map<\n  string\n>\n"):
        assert not list(mod._TEXT_ML.finditer(src)), src


def test_brand_names_are_not_flagged():
    # 把 Gmail、Slack 这些当成"没翻译"会让守卫吵到没人看。
    found = mod.scan()
    for name in ("Gmail", "Slack", "GitHub", "Marlo", "MCP", "IMAP"):
        assert not any(e.endswith(f": {name}") for e in found), name


def test_comments_are_not_scanned():
    # 注释里出现英文句子是正常的，它们不会被用户读到。
    assert not any("//" in e for e in mod.scan())


def test_an_empty_scan_fails_loudly():
    # 路径改动让它扫不到东西时必须失败 —— 一个静默通过的守卫等于没有守卫。
    original = mod.SRC
    try:
        mod.SRC = Path("/nonexistent")
        assert mod.main() == 1
    finally:
        mod.SRC = original
