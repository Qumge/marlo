import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { getI18n, useTranslation } from "react-i18next";
import type { ParseKeys } from "i18next";
import type { Attachment, SessionUsage } from "../types";
import { isPdfFile, readFile } from "../attach";
import { ProjectBindMenu } from "./ProjectBindMenu";
import { getSettings, inspectPdf, sessionSkills, type SessionSkillRow } from "../api";
import { formatTokens, totalTokens } from "../usage";
import { Dropdown, type Option } from "./Dropdown";
import { Icon } from "./Icon";
import { Toggle } from "./Toggle";
import {
  cancelDictation,
  getDictationLevel,
  getDictationStatus,
  isTauri,
  startDictation,
  stopDictation,
  type DictationStatus,
} from "../tauri";

// Plan + Custom hidden for this release (owner ask 2026-07-22): Plan's approval flow isn't
// polished enough to ship, and Custom (config.toml auto-allow rules) is a power-user mode
// with no in-app explanation. The server still honors both — a session already in one of
// those modes keeps working; the picker just doesn't offer them.
// "auto" is the legacy wire value for Bypass approvals (server: Mode.BYPASS_APPROVALS) —
// kept so saved sessions and configs keep working. Auto-Approve ("auto-approve") is the
// reviewer mode (spec: reviewed-auto-mode.md); it appears only when the server says the
// feature flag is on, wired in the settings pass — until then the picker omits it.
// `caution` prefixes the label with a warning triangle; `gated` hides the entry unless the
// server's auto_approve flag is on. Picker-local extensions of Dropdown's Option.
// label / description 存的是 i18n 【键】（见下面的注释），所以覆盖掉 Option 里的
// string 类型 —— ParseKeys 让写错的键编译期就红。
type ModeOption = Omit<Option, "label" | "description"> & {
  label: ParseKeys;
  description?: ParseKeys;
  caution?: boolean;
  gated?: boolean;
};

// Bypass approvals uses the server's CANONICAL value "bypass-approvals" (Mode.BYPASS_APPROVALS).
// Marlo 2026-09-15：这里原来是旧写法 "auto"。服务端认 "auto"（Mode._missing_ 映射过去），但
// ready 事件回传的是 Mode.value = "bypass-approvals" —— 按钮按 value 查不到选项，就把原始值
// 原样显示成 "bypass-approvals"。0.8.3 里用户切到完全放手再重连就会看到；对话默认改成完全放手
// 之后，每个新会话都会看到。用服务端回传的那个值，两边就只有一种写法。
// Auto-approve is `gated`: shown only when getSettings().auto_approve is true (Marlo: on by default).
// Labels/descriptions are i18n keys (resolved at render via t()); kept as keys here so the
// module-level constant stays outside the component without losing translation.
const PERMISSION_OPTIONS: ModeOption[] = [
  { value: "discuss", label: "composer.mode.discuss", description: "composer.mode.discuss_desc" },
  { value: "interactive", label: "composer.mode.interactive", description: "composer.mode.interactive_desc" },
  {
    value: "auto-approve",
    label: "composer.mode.auto_approve",
    description: "composer.mode.auto_approve_desc",
    gated: true,
  },
  {
    value: "bypass-approvals",
    label: "composer.mode.auto",
    description: "composer.mode.auto_desc",
    caution: true,
  },
];

// 旧写法 → 标准写法。存量会话、计划卡片（PlanCard 批准并执行发的是 "auto"）、历史里的模式标记
// 都可能带着 "auto"；查选项之前先归一，免得它们又显示成原始值。
const MODE_ALIASES: Record<string, string> = { auto: "bypass-approvals" };

/** The picker's option for a mode value, legacy spellings included. */
export function modeOption(value: string): ModeOption | undefined {
  const canonical = MODE_ALIASES[value] ?? value;
  return PERMISSION_OPTIONS.find((o) => o.value === canonical);
}

/** The picker's label for a mode value ("auto-approve" -> "Auto-approve"). Exported so the
 * transcript's mode markers read the same names the user just chose from. */
export function modeLabel(value: string): string {
  const option = modeOption(value);
  return option ? getI18n().t(option.label) : value;
}

// No hardcoded model fallback: until the server supplies the list (a few seconds after a
// cold app boot), the picker renders a disabled "Loading models…" chip. A baked-in list
// goes stale and silently offers ids the backend never confirmed (caught 2026-07-21).

// Drop the provider prefix for display (anthropic:claude-opus-4-8 → claude-opus-4-8); full id on hover.
const shortModel = (m: string) => (m.includes(":") ? m.split(":").slice(1).join(":") : m);

// Identify an attachment by name + payload size so duplicates (e.g. the same file picked twice,
// or a prefill applied twice) collapse to one chip.
const attKey = (a: Attachment) =>
  a.kind === "text"
    ? `t:${a.name}:${a.text?.length ?? 0}`
    : `${a.kind[0]}:${a.name}:${a.data_url?.length ?? 0}`;
const mergeAttachments = (cur: Attachment[], add: Attachment[]): Attachment[] => {
  const seen = new Set(cur.map(attKey));
  return [...cur, ...add.filter((a) => !seen.has(attKey(a)))].slice(0, 8);
};

interface Props {
  // Worker-pane variant: retain the shared input, attachments and send/stop;
  // omit session rebinding, model changes and global native dictation controls.
  compact?: boolean;
  mode: string;
  model: string;
  models?: string[];
  // Entries of `models` this machine cannot run (a coworker's `models:` list names them
  // regardless, spec §4): shown in the menu with a note, never hidden.
  unavailableModels?: string[];
  // The coworker's own `models:` list when none of it runs here: the "No model" chip
  // names what would work instead of a bare warning.
  wantedModels?: string[];
  modelLabels?: Record<string, string>; // curated display names (raw id when absent)
  // The model is FIXED once the session has history (§17): the picker renders ONLY on a fresh
  // session; after the first turn the fact lives in the topbar subtitle (§22) — no
  // interactive-then-disabled control.
  running: boolean;
  // A proposal gate (team/items) is awaiting the user: the engine is suspended,
  // so `running` is true — but typing must stay possible, because a typed reply
  // IS an answer (decline-with-feedback). Unblocks Send while the gate is up.
  gateOpen?: boolean;
  // 等待中的卡片自己的提示语（技能卡：「说『装吧』或『先不用』…」）；不给就用提案卡那句。
  gatePlaceholder?: string;
  connected: boolean;
  // False when the default model's provider has no key — the composer shows a "connect a model"
  // banner and routes sends to setup (preserving the draft) instead of dropping them.
  modelReady?: boolean;
  onConnectModel?: () => void;
  // False when the active Qumge model's account has zero credit — keeps the draft
  // and shows the top-up card instead of sending. Undefined = not applicable or not
  // known (BYO-key provider, offline, older sidecar) and never gates.
  canSpend?: boolean;
  onTopUp?: () => void;
  // Rendered above the input when canSpend === false. Passed in rather than built
  // here so Composer stays ignorant of Qumge — it only knows "gated / not gated".
  topUpSlot?: ReactNode;
  // Marlo：没登录 Qumge 时按发送，不跳去服务商设置页，而是在输入框上方就地弹这张
  // 登录卡；草稿留着，登录好（modelReady 变 true）自动发出去。不给就走 onConnectModel。
  signInSlot?: ReactNode;
  onConfigureVoiceInput?: () => void;
  onSend: (text: string, attachments?: Attachment[], skill?: string) => void;
  // Feeds the "/" force-run popup (SKILLS-SPEC §4.1 #3): the popup lists this session's
  // effective skill menu. Absent (e.g. tests without sessions) → the popup never opens.
  sessionId?: string;
  onInterrupt: () => void;
  onModeChange: (mode: string) => void;
  // §11.6: a team worker has no mode of its own — approvals follow its lead. Renders a
  // read-only chip in place of the Mode menu.
  followsLead?: boolean;
  onModelChange: (model: string) => void;
  // When set (Code/Cowork), the Mode menu is shown. The folder/roots + branch controls left the
  // composer for the Session settings drawer (§22) — folder access is standing session config.
  workspace?: string;
  // Unattended / send-approvals-to-Inbox — folded into the Mode menu (§22): "who approves, and
  // when" is one mental model. Absent handler = no toggle (e.g. Chat).
  unattended?: boolean;
  onUnattendedChange?: (on: boolean) => void;
  // The pending-approval card rendered above the input (plan / work-items / team / tool /
  // folder requests). Attended sessions only — Unattended parks the prompt in the Inbox.
  approvalSlot?: ReactNode;
  statusSlot?: ReactNode;
  teamSlot?: ReactNode;
  // UX-044: "View & edit…" in the Project memory submenu routes to the memory panel.
  onOpenMemory?: () => void;
  // Push text + attachments into the composer (e.g. a start-panel task card). The `nonce` makes
  // repeated identical prefills re-apply; the user can still edit before sending.
  prefill?: { text: string; attachments?: Attachment[]; nonce: number };
  // Changes when the active conversation changes; clears any unsent draft.
  resetKey?: string;
  // Surface-specific hint shown in the empty textarea.
  placeholder?: string;
  // Per-session token usage (OPE-42) — absent/empty hides the usage chip entirely
  // (older servers, backends that don't report usage, fresh sessions).
  usage?: SessionUsage;
  // Context-window size (tokens) of the ACTIVE model, from the curated matrix;
  // undefined hides the fill meter (unverified/custom models) but keeps the counts.
  contextWindow?: number;
  // Settings toggle (default off): true shows the fill bar instead of the session total.
  contextBar?: boolean;
  // §8.4 breaker tripped this turn: the mode chip says so quietly until the turn ends
  // or an ask_user answer resets the streak.
  reviewerPaused?: boolean;
}

// 排队中的一条消息 —— 就是 onSend 的三个参数，外加一个 id 和当初选中的技能行。
// 存整行（而不只是 name）是为了「取消」能把 /前缀 还原成【选中的技能】，而不是
// 一串看着像技能、实际只是普通文字的东西。
type Queued = {
  id: number;
  body: string;
  attachments: Attachment[];
  skill?: string;
  skillRow: SessionSkillRow | null;
  // 入队时是哪个会话。换会话的那一次渲染里，「清空草稿」的 effect 和下面的出队
  // effect 在【同一个 commit】里跑：清空排在前面，但出队那个 effect 闭包里的
  // queued 仍是旧值，于是上一个会话的消息会被发进新会话（实测红过一次）。
  // 谁的就只发给谁 —— 这个字段是判据，不靠 effect 的先后顺序。
  resetKey?: string;
};

export function Composer(props: Props) {
  const { t } = useTranslation();
  const [text, setText] = useState("");
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  // 一轮还在跑的时候按回车，草稿搬到这里等着，而不是被 submit() 开头那个 return
  // 悄悄吃掉（owner 2026-09-16：中途打了一整句，回车，界面上什么都没发生，字没了）。
  // 是个【数组】：第二次回车也照样排队 —— 只收一条的话，第二条又会被吞，那正是
  // 这次要修的毛病。
  const [queued, setQueued] = useState<Queued[]>([]);
  const queueSeq = useRef(0);
  // 已经交给 onSend 的那条的 id。StrictMode 下 effect 会跑两遍，光靠 setQueued
  // 清空挡不住第二遍（清空要等下一次渲染）—— 「只发一次」的依据是这个 ref。
  const sentQueueId = useRef(-1);
  // Whether the top-up card is currently interposed in front of the send. Flipped true
  // only by the gate below (an Enter press while canSpend === false) — never derived
  // straight from canSpend, or a zero balance alone would pop the card the moment the
  // user opened the session, which is exactly the standing-banner behaviour §credit
  // gate rejected (the sidebar chip already carries that notice).
  const [gated, setGated] = useState(false);
  // 按了发送但还没登录：显示 signInSlot，等模型就绪后把草稿自动发出去。
  const [awaitingSignIn, setAwaitingSignIn] = useState(false);
  const needSignInOrSetup = () => {
    if (props.signInSlot) setAwaitingSignIn(true);
    else props.onConnectModel?.();
  };

  // 充值回来（canSpend 不再是 false）或者草稿被清空（发出去了/换会话了），
  // 这张卡片就没有理由继续占着位置。
  useEffect(() => {
    if (props.canSpend !== false || !text.trim()) setGated(false);
  }, [props.canSpend, text]);
  // "/" force-run (SKILLS-SPEC §4.1 #3). The popup derives from the draft: it is open while
  // the text is a bare "/query" (no whitespace yet) and no skill is picked. Selecting a row
  // inserts "/name " INLINE in the box (Claude-Code style — the slash text IS the state);
  // the user keeps typing after it, and on send the prefix is stripped while the skill name
  // rides the user_message as its own field. Editing the prefix away un-picks the skill.
  const [pendingSkill, setPendingSkill] = useState<SessionSkillRow | null>(null);
  const [slashSkills, setSlashSkills] = useState<SessionSkillRow[] | null>(null);
  const [slashIndex, setSlashIndex] = useState(0);
  const prefixIntact =
    pendingSkill !== null &&
    (text === `/${pendingSkill.name}` || text.startsWith(`/${pendingSkill.name} `));
  useEffect(() => {
    if (pendingSkill && !prefixIntact) setPendingSkill(null);
  }, [pendingSkill, prefixIntact]);
  const slashQuery =
    !prefixIntact && props.sessionId && text.startsWith("/") && !/\s/.test(text.slice(1))
      ? text.slice(1).toLowerCase()
      : null;
  const slashMatches = (slashSkills ?? []).filter((s) =>
    s.name.toLowerCase().includes(slashQuery ?? ""),
  );
  useEffect(() => {
    // Fetch on each popup open (fresh menu); drop when closed.
    if (slashQuery === null) {
      setSlashSkills(null);
      setSlashIndex(0);
      return;
    }
    if (slashSkills === null && props.sessionId) {
      sessionSkills(props.sessionId, props.workspace)
        .then((all) => setSlashSkills(all.filter((s) => s.enabled)))
        .catch(() => setSlashSkills([]));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [slashQuery === null]);
  const pickSkill = (s: SessionSkillRow) => {
    setPendingSkill(s);
    setText(`/${s.name} `);
    textareaRef.current?.focus();
  };
  const [dragging, setDragging] = useState(false);
  const [attachMenuOpen, setAttachMenuOpen] = useState(false);
  // UX-044: which "This session" submenu is open (bindings live server-side).
  const [bindMenu, setBindMenu] = useState<"memory" | "board" | null>(null);
  // Bindings need a session and a workspace surface (Chat has neither).
  const sessionRows = !props.compact && Boolean(props.sessionId && props.workspace !== undefined);
  const bindRow = (icon: "book" | "table", label: string, kind: "memory" | "board") => (
    <button
      className={
        "w-full flex items-center gap-2.5 px-3 py-1.5 text-ui text-left hover:bg-paper" +
        (bindMenu === kind ? " bg-paper" : "")
      }
      onClick={() => setBindMenu(bindMenu === kind ? null : kind)}
    >
      <Icon name={icon} size={15} className="shrink-0 text-muted" />
      <span className="flex-1">{label}</span>
      <Icon name="chevronRight" size={12} className="shrink-0 text-faint" />
    </button>
  );
  const [dictation, setDictation] = useState<DictationStatus | null>(null);
  const [dictationBusy, setDictationBusy] = useState<string | null>(null);
  const [dictationError, setDictationError] = useState<string | null>(null);
  const [recordingSeconds, setRecordingSeconds] = useState(0);
  const [attachNotice, setAttachNotice] = useState<string | null>(null);
  const fileInput = useRef<HTMLInputElement | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const noticeTimer = useRef<number | null>(null);

  // Rejected-attachment notice: visible ~8s, then clears (or on ✕).
  const showAttachNotice = (message: string) => {
    setAttachNotice(message);
    if (noticeTimer.current) window.clearTimeout(noticeTimer.current);
    noticeTimer.current = window.setTimeout(() => setAttachNotice(null), 8000);
  };

  useLayoutEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    // The cap must include the vertical PADDING: scrollHeight does, so a
    // padding-blind cap left the box ~20px short and scrolled the top padding
    // (plus the first line) out of the clip while typing (OPE-106). Six lines —
    // team briefs outgrew four.
    const cs = getComputedStyle(el);
    const pad =
      (parseFloat(cs.paddingTop) || 0) + (parseFloat(cs.paddingBottom) || 0);
    const max = (parseFloat(cs.lineHeight) || 22) * 6 + pad;
    const next = Math.min(el.scrollHeight, max);
    el.style.height = `${Math.max(next, 24)}px`;
    el.style.overflowY = el.scrollHeight > max ? "auto" : "hidden";
  }, [text]);

  // Clear the draft when the conversation changes, so a half-typed message / picked file doesn't
  // bleed from one session into another. Declared BEFORE the prefill effect: when both fire in
  // the same render (the Skills doorway starts a new session AND prefills it), effects run in
  // declaration order — clear first, then the prefill lands on the fresh session.
  useEffect(() => {
    setText("");
    setAttachments([]);
    setPendingSkill(null);
    // 排队的消息同理：它是对【那个】会话说的，不能跟着跑到下一个会话里去发出来。
    setQueued([]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.resetKey]);

  // Apply a prefill (text + attachments) pushed from outside, then focus the composer. Applied at
  // most once per nonce (a ref guards against StrictMode/re-render double-fires), and attachments
  // are de-duplicated so the same file never lands twice.
  useEffect(() => {
    const p = props.prefill;
    if (!p) return;
    // No once-per-nonce ref guard: StrictMode's dev double-effect re-runs the
    // clear above AFTER a guarded prefill had applied, leaving the composer
    // empty. Re-applying is safe — setText is idempotent and the attachment
    // merge de-duplicates — and the [nonce] dep still scopes when this fires.
    setText(p.text);
    if (p.attachments?.length) setAttachments((cur) => mergeAttachments(cur, p.attachments!));
    textareaRef.current?.focus();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.prefill?.nonce]);

  // Dictation is intentionally native-only: the browser/dev build remains a local server client
  // and never turns on the browser microphone or ships audio anywhere.
  useEffect(() => {
    if (props.compact || !isTauri()) return;
    const refresh = (event?: Event) => {
      const supplied = (event as CustomEvent<DictationStatus> | undefined)?.detail;
      if (supplied) {
        setDictation(supplied);
        return;
      }
      void getDictationStatus().then((status) => status && setDictation(status));
    };
    refresh();
    window.addEventListener("coworker:voice-input-changed", refresh);
    return () => window.removeEventListener("coworker:voice-input-changed", refresh);
  }, []);

  useEffect(() => {
    if (!dictation?.recording) {
      setRecordingSeconds(0);
      return;
    }
    const started = Date.now();
    const timer = window.setInterval(() => {
      setRecordingSeconds(Math.floor((Date.now() - started) / 1000));
    }, 250);
    return () => window.clearInterval(timer);
  }, [dictation?.recording]);

  // Live waveform: poll mic loudness at ~10Hz while recording; the bars scroll left so the
  // trace reads as a real input meter (owner catch on DMG #28 — the first cut's bars were
  // decorative constants and read as fake).
  const [levels, setLevels] = useState<number[]>([]);
  useEffect(() => {
    if (!dictation?.recording) {
      setLevels([]);
      return;
    }
    const timer = window.setInterval(() => {
      getDictationLevel().then((level) => {
        if (typeof level === "number") setLevels((cur) => [...cur.slice(-13), level]);
      });
    }, 100);
    return () => window.clearInterval(timer);
  }, [dictation?.recording]);

  useEffect(() => {
    if (!dictation?.recording) return;
    const cancelOnEscape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      void cancelDictation()
        .catch(() => undefined)
        .finally(() => {
          void getDictationStatus().then((status) => status && setDictation(status));
        });
    };
    window.addEventListener("keydown", cancelOnEscape);
    return () => window.removeEventListener("keydown", cancelOnEscape);
  }, [dictation?.recording]);

  const voiceReady = !!dictation?.supported && !!dictation?.model_verified && !!dictation?.test_passed;
  const recordingTime = `${Math.floor(recordingSeconds / 60)}:${String(recordingSeconds % 60).padStart(2, "0")}`;

  // Attach-time PDF thresholds (Settings → Token savings): a PDF over the user's page or
  // size limit is REJECTED with a visible notice — never attached, never silently dropped.
  // The rationale is token cost: a big PDF re-rides every turn of the conversation.
  const addFiles = async (files: FileList | File[]) => {
    const list = Array.from(files);
    let maxPages = 20;
    let maxMb = 10;
    if (list.some(isPdfFile)) {
      try {
        const s = await getSettings();
        if (s.pdf_max_pages) maxPages = s.pdf_max_pages;
        if (s.pdf_max_mb) maxMb = s.pdf_max_mb;
      } catch {
        /* offline settings fetch — fall back to defaults */
      }
    }
    const accepted: File[] = [];
    for (const file of list) {
      if (isPdfFile(file) && file.size > maxMb * 1024 * 1024) {
        showAttachNotice(
          t("composer.pdf_too_big", { name: file.name, mb: (file.size / 1024 / 1024).toFixed(1), limit: maxMb }),
        );
        continue;
      }
      accepted.push(file);
    }
    const read = (await Promise.all(accepted.map(readFile))).filter(Boolean) as Attachment[];
    const next: Attachment[] = [];
    for (const a of read) {
      if (a.kind === "pdf" && a.data_url) {
        const info = await inspectPdf(a.data_url).catch(() => null);
        if (info?.ok && (info.pages ?? 0) > maxPages) {
          showAttachNotice(
            t("composer.pdf_too_many_pages", { name: a.name, pages: info.pages, limit: maxPages }),
          );
          continue;
        }
        if (info && !info.ok) {
          showAttachNotice(t("composer.pdf_unreadable", { name: a.name, error: info.error || t("composer.pdf_could_not_read") }));
          continue;
        }
      }
      next.push(a);
    }
    if (next.length) setAttachments((a) => mergeAttachments(a, next));
  };

  // The "+" menu offers typed shortcuts; each just narrows the OS picker's filter.
  const pickFiles = (accept: string) => {
    setAttachMenuOpen(false);
    if (fileInput.current) {
      fileInput.current.accept = accept;
      fileInput.current.click();
    }
  };

  const needsModel = props.modelReady === false;

  // 把排队的那条原样放回输入框。草稿里已经有东西就放在【前面】另起一行 ——
  // 这次修的就是"文字不见了"，修法本身不能又开出一个弄丢文字的口子。
  const restoreToDraft = (q: Queued) => {
    const line = q.skill ? `/${q.skill} ${q.body}` : q.body;
    setText((cur) => (cur.trim() ? `${line}\n${cur}` : line));
    setAttachments((cur) => mergeAttachments(cur, q.attachments));
    setPendingSkill((cur) => cur ?? q.skillRow);
    textareaRef.current?.focus();
  };

  const cancelQueued = (q: Queued) => {
    setQueued((cur) => cur.filter((x) => x.id !== q.id));
    restoreToDraft(q);
  };

  // 停止 = "别再自己往下做了"。这时候把排队的那条发出去，正是用户按停止想拦住的
  // 事情。而且回合一停 running 就变 false，下面那个 effect 会立刻把它发出去 ——
  // 所以必须在这里先接住。退回输入框：字还在、看得见、能改，要发得他自己再按一次。
  const stopRun = () => {
    if (queued.length) {
      for (const q of [...queued].reverse()) restoreToDraft(q);
      setQueued([]);
    }
    props.onInterrupt();
  };

  // 队列出口。回合结束（running 落回 false）时发出队首那条 —— 但闸门要在【发出去
  // 的这一刻】重新问一遍：排队时连着、有模型、有余额，不代表现在还是。
  useEffect(() => {
    const q = queued[0];
    if (!q || q.id === sentQueueId.current) return;
    if (q.resetKey !== props.resetKey) return; // 换会话了 —— 清空那个 effect 已经在路上
    if (props.running) return; // 这一轮还在跑，接着等
    if (dictation?.recording || dictationBusy) return; // 人正对着麦克风说话，等他说完
    if (!props.connected) return; // 断线：留在队列里，连上了这个 effect 自己会再跑
    // 下面两条和 submit() 里是同一个处置：不发，把草稿还给用户，并把他送到该去的地方。
    if (needsModel) {
      setQueued((cur) => cur.filter((x) => x.id !== q.id));
      restoreToDraft(q);
      needSignInOrSetup();
      return;
    }
    if (props.canSpend === false) {
      setQueued((cur) => cur.filter((x) => x.id !== q.id));
      restoreToDraft(q);
      setGated(true);
      props.onTopUp?.();
      return;
    }
    sentQueueId.current = q.id;
    setQueued((cur) => cur.filter((x) => x.id !== q.id));
    props.onSend(q.body, q.attachments, q.skill);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    queued,
    props.resetKey,
    props.running,
    props.connected,
    props.canSpend,
    needsModel,
    dictation?.recording,
    dictationBusy,
  ]);

  // 登录好了（模型就绪）：收起登录卡，把用户刚才那句话自动发出去 —— 他不该再按一次。
  useEffect(() => {
    if (!awaitingSignIn || needsModel) return;
    setAwaitingSignIn(false);
    if (text.trim() || attachments.length > 0) submit();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [awaitingSignIn, needsModel]);

  const submit = () => {
    // While the "/" popup is open the draft is a query, not a message — never send it.
    if (slashQuery !== null) return;
    // The visible "/name " prefix is UI state, not message text — strip it for the send;
    // the skill rides as its own field. (Named `body`, not `t`, so it can't shadow i18n's t.)
    const skill = prefixIntact ? pendingSkill!.name : undefined;
    const body = (skill ? text.slice(skill.length + 1) : text).trim();
    // 断线且没在跑：发不出去，留着草稿（上游 guard）。在跑的时候断线不拦 —— 排进队列，
    // 连上了队列 effect 自己会发（见上面 `if (!props.connected) return`）。
    if (
      (!props.connected && !props.running) ||
      (!body && attachments.length === 0 && !skill) ||
      dictation?.recording ||
      dictationBusy
    )
      return;
    // 一轮还在跑（而且不是在等审批 —— 那条路下面照旧立刻发）：排队。附件和 /技能
    // 原样跟着走，因为它们就是 onSend 的另外两个参数，搬过去不比搬文字难。
    if (props.running && !props.gateOpen) {
      queueSeq.current += 1;
      setQueued((cur) => [
        ...cur,
        {
          id: queueSeq.current,
          body,
          attachments,
          skill,
          skillRow: pendingSkill,
          resetKey: props.resetKey,
        },
      ]);
      setText("");
      setAttachments([]);
      setPendingSkill(null);
      return;
    }
    // No model connected: keep the draft (don't drop it) and send the user to setup instead.
    if (needsModel) {
      needSignInOrSetup();
      return;
    }
    // Credit gate. AFTER needsModel on purpose: with no model connected, talking
    // about money answers a question the user has not reached yet.
    //
    // Flipping `gated` here — rather than deriving the card's visibility from
    // canSpend alone — is what makes this an interception instead of a banner.
    // A zero balance is not itself a reason to interrupt someone who has not
    // asked for anything yet; the sidebar chip already carries that standing
    // notice. The card earns its interruption at the moment the user commits
    // to a request, with the request still on screen.
    if (props.canSpend === false) {
      setGated(true);
      props.onTopUp?.();
      return;
    }
    props.onSend(body, attachments, skill);
    setText("");
    setAttachments([]);
    setPendingSkill(null);
  };

  const onKey = (e: React.KeyboardEvent) => {
    if (slashQuery !== null) {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setSlashIndex((i) => Math.min(i + 1, Math.max(slashMatches.length - 1, 0)));
        return;
      }
      if (e.key === "ArrowUp") {
        e.preventDefault();
        setSlashIndex((i) => Math.max(i - 1, 0));
        return;
      }
      if (e.key === "Escape") {
        e.preventDefault();
        setText("");
        return;
      }
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        const chosen = slashMatches[slashIndex];
        if (chosen) pickSkill(chosen);
        return;
      }
    }
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      submit();
    }
  };

  const onPaste = (e: React.ClipboardEvent) => {
    const imgs = Array.from(e.clipboardData.items)
      .filter((it) => it.kind === "file" && it.type.startsWith("image/"))
      .map((it) => it.getAsFile())
      .filter(Boolean) as File[];
    if (imgs.length) {
      e.preventDefault();
      addFiles(imgs);
    }
  };

  const toggleDictation = async () => {
    if (!isTauri() || dictationBusy) return;
    setDictationError(null);
    try {
      if (dictation?.recording) {
        setDictationBusy(t("composer.starting_transcribe"));
        const transcript = await stopDictation();
        if (transcript === null) throw new Error(t("composer.err_transcribe"));
        if (transcript.trim()) {
          setText((draft) => (draft.trim() ? `${draft.trimEnd()} ${transcript.trim()}` : transcript.trim()));
        }
        setDictation(await getDictationStatus());
        textareaRef.current?.focus();
        return;
      }

      const status = dictation || (await getDictationStatus());
      if (!status) throw new Error(t("composer.err_dictation_unavailable"));
      if (!status.supported || !status.model_verified || !status.test_passed) {
        props.onConfigureVoiceInput?.();
        return;
      }
      setDictationBusy(t("composer.starting_mic"));
      const recording = await startDictation();
      if (!recording?.recording) throw new Error(t("composer.err_mic_start"));
      setDictation(recording);
    } catch (error) {
      setDictationError(error instanceof Error ? error.message : t("composer.err_dictation_unavailable"));
      const status = await getDictationStatus();
      if (status) setDictation(status);
    } finally {
      setDictationBusy(null);
    }
  };

  const modelsLoaded = !!(props.models && props.models.length);
  const modelOptions: Option[] = Array.from(
    new Set([props.model, ...(props.models || [])]),
  ).map((m) => ({
    value: m,
    label: props.modelLabels?.[m] || shortModel(m),
    ...(props.unavailableModels?.includes(m)
      ? { description: t("onmachine.composer.model_unavailable") }
      : {}),
  }));

  const iconBtn =
    "w-7 h-7 grid place-items-center rounded-md text-faint hover:text-ink hover:bg-paper shrink-0";

  // UX-048: the model pill shows the model NAME; provider and the context line live in its
  // tooltip. Curated labels read "Claude Sonnet 4.6 · Anthropic" — the part before the dot is
  // the name (same split the old header subtitle used). The context ring (OPE-42 meter, now
  // inside the pill) needs a known window; the setting governs the ring, never the tooltip.
  const fullModelLabel = props.modelLabels?.[props.model] || shortModel(props.model);
  const modelName = fullModelLabel.split(" · ")[0];
  const hasUsage = !!props.usage && totalTokens(props.usage) > 0;
  const ctxPct =
    hasUsage && props.contextWindow
      ? Math.min(100, Math.round((props.usage!.context / props.contextWindow) * 100))
      : null;
  const ctxLine = !hasUsage
    ? ""
    : ctxPct !== null
      ? t("onmachine.composer.context_line", {
          pct: ctxPct,
          used: formatTokens(props.usage!.context),
          window: formatTokens(props.contextWindow as number),
        })
      : t("onmachine.composer.context_unknown", { used: formatTokens(props.usage!.context) });
  const providerName =
    fullModelLabel.split(" · ")[1] ||
    (props.model.includes(":") ? props.model.split(":")[0] : "");
  const modelTip = (
    <>
      <div className="dd-tip-title">{modelName}</div>
      {providerName && <div className="dd-tip-sub">{providerName}</div>}
      <div className="dd-tip-row">
        <ContextRing pct={ctxPct} size={14} />
        <span>{ctxLine || t("onmachine.composer.no_usage")}</span>
      </div>
      <div className="dd-tip-hint">{t("onmachine.composer.click_change_model")}</div>
    </>
  );

  // The send button is accent only when there's something to send — subtle grey otherwise, so the
  // composer isn't carrying a constant blue dot.
  // A pinned /skill is sendable content on its own (tester catch 2026-07-26: the arrow
  // stayed grey after picking a skill, reading as "stuck").
  const hasContent = text.trim().length > 0 || attachments.length > 0 || !!pendingSkill;
  const sendBtnClass = (active: boolean) =>
    "w-7 h-7 rounded-full grid place-items-center shrink-0 transition-colors " +
    (active ? "bg-accent text-white hover:brightness-105" : "bg-paper border border-line text-faint");
  const sendArrow = (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M12 19V5M5 12l7-7 7 7" />
    </svg>
  );

  return (
    <div className="composer-wrap px-6 pb-5 pt-4">
      {props.statusSlot && <div className="max-w-3xl mx-auto mb-3">{props.statusSlot}</div>}
      {props.approvalSlot}

      {dictationError && (
        <div className="max-w-3xl mx-auto mb-2 px-1 text-meta text-red-600" role="alert">
          {dictationError}
        </div>
      )}

      {/* Rejected-attachment notice (PDF over the user's Token-savings thresholds). */}
      {attachNotice && (
        <div
          data-testid="attach-notice"
          className="max-w-3xl mx-auto mb-1.5 flex items-center gap-2 rounded-lg border border-warnInk/30 bg-warnSoft px-3 py-1.5 text-ui text-warnInk"
        >
          <span className="flex-1">{attachNotice}</span>
          <button
            className="shrink-0 opacity-60 hover:opacity-100"
            onClick={() => setAttachNotice(null)}
            title={t("common.dismiss")}
          >
            ✕
          </button>
        </div>
      )}

      {/* 排队中的消息 —— 就摆在输入框正上方。按下回车之后，用户必须【立刻】在
          手边看到那句话去了哪、什么时候发、以及怎么把它要回来。 */}
      {queued.map((q) => {
        const line = ((q.skill ? `/${q.skill} ` : "") + q.body).trim();
        return (
          <div
            key={q.id}
            data-testid="queued-message"
            // 读屏用户按下回车同样得听见"它去哪了"——卡片本身就是那句交代。
            role="status"
            className="max-w-3xl mx-auto mb-1.5 flex items-center gap-2 rounded-lg border border-line bg-paper px-3 py-1.5 text-[13px]"
          >
            <Icon name="clock" size={13} className="shrink-0 text-faint" />
            <span className="shrink-0 text-faint">{t("composer.queue.waiting")}</span>
            <span className="flex-1 min-w-0 truncate text-ink" title={line}>
              {line}
            </span>
            {q.attachments.length > 0 && (
              <span className="shrink-0 max-w-[30%] truncate text-faint">
                {q.attachments.map((a) => a.name).join(", ")}
              </span>
            )}
            <button
              data-testid="queued-cancel"
              className="shrink-0 opacity-60 hover:opacity-100"
              onClick={() => cancelQueued(q)}
              title={t("composer.queue.cancel")}
              aria-label={t("composer.queue.cancel")}
            >
              ✕
            </button>
          </div>
        );
      })}

      {/* Attachments preview — a strip ABOVE the input box (mock/Claude-style). */}
      {attachments.length > 0 && (
        <div className="max-w-3xl mx-auto mb-1.5 flex flex-wrap gap-2">
          {attachments.map((a, i) => (
            <AttachChip key={i} a={a} onRemove={() => setAttachments((all) => all.filter((_, j) => j !== i))} />
          ))}
        </div>
      )}

      {/* Credit gate card — only interposed after an Enter press while canSpend === false
          (see `gated`), never a standing banner off canSpend alone. */}
      {gated && <div className="max-w-3xl mx-auto">{props.topUpSlot}</div>}
      {awaitingSignIn && needsModel && props.signInSlot && (
        <div className="max-w-3xl mx-auto">{props.signInSlot}</div>
      )}

      {props.teamSlot}
      <div
        className={
          "composer max-w-3xl mx-auto rounded-2xl border border-ink/[0.08] bg-panel shadow-[0_1px_2px_rgba(0,0,0,0.03),0_4px_14px_-10px_rgba(0,0,0,0.08)]" +
          (dragging ? " dragging" : "")
        }
        onDragOver={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragging(false);
          if (e.dataTransfer.files.length) addFiles(e.dataTransfer.files);
        }}
      >
        {/* "/" force-run popup — in-flow above the textarea; rows are the session's
            effective menu only (muted/disabled skills never appear). */}
        {slashQuery !== null && (
          <div className="px-2 pt-2" data-testid="skill-popup" role="listbox" aria-label={t("onmachine.composer.skills_aria")}>
            {slashSkills === null ? (
              <div className="px-2 py-1.5 text-meta text-faint">{t("onmachine.composer.skills_loading")}</div>
            ) : slashMatches.length === 0 ? (
              <div className="px-2 py-1.5 text-meta text-faint">{t("onmachine.composer.skills_none")}</div>
            ) : (
              slashMatches.map((s, i) => (
                <button
                  key={s.name}
                  role="option"
                  aria-selected={i === slashIndex}
                  className={
                    "w-full text-left flex items-center gap-2 px-2 py-1.5 rounded-lg " +
                    (i === slashIndex ? "bg-paper" : "hover:bg-paper")
                  }
                  onMouseEnter={() => setSlashIndex(i)}
                  onClick={() => pickSkill(s)}
                >
                  <span className="text-ui font-medium text-accent shrink-0">/{s.name}</span>
                  <span className="text-meta text-faint truncate flex-1">{s.description}</span>
                  <span className="text-label px-1.5 py-0.5 rounded-full border border-line text-faint shrink-0">
                    {s.scope}
                  </span>
                </button>
              ))
            )}
          </div>
        )}
        <textarea
          aria-label={props.placeholder}
          ref={textareaRef}
          className="w-full block px-3.5 pt-3.5 pb-1.5 text-body"
          placeholder={
            props.gateOpen
              ? props.gatePlaceholder || t("composer.placeholder_gate")
              : props.placeholder || t("composer.placeholder")
          }
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={onKey}
          onPaste={onPaste}
          rows={1}
        />

        {/* Three-control row (§22): + attach · Mode ⌄ …(right)… model (fresh only) · send */}
        <div className="px-2.5 pb-2.5 pt-1 flex items-center gap-1.5">
          {/* + attach menu */}
          <div className="relative">
            <button
              className={iconBtn + (attachMenuOpen ? " bg-paper text-ink" : "")}
              title={t("composer.attach")}
              aria-label={t("composer.attach")}
              onClick={() => setAttachMenuOpen((v) => !v)}
            >
              <Icon name="plus" size={17} />
            </button>
            {attachMenuOpen && (
              <>
                <div
                  className="fixed inset-0 z-30"
                  onClick={() => {
                    setAttachMenuOpen(false);
                    setBindMenu(null);
                  }}
                />
                <div className="absolute z-40 bottom-full mb-1 left-0 min-w-[200px] rounded-xl border border-line bg-panel shadow-2xl py-1.5">
                  {sessionRows && (
                    <div className="px-3 pt-1 pb-0.5 text-[10.5px] font-medium text-faint">
                      {t("composer.attach_this_message")}
                    </div>
                  )}
                  {attachItem("image", t("composer.attach_image"), () => pickFiles("image/*"))}
                  {attachItem("file", "PDF", () => pickFiles("application/pdf,.pdf"))}
                  {attachItem(
                    "fileCode",
                    t("composer.attach_other"),
                    () => pickFiles("text/*,.md,.csv,.json,.yaml,.yml,.log,.py,.ts,.tsx,.js,.rs,.go,.toml"),
                  )}
                  {sessionRows && (
                    <>
                      <div className="my-1 border-t border-line" />
                      <div className="px-3 pt-0.5 pb-0.5 text-[10.5px] font-medium text-faint">
                        {t("composer.attach_this_session")}
                      </div>
                      {bindRow("book", t("composer.bind_memory"), "memory")}
                      {bindRow("table", t("composer.bind_board"), "board")}
                    </>
                  )}
                </div>
                {bindMenu && props.sessionId && (
                  <ProjectBindMenu
                    sessionId={props.sessionId}
                    kind={bindMenu}
                    onClose={() => {
                      setBindMenu(null);
                      setAttachMenuOpen(false);
                    }}
                    onOpenMemory={props.onOpenMemory}
                  />
                )}
              </>
            )}
          </div>
          <input
            ref={fileInput}
            type="file"
            multiple
            style={{ display: "none" }}
            onChange={(e) => {
              if (e.target.files) addFiles(e.target.files);
              e.target.value = "";
            }}
          />

          {/* Listening replaces the quiet middle controls with a LIVE waveform (mic RMS,
              polled ~10Hz, scrolling left) + elapsed time (§37). */}
          {dictation?.recording ? (
            <div className="voice-wave-row flex-1 flex items-center gap-2 ml-1" aria-hidden="true">
              <span className="voice-wave-line" />
              <span className="voice-wave-bars">
                {Array.from({ length: 14 }, (_, index) => {
                  const level = levels[levels.length - 14 + index] ?? 0;
                  return <i key={index} style={{ height: Math.round(4 + level * 24) }} />;
                })}
              </span>
              <span className="text-meta text-muted tabular-nums">{recordingTime}</span>
            </div>
          ) : props.followsLead ? (
            <span
              className="inline-flex items-center gap-1 px-2 py-1 rounded-lg text-meta text-muted shrink-0"
              data-testid="mode-follows-lead"
              title={t("onmachine.composer.follows_lead_title")}
            >
              {t("onmachine.composer.follows_lead")}
            </span>
          ) : props.workspace !== undefined ? (
            <ModeMenu
              reviewerPaused={props.reviewerPaused}
              mode={props.mode}
              onModeChange={props.onModeChange}
              unattended={props.unattended}
              onUnattendedChange={props.onUnattendedChange}
            />
          ) : null}

          {dictationBusy === t("composer.starting_transcribe") && <span className="text-meta text-accent">{dictationBusy}</span>}

          <span className="ml-auto" />

          {/* model — a quiet chip, now for the session's whole life (§17 rev 2026-07-22:
              mid-session switching shipped, so the picker stays actionable; the topbar
              subtitle still states the current model). */}
          {!props.compact && !dictation?.recording && (needsModel ? (
            <button
              className="pill model-warn chip"
              onClick={needSignInOrSetup}
              title={
                props.wantedModels?.length
                  ? t("onmachine.composer.runs_on_models", {
                      models: props.wantedModels.map(shortModel).join(t("onmachine.list_or")),
                    })
                  : t("composer.model.connect")
              }
              aria-label={t("composer.model.none_aria")}
            >
              <span className="pill-label">{t("composer.model.none")}</span>
              <span className="model-warn-ico" aria-hidden>⚠</span>
            </button>
          ) : modelsLoaded ? (
            <Dropdown
              value={props.model}
              options={modelOptions}
              onChange={props.onModelChange}
              align="right"
              displayLabel={modelName}
              tooltip={modelTip}
              leading={
                props.contextBar === true && hasUsage ? (
                  <ContextRing pct={ctxPct} label={ctxLine} testId="usage-chip" />
                ) : null
              }
            />
          ) : (
            <button
              className="pill chip text-faint cursor-default"
              disabled
              data-testid="models-loading"
              title={t("composer.model.loading_title")}
            >
              <span className="pill-label">{t("composer.model.loading")}</span>
            </button>
          ))}

          {/* mic — immediately before send (owner call, DMG #28 walkthrough) */}
          {!props.compact && isTauri() && (
            <button
              className={
                iconBtn +
                (dictation?.recording ? " bg-red-50 text-red-600 hover:bg-red-100" : "") +
                (dictationBusy ? " opacity-60" : "") +
                (!voiceReady && !dictation?.recording ? " opacity-40" : "")
              }
              onClick={() => void toggleDictation()}
              disabled={!!dictationBusy}
              title={
                dictationBusy ||
                (dictation?.recording
                  ? t("composer.voice.stop_transcribe")
                  : voiceReady
                    ? t("composer.voice.start_dictation")
                    : t("composer.voice.configure"))
              }
              aria-label={dictation?.recording ? t("composer.voice.stop_dictation") : voiceReady ? t("composer.voice.start_dictation_btn") : t("composer.voice.configure")}
              aria-disabled={!voiceReady && !dictation?.recording}
            >
              <Icon name={dictation?.recording ? "stop" : "mic"} size={16} />
            </button>
          )}

          {/* send / stop — a pending gate re-opens Send: the reply resolves it.
              跑着的时候，只要框里有东西，发送键就得【在】：按它是排队，不是丢掉。
              一个只剩「停止」的工具栏等于在说"这句现在没地方交"，而用户已经打完了。 */}
          {props.running && !props.gateOpen ? (
            <>
              {hasContent && (
                <button
                  className={sendBtnClass(!dictation?.recording && !dictationBusy)}
                  onClick={submit}
                  disabled={!!dictation?.recording || !!dictationBusy}
                  title={t("composer.queue.send_label")}
                  aria-label={t("composer.queue.send_label")}
                >
                  {sendArrow}
                </button>
              )}
              <button className="btn danger" onClick={stopRun}>
                {t("composer.stop")}
              </button>
            </>
          ) : (
            <button
              className={sendBtnClass(
                hasContent && props.connected && !dictation?.recording && !dictationBusy,
              )}
              onClick={submit}
              disabled={!props.connected || !!dictation?.recording || !!dictationBusy}
              title={needsModel ? t("composer.connect_to_send") : undefined}
              aria-label={t("common.send")}
            >
              {sendArrow}
            </button>
          )}
        </div>
      </div>
      <span className="sr-only" role="status" aria-live="polite">
        {dictation?.recording ? t("composer.listening_sr", { time: recordingTime }) : dictationBusy || ""}
      </span>
    </div>
  );
}

// Context ring (OPE-42 meter, UX-048 placement): a small ring at the left of the model name
// and inside its hover card. Accent arc = context-window fill, warn color from 80%; with no
// known window (custom / Ollama models) the track renders empty. The old popover is gone —
// the hover card carries the figures.
function ContextRing({
  pct,
  size = 12,
  label,
  testId,
}: {
  pct: number | null;
  size?: number;
  label?: string;
  testId?: string;
}) {
  const color = pct !== null && pct >= 80 ? "var(--warn-ink)" : "var(--accent)";
  const fill = pct === null ? 0 : Math.max(pct, 3);
  return (
    <span
      className="relative inline-block rounded-full shrink-0"
      style={{
        width: size,
        height: size,
        background: `conic-gradient(${color} ${fill}%, color-mix(in srgb, currentColor 18%, transparent) 0)`,
      }}
      data-testid={testId}
      aria-label={label}
      role={label ? "img" : undefined}
    >
      <span
        className="absolute rounded-full"
        style={{ inset: Math.max(2, Math.round(size / 7)), background: "var(--tip-hole, var(--panel))" }}
        aria-hidden="true"
      />
    </span>
  );
}

// The composer's Mode menu (§22): a quiet "Mode ⌄" chip opening the five permission options with
// the current one marked, plus — when the session supports it — the "Send approvals to Inbox"
// toggle at the bottom (the old standalone InboxControl, folded in).
function ModeMenu({
  mode,
  onModeChange,
  unattended,
  onUnattendedChange,
  reviewerPaused,
}: {
  mode: string;
  onModeChange: (mode: string) => void;
  unattended?: boolean;
  onUnattendedChange?: (on: boolean) => void;
  reviewerPaused?: boolean;
}) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  // The Auto-Approve entry is gated on the server flag. Fetch once on first open; a session
  // already IN auto-approve mode always shows its own entry so the current mode is legible
  // even if the flag was later turned off.
  const [autoApproveEnabled, setAutoApproveEnabled] = useState(false);
  useEffect(() => {
    if (!open) return;
    getSettings()
      .then((s) => setAutoApproveEnabled(s.auto_approve === true))
      .catch(() => {});
  }, [open]);
  const options = PERMISSION_OPTIONS.filter(
    (o) => !o.gated || autoApproveEnabled || o.value === mode,
  );
  const current = modeOption(mode);
  return (
    <div className="relative">
      {/* Borderless, and it names the CHOSEN mode (owner ask 2026-07-11, competitor composer
          comparison): t("cmpAskApproval") not a generic "Mode ⌄" pill. aria-label stays
          "Mode" so the accessible name is stable across mode changes. */}
      <button
        className="inline-flex items-center gap-1 px-2 py-1 rounded-lg text-meta text-muted hover:text-ink hover:bg-paper shrink-0"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={t("composer.mode_label")}
        title={
          `${t("composer.mode_label")}: ${current ? t(current.label) : mode}` +
          (reviewerPaused && mode === "auto-approve" ? " · " + t("composer.reviewer_paused_tip") : "") +
          (unattended ? " · " + t("composer.approvals_to_inbox") : "")
        }
      >
        {current ? t(current.label) : mode}
        {reviewerPaused && mode === "auto-approve" && (
          <span className="text-label text-warnInk" data-testid="mode-paused">· {t("composer.paused")}</span>
        )}
        <Icon name="chevronDown" size={11} className="text-faint" />
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-30" onClick={() => setOpen(false)} />
          <div
            className="absolute z-40 bottom-full mb-1 left-0 w-[260px] rounded-xl border border-line bg-panel shadow-2xl p-1.5"
            role="menu"
            data-testid="mode-menu"
          >
            {options.map((o) => (
              <button
                key={o.value}
                className="w-full flex flex-col items-start px-2.5 py-1.5 rounded-lg text-left hover:bg-paper"
                onClick={() => {
                  onModeChange(o.value);
                  setOpen(false);
                }}
              >
                <span
                  className={
                    "flex items-center text-ui " +
                    (o.value === mode ? "font-medium text-accent" : "text-ink")
                  }
                >
                  {o.caution && (
                    <Icon name="warning" size={13} className="mr-1.5 shrink-0 text-warnInk" />
                  )}
                  {t(o.label)}
                  {o.value === mode && <span className="ml-1.5">✓</span>}
                </span>
                <span className="text-label text-faint leading-snug">{o.description ? t(o.description) : ""}</span>
              </button>
            ))}
            {onUnattendedChange && (
              <>
                <div className="my-1 border-t border-line" />
                <div className="flex items-center gap-2 px-2.5 py-1.5">
                  <span className="flex-1 min-w-0">
                    <span className="block text-ui text-ink">{t("composer.approvals_to_inbox")}</span>
                    <span className="block text-label text-faint leading-snug">
                      {t("composer.approvals_to_inbox_help")}
                    </span>
                  </span>
                  <Toggle
                    checked={!!unattended}
                    onChange={onUnattendedChange}
                    title={t("composer.send_approvals_to_inbox")}
                  />
                </div>
              </>
            )}
          </div>
        </>
      )}
    </div>
  );
}

// A row in the "+" attach menu.
function attachItem(icon: "image" | "file" | "fileCode", label: string, onClick: () => void) {
  return (
    <button
      className="w-full flex items-center gap-2.5 px-3 py-1.5 text-ui text-left hover:bg-paper"
      onClick={onClick}
    >
      <Icon name={icon} size={15} className="shrink-0 text-muted" /> {label}
    </button>
  );
}

function AttachChip({ a, onRemove }: { a: Attachment; onRemove: () => void }) {
  const { t } = useTranslation();
  // 这个组件的两条文案（title="Remove"、alt）现在由构建期的 transform 接管，
  // 不再需要 useT —— 它是 t("key") 那条路退场的第一处痕迹。
  return (
    <div className={"attach-chip" + (a.kind === "image" ? " img" : "")}>
      {a.kind === "image" ? (
        <img src={a.data_url} alt={a.name} />
      ) : (
        <>
          <Icon name="file" size={13} />
          <span className="attach-name">{a.name}</span>
        </>
      )}
      <button className="attach-x" onClick={onRemove} title={t("common.remove")}>
        ✕
      </button>
    </div>
  );
}
