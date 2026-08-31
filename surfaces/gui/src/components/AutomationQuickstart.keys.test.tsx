import { describe, expect, it } from "vitest";
import { en, zh } from "../localeOverlay";
import { TEMPLATES } from "./AutomationQuickstart";

// 自动化模板卡片上的每一句话，都必须真的有译文。
//
// 【这个文件是为一个印在界面上的 undefined 建的】：卡片底部显示
// 「不需要连接任何账号 · undefined」。原因是 cadence 字段的类型是 string，
// 调用点又写着 tr(t.cadence as any) —— 两道类型防线都被主动关掉了。
// 于是 6 个模板里有 5 个填的是【字面英文】"Weekly" / "Daily"，
// 而查不到这个 key 就返回 undefined，React 原样印出来。
//
// 类型收紧成 ParseKeys 之后，字面串编译期就过不去（上游那几个字段的类型是
// string，收紧是我们比它多的一层）。但类型只能证明"这是个 key"，证明不了
// "这个 key 在两个语种里都真的有值" —— 那要靠这个文件。
//
// 【量的是合并【之后】的目录】localeOverlay 的 en/zh，不是 locales/*.json：
// 那两份和上游字节相同，量它们等于没量我们实际发出去的东西。

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

const flatEn = flatten(en as Tree);
const flatZh = flatten(zh as Tree);

describe("自动化模板的文案 key", () => {
  // 【非空对照】：模板列表必须真的有东西。空数组的话，下面每一条 forEach
  // 都不会执行，测试全绿而什么都没验。
  it("模板列表不是空的", () => {
    expect(TEMPLATES.length).toBeGreaterThan(3);
  });

  for (const field of ["titleKey", "blurbKey", "cadenceKey"] as const) {
    it(`每个模板的 ${field} 在 en 和 zh 里都有译文`, () => {
      const missing: string[] = [];
      for (const t of TEMPLATES) {
        const key = t[field] as string;
        if (typeof flatEn[key] !== "string") missing.push(`en.${key} (模板 ${t.key}.${field})`);
        if (typeof flatZh[key] !== "string") missing.push(`zh.${key} (模板 ${t.key}.${field})`);
      }
      expect(missing).toEqual([]);
    });
  }

  it("每个模板 conns 里的 whyKey 也都有译文", () => {
    const missing: string[] = [];
    for (const t of TEMPLATES) {
      for (const c of t.conns) {
        const key = c.whyKey as string;
        if (typeof flatEn[key] !== "string") missing.push(`en.${key} (模板 ${t.key})`);
        if (typeof flatZh[key] !== "string") missing.push(`zh.${key} (模板 ${t.key})`);
      }
    }
    expect(missing).toEqual([]);
  });

  // 界面上真正会拼出来的那串。undefined 是它当初露出来的样子 ——
  // 直接断言它不出现，比断言 key 存在更贴近用户看到的东西。
  it("拼出来的页脚里不会出现 undefined", () => {
    for (const t of TEMPLATES) {
      for (const dict of [flatEn, flatZh]) {
        const footer = (dict["automations.no_conns_with_cadence"] ?? "").replace(
          "{{cadence}}",
          String(dict[t.cadenceKey as string]),
        );
        expect(footer).not.toContain("undefined");
      }
    }
  });
});
