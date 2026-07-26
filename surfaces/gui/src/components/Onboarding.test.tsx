// Task 4: step 0 defaults to "Connect to Qumge", not the thirteen-vendor gallery. The gallery/
// key form are demoted behind a quiet "Use your own API key instead" toggle — reusing
// ProviderCards/ProviderForm from providers/ProviderSetup.tsx unchanged. canContinue gains a
// third path (Qumge connected) alongside the two it already had (a configured provider, or a
// verified keyless one); the gate itself — nothing configured, Next stays off — doesn't move.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { Onboarding } from "./Onboarding";
import {
  getProviders,
  getConnectors,
  getCloudStatus,
  setOnboarded,
  startQumgeDevice,
  pollQumgeDevice,
  type ProviderInfo,
  type QumgeDeviceStart,
} from "../api";

vi.mock("../api", () => ({
  getProviders: vi.fn(),
  setProvider: vi.fn(),
  removeProvider: vi.fn(),
  verifyProvider: vi.fn(),
  cloudLogin: vi.fn(),
  connectManaged: vi.fn(),
  getCloudStatus: vi.fn(),
  getConnectors: vi.fn(),
  getRecentChannels: vi.fn(),
  waitForCloudSignIn: vi.fn(),
  setOnboarded: vi.fn(),
  startQumgeDevice: vi.fn(),
  pollQumgeDevice: vi.fn(),
}));

vi.mock("../tauri", () => ({ openExternal: vi.fn() }));

const field = (key: string) => ({
  key,
  label: key,
  secret: true,
  required: true,
  help: "",
  placeholder: "sk-…",
});

const UNCONFIGURED: ProviderInfo[] = [
  {
    name: "openai",
    title: "OpenAI",
    needs_key: true,
    fields: [field("api_key")],
    configured: false,
    values: {},
    suggested_models: [],
    recommended_model: null,
  },
  {
    name: "anthropic",
    title: "Claude (Anthropic)",
    needs_key: true,
    fields: [field("api_key")],
    configured: false,
    values: {},
    suggested_models: [],
    recommended_model: null,
  },
];

// Includes "qumge" — the server's real /v1/providers list carries a descriptor for every
// provider, Qumge included (registry.py), so the fallback gallery would show its card too
// unless it's deliberately excluded (Fix 4).
const UNCONFIGURED_WITH_QUMGE: ProviderInfo[] = [
  ...UNCONFIGURED,
  {
    name: "qumge",
    title: "Qumge",
    needs_key: true,
    fields: [field("api_key")],
    configured: false,
    values: {},
    suggested_models: [],
    recommended_model: null,
  },
];

const QUMGE_START: QumgeDeviceStart = {
  user_code: "ABCD-1234",
  verification_uri: "https://qumge.com/device",
  verification_uri_complete: "https://qumge.com/device?user_code=ABCD-1234",
  interval: 5,
  expires_in: 900,
};

const continueBtn = () => screen.getByTestId("ob-continue") as HTMLButtonElement;

beforeEach(() => {
  vi.mocked(getProviders).mockResolvedValue(UNCONFIGURED);
  vi.mocked(getConnectors).mockResolvedValue([]);
  vi.mocked(getCloudStatus).mockResolvedValue({
    signed_in: false,
    account: "",
    user_id: "",
  });
  vi.mocked(setOnboarded).mockResolvedValue({ ok: true, onboarded: true });
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("Onboarding — step 0 (Task 4: connect to Qumge, not the gallery)", () => {
  it("shows the Qumge connect action, not the vendor gallery — and Next stays off with nothing configured", async () => {
    render(<Onboarding onDone={vi.fn()} />);

    expect(await screen.findByTestId("qumge-connect-start")).toBeTruthy();
    expect(screen.queryByTestId("ob-provider-gallery")).toBeNull();
    expect(screen.queryByTestId("ob-provider-openai")).toBeNull();
    expect(screen.queryByTestId("ob-provider-anthropic")).toBeNull();
    expect(continueBtn().disabled).toBe(true);
  });

  it("'Use your own API key instead' swaps in the real gallery in place, and the Qumge action is gone", async () => {
    render(<Onboarding onDone={vi.fn()} />);
    await screen.findByTestId("qumge-connect-start");

    fireEvent.click(screen.getByTestId("ob-use-own-key"));

    expect(screen.getByTestId("ob-provider-gallery")).toBeTruthy();
    expect(screen.getByTestId("ob-provider-openai")).toBeTruthy();
    expect(screen.getByTestId("ob-provider-anthropic")).toBeTruthy();
    expect(screen.queryByTestId("qumge-connect-start")).toBeNull();
  });

  it("an already-configured provider arms Next even while the Qumge panel is what's showing", async () => {
    vi.mocked(getProviders).mockResolvedValue(
      UNCONFIGURED.map((p) => (p.name === "openai" ? { ...p, configured: true } : p)),
    );

    render(<Onboarding onDone={vi.fn()} />);
    await screen.findByTestId("qumge-connect-start");
    // Let the resolved getProviders() land.
    await act(async () => {
      await Promise.resolve();
    });

    expect(continueBtn().disabled).toBe(false);
    // Still on the Qumge panel — arming Next didn't require opening the fallback.
    expect(screen.queryByTestId("ob-provider-gallery")).toBeNull();
  });

  it("the demoted gallery never shows a Qumge card — its own help text is a dead end there", async () => {
    vi.mocked(getProviders).mockResolvedValue(UNCONFIGURED_WITH_QUMGE);

    render(<Onboarding onDone={vi.fn()} />);
    await screen.findByTestId("qumge-connect-start");
    fireEvent.click(screen.getByTestId("ob-use-own-key"));

    expect(screen.getByTestId("ob-provider-gallery")).toBeTruthy();
    expect(screen.getByTestId("ob-provider-openai")).toBeTruthy();
    expect(screen.queryByTestId("ob-provider-qumge")).toBeNull();
  });

  it("'Use your own API key instead' is reversible — a control returns to the Qumge panel", async () => {
    render(<Onboarding onDone={vi.fn()} />);
    await screen.findByTestId("qumge-connect-start");

    fireEvent.click(screen.getByTestId("ob-use-own-key"));
    expect(screen.getByTestId("ob-provider-gallery")).toBeTruthy();
    expect(screen.queryByTestId("qumge-connect-start")).toBeNull();

    fireEvent.click(screen.getByTestId("ob-back-to-qumge"));
    expect(await screen.findByTestId("qumge-connect-start")).toBeTruthy();
    expect(screen.queryByTestId("ob-provider-gallery")).toBeNull();
  });

  it("connecting to Qumge arms Next without ever touching the fallback", async () => {
    vi.useFakeTimers();
    vi.mocked(startQumgeDevice).mockResolvedValue(QUMGE_START);
    vi.mocked(pollQumgeDevice)
      .mockResolvedValueOnce({ status: "pending" })
      .mockResolvedValueOnce({ status: "connected" });

    render(<Onboarding onDone={vi.fn()} />);
    await act(async () => {
      await Promise.resolve();
    });

    fireEvent.click(screen.getByTestId("qumge-connect-start"));
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(continueBtn().disabled).toBe(true);

    await act(() => vi.advanceTimersByTimeAsync(5000)); // first poll: pending
    expect(continueBtn().disabled).toBe(true);

    await act(() => vi.advanceTimersByTimeAsync(5000)); // second poll: connected
    expect(continueBtn().disabled).toBe(false);
    expect(screen.queryByTestId("ob-provider-gallery")).toBeNull();
  });
});
