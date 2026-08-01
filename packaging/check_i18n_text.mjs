// 对账：源码里每一条会显示给用户的英文，zh-text.ts 里都有译文吗？
//
// 【和 check_i18n.py 的分工】那一把量的是"有没有【新增】写死的英文"，靠正则找形状 ——
// 它管的是【我们自己写的】组件该不该走 t("key")。这一把量的是"transform 会包起来的
// 那些原文，翻了没有"，靠 AST —— 它管的是【上游的 JSX】。
//
// 关键在于：这个脚本和构建时的 transform 共用 i18n-jsx.mjs 里的【同一份判据】。
// 判据分成两份的话，守卫报绿而界面是英文只是时间问题 —— check_i18n.py 和当年的替换
// 脚本判据不一致时就发生过一次，报出来的是一条永远改不掉的记录。
//
// 用法：
//   node packaging/check_i18n_text.mjs          对账，缺译文就非零退出
//   node packaging/check_i18n_text.mjs --list    列出全部提取到的原文（补表用）

import fs from "node:fs";
import path from "node:path";
import url from "node:url";

const ROOT = path.resolve(path.dirname(url.fileURLToPath(import.meta.url)), "..");
const GUI = path.join(ROOT, "surfaces/gui");
const SRC = path.join(GUI, "src");

const { collect, shouldSkip } = await import(
  url.pathToFileURL(path.join(GUI, "i18n-jsx.mjs")).href
);

function* tsxFiles(dir) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) yield* tsxFiles(p);
    else if (!shouldSkip(p)) yield p;
  }
}

// zh-text.ts 是生成物，但这里【不 import 它】—— 那要一条 TS 工具链。它的形状是固定的
// "原文": "译文"，直接读键就够，也顺带证明这个脚本不依赖构建。
const zhSrc = fs.readFileSync(path.join(SRC, "i18n/zh-text.ts"), "utf8");
const translated = new Set(
  [...zhSrc.matchAll(/^\s{2}("(?:[^"\\]|\\.)*")\s*:/gm)].map((m) => JSON.parse(m[1])),
);

const found = new Map(); // 原文 -> [出现的文件]
let scanned = 0;
for (const f of tsxFiles(SRC)) {
  scanned++;
  for (const s of collect(fs.readFileSync(f, "utf8"))) {
    if (!found.has(s)) found.set(s, []);
    found.get(s).push(path.relative(SRC, f));
  }
}

// 路径写错时"什么都没扫到"必须是失败，不是通过 —— check_i18n.py 头上写着同一件事。
if (scanned < 50) {
  console.error(`只扫到 ${scanned} 个 .tsx —— 路径大概不对（SRC=${SRC}）`);
  process.exit(1);
}

// 专名不需要译文 —— tx() 查不到就回退原文，而"Marlo"的正确译文【就是】"Marlo"。
// 判据抄 check_i18n.py 的 _brands_only：把专名抠掉之后还剩两个以上英文单词才算句子。
// "以专名开头就豁免"是错的写法（那一版让 "Marlo v1.2 is ready to install." 整句隐形）。
const BRANDS =
  /\b(Marlo|Qumge|OpenWorker|Gmail|Slack|Notion|GitHub|GitLab|Jira|Outlook|Telegram|Discord|WhatsApp|Dropbox|Box|Stripe|Asana|HubSpot|Linear|Figma|Canva|Zendesk|Confluence|QuickBooks|DocuSign|ClickUp|Attio|PostHog|Mixpanel|Amplitude|Apollo|Hunter|AutoWhisper|MCP|IMAP|SMTP|OAuth|API|URL|JSON|PDF|Ollama|Claude|OpenAI|Anthropic|Gemini|DeepSeek|Windows|macOS|Word|Excel|Google|Calendar|Bedrock|Vertex|OpenRouter|Kimi|Qwen|MiniMax|Together|Fireworks|Mistral)\b/g;

function brandsOnly(s) {
  return (s.replace(BRANDS, " ").match(/\b[A-Za-z]{2,}\b/g) ?? []).length < 2;
}

if (process.argv.includes("--list")) {
  let miss = 0;
  for (const [s, files] of [...found].sort()) {
    const ok = translated.has(s) || brandsOnly(s);
    if (!ok) miss++;
    console.log(`${ok ? "  " : "缺"} ${JSON.stringify(s)}  ← ${files[0]}`);
  }
  console.log(`\n${found.size} 条原文，${miss} 条缺译文（专名已豁免）`);
  process.exit(0);
}

const missing = [...found].filter(([s]) => !translated.has(s) && !brandsOnly(s));
if (missing.length) {
  console.error(`${missing.length} 条会显示给用户的英文还没有中文（共 ${found.size} 条，${scanned} 个文件）：`);
  for (const [s, files] of missing.slice(0, 25)) {
    console.error(`  ${JSON.stringify(s)}  ← ${files[0]}`);
  }
  if (missing.length > 25) console.error(`  …… 另外 ${missing.length - 25} 条`);
  console.error(
    "\n补进 surfaces/gui/src/i18n/zh-text.ts。" +
      "\n全量清单：node packaging/check_i18n_text.mjs --list",
  );
  process.exit(1);
}

console.log(`i18n-text: ${found.size} 条原文全部有译文（${scanned} 个 .tsx）`);
