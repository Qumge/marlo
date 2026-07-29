import { afterEach, describe, expect, it, vi, beforeEach } from "vitest";
import { cleanup, render, screen, fireEvent, waitFor } from "@testing-library/react";
import { ConnectSetup } from "./ManageTabs";
import type { Connector } from "../api";

// 「连接」设置页里的一键授权。
//
// 【这个文件是为一个真实的谎话建的】：AutoWhisper 的说明第一条写着
// 「一键：在浏览器里批准一次，之后不用再管」，而那一屏上【只有一个 token 输入框】。
// 后端的设备码流程（RFC 8628）一直是好的，但只有 agent 发起时能走到 ——
// 设置页的一键按钮只在 c.mcp 或 c.managed 时渲染，AutoWhisper 两者都不是，
// 它有的是 device_auth_base。于是文案承诺了界面做不到的事，用户读完去找按钮，找不到。

vi.mock("../api", async () => {
  const actual = await vi.importActual<typeof import("../api")>("../api");
  return {
    ...actual,
    connectDeviceBacked: vi.fn(async () => ({
      ok: true,
      started: true,
      user_code: "WDJB-MJHT",
      verification_uri: "https://autowhisper.xyz/en/device?user_code=WDJB-MJHT",
    })),
    connectMcpBacked: vi.fn(async () => ({ ok: true })),
    connectManaged: vi.fn(async () => ({ ok: true })),
    connectConnector: vi.fn(async () => ({ ok: true })),
    cloudStatus: vi.fn(async () => ({ signed_in: false })),
  };
});

const base = {
  name: "autowhisper",
  title: "AutoWhisper",
  connected: false,
  enabled: false,
  fields: [{ key: "api_token", label: "API token", secret: true, required: true }],
  instructions: ["One-click: approve once in the browser."],
  tools: [],
  device_auth: true,
  mcp: false,
  managed: false,
} as unknown as Connector;

// cloud={null}：没登录 OpenWorker Cloud。device_auth 这条路【本来就不该依赖它】——
// 授权页是我们自己的，token 直接落到本机，不过任何第三方。传 null 正好把这一点钉住。
afterEach(cleanup);
beforeEach(() => vi.clearAllMocks());

describe("设置页里的设备码一键", () => {
  it("device_auth 的连接器有一键按钮", async () => {
    render(<ConnectSetup c={base} cloud={null} onConnected={vi.fn()} />);
    expect(screen.getByTestId("device-connect")).toBeTruthy();
  });

  // 【非空对照】：没有 device_auth 的连接器不能凭空多出这个按钮 ——
  // 否则上面那条断言只是在证明"页面上有东西"，不是在证明分支条件对。
  it("没有 device_auth 的连接器不显示它", () => {
    render(<ConnectSetup c={{ ...base, device_auth: false } as Connector} cloud={null} onConnected={vi.fn()} />);
    expect(screen.queryByTestId("device-connect")).toBeNull();
  });

  // RFC 8628 的核对码必须显示出来。设备码流程要求用户比对浏览器里那串和
  // 屏幕上一致，才知道自己批准的是【这台】机器。只开浏览器不给码，
  // 等于让他闭着眼睛点同意。
  it("点了之后把核对码显示出来", async () => {
    render(<ConnectSetup c={base} cloud={null} onConnected={vi.fn()} />);
    fireEvent.click(screen.getByTestId("device-connect").querySelector("button")!);
    await waitFor(() => expect(screen.getByText("WDJB-MJHT")).toBeTruthy());
  });

  it("起不来要说原因，不能默默什么都不发生", async () => {
    const api = await import("../api");
    (api.connectDeviceBacked as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ok: false,
      error: "could not start sign-in: connection refused",
    });
    render(<ConnectSetup c={base} cloud={null} onConnected={vi.fn()} />);
    fireEvent.click(screen.getByTestId("device-connect").querySelector("button")!);
    await waitFor(() => expect(screen.getByText(/connection refused/)).toBeTruthy());
    // 失败时不能留下一个空的核对码位置，那会让人以为码没发出来是自己的问题
    expect(screen.queryByText("WDJB-MJHT")).toBeNull();
  });

  // 两条一键路径不能同时出现 —— 用户看到两个「一键连接」按钮不知道点哪个。
  it("device_auth 优先于 managed，不会同时渲染两个一键", () => {
    render(
      <ConnectSetup c={{ ...base, managed: true } as Connector} cloud={null} onConnected={vi.fn()} />,
    );
    expect(screen.getByTestId("device-connect")).toBeTruthy();
    expect(screen.queryByTestId("managed-connect")).toBeNull();
  });
});
