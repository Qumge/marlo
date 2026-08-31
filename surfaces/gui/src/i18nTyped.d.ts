// 键的类型安全：把 en.json 声明成 i18next 的资源类型，t("拼错的键") 会被 tsc 拦下。
//
// 【为什么单独一个 .d.ts】原来的目录是 TypeScript（现在的 legacyI18n/en.ts），
// Strings 类型天然守着这件事 —— 那个文件顶上写着：五次改名从这个仓库溜过去，因为
// 唯一看着的是人在读 diff。迁到 JSON 之后这条性质会【默认消失】，JSON 里的键对
// t() 来说只是字符串。这个文件是把它接回来，不是锦上添花。
//
// 英文是事实来源（和上游一致，也和 legacyI18n/en.ts 的分工一致）：类型只从 en.json
// 取。zh.json 的键要不要齐，由上游 i18n.test.ts 的「locale contracts」那组守。
import "i18next";
import type en from "./locales/en.json";

declare module "i18next" {
  interface CustomTypeOptions {
    defaultNS: "translation";
    resources: { translation: typeof en };
    returnNull: false;
  }
}
