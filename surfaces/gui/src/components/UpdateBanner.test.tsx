// Auto-update banner: periodic check + per-version "Later" + background pre-download,
// driven through a mocked __TAURI__ global (the browser build renders nothing, so the
// e2e harness never sees this — these unit tests are the coverage).
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { UpdateBanner } from "./UpdateBanner";

const FIRST_CHECK_MS = 15_000;
const RECHECK_MS = 30 * 60_000;

let invoke: ReturnType<typeof vi.fn>;
let available: { version: string; notes: string } | null;
let download: () => Promise<void>;

beforeEach(() => {
  vi.useFakeTimers();
  available = { version: "1.2.0", notes: "" };
  download = async () => {};
  invoke = vi.fn(async (cmd: string) => {
    if (cmd === "check_for_update") return available;
    if (cmd === "download_update") return download();
    if (cmd === "install_update") return null;
    return null;
  });
  (globalThis as any).__TAURI__ = { core: { invoke } };
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  delete (globalThis as any).__TAURI__;
});

const advance = (ms: number) => act(() => vi.advanceTimersByTimeAsync(ms));

describe("UpdateBanner", () => {
  // 0.3.3 发出去后没人收到提示，而设置页手动点一下就找到了。两条路调的是同一个
  // 命令，差别只在时机——最合得上证据的机制是首检撞上启动失败了，然后干等 30 分钟。
  it("首检失败后 1 分钟就重试，而不是干等 30 分钟", async () => {
    let calls = 0;
    invoke = vi.fn(async (cmd: string) => {
      if (cmd === "check_for_update") {
        calls++;
        if (calls === 1) throw new Error("updater not ready");
        return available;
      }
      return null;
    });
    (globalThis as any).__TAURI__ = { core: { invoke } };
    vi.spyOn(console, "error").mockImplementation(() => {});

    render(<UpdateBanner />);
    await advance(FIRST_CHECK_MS + 100);
    expect(screen.queryByTestId("update-banner")).toBeNull(); // 第一次失败了

    await advance(60_000);
    expect(screen.getByTestId("update-banner")).toBeTruthy();
  });

  it("重试有上限 —— 真的连不上网时不会每分钟敲一次", async () => {
    invoke = vi.fn(async (cmd: string) => {
      if (cmd === "check_for_update") throw new Error("offline");
      return null;
    });
    (globalThis as any).__TAURI__ = { core: { invoke } };
    vi.spyOn(console, "error").mockImplementation(() => {});

    render(<UpdateBanner />);
    await advance(FIRST_CHECK_MS + 100);
    await advance(60_000);
    await advance(5 * 60_000);
    const afterRetries = invoke.mock.calls.length;
    await advance(10 * 60_000); // 还没到 30 分钟那一轮
    expect(invoke.mock.calls.length).toBe(afterRetries);
    expect(afterRetries).toBe(3); // 首检 + 两次重试
  });

  it("成功之后重试预算还回来 —— 长期开着的实例不该只有一次机会", async () => {
    let calls = 0;
    invoke = vi.fn(async (cmd: string) => {
      if (cmd === "check_for_update") {
        calls++;
        if (calls === 1) return null;      // 首检：已是最新
        if (calls === 2) throw new Error("blip"); // 30 分钟后抖了一下
        return available;
      }
      return null;
    });
    (globalThis as any).__TAURI__ = { core: { invoke } };
    vi.spyOn(console, "error").mockImplementation(() => {});

    render(<UpdateBanner />);
    await advance(FIRST_CHECK_MS + 100);
    await advance(RECHECK_MS);
    expect(screen.queryByTestId("update-banner")).toBeNull();
    await advance(60_000);
    expect(screen.getByTestId("update-banner")).toBeTruthy();
  });

  it("shows after the boot-settle check finds an update", async () => {
    render(<UpdateBanner />);
    expect(screen.queryByTestId("update-banner")).toBeNull();

    await advance(FIRST_CHECK_MS);
    expect(screen.getByTestId("update-banner").textContent).toContain("v1.2.0");
    // Pre-download resolved immediately → the button is ready and enabled.
    const btn = screen.getByTestId("update-install") as HTMLButtonElement;
    expect(btn.textContent).toBe("Restart to update");
    expect(btn.disabled).toBe(false);
  });

  it("Later hides the banner and a same-version re-check keeps it hidden", async () => {
    render(<UpdateBanner />);
    await advance(FIRST_CHECK_MS);

    fireEvent.click(screen.getByTestId("update-later"));
    expect(screen.queryByTestId("update-banner")).toBeNull();

    await advance(RECHECK_MS);
    expect(screen.queryByTestId("update-banner")).toBeNull();
  });

  it("a NEWER version found by a later check overrides the dismissal", async () => {
    render(<UpdateBanner />);
    await advance(FIRST_CHECK_MS);
    fireEvent.click(screen.getByTestId("update-later"));

    available = { version: "1.3.0", notes: "" };
    await advance(RECHECK_MS);
    expect(screen.getByTestId("update-banner").textContent).toContain("v1.3.0");
  });

  it("button reads Downloading… (disabled) until the pre-download resolves", async () => {
    let finish!: () => void;
    download = () => new Promise((resolve) => (finish = resolve));
    render(<UpdateBanner />);
    await advance(FIRST_CHECK_MS);

    const btn = screen.getByTestId("update-install") as HTMLButtonElement;
    expect(btn.textContent).toBe("Downloading…");
    expect(btn.disabled).toBe(true);

    await act(async () => finish());
    expect(btn.textContent).toBe("Restart to update");
    expect(btn.disabled).toBe(false);
  });

  it("a failed pre-download falls back to the enabled download-on-click path", async () => {
    download = () => Promise.reject(new Error("offline"));
    render(<UpdateBanner />);
    await advance(FIRST_CHECK_MS);

    const btn = screen.getByTestId("update-install") as HTMLButtonElement;
    expect(btn.textContent).toBe("Restart to update");
    expect(btn.disabled).toBe(false);

    fireEvent.click(btn);
    expect(invoke).toHaveBeenCalledWith("install_update", undefined);
  });
});
