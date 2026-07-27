// e2e 里 Qumge 账号的假状态与假路由。
//
// 单独一个文件不是分类癖。fixtures.ts 是上游改得最勤的文件之一（分叉至今 11
// 次）—— 他们每加一个功能就往那张路由表里加一条，而我们的 67 行正好夹在
// 中间，是典型的"同一段代码两边都在长"。新文件永远不会冲突。
//
// `seedCloudSignedIn` 【不】在这里：它操作的是上游的 CLOUD_STATE，搬过来就得
// 反向 import fixtures.ts，形成循环。七行留在原处比一个循环依赖便宜。

/** 侧栏底部那个账号行背后的状态：谁登录了、还剩多少。
 *
 * `signed_in` 在真实 sidecar 里来自磁盘上的 key，所以这里即使 balance 是
 * null 它也保持 true —— 离线不等于登出，那正是账号行修复的那个 bug。 */
export const QUMGE_STATE = {
  signed_in: true,
  email: "someone@example.com",
  balance: {
    balance_micro_usd: 19_120_000,
    balance: 19.12,
    currency: "USD",
    topup_url: "https://qumge.com/en/gateway/topup/new",
    low: false,
  } as Record<string, unknown> | null,
};

/** 每个用例开始前恢复默认。模块级状态活得比一个 page 长。 */
export function resetQumgeState(): void {
  Object.assign(QUMGE_STATE, {
    signed_in: true,
    email: "someone@example.com",
    balance: {
      balance_micro_usd: 19_120_000,
      balance: 19.12,
      currency: "USD",
      topup_url: "https://qumge.com/en/gateway/topup/new",
      low: false,
    },
  });
}

/** Qumge 相关的三条路由。命中返回 fulfil 的 Promise，没命中返回 null。
 *
 * `json` 由调用方传入而不是在这里重建：它闭包着那次请求的 route 对象。 */
export function qumgeRoute(
  p: string,
  m: string,
  json: (body: unknown, status?: number) => Promise<void>,
): Promise<void> | null {
  if (p.endsWith("/v1/qumge/account")) return json({ ...QUMGE_STATE });
  if (p.endsWith("/v1/qumge/balance")) return json({ balance: QUMGE_STATE.balance });
  if (p.endsWith("/v1/providers/qumge") && m === "DELETE") {
    // 账号行的「退出登录」做的事：把 key 丢掉。账号相关的一切跟着走，
    // 包括余额 —— 给一个已经登出的账号显示旧数字，比不显示更糟。
    Object.assign(QUMGE_STATE, { signed_in: false, email: null, balance: null });
    return json({ ok: true });
  }
  return null;
}
