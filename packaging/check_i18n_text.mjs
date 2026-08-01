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

// 【刻意保留英文的】SlackHowItWorks.tsx 里那张模拟 Slack 截图的外壳：频道名、
// 时间戳、Slack 自己的导航标签、Slack 的输入框占位符。组件注释里写着它"pinned to
// light-Slack colors, so it reads as a screenshot of Slack" —— 把 Slack 的界面翻成
// 中文，它就不像 Slack 的截图了，而那张图存在的意义就是"你在 Slack 里会看到这个"。
//
// 【边界】外壳保留，说话的内容和旁白照翻 —— 中文用户要读得懂那张图在演示什么。
// 这条边界和 check_i18n.py 的 ALLOWED 里写的是同一条。
const DELIBERATELY_ENGLISH = new Set([
  "# launch-room",
  "Message #launch-room",
  "Agents & apps",
  "Drafts & sent",
  "Today at 6:34 PM",
  "Today at 6:36 PM",
  // 模拟图里被 @ 的那个 bot。它是【上游的】名字，出现在这里是这张图的虚构内容
  // 的一部分（和 Emma W / Lumina Labs 同类），不是我们产品里的字符串。
  "@OpenWorker summarize this thread",
]);

if (process.argv.includes("--list")) {
  let miss = 0;
  for (const [s, files] of [...found].sort()) {
    const ok = translated.has(s) || brandsOnly(s) || DELIBERATELY_ENGLISH.has(s);
    if (!ok) miss++;
    console.log(`${ok ? "  " : "缺"} ${JSON.stringify(s)}  ← ${files[0]}`);
  }
  console.log(`\n${found.size} 条原文，${miss} 条缺译文（专名已豁免）`);
  process.exit(0);
}

const missing = [...found].filter(([s]) => !translated.has(s) && !brandsOnly(s) && !DELIBERATELY_ENGLISH.has(s));
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

// 【反方向】表里的键，源码里还存在吗？
//
// 两个理由，第二个是安全性的：
//
//   1. 上游改了一句话，旧键就永远查不到了 —— tx() 静默回退英文，界面悄悄变回英文，
//      而这张表看上去还很健康。陈旧的键是"翻译已经做完了"的假象。
//
//   2. check_branding.py 跳过这个文件，理由是"每个键都是别处判过的字符串"。这条
//      理由只在键【真的都来自源码】时成立。不查反方向的话，任何人都可以往表里塞
//      一段没人看过的新文案，而两个守卫都不会看它。
const stale = [...translated].filter((s) => !found.has(s));
if (stale.length) {
  console.error(`zh-text.ts 里有 ${stale.length} 条键在源码里已经不存在了：`);
  for (const s of stale.slice(0, 15)) console.error(`  ${JSON.stringify(s)}`);
  if (stale.length > 15) console.error(`  …… 另外 ${stale.length - 15} 条`);
  console.error(
    "\n上游改过这句话，或者这条是手写进去的。删掉它，或者按新的原文重新加一条。" +
      "\n（陈旧的键不会报错，只会让界面悄悄变回英文 —— 所以这里必须拦。）",
  );
  process.exit(1);
}

console.log(
  `i18n-text: ${found.size} 条原文全部有译文，${translated.size} 条键全部对得上源码（${scanned} 个 .tsx）`,
);
