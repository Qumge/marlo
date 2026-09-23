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
  "transcript.add_credit", // 零余额充值入口：我们 fork 的功能，上游没有
  // 缺技能时先问要不要装（install_skill 的人工闸门）：我们 fork 的功能，上游没有
  "skilloffer.head",
  "skilloffer.from",
  "skilloffer.voice_hint",
  "skilloffer.skip",
  "skilloffer.install",
  "skilloffer.installed",
  "skilloffer.declined",
  "skilloffer.placeholder",
  // 用话回答其他是非卡片（审批 / 连接 / 安装工具 / 文件夹），及只认按钮的例外
  "talk.placeholder_yesno",
  "talk.placeholder_tap",
  "talk.tap_needed",
  // 没登录就发送：就地 Qumge 登录卡（不再跳服务商设置页）
  "signin.head",
  "signin.body",
  "signin.own_key",
  "misc.api.http_error", // 上游 api.ts 里十处 `HTTP ${status}` 兜底报错会上屏（连接/机器卡片）
  // 报错通知按 cause 换成本地化文案（服务端 providers/errors.py 那几句是英文）
  "transcript.error_prefix",
  "transcript.error_cause.no_credit",
  "transcript.error_cause.rate_limited", // 网关 429：模型忙
  "transcript.error_cause.blocked", // qumge.com 边缘防护拦截：只能新开对话
  "access.n_folders", // 文件夹计数：上游这一处不显示数量
  "access.n_folders_one",
  "access.enabled_tap_mute", // 会话内静音的提示：上游措辞不同且没有单独的键
  "app.beta", // BETA 角标：上游没有
  "connector.use_imap_instead", // 邮箱 IMAP 的兜底入口：我们的连接页才有
  "connector.waiting_upstream",
  "connector.n_workspaces_relay",
  "connector.n_workspaces_relay_one",
  // 连接列表的分组（ac6f51a：按用户认得的东西分组）—— 上游没有分组
  "connector.group_mail",
  "connector.group_calendar",
  "connector.group_chat",
  "connector.group_files",
  "connector.group_web",
  "connector.group_other",
  // 连接页与工具服务器那一段：上游把这一页拆成了别的形状
  "integrations.connections_title",
  "integrations.connections_sub",
  "integrations.advanced_tool_servers",
  "integrations.advanced_tool_servers_sub",
  // 首屏第二三张任务卡（写文档 / 整理文件夹）：上游第二三张是 HubSpot 和
  // GitHub→Slack，借它们的键名会误导下一个人
  "intro.task_write_title",
  "intro.task_write_sub",
  "intro.write_prompt",
  "intro.task_tidy_title",
  "intro.task_tidy_sub",
  "intro.tidy_prompt",
  // 侧栏的新运行计数：上游没有这个 badge
  "sidebar.new_runs",
  "sidebar.new_runs_one",
  "sidebar.new_runs_failed_suffix",
  "composer.approvals_inbox_note",
  // 跑着的时候按回车 = 排队（owner 2026-09-16 中途打的一整句被静默吞了）。
  // 上游那条路只有「停止」，没有排队这回事，所以这三句是我们自己的
  "composer.queue.waiting",
  "composer.queue.cancel",
  "composer.queue.send_label",
  // 用量 chip 的明细（c6c5ee5 先把余额说清楚，再等 402）—— 上游整个没有 usage 命名空间
  "usage.unknown_model",
  "usage.chip_title_bar",
  "usage.chip_title_plain",
  "usage.of_window",
  "usage.in_context_now",
  "usage.uncached_input",
  "usage.cache_reads",
  "usage.cache_writes",
  "usage.total_input",
  "usage.input",
  "usage.output",
  "usage.n_tokens",
  // 上手引导里 Qumge 那条路（c692203：首屏是连 Qumge，不是厂商画廊）
  "onboarding.lede",
  "onboarding.signin_body",
  "onboarding.connected_qumge",
  "onboarding.use_own_key",
  "onboarding.connect_qumge",
  "onboarding.signed_in",
  // 设备称呼跟着平台走（f1d0ea6）
  "onboarding.this_mac",
  "onboarding.this_computer",
  "manage.device_code_hint", // 我们自己的设备码流程
  // Qumge 网关的模型浏览器（4c3a256 / 1628a10 / 1be6373）—— 上游没有
  "gateway.vision",
  "gateway.search",
  "gateway.selected",
  "gateway.offline",
  "gateway.others",
  "gateway.partial",
  "gateway.partial_of",
  "gateway.searching",
  "gateway.no_match",
  // 模型家族下拉（Bedrock / Vertex）—— 上游没有
  "models.family_label",
  "models.family_claude",
  "models.family_gemini",
  "models.family_openweight",
  "models.family_other",
  // 上下文压缩的设置面板：上游有这个功能，但没有这一屏的文案
  "settings.compaction_title",
  "settings.compaction_help",
  "settings.compact_at",
  "settings.compact_pct_suffix",
  "settings.compact_or_at",
  "settings.compact_tokens_suffix",
  "settings.compaction_cap_help",
  "settings.summarizer_model",
  "settings.summarizer_default",
  "settings.summarizer_help",
  // 侧边栏与会话位置那两段
  "settings.sidebar_title",
  "settings.sidebar_show_more_note",
  "settings.location_saved",
  "settings.location_bad",
  "settings.personas_title",
  "settings.project_allowances",
  "settings.voice_mic_works",
  "settings.voice_record_phrase",
  "settings.enable_auto_approve", // 上游这句没包进 t()
  "manage.granola_label", // Granola 连接器：上游没有
  "manage.granola_blurb",
  "personas.installed_n", // 「已安装 N 个」那条：上游没有
  // humanize.ts 的步骤行 / 审批标题 / 被拒的请求：上游这三个函数写死英文、没进 t()，
  // 中文界面上审批卡片一直显示 "Run a command — …"（check_i18n.py 只扫 .tsx 看不见）
  "humanize.sep",
  "humanize.a_file",
  "humanize.files",
  "humanize.step.ran",
  "humanize.step.started_background",
  "humanize.step.checked_background",
  "humanize.step.stopped_background",
  "humanize.step.read",
  "humanize.step.wrote",
  "humanize.step.edited",
  "humanize.step.searched_code",
  "humanize.step.git_history",
  "humanize.step.plan_updated",
  "humanize.step.plan_updated_n",
  "humanize.step.todo_status.pending",
  "humanize.step.todo_status.in_progress",
  "humanize.step.todo_status.done",
  "humanize.step.todo_status.completed",
  "humanize.step.sent_message",
  "humanize.step.sent_platform_message_to",
  "humanize.step.searched_web",
  "humanize.step.read_web_page",
  "humanize.step.explore",
  "humanize.step.used_skill",
  "humanize.step.asked_you",
  "humanize.step.proposed_plan",
  "humanize.step.asked_folder",
  "humanize.step.used_tool",
  "humanize.title.write",
  "humanize.title.edit",
  "humanize.title.send_message_to",
  "humanize.title.send_file_to",
  "humanize.title.create_automation_named",
  "humanize.title.create_automation",
  "humanize.title.add_skill_pre",
  "humanize.title.add_skill_post",
  "humanize.title.add_a_skill",
  "humanize.title.fetch_from",
  "humanize.title.fetch_page",
  "humanize.title.search_web",
  "humanize.title.use_tool",
  "humanize.ask.run",
  "humanize.ask.write",
  "humanize.ask.edit",
  "humanize.ask.send_message",
  "humanize.ask.message_pre",
  "humanize.ask.message_post",
  "humanize.ask.use_tool",
  // 审批卡片的来源警告：服务端 provenance.py 吐固定词汇的英文，GUI 认出来再翻（provenanceText.ts）
  "humanize.provenance.created",
  "humanize.provenance.downloaded",
  "humanize.provenance.just_now",
  "humanize.provenance.steps_ago_one",
  "humanize.provenance.steps_ago_other",
  // 回放出来的通知（itemsFromMessages.ts）：实时路径早就走 t()，回放这条写死英文 —— 刷新之后
  // 「已中断。」变回 "Interrupted."。check_i18n.py 开始扫 .ts 之后逮到的
  "app.notice.reviewer_paused",
  "app.notice.auto_approve_on",
  "transcript.mcp_failed_generic",
  "transcript.mcp_failed_pre",
  "transcript.mcp_failed_post",
  // 同一批：文件夹权限没更新成功的兜底（useRoots.ts）、Qumge 登录请求失败的兜底（api.qumge.ts）
  "access.roots_update_failed",
  "onboarding.qumge_signin_http_error",
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

  // owner 2026-08-31：Persona/Coworker 这套词跟上游走，不再维护我们自己的说法。
  // 这条拦住的是"又悄悄加回来"——一条只把「同事」改回「角色」（或反过来）的覆盖，
  // 别处一字不差。那种覆盖不会让任何别的测试红，而它带来的是【术语分裂】：设置页
  // 说一个词，侧栏说另一个词，正是 2026-08-31 走查里逐字撞见过的那类问题。
  //
  // 判据是"抹掉术语差别后两边一模一样"。改了措辞的覆盖不受影响（gallery_sub 那条
  // 除了术语还接管了产品名，照样留着）。
  it("carries no override that only swaps the coworker/persona term", () => {
    const norm = (s: string) => s.replace(/同事|角色/g, "·").replace(/[Cc]oworker|[Pp]ersona/g, "·");
    const termOnly = [
      ...Object.keys(flatEnMarlo).filter(
        (k) => k in flatEnBase && norm(flatEnMarlo[k]) === norm(flatEnBase[k]),
      ),
      ...Object.keys(flatZhMarlo).filter(
        (k) => k in flatZhBase && norm(flatZhMarlo[k]) === norm(flatZhBase[k]),
      ),
    ];
    expect(termOnly, "这些覆盖只改了术语 —— 跟上游走，删掉").toEqual([]);
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
