# Onboarding 零余额串联 —— marlo 侧实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让零余额的新用户在**发消息之前**就知道要充值，并且在他充值回来后无缝继续 —— 而不是撞上一条网关生错误。

**Architecture:** 三层闸门，判据全部在服务端（`balance.py` 出 `can_spend`），GUI 只渲染。第一层在 composer 按回车那一刻拦住并保住草稿；第二层是已有的余额 chip，只需让它早一分钟出现；第三层把网关 402 翻译成带充值按钮的人话。另加设备面板的注册说明、跨平台文案、README。

**Tech Stack:** Python 3.10+ / FastAPI（sidecar）、React + TypeScript + Vite（GUI）、pytest、vitest、Playwright

**配套 spec:** `docs/superpowers/specs/2026-08-08-onboarding-zero-balance-design.md`

**姊妹计划:** 站点侧的文案改动在 qumge 的内部仓库，可独立先发（而且应该先发）。

## Global Constraints

- **判据只写一次，写在服务端。** GUI 里不得出现 `balance === 0`、`< 1_000_000` 之类的阈值比较；一律读服务端给的布尔字段。理由见 `coworker/qumge/balance.py:90-93`。
- **拿不到余额 = 不拦。** `fetch()` 返回 `None` 时 GUI 必须照常发送。挡住一个有钱的老用户，比让他撞一次第三层更糟。
- **闸门只对 Qumge 模型生效。** 判据是 `model.startsWith("qumge:")`。裸模型 id 属于 OpenAI（`coworker/server/manager.py:1622`），所以前缀测试是精确的。
- **不碰 `App.tsx` 的结构。** 那是上游活跃维护的文件；本计划只允许在已有的 `<Composer>` 调用点增加 prop。新逻辑一律进新文件。
- **上游文件加新东西 → 开新文件。** 沿用 `AccountRow.tsx:10-12`、`api.qumge.ts:1-8` 写明的策略。
- **本机跑 pytest 的基线是 5 failed**，不是 0。那 5 条与本计划无关，不要去修。
- **本机跑 e2e 必须绕代理：** `NO_PROXY="localhost,127.0.0.1" no_proxy="localhost,127.0.0.1" npm run e2e`。报 `Timed out waiting 120000ms from config.webServer` 就是没加，**不要改 `playwright.config.ts`**。
- 命令一律从仓库根目录起：Python 用 `.venv/bin/pytest`，GUI 用 `cd surfaces/gui && npx vitest run ...`。

---

### Task 1: `can_spend` —— 服务端判据

**Files:**
- Modify: `coworker/qumge/balance.py:78-95`（`fetch()` 的返回 dict）
- Test: `tests/test_qumge_balance.py`

**Interfaces:**
- Consumes: 无
- Produces: `fetch()` 返回的 dict 多一个键 `can_spend: bool`（`micro > 0`）。`fetch()` 返回 `None` 时**不存在**这个键 —— 这是 Task 3 的「拿不到就不拦」赖以成立的前提。

- [ ] **Step 1: 写失败的测试**

加到 `tests/test_qumge_balance.py` 末尾（`_signed_in` / `_stub` 两个 helper 已在文件顶部）：

```python
def test_can_spend_is_true_with_credit(monkeypatch):
    _stub(monkeypatch, payload={"balance_micro_usd": 2_500_000, "currency": "USD"})
    assert qb.fetch(_signed_in())["can_spend"] is True


def test_can_spend_is_false_at_exactly_zero(monkeypatch):
    """新注册账号就是这个状态 —— 第一层闸门唯一会触发的场景。"""
    _stub(monkeypatch, payload={"balance_micro_usd": 0, "currency": "USD"})
    bal = qb.fetch(_signed_in())
    assert bal["can_spend"] is False
    assert bal["low"] is True  # 两层叠加，不互斥


def test_unknown_balance_carries_no_can_spend_at_all(monkeypatch):
    """None 而不是 {"can_spend": False}。GUI 的「拿不到就不拦」整条规则
    都建立在这上面：没有这个键，就没有任何东西能把闸门关上。"""
    _stub(monkeypatch, raises=httpx.ConnectError("offline"))
    assert qb.fetch(_signed_in()) is None
```

- [ ] **Step 2: 跑测试，确认它失败**

Run: `.venv/bin/pytest tests/test_qumge_balance.py -k can_spend -v`
Expected: FAIL — `KeyError: 'can_spend'`

- [ ] **Step 3: 实现**

`coworker/qumge/balance.py`，在 `low` 那一行下面加一行（同一个返回 dict 内）：

```python
        # The threshold is here, not in the GUI, so the warning and the number it
        # is based on cannot drift apart. A dollar is roughly a handful of turns
        # on a good model — enough warning to act, not so much that it nags.
        "low": micro < 1_000_000,
        # Whether a request is worth attempting at all. Separate from `low` on
        # purpose: `low` warns without blocking, this one gates. Kept server-side
        # for the same reason the threshold is — so a future "gate below one
        # turn's estimated cost" changes one line here and nothing in the GUI.
        "can_spend": micro > 0,
```

- [ ] **Step 4: 跑测试，确认通过**

Run: `.venv/bin/pytest tests/test_qumge_balance.py -v`
Expected: PASS（全文件）

- [ ] **Step 5: 提交**

```bash
git add coworker/qumge/balance.py tests/test_qumge_balance.py
git commit -m "feat(qumge): balance 带上 can_spend 判据"
```

---

### Task 2: `useQumgeAccount` —— 一个时钟

**Files:**
- Create: `surfaces/gui/src/useQumgeAccount.ts`
- Create: `surfaces/gui/src/useQumgeAccount.test.ts`
- Modify: `surfaces/gui/src/components/AccountRow.tsx:60-80`（删掉自有轮询，改用 hook）

**Interfaces:**
- Consumes: Task 1 的 `can_spend`（经由已有的 `QumgeBalance` 类型）
- Produces:
  - `useQumgeAccount(): QumgeAccount` —— 订阅单例状态
  - `setAccountPollFast(fast: boolean): void` —— 拦截卡片可见期间调 `true`，降到 5 秒
  - `refreshQumgeAccount(): void` —— 立即刷一次
  - `QumgeBalance` 接口在 `api.qumge.ts` 里加 `can_spend: boolean`

- [ ] **Step 1: 给 `QumgeBalance` 加字段**

`surfaces/gui/src/api.qumge.ts`，在 `low` 后面：

```ts
export interface QumgeBalance {
  balance_micro_usd: number;
  balance: number;
  currency: string;
  topup_url: string;
  low: boolean;
  // Whether a request is worth attempting. Server-side judgement (balance.py) —
  // the GUI never recomputes it from the number beside it. ABSENT on an older
  // sidecar, which is why every consumer must treat `undefined` as "don't gate".
  can_spend?: boolean;
}
```

- [ ] **Step 2: 写失败的测试**

`surfaces/gui/src/useQumgeAccount.test.ts`：

```ts
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";

vi.mock("./api.qumge", () => ({
  getQumgeAccount: vi.fn(),
}));

import { getQumgeAccount } from "./api.qumge";
import { __resetAccountStore, refreshQumgeAccount, setAccountPollFast, __accountPollMs } from "./useQumgeAccount";

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
```

- [ ] **Step 3: 跑测试，确认它失败**

Run: `cd surfaces/gui && npx vitest run src/useQumgeAccount.test.ts`
Expected: FAIL — 模块不存在

- [ ] **Step 4: 实现 hook**

`surfaces/gui/src/useQumgeAccount.ts`：

```ts
import { useEffect, useState } from "react";
import { getQumgeAccount, type QumgeAccount } from "./api.qumge";
import { CLOUD_CHANGED } from "./api";

// 侧栏账号行和 composer 的余额闸门读的是同一个数。让它们各自轮询，就是
// BalanceChip.tsx:16-18 骂过的那件事：
//
//   Two components polling the same endpoint on independent clocks is how a row
//   and the number beside it end up disagreeing on screen for up to a minute.
//
// 所以状态是模块级的单例，定时器只有一个，组件只订阅。
//
// 不放进 App.tsx：那是上游活跃维护的文件（api.qumge.ts:1-8 写过同一条理由）。

const SLOW_MS = 60_000;
const FAST_MS = 5_000; // 拦截卡片可见时 —— 用户正在别处付款，等他回来的每一秒都算数

const SIGNED_OUT: QumgeAccount = { signed_in: false, email: null, balance: null };

let account: QumgeAccount = SIGNED_OUT;
let timer: ReturnType<typeof setInterval> | null = null;
let fast = false;
const listeners = new Set<(a: QumgeAccount) => void>();

export function __accountPollMs(): number {
  return fast ? FAST_MS : SLOW_MS;
}

export function refreshQumgeAccount(): void {
  void getQumgeAccount()
    .then((a) => {
      account = a;
      listeners.forEach((fn) => fn(a));
    })
    .catch(() => {});
}

function restartTimer(): void {
  if (timer !== null) clearInterval(timer);
  timer = listeners.size > 0 ? setInterval(refreshQumgeAccount, __accountPollMs()) : null;
}

/** 拦截卡片挂载时开、卸载时关。开着的时候轮询降到 5 秒，这样用户在别的设备上
 *  充完值（app 从没失去焦点、focus 事件不会触发）也能在几秒内自动解锁。 */
export function setAccountPollFast(next: boolean): void {
  if (fast === next) return;
  fast = next;
  if (next) refreshQumgeAccount(); // 别让用户等满一个间隔
  restartTimer();
}

/** 测试用：把单例打回初始状态。 */
export function __resetAccountStore(): void {
  account = SIGNED_OUT;
  fast = false;
  listeners.clear();
  if (timer !== null) clearInterval(timer);
  timer = null;
}

export function useQumgeAccount(): QumgeAccount {
  const [snapshot, setSnapshot] = useState(account);

  useEffect(() => {
    listeners.add(setSnapshot);
    restartTimer();
    refreshQumgeAccount();

    const onExternal = () => refreshQumgeAccount();
    window.addEventListener("focus", onExternal);
    window.addEventListener(CLOUD_CHANGED, onExternal);
    return () => {
      listeners.delete(setSnapshot);
      restartTimer();
      window.removeEventListener("focus", onExternal);
      window.removeEventListener(CLOUD_CHANGED, onExternal);
    };
  }, []);

  return snapshot;
}
```

- [ ] **Step 5: 跑测试，确认通过**

Run: `cd surfaces/gui && npx vitest run src/useQumgeAccount.test.ts`
Expected: PASS

- [ ] **Step 6: `AccountRow` 改用它**

`surfaces/gui/src/components/AccountRow.tsx` —— 删掉本地的 `account` state、`refreshAccount`、以及整个 `useEffect`（第 64-76 行那一段），换成：

```tsx
  const account = useQumgeAccount();
```

import 相应改成 `import { qumgeSignOut, type QumgeAccount } from "../api.qumge";` 加上 `import { refreshQumgeAccount, useQumgeAccount } from "../useQumgeAccount";`。文件里原本调 `refreshAccount()` 的地方（登出后那次）改成 `refreshQumgeAccount()`。

- [ ] **Step 7: 跑账号行的既有测试，确认没回归**

Run: `cd surfaces/gui && npx vitest run src/components/Sidebar.account.test.tsx`
Expected: PASS

- [ ] **Step 8: 提交**

```bash
git add surfaces/gui/src/useQumgeAccount.ts surfaces/gui/src/useQumgeAccount.test.ts \
        surfaces/gui/src/api.qumge.ts surfaces/gui/src/components/AccountRow.tsx
git commit -m "refactor(gui): 账号状态收进单例 hook，一个时钟"
```

---

### Task 3: 第一层 —— 发消息前拦住

**Files:**
- Create: `surfaces/gui/src/components/TopUpCard.tsx`
- Modify: `surfaces/gui/src/components/Composer.tsx:60-96`（props）、`:320-339`（send 分支）
- Modify: `surfaces/gui/src/App.tsx:1634` 附近（只加 prop）
- Modify: `surfaces/gui/src/i18n/en.ts`、`zh.ts`
- Test: `surfaces/gui/src/components/Composer.credit.test.tsx`

**Interfaces:**
- Consumes: Task 2 的 `useQumgeAccount()` / `setAccountPollFast()`；`QumgeBalance.can_spend`
- Produces: `<Composer>` 多三个可选 prop —— `canSpend?: boolean`、`onTopUp?: () => void`、`topUpSlot?: ReactNode`；`<TopUpCard balance onUseOwnKey />`

**卡片按回车才出现**（owner 裁定 2026-08-09）。余额为 0 不等于立刻弹卡片：用户可能只是进来看看历史会话。拦截发生在他打完字、按下回车的那一刻 —— 那时「要花钱」这句话才落在一个具体的意图上。侧栏那个 `$0.00` chip 已经在做「常驻提醒」，卡片再做一遍就是重复。

所以 Composer 内部有一个 `gated` 状态：初始 false，被闸门置 true，草稿清空或 `canSpend` 不再是 false 时归位。

- [ ] **Step 1: 加文案键**

`surfaces/gui/src/i18n/en.ts`（放在 qumge device flow 那一段附近）：

```ts
  creditNeededTitle: "Add credit to run this",
  creditNeededBody: "Pay for what you use — no subscription.",
  addCredit2: "Add credit",
  useOwnKeyShort: "Use my own key",
```

`surfaces/gui/src/i18n/zh.ts` 同名键：

```ts
  creditNeededTitle: "充值后就能跑这一单",
  creditNeededBody: "按用量扣费，不订阅。",
  addCredit2: "去充值",
  useOwnKeyShort: "用我自己的 key",
```

- [ ] **Step 2: 写失败的测试**

`surfaces/gui/src/components/Composer.credit.test.tsx`：

```tsx
import { describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { Composer } from "./Composer";

const base = {
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
    expect(screen.getByRole("textbox")).toHaveValue("帮我把发票按月分组");
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
    expect(screen.getByTestId("card")).toBeInTheDocument();
  });

  it("充值回来后卡片自己消失，草稿还在", () => {
    const { rerender } = render(
      <Composer {...base} canSpend={false} topUpSlot={<div data-testid="card" />} />,
    );
    type("充值前打的字");
    expect(screen.getByTestId("card")).toBeInTheDocument();
    rerender(<Composer {...base} canSpend={true} topUpSlot={<div data-testid="card" />} />);
    expect(screen.queryByTestId("card")).toBeNull();
    expect(screen.getByRole("textbox")).toHaveValue("充值前打的字");
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
```

- [ ] **Step 3: 跑测试，确认它失败**

Run: `cd surfaces/gui && npx vitest run src/components/Composer.credit.test.tsx`
Expected: FAIL —— 第一条会失败，因为 `onSend` 被调用了

- [ ] **Step 4: 写 `TopUpCard`**

`surfaces/gui/src/components/TopUpCard.tsx`：

```tsx
import { useEffect } from "react";
import { type QumgeBalance } from "../api.qumge";
import { setAccountPollFast } from "../useQumgeAccount";
import { openExternal } from "../tauri";
import { useT } from "../i18n";

// 余额为 0 时挡在 composer 上方的那张卡片。
//
// 它是【卡片不是 modal】，因为用户刚打完一句话：modal 会正好盖住输入框，制造
// 「我打的字还在吗」这一秒的焦虑，而这个闸门存在的全部理由就是不让他觉得白打了。
//
// 挂载期间把账号轮询降到 5 秒（卸载时还原）。用户去浏览器充值，回到 app 时
// focus 会立刻刷一次；但他也可能在手机上扫码付款——那时 app 从没失去过焦点，
// focus 不触发，只有这个快轮询能把他解锁。
export function TopUpCard({
  balance,
  onUseOwnKey,
}: {
  balance: QumgeBalance;
  onUseOwnKey: () => void;
}) {
  const t = useT();

  useEffect(() => {
    setAccountPollFast(true);
    return () => setAccountPollFast(false);
  }, []);

  return (
    <div
      className="mb-2 rounded-xl2 border border-line bg-paper px-4 py-3"
      data-testid="topup-card"
    >
      <div className="text-[13px] font-semibold text-ink">
        {t("creditNeededTitle")}
      </div>
      <div className="text-[12.5px] text-muted mt-0.5">
        ${balance.balance.toFixed(2)} · {t("creditNeededBody")}
      </div>
      <div className="flex items-center gap-2 mt-2.5">
        <button
          className="px-4 py-1.5 rounded-full bg-ink text-panel text-[12.5px]"
          data-testid="topup-go"
          onClick={() => openExternal(balance.topup_url)}
        >
          {t("addCredit2")}
        </button>
        <button
          className="px-4 py-1.5 rounded-full border border-line text-[12.5px] text-muted hover:text-ink"
          data-testid="topup-own-key"
          onClick={onUseOwnKey}
        >
          {t("useOwnKeyShort")}
        </button>
      </div>
    </div>
  );
}
```

- [ ] **Step 5: 给 `Composer` 加 props 和闸门**

`surfaces/gui/src/components/Composer.tsx` —— 在 `modelReady` / `onConnectModel` 那两行下面加：

```ts
  // False when the active Qumge model's account has zero credit — keeps the draft
  // and shows the top-up card instead of sending. Undefined = not applicable or not
  // known (BYO-key provider, offline, older sidecar) and never gates.
  canSpend?: boolean;
  onTopUp?: () => void;
```

在 `needsModel` 的判断后面（`props.onSend(...)` 之前）加：

```ts
    // Credit gate. AFTER needsModel on purpose: with no model connected, talking
    // about money answers a question the user has not reached yet.
    //
    // Flipping `gated` here — rather than deriving the card's visibility from
    // canSpend alone — is what makes this an interception instead of a banner.
    // A zero balance is not itself a reason to interrupt someone who has not
    // asked for anything yet; the sidebar chip already carries that standing
    // notice. The card earns its interruption at the moment the user commits
    // to a request, with the request still on screen.
    if (props.canSpend === false) {
      setGated(true);
      props.onTopUp?.();
      return;
    }
```

组件内部状态，以及它归位的两个条件：

```ts
  const [gated, setGated] = useState(false);

  // 充值回来（canSpend 不再是 false）或者草稿被清空（发出去了/换会话了），
  // 这张卡片就没有理由继续占着位置。
  useEffect(() => {
    if (props.canSpend !== false || !text.trim()) setGated(false);
  }, [props.canSpend, text]);
```

并在 textarea 所在容器**上方**渲染 `{gated && props.topUpSlot}`（见下一步 —— 卡片由 `App.tsx` 传进来，`Composer` 不认识 `QumgeBalance`，保持它对 qumge 无知）。相应在 props 里再加一行：

```ts
  // Rendered above the input when canSpend === false. Passed in rather than built
  // here so Composer stays ignorant of Qumge — it only knows "gated / not gated".
  topUpSlot?: ReactNode;
```

- [ ] **Step 6: `App.tsx` 接线**

在 `App.tsx` 里 `<Composer` 的 `modelReady={modelReady}` 那一行下面加三行（**只加 prop，不改结构**）：

```tsx
              canSpend={
                model.startsWith("qumge:") ? qumgeAccount.balance?.can_spend : undefined
              }
              topUpSlot={
                qumgeAccount.balance ? (
                  <TopUpCard balance={qumgeAccount.balance} onUseOwnKey={openModelSetup} />
                ) : undefined
              }
```

组件顶部加 `const qumgeAccount = useQumgeAccount();`，以及两个 import：

```tsx
import { TopUpCard } from "./components/TopUpCard";
import { useQumgeAccount } from "./useQumgeAccount";
```

- [ ] **Step 7: 跑测试，确认通过**

Run: `cd surfaces/gui && npx vitest run src/components/Composer.credit.test.tsx`
Expected: PASS（4 条）

- [ ] **Step 8: 跑 GUI 全量单测，确认没回归**

Run: `cd surfaces/gui && npx vitest run`
Expected: PASS

- [ ] **Step 9: 提交**

```bash
git add surfaces/gui/src/components/TopUpCard.tsx surfaces/gui/src/components/Composer.tsx \
        surfaces/gui/src/components/Composer.credit.test.tsx surfaces/gui/src/App.tsx \
        surfaces/gui/src/i18n/en.ts surfaces/gui/src/i18n/zh.ts
git commit -m "feat(gui): 零余额时在发送前拦住并保住草稿"
```

---

### Task 4: 第二层 —— 让余额 chip 早一分钟出现

**Files:**
- Modify: `surfaces/gui/src/components/Onboarding.tsx`（`handleQumgeConnected`）
- Test: `surfaces/gui/src/components/Onboarding.test.tsx`

**Interfaces:**
- Consumes: `CLOUD_CHANGED`（`api.ts` 已导出）；Task 2 的 hook 已在监听它
- Produces: 无新接口

- [ ] **Step 1: 写失败的测试**

加到 `surfaces/gui/src/components/Onboarding.test.tsx`：

**先补 mock。** `Onboarding.test.tsx:19-31` 的 `vi.mock("../api", ...)` 工厂只列了函数、没有常量。不补的话 `CLOUD_CHANGED` 是 `undefined`，测试和实现各自监听/派发一个字面量叫 `"undefined"` 的事件 —— 两边碰巧对上，测试变绿，而真正的常量（`api.ts:950` 的 `"coworker:cloud-changed"`）什么都没验证。往那个工厂加两行：

```ts
  CLOUD_CHANGED: "coworker:cloud-changed",
  announceCloudChanged: () => window.dispatchEvent(new CustomEvent("coworker:cloud-changed")),
```

然后照本文件既有的设备流程写法（`Onboarding.test.tsx:182-207`）加这条：

```tsx
it("登录成功立刻广播 CLOUD_CHANGED —— 否则余额 chip 要等满一轮轮询", async () => {
  vi.useFakeTimers();
  vi.mocked(startQumgeDevice).mockResolvedValue(QUMGE_START);
  vi.mocked(pollQumgeDevice).mockResolvedValue({ status: "connected" });
  const seen = vi.fn();
  window.addEventListener(CLOUD_CHANGED, seen);

  render(<Onboarding onDone={vi.fn()} />);
  await act(async () => { await Promise.resolve(); });

  // 【关键】渲染之后、点击之前必须没广播过。少了这一条，一个在
  // useEffect(() => ..., []) 里无脑广播的实现照样全绿 —— 而那是一种很可能
  // 被写出来的错误实现（它也「让 chip 更早出现」）。
  expect(seen).not.toHaveBeenCalled();

  fireEvent.click(screen.getByTestId("qumge-connect-start"));
  await act(async () => { await Promise.resolve(); await Promise.resolve(); });
  await act(() => vi.advanceTimersByTimeAsync(5000)); // connected 要等轮询那一跳

  expect(screen.getByTestId("ob-qumge-connected")).toBeTruthy();
  expect(seen).toHaveBeenCalled();
  window.removeEventListener(CLOUD_CHANGED, seen);
});
```

不装假定时器、不推进 5 秒的话 `onConnected` 永远不触发（它挂在 `QumgeConnect.tsx:61` 的 `setTimeout` 上），而 `findByTestId` 默认只等 1 秒。

- [ ] **Step 2: 跑测试，确认它失败**

Run: `cd surfaces/gui && npx vitest run src/components/Onboarding.test.tsx -t CLOUD_CHANGED`
Expected: FAIL —— `seen` 没被调用

- [ ] **Step 3: 实现**

`Onboarding.tsx` 的 `handleQumgeConnected`：

```tsx
  const handleQumgeConnected = () => {
    setQumgeConnected(true);
    void ps.refreshProviders();
    // 账号那一侧不在 refreshProviders 的路径上，而它 60 秒才轮询一次 —— 不广播
    // 的话，刚登录完的用户最长一分钟看不到自己的余额，而那一分钟正是他准备打
    // 第一句话的时候。第二层闸门（$0.00 + 去充值）能不能赶在他打字之前出现，
    // 就靠这一行。
    announceCloudChanged();
  };
```

**用 `api.ts:950` 已有的 `announceCloudChanged()`，别自己 `new Event`。** 那是本仓库做这件事的既有写法（`CloudSignIn.tsx:27` 就这么调），而且用 `CustomEvent`；手写 dispatch 会和它分叉。`AccountRow` 和新的 `useQumgeAccount` hook 都已经在监听这个常量。

- [ ] **Step 4: 跑测试，确认通过**

Run: `cd surfaces/gui && npx vitest run src/components/Onboarding.test.tsx`
Expected: PASS（9 条）

- [ ] **Step 5: 提交**

```bash
git add surfaces/gui/src/components/Onboarding.tsx surfaces/gui/src/components/Onboarding.test.tsx
git commit -m "fix(gui): 登录成功即刻广播账号变更，余额 chip 不再迟到一分钟"
```

---

### Task 5: 第三层 —— 402 翻译成人话，且刷新后仍可点

**Files:**
- Modify: `coworker/providers/errors.py`
- Modify: `coworker/engine.py:256-263`（`_append_notice`）、`:387-395`（错误 payload）
- Modify: `surfaces/gui/src/itemsFromMessages.ts:69-82`
- Modify: `surfaces/gui/src/components/Transcript.tsx`（notice 渲染处）
- Test: `tests/test_model_errors.py`、`tests/test_engine.py`、`surfaces/gui/src/itemsFromMessages.test.ts`

**Interfaces:**
- Consumes: 无
- Produces:
  - `friendly_model_error(model, exc)` 对 `status_code == 402` 返回无额度文案
  - `_append_notice(kind, text=None, cause=None)`；notice dict 多 `cause`
  - `itemsFromMessages` 产出的 notice item 多 `cause?: string`

- [ ] **Step 1: 写失败的测试（错误映射）**

加到 `tests/test_model_errors.py`：

```python
class _Status402(Exception):
    """OpenAI SDK 的 APIStatusError 形状：状态码在属性上，不在字符串里。"""
    status_code = 402


def test_gateway_402_reads_as_out_of_credit():
    from coworker.providers import errors

    msg = friendly_model_error("qumge:deepseek/deepseek-v4-flash", _Status402("Payment Required"))
    # 身份，不是「含有 credit 这个词」—— engine 就是靠这个身份决定要不要挂充值按钮
    assert msg is errors.NO_CREDIT


def test_402_is_matched_on_the_code_not_on_guessed_body_text():
    """Qumge 网关的 body 措辞我们不知道，也不该猜。402 只有一个含义。"""
    class _Bare(Exception):
        status_code = 402
    assert friendly_model_error("qumge:x", _Bare("")) is not None


def test_text_fallback_when_the_sdk_swallowed_the_status_code():
    from coworker.providers import errors

    # 身份，不是 is not None —— 把 "insufficient balance" 误加进 _NO_QUOTA 而不是
    # _NO_CREDIT_TEXT 的实现会返回「配额」那句话，is not None 照样绿
    assert friendly_model_error("qumge:x", Exception("insufficient balance")) is errors.NO_CREDIT


def test_404_and_429_are_unaffected():
    class _NotFound(Exception):
        status_code = 404

    class _RateLimited(Exception):
        status_code = 429

    # 一码多义：404 也可能是 base_url 写错，429 也可能只是让你慢点
    assert friendly_model_error("qumge:x", _NotFound("upstream boom")) is None
    assert friendly_model_error("qumge:x", _RateLimited("slow down")) is None
```

- [ ] **Step 2: 跑测试，确认它失败**

Run: `.venv/bin/pytest tests/test_model_errors.py -k 402 -v`
Expected: FAIL —— 返回 `None`

- [ ] **Step 3: 实现错误映射**

`coworker/providers/errors.py` —— 在 `_NO_QUOTA` 后面加：

```python
# Gateway 402. Matched on the STATUS CODE, unlike everything else in this module.
#
# The rule at the top of this file ("match on the body, not just the status") exists
# because 404 and 429 are each two different problems wearing one number — a 404 is
# also a wrong base_url, a 429 is also plain rate limiting. 402 Payment Required has
# no second meaning, so the code IS the diagnosis, and matching on it means we never
# have to guess how the gateway words its body (or re-guess when it rewords it).
_NO_CREDIT_STATUS = 402
_NO_CREDIT_TEXT = ("insufficient balance", "insufficient_balance", "payment required")

# MODULE-LEVEL and interpolation-free on purpose. The caller has to tell "is this the
# out-of-credit failure?" so it can offer a top-up button, and the only two ways to
# answer that are this constant's identity or a substring match on the sentence below.
# A substring match makes the wording a silent contract: reword it and `error_kind`
# quietly stops being set, with no test going red. `friendly is NO_CREDIT` cannot rot.
NO_CREDIT = (
    "Your Qumge balance is empty — add credit to keep going. "
    "The amount and the top-up link are in the account row at the bottom of the sidebar."
)
```

在 `friendly_model_error` 里，**放在 `_NO_QUOTA` 判断之前**：

```python
    if getattr(exc, "status_code", None) == _NO_CREDIT_STATUS:
        return NO_CREDIT
    if any(marker in text for marker in _NO_CREDIT_TEXT):
        return NO_CREDIT
```

- [ ] **Step 4: 跑测试，确认通过**

Run: `.venv/bin/pytest tests/test_model_errors.py -v`
Expected: PASS

- [ ] **Step 5: 写失败的测试（notice 持久化）**

加到 `tests/test_engine.py`：

```python
def test_no_credit_notice_keeps_kind_error_and_carries_the_cause(tmp_path):
    """按钮要在刷新之后还在，所以原因必须落到持久化的 notice 上；而 kind 必须
    仍然是 "error"，否则 retry() 的「尾部是不是一条 error notice」守卫会失效 ——
    偏偏这条错误是最该能重试的那种（充完值点一下就好）。"""
    eng, _ = _engine(tmp_path, [AssistantTurn(text="ok")])  # 真实签名 (tmp_path, turns)，返回 (engine, provider)
    eng._append_notice("error", "out of credit", cause="no_credit")
    notice = eng.messages[-1]
    assert notice["role"] == "notice"
    assert notice["kind"] == "error"
    assert notice["cause"] == "no_credit"
```

**上面那条只验了管道，验不到接线。** 它自己把 `kind="error"` 传进去，所以真正的错误 —— 在调用点写成 `self._append_notice("no_credit", ...)`，把 cause 折进 kind、静默废掉 `retry()` 的守卫（`engine.py:245-254`）—— 照样全绿。再加一条走真实错误分支的，照本文件既有的驱动写法：

```python
def test_a_402_from_the_provider_lands_as_a_retriable_error_notice(tmp_path):
    class _Broke(Exception):
        status_code = 402

    eng, _ = _engine(tmp_path, [_Broke("Payment Required")])
    # ...按本文件既有写法跑完这一轮...
    notice = eng.messages[-1]
    assert notice["kind"] == "error" and notice["cause"] == "no_credit"
    assert eng._tail_is_retriable_error() is True
```

- [ ] **Step 6: 跑测试，确认它失败**

Run: `.venv/bin/pytest tests/test_engine.py -k no_credit -v`
Expected: FAIL —— `_append_notice() got an unexpected keyword argument 'cause'`

- [ ] **Step 7: 实现 engine 两处**

`coworker/engine.py` 的 `_append_notice`：

```python
    def _append_notice(
        self, kind: str, text: Optional[str] = None, cause: Optional[str] = None
    ) -> None:
        """Persist a turn-ending marker (error/interrupted) as a display-only `notice`
        message: it survives reload like the transcript does, but `_outbound_messages`
        drops the role so no provider ever sees it.

        `cause` narrows an error WITHOUT changing `kind`. The GUI uses it to offer a
        targeted action (a top-up button on a no-credit failure); `retry()` guards on
        the tail being an error notice, so folding the cause into `kind` would silently
        disable retry on exactly the errors most worth retrying."""
        notice: dict[str, Any] = {"role": "notice", "kind": kind, "ts": time.time()}
        if text:
            notice["text"] = text
        if cause:
            notice["cause"] = cause
        self.messages.append(notice)
```

错误分支（`friendly = friendly_model_error(...)` 之后）：

```python
                friendly = friendly_model_error(self.model, exc)
                # 身份比较，不是文本匹配 —— 见 NO_CREDIT 那一段。
                # 【import 必须改】：engine.py:26 现在是
                # `from .providers.errors import friendly_model_error`，模块里没有
                # `errors` 这个名字。改成
                # `from .providers.errors import NO_CREDIT, friendly_model_error`，
                # 否则第一次模型报错就是 NameError —— 把所有模型错误变成崩溃。
                #
                # 【不加 error_kind 到 payload】：全仓没有任何地方读它，后面的
                # task 也不读——按钮是从持久化 notice 的 cause 来的。零消费者的
                # 字段就是死代码，这个计划已经栽过一次（onTopUp）。
                no_credit = friendly is NO_CREDIT
                payload = {
                    "error": friendly or str(exc),
                    "error_type": type(exc).__name__,
                }
                if friendly:
                    payload["raw"] = str(exc)
                self._append_notice(
                    "error", friendly or str(exc), cause="no_credit" if no_credit else None
                )
                yield Event(EventType.ERROR, payload)
                return
```

- [ ] **Step 8: 跑测试，确认通过**

Run: `.venv/bin/pytest tests/test_engine.py tests/test_model_errors.py -v`
Expected: PASS

- [ ] **Step 9: GUI 侧把 cause 透出来**

`surfaces/gui/src/itemsFromMessages.ts` —— 错误 notice 那一支：

```ts
              : {
                  kind: "notice",
                  tone: "warn",
                  text: "Error: " + (m.text || "unknown"),
                  retriable: true,
                  // 原因随 notice 一起持久化，所以刷新之后「去充值」按钮还在。
                  ...(m.cause ? { cause: m.cause as string } : {}),
                },
```

`Item` 的 notice 变体加 `cause?: string`。

`Transcript.tsx` 渲染 notice 的地方，在已有的 Retry 旁边加。

**两处 brief 没交代的前提：** 这个文件既没 import `openExternal` 也没 import `useQumgeAccount`，两个都要加（`../tauri` / `../useQumgeAccount`）；而且下面这段落在 `items.map(...)` 内的 `switch` 分支里，**hook 不能在那儿调** —— `const { balance } = useQumgeAccount();` 要放在 `export function Transcript(...)` 顶部（`Transcript.tsx:362`），在 map 之上。

```tsx
        {item.cause === "no_credit" && (
          <button
            className="ml-2 underline"
            data-testid="notice-topup"
            onClick={() => balance?.topup_url && openExternal(balance.topup_url)}
          >
            {t("addCredit2")}
          </button>
        )}
```

`balance` 来自 `useQumgeAccount().balance` —— 不新开数据源。

- [ ] **Step 10: 加 GUI 测试并跑**

`surfaces/gui/src/itemsFromMessages.test.ts` 加：

```ts
it("error notice 的 cause 透到 item 上（刷新后按钮还在）", () => {
  const items = itemsFromMessages([
    { role: "notice", kind: "error", text: "out of credit", cause: "no_credit" } as any,
  ]);
  expect(items[0]).toMatchObject({ kind: "notice", retriable: true, cause: "no_credit" });
});
```

再加一条组件层的 —— 否则 `notice-topup` 这个按钮全程没有任何测试碰过（Task 9 的 e2e 断的是 `topup-card`，不是它）：`cause: "no_credit"` 的 notice 渲染出 `notice-topup`，没有 cause 的不渲染。

Run: `cd surfaces/gui && npx vitest run src/itemsFromMessages.test.ts src/components/Transcript.test.tsx`
Expected: PASS

- [ ] **Step 11: 提交**

```bash
git add coworker/providers/errors.py coworker/engine.py tests/test_model_errors.py tests/test_engine.py \
        surfaces/gui/src/itemsFromMessages.ts surfaces/gui/src/itemsFromMessages.test.ts \
        surfaces/gui/src/components/Transcript.tsx
git commit -m "feat: 网关 402 变成带充值按钮的人话，且刷新后仍可点"
```

---

### Task 6: 设备面板 —— 把注册说清楚，补一个浏览器兜底

**Files:**
- Modify: `surfaces/gui/src/providers/QumgeConnect.tsx`
- Modify: `surfaces/gui/src/i18n/en.ts`、`zh.ts`
- Test: `surfaces/gui/src/providers/QumgeConnect.test.tsx`

**Interfaces:**
- Consumes: 无
- Produces: waiting 态多一个 `data-testid="qumge-reopen"` 的按钮

- [ ] **Step 1: 加文案键**

`en.ts`：

```ts
  signUpHint: "No Qumge account yet? Sign up on the page that opens — you'll come straight back to this step.",
  reopenBrowser: "Browser didn't open? Try again",
  codeExpired: "That code expired before it was used. Try again for a fresh one.",
```

`zh.ts`：

```ts
  signUpHint: "还没有 Qumge 账号？在打开的页面上注册一个 —— 注册完会自动回到这一步。",
  reopenBrowser: "浏览器没打开？再试一次",
  codeExpired: "这个验证码还没用就过期了。点重试会给你一个新的。",
```

（`codeExpired` 是**改写**已有键，不是新增。）

- [ ] **Step 2: 写失败的测试**

加到 `surfaces/gui/src/providers/QumgeConnect.test.tsx`：

照本文件既有写法来 —— `beforeEach`（`QumgeConnect.test.tsx:26-40`）装了假定时器**并且** `mockReset()` 了两个设备函数。不自己 `mockResolvedValue` 的话 `startQumgeDevice()` 返回 `undefined`，`QumgeConnect.tsx:111` 的 `clampInterval(undefined.interval)` 直接抛，组件落到 `qumge-failed`，`qumge-waiting` 永远不出现。同理假定时器在场时 `findByTestId` / `waitFor` 会和它打架 —— 用本文件的 `flushClick()` 加同步 `getByTestId`。

```tsx
it("waiting 态就把注册说清楚，不等失败之后才解释", async () => {
  vi.mocked(startQumgeDevice).mockResolvedValue(START);
  vi.mocked(pollQumgeDevice).mockResolvedValue({ status: "pending" });
  render(<QumgeConnect onConnected={vi.fn()} />);
  fireEvent.click(screen.getByTestId("qumge-connect-start"));
  await flushClick();
  screen.getByTestId("qumge-waiting");
  // 本仓库【没有】jest-dom —— package.json 只有 @testing-library/dom 和 react，
  // 全仓一处 toBeInTheDocument 都没有。用 toBeTruthy。
  expect(screen.getByText(/注册|Sign up/i)).toBeTruthy();
});

it("「再试一次」重开同一个 URL，而且屏幕上的码不变", async () => {
  // openExternal 在非 Tauri 环境走 window.open（tauri.ts:160），本文件已有两处
  // spyOn(window, "open") 的先例（:57、:92）—— 沿用，别去 mock ../tauri。
  // 【vi.mocked() 只是类型层的转换，运行时什么都没做】——直接对它断言会报
  // "received value must be a mock or spy function"。
  const openSpy = vi.spyOn(window, "open").mockImplementation(() => null);
  vi.mocked(startQumgeDevice).mockResolvedValue(START);
  vi.mocked(pollQumgeDevice).mockResolvedValue({ status: "pending" });
  render(<QumgeConnect onConnected={vi.fn()} />);
  fireEvent.click(screen.getByTestId("qumge-connect-start"));
  await flushClick();

  // 【关键】让第二次 start() 返回一个【不同】的码。只断言「没有第二次调用」
  // 是废的：start() 开头就有 `if (phase.kind === "waiting") return;` 的重入守卫
  // （QumgeConnect.tsx:105），所以即便把 qumge-reopen 直接接到 start() 上，
  // 调用数也不会涨 —— 那个断言对着错误实现照样绿。屏幕上的码变没变，才是
  // 真正能分辨两种实现的东西。
  vi.mocked(startQumgeDevice).mockResolvedValue({ ...START, user_code: "NEWC-0DE1" });

  fireEvent.click(screen.getByTestId("qumge-reopen"));
  await flushClick();

  expect(openSpy).toHaveBeenLastCalledWith(
    START.verification_uri_complete, "_blank", "noopener,noreferrer",
  );
  expect(screen.getByTestId("qumge-user-code").textContent).toBe(START.user_code);
});
```

- [ ] **Step 3: 跑测试，确认它失败**

Run: `cd surfaces/gui && npx vitest run src/providers/QumgeConnect.test.tsx`
Expected: FAIL —— 找不到 `qumge-reopen`

- [ ] **Step 4: 实现**

`QumgeConnect.tsx` 的 waiting 分支：**把已有那行 `{t("deviceHint")}`（`QumgeConnect.tsx:149`）替换成下面三个元素**，不是在它下面追加 —— 否则会出现两条一模一样的提示。

（顺序提示：本 task 里 `deviceHint` 还是普通字符串；Task 7 才把它改成函数。先 6 后 7。）

```tsx
        <p className="text-[11.5px] text-faint">{t("signUpHint")}</p>
        <button
          className="text-[11.5px] text-faint underline hover:text-muted"
          data-testid="qumge-reopen"
          onClick={() => openExternal(verification_uri_complete)}
        >
          {t("reopenBrowser")}
        </button>
        <p className="text-[11.5px] text-faint">{t("deviceHint")}</p>
```

并在组件顶部注释里补一句，说明这个按钮**不是** `start()`：

```tsx
// 「再试一次」只是把同一个 verification_uri_complete 再开一次浏览器 —— 它不
// 重启流程。重启会换一个新 user_code，白白吃掉 qumge.com 每小时 20 次里的一次
// （manager_mixin.py:40-45 专门为这个限额写过错误分支），而且旧 code 还在服务端
// 挂着。它覆盖的是浏览器压根没打开、开到了错的浏览器、标签页被关掉这三类故障。
// 注册回跳【不在其中】——那条路是通的：注册或登录完会回到带 code 的审批页
// （站点侧已验证并有测试覆盖）。
```

- [ ] **Step 5: 跑测试，确认通过**

Run: `cd surfaces/gui && npx vitest run src/providers/QumgeConnect.test.tsx`
Expected: PASS（15 条）

- [ ] **Step 6: 提交**

```bash
git add surfaces/gui/src/providers/QumgeConnect.tsx surfaces/gui/src/providers/QumgeConnect.test.tsx \
        surfaces/gui/src/i18n/en.ts surfaces/gui/src/i18n/zh.ts
git commit -m "feat(gui): 设备面板说清注册，并补一个浏览器没打开的兜底"
```

---

### Task 7: 「这台 Mac」—— 跨平台文案

**Files:**
- Modify: `surfaces/gui/src/i18n/en.ts:176-177, 658-659, 187, 649`
- Modify: `surfaces/gui/src/i18n/zh.ts:80, 627-628, 90, 620`
- Test: `surfaces/gui/src/i18n/i18n.test.tsx`

**Interfaces:**
- Consumes: `platformOS()`（`tauri.ts:13`）
- Produces: `thisDevice: string` 文案键；四处受影响文案改为函数形式 `(dev: string) => string`

- [ ] **Step 1: 写失败的测试**

加到 `surfaces/gui/src/i18n/i18n.test.tsx`：

放在 `i18n.test.tsx` 已有的 `describe` **内部**（外面拿不到那个把 locale 重置成 en 的 `beforeEach`）：

```tsx
// 这个文件已经 import 了 setLocale 和 t（i18n.test.tsx:5）。
// 【没有 makeT 这个东西】——本仓库不存在，别去找。
it("Windows 上不会告诉用户他有一台 Mac", () => {
  (globalThis as any).__OCW_PLATFORM__ = "windows";
  act(() => setLocale("en"));
  const dev = t("thisDevice")();
  expect(t("onboardLede")(dev)).not.toMatch(/Mac/);
  expect(t("deviceHint")(dev)).not.toMatch(/Mac/);
  delete (globalThis as any).__OCW_PLATFORM__;
});

it("macOS 上仍然说 Mac —— 主力平台不降级成「这台电脑」", () => {
  (globalThis as any).__OCW_PLATFORM__ = "macos";
  act(() => setLocale("en"));
  expect(t("onboardLede")(t("thisDevice")())).toMatch(/Mac/);
  delete (globalThis as any).__OCW_PLATFORM__;
});
```

**两个坑，都会让这两条测试变成假的：**

1. `thisDevice` **必须是函数，不能是字符串**。`en` 是模块级对象字面量，import 的那一刻就求值完了 —— 那时测试体还没跑，`__OCW_PLATFORM__` 还没设，`platformOS()` 在 jsdom 下落到 `"linux"`。写成字符串的话：Windows 那条会因为错误的原因通过（一个硬编码「这台电脑」、完全不看平台的实现也能过），macOS 那条则会**对着正确实现报红**。
2. 改成函数之后 `t("onboardLede")` 返回的是函数，`toMatch` 会抛「received value must be a string」—— 加了 `.not` 也照抛。所以必须先调用再断言。

- [ ] **Step 2: 跑测试，确认它失败**

Run: `cd surfaces/gui && npx vitest run src/i18n/i18n.test.tsx -t Windows`
Expected: FAIL —— 文案里有 "Mac"

- [ ] **Step 3: 实现**

`en.ts` 加键并改四处（`workingWithTools` 已是函数形式的先例，见 `en.ts:170`）：

两个 catalog 目前都没有（或几乎没有）import，需要新增 `import { platformOS } from "../tauri";` —— 这会让 i18n catalog 第一次依赖 Tauri 桥接层，是个有意的耦合。

```ts
  // 惰性求值：catalog 是模块级字面量，写成三元表达式会在 import 时就锁死平台。
  thisDevice: () => (platformOS() === "macos" ? "this Mac" : "this computer"),
  onboardLede: (dev: string) =>
    `Connect to Qumge to get started — one sign-in, every model, and your key stays on ${dev}.`,
  deviceHint: (dev: string) =>
    `Didn't open? The address above already carries your code — paste it into any browser, on ${dev} or another device.`,
```

`zh.ts` 同构：

```ts
  thisDevice: () => (platformOS() === "macos" ? "这台 Mac" : "这台电脑"),
  onboardLede: (dev: string) =>
    `连上 Qumge 就能开始 —— 登录一次，所有模型都能用，密钥只存在${dev}上。`,
  deviceHint: (dev: string) =>
    `没有自动打开？上面那个网址已经带上了你的验证码 —— 复制到任何浏览器里打开就行，${dev}或别的设备都可以。`,
```

`obSignInBody` 和 `obMoreTools` 同样处理。调用点改成 `t("onboardLede")(t("thisDevice")())` —— 注意 `thisDevice` 现在也是函数，两对括号。

**四个调用点，一个都不能漏**（漏掉的那个会把函数当 React 子节点渲染，React 静默丢弃，那段文案直接变空白）：

| 文件 | 键 |
|---|---|
| `Onboarding.tsx:172` | `onboardLede` |
| `Onboarding.tsx:322` | `obSignInBody` |
| `Onboarding.tsx:391` | `obMoreTools` |
| `QumgeConnect.tsx:149` | `deviceHint` |
| **`QumgeSignInModal.tsx:39`** | `onboardLede` ← **写计划时漏掉的第四个消费者** |

最后那个是这个计划第三次栽在「改了共享的键却没查全部消费者」上（前两次：qumg 的 `home.small_print`、以及本仓库 `balance.py` 的字段）。改之前先 `grep -rn 'onboardLede\|deviceHint\|obSignInBody\|obMoreTools' surfaces/gui/src --include=*.tsx`。

- [ ] **Step 4: 跑测试 + i18n 守卫**

Run: `cd surfaces/gui && npx vitest run src/i18n/ && cd ../.. && .venv/bin/python packaging/check_i18n.py`
Expected: 两个都 PASS（守卫输出「基线 0 条，无新增」）

- [ ] **Step 5: 提交**

```bash
git add surfaces/gui/src/i18n/en.ts surfaces/gui/src/i18n/zh.ts surfaces/gui/src/i18n/i18n.test.tsx \
        surfaces/gui/src/components/Onboarding.tsx surfaces/gui/src/providers/QumgeConnect.tsx \
        surfaces/gui/src/components/QumgeSignInModal.tsx
git commit -m "fix(i18n): 设备名跟着平台走，Windows 用户不再被说成有台 Mac"
```

---

### Task 8: README —— 写一段不会过期的下载说明

**Files:**
- Modify: `README.md:24-28`（删 Pre-release 横幅）、`:35-45`（重写 Download）

**Interfaces:** 无

- [ ] **Step 1: 删掉 Pre-release 横幅**

删除 `README.md` 第 24-27 行整段引用块连同紧随其后的空行（`> **Pre-release** — Marlo has no published build yet. …`）。

- [ ] **Step 2: 重写 Download 段**

把 `## Download` 到下一个 `##` 之间的内容整段换成：

```markdown
## Download

**[qumge.com](https://qumge.com)** — signed and notarised for macOS, so it opens on the
first double-click. There is a Windows build too; it carries no Authenticode signature
yet, so Windows warns on first run.

Every release, with checksums and the auto-update manifest:
[github.com/Qumge/marlo/releases/latest](https://github.com/Qumge/marlo/releases/latest).

Prefer to run from source? See [Run from source](#run-from-source).
```

**不写版本号，不写具体文件名。** 上一版 Download 段之所以能一路错到 v0.7.5，是因为它断言了一件会变的事实。这一段没有可漂移的东西，所以不需要守卫来看着它。

- [ ] **Step 3: 人工确认链接可达**

Run: `curl -sI https://github.com/Qumge/marlo/releases/latest | head -1`
Expected: `HTTP/2 302`（跳到最新 tag）

- [ ] **Step 4: 跑品牌守卫**

Run: `.venv/bin/python packaging/check_branding.py`
Expected: PASS

（它的 `ROOTS` 不含 `README.md`，所以这一步验不到本次改动 —— 留着只是确认没碰坏别的。别把它当成这段文案的验收。）

- [ ] **Step 5: 提交**

```bash
git add README.md
git commit -m "docs: README 不再说没有可下载的构建"
```

---

### Task 9: e2e —— 证明它真的串起来了

**Files:**
- Create: `surfaces/gui/e2e/credit-gate.spec.ts`
- Modify: `surfaces/gui/e2e/fixtures.qumge.ts`（加可切换余额的 account 路由）

**Interfaces:**
- Consumes: 前面全部
- Produces: 无

- [ ] **Step 1: 给 fixture 加一个可切换的余额**

`surfaces/gui/e2e/fixtures.qumge.ts` 里加：

**这个文件目前没有任何 import，也没有任何 `page.route`** —— 它的既有写法是纯派发器 `qumgeRoute(p, m, json)`，由 `fixtures.ts` 的中央路由表调用。下面这个 route 覆盖是这个文件的**新**写法，不是沿用；这样写是为了让单条用例能中途改余额。其余 60 多条 spec 仍走派发器那条路，不受影响。

```ts
import type { Page } from "@playwright/test";

/** 让单条用例在跑到一半时把余额从 0 改成有钱 —— 模拟用户去浏览器充了值。 */
export function qumgeAccountRoute(page: Page) {
  let micro = 0;
  const install = () =>
    page.route("**/v1/qumge/account", (r) =>
      r.fulfill({
        json: {
          signed_in: true,
          email: "new@user.test",
          balance: {
            balance_micro_usd: micro,
            balance: micro / 1_000_000,
            currency: "USD",
            topup_url: "https://qumge.com/en/gateway/topup/new",
            low: micro < 1_000_000,
            can_spend: micro > 0,
          },
        },
      }),
    );
  return { install, topUp: (m: number) => (micro = m) };
}
```

**`topUp` 故意不给默认值。** 给了默认值，调用方就会写 `account.topUp()`，而任何「一步到位充很多」的默认值都会让 `low` 和 `can_spend` 一起翻转 —— 于是这条 spec 对「闸门读错字段」这件事完全失明（读 `low` 也全绿）。见下一步。

- [ ] **Step 2: 写失败的 e2e**

`surfaces/gui/e2e/credit-gate.spec.ts`：

```ts
import { expect } from "@playwright/test";
import { test } from "./fixtures"; // 【必须】从这里拿 test —— 它带 mockApi，裸 Playwright 的 test 没有任何路由
import { qumgeAccountRoute } from "./fixtures.qumge";

test("零余额 → 拦住 → 充值 → 解锁 → 可发，全程草稿不丢", async ({ page }) => {
  // 【顺序要紧】：mockApi 在 test fixture 里注册了 `**/v1/**` catch-all。
  // Playwright 是后注册的路由先匹配，所以这个覆盖必须在【测试体内】装（那时
  // fixture 已经跑完），且必须在 goto 之前。装在 fixture 之前会被 catch-all
  // 吃掉，于是拿到默认的 $19.12 余额，症状是「topup-card 不出现」——一个和
  // 真正原因毫无关系的报错。
  const account = qumgeAccountRoute(page);
  await account.install();

  await page.goto("/");
  await page.getByText("Draft the launch note").first().click(); // 先进一个会话，composer 才可用
  const box = page.getByPlaceholder(/Ask the coworker/);

  const draft = "帮我把这个文件夹里的发票按月分组";
  await box.fill(draft);
  await box.press("Enter");

  // 拦住了，而且草稿还在
  await expect(page.getByTestId("topup-card")).toBeVisible();
  await expect(box).toHaveValue(draft);

  // 用户去浏览器充了 $0.50 —— 【这个数字是这条 spec 的全部价值所在】。
  //
  // 0.5 美元让 low 仍然是 true（阈值是 $1）而 can_spend 翻成 true。两个标志
  // 在这里【分叉】。如果充成 $5，两个标志一起翻，那么一个读 `low` 而不是
  // `can_spend` 的闸门照样全绿 —— 这条 spec 就退化成装饰。
  //
  // Task 1 的 review 已经在单测层面抓过一模一样的缺陷（见 progress.md）。
  // 这里是它在 e2e 层面的同一个坑，而这条 spec 恰恰是给其余八个 task 背书的。
  account.topUp(500_000);

  // 卡片自己消失（focus / 5 秒快轮询），不需要用户再点什么
  await expect(page.getByTestId("topup-card")).toBeHidden({ timeout: 15_000 });
  await expect(box).toHaveValue(draft);

  // 【不自动发送】—— 由用户自己按回车
  await box.press("Enter");
  await expect(box).toHaveValue("");
});
```

- [ ] **Step 3: 跑，确认它失败**

Run: `cd surfaces/gui && NO_PROXY="localhost,127.0.0.1" no_proxy="localhost,127.0.0.1" npx playwright test e2e/credit-gate.spec.ts`
Expected: FAIL

- [ ] **Step 4: 补齐 fixture 缺的部分直到通过**

（前 8 个 task 已经把功能做完了；这一步只补 fixture/选择器的落差，不写新功能。）

**不要为了变绿而放宽断言。** 尤其是 `topUp(500_000)` 那个数字和「卡片消失后不自动发送」那两条 —— 它们是这条 spec 存在的理由。跑不通就是有真问题，改断言只会把问题藏起来。要是你判断某条断言本身写错了，停下来告诉我，不要自己改。

Run: 同上
Expected: PASS

- [ ] **Step 5: 跑全量 e2e，确认没回归**

Run: `cd surfaces/gui && NO_PROXY="localhost,127.0.0.1" no_proxy="localhost,127.0.0.1" npm run e2e`
Expected: PASS

- [ ] **Step 6: 跑全量 pytest**

Run: `.venv/bin/pytest -q`
Expected: **5 failed**（本机预存基线），其余全过。多出一条就是本计划引入的回归。

- [ ] **Step 7: 提交**

```bash
git add surfaces/gui/e2e/credit-gate.spec.ts surfaces/gui/e2e/fixtures.qumge.ts
git commit -m "test(e2e): 零余额到第一单跑通的整条链"
```
