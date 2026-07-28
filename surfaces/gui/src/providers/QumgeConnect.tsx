import { useEffect, useRef, useState } from "react";
import { useT } from "../i18n";
import { pollQumgeDevice, startQumgeDevice, type QumgeDeviceStart, type QumgeDevicePoll } from "../api.qumge";
import { openExternal } from "../tauri";

// Marlo's "sign in to Qumge" panel — replaces Marlo's thirteen-provider-picker first
// screen with one device-flow sign-in. idle → waiting (code + URL, polling for the
// browser-side approval) → onConnected, or denied/expired/error with a way back to idle.
// The API key is NEVER handled here: the server exchanges it and writes it straight to the
// SecretStore (poll_qumge_device's "connected" response carries no token at all), so there
// is nothing for this component to store or display even by mistake.
type Phase =
  | { kind: "idle" }
  | { kind: "starting" }
  | { kind: "waiting"; data: QumgeDeviceStart }
  | { kind: "denied" }
  | { kind: "expired" }
  | { kind: "error"; message?: string };

// Poll interval bounds (seconds). The server can widen this on `slow_down`, and a start
// response hands one back too — either could arrive missing, zero, negative, or absurd from
// a malformed/adversarial body, and that value feeds directly into `setTimeout`. Clamping
// keeps a bad value from becoming `setTimeout(poll, NaN)` (fires in ~1ms — a tight loop) or
// an effectively-dead multi-hour wait.
const MIN_POLL_INTERVAL_S = 1;
const MAX_POLL_INTERVAL_S = 60;
const DEFAULT_POLL_INTERVAL_S = 5;

function clampInterval(seconds: unknown): number {
  const n = Number(seconds);
  if (!Number.isFinite(n) || n <= 0) return DEFAULT_POLL_INTERVAL_S;
  return Math.min(MAX_POLL_INTERVAL_S, Math.max(MIN_POLL_INTERVAL_S, n));
}

export function QumgeConnect({ onConnected }: { onConnected: () => void }) {
  const t = useT();
  const [phase, setPhase] = useState<Phase>({ kind: "idle" });
  // The poll loop's own timer — not React state, so a tick never causes a render by itself.
  const timerRef = useRef<number | null>(null);
  const intervalRef = useRef(DEFAULT_POLL_INTERVAL_S); // server may widen this (RFC 8628 slow_down)
  // Flipped on unmount so an in-flight start()/poll() promise that resolves afterward can't
  // call setState on a gone component — belt-and-braces alongside clearing the timer itself.
  const stoppedRef = useRef(false);
  // Bumped on every start() call; a start()/poll() continuation only applies its result if
  // it's still the CURRENT one. Without this, two flows in flight (a double-click, or "Try
  // again" while a straggler is still resolving) race: the server keeps only the latest, but
  // whichever promise happens to resolve last would otherwise win the display — showing code
  // A while the server polls code B.
  const startSeqRef = useRef(0);

  useEffect(
    () => () => {
      stoppedRef.current = true;
      if (timerRef.current !== null) window.clearTimeout(timerRef.current);
    },
    [],
  );

  const schedulePoll = () => {
    if (timerRef.current !== null) window.clearTimeout(timerRef.current);
    timerRef.current = window.setTimeout(poll, intervalRef.current * 1000);
  };

  const poll = async () => {
    const res: QumgeDevicePoll = await pollQumgeDevice().catch(() => ({
      status: "error",
      error: t("qcCantReachServer"),
    }));
    if (stoppedRef.current) return;
    if (res.interval !== undefined) intervalRef.current = clampInterval(res.interval);
    switch (res.status) {
      case "connected":
        onConnected();
        return;
      case "denied":
        setPhase({ kind: "denied" });
        return;
      case "expired":
        setPhase({ kind: "expired" });
        return;
      case "pending":
        schedulePoll();
        return;
      case "error":
        setPhase({ kind: "error", message: res.error });
        return;
      default:
        // An unrecognized status is a bug or a server we don't understand — NOT "keep
        // polling forever". Silently treating anything-but-the-known-terminals as pending
        // is exactly how a malformed/empty body turns into an unbounded fetch loop behind
        // a "waiting" panel.
        setPhase({
          kind: "error",
          message: res.error || t("tplUnexpectedStatus")(String(res.status)),
        });
        return;
    }
  };

  // Also the "Try again" action — restarting the flow IS asking for a fresh code.
  const start = async () => {
    // Reentry guard: a second click while a flow is already starting/waiting must not
    // issue a second request. Read fresh on every call (not cached in a ref) so it always
    // reflects the CURRENT phase.
    if (phase.kind === "starting" || phase.kind === "waiting") return;
    const seq = ++startSeqRef.current;
    setPhase({ kind: "starting" });
    try {
      const data = await startQumgeDevice();
      if (stoppedRef.current || seq !== startSeqRef.current) return; // superseded by a newer start()
      intervalRef.current = clampInterval(data.interval);
      setPhase({ kind: "waiting", data });
      schedulePoll();
    } catch (err) {
      if (stoppedRef.current || seq !== startSeqRef.current) return;
      setPhase({
        kind: "error",
        message: err instanceof Error ? err.message : undefined,
      });
    }
  };

  if (phase.kind === "waiting") {
    const { user_code, verification_uri, verification_uri_complete } = phase.data;
    return (
      <div className="space-y-3" data-testid="qumge-waiting">
        <div>
          <div
            className="text-[28px] font-semibold tracking-[0.08em] select-all"
            data-testid="qumge-user-code"
          >
            {user_code}
          </div>
          {/* The COMPLETE uri, the one carrying ?user_code=. Showing the bare
              address meant anyone who copied it still had to retype the code
              above it by hand — and copying was the only way through while
              t("qcOpenBrowser") did nothing. */}
          <p className="text-[13px] text-muted select-all mt-1 break-all" data-testid="qumge-verification-uri">
            {verification_uri_complete || verification_uri}
          </p>
        </div>
        <button
          className="px-4 py-2 rounded-lg bg-accent text-white text-[13px] font-medium"
          data-testid="qumge-open-browser"
          onClick={() => openExternal(verification_uri_complete)}
        >
          {t("openBrowser")}
        </button>
        <p className="text-[11.5px] text-faint">{t("deviceHint")}</p>
      </div>
    );
  }

  if (phase.kind === "denied" || phase.kind === "expired" || phase.kind === "error") {
    const message =
      phase.kind === "denied"
        ? t("signInDenied")
        : phase.kind === "expired"
          ? t("codeExpired")
          : phase.message || t("connectFailed");
    return (
      <div className="space-y-2" data-testid="qumge-failed">
        <p className="text-[13px] text-muted" data-testid="qumge-error-message">
          {message}
        </p>
        <button
          className="px-4 py-2 rounded-lg border border-line text-[13px] font-medium text-ink hover:border-lineStrong"
          data-testid="qumge-try-again"
          onClick={() => void start()}
        >
          {t("tryAgain")}
        </button>
      </div>
    );
  }

  // idle or starting: same button, disabled + relabeled synchronously the instant it's
  // clicked (before the network round trip even begins) so a second click can't slip in a
  // second flow while the first is in flight.
  const starting = phase.kind === "starting";
  return (
    <button
      className="px-4 py-2 rounded-lg bg-accent text-white text-[13px] font-medium disabled:opacity-60"
      data-testid="qumge-connect-start"
      disabled={starting}
      onClick={() => void start()}
    >
      {starting ? t("connecting") : t("connectToQumge")}
    </button>
  );
}
