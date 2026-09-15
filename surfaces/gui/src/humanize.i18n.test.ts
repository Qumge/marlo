// humanize.ts 的三个函数在中文界面上不能吐英文。
//
// 【为什么要逐个 case 跑】这三个函数返回的是普通对象，不是 JSX —— check_i18n.py 只扫
// .tsx 里的 JSX 文本和属性，从来没看见过它们。于是审批卡片上写着
// "Run a command — 生成带可执行性标注的清单行"，从构建期翻译 transform 退役那天起就这样
// 发出去了，守卫一直报「无新增」。量渲染结果、而且每条分支都量，才量得到。
//
// 判据：拼出来的整句，去掉我们【传进去的动态值】（文件名、命令、工具名、主机名）之后，
// 不能再有连续 3 个以上的英文字母。动态值本来就该原样显示。
//
// 另一半：英文输出和改动前【逐字、逐段】相同。下面每条的 en 是在改 humanize.ts 之前，
// 从旧实现上跑出来的结果，不是照着源码手抄的。
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import humanizeSrc from "./humanize.ts?raw";
import { humanizeApprovalTitle, humanizeAsk, humanizeTool, type HumanLine } from "./humanize";
import { setTestLocale } from "./testLocale";

type Fn = "tool" | "title" | "ask";
interface Case {
  fn: Fn;
  name: string;
  args: unknown;
  // 这一条里合法出现的动态值 —— 从整句里抹掉之后再查英文
  dyn: string[];
  en: HumanLine;
}

const FNS: Record<Fn, (name: string, args: any) => HumanLine> = {
  tool: humanizeTool,
  title: humanizeApprovalTitle,
  ask: humanizeAsk,
};

const ZH_DESC = "生成带可执行性标注的清单行";
const DIGEST = "Post the digest";

const CASES: Case[] = [
  // ---- humanizeTool ----
  { fn: "tool", name: "run_shell", args: { command: "python make_rows.py", description: ZH_DESC }, dyn: ["python make_rows.py"], en: { pre: "Ran ", obj: "python make_rows.py", post: ` — ${ZH_DESC}` } },
  { fn: "tool", name: "run_shell", args: { command: "python make_rows.py" }, dyn: ["python make_rows.py"], en: { pre: "Ran ", obj: "python make_rows.py" } },
  { fn: "tool", name: "run_shell", args: { command: "npm run dev", run_in_background: true }, dyn: ["npm run dev"], en: { pre: "Started in the background: ", obj: "npm run dev" } },
  { fn: "tool", name: "shell_task_output", args: {}, dyn: [], en: { pre: "Checked on a background command" } },
  { fn: "tool", name: "shell_task_kill", args: {}, dyn: [], en: { pre: "Stopped a background command" } },
  { fn: "tool", name: "read_file", args: { path: "docs/runbook.md" }, dyn: ["runbook.md"], en: { pre: "Read ", obj: "runbook.md" } },
  { fn: "tool", name: "read_file", args: {}, dyn: [], en: { pre: "Read ", obj: "a file" } },
  { fn: "tool", name: "write_file", args: { path: "out/report.csv" }, dyn: ["report.csv"], en: { pre: "Wrote ", obj: "report.csv" } },
  { fn: "tool", name: "write_file", args: {}, dyn: [], en: { pre: "Wrote ", obj: "a file" } },
  { fn: "tool", name: "replace_in_file", args: { path: "src/app.py" }, dyn: ["app.py"], en: { pre: "Edited ", obj: "app.py" } },
  { fn: "tool", name: "apply_patch", args: {}, dyn: [], en: { pre: "Edited ", obj: "files" } },
  { fn: "tool", name: "apply_unified_diff", args: { path: "notes/todo.txt" }, dyn: ["todo.txt"], en: { pre: "Edited ", obj: "todo.txt" } },
  { fn: "tool", name: "grep", args: { pattern: "TODO" }, dyn: ["TODO"], en: { pre: "Searched the code for ", obj: "“TODO”" } },
  { fn: "tool", name: "git_log", args: {}, dyn: [], en: { pre: "Looked through recent git history" } },
  { fn: "tool", name: "todo_write", args: { todos: [{ content: DIGEST, status: "in_progress" }] }, dyn: [DIGEST], en: { pre: "Updated the plan — ", obj: `“${DIGEST}”`, post: " → in progress" } },
  { fn: "tool", name: "todo_write", args: { todos: [{ content: DIGEST, status: "pending" }] }, dyn: [DIGEST], en: { pre: "Updated the plan — ", obj: `“${DIGEST}”`, post: " → pending" } },
  { fn: "tool", name: "todo_write", args: { todos: [{ content: DIGEST, status: "done" }] }, dyn: [DIGEST], en: { pre: "Updated the plan — ", obj: `“${DIGEST}”`, post: " → done" } },
  { fn: "tool", name: "todo_write", args: { todos: [{ content: DIGEST, status: "completed" }] }, dyn: [DIGEST], en: { pre: "Updated the plan — ", obj: `“${DIGEST}”`, post: " → completed" } },
  // 词汇外的状态原样显示（下划线换空格），它是模型给的值
  { fn: "tool", name: "todo_write", args: { todos: [{ content: DIGEST, status: "on_hold" }] }, dyn: [DIGEST, "on hold"], en: { pre: "Updated the plan — ", obj: `“${DIGEST}”`, post: " → on hold" } },
  { fn: "tool", name: "todo_write", args: { todos: [{ content: DIGEST }] }, dyn: [DIGEST], en: { pre: "Updated the plan — ", obj: `“${DIGEST}”` } },
  { fn: "tool", name: "todo_write", args: { items: [{ content: "Old plan", status: "pending" }] }, dyn: ["Old plan"], en: { pre: "Updated the plan — ", obj: "“Old plan”", post: " → pending" } },
  { fn: "tool", name: "todo_write", args: { todos: [{ content: "a" }, { content: "b" }, { content: "c" }] }, dyn: [], en: { pre: "Updated the plan — 3 items" } },
  { fn: "tool", name: "todo_write", args: {}, dyn: [], en: { pre: "Updated the plan — 0 items" } },
  { fn: "tool", name: "send_message", args: { target: "slack:C123/general" }, dyn: ["Slack", "general"], en: { pre: "Sent a Slack message to ", obj: "general" } },
  { fn: "tool", name: "send_message", args: { target: "telegram:12345" }, dyn: ["Telegram", "12345"], en: { pre: "Sent a Telegram message to ", obj: "12345" } },
  { fn: "tool", name: "send_message", args: { target: "slack" }, dyn: [], en: { pre: "Sent a message" } },
  { fn: "tool", name: "send_message", args: {}, dyn: [], en: { pre: "Sent a message" } },
  { fn: "tool", name: "web_search", args: { query: "weather Beijing" }, dyn: ["weather Beijing"], en: { pre: "Searched the web — ", obj: "“weather Beijing”" } },
  { fn: "tool", name: "web_fetch", args: { url: "https://example.com/a/b" }, dyn: ["example.com"], en: { pre: "Read a web page — ", obj: "example.com" } },
  { fn: "tool", name: "web_fetch", args: { url: "not a url" }, dyn: ["not a url"], en: { pre: "Read a web page — ", obj: "not a url" } },
  { fn: "tool", name: "explore", args: { task: "find flaky tests" }, dyn: ["find flaky tests"], en: { pre: "Sent a sub-agent to explore — ", obj: "“find flaky tests”" } },
  { fn: "tool", name: "explore", args: { prompt: "map the repo" }, dyn: ["map the repo"], en: { pre: "Sent a sub-agent to explore — ", obj: "“map the repo”" } },
  { fn: "tool", name: "load_skill", args: { name: "incident-summary" }, dyn: ["incident-summary"], en: { pre: "Used skill: ", obj: "incident-summary" } },
  { fn: "tool", name: "ask_user", args: {}, dyn: [], en: { pre: "Asked you a question" } },
  { fn: "tool", name: "propose_plan", args: {}, dyn: [], en: { pre: "Proposed a plan" } },
  { fn: "tool", name: "request_directory", args: { path: "/Users/me/Documents" }, dyn: ["/Users/me/Documents"], en: { pre: "Asked for folder access — ", obj: "/Users/me/Documents" } },
  { fn: "tool", name: "gmail_search_messages", args: { query: "from:ci" }, dyn: ["gmail_search_messages", "query=from:ci"], en: { pre: "Used gmail_search_messages", post: " — query=from:ci" } },
  { fn: "tool", name: "gmail_list_labels", args: {}, dyn: ["gmail_list_labels"], en: { pre: "Used gmail_list_labels" } },

  // ---- humanizeApprovalTitle ----
  { fn: "title", name: "write_file", args: { path: "out/report.csv" }, dyn: ["report.csv"], en: { pre: "Write ", obj: "report.csv" } },
  { fn: "title", name: "write_file", args: {}, dyn: [], en: { pre: "Write ", obj: "a file" } },
  { fn: "title", name: "replace_in_file", args: { path: "src/app.py" }, dyn: ["app.py"], en: { pre: "Edit ", obj: "app.py" } },
  { fn: "title", name: "apply_patch", args: {}, dyn: [], en: { pre: "Edit ", obj: "files" } },
  { fn: "title", name: "apply_unified_diff", args: { path: "notes/todo.txt" }, dyn: ["todo.txt"], en: { pre: "Edit ", obj: "todo.txt" } },
  { fn: "title", name: "run_shell", args: { command: "python make_rows.py", description: ZH_DESC }, dyn: [], en: { pre: "Run a command", post: ` — ${ZH_DESC}` } },
  { fn: "title", name: "run_shell", args: { command: "ls", description: "Fetch stock data" }, dyn: ["fetch stock data"], en: { pre: "Run a command", post: " — fetch stock data" } },
  { fn: "title", name: "run_shell", args: { command: "python make_rows.py" }, dyn: [], en: { pre: "Run a command" } },
  { fn: "title", name: "send_message", args: { target: "slack:C123/general" }, dyn: ["general"], en: { pre: "Send a message to ", obj: "general" } },
  { fn: "title", name: "send_message", args: {}, dyn: [], en: { pre: "Send a message" } },
  { fn: "title", name: "send_file", args: { target: "telegram:12345" }, dyn: ["12345"], en: { pre: "Send a file to ", obj: "12345" } },
  { fn: "title", name: "send_file", args: {}, dyn: [], en: { pre: "Send a file" } },
  { fn: "title", name: "create_scheduled_task", args: { title: "Morning digest" }, dyn: ["Morning digest"], en: { pre: "Create the automation ", obj: "“Morning digest”" } },
  { fn: "title", name: "create_scheduled_task", args: {}, dyn: [], en: { pre: "Create an automation" } },
  { fn: "title", name: "save_skill", args: { name: "weekly-report" }, dyn: ["weekly-report"], en: { pre: "Add skill ", obj: "weekly-report", post: " to your skills" } },
  { fn: "title", name: "save_skill", args: {}, dyn: [], en: { pre: "Add a skill to your skills" } },
  { fn: "title", name: "web_fetch", args: { url: "https://example.com/a/b" }, dyn: ["example.com"], en: { pre: "Fetch from ", obj: "example.com" } },
  { fn: "title", name: "web_fetch", args: { url: "not a url" }, dyn: [], en: { pre: "Fetch a web page" } },
  { fn: "title", name: "web_search", args: { query: "weather Beijing" }, dyn: [], en: { pre: "Search the web" } },
  { fn: "title", name: "mcp__atlassian__createJiraIssue", args: {}, dyn: ["mcp__atlassian__createJiraIssue"], en: { pre: "Use mcp__atlassian__createJiraIssue" } },

  // ---- humanizeAsk ----
  { fn: "ask", name: "run_shell", args: { command: "rm -rf build" }, dyn: ["rm -rf build"], en: { pre: "Wanted to run ", obj: "rm -rf build" } },
  { fn: "ask", name: "write_file", args: { path: "out/report.csv" }, dyn: ["report.csv"], en: { pre: "Wanted to write ", obj: "report.csv" } },
  { fn: "ask", name: "write_file", args: {}, dyn: [], en: { pre: "Wanted to write ", obj: "a file" } },
  { fn: "ask", name: "replace_in_file", args: { path: "src/app.py" }, dyn: ["app.py"], en: { pre: "Wanted to edit ", obj: "app.py" } },
  { fn: "ask", name: "apply_patch", args: {}, dyn: [], en: { pre: "Wanted to edit ", obj: "files" } },
  { fn: "ask", name: "apply_unified_diff", args: { path: "notes/todo.txt" }, dyn: ["todo.txt"], en: { pre: "Wanted to edit ", obj: "todo.txt" } },
  { fn: "ask", name: "send_message", args: { target: "slack:C123/general" }, dyn: ["Slack", "general"], en: { pre: "Wanted to message ", obj: "general", post: " on Slack" } },
  { fn: "ask", name: "send_message", args: {}, dyn: [], en: { pre: "Wanted to send a message" } },
  { fn: "ask", name: "gmail_send", args: { to: "a@b.c" }, dyn: ["gmail_send"], en: { pre: "Wanted to use gmail_send" } },
];

const text = (l: HumanLine) => l.pre + (l.obj ?? "") + (l.post ?? "");
const label = (c: Case) => `${c.fn}:${c.name} ${JSON.stringify(c.args)}`;

// 从源码里读出每个函数的 case 标签。表是手写的，新加一个 case 而忘了加进表，
// 这条测试就会【静默地】不再量它 —— 所以覆盖度本身也要断言。
function caseLabels(fnName: string): string[] {
  const start = humanizeSrc.indexOf(`export function ${fnName}(`);
  const next = humanizeSrc.indexOf("export function ", start + 1);
  const body = humanizeSrc.slice(start, next < 0 ? undefined : next);
  return [...body.matchAll(/case "([^"]+)":/g)].map((m) => m[1]);
}

describe("humanize · 表覆盖了每一条分支", () => {
  const table: [Fn, string][] = [
    ["tool", "humanizeTool"],
    ["title", "humanizeApprovalTitle"],
    ["ask", "humanizeAsk"],
  ];
  it.each(table)("%s", (fn, fnName) => {
    const labels = caseLabels(fnName);
    expect(labels.length).toBeGreaterThan(0);
    const covered = new Set(CASES.filter((c) => c.fn === fn).map((c) => c.name));
    expect(labels.filter((l) => !covered.has(l)), "这些 case 没进表").toEqual([]);
    // default 分支：至少一条不在 case 标签里的工具名
    expect(CASES.some((c) => c.fn === fn && !labels.includes(c.name))).toBe(true);
  });
});

describe("humanize · 中文界面上没有英文", () => {
  beforeAll(async () => {
    await setTestLocale("zh");
  });
  afterAll(async () => {
    await setTestLocale("en");
  });

  it.each(CASES.map((c) => [label(c), c] as const))("%s", (_label, c) => {
    const line = FNS[c.fn](c.name, c.args);
    let s = text(line);
    for (const v of c.dyn) s = s.split(v).join("");
    expect(s.match(/[A-Za-z]{3,}/g), text(line)).toBeNull();
    // 有对象的句子，对象还在 obj 里（UI 靠它加粗）
    if (c.en.obj !== undefined) expect(line.obj).toBeDefined();
  });

  // platform 是 humanize.ts 里唯一插值进 t() 的模型值（其余都拼接）。它是句中唯一的
  // 占位符，所以值里的 {{…}} / $& / $t(…) 应当原样出来 —— 量一下，不靠推理。
  it("platform 插值：值里的模板语法原样保留", () => {
    const hostile = "{{platform}}$&$t(approval.allow)";
    const step = humanizeTool("send_message", { target: `${hostile}:general` });
    expect(step.pre).toContain(hostile);
    const ask = humanizeAsk("send_message", { target: `${hostile}:general` });
    expect(ask.post).toContain(hostile);
  });

  it("审批卡片那条真实的句子：命令说明原样保留，不改大小写", () => {
    const line = humanizeApprovalTitle("run_shell", { command: "python make_rows.py", description: ZH_DESC });
    expect(text(line)).toContain(ZH_DESC);
    expect(text(line)).not.toContain("Run a command");
  });
});

describe("humanize · 英文输出与改动前逐字相同", () => {
  beforeAll(async () => {
    await setTestLocale("en");
  });
  it.each(CASES.map((c) => [label(c), c] as const))("%s", (_label, c) => {
    expect(FNS[c.fn](c.name, c.args)).toEqual(c.en);
  });
});
