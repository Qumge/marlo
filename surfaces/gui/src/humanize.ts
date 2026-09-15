// UX-015 (§33): tool calls render as one-liners. The model does NOT emit a purpose
// per call — the stream is name+args+result — so the sentence is synthesized here from
// per-tool templates. `run_shell` is the exception: its optional `description` argument is
// model-written intent and is preferred when present. Fallback: "Used <tool> — <short args>".
//
// Marlo：句子里的静态文案都过 t()（键在 locales/*.marlo.json 的 humanize.*）。
// 【为什么】这里原来是写死的英文，中文用户在审批卡片上看到的是
// "Run a command — 生成带可执行性标注的清单行"。构建期翻译 transform 退役之后就一直这样，
// 而 check_i18n.py 只扫 .tsx 的 JSX，看不见 .ts 里的对象字面量 —— 守卫一直是绿的。
// humanize.i18n.test.ts 逐条分支在中文下跑一遍，才量得到。
//
// 动态值（命令、文件名、工具名）一律【拼接】而不是插值进 t()：它们来自模型，
// 不该经过模板引擎。

import { getI18n } from "react-i18next";
import type { ParseKeys } from "i18next";
import { shortArgs } from "./components/ApprovalCard";

// A one-line sentence in three segments so the UI can emphasize the object:
// "Read " + <b>runbook.md</b> + " from the shared folder".
export interface HumanLine {
  pre: string;
  obj?: string;
  post?: string;
}

// 模块级 t()，调用时才取 —— 模块加载那一刻 i18n 还没 init，拿到的会是键名本身
// （同 ApprovalCard.tsx 的 approvalActionLabels）。调用方都是订阅了语言的组件，切语言时会重新调用。
const tr = () => getI18n().getFixedT(null, "translation");

const trunc = (s: string, n: number) => (s.length > n ? s.slice(0, n - 1) + "…" : s);
const baseName = (p: string) => p.replace(/\/+$/, "").split("/").pop() || p;

// 英文句中接模型写的说明，首字母小写才顺；只动 ASCII 大写字母 —— 中文没有大小写，
// 别的文字（Über、Élan）也轮不到我们改。
const lowerFirstAscii = (s: string) => (/^[A-Z]/.test(s) ? s.charAt(0).toLowerCase() + s.slice(1) : s);

// 中文文案和对象之间留不留空格：中文与拉丁字母之间留（"读取了 runbook.md"，和 zh.json
// 的写法一致），中文与中文、中文与引号之间不留（"编辑了一些文件"、"上网搜索了“天气”"）。
// 只看【静态文案那一侧】是不是中文 —— 英文文案里没有中文字符，所以英文输出一个字节都不变。
const CJK = /[　-〿㐀-鿿＀-￯]/;
const ALNUM = /[A-Za-z0-9]/;
function line(pre: string, obj?: string, post?: string): HumanLine {
  if (obj) {
    if (pre.endsWith(" ") && CJK.test(pre.charAt(pre.length - 2)) && !ALNUM.test(obj.charAt(0))) {
      pre = pre.slice(0, -1);
    }
    if (post?.startsWith(" ") && CJK.test(post.charAt(1)) && !ALNUM.test(obj.charAt(obj.length - 1))) {
      post = post.slice(1);
    }
  }
  return { pre, ...(obj !== undefined ? { obj } : {}), ...(post ? { post } : {}) };
}

// todo_write 的状态是 coworker/tools/todo.py 的固定词汇（completed 是模型常用的别名）。
// 词汇外的值原样显示 —— 那是模型给的。Map 而不是对象：避免 "constructor" 这类键命中原型。
const TODO_STATUS = new Map<string, ParseKeys>([
  ["pending", "humanize.step.todo_status.pending"],
  ["in_progress", "humanize.step.todo_status.in_progress"],
  ["done", "humanize.step.todo_status.done"],
  ["completed", "humanize.step.todo_status.completed"],
]);

// send_message targets are "platform:chat" or "platform:chat:thread" — show the platform
// by name and the last human-ish segment of the chat id.
function messageTarget(target: string): { platform: string; tail: string } {
  const [platform, ...rest] = String(target).split(":");
  const chat = rest[0] || "";
  const tail = chat.includes("/") ? chat.split("/").pop() || chat : chat;
  const names: Record<string, string> = { slack: "Slack", telegram: "Telegram" };
  return { platform: names[platform] || platform, tail };
}

export function humanizeTool(name: string, args: any): HumanLine {
  const a = args && typeof args === "object" ? args : {};
  const t = tr();
  switch (name) {
    case "run_shell": {
      const cmd = trunc(String(a.command ?? ""), 60);
      const desc = typeof a.description === "string" && a.description.trim() ? a.description.trim() : "";
      const pre = a.run_in_background ? t("humanize.step.started_background") : t("humanize.step.ran");
      return line(pre, cmd, desc ? t("humanize.sep") + lowerFirstAscii(desc) : undefined);
    }
    case "shell_task_output":
      return line(t("humanize.step.checked_background"));
    case "shell_task_kill":
      return line(t("humanize.step.stopped_background"));
    case "read_file":
      return line(t("humanize.step.read"), baseName(String(a.path ?? t("humanize.a_file"))));
    case "write_file":
      return line(t("humanize.step.wrote"), baseName(String(a.path ?? t("humanize.a_file"))));
    case "replace_in_file":
    case "apply_patch":
    case "apply_unified_diff":
      return line(t("humanize.step.edited"), a.path ? baseName(String(a.path)) : t("humanize.files"));
    case "grep":
      return line(t("humanize.step.searched_code"), `“${trunc(String(a.pattern ?? ""), 40)}”`);
    case "git_log":
      return line(t("humanize.step.git_history"));
    case "todo_write": {
      // `todos` is current; `items` renders histories from before the rename (the old
      // key breaks Together's GLM-5.2 chat template — see coworker/tools/todo.py).
      const items = Array.isArray(a.todos) ? a.todos : Array.isArray(a.items) ? a.items : [];
      if (items.length === 1) {
        const it = items[0] || {};
        const raw = String(it.status || "");
        const key = TODO_STATUS.get(raw);
        const status = key ? t(key) : raw.replace(/_/g, " ");
        return line(
          t("humanize.step.plan_updated"),
          `“${trunc(String(it.content ?? ""), 70)}”`,
          status ? ` → ${status}` : undefined,
        );
      }
      return line(t("humanize.step.plan_updated_n", { n: items.length }));
    }
    case "send_message": {
      const { platform, tail } = messageTarget(String(a.target ?? ""));
      if (!tail) return line(t("humanize.step.sent_message"));
      return line(t("humanize.step.sent_platform_message_to", { platform }), tail);
    }
    case "web_search":
      return line(t("humanize.step.searched_web"), `“${trunc(String(a.query ?? ""), 60)}”`);
    case "web_fetch": {
      let host = String(a.url ?? "");
      try {
        host = new URL(host).host || host;
      } catch {
        /* keep raw */
      }
      return line(t("humanize.step.read_web_page"), trunc(host, 50));
    }
    case "explore":
      return line(t("humanize.step.explore"), `“${trunc(String(a.task ?? a.prompt ?? ""), 60)}”`);
    case "load_skill":
      // SKILLS-SPEC §4.1 #4 — the trust line: the transcript always shows the moment a
      // skill's instructions were picked up, model-invoked or forced via /skill.
      return line(t("humanize.step.used_skill"), String(a.name ?? ""));
    case "ask_user":
      return line(t("humanize.step.asked_you"));
    case "propose_plan":
      return line(t("humanize.step.proposed_plan"));
    case "request_directory":
      return line(t("humanize.step.asked_folder"), String(a.path ?? ""));
    default: {
      const rest = trunc(shortArgs(a), 80);
      return line(t("humanize.step.used_tool") + name, undefined, rest ? t("humanize.sep") + rest : undefined);
    }
  }
}

// The approval card's headline (§35): the ask, phrased as the action being decided.
// run_shell leads with the model's own description ("Run a command — fetch stock data").
export function humanizeApprovalTitle(name: string, args: any): HumanLine {
  const a = args && typeof args === "object" ? args : {};
  const t = tr();
  switch (name) {
    case "write_file":
      return line(t("humanize.title.write"), baseName(String(a.path ?? t("humanize.a_file"))));
    case "replace_in_file":
    case "apply_patch":
    case "apply_unified_diff":
      return line(t("humanize.title.edit"), a.path ? baseName(String(a.path)) : t("humanize.files"));
    // 没有对象的这几条和 §25 授权行说的是同一件事，直接用 approval.verbs.* ——
    // 英文逐字相同，中文也就和卡片其他地方的说法（「执行一条命令」）保持一致。
    case "run_shell": {
      const desc = typeof a.description === "string" && a.description.trim() ? a.description.trim() : "";
      return line(t("approval.verbs.run_command"), undefined, desc ? t("humanize.sep") + lowerFirstAscii(desc) : undefined);
    }
    case "send_message": {
      const { tail } = messageTarget(String(a.target ?? ""));
      return tail ? line(t("humanize.title.send_message_to"), tail) : line(t("approval.verbs.send_message"));
    }
    case "send_file": {
      const { tail } = messageTarget(String(a.target ?? ""));
      return tail ? line(t("humanize.title.send_file_to"), tail) : line(t("approval.verbs.send_file"));
    }
    case "create_scheduled_task":
      return a.title
        ? line(t("humanize.title.create_automation_named"), `“${trunc(String(a.title), 60)}”`)
        : line(t("humanize.title.create_automation"));
    case "save_skill":
      // SKILLS-SPEC §5.2/§7: "Add", never "install"; destination is "your skills".
      return a.name
        ? line(t("humanize.title.add_skill_pre"), String(a.name), t("humanize.title.add_skill_post"))
        : line(t("humanize.title.add_a_skill"));
    // Egress cards (OPE-136 finding 5): name the destination in the headline; the full
    // URL/query renders in the card's expandable preview.
    case "web_fetch": {
      let host = "";
      try {
        host = new URL(String(a.url ?? "")).host;
      } catch {
        /* unparseable url → generic title; the preview still shows the raw string */
      }
      return host ? line(t("humanize.title.fetch_from"), host) : line(t("humanize.title.fetch_page"));
    }
    case "web_search":
      return line(t("humanize.title.search_web"));
    default:
      return line(t("humanize.title.use_tool") + name);
  }
}

// Approvals with no executed tool call (typically declined): the ask, phrased as intent.
export function humanizeAsk(name: string, args: any): HumanLine {
  const a = args && typeof args === "object" ? args : {};
  const t = tr();
  switch (name) {
    case "run_shell":
      return line(t("humanize.ask.run"), trunc(String(a.command ?? ""), 60));
    case "write_file":
      return line(t("humanize.ask.write"), baseName(String(a.path ?? t("humanize.a_file"))));
    case "replace_in_file":
    case "apply_patch":
    case "apply_unified_diff":
      return line(t("humanize.ask.edit"), a.path ? baseName(String(a.path)) : t("humanize.files"));
    case "send_message": {
      const { platform, tail } = messageTarget(String(a.target ?? ""));
      if (!tail) return line(t("humanize.ask.send_message"));
      return line(t("humanize.ask.message_pre"), tail, t("humanize.ask.message_post", { platform }));
    }
    default:
      return line(t("humanize.ask.use_tool") + name);
  }
}
