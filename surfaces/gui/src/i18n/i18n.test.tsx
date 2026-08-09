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
    expect(localStorage.getItem("marlo.locale")).toBe("zh");
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

  it("macOS 上仍然说 Mac —— 主力平台不降级成「这台电脑」", () => {
    (globalThis as any).__OCW_PLATFORM__ = "macos";
    act(() => setLocale("en"));
    expect(t("onboardLede")(t("thisDevice")())).toMatch(/Mac/);
    delete (globalThis as any).__OCW_PLATFORM__;
  });
});
