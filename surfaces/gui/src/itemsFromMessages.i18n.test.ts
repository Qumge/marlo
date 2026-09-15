// 回放出来的通知在中文界面上不能是英文。
//
// 【为什么单独量】实时路径（App.tsx）收到事件时一直走 t()，回放路径（itemsFromMessages.ts）
// 却写死英文 —— 同一条「已中断。」，刷新之后就变成 "Interrupted."，MCP 没启动那一行也是。
// 它们是普通对象不是 JSX，check_i18n.py 以前只扫 .tsx，一直看不见。
//
// 判据同 humanize.i18n.test.ts：显示出来的 title + text 去掉动态值（服务器名）和专名之后，
// 不能再有连续 3 个以上的英文字母。英文一个字节不变由 itemsFromMessages.test.ts 量。
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { itemsFromMessages } from "./itemsFromMessages";
import { setTestLocale } from "./testLocale";

// 服务端不带 text 的形状 —— 这时显示的全是 GUI 自己补的句子。
const CASES: Array<{ label: string; msg: Record<string, unknown> }> = [
  { label: "interrupted", msg: { role: "notice", kind: "interrupted" } },
  { label: "model_switch fallback", msg: { role: "notice", kind: "model_switch" } },
  { label: "compacted fallback", msg: { role: "notice", kind: "compacted" } },
  { label: "reviewer_paused fallback", msg: { role: "notice", kind: "reviewer_paused" } },
  { label: "mode_notice fallback title", msg: { role: "notice", kind: "mode_notice" } },
  { label: "mcp_error with server", msg: { role: "notice", kind: "mcp_error", server: "sales-db", text: "boom" } },
  { label: "mcp_error without server", msg: { role: "notice", kind: "mcp_error" } },
];

describe("replayed notices in Chinese", () => {
  beforeAll(() => setTestLocale("zh"));
  afterAll(() => setTestLocale("en"));

  it.each(CASES)("$label", ({ msg }) => {
    const [item] = itemsFromMessages([msg as any]);
    const { title, text } = item as { title?: string; text?: string };
    const shown = [title, text].filter(Boolean).join(" ");
    expect(shown, "什么都没显示 —— 这条测试就量不到东西").not.toBe("");
    expect(shown.replace("sales-db", "").replace(/MCP/g, "")).not.toMatch(/[A-Za-z]{3,}/);
  });
});
