// 技能目录 —— 搜索/浏览/安装界面。
//
// owner 的判断：用户也要能自己看，一个东西你完全看不见里面有什么，是很难信任
// 它的。这些测试盯着搜索、翻译提示、错误条、分组结果、加载更多、正文预览弹层。
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { SkillCatalog } from "./SkillCatalog";
import { setLocale } from "../../i18n";

// 一个按 URL 分发的假后端：搜到什么 / 装的结果 / 正文详情。
const serve = (results: any[] = [], opts: any = {}) =>
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: any) => {
      if (String(url).includes("/v1/skills/detail"))
        return { json: async () => ({ body: opts.detailBody ?? "# 技能正文" }) };
      if (String(url).includes("/v1/skills/search")) {
        const off = Number(new URL(String(url), "http://x").searchParams.get("offset") || 0);
        opts.offsets?.push(off);
        return {
          json: async () => ({
            results: off ? opts.page2 || [] : results,
            has_more: off ? false : !!opts.hasMore,
            searched_as: opts.searchedAs,
            error: opts.searchError,
          }),
        };
      }
      if (String(url).includes("/v1/skills/install")) {
        opts.installed?.push(JSON.parse(init.body).slug);
        return { json: async () => ({ ok: !opts.installFails, error: opts.installError }) };
      }
      return { json: async () => ({}) };
    }),
  );

beforeEach(() => setLocale("zh"));
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("技能目录", () => {
  it("能搜目录，结果里带来源和「需要先连」", async () => {
    // owner 的判断：用户也要能自己看。一个东西你完全看不见里面有什么，是很难
    // 信任它的。
    serve([
      { name: "autowhisper", summary: "社交媒体内容创作与发布", slug: "x/y/autowhisper",
        meta: "vetted by qumge · first-party", needs: "autowhisper" },
    ]);
    render(<SkillCatalog installedNames={new Set()} onInstalled={() => {}} onError={() => {}} />);
    fireEvent.change(screen.getByTestId("skills-search"), { target: { value: "视频" } });
    await waitFor(() => expect(screen.getByTestId("catalog-autowhisper")).toBeTruthy(), { timeout: 2000 });
    expect(screen.getByText(/vetted by qumge/)).toBeTruthy();
    // 装之前就说清楚它要账号 —— 装完才发现连不上是最差的顺序。
    expect(screen.getByText(/需要先连/)).toBeTruthy();
  });

  it("已经装了的不再显示「添加」", async () => {
    serve(
      [{ name: "autowhisper", summary: "s", slug: "x/y/autowhisper", meta: "m", needs: "" }],
    );
    render(<SkillCatalog installedNames={new Set(["autowhisper"])} onInstalled={() => {}} onError={() => {}} />);
    fireEvent.change(screen.getByTestId("skills-search"), { target: { value: "auto" } });
    await waitFor(() => expect(screen.getByTestId("catalog-autowhisper")).toBeTruthy(), { timeout: 2000 });
    expect(screen.queryByTestId("install-autowhisper")).toBeNull();
  });

  it("点添加会把 slug 发过去", async () => {
    const installed: string[] = [];
    serve([{ name: "a", summary: "s", slug: "o/r/a", meta: "m", needs: "" }], { installed });
    render(<SkillCatalog installedNames={new Set()} onInstalled={() => {}} onError={() => {}} />);
    fireEvent.change(screen.getByTestId("skills-search"), { target: { value: "a" } });
    await waitFor(() => expect(screen.getByTestId("install-a")).toBeTruthy(), { timeout: 2000 });
    fireEvent.click(screen.getByTestId("install-a"));
    await waitFor(() => expect(installed).toEqual(["o/r/a"]));
  });

  it("安装失败走页面级错误条，不挂在「连不上目录：」下面", async () => {
    // 装失败和搜失败是两件事。塞进 searchErr 的话，渲染时会被套上
    // t("skSearchFailed") =「连不上目录：」—— 后端拒绝一次安装，界面上读起来
    // 像是目录连不上，而用户对着这句话什么也做不了。
    const onError = vi.fn();
    serve([{ name: "a", summary: "s", slug: "o/r/a", meta: "m", needs: "", group: "g" }],
          { installFails: true, installError: "已经装过一个叫 a 的技能了。" });
    render(<SkillCatalog installedNames={new Set()} onInstalled={() => {}} onError={onError} />);
    await waitFor(() => expect(screen.getByTestId("install-a")).toBeTruthy(), { timeout: 2000 });
    fireEvent.click(screen.getByTestId("install-a"));

    await waitFor(() => expect(onError).toHaveBeenCalledWith("已经装过一个叫 a 的技能了。"));
    // 搜索那条错误条不能被这次失败点亮 —— 那正是这次要修的串台。
    expect(screen.queryByTestId("skills-error")).toBeNull();
  });

  it("目录连不上要说原因 —— 空列表会被读成「什么都没搜到」", async () => {
    serve([], { searchError: "connection refused" });
    render(<SkillCatalog installedNames={new Set()} onInstalled={() => {}} onError={() => {}} />);
    fireEvent.change(screen.getByTestId("skills-search"), { target: { value: "视频" } });
    await waitFor(() => expect(screen.getByTestId("skills-error")).toBeTruthy(), { timeout: 2000 });
    expect(screen.getByText(/connection refused/)).toBeTruthy();
  });

  it("还有下一页时才显示「加载更多」", async () => {
    // has_more 由目录给，界面不自己猜 —— 猜的结果是一个可能点空的按钮。
    serve([{ name: "a", summary: "s", slug: "o/r/a", meta: "m", needs: "", group: "g" }]);
    render(<SkillCatalog installedNames={new Set()} onInstalled={() => {}} onError={() => {}} />);
    await waitFor(() => expect(screen.getByTestId("catalog-a")).toBeTruthy(), { timeout: 2000 });
    expect(screen.queryByTestId("skills-more")).toBeNull();
  });

  it("点「加载更多」用【已加载条数】当 offset，不是页码", async () => {
    // 分组是客户端做的，页码和服务端的偏移量对不上。
    const offsets: number[] = [];
    serve([
      { name: "a", summary: "s", slug: "o/r/a", meta: "m", needs: "", group: "g" },
      { name: "b", summary: "s", slug: "o/r/b", meta: "m", needs: "", group: "g" },
    ], { hasMore: true, offsets, page2: [{ name: "c", summary: "s", slug: "o/r/c", meta: "m", needs: "", group: "g" }] });
    render(<SkillCatalog installedNames={new Set()} onInstalled={() => {}} onError={() => {}} />);
    await waitFor(() => expect(screen.getByTestId("skills-more")).toBeTruthy(), { timeout: 2000 });
    fireEvent.click(screen.getByTestId("skills-more"));
    await waitFor(() => expect(screen.getByTestId("catalog-c")).toBeTruthy());
    expect(offsets).toContain(2);
    // 已加载的不能被替换掉 —— 那是"翻页"不是"加载更多"。
    expect(screen.getByTestId("catalog-a")).toBeTruthy();
  });

  it("能在装之前看正文，并说明我们怎么对待它", async () => {
    serve([{ name: "a", summary: "s", slug: "o/r/a", meta: "m", needs: "", group: "g" }],
          { detailBody: "# 它会做什么" });
    render(<SkillCatalog installedNames={new Set()} onInstalled={() => {}} onError={() => {}} />);
    await waitFor(() => expect(screen.getByTestId("view-a")).toBeTruthy(), { timeout: 2000 });
    fireEvent.click(screen.getByTestId("view-a"));
    await waitFor(() => expect(screen.getByText("# 它会做什么")).toBeTruthy());
    // 这句不是免责声明，是在说明我们怎么读它。
    expect(screen.getByText(/当参考读，不当命令执行/)).toBeTruthy();
  });

  it("中文搜出英文结果时，说清楚实际搜的是什么", async () => {
    // 用中文搜却出来一屏英文标题，不解释的话没人知道这是怎么来的 —— 也无从发现
    // 翻错了，而换个说法重搜是用户唯一的补救手段。
    serve([{ name: "autowhisper", summary: "s", slug: "o/r/a", meta: "m", needs: "", group: "g" }],
          { searchedAs: "product promotional video" });
    render(<SkillCatalog installedNames={new Set()} onInstalled={() => {}} onError={() => {}} />);
    await waitFor(() => expect(screen.getByTestId("skills-translated")).toBeTruthy(),
                  { timeout: 2000 });
    expect(screen.getByTestId("skills-translated").textContent)
      .toContain("product promotional video");
  });

  it("没翻译时不说自己翻了", async () => {
    // 【否定对照】。英文查询冒出一句"已按英文搜索"是句假话，而用户没法分辨界面上
    // 哪些说明是真的。
    serve([{ name: "a", summary: "s", slug: "o/r/a", meta: "m", needs: "", group: "g" }]);
    render(<SkillCatalog installedNames={new Set()} onInstalled={() => {}} onError={() => {}} />);
    await waitFor(() => expect(screen.getByTestId("view-a")).toBeTruthy(), { timeout: 2000 });
    expect(screen.queryByTestId("skills-translated")).toBeNull();
  });
});
