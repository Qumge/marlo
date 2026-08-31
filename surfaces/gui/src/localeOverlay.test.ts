// overlay 的守卫。
//
// 【为什么不能只靠上游的 i18n.test.ts】它 import 的是 ./locales/{en,zh}.json —— 而
// 那两份现在和上游【字节相同】。也就是说它的四条断言（键集对齐、插值占位符对齐、
// 重要键都在、中文能完整插值）量的全是上游自己的文件，量不到用户实际拿到的目录。
// overlay 是【静默】拿走这份覆盖的，和 check_branding 当年不扫 .json 是同一类错误：
// 判据停在了某条边界上，而用户读到的字符串不认识那条边界。
//
// 所以同样四条，在【合并之后】的目录上再来一遍，外加两条 overlay 自己的。
import { createInstance } from "i18next";
import { describe, expect, it } from "vitest";
import enBase from "./locales/en.json";
import zhBase from "./locales/zh.json";
import enMarlo from "./locales/en.marlo.json";
import zhMarlo from "./locales/zh.marlo.json";
import { en, zh } from "./localeOverlay";

type Tree = { [k: string]: unknown };

function flatten(obj: Tree, prefix = ""): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(obj)) {
    const key = prefix ? `${prefix}.${k}` : k;
    if (v && typeof v === "object") Object.assign(out, flatten(v as Tree, key));
    else if (typeof v === "string") out[key] = v;
  }
  return out;
}

const placeholders = (s: string) => (s.match(/\{\{\s*(\w+)/g) ?? []).map((m) => m.slice(2).trim()).sort();

// overlay 里【故意新增】的键：我们 fork 有而上游没有的 UI。加进来要写清楚是哪个功能，
// 因为这张表的另一半作用是拦住"键名打错了"——那种覆盖会静默失效，比冲突难查得多。
const ADDITIONS = new Set([
  "rail.open_board", // 看板 chip 的 title：上游这句没包进 t()
  "cloud.signin_unlocks_default", // 没有 blurb 时的默认说明：同上
]);

const flatEnBase = flatten(enBase as Tree);
const flatZhBase = flatten(zhBase as Tree);
const flatEnMarlo = flatten(enMarlo as Tree);
const flatZhMarlo = flatten(zhMarlo as Tree);
const flatEn = flatten(en as Tree);
const flatZh = flatten(zh as Tree);

describe("Marlo locale overlay", () => {
  it("overrides only keys upstream actually has (typos fail silently otherwise)", () => {
    const strays = [
      ...Object.keys(flatEnMarlo).filter((k) => !(k in flatEnBase)),
      ...Object.keys(flatZhMarlo).filter((k) => !(k in flatZhBase)),
    ].filter((k) => !ADDITIONS.has(k));
    expect(strays, "overlay 里这些键上游没有 —— 打错了，还是该加进 ADDITIONS？").toEqual([]);
  });

  it("carries no override that repeats upstream verbatim", () => {
    const noop = [
      ...Object.keys(flatEnMarlo).filter((k) => flatEnMarlo[k] === flatEnBase[k]),
      ...Object.keys(flatZhMarlo).filter((k) => flatZhMarlo[k] === flatZhBase[k]),
    ];
    expect(noop, "和上游逐字相同的覆盖是死重量，删掉").toEqual([]);
  });

  it("keeps English and Chinese key sets in parity after the overlay", () => {
    const missingInZh = Object.keys(flatEn).filter((k) => !k.endsWith("_one") && !(k in flatZh));
    const missingInEn = Object.keys(flatZh).filter((k) => !(k in flatEn));
    expect(missingInZh, "合并后 zh 缺的键").toEqual([]);
    expect(missingInEn, "合并后 en 缺的键").toEqual([]);
  });

  it("keeps interpolation placeholders aligned after the overlay", () => {
    for (const key of Object.keys(flatEn)) {
      if (!(key in flatZh)) continue;
      expect(placeholders(flatZh[key]), key).toEqual(placeholders(flatEn[key]));
    }
  });

  it("fully interpolates the overridden Chinese strings", async () => {
    const instance = createInstance();
    await instance.init({
      resources: { zh: { translation: zh } },
      lng: "zh",
      fallbackLng: false,
      interpolation: { escapeValue: false },
    });
    for (const key of Object.keys(flatZhMarlo)) {
      const args = Object.fromEntries(placeholders(flatZh[key] ?? "").map((p) => [p, "x"]));
      // 键在这里是动态的，而 i18nTyped.d.ts 让 t() 只收已知键 —— 这一处放开类型。
      const tr = instance.t as unknown as (k: string, o?: Record<string, string>) => string;
      expect(tr(key, args), key).not.toMatch(/\{\{/);
    }
  });
});
