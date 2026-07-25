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
    expect(screen.getByTestId("qumge-verification-uri").textContent).toBe(
      "https://qumge.com/device",
    );
    // No key of any kind is ever rendered — the server holds it.
    expect(document.body.textContent).not.toMatch(/sk-|api[_ ]?key/i);

    // The "browser may not open by itself" line + the open-browser action are best-effort;
    // the code/URL above must not depend on this succeeding.
    fireEvent.click(screen.getByTestId("qumge-open-browser"));
    expect(openSpy).toHaveBeenCalledWith(
      START.verification_uri_complete,
      "_blank",
      "noopener,noreferrer",
    );
    expect(screen.getByText(/may not open/i)).toBeTruthy();
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
