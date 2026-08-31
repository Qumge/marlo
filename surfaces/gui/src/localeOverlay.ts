// Marlo 的措辞叠在上游的目录上 —— locales/{en,zh}.json 保持和上游【字节相同】。
//
// 【为什么不直接改 locales/*.json】改了就是冲突。上游几乎每次发版都动这两个文件
// （i18n 是它 2026 年 8 月才做的，还在长），而我们要覆盖的键只会越来越多：迁到
// 第 24 个组件时 zh 已经覆盖了 147 个键，按这个速度做完 49 个会是四百多。实测那
// 一版：zh.json 54 个冲突块、en.json 21 个 —— 逐文件迁移省下来的（GmailDetail
// 16→2、SlackDetail 27→12）几乎全被这两个文件吃掉了。
//
// 搬进上游不存在的文件，冲突就是 0，而且【永远】是 0。这是这个仓库已经用过一次的
// 办法：tauri 品牌配置就是 tauri.marlo.conf.json overlay，上游那份保持字节相同
// （21cd141）。漂移脚本头上也写着同一句：把我们新增的东西搬到新文件。
//
// 【代价，说清楚】读 zh.json 看到的不是最终生效的文案。所以覆盖表要小、要能一眼
// 读完，并且 localeOverlay.test.ts 会拦住"覆盖了一个上游没有的键"——那种多半是
// 键名写错了，静默失效比冲突更难查。
import enBase from "./locales/en.json";
import zhBase from "./locales/zh.json";
import enMarlo from "./locales/en.marlo.json";
import zhMarlo from "./locales/zh.marlo.json";

type Tree = { [k: string]: unknown };

/** 递归覆盖：overlay 里有的键赢，其余原样保留上游的。 */
function merge<T extends Tree>(base: T, overlay: Tree): T {
  const out: Tree = { ...base };
  for (const [k, v] of Object.entries(overlay)) {
    const b = out[k];
    out[k] =
      v && typeof v === "object" && !Array.isArray(v) && b && typeof b === "object"
        ? merge(b as Tree, v as Tree)
        : v;
  }
  return out as T;
}

export const en = merge(enBase, enMarlo) as typeof enBase & typeof enMarlo;
export const zh = merge(zhBase, zhMarlo) as typeof zhBase & typeof zhMarlo;
