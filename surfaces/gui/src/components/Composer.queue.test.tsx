// 一轮还在跑的时候按回车 —— 这条消息要【排队】，不能被静默吞掉。
//
// owner 2026-09-16 撞上的：回合跑着的时候输入框照样能打字，打完一整句按回车，
// 界面上什么都没发生 —— submit() 开头一个 `props.running && !props.gateOpen` 就
// return 了，发送键那会儿还被「停止」占着。没有提示、没有排队、没有报错，用户
// 只能理解成"发出去了"，而那句话再也不在了。对非程序员用户来说，这是最糟的一
// 类失败：界面什么都没说。
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { Composer } from "./Composer";
import type { Attachment } from "../types";

const READY_MIC = {
  recording: false,
  model_installed: true,
  model_verified: true,
  test_passed: true,
  download_in_progress: false,
  model_name: "Whisper Base English (local)",
  model_bytes: 147964211,
  supported: true,
  device_summary: "macOS 15 · Apple Silicon",
  compatibility_reason: null,
};

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

const box = () => screen.getByRole("textbox") as HTMLTextAreaElement;
const typeEnter = (text: string) => {
  fireEvent.change(box(), { target: { value: text } });
  fireEvent.keyDown(box(), { key: "Enter" });
};
const chips = () => screen.queryAllByTestId("queued-message");

afterEach(() => {
  cleanup();
  delete (globalThis as any).__TAURI__;
  vi.unstubAllGlobals();
});

describe("Composer —— 跑着的时候按回车：排队，不是丢掉", () => {
  it("草稿进队列，队列卡片看得见，这一刻什么都没发出去", () => {
    const onSend = vi.fn();
    render(<Composer {...base} onSend={onSend} running />);
    typeEnter("顺便把上个月的也算一遍");
    expect(onSend).not.toHaveBeenCalled(); // 这一轮还在跑，现在发不出去 —— 但也不能丢
    expect(chips()).toHaveLength(1);
    expect(chips()[0].textContent).toContain("顺便把上个月的也算一遍");
    expect(box().value).toBe(""); // 草稿被"收走"了，它现在在卡片里
  });

  it("跑着的时候输入框有字，发送键还在（按它也是排队）", () => {
    const onSend = vi.fn();
    render(<Composer {...base} onSend={onSend} running />);
    fireEvent.change(box(), { target: { value: "手按发送键" } });
    const queueBtn = screen.getByLabelText("Queue — sends when this reply finishes");
    fireEvent.click(queueBtn);
    expect(onSend).not.toHaveBeenCalled();
    expect(chips()).toHaveLength(1);
    // 「停止」不能因为多了个发送键就消失 —— 这一轮还得能停下来
    expect(screen.getByRole("button", { name: /Stop/ })).toBeTruthy();
  });

  it("这一轮结束，排队的那句自己发出去 —— 只发一次", async () => {
    const onSend = vi.fn();
    const { rerender } = render(<Composer {...base} onSend={onSend} running />);
    typeEnter("等你忙完再说这句");
    rerender(<Composer {...base} onSend={onSend} running={false} />);
    await waitFor(() => expect(onSend).toHaveBeenCalledWith("等你忙完再说这句", [], undefined));
    expect(onSend).toHaveBeenCalledTimes(1);
    expect(chips()).toHaveLength(0);
  });

  it("再结束一次（turn_done 重放 / 又跑一轮）不会重发", async () => {
    const onSend = vi.fn();
    const { rerender } = render(<Composer {...base} onSend={onSend} running />);
    typeEnter("只应该出现一次");
    rerender(<Composer {...base} onSend={onSend} running={false} />);
    await waitFor(() => expect(onSend).toHaveBeenCalledTimes(1));
    // 发出去的那一轮跑起来又结束；以及同一个 running=false 再落一次
    rerender(<Composer {...base} onSend={onSend} running />);
    rerender(<Composer {...base} onSend={onSend} running={false} />);
    rerender(<Composer {...base} onSend={onSend} running={false} />);
    await waitFor(() => expect(onSend).toHaveBeenCalledTimes(1));
  });

  it("取消：原样放回输入框，并且从没发出去过", async () => {
    const onSend = vi.fn();
    const { rerender } = render(<Composer {...base} onSend={onSend} running />);
    typeEnter("算了，我再想想");
    fireEvent.click(screen.getByTestId("queued-cancel"));
    expect(box().value).toBe("算了，我再想想");
    expect(chips()).toHaveLength(0);
    rerender(<Composer {...base} onSend={onSend} running={false} />);
    await waitFor(() => expect(box().value).toBe("算了，我再想想"));
    expect(onSend).not.toHaveBeenCalled(); // 取消掉的东西不会在回合结束时偷偷冒出来
  });

  it("按下停止：排队的那句退回输入框，绝不趁着回合结束发出去", async () => {
    const onSend = vi.fn();
    const onInterrupt = vi.fn();
    const { rerender } = render(
      <Composer {...base} onSend={onSend} onInterrupt={onInterrupt} running />,
    );
    typeEnter("停一下，我改主意了");
    fireEvent.click(screen.getByRole("button", { name: /Stop/ }));
    expect(onInterrupt).toHaveBeenCalledTimes(1);
    expect(box().value).toBe("停一下，我改主意了");
    expect(chips()).toHaveLength(0);
    rerender(<Composer {...base} onSend={onSend} onInterrupt={onInterrupt} running={false} />);
    await waitFor(() => expect(box().value).toBe("停一下，我改主意了"));
    expect(onSend).not.toHaveBeenCalled();
  });

  it("第二句照样排队，不会被吞掉", async () => {
    const onSend = vi.fn();
    const { rerender } = render(<Composer {...base} onSend={onSend} running />);
    typeEnter("第一句");
    typeEnter("第二句");
    expect(chips()).toHaveLength(2);
    // 真实的 App 里第一句发出去会把 running 重新拨成 true，所以第二句要等下一轮结束；
    // 这里 running 一直是 false，于是两句依次发出 —— 顺序是入队的顺序。
    rerender(<Composer {...base} onSend={onSend} running={false} />);
    await waitFor(() => expect(onSend).toHaveBeenCalledTimes(2));
    expect(onSend.mock.calls[0][0]).toBe("第一句");
    expect(onSend.mock.calls[1][0]).toBe("第二句");
  });

  it("换会话：排队的消息不会跟到下一个会话里去", async () => {
    const onSend = vi.fn();
    const { rerender } = render(<Composer {...base} onSend={onSend} running resetKey="s1" />);
    typeEnter("这句属于 s1");
    expect(chips()).toHaveLength(1);
    rerender(<Composer {...base} onSend={onSend} running={false} resetKey="s2" />);
    await waitFor(() => expect(chips()).toHaveLength(0));
    expect(onSend).not.toHaveBeenCalled();
    expect(box().value).toBe("");
  });

  it("审批闸门开着的时候照旧【立刻发】 —— 那条路不排队", () => {
    const onSend = vi.fn();
    render(<Composer {...base} onSend={onSend} running gateOpen />);
    typeEnter("不同意，换个做法");
    expect(onSend).toHaveBeenCalledTimes(1);
    expect(chips()).toHaveLength(0);
  });
});

describe("Composer 排队 —— 附件和 /技能 跟着一起走", () => {
  const ATT: Attachment = { kind: "text", name: "notes.txt", text: "hello" };

  it("附件跟着排队，回合结束和消息一起发出去", async () => {
    const onSend = vi.fn();
    const { rerender } = render(
      <Composer {...base} onSend={onSend} running prefill={{ text: "看看这个", attachments: [ATT], nonce: 1 }} />,
    );
    await waitFor(() => expect(box().value).toBe("看看这个"));
    fireEvent.keyDown(box(), { key: "Enter" });
    expect(chips()).toHaveLength(1);
    expect(chips()[0].textContent).toContain("notes.txt"); // 卡片上看得见它带着附件
    rerender(
      <Composer {...base} onSend={onSend} running={false} prefill={{ text: "看看这个", attachments: [ATT], nonce: 1 }} />,
    );
    await waitFor(() => expect(onSend).toHaveBeenCalledWith("看看这个", [ATT], undefined));
  });

  it("/技能 前缀跟着排队；取消之后前缀还认得，再发还是带着技能", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) =>
        url.includes("/skills")
          ? ({ ok: true, json: async () => ({ skills: [{ name: "greet", description: "says hello", scope: "global", enabled: true }] }) } as Response)
          : ({ ok: true, json: async () => ({}) } as Response),
      ),
    );
    const onSend = vi.fn();
    const { rerender } = render(<Composer {...base} onSend={onSend} running sessionId="s1" />);
    fireEvent.change(box(), { target: { value: "/gr" } });
    fireEvent.click(await screen.findByRole("option", { name: /greet/ }));
    fireEvent.change(box(), { target: { value: "/greet 打个招呼" } });
    fireEvent.keyDown(box(), { key: "Enter" });
    expect(chips()).toHaveLength(1);
    expect(chips()[0].textContent).toContain("/greet 打个招呼");

    // 取消 → 原样回到输入框，技能前缀仍然是"选中的技能"而不是一串普通文字
    fireEvent.click(screen.getByTestId("queued-cancel"));
    expect(box().value).toBe("/greet 打个招呼");
    fireEvent.keyDown(box(), { key: "Enter" }); // 还在跑 —— 再次排队
    expect(chips()).toHaveLength(1);
    rerender(<Composer {...base} onSend={onSend} running={false} sessionId="s1" />);
    await waitFor(() => expect(onSend).toHaveBeenCalledWith("打个招呼", [], "greet"));
  });
});

describe("Composer 排队 —— 真正发出去的那一刻，闸门再问一遍", () => {
  it("断线：不发，留在队列里；连上了再发", async () => {
    const onSend = vi.fn();
    const { rerender } = render(<Composer {...base} onSend={onSend} running />);
    typeEnter("断线的时候排的队");
    rerender(<Composer {...base} onSend={onSend} running={false} connected={false} />);
    await waitFor(() => expect(chips()).toHaveLength(1));
    expect(onSend).not.toHaveBeenCalled();
    rerender(<Composer {...base} onSend={onSend} running={false} connected />);
    await waitFor(() => expect(onSend).toHaveBeenCalledWith("断线的时候排的队", [], undefined));
  });

  it("没配模型：不发，把这句退回输入框，并把人送去设置", async () => {
    const onSend = vi.fn();
    const onConnectModel = vi.fn();
    const { rerender } = render(
      <Composer {...base} onSend={onSend} onConnectModel={onConnectModel} running modelReady={false} />,
    );
    typeEnter("排队时模型还没配");
    rerender(
      <Composer {...base} onSend={onSend} onConnectModel={onConnectModel} running={false} modelReady={false} />,
    );
    await waitFor(() => expect(onConnectModel).toHaveBeenCalled());
    expect(onSend).not.toHaveBeenCalled();
    expect(box().value).toBe("排队时模型还没配"); // 退回草稿，不是消失
    expect(chips()).toHaveLength(0);
  });

  it("余额闸门：不发，退回草稿并把充值卡摆出来", async () => {
    const onSend = vi.fn();
    const onTopUp = vi.fn();
    const card = <div data-testid="topup-card" />;
    const { rerender } = render(
      <Composer {...base} onSend={onSend} onTopUp={onTopUp} topUpSlot={card} running canSpend={false} />,
    );
    typeEnter("这条要花钱");
    expect(screen.queryByTestId("topup-card")).toBeNull(); // 排队的时候不谈钱
    rerender(
      <Composer {...base} onSend={onSend} onTopUp={onTopUp} topUpSlot={card} running={false} canSpend={false} />,
    );
    await waitFor(() => expect(screen.getByTestId("topup-card")).toBeTruthy());
    expect(onSend).not.toHaveBeenCalled();
    expect(onTopUp).toHaveBeenCalled();
    expect(box().value).toBe("这条要花钱");
  });

  it("正在口述：不发；说完了再发", async () => {
    const invoke = vi.fn(async (cmd: string) => {
      if (cmd === "get_dictation_status") return READY_MIC;
      if (cmd === "start_dictation") return { ...READY_MIC, recording: true };
      if (cmd === "stop_dictation") return "";
      return null;
    });
    (globalThis as any).__TAURI__ = { core: { invoke }, event: { listen: async () => () => {} } };
    const onSend = vi.fn();
    const { rerender } = render(<Composer {...base} onSend={onSend} running />);
    typeEnter("排完队又去按了麦克风");
    fireEvent.click(await screen.findByLabelText("Start dictation"));
    await screen.findByLabelText("Stop dictation");

    rerender(<Composer {...base} onSend={onSend} running={false} />);
    await waitFor(() => expect(chips()).toHaveLength(1));
    expect(onSend).not.toHaveBeenCalled(); // 人还在对着麦克风说话，不能替他发

    invoke.mockImplementation(async (cmd: string) =>
      cmd === "stop_dictation" ? "" : cmd === "get_dictation_status" ? READY_MIC : null,
    );
    fireEvent.click(screen.getByLabelText("Stop dictation"));
    await waitFor(() => expect(onSend).toHaveBeenCalledWith("排完队又去按了麦克风", [], undefined));
  });
});
