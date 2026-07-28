import { useEffect, useRef, useState } from "react";
import { useT } from "../i18n";
import {
  checkForUpdate,
  clearPendingUpdate,
  downloadUpdate,
  installUpdate,
  isTauri,
  type UpdateInfo,
} from "../tauri";

// Auto-update prompt (desktop shell only — the browser build never renders this).
// Deliberately a PROMPT, not a silent background install: swapping the app under a
// user mid-session would kill their running coworker turn, and quiet self-mutation
// sits badly with the local-first trust posture. "Later" dismisses that VERSION for
// this app run; long-lived instances still hear about the next release because the
// check repeats every 30 minutes (FB-001 — the app can sit open for weeks).
//
// The first check runs shortly after boot settles (the splash and session restore own
// the first seconds). Once a release is offered, the bytes are pre-fetched in the
// background (FB-003) so "Restart to update" is instant instead of a multi-minute
// download; if the pre-fetch fails the button falls back to download-on-click.
// Update integrity is enforced below this layer: the shell verifies the manifest's
// minisign signature against the pubkey compiled into tauri.conf.json.

const FIRST_CHECK_MS = 15_000;
const RECHECK_MS = 30 * 60_000;
// 一次失败之后不要干等 30 分钟。
//
// 0.3.3 发出去后没人收到提示，而设置页里【手动点一下就找到了】——两条路调的是
// 同一个命令，差别只在时机。最合得上全部证据的机制是：15 秒那次首检撞上启动
// （updater 插件还没就绪 / 网络还没起来）失败了，错误被 catch 吞掉，然后下一次
// 尝试在 30 分钟之后。这半小时里，用户看到的就是"没有自动更新"。
//
// 失败后按 1 分钟、5 分钟重试两次，再回到 30 分钟的节奏。重试次数有限：这是补
// 启动竞态的，不是拿来对付真正连不上网的——那种情况下每分钟敲一次没有意义。
const RETRY_MS = [60_000, 5 * 60_000];

// downloading: background pre-fetch in flight (button locked).
// ready: bytes cached in the shell — install is instant.
// fallback: pre-fetch failed — the button does the full download-on-click as before.
type Phase = "downloading" | "ready" | "fallback" | "installing" | "error";

export function UpdateBanner() {
  const t = useT();
  const [update, setUpdate] = useState<UpdateInfo | null>(null);
  const [phase, setPhase] = useState<Phase>("downloading");
  const [err, setErr] = useState("");
  // Per-run, per-version dismissal — no localStorage, so a restart re-offers, and a
  // NEWER release found by a later check overrides an earlier "Later".
  const dismissed = useRef<string | null>(null);
  // Version the background pre-fetch was kicked off for: keeps periodic re-checks of
  // the same release from re-firing the download or resetting the button state.
  const fetched = useRef<string | null>(null);

  const offer = (u: UpdateInfo) => {
    if (u.version === dismissed.current) return;
    setUpdate((prev) => (prev?.version === u.version ? prev : u));
    if (fetched.current === u.version) return;
    fetched.current = u.version;
    setPhase("downloading");
    const v = u.version; // guard: a newer release may supersede this fetch mid-flight
    downloadUpdate()
      .then(() => fetched.current === v && setPhase("ready"))
      .catch(() => fetched.current === v && setPhase("fallback"));
  };

  useEffect(() => {
    if (!isTauri()) return;
    // 【不要再吞掉】。这里原来是 `.catch(() => {})`：0.3.3 发出去之后没人收到
    // 提示，而排查时发现失败在任何地方都没有留下记录——Rust 返回了错误字符串，
    // 这一行把它扔了。控制台至少是一个能看的地方。
    // 定时器都记下来，卸载时一个不漏 —— 重试是动态排的。
    const timers: any[] = [];
    let retries = 0;
    const check = () =>
      checkForUpdate()
        .then((u) => {
          retries = 0; // 通了就把重试预算还回去
          if (u) offer(u);
        })
        .catch((e) => {
          // 【不要再吞掉】。原来这里是 `.catch(() => {})`，于是"没检查"、"检查
          // 失败"、"已是最新"三种情况长得完全一样，排查时一点线索都没有。
          console.error("[updater] 检查更新失败：", e);
          if (retries < RETRY_MS.length) timers.push(setTimeout(check, RETRY_MS[retries++]));
        });
    timers.push(setTimeout(check, FIRST_CHECK_MS));
    timers.push(setInterval(check, RECHECK_MS));
    return () => timers.forEach((t) => { clearTimeout(t); clearInterval(t); });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (!update) return null;

  const install = async () => {
    setPhase("installing");
    setErr("");
    try {
      await installUpdate(); // success restarts the app — nothing to do after
    } catch (e: any) {
      // 【不要再吞掉】。0.3.2 装 0.3.6 失败过一次，而横幅只说"装不上"——
      // 排查时字节、包结构、公钥、权限、content-type 一个个排除，最后卡在
      // "rename 到底报了什么"上，而那个字符串一直就在，只是这里扔了。
      // Rust 侧把 install 的失败原因原样返回（lib.rs 的 install_update）。
      const msg = String(e?.message || e);
      console.error("[updater] 安装失败：", msg);
      setErr(msg);
      setPhase("error");
    }
  };

  const busy = phase === "downloading" || phase === "installing";

  return (
    // Docked over the sidebar column (FB-002, owner call): 264px grid column minus the
    // 12px side margins, bottom offset clearing the ~57px account row so the card sits
    // just above it. z-[35]: above the account menu's click-away backdrop (z-30) so the
    // card stays clickable, but BELOW the menu itself (z-40) — an open menu must never
    // be occluded by a passive status card.
    <div
      className="fixed bottom-[64px] left-3 z-[35] w-[240px] rounded-xl border border-line bg-panel shadow-2xl px-4 py-3.5"
      role="status"
      data-testid="update-banner"
    >
      <div className="text-[13px] font-semibold">{t("uiUpdateAvailable")}</div>
      <div className="text-[12px] text-muted mt-0.5">
        Marlo v{update.version} is ready to install.
      </div>
      {phase === "error" && (
        <div className="text-[11.5px] text-warnInk mt-1.5">
          The update couldn't be installed — it will be offered again next launch.
          {err && <div className="mt-1 text-faint break-words">{err}</div>}
        </div>
      )}
      <div className="flex items-center gap-2 mt-2.5">
        <button
          className="px-3 py-1.5 rounded-full bg-accent text-white text-[12.5px] disabled:opacity-50"
          onClick={install}
          disabled={busy}
          data-testid="update-install"
        >
          {busy ? "Downloading…" : "Restart to update"}
        </button>
        <button
          className="px-2 py-1.5 text-[12.5px] text-faint hover:text-muted"
          onClick={() => {
            dismissed.current = update.version;
            setUpdate(null);
            // Free the pre-fetched bundle (tens of MB) — a dismissed release may sit
            // unused for weeks; it re-downloads if the user changes their mind.
            fetched.current = null;
            clearPendingUpdate().catch(() => {});
          }}
          disabled={phase === "installing"}
          data-testid="update-later"
        >
          Later
        </button>
      </div>
    </div>
  );
}
