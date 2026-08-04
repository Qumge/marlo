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

// 打出去的每一个 URL。搜索改成显式提交之后，"有没有真的出网"本身就是被测的行为。
const calls = () => (globalThis.fetch as any).mock.calls.map((c: any[]) => String(c[0]));
const searched = (q: string) =>
  calls().filter((u: string) => u.includes(`/v1/skills/search?q=${encodeURIComponent(q)}&`));

// 敲字 + 点「搜索」。分开写是因为这两件事现在【真的是两件事】。
const submit = (q: string) => {
  fireEvent.change(screen.getByTestId("skills-search"), { target: { value: q } });
  fireEvent.click(screen.getByTestId("skills-search-go"));
};

beforeEach(() => setLocale("zh"));
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("技能目录", () => {
  it("首屏在等目录回来时是骨架，不是空白", async () => {
    // 挂载那次 run("") 要出网，实测 4.5 秒（超时上限 20 秒）。那段时间里 results
    // 还是 null，而整个目录区包在 results !== null 里 —— 一个像素都不渲染。用户
    // 看到的就是"什么也没有"。
    let release: () => void = () => {};
    vi.stubGlobal(
      "fetch",
      vi.fn(
        () =>
          new Promise((resolve) => {
            release = () =>
              resolve({
                json: async () => ({
                  results: [
                    { name: "autowhisper", summary: "内容创作", slug: "x/y/aw", meta: "vetted by qumge" },
                  ],
                }),
              });
          }),
      ),
    );

    render(<SkillCatalog installedNames={new Set()} onInstalled={() => {}} onError={() => {}} />);

    expect(await screen.findByTestId("skills-catalog-loading")).toBeTruthy();
    expect(screen.queryByTestId("skills-results")).toBeNull();

    release();

    expect(await screen.findByTestId("skills-results")).toBeTruthy();
    // 出了结果骨架必须走 —— 两个一起在，读起来像"还有一批没加载完"。
    expect(screen.queryByTestId("skills-catalog-loading")).toBeNull();
  });

  it("目录连不上时骨架不残留，只剩错误条", async () => {
    // catch 分支（SkillCatalog.tsx:81-83）只写 searchErr，results 永远停在 null。
    // 骨架只看 null 的话，会在错误条底下一直转。
    vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("connection refused"); }));

    render(<SkillCatalog installedNames={new Set()} onInstalled={() => {}} onError={() => {}} />);

    expect(await screen.findByTestId("skills-error")).toBeTruthy();
    expect(screen.queryByTestId("skills-catalog-loading")).toBeNull();
  });

  it("能搜目录，结果里带来源和「需要先连」", async () => {
    // owner 的判断：用户也要能自己看。一个东西你完全看不见里面有什么，是很难
    // 信任它的。
    serve([
      { name: "autowhisper", summary: "社交媒体内容创作与发布", slug: "x/y/autowhisper",
        meta: "vetted by qumge · first-party", needs: "autowhisper" },
    ]);
    render(<SkillCatalog installedNames={new Set()} onInstalled={() => {}} onError={() => {}} />);
    await waitFor(() => expect(screen.getByTestId("catalog-autowhisper")).toBeTruthy(), { timeout: 2000 });
    submit("视频");
    await waitFor(() => expect(searched("视频").length).toBe(1));
    expect(screen.getByText(/vetted by qumge/)).toBeTruthy();
    // 装之前就说清楚它要账号 —— 装完才发现连不上是最差的顺序。
    expect(screen.getByText(/需要先连/)).toBeTruthy();
  });

  it("敲字【不】等于搜索 —— 要点了「搜索」才出网", async () => {
    // 【否定对照】原来是敲字 400ms 防抖自动搜。这条路要出网，每敲一个字打一次
    // 目录既慢又白费，而"我什么时候真的搜了"在自动搜里是看不见的。
    serve([{ name: "a", summary: "s", slug: "o/r/a", meta: "m", needs: "", group: "g" }]);
    render(<SkillCatalog installedNames={new Set()} onInstalled={() => {}} onError={() => {}} />);
    await waitFor(() => expect(screen.getByTestId("catalog-a")).toBeTruthy(), { timeout: 2000 });

    fireEvent.change(screen.getByTestId("skills-search"), { target: { value: "视频" } });
    // 比原来那个 400ms 防抖长：如果防抖还在，这里已经打出去了。
    await new Promise((r) => setTimeout(r, 600));
    expect(searched("视频")).toEqual([]);

    fireEvent.click(screen.getByTestId("skills-search-go"));
    await waitFor(() => expect(searched("视频").length).toBe(1));
  });

  it("「重置」清空输入框，并把默认的浏览列表放回来", async () => {
    // 重置【不是】"清空输入框"的同义词：删字只是把 q 变空，不会重新去要一次，
    // 那份默认列表光靠删字回不去。
    serve([{ name: "a", summary: "s", slug: "o/r/a", meta: "m", needs: "", group: "g" }]);
    render(<SkillCatalog installedNames={new Set()} onInstalled={() => {}} onError={() => {}} />);
    await waitFor(() => expect(screen.getByTestId("catalog-a")).toBeTruthy(), { timeout: 2000 });
    submit("视频");
    await waitFor(() => expect(searched("视频").length).toBe(1));

    fireEvent.click(screen.getByTestId("skills-reset"));
    expect((screen.getByTestId("skills-search") as HTMLInputElement).value).toBe("");
    // 首屏那次 + 重置这次 = 2。只清框不重搜的话这里停在 1。
    await waitFor(() => expect(searched("").length).toBe(2));
  });

  it("已经装了的不再显示「添加」", async () => {
    serve(
      [{ name: "autowhisper", summary: "s", slug: "x/y/autowhisper", meta: "m", needs: "" }],
    );
    render(<SkillCatalog installedNames={new Set(["autowhisper"])} onInstalled={() => {}} onError={() => {}} />);
    await waitFor(() => expect(screen.getByTestId("catalog-autowhisper")).toBeTruthy(), { timeout: 2000 });
    expect(screen.queryByTestId("install-autowhisper")).toBeNull();
  });

  it("点添加会把 slug 发过去", async () => {
    const installed: string[] = [];
    serve([{ name: "a", summary: "s", slug: "o/r/a", meta: "m", needs: "" }], { installed });
    render(<SkillCatalog installedNames={new Set()} onInstalled={() => {}} onError={() => {}} />);
    await waitFor(() => expect(screen.getByTestId("install-a")).toBeTruthy(), { timeout: 2000 });
    fireEvent.click(screen.getByTestId("install-a"));
    await waitFor(() => expect(installed).toEqual(["o/r/a"]));
  });

  it("分类是【页签】，名字译成中文，点一个只剩那一类", async () => {
    // 浏览一次回来 30 条、横跨七八个分类。堆叠成一节一节的话，想看某一类得先滚过
    // 前面所有类。
    // meta 用【真实形状】——「category: <slug> · N stars on owner/repo」。写成 "m"
    // 的话，条目里那处分类名根本没被测到（第一版就是这样，靠截图才发现漏了）。
    serve([
      { name: "a", summary: "s", slug: "o/r/a", needs: "", group: "content-writing",
        meta: "category: content-writing · 312 stars on GitHub" },
      { name: "b", summary: "s", slug: "o/r/b", needs: "", group: "personal-productivity",
        meta: "category: personal-productivity · 99 stars on GitHub" },
    ]);
    render(<SkillCatalog installedNames={new Set()} onInstalled={() => {}} onError={() => {}} />);
    await waitFor(() => expect(screen.getByTestId("skills-tabs")).toBeTruthy(), { timeout: 2000 });

    // content-writing 是 qumge 内部的写法，中文界面上不该出现它 —— 页签上不该，
    // 条目自己的 meta 里【也】不该。只译一处的话，同一个词在同一屏上有两种写法，
    // 看起来像两个不同的东西，比两处都不译更糟。
    expect(screen.getByTestId("skills-tab-content-writing").textContent).toContain("写内容");
    expect(screen.getByTestId("catalog-a").textContent).toContain("写内容 · 312 stars on GitHub");
    expect(screen.queryByText(/content-writing/)).toBeNull();
    expect(screen.queryByText(/category:/)).toBeNull();
    // 条数写在页签上：过滤的是【已经加载的这批】，不是目录里那一整个分类。
    expect(screen.getByTestId("skills-tab-all").textContent).toContain("全部 · 2");

    expect(screen.getByTestId("catalog-a")).toBeTruthy();
    expect(screen.getByTestId("catalog-b")).toBeTruthy();
    fireEvent.click(screen.getByTestId("skills-tab-content-writing"));
    expect(screen.getByTestId("catalog-a")).toBeTruthy();
    expect(screen.queryByTestId("catalog-b")).toBeNull();
  });

  it("分节顺序跟着服务端，不是哪一类条数多哪一类排前面", async () => {
    // 服务端已经按 star 排好了，第 1 条是 ★64,979 的 api-integration。但那一组只有
    // 1 条，content-writing 有 2 条 —— 按组大小排的话，目录里最火的那条会被整节压到
    // 后面去，而用户在首屏根本看不到它。这正是 qumg 那边刚拿掉的那个轴，不能让它在
    // 客户端以「组大小」的形式回来。
    serve([
      { name: "reach", summary: "s", slug: "o/r/reach", needs: "", group: "api-integration",
        meta: "category: api-integration · 64979 stars on GitHub" },
      { name: "a", summary: "s", slug: "o/r/a", needs: "", group: "content-writing",
        meta: "category: content-writing · 312 stars on GitHub" },
      { name: "b", summary: "s", slug: "o/r/b", needs: "", group: "content-writing",
        meta: "category: content-writing · 99 stars on GitHub" },
    ]);
    render(<SkillCatalog installedNames={new Set()} onInstalled={() => {}} onError={() => {}} />);
    await waitFor(() => expect(screen.getByTestId("skills-group-api-integration")).toBeTruthy(),
      { timeout: 2000 });

    // 断言的是【屏幕上从上到下的次序】，不是"这两节都在"—— 后者按组大小排也是绿的。
    expect(
      [...document.querySelectorAll("[data-testid^='skills-group-']")]
        .map((el) => el.getAttribute("data-testid")),
    ).toEqual(["skills-group-api-integration", "skills-group-content-writing"]);
  });

  it("精选那一组仍然置顶，哪怕它不是结果里的第一条", async () => {
    // 上面那条改了节序之后，唯一还在给 featured 兜底的就是这个置顶。搜索结果里
    // featured 排在精确命中之后 —— 那时精选组不是第一组，置顶才真的起作用。
    serve([
      { name: "a", summary: "s", slug: "o/r/a", needs: "", group: "content-writing",
        meta: "category: content-writing · 312 stars on GitHub" },
      { name: "autowhisper", summary: "s", slug: "o/r/aw", needs: "", group: "__vetted__",
        meta: "vetted by qumge" },
    ]);
    render(<SkillCatalog installedNames={new Set()} onInstalled={() => {}} onError={() => {}} />);
    await waitFor(() => expect(screen.getByTestId("skills-group-__vetted__")).toBeTruthy(),
      { timeout: 2000 });

    expect(
      [...document.querySelectorAll("[data-testid^='skills-group-']")]
        .map((el) => el.getAttribute("data-testid")),
    ).toEqual(["skills-group-__vetted__", "skills-group-content-writing"]);
  });

  it("重新搜一次会退回「全部」页签", async () => {
    // 结果整批换掉了，旧页签多半不在新结果里 —— 停在它上面就是一屏空白，而用户
    // 会读成"没搜到"。
    serve([{ name: "a", summary: "s", slug: "o/r/a", meta: "m", needs: "", group: "content-writing" }]);
    render(<SkillCatalog installedNames={new Set()} onInstalled={() => {}} onError={() => {}} />);
    await waitFor(() => expect(screen.getByTestId("skills-tab-content-writing")).toBeTruthy(), { timeout: 2000 });
    fireEvent.click(screen.getByTestId("skills-tab-content-writing"));

    // 选中一个页签时不渲染分节标题 —— 页签自己就是那个标题。
    expect(screen.queryByTestId("skills-group-content-writing")).toBeNull();

    submit("视频");
    await waitFor(() => expect(searched("视频").length).toBe(1));
    // 标题回来了，就是"退回了全部"。
    await waitFor(() =>
      expect(screen.getByTestId("skills-group-content-writing")).toBeTruthy());
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
