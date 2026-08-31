// 迁移期的语言切换：两套 i18n 并存，测试要两边都切。
//
// 【为什么需要它】「渲染出来还有没有英文」那把尺子（legacyI18n/no-english.ts）
// 靠切到中文再扫 DOM。组件迁到 react-i18next 之后，legacyI18n 的 setLocale 对它
// 不再有效 —— 测试会以一种很误导的方式失败：断言说"界面上有英文"，而真正的原因
// 是【语言根本没切过去】。UpdateBanner 就这么红过一次。
//
// 一处切两边，迁移中途不用逐个改测试。Phase C 删掉 legacyI18n 时，这里连带只剩
// changeLanguage 一行，或者整个文件退役。
import i18n from "i18next";
import { setLocale as setLegacyLocale } from "./legacyI18n";

export async function setTestLocale(lang: "en" | "zh"): Promise<void> {
  setLegacyLocale(lang);
  if (i18n.isInitialized) await i18n.changeLanguage(lang);
}
