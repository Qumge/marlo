// 模式按钮认得服务端回传的模式值（2026-09-15）。
//
// 服务端 ready 事件回传的是 Mode.value —— 完全放手是 "bypass-approvals"；前端这一项原来用旧写法
// "auto"，按钮按 value 查不到选项，就把原始值显示成 "bypass-approvals"（0.8.4 本地包实测截图）。
// 对话默认改成完全放手之后，每个新会话都会撞上。断言的是【屏幕上的字】。
import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { setTestLocale } from "../testLocale";
import { Composer, modeLabel } from "./Composer";

const props = (mode: string) => ({
  mode,
  // 模式按钮只在有工作区的会话里渲染（Composer.tsx：props.workspace !== undefined）
  workspace: "/tmp/w",
  model: "gpt-5.6-sol",
  running: false,
  connected: true,
  onSend: vi.fn(),
  onInterrupt: vi.fn(),
  onModeChange: vi.fn(),
  onModelChange: vi.fn(),
});

afterEach(async () => {
  cleanup();
  await act(async () => {
    await setTestLocale("en");
  });
});

describe("mode picker speaks the server's mode values", () => {
  it("zh: a session the server reports as bypass-approvals shows 完全放手, not the raw value", async () => {
    await act(async () => {
      await setTestLocale("zh");
    });
    render(<Composer {...props("bypass-approvals")} />);
    expect(screen.queryByText(/bypass-approvals/)).toBeNull();
    expect(screen.getAllByText(/完全放手/).length).toBeGreaterThan(0);
  });

  it("the legacy wire value still reads as the same mode (saved sessions, PlanCard's approve-and-run)", () => {
    expect(modeLabel("auto")).toBe(modeLabel("bypass-approvals"));
    expect(modeLabel("bypass-approvals")).not.toBe("bypass-approvals");
  });

  it("an unknown value still falls back to itself rather than guessing", () => {
    expect(modeLabel("some-future-mode")).toBe("some-future-mode");
  });
});
