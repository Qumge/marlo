// 【按英文原文翻译】—— 和 t("key") 并存的第二条路，专门给【上游的代码】用。
//
// 为什么要有它：我们和上游的分歧里 70% 是 i18n（796 个 hunk / 1140）。每翻译一个
// 字符串，就在上游最可能改的那一行上留一个地雷 —— App.tsx 的 WaitingForAgent 就是
// 标本：上游给它加了个 label prop，我们把同一行的字面量换成了 t()，撞在一起。
//
// 这条路反过来：上游的 JSX【一个字节都不改】，由构建期的 transform（见
// i18n-transform.ts）把文本节点和面向用户的属性包进 tx()，运行时按当前语言查表、
// 查不到就原样返回英文。于是：
//
//   - 上游文件在 i18n 这件事上永远和他们一致，合并不再冲突
//   - 上游新加的英文自动"出现"为未翻译，不需要守卫去猜"英文长什么形状"
//     （check_i18n.py 那十个盲区，本质是在给形状列清单，而清单列不完）
//
// t("key") 不废弃：我们【自己写的】组件继续用它。键比原文稳定，改文案不用改代码，
// 也支持带参数的函数值。两条路各管一边，边界就是"这个文件上游有没有"。
import { getLocale } from "./index";
import { zhText } from "./zh-text";

const BY_LOCALE: Record<string, Record<string, string>> = { zh: zhText };

/** 查不到就返回原文 —— 未翻译的英文照常显示，而不是显示一个键名或空白。
 *
 * 这是【故意】的降级方向：上游新加一句英文，用户看到英文（可用，只是没翻），
 * 而不是看到 "composerPlaceholder" 或者一片空白（不可用）。守卫负责让这种情况
 * 不要留太久。 */
export function tx(en: string): string {
  return BY_LOCALE[getLocale()]?.[en] ?? en;
}

/** 属性值用。和 tx 同一件事，分开只为在 transform 里读得出意图。 */
export const txAttr = tx;
