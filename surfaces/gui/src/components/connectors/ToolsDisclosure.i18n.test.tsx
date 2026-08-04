import { describe, it, expect, afterEach } from "vitest";
import { render, screen, act, cleanup } from "@testing-library/react";
import { setLocale } from "../../i18n";
import { englishRunsIn } from "../../i18n/no-english";
import { ToolsDisclosure } from "./ToolsDisclosure";

// 这条测试量的是【整条链】：i18n-jsx 的判据 → 构建期 transform → tx() 查表 →
// 渲染出来的字。
//
// 【为什么非要有它】判据、译文表、守卫三样都可以各自绿着，而用户看到的还是英文 ——
// 2026-08-04 就是这样：`clear`、`› Tools`、`enabled` 一直显示英文，源码守卫报
// 「258 条原文全部有译文」。原因是它们【提取不到】（判据把全小写判成 id）或者
// 【被豁免】（"去掉专名后不足两个词"把每个单词标签都放过了）。
//
// 更要命的是，在这条测试之前 vitest 根本没接 i18nText 插件 —— 组件测试跑的是【没
// 经过改写的】源码，所以 no-english.ts 那把 DOM 尺子从来没量到过这条路上的字。
// 现在 vitest.config.ts 和 vite.config.ts 用同一个插件，测的才是用户拿到的东西。

const CONNECTOR = {
  name: "slack",
  title: "Slack",
  connected: true,
  auth: "oauth",
  tools: [
    { name: "post", label: "发消息", description: "d", kind: "write", enabled: true },
    { name: "read", label: "读消息", description: "d", kind: "read", enabled: false },
  ],
} as never;

describe("工具折叠块 · 中文界面上不该有英文", () => {
  afterEach(() => {
    cleanup();
    act(() => setLocale("en"));
  });

  it("切到中文之后，› Tools / enabled / asks first 都是中文", () => {
    act(() => setLocale("zh"));
    render(<ToolsDisclosure c={CONNECTOR} onChanged={() => {}} />);

    // 断言的是【屏幕上真的出现了中文】，不是"表里有这个键"—— 后者在判据漏掉这
    // 几个字符串的时候照样是绿的。
    expect(screen.getByText("› 工具")).toBeTruthy();
    expect(screen.getByText(/已启用/)).toBeTruthy();
    expect(screen.getByText("会先问过你")).toBeTruthy();
    expect(screen.queryByText("› Tools")).toBeNull();
  });

  it("英文仍然是英文 —— 译文不能反过来把 en 也改了", () => {
    act(() => setLocale("en"));
    render(<ToolsDisclosure c={CONNECTOR} onChanged={() => {}} />);
    expect(screen.getByText("› Tools")).toBeTruthy();
  });

  it("整块 DOM 里没有英文虚词残留", () => {
    act(() => setLocale("zh"));
    const { container } = render(<ToolsDisclosure c={CONNECTOR} onChanged={() => {}} />);
    expect(englishRunsIn(container)).toEqual([]);
  });
});
