import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, fireEvent } from "@testing-library/react";
import { ConnectorRequestCard } from "./ConnectorRequestCard";

// 对话里的授权卡片。断言集中在【它必须说什么】和【它不能凭空说什么】——
// 这张卡片是用户交出邮箱访问权之前看到的最后一屏。

const base = {
  kind: "connreq" as const,
  connector: "outlook",
  title: "Outlook",
  reason: "读你上周的邮件，整理成一份周报",
  brokered_by: "",
};

afterEach(cleanup);

describe("对话里的授权卡片", () => {
  it("说清楚要连什么、为什么", () => {
    render(<ConnectorRequestCard item={base} onRespond={vi.fn()} />);
    expect(screen.getByTestId("connector-request").textContent).toContain("Outlook");
    expect(screen.getByText(/读你上周的邮件/)).toBeTruthy();
  });

  it("有中转方时必须写出来", () => {
    // 规格定死的一条：用户在点头【之前】就该知道 token 经谁的手。
    render(
      <ConnectorRequestCard item={{ ...base, brokered_by: "OpenWorker Cloud" }} onRespond={vi.fn()} />,
    );
    expect(screen.getByTestId("connector-broker").textContent).toContain("OpenWorker Cloud");
  });

  it("没有中转方时不凭空造一个", () => {
    // 本机直连的连接器（IMAP、粘 token 的那些）没有第三方经手。说"由 X 中转"
    // 是自己制造一个不信任的理由。
    render(<ConnectorRequestCard item={base} onRespond={vi.fn()} />);
    expect(screen.queryByTestId("connector-broker")).toBeNull();
  });

  it("拒绝和同意一样容易找到", () => {
    const onRespond = vi.fn();
    render(<ConnectorRequestCard item={base} onRespond={onRespond} />);
    fireEvent.click(screen.getByTestId("connector-decline"));
    expect(onRespond).toHaveBeenCalledWith(false);
  });

  it("同意后按钮立刻变成等待态，点不动", () => {
    // 浏览器要开、OAuth 要走，这中间有几秒到几十秒。按钮不变态的话用户会
    // 以为没反应然后再点一次——那会开出第二个授权流程。
    const onRespond = vi.fn();
    render(<ConnectorRequestCard item={base} onRespond={onRespond} />);
    const connect = screen.getByTestId("connector-connect");
    fireEvent.click(connect);
    fireEvent.click(connect);
    expect(onRespond).toHaveBeenCalledTimes(1);
    expect((connect as HTMLButtonElement).disabled).toBe(true);
  });

  it("自家服务把验证码印在卡片上", () => {
    // 用户要在浏览器打开的页面里核对同一串码 —— 这是防"点开的是另一个
    // 授权请求"的唯一手段。
    render(
      <ConnectorRequestCard
        item={{ ...base, connector: "autowhisper", title: "AutoWhisper",
                brokered_by: "", user_code: "K7M2-QP4X" }}
        onRespond={vi.fn()}
      />,
    );
    expect(screen.getByTestId("connector-user-code").textContent).toContain("K7M2-QP4X");
    // 自家服务没有第三方经手，不该出现中转方那一行
    expect(screen.queryByTestId("connector-broker")).toBeNull();
  });

  it("没有验证码时不留一个空框", () => {
    render(<ConnectorRequestCard item={base} onRespond={vi.fn()} />);
    expect(screen.queryByTestId("connector-user-code")).toBeNull();
  });
});
