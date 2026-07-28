// 「能力」页 —— 分类里的另一半。
//
// 用户看到的是两类：能力（技能）和连接。「连接」早就有页面，能力一个界面都没有。
// 这一页回答的是「它现在会什么、这些哪来的」，不是「去哪儿挑技能」——挑技能这件
// 事按规格根本不该由用户做（规格 D'：发现发生在对话里）。
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { AbilitiesView } from "./AbilitiesView";
import { setLocale } from "../i18n";

const serve = (skills: any[]) =>
  vi.stubGlobal("fetch", vi.fn(async () => ({ json: async () => ({ skills }) })));

beforeEach(() => setLocale("zh"));
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("能力页", () => {
  it("装了的技能列出来", async () => {
    serve([{ name: "autowhisper", description: "社交媒体内容创作与发布" }]);
    render(<AbilitiesView />);
    await waitFor(() => expect(screen.getByTestId("ability-autowhisper")).toBeTruthy());
    expect(screen.getByText("社交媒体内容创作与发布")).toBeTruthy();
  });

  it("空状态要【解释机制】，不是给一个去逛逛的按钮", async () => {
    // 一个刚装好的用户看到"还没装任何能力"，第一反应是"那我去哪儿装"，
    // 而正确答案是"你不用装"。这一条盯着那句解释真的在。
    serve([]);
    render(<AbilitiesView />);
    await waitFor(() => expect(screen.getByTestId("abilities-empty")).toBeTruthy());
    expect(screen.getByText(/跟 Marlo 说你要做什么/)).toBeTruthy();
    // 不该出现"浏览目录"这种入口 —— 那会把产品变回一个应用商店。
    expect(screen.queryByText(/浏览/)).toBeNull();
  });

  it("后端挂了也不卡在加载中", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => {
      throw new Error("sidecar down");
    }));
    render(<AbilitiesView />);
    await waitFor(() => expect(screen.getByTestId("abilities-empty")).toBeTruthy());
  });

  it("英文界面用英文文案", async () => {
    setLocale("en");
    serve([]);
    render(<AbilitiesView />);
    await waitFor(() => expect(screen.getByText(/tell Marlo what you need done/)).toBeTruthy());
  });
});
