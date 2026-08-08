import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { render } from "@testing-library/react";

vi.mock("./api.qumge", () => ({
  getQumgeAccount: vi.fn(),
}));

import { getQumgeAccount } from "./api.qumge";
import {
  __resetAccountStore,
  setAccountPollFast,
  __accountPollMs,
  useQumgeAccount,
} from "./useQumgeAccount";

const SIGNED_IN = { signed_in: true, email: "a@b.c", balance: { balance_micro_usd: 0, balance: 0, currency: "USD", topup_url: "https://qumge.com/topup", low: true, can_spend: false } };

describe("useQumgeAccount store", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    __resetAccountStore();
    (getQumgeAccount as any).mockResolvedValue(SIGNED_IN);
  });
  afterEach(() => vi.useRealTimers());

  it("两个订阅者共用一个定时器 —— 一个周期只打一次接口", async () => {
    // 这条测的是这个模块存在的全部理由。两个组件各自轮询，就会在屏幕上
    // 显示互相矛盾的余额（BalanceChip.tsx:16-18 记过这个病）。
    const A = () => { useQumgeAccount(); return null; };
    const B = () => { useQumgeAccount(); return null; };
    render(<><A /><B /></>);
    await vi.waitFor(() => expect(getQumgeAccount).toHaveBeenCalled());
    (getQumgeAccount as any).mockClear();

    await vi.advanceTimersByTimeAsync(60_000);

    // 一个周期过去，只应该有一次请求。挂两个订阅者却打两次 = 两个定时器。
    expect((getQumgeAccount as any).mock.calls.length).toBe(1);
  });

  it("fast 模式把轮询间隔降到 5 秒，关掉后回到 60 秒", () => {
    expect(__accountPollMs()).toBe(60_000);
    setAccountPollFast(true);
    expect(__accountPollMs()).toBe(5_000);
    setAccountPollFast(false);
    expect(__accountPollMs()).toBe(60_000);
  });
});
