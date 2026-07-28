// 「能力」页 —— 分类里的另一半。
//
// 用户看到的是两类：能力（技能）和连接。「连接」早就有页面，能力一个界面都没有。
//
// 这一页回答两个问题：它现在会什么，以及还能会什么。规格 D' 说发现发生在对话里
// （用户说要做什么，Marlo 自己去找），那仍然是主路径；但 owner 的判断是用户也要
// 能自己搜、自己看——一个东西你完全看不见里面有什么，是很难信任它的。
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { AbilitiesView } from "./AbilitiesView";
import { setLocale } from "../i18n";

// 一个按 URL 分发的假后端：装了什么 / 搜到什么 / 装和卸的结果。
const serve = (skills: any[], results: any[] = [], opts: any = {}) =>
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: any) => {
      if (String(url).includes("/v1/skills/search"))
        return { json: async () => ({ results, error: opts.searchError }) };
      if (String(url).includes("/v1/skills/install")) {
        opts.installed?.push(JSON.parse(init.body).slug);
        return { json: async () => ({ ok: !opts.installFails, error: opts.installError }) };
      }
      if (String(url).includes("/v1/skills/uninstall")) {
        opts.removed?.push(JSON.parse(init.body).name);
        return { json: async () => ({ ok: true }) };
      }
      return { json: async () => ({ skills }) };
    }),
  );

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

  it("能搜目录，结果里带来源和「需要先连」", async () => {
    // owner 的判断：用户也要能自己看。一个东西你完全看不见里面有什么，是很难
    // 信任它的。
    serve([], [
      { name: "autowhisper", summary: "社交媒体内容创作与发布", slug: "x/y/autowhisper",
        meta: "vetted by qumge · first-party", needs: "autowhisper" },
    ]);
    render(<AbilitiesView />);
    fireEvent.change(screen.getByTestId("abilities-search"), { target: { value: "视频" } });
    await waitFor(() => expect(screen.getByTestId("catalog-autowhisper")).toBeTruthy(), { timeout: 2000 });
    expect(screen.getByText(/vetted by qumge/)).toBeTruthy();
    // 装之前就说清楚它要账号 —— 装完才发现连不上是最差的顺序。
    expect(screen.getByText(/需要先连/)).toBeTruthy();
  });

  it("已经装了的不再显示「添加」", async () => {
    serve(
      [{ name: "autowhisper", description: "已装的那条" }],
      [{ name: "autowhisper", summary: "s", slug: "x/y/autowhisper", meta: "m", needs: "" }],
    );
    render(<AbilitiesView />);
    fireEvent.change(screen.getByTestId("abilities-search"), { target: { value: "auto" } });
    await waitFor(() => expect(screen.getByTestId("catalog-autowhisper")).toBeTruthy(), { timeout: 2000 });
    expect(screen.queryByTestId("install-autowhisper")).toBeNull();
  });

  it("点添加会把 slug 发过去", async () => {
    const installed: string[] = [];
    serve([], [{ name: "a", summary: "s", slug: "o/r/a", meta: "m", needs: "" }], { installed });
    render(<AbilitiesView />);
    fireEvent.change(screen.getByTestId("abilities-search"), { target: { value: "a" } });
    await waitFor(() => expect(screen.getByTestId("install-a")).toBeTruthy(), { timeout: 2000 });
    fireEvent.click(screen.getByTestId("install-a"));
    await waitFor(() => expect(installed).toEqual(["o/r/a"]));
  });

  it("目录连不上要说原因 —— 空列表会被读成「什么都没搜到」", async () => {
    serve([], [], { searchError: "connection refused" });
    render(<AbilitiesView />);
    fireEvent.change(screen.getByTestId("abilities-search"), { target: { value: "视频" } });
    await waitFor(() => expect(screen.getByTestId("abilities-error")).toBeTruthy(), { timeout: 2000 });
    expect(screen.getByText(/connection refused/)).toBeTruthy();
  });

  it("英文界面用英文文案", async () => {
    setLocale("en");
    serve([]);
    render(<AbilitiesView />);
    await waitFor(() => expect(screen.getByText(/tell Marlo what you need done/)).toBeTruthy());
  });
});
