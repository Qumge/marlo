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
/** 这几个标签里的字是【要照着敲的】，不是读的。 */
const VERBATIM_TAGS = new Set(["code", "pre", "kbd", "samp"]);

/** 这一段是给人读的，还是给机器读的？
 *
 * 判据故意保守：拿不准就【不包】。漏翻一句，用户看到英文（可用，只是没翻）；
 * 错包一个机器用的字符串（id、路径、类名），坏掉的是功能。代价不对称。
 *
 * 【2026-08-04：原来那条"全小写就是 id"错得很贵】原判据是
 * `/^[a-z0-9_\-./:]+$/ → 不是文案`，理由写的是"id / 路径 / 事件名"。但它连
 * `clear`、`cancel`、`default`、`auto-allowed` 一起挡掉了 —— 而这些就长在按钮上，
 * 中文界面上真实显示的是「设置 | clear」「添加 | cancel」。守卫查不出来：提取不到
 * 的字符串，它根本不知道存在，于是报「258 条原文全部有译文」而界面是英文。
 *
 * 现在按【有没有空格】分：
 *
 *   - 有空格 ⇒ 是句子，是文案。`npm install foo` 这种反例交给 VERBATIM_TAGS 挡，
 *     那才是它真正的判据（"它在 <code> 里"），而不是"它长得像命令"。
 *   - 没空格 ⇒ 只有夹着 `_ / :` 或【中间】有点的才判成机器串（user_name、
 *     a/b、app.config.json）。`Done.` 的点在末尾，是标点不是分隔符。
 *
 * 连字符【不】算机器串：`auto-allowed` 和 `aria-label` 形状完全相同，分不出来。
 * 选文案这一边，因为 walk 只看 JSXText 和白名单属性 —— 这两个位置上的字按定义就是
 * 渲染给人看的，className/id/testid 根本走不到这里。 */
export function isProse(s) {
  const t = String(s).trim();
  if (!t || !HAS_LETTERS.test(t)) return false;
  if (/^https?:\/\//.test(t)) return false;
  if (!/\s/.test(t)) {
    if (/[_/:]/.test(t)) return false; // user_name · a/b · ns:key · image/*
    if (/\.[A-Za-z0-9]/.test(t)) return false; // app.config.json（末尾的点不算）
  }
  return true;
}

// 专名不需要译文 —— tx() 查不到就回退原文，而 "Marlo" 的正确译文【就是】"Marlo"。
// 这份判据原来住在 packaging/check_i18n_text.mjs 里；搬过来是因为它和 isProse 是
// 同一个问题的两半（"这串字要不要翻"），而这个文件头上写着规则只写一份。
const BRANDS =
  /\b(Marlo|Qumge|OpenWorker|Gmail|Slack|Notion|GitHub|GitLab|Jira|Outlook|Telegram|Discord|WhatsApp|Dropbox|Box|Stripe|Asana|HubSpot|Linear|Figma|Canva|Zendesk|Confluence|QuickBooks|DocuSign|ClickUp|Attio|PostHog|Mixpanel|Amplitude|Apollo|Hunter|AutoWhisper|MCP|IMAP|SMTP|OAuth|API|URL|JSON|PDF|Ollama|Claude|OpenAI|Anthropic|Gemini|DeepSeek|Windows|macOS|Word|Excel|Google|Calendar|Bedrock|Vertex|OpenRouter|Kimi|Qwen|MiniMax|Together|Fireworks|Mistral)\b/g;

/** 这串字【整个】就是专名吗？是的话不需要译文。
 *
 * 【2026-08-04：门槛从「不足 2 个词」改成「一个词都不剩」】原判据是抠掉专名之后
 * 剩下的英文单词 < 2 就豁免。它想说的是"PDF"、"Marlo" 这种；实际放过的是【每一个
 * 单词标签】—— clear、cancel、default、Light、Dark、Rename、core……
 *
 * 这是 A 类盲区的下半截，而且比上半截更隐蔽：上半截是"提取不到"，这半截是
 * "提取到了、没译文、守卫说没问题"。两层叠在一起，界面上的英文可以一直待着。
 *
 * 一个词都不剩才豁免："PDF" 抠完是空 ⇒ 豁免；"clear" 抠完还剩 clear ⇒ 要翻；
 * "Marlo v1.2 is ready to install." 抠完还剩 is/ready/to/install ⇒ 要翻（这一句
 * 曾经因为"以专名开头"被整句放过）。 */
export function isBrandOnly(s) {
  return (String(s).replace(BRANDS, " ").match(/\b[A-Za-z]{2,}\b/g) ?? []).length === 0;
}

/** 键要【和排版无关】。
 *
 * 多行的 JSX 文本，原始 value 里带着换行和缩进：
 *
 *   <p className="…">
 *     Filters are enforced on this computer, before an agent sees
 *     results.
 *   </p>
 *
 * 拿它原样当键的话，Prettier 换一次行、或者有人多缩进两格，键就对不上了 ——
 * 而失效是【静默】的：tx() 查不到就回退英文，界面悄悄变回英文，没有任何报错。
 * 这正是这套机制最容易烂掉的方式。
 *
 * 折叠成单空格，恰好也是 React 渲染 JSX 文本时做的事，所以键和用户看到的字符串
 * 是同一个东西。 */
export function normalize(s) {
  return String(s).replace(/\s+/g, " ").trim();
}

export function shouldSkip(id) {
  return (
    !id.endsWith(".tsx") ||
    id.includes("/src/i18n/") ||
    /\.test\.tsx$/.test(id)
  );
}

/** 这个位置在 <code>/<pre>/<kbd>/<samp> 里面吗？里面的字是要照着敲的。 */
function inVerbatimTag(path) {
  return !!path.findParent((p) => {
    if (!p.isJSXElement()) return false;
    const name = p.node.openingElement?.name;
    return name?.type === "JSXIdentifier" && VERBATIM_TAGS.has(name.name);
  });
}

/** 这段文字后面紧跟着英文的复数 s 吗？
 *
 *   {accounts.length} account{accounts.length === 1 ? "" : "s"}
 *
 * 把 account 译成"个账号"而那个 s 留在原地，中文界面上渲染出来是「2 个账号s」。
 * 那个 s 又包不了：它单独一个字母，本身不成词，译成什么都不对。拆不开的东西
 * 【整段都不碰】—— 半截译文比不译更糟，而不译至少是一致的英文。
 *
 * 想真正修这三处，要的是一个带数量的模板键（zh.ts 里 tpl* 那种），而那要就地改
 * 上游的行 —— tx() 这条路存在的全部意义就是不改那些行。留着，并且是【看得见】地
 * 留着：这条注释和它的测试就是记录。 */
function hasPluralSuffix(path) {
  const next = path.container?.[path.key + 1];
  if (!next || next.type !== "JSXExpressionContainer") return false;
  const e = next.expression;
  if (!e || e.type !== "ConditionalExpression") return false;
  const branches = [e.consequent, e.alternate];
  if (!branches.every((b) => b.type === "StringLiteral")) return false;
  return branches.some((b) => b.value === "") && branches.some((b) => b.value.length <= 2 && b.value !== "");
}

/** 表达式里【会被直接渲染出来】的字符串字面量。
 *
 * 只认自己是字面量、三元的两支、以及 && / || / ?? 的右边 —— 都是"这个位置最终会
 * 显示这串字"的形状。调用、成员访问、数组、对象一律不进：那里面的字符串是参数，
 * 而参数是干什么用的，看形状看不出来。 */
function stringLeaves(node, out = []) {
  if (!node) return out;
  if (node.type === "StringLiteral") out.push(node);
  else if (node.type === "ConditionalExpression") {
    stringLeaves(node.consequent, out);
    stringLeaves(node.alternate, out);
  } else if (node.type === "LogicalExpression") stringLeaves(node.right, out);
  return out;
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
      if (inVerbatimTag(path)) return;
      if (hasPluralSuffix(path)) return;
      // JSX 折叠首尾空白，但把它们留在外面更安全：它们决定相邻元素之间有没有空格。
      const lead = raw.match(/^\s*/)[0];
      const tail = raw.match(/\s*$/)[0];
      const body = normalize(raw.slice(lead.length, raw.length - tail.length));
      if (!isProse(body)) return;
      visit(body, path.node.start, path.node.end, "text", { lead, tail });
    },
    // 【子位置上的字面量】{saving ? "Saving…" : "Save"}、{"Connected"}。
    //
    // 原来一个都不碰，于是 Install / Saving… / Unpin / Light / Dark 这些按钮字全是
    // 英文。只走【子位置】：属性位置的容器（accept={"image/*"}、className={…}）
    // 一律不碰，白名单之外的属性本来就不该翻。
    //
    // 【调用的实参一个都不包】Sidebar 的 item("row-menu-pin", "pin", "Unpin", cb)
    // 里，第 1 个是 testid、第 2 个是图标名、第 3 个才是文案 —— AST 分不出来，
    // 而错包一个 testid 会让点击测试和界面同时坏掉。这个缺口是【选的】，不是漏的：
    // 够不到的那些继续显示英文，可用，只是没翻。
    JSXExpressionContainer(path) {
      const parent = path.parentPath;
      if (!parent || !(parent.isJSXElement() || parent.isJSXFragment())) return;
      if (inVerbatimTag(path)) return;
      for (const node of stringLeaves(path.node.expression)) {
        if (!isProse(node.value)) continue;
        // 【原样，不 normalize】JSXText 的首尾空白是【排版】产生的，折叠掉才能让键
        // 和换行缩进无关；字符串字面量里的空格是【写死的】，就是要显示出来的那个
        // 空格。`{tier === "core" ? " · core" : ""}` 折叠之后渲染成 "hubspot· core"
        // —— 单元测试全绿，e2e 才抓到。
        visit(node.value, node.start, node.end, "expr", {});
      }
    },
    JSXAttribute(path) {
      const name = path.node.name?.name;
      if (typeof name !== "string" || !ATTRS.has(name)) return;
      const v = path.node.value;
      if (!v || v.type !== "StringLiteral" || !isProse(v.value)) return;
      visit(normalize(v.value), v.start, v.end, "attr", {});
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
    // text：外面还没有花括号，要补，而且首尾空白留在括号外（它们决定相邻元素之间
    // 有没有空格）。attr：整个 name="value" 被换成 name={__tx("value")}。
    // expr：【已经在表达式里了】，再套一层花括号就是语法错误。
    s.overwrite(
      start,
      end,
      kind === "text" ? `${ws.lead}{${call}}${ws.tail}` : kind === "expr" ? call : `{${call}}`,
    );
    hits++;
  });
  if (!ok || !hits) return null;
  s.prepend('import { tx as __tx } from "/src/i18n/tx";\n');
  return { code: s.toString(), map: s.generateMap({ hires: true }) };
}
