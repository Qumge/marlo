import { useEffect, useRef, useState } from "react";
import { pollQumgeDevice, startQumgeDevice, type QumgeDeviceStart, type QumgeDevicePoll } from "../api";
import { openExternal } from "../tauri";

// Marlo's "sign in to Qumge" panel — replaces OpenWorker's thirteen-provider-picker first
// screen with one device-flow sign-in. idle → waiting (code + URL, polling for the
// browser-side approval) → onConnected, or denied/expired/error with a way back to idle.
// The API key is NEVER handled here: the server exchanges it and writes it straight to the
// SecretStore (poll_qumge_device's "connected" response carries no token at all), so there
// is nothing for this component to store or display even by mistake.
type Phase =
  | { kind: "idle" }
  | { kind: "waiting"; data: QumgeDeviceStart }
  | { kind: "denied" }
  | { kind: "expired" }
  | { kind: "error"; message?: string };

export function QumgeConnect({ onConnected }: { onConnected: () => void }) {
  const [phase, setPhase] = useState<Phase>({ kind: "idle" });
  // The poll loop's own timer — not React state, so a tick never causes a render by itself.
  const timerRef = useRef<number | null>(null);
  const intervalRef = useRef(5); // seconds; server may widen this (RFC 8628 slow_down)
  // Flipped on unmount so an in-flight start()/poll() promise that resolves afterward can't
  // call setState on a gone component — belt-and-braces alongside clearing the timer itself.
  const stoppedRef = useRef(false);

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
      error: "couldn't reach the sign-in server",
    }));
    if (stoppedRef.current) return;
    if (res.interval) intervalRef.current = res.interval;
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
      case "error":
        setPhase({ kind: "error", message: res.error });
        return;
      default: // pending
        schedulePoll();
    }
  };

  // Also the "Try again" action — restarting the flow IS asking for a fresh code.
  const start = async () => {
    try {
      const data = await startQumgeDevice();
      if (stoppedRef.current) return;
      intervalRef.current = data.interval;
      setPhase({ kind: "waiting", data });
      schedulePoll();
    } catch {
      if (!stoppedRef.current) setPhase({ kind: "error" });
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
          <p className="text-[13px] text-muted select-all mt-1" data-testid="qumge-verification-uri">
            {verification_uri}
          </p>
        </div>
        <button
          className="px-4 py-2 rounded-lg bg-accent text-white text-[13px] font-medium"
          data-testid="qumge-open-browser"
          onClick={() => openExternal(verification_uri_complete)}
        >
          Open browser
        </button>
        <p className="text-[11.5px] text-faint">
          The browser may not open on its own — the address above works from any device, so
          feel free to copy it and open it wherever's convenient.
        </p>
      </div>
    );
  }

  if (phase.kind === "denied" || phase.kind === "expired" || phase.kind === "error") {
    const message =
      phase.kind === "denied"
        ? "Sign-in was denied."
        : phase.kind === "expired"
          ? "That code expired before it was used."
          : phase.message || "Something went wrong connecting to Qumge.";
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
          Try again
        </button>
      </div>
    );
  }

  return (
    <button
      className="px-4 py-2 rounded-lg bg-accent text-white text-[13px] font-medium"
      data-testid="qumge-connect-start"
      onClick={() => void start()}
    >
      Connect to Qumge
    </button>
  );
}
