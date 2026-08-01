import type { Plugin } from "vite";
// @ts-expect-error -- 规则住在 .mjs 里，因为守卫（node 脚本）也要 import 同一份。
// 两份实现必然漂：守卫报绿而界面是英文只是时间问题。
import { shouldSkip, transform } from "./i18n-jsx.mjs";

// 构建期把【JSX 里的英文】包进 tx()，源码一个字节不动。
//
//   <button>Save changes</button>   →   <button>{__tx("Save changes")}</button>
//   placeholder="Search"            →   placeholder={__tx("Search")}
//
// 这个插件存在的理由是 fork 维护的算术：我们和上游的分歧有 70% 是 i18n
// （796 / 1140 个 hunk）。t("key") 那条路要求【就地改上游的那一行】，而那正是
// 上游最可能也要改的一行 —— App.tsx 的 WaitingForAgent 就是标本：上游给它加了
// 个 label prop，我们把同一行换成了 t()，撞在一起。冲突不是运气不好，是这个
// 做法的必然结果，而且只增不减。
//
// 覆盖范围仅限 JSX 文本节点 + placeholder/title/aria-label/alt。传给函数的字符串
// （setToast("…")、stat("Input", …)）够不到 —— 那些继续用 t("key")。边界是
// "这个字符串在不在 JSX 的位置上"，不是"这个文件是谁的"。
export function i18nText(): Plugin {
  return {
    name: "marlo-i18n-text",
    // 要在 esbuild 把 JSX 编译掉之前拿到源码。
    enforce: "pre",
    transform(code: string, id: string) {
      if (shouldSkip(id)) return null;
      return transform(code);
    },
  };
}
