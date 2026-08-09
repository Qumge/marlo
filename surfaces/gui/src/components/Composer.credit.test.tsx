import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, fireEvent } from "@testing-library/react";
import { Composer } from "./Composer";

afterEach(() => {
  cleanup();
});

const base = {
  mode: "interactive",
  model: "gpt-5.6-sol",
  connected: true,
  running: false,
  modelReady: true,
  onSend: vi.fn(),
  onInterrupt: vi.fn(),
  onModeChange: vi.fn(),
  onModelChange: vi.fn(),
};

const type = (text: string) => {
  const box = screen.getByRole("textbox");
  fireEvent.change(box, { target: { value: text } });
  fireEvent.keyDown(box, { key: "Enter" });
};

describe("composer 余额闸门", () => {
  it("canSpend=false 时不发送，草稿留在框里", () => {
    const onSend = vi.fn();
    render(<Composer {...base} onSend={onSend} canSpend={false} onTopUp={vi.fn()} />);
    type("帮我把发票按月分组");
    expect(onSend).not.toHaveBeenCalled();
    expect((screen.getByRole("textbox") as HTMLTextAreaElement).value).toBe("帮我把发票按月分组");
  });

  it("canSpend=undefined（离线／老 sidecar／自带 key）照常发送", () => {
    const onSend = vi.fn();
    render(<Composer {...base} onSend={onSend} />);
    type("照常发");
    expect(onSend).toHaveBeenCalledOnce();
  });

  it("canSpend=true 照常发送", () => {
    const onSend = vi.fn();
    render(<Composer {...base} onSend={onSend} canSpend={true} />);
    type("有钱");
    expect(onSend).toHaveBeenCalledOnce();
  });

  it("卡片不是常驻横幅 —— 打字期间不出现，按回车才出现", () => {
    render(<Composer {...base} canSpend={false} topUpSlot={<div data-testid="card" />} />);
    const box = screen.getByRole("textbox");
    fireEvent.change(box, { target: { value: "还在打字" } });
    expect(screen.queryByTestId("card")).toBeNull();
    fireEvent.keyDown(box, { key: "Enter" });
    expect(screen.getByTestId("card")).toBeTruthy();
  });

  it("充值回来后卡片自己消失，草稿还在，且从没自动发送过", () => {
    const onSend = vi.fn();
    const { rerender } = render(
      <Composer {...base} onSend={onSend} canSpend={false} topUpSlot={<div data-testid="card" />} />,
    );
    type("充值前打的字");
    expect(screen.getByTestId("card")).toBeTruthy();
    rerender(
      <Composer {...base} onSend={onSend} canSpend={true} topUpSlot={<div data-testid="card" />} />,
    );
    expect(screen.queryByTestId("card")).toBeNull();
    expect((screen.getByRole("textbox") as HTMLTextAreaElement).value).toBe("充值前打的字");
    // 这是这张卡片存在的全部意义：credit 自己回来了，绝不能替用户按下回车 ——
    // 那是在替他花钱。恢复之后只应该是"可以发了"，从来不是"已经发了"。
    expect(onSend).not.toHaveBeenCalled();
  });

  it("没连模型时先谈模型，不谈余额", () => {
    const onConnectModel = vi.fn();
    const onTopUp = vi.fn();
    render(<Composer {...base} modelReady={false} onConnectModel={onConnectModel} canSpend={false} onTopUp={onTopUp} />);
    type("两个闸门都关着");
    expect(onConnectModel).toHaveBeenCalledOnce();
    expect(onTopUp).not.toHaveBeenCalled();
  });
});
