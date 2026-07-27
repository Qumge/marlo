// 普通名词的连接器名要跟着界面语言走 —— 专名不能跟。
//
// 中文界面里「可访问范围 · Browser · 1 个文件夹」是本地化没做完；但把 Gmail 翻成
// 「谷歌邮箱」会让人对不上自己在别处见到的那个东西。分界就是"它是不是专名"。
import { beforeEach, describe, expect, it, vi } from "vitest";
import { getConnectors } from "./api";
import { setLocale } from "./i18n";

const CONNECTORS = [
  { name: "browser", title: "Browser", logo: "browser", fields: [] },
  { name: "email", title: "Email (IMAP)", logo: "email", fields: [] },
  { name: "gmail", title: "Gmail", logo: "gmail", fields: [] },
  { name: "slack", title: "Slack", logo: "slack", fields: [] },
];

beforeEach(() => {
  vi.stubGlobal("fetch", vi.fn(async () => ({ json: async () => ({ connectors: CONNECTORS }) })));
});

describe("连接器名的本地化", () => {
  it("中文界面：普通名词翻译，专名不动", async () => {
    setLocale("zh");
    const byName = Object.fromEntries((await getConnectors()).map((c) => [c.name, c.title]));
    expect(byName.browser).toBe("浏览器");
    expect(byName.email).toBe("邮箱");
    expect(byName.gmail).toBe("Gmail");
    expect(byName.slack).toBe("Slack");
  });

  it("英文界面：一个都不变", async () => {
    setLocale("en");
    const byName = Object.fromEntries((await getConnectors()).map((c) => [c.name, c.title]));
    expect(byName.browser).toBe("Browser");
    expect(byName.gmail).toBe("Gmail");
  });

  it("没在映射表里的连接器原样通过 —— 不能吃掉后端的 title", async () => {
    setLocale("zh");
    const list = await getConnectors();
    expect(list).toHaveLength(4);
    expect(list.every((c) => c.title)).toBe(true);
  });
});
