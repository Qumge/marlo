import { describe, it, expect, beforeEach } from "vitest";
import { render, screen, fireEvent, act } from "@testing-library/react";
import { en } from "./en";
import { zh } from "./zh";
import { getLocale, setLocale, t } from "./index";
import { LanguagePicker } from "../components/LanguagePicker";

// `zh: Strings` already makes a missing key a compile error, so nothing here
// re-checks key coverage — the type system does that better and earlier. These
// cover what types cannot: that switching actually re-renders, that no Chinese
// value was left as its English placeholder, and that a locale survives a
// reload.

describe("i18n", () => {
  beforeEach(() => {
    localStorage.clear();
    act(() => setLocale("en"));
  });

  it("every Chinese value differs from the English one, except where it should not", () => {
    // Product and language names are the same string in both catalogs on purpose.
    // autoOwnerRepo 是 GitHub 的字面格式（owner/repo），翻译它会让人照着填错。
    const SAME_BY_DESIGN = new Set(["appName", "langEnglish", "langChinese", "autoOwnerRepo", "uiMac", "connGranola"]);
    const untranslated = (Object.keys(en) as (keyof typeof en)[]).filter(
      (k) => !SAME_BY_DESIGN.has(k as string) && zh[k] === en[k],
    );
    // A key copied over and never translated type-checks perfectly and ships as
    // English inside a Chinese window. Nothing else would notice.
    expect(untranslated).toEqual([]);
  });

  it("switching the locale re-renders components that read strings", () => {
    render(<LanguagePicker />);
    expect(screen.getByText(en.language)).toBeTruthy();

    fireEvent.click(screen.getByTestId("lang-zh"));
    expect(screen.getByText(zh.language)).toBeTruthy();
    expect(screen.queryByText(en.language)).toBeNull();

    fireEvent.click(screen.getByTestId("lang-en"));
    expect(screen.getByText(en.language)).toBeTruthy();
  });

  it("the choice is remembered, and t() outside React follows it", () => {
    act(() => setLocale("zh"));
    // 键名跟着上游那套走了（"openworker.lang"）—— 迁移期两套 i18n 必须落在同一个
    // 键上，否则会半英半中。跨两套的同步由 langSync.test.ts 单独量。
    expect(localStorage.getItem("openworker.lang")).toBe("zh");
    expect(getLocale()).toBe("zh");
    expect(t("newSession")).toBe(zh.newSession);

    act(() => setLocale("en"));
    expect(t("newSession")).toBe(en.newSession);
  });

  it("sets the document language so the page picks the right font stack", () => {
    act(() => setLocale("zh"));
    expect(document.documentElement.lang).toBe("zh-CN");
    act(() => setLocale("en"));
    expect(document.documentElement.lang).toBe("en");
  });

  it("Windows 上不会告诉用户他有一台 Mac", () => {
    (globalThis as any).__OCW_PLATFORM__ = "windows";
    act(() => setLocale("en"));
    const dev = t("thisDevice")();
    expect(t("onboardLede")(dev)).not.toMatch(/Mac/);
    expect(t("deviceHint")(dev)).not.toMatch(/Mac/);
    delete (globalThis as any).__OCW_PLATFORM__;
  });

  it("中文里 Mac 和后面的汉字之间要有空格 —— 「这台 Mac 上」不是「这台 Mac上」", () => {
    (globalThis as any).__OCW_PLATFORM__ = "macos";
    act(() => setLocale("zh"));
    const dev = t("thisDevice")();
    // 四处模板都是 ${dev} 紧跟汉字，所以空格必须由 thisDevice 自己带
    expect(t("onboardLede")(dev)).toContain("这台 Mac 上");
    expect(t("onboardLede")(dev)).not.toContain("Mac上");
    expect(t("deviceHint")(dev)).toContain("这台 Mac 或");
    delete (globalThis as any).__OCW_PLATFORM__;
  });

  it("Windows 的纯中文里【不】能有那个空格 —— 「这台电脑上」不是「这台电脑 上」", () => {
    (globalThis as any).__OCW_PLATFORM__ = "windows";
    act(() => setLocale("zh"));
    const dev = t("thisDevice")();
    expect(t("onboardLede")(dev)).toContain("这台电脑上");
    expect(t("onboardLede")(dev)).not.toContain("电脑 上");
    delete (globalThis as any).__OCW_PLATFORM__;
  });

  it("macOS 上仍然说 Mac —— 主力平台不降级成「这台电脑」", () => {
    (globalThis as any).__OCW_PLATFORM__ = "macos";
    act(() => setLocale("en"));
    expect(t("onboardLede")(t("thisDevice")())).toMatch(/Mac/);
    delete (globalThis as any).__OCW_PLATFORM__;
  });
});
