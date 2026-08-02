// 技能页 —— 唯一的一页。
//
// 用户看到的是两类：技能和连接。「连接」早就有页面，技能曾经有两个（账号菜单的
// 「能力」和设置里的 tab），打的还是同一个 GET /v1/skills。2026-08-02 合成一页。
//
// 这一份原来是 AbilitiesView.test.tsx，盯的是【页面】那一半：现在会什么、一个都没
// 有时说什么、后端挂了怎么办、中文界面是不是真中文、移除是不是真的移除。管理那一半
// （添加的三个门 / 表单 / 启停 / 富技能）在 SkillsView.manage.test.tsx。
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { SkillsView } from "./SkillsView";
import { setLocale } from "../../i18n";

// 一个按 URL 分发的假后端。只要两个分支：装了什么，和目录搜到什么 —— 这一份里
// 没有测目录的条目（那是 SkillCatalog.test.tsx 的活），搜索分支只是为了让常驻在
// 下半页的目录不至于打到"装了什么"那个分支上去。
const serve = (skills: any[]) =>
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) => {
      if (String(url).includes("/v1/skills/search"))
        return { json: async () => ({ results: [] }) };
      return { json: async () => ({ skills }) };
    }),
  );

beforeEach(() => setLocale("zh"));
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("技能页", () => {
  it("装了的技能列出来", async () => {
    serve([{ name: "autowhisper", description: "社交媒体内容创作与发布" }]);
    render(<SkillsView />);
    await waitFor(() => expect(screen.getByTestId("ability-autowhisper")).toBeTruthy());
    expect(screen.getByText("社交媒体内容创作与发布")).toBeTruthy();

    // 【扫渲染结果，不数守卫的条数】。i18n 守卫 2026-07-28 报了四次"无新增"，而
    // 界面上整屏是英文 —— 每次都是它的判据漏了一种形状。守卫量源码，这里量用户
    // 真正看到的字符，两把独立的尺子都得过。
    // 必须【显式】切到中文再扫：测试默认跑在 en 下，不切的话扫到的英文是对的，
    // 而碰巧切过的话又会因为别的测试的副作用而通过 —— 两种都不是在测东西。
    const { englishRunsIn } = await import("../../i18n/no-english");
    const { setLocale } = await import("../../i18n");
    act(() => setLocale("zh"));
    await act(async () => {});
    const runs = englishRunsIn(document.body);
    act(() => setLocale("en"));
    expect(runs).toEqual([]);
  });

  it("空状态要【解释机制】，不是给一个去逛逛的按钮", async () => {
    // 一个刚装好的用户看到"还没装任何技能"，第一反应是"那我去哪儿装"，
    // 而正确答案是"你不用装"。这一条盯着那句解释真的在。
    serve([]);
    render(<SkillsView />);
    await waitFor(() => expect(screen.getByTestId("abilities-empty")).toBeTruthy());
    expect(screen.getByText(/跟 Marlo 说你要做什么/)).toBeTruthy();
    // 不该出现"浏览目录"这种入口 —— 那会把产品变回一个应用商店。
    expect(screen.queryByText(/浏览/)).toBeNull();
  });

  it("后端挂了也不卡在加载中", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => {
      throw new Error("sidecar down");
    }));
    render(<SkillsView />);
    await waitFor(() => expect(screen.getByTestId("abilities-empty")).toBeTruthy());
  });

  it("英文界面用英文文案", async () => {
    setLocale("en");
    serve([]);
    render(<SkillsView />);
    await waitFor(() => expect(screen.getByText(/tell Marlo what you need done/)).toBeTruthy());
  });

  it("点移除，技能真的从列表里消失", async () => {
    // 【这条在修之前是红的】移除打的是 POST /v1/skills/uninstall，后端没有这个
    // 路由（app.py:632 的注释早写明该走 DELETE /v1/skills/{name}）。错误被
    // .catch(() => {}) 吞掉，列表一刷新技能又回来 —— 用户点了没反应，也没有提示。
    //
    // 断言分两半，缺一不可：列表里真的没了（用户看到的），且打出去的是 DELETE
    // （打对了路由）。只断言前者的话，一个"乐观地本地删掉"的假实现也能过。
    //
    // 合页之后删除是【两步】的（InstalledSkills：第一下上膛，第二下才发），所以
    // 这里点两下。两步本身由 manage 那一份盯着，这条只管"点完真的没了"。
    const calls: string[] = [];
    let skills: any[] = [{ name: "autowhisper", description: "已装的那条" }];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init?: any) => {
        const path = String(url).replace(/^https?:\/\/[^/]+/, "");
        calls.push(`${init?.method || "GET"} ${path}`);
        if (path.includes("/v1/skills/search")) return { json: async () => ({ results: [] }) };
        if (init?.method === "DELETE") {
          skills = [];
          return { json: async () => ({ ok: true }) };
        }
        return { json: async () => ({ skills }) };
      }),
    );

    render(<SkillsView />);
    await waitFor(() => expect(screen.getByTestId("ability-autowhisper")).toBeTruthy());
    fireEvent.click(screen.getByTestId("remove-autowhisper"));
    fireEvent.click(screen.getByTestId("remove-autowhisper"));

    await waitFor(() => expect(screen.queryByTestId("ability-autowhisper")).toBeNull());
    expect(calls).toContain("DELETE /v1/skills/autowhisper");
  });
});
