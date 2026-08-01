// JSX 里【哪些字符串是给人读的】—— 这份规则有两个消费者：
//
//   1. vite.config.ts 的 i18nText 插件：构建时把它们包进 tx()
//   2. packaging/check_i18n_text.mjs：对账时把它们提取出来，检查有没有中文
//
// 两边【必须用同一份判据】。分成两份实现的话，守卫报绿而界面是英文（或者反过来）
// 只是时间问题 —— check_i18n.py 和替换脚本判据不一致时就发生过一次，报出来的是一条
// 永远改不掉的记录。所以规则只写在这里，那两处都 import 它。

import { parse } from "@babel/parser";
import _traverse from "@babel/traverse";
import MagicString from "magic-string";

const traverse = _traverse.default ?? _traverse;

export const ATTRS = new Set(["placeholder", "title", "aria-label", "alt"]);
const HAS_LETTERS = /[A-Za-z]{2}/;

/** 这一段是给人读的，还是给机器读的？
 *
 * 判据故意保守：拿不准就【不包】。漏翻一句，用户看到英文（可用，只是没翻）；
 * 错包一个机器用的字符串（id、路径、类名），坏掉的是功能。代价不对称。 */
export function isProse(s) {
  const t = String(s).trim();
  if (!t || !HAS_LETTERS.test(t)) return false;
  if (/^[a-z0-9_\-./:]+$/.test(t)) return false; // id / 路径 / 事件名
  if (/^https?:\/\//.test(t)) return false;
  return true;
}

export function shouldSkip(id) {
  return (
    !id.endsWith(".tsx") ||
    id.includes("/src/i18n/") ||
    /\.test\.tsx$/.test(id)
  );
}

/** 走一遍 AST，把命中的位置交给 visit(text, start, end, kind)。
 *
 * 【为什么必须是真的解析器】check_i18n.py 用正则找"英文长什么形状"，前后补了十个
 * 盲区还在漏：小写开头、符号开头、中间夹破折号、跨行、模板串、JSX 注释……形状列
 * 不完，因为 JSX 的形状本来就列不完。AST 里 JSXText 就是 JSXText。 */
export function walk(code, visit) {
  let ast;
  try {
    ast = parse(code, { sourceType: "module", plugins: ["typescript", "jsx"] });
  } catch {
    return false; // 解析不了就别碰
  }
  traverse(ast, {
    JSXText(path) {
      const raw = path.node.value;
      if (!isProse(raw)) return;
      // JSX 折叠首尾空白，但把它们留在外面更安全：它们决定相邻元素之间有没有空格。
      const lead = raw.match(/^\s*/)[0];
      const tail = raw.match(/\s*$/)[0];
      const body = raw.slice(lead.length, raw.length - tail.length);
      if (!isProse(body)) return;
      visit(body, path.node.start, path.node.end, "text", { lead, tail });
    },
    JSXAttribute(path) {
      const name = path.node.name?.name;
      if (typeof name !== "string" || !ATTRS.has(name)) return;
      const v = path.node.value;
      if (!v || v.type !== "StringLiteral" || !isProse(v.value)) return;
      visit(v.value, v.start, v.end, "attr", {});
    },
  });
  return true;
}

/** 提取：这个文件里有哪些会显示给用户的英文。守卫用。 */
export function collect(code) {
  const out = [];
  walk(code, (text) => out.push(text));
  return out;
}

/** 改写：把它们包进 __tx()。构建用。 */
export function transform(code) {
  const s = new MagicString(code);
  let hits = 0;
  const ok = walk(code, (text, start, end, kind, ws) => {
    const call = `__tx(${JSON.stringify(text)})`;
    s.overwrite(
      start,
      end,
      kind === "text" ? `${ws.lead}{${call}}${ws.tail}` : `{${call}}`,
    );
    hits++;
  });
  if (!ok || !hits) return null;
  s.prepend('import { tx as __tx } from "/src/i18n/tx";\n');
  return { code: s.toString(), map: s.generateMap({ hires: true }) };
}
