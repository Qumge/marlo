import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { Sidebar } from "./Sidebar";
import type { SessionInfo } from "../types";

// The account row, and the bug it is drawn from.
//
// It reported sign-in to OpenWorker Cloud — a third party whose connectors this
// build does not support — while the credit chip beside it rendered THIS
// account's balance. A user signed in to Qumge read "Not signed in" next to
// their own $19.12, and the menu's "Sign out" ended a session other than the one
// named above it.
//
// So the assertions worth having here are mostly negative: the states in which
// the row must NOT claim someone is signed out, and the words it must never say.

type Call = { url: string; method: string };

function stubFetch(account: unknown) {
  const calls: Call[] = [];
  const fn = vi.fn(async (url: string, init?: RequestInit) => {
    calls.push({ url, method: (init?.method || "GET").toUpperCase() });
    if (url.includes("/v1/qumge/account")) {
      return { ok: true, json: async () => account } as Response;
    }
    return { ok: true, json: async () => ({}) } as Response;
  });
  vi.stubGlobal("fetch", fn);
  return calls;
}

const SESSIONS: SessionInfo[] = [
  {
    session_id: "s1", title: "hi", workspace: "", agent: "cowork", model: "m",
    mode: "interactive", updated_at: "2026-07-27", messages: 1,
  },
];

const baseProps = {
  agent: "cowork",
  workspace: "",
  surfaces: { cowork: true, chat: false, code: false },
  sessions: SESSIONS,
  projects: [],
  activeSession: "s1",
  onSwitchAgent: vi.fn(),
  onNewSession: vi.fn(),
  onSelectSession: vi.fn(),
  onNewProject: vi.fn(),
  onRenameSession: vi.fn(),
  onDeleteSession: vi.fn(),
  onArchiveSession: vi.fn(),
  onTogglePin: vi.fn(),
  onManage: vi.fn(),
  onOpenPersona: vi.fn(),
  onManagePersonas: vi.fn(),
  onOpenScheduled: vi.fn(),
  onOpenAutomation: vi.fn(),
  onOpenIntegrations: vi.fn(),
  onOpenAudit: vi.fn(),
  onOpenInbox: vi.fn(),
  scheduledActive: false,
  integrationsActive: false,
  auditActive: false,
  inboxActive: false,
};

const SIGNED_IN = {
  signed_in: true,
  email: "someone@example.com",
  balance: {
    balance_micro_usd: 19_120_000, balance: 19.12, currency: "USD",
    topup_url: "https://qumge.com/en/gateway/topup/new", low: false,
  },
};

async function openMenu() {
  const row = await screen.findByTestId("account-row");
  fireEvent.click(row);
  return screen.findByTestId("account-menu");
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe("the account row names the Qumge account", () => {
  it("shows who is signed in, not that nobody is", async () => {
    stubFetch(SIGNED_IN);
    render(<Sidebar {...baseProps} />);

    const row = await screen.findByTestId("account-row");
    await waitFor(() => expect(row.textContent).toContain("Someone"));
    // The exact reported symptom: this text, on this row, beside this balance.
    expect(row.textContent).not.toContain("Not signed in");
    expect(row.textContent).toContain("$19.12");
  });

  it("puts the address in the menu header", async () => {
    stubFetch(SIGNED_IN);
    render(<Sidebar {...baseProps} />);

    const header = within(await openMenu()).getByTestId("account-header");
    expect(header.textContent).toContain("someone@example.com · Qumge");
  });

  it("says nothing about OpenWorker anywhere in the menu", async () => {
    // The regression guard. Every string in this menu was about a service that
    // does not run this account, and blanket renaming is what put three false
    // statements into the app the last time this was touched — so assert on the
    // absence of the word rather than on the presence of a replacement.
    stubFetch(SIGNED_IN);
    render(<Sidebar {...baseProps} />);

    const menu = await openMenu();
    expect(menu.textContent || "").not.toMatch(/openworker/i);
  });
});

describe("what the row does when the server cannot be reached", () => {
  it("stays signed in with no balance rather than flipping to signed out", async () => {
    // A key on disk is a signed-in user. Deriving the state from a successful
    // balance call instead means every tunnel and flaky café wifi silently logs
    // someone out on screen.
    stubFetch({ signed_in: true, email: "someone@example.com", balance: null });
    render(<Sidebar {...baseProps} />);

    const row = await screen.findByTestId("account-row");
    await waitFor(() => expect(row.textContent).toContain("Someone"));
    expect(row.textContent).not.toContain("Not signed in");
    expect(screen.queryByTestId("balance-chip")).toBeNull();
  });

  it("still reads as signed in when the address is unknown", async () => {
    // An older server has no email field; the row has to degrade to "signed in"
    // rather than to "signed out".
    stubFetch({ signed_in: true, email: null, balance: null });
    render(<Sidebar {...baseProps} />);

    const row = await screen.findByTestId("account-row");
    await waitFor(() => expect(row.textContent).toContain("Signed in to Qumge"));
  });

  it("treats an unreachable sidecar as signed out, not as a crash", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => {
      throw new Error("connection refused");
    }));
    render(<Sidebar {...baseProps} />);

    const row = await screen.findByTestId("account-row");
    await waitFor(() => expect(row.textContent).toContain("Not signed in"));
  });
});

describe("signing in and out", () => {
  it("offers a way back in, so signing out is not a one-way door", async () => {
    // The device flow lived in onboarding and nowhere else. Adding a sign-out
    // without this would strand anyone who used it.
    stubFetch({ signed_in: false, email: null, balance: null });
    render(<Sidebar {...baseProps} />);

    fireEvent.click(within(await openMenu()).getByTestId("account-sign-in"));
    expect(await screen.findByTestId("qumge-signin-modal")).toBeTruthy();
  });

  it("signs out of the account the header names", async () => {
    // It used to call the cloud's logout while displaying the Qumge address.
    const calls = stubFetch(SIGNED_IN);
    render(<Sidebar {...baseProps} />);

    fireEvent.click(within(await openMenu()).getByText("Sign out"));

    await waitFor(() =>
      expect(
        calls.some((c) => c.method === "DELETE" && c.url.includes("/v1/providers/qumge")),
      ).toBe(true),
    );
    expect(calls.some((c) => c.url.includes("/v1/cloud/logout"))).toBe(false);
  });

  it("does not offer sign-out to someone who is not signed in", async () => {
    stubFetch({ signed_in: false, email: null, balance: null });
    render(<Sidebar {...baseProps} />);

    expect(within(await openMenu()).queryByText("Sign out")).toBeNull();
  });
});
