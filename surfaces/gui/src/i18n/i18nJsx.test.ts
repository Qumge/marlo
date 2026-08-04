import { describe, it, expect } from "vitest";
// @ts-expect-error -- 判据住在 .mjs 里，构建插件和守卫脚本 import 的是同一份。
import { collect, isBrandOnly, isProse, transform } from "../../i18n-jsx.mjs";

// 这份判据决定【哪些英文会被翻译】。它有两个消费者（构建插件、i18n 守卫），而两者
// 都不会因为判据漏了一种形状而报错 —— 守卫数的是"提取到的都有译文吗"，提取不到的
// 那些它根本不知道存在。于是判据的盲区表现为：**守卫全绿，中文界面上是英文**。
//
// 2026-08-04 实测到两类盲区，各自在下面有一条测试。判据放宽是有代价的（错包机器
// 字符串会坏功能），所以放宽的每一条都配了否定对照 —— 对照针对的是"判据变弱"，
// 不是"这一条还在"。

const texts = (code: string): string[] => collect(code) as string[];

describe("i18n 判据 · 哪些英文是给人看的", () => {
  it("全小写的词也是文案 —— 它长在按钮上，不是长在 id 上", () => {
    // 盲区一：原判据把 /^[a-z0-9_\-./:]+$/ 整个判成"id / 路径 / 事件名"跳过。
    // 而 JSXText 的位置本身就保证了它会被渲染出来 —— 界面上真实存在的是
    // 「设置 | clear」「添加 | cancel」，就长在 t("uiSet") 旁边。
    expect(texts(`<div><button>clear</button></div>`)).toContain("clear");
    expect(texts(`<div><span>default</span></div>`)).toContain("default");
    expect(texts(`<div><span>auto-allowed</span></div>`)).toContain("auto-allowed");
  });

  it("三元里的两个字面量都要包 —— 它们轮流出现在同一个位置上", () => {
    // 盲区二：walk 只访问 JSXText 和白名单属性，JSX 表达式里的字面量一个都不碰。
    // {saving ? "Saving…" : "Save"} 是最常见的按钮写法，两支都是用户读的字。
    const out = texts(`<div>{saving ? "Saving…" : "Save"}</div>`);
    expect(out).toContain("Saving…");
    expect(out).toContain("Save");
  });

  it("直接摆在子位置上的字面量也要包", () => {
    expect(texts(`<div>{"Connected"}</div>`)).toContain("Connected");
    expect(texts(`<div>{ok && "Disconnecting…"}</div>`)).toContain("Disconnecting…");
  });

  // ── 以下是否定对照：放宽判据【不能】把这些也卷进来 ──────────────────────

  it("t() 的键不是文案 —— 包了它就会拿键去查表", () => {
    expect(texts(`<div>{t("uiAdd")}</div>`)).toEqual([]);
  });

  it("传给函数的字符串一律不碰 —— 同一个调用里分不出哪个是给人看的", () => {
    // Sidebar 的 item("row-menu-pin", "pin", "Unpin", cb)：第 1 个是 testid，
    // 第 2 个是图标名，第 3 个才是文案。AST 分不出来，所以【一个都不包】。
    // 这条对照在的意思是：这个已知缺口是【选择】，不是遗漏。
    expect(texts(`<div>{item("row-menu-pin", "pin", "Unpin", cb)}</div>`)).toEqual([]);
    expect(texts(`<div>{pick("application/pdf,.pdf")}</div>`)).toEqual([]);
  });

  it("属性位置的表达式容器不碰 —— accept/className 不在白名单里", () => {
    expect(texts(`<input accept={"image/*"} />`)).toEqual([]);
    expect(texts(`<div className={big ? "text-lg" : "text-sm"} />`)).toEqual([]);
  });

  it("代码块里的字不翻 —— 那是要照着敲的", () => {
    // 放宽之后 `npm install foo` 这种全小写正好落进新判据，而它必须原样显示。
    expect(texts(`<div><code>npm install foo</code></div>`)).toEqual([]);
    expect(texts(`<div><pre>git rebase main</pre></div>`)).toEqual([]);
  });

  it("英文复数那个 s 拆不开，整段跳过 —— 半截译文比不译更糟", () => {
    // {n} account{n === 1 ? "" : "s"}：把 account 译成"个账号"而那个 s 留着，
    // 中文界面上会渲染出「2 个账号s」。这种位置【谁都不包】。
    expect(texts(`<span>{n} account{n === 1 ? "" : "s"}</span>`)).toEqual([]);
  });

  it("id / 路径 / 事件名仍然被拒 —— 放宽不能连这些一起放", () => {
    expect(isProse("user_name")).toBe(false);
    expect(isProse("app.config.json")).toBe(false);
    expect(isProse("https://example.com")).toBe(false);
    expect(isProse("text/*,.md,.csv")).toBe(false);
  });

  it("字面量里的空格要原样留着 —— 它是显示出来的一部分", () => {
    // JSXText 的首尾空白可以折叠（JSX 本来就折叠，而键要和排版无关）；字符串
    // 【字面量】不行 —— " · core" 前面那个空格就是分隔符本身。第一版对它调了
    // normalize()，产出 __tx("· core")，界面上渲染成 "hubspot· core"。
    // e2e 抓到的，单元测试当时全绿。
    expect(texts(`<div>{core ? " · core" : ""}</div>`)).toContain(" · core");
    const out = transform(`export const A = () => <div>{core ? " · core" : ""}</div>;`);
    expect(out.code).toContain('__tx(" · core")');
  });

  it("单个词不是专名 —— 豁免专名不能顺手把所有短字符串一起豁免", () => {
    // 守卫原来的豁免判据是「去掉专名之后【不足 2 个】英文词就算专名」。于是
    // clear / cancel / default / Light / Dark / Rename 这些**单词**全被当成专名
    // 放过 —— 提取到了、没有译文、守卫却报绿。这条豁免是 A 类盲区的下半截：
    // 只修 transform 的话，这些词照样没人会被要求去翻。
    expect(isBrandOnly("clear")).toBe(false);
    expect(isBrandOnly("Rename")).toBe(false);
    expect(isBrandOnly("core")).toBe(false);

    // 真专名仍然豁免 —— "Marlo" 的正确译文就是 "Marlo"。
    expect(isBrandOnly("Marlo")).toBe(true);
    expect(isBrandOnly("PDF")).toBe(true);
    expect(isBrandOnly("HubSpot")).toBe(true);
    expect(isBrandOnly("v1.2")).toBe(true);

    // 历史 bug：以专名开头就整句豁免，让这一整句隐形过。
    expect(isBrandOnly("Marlo v1.2 is ready to install.")).toBe(false);
  });

  it("改写完的代码还是合法的 JSX", () => {
    // transform 是拿 MagicString 按 start/end 硬覆盖的。三元那条新路要是把区间
    // 算错，产出的是语法坏掉的代码 —— 而 vite 的报错会指向一个不存在的位置。
    const out = transform(`export const A = () => <div>{s ? "Saving…" : "Save"}</div>;`);
    expect(out).not.toBeNull();
    expect(() => collect(out.code)).not.toThrow();
    expect(out.code).toContain('__tx("Saving…")');
    expect(out.code).toContain('__tx("Save")');
  });
});
