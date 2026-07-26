// The Qumge connect panel (Task 3): idle → device-flow waiting (code + URL, polling for the
// browser-side approval) → connected/denied/expired/error. No API key ever appears here — the
// server writes it straight to the SecretStore (poll_qumge_device's "connected" response
// carries no token at all, so there is nothing for this component to render even by mistake).
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { QumgeConnect } from "./QumgeConnect";
import { pollQumgeDevice, startQumgeDevice } from "../api";

vi.mock("../api", () => ({
  startQumgeDevice: vi.fn(),
  pollQumgeDevice: vi.fn(),
}));

const START = {
  user_code: "ABCD-1234",
  verification_uri: "https://qumge.com/device",
  verification_uri_complete: "https://qumge.com/device?user_code=ABCD-1234",
  interval: 5,
  expires_in: 900,
};

// Flushes microtasks queued by an `await` inside a click handler (no fake timer involved yet —
// this is for the promise from startQumgeDevice(), not a setTimeout). Two ticks covers the
// mock's own resolution hop plus the component's `await`.
const flushClick = () =>
  act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });

// Advances the fake clock and drains the microtasks a timer callback's `await` creates —
// needed because poll() itself awaits pollQumgeDevice() before touching state.
const advance = (ms: number) => act(() => vi.advanceTimersByTimeAsync(ms));

beforeEach(() => {
  vi.useFakeTimers();
  vi.mocked(startQumgeDevice).mockReset();
  vi.mocked(pollQumgeDevice).mockReset();
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("QumgeConnect", () => {
  it("idle: a single Connect action, nothing else", () => {
    render(<QumgeConnect onConnected={vi.fn()} />);
    expect(screen.getByTestId("qumge-connect-start").textContent).toBe("Connect to Qumge");
    expect(screen.queryByTestId("qumge-user-code")).toBeNull();
  });

  it("after starting, renders the code and URL as on-screen selectable text — not only handed to openExternal", async () => {
    vi.mocked(startQumgeDevice).mockResolvedValue(START);
    vi.mocked(pollQumgeDevice).mockResolvedValue({ status: "pending" });
    const openSpy = vi.spyOn(window, "open").mockImplementation(() => null);

    render(<QumgeConnect onConnected={vi.fn()} />);
    fireEvent.click(screen.getByTestId("qumge-connect-start"));
    await flushClick();

    expect(screen.getByTestId("qumge-user-code").textContent).toBe("ABCD-1234");
    // The COMPLETE url. Rendering the bare one meant a person who copied it —
    // the only route while "Open browser" was dead — still had to retype the
    // code by hand.
    expect(screen.getByTestId("qumge-verification-uri").textContent).toBe(
      "https://qumge.com/device?user_code=ABCD-1234",
    );
    // No key of any kind is ever rendered — the server holds it.
    expect(document.body.textContent).not.toMatch(/sk-|api[_ ]?key/i);

    // Outside the desktop shell (npm run dev) window.open is the real thing.
    fireEvent.click(screen.getByTestId("qumge-open-browser"));
    expect(openSpy).toHaveBeenCalledWith(
      START.verification_uri_complete,
      "_blank",
      "noopener,noreferrer",
    );
    expect(screen.getByText(/didn't open/i)).toBeTruthy();
  });

  // This assertion used to say window.open — and passed, for every build in
  // which the button did nothing at all. window.open is a no-op in a Tauri
  // webview; the code reached for a `__TAURI__.opener` plugin that was never
  // installed, fell through to window.open, and the person sat looking at a
  // button that swallowed their clicks. Asserting the fallback is asserting the
  // bug, so this pins the desktop path specifically.
  it("in the desktop shell the button invokes the app's opener, not the dead window.open path", async () => {
    vi.mocked(startQumgeDevice).mockResolvedValue(START);
    vi.mocked(pollQumgeDevice).mockResolvedValue({ status: "pending" });
    const openSpy = vi.spyOn(window, "open").mockImplementation(() => null);
    const invoke = vi.fn().mockResolvedValue(undefined);
    (globalThis as any).__TAURI__ = { core: { invoke } };

    try {
      render(<QumgeConnect onConnected={vi.fn()} />);
      fireEvent.click(screen.getByTestId("qumge-connect-start"));
      await flushClick();

      fireEvent.click(screen.getByTestId("qumge-open-browser"));

      expect(invoke).toHaveBeenCalledWith("open_external", {
        url: START.verification_uri_complete,
      });
      expect(openSpy).not.toHaveBeenCalled();
    } finally {
      delete (globalThis as any).__TAURI__;
    }
  });

  it("polls at the server-given interval and calls onConnected once the status flips", async () => {
    vi.mocked(startQumgeDevice).mockResolvedValue(START);
    vi.mocked(pollQumgeDevice)
      .mockResolvedValueOnce({ status: "pending" })
      .mockResolvedValueOnce({ status: "connected" });
    const onConnected = vi.fn();

    render(<QumgeConnect onConnected={onConnected} />);
    fireEvent.click(screen.getByTestId("qumge-connect-start"));
    await flushClick();
    expect(pollQumgeDevice).not.toHaveBeenCalled();

    await advance(5000);
    expect(pollQumgeDevice).toHaveBeenCalledTimes(1);
    expect(onConnected).not.toHaveBeenCalled();

    await advance(5000);
    expect(pollQumgeDevice).toHaveBeenCalledTimes(2);
    expect(onConnected).toHaveBeenCalledTimes(1);
  });

  it("honors a widened interval from the server for the next poll", async () => {
    vi.mocked(startQumgeDevice).mockResolvedValue(START); // interval: 5
    vi.mocked(pollQumgeDevice)
      .mockResolvedValueOnce({ status: "pending", interval: 10 })
      .mockResolvedValueOnce({ status: "pending" });

    render(<QumgeConnect onConnected={vi.fn()} />);
    fireEvent.click(screen.getByTestId("qumge-connect-start"));
    await flushClick();

    await advance(5000);
    expect(pollQumgeDevice).toHaveBeenCalledTimes(1);

    // The OLD 5s interval must no longer be enough — the server asked for 10s.
    await advance(5000);
    expect(pollQumgeDevice).toHaveBeenCalledTimes(1);

    await advance(5000);
    expect(pollQumgeDevice).toHaveBeenCalledTimes(2);
  });

  it("expired shows a plain message and a Try again control that restarts the flow", async () => {
    vi.mocked(startQumgeDevice).mockResolvedValue(START);
    vi.mocked(pollQumgeDevice).mockResolvedValueOnce({ status: "expired" });

    render(<QumgeConnect onConnected={vi.fn()} />);
    fireEvent.click(screen.getByTestId("qumge-connect-start"));
    await flushClick();
    await advance(5000);

    expect(screen.getByTestId("qumge-try-again")).toBeTruthy();
    expect(screen.queryByTestId("qumge-user-code")).toBeNull();

    vi.mocked(startQumgeDevice).mockResolvedValue({ ...START, user_code: "NEWC-0DE1" });
    fireEvent.click(screen.getByTestId("qumge-try-again"));
    await flushClick();

    expect(screen.getByTestId("qumge-user-code").textContent).toBe("NEWC-0DE1");
  });

  it("denied shows a plain message and a Try again control", async () => {
    vi.mocked(startQumgeDevice).mockResolvedValue(START);
    vi.mocked(pollQumgeDevice).mockResolvedValueOnce({ status: "denied" });

    render(<QumgeConnect onConnected={vi.fn()} />);
    fireEvent.click(screen.getByTestId("qumge-connect-start"));
    await flushClick();
    await advance(5000);

    expect(screen.getByTestId("qumge-try-again")).toBeTruthy();
    expect(screen.getByTestId("qumge-error-message")).toBeTruthy();
  });

  it("double-clicking Connect issues only one device flow, and disables the button meanwhile", async () => {
    vi.mocked(startQumgeDevice).mockResolvedValue(START);
    vi.mocked(pollQumgeDevice).mockResolvedValue({ status: "pending" });

    render(<QumgeConnect onConnected={vi.fn()} />);
    const btn = () => screen.getByTestId("qumge-connect-start") as HTMLButtonElement;
    fireEvent.click(btn());
    // Synchronous, before the round trip resolves: the button is already disabled — a
    // second click here must not start a second flow.
    expect(btn().disabled).toBe(true);
    fireEvent.click(btn());
    await flushClick();

    expect(startQumgeDevice).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId("qumge-user-code").textContent).toBe("ABCD-1234");
  });

  it("a stale start() resolution is discarded even if two calls land in the same batch", async () => {
    // The synchronous "starting" guard closes the gap for a normal double-click (proven
    // above), but two click events CAN still land in the same React batch (both handlers
    // reading the same pre-update `phase`) — dispatching both inside one `act()` forces
    // that. The sequence number is what still gets the right answer on screen when that
    // happens: whichever call is CURRENT wins, never whichever promise settles last.
    let resolveFirst!: (v: unknown) => void;
    let resolveSecond!: (v: unknown) => void;
    vi.mocked(startQumgeDevice)
      .mockImplementationOnce(() => new Promise((r) => (resolveFirst = r)) as any)
      .mockImplementationOnce(() => new Promise((r) => (resolveSecond = r)) as any);
    vi.mocked(pollQumgeDevice).mockResolvedValue({ status: "pending" });

    render(<QumgeConnect onConnected={vi.fn()} />);
    const btn = () => screen.getByTestId("qumge-connect-start") as HTMLButtonElement;

    act(() => {
      fireEvent.click(btn());
      fireEvent.click(btn());
    });
    await flushClick();
    expect(startQumgeDevice).toHaveBeenCalledTimes(2);

    // The FIRST call's promise resolves LAST — out of order — and must be ignored: a
    // second start() has already superseded it.
    await act(async () => {
      resolveSecond({ ...START, user_code: "SECOND-CODE" });
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(screen.getByTestId("qumge-user-code").textContent).toBe("SECOND-CODE");

    await act(async () => {
      resolveFirst({ ...START, user_code: "FIRST-CODE" });
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(screen.getByTestId("qumge-user-code").textContent).toBe("SECOND-CODE");
  });

  it("start() failing surfaces the thrown message instead of a bare fallback", async () => {
    vi.mocked(startQumgeDevice).mockRejectedValue(
      new Error("Too many sign-in attempts — wait a bit and try again."),
    );

    render(<QumgeConnect onConnected={vi.fn()} />);
    fireEvent.click(screen.getByTestId("qumge-connect-start"));
    await flushClick();

    expect(screen.getByTestId("qumge-error-message").textContent).toBe(
      "Too many sign-in attempts — wait a bit and try again.",
    );
  });

  it("clamps a missing/invalid interval instead of scheduling a near-0ms poll loop", async () => {
    vi.mocked(startQumgeDevice).mockResolvedValue({ ...START, interval: 0 });
    vi.mocked(pollQumgeDevice).mockResolvedValue({ status: "pending" });

    render(<QumgeConnect onConnected={vi.fn()} />);
    fireEvent.click(screen.getByTestId("qumge-connect-start"));
    await flushClick();

    // A bogus 0 must not fire the poll almost immediately.
    await advance(500);
    expect(pollQumgeDevice).not.toHaveBeenCalled();
    await advance(4500); // clamped to the 5s default
    expect(pollQumgeDevice).toHaveBeenCalledTimes(1);
  });

  it("an unrecognized poll status is treated as an error, not silently re-polled forever", async () => {
    vi.mocked(startQumgeDevice).mockResolvedValue(START);
    // No `status` at all — e.g. the exact shape produced by an unauthenticated JSON error
    // body sailing through un-thrown (the bug this guards against).
    vi.mocked(pollQumgeDevice).mockResolvedValueOnce({} as any);

    render(<QumgeConnect onConnected={vi.fn()} />);
    fireEvent.click(screen.getByTestId("qumge-connect-start"));
    await flushClick();
    await advance(5000);

    expect(pollQumgeDevice).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId("qumge-failed")).toBeTruthy();
    // No second poll was ever scheduled — this is the "unbounded fetch loop" the fix stops.
    await advance(30000);
    expect(pollQumgeDevice).toHaveBeenCalledTimes(1);
  });

  it("clears the polling timer on unmount — no request loop survives the component", async () => {
    vi.mocked(startQumgeDevice).mockResolvedValue(START);
    vi.mocked(pollQumgeDevice).mockResolvedValue({ status: "pending" });

    const { unmount } = render(<QumgeConnect onConnected={vi.fn()} />);
    fireEvent.click(screen.getByTestId("qumge-connect-start"));
    await flushClick();
    await advance(5000);
    expect(pollQumgeDevice).toHaveBeenCalledTimes(1);

    unmount();
    await advance(30000);
    expect(pollQumgeDevice).toHaveBeenCalledTimes(1);
  });
});
