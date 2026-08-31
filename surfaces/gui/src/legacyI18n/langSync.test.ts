// 迁移期两套 i18n 必须同步切换。
//
// 【为什么值一个文件】这条在 2026-08-31 的走查里连着红了两次，两个方向各一次：
//   1. i18n.ts 把旧键 marlo.locale 迁走并删掉，而这套还在读旧键 —— 冷启动后
//      账号菜单是英文，其余界面是中文。
//   2. 合并之后设置页用的是【上游自己的】语言开关，它只调 i18n.ts 的 setLanguage，
//      不知道这套的存在 —— 切了语言，大半界面变了，还没迁的 29 个文件纹丝不动。
// 两次都是靠人眼在真机上看出来的，测试全绿。半英半中不会让任何断言失败，因为
// 现有的测试要么只量 i18next、要么只量这套，没有一条横跨两者。
//
// Phase C 退役 legacyI18n 之后，这个文件连同它量的东西一起删掉。
import i18next from "i18next";
import { afterAll, describe, expect, it } from "vitest";
import { getLocale, setLocale } from "./index";

afterAll(async () => {
  await i18next.changeLanguage("en");
  setLocale("en");
});

describe("两套 i18n 的语言同步", () => {
  it("设置页那条路（上游开关 → i18next）能带动这套", async () => {
    await i18next.changeLanguage("zh");
    expect(getLocale(), "i18next 切了中文，legacyI18n 没跟上 —— 界面会半英半中").toBe("zh");
    await i18next.changeLanguage("en");
    expect(getLocale()).toBe("en");
  });

  it("上手引导那条路（这套的开关 → i18next）能带动上游那套", () => {
    setLocale("zh");
    expect(i18next.language, "legacyI18n 切了中文，i18next 没跟上 —— 反向的半英半中").toBe("zh");
    setLocale("en");
    expect(i18next.language).toBe("en");
  });

  it("两条路都落在同一个 storage 键上", () => {
    setLocale("zh");
    expect(localStorage.getItem("openworker.lang")).toBe("zh");
    expect(localStorage.getItem("marlo.locale"), "旧键留着就会有两个事实来源").toBeNull();
  });
});
