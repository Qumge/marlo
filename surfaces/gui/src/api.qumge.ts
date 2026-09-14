// Qumge 相关的客户端调用 —— 余额、账号、设备码登录。
//
// 单独一个文件不是分类癖。api.ts 是上游活跃维护的文件（分叉至今他们改过 9
// 次），我们往里加了 108 行，等于每次上游更新都要手工合一遍，合的还是九个
// 与他们完全无关的函数。新文件永远不会冲突。
//
// 只从 api.ts 借两样：httpBase 和带鉴权头的 fetch。借得越少，上游改
// api.ts 时我们越安全。
import { httpBase, fetch as authedFetch } from "./api";

// 技能包（bundles / installBundle）2026-09-14 撤掉：qumge 的「一组技能干成一件事」
// 挑得不准，「技能」页只列技能。

/** Qumge credit. `null` when it cannot be known — signed out, offline, server
 * down — because the UI does the same thing with all of them: shows nothing. An
 * error banner in front of someone trying to work is worse than a missing
 * number in a corner. */
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

export async function getQumgeBalance(): Promise<QumgeBalance | null> {
  try {
    const res = await authedFetch(`${httpBase()}/v1/qumge/balance`);
    if (!res.ok) return null;
    return (await res.json()).balance ?? null;
  } catch {
    return null;
  }
}

/** Whose account this is, and what it has left — the sidebar footer's whole
 * model. `signed_in` is decided from the key on disk, not from a successful
 * call, so going offline cannot demote a signed-in user to a signed-out one:
 * the footer used to report a third party's sign-in state and told people
 * holding a working Qumge key that they were not signed in. */
export interface QumgeAccount {
  signed_in: boolean;
  email: string | null;
  balance: QumgeBalance | null;
}

const SIGNED_OUT: QumgeAccount = { signed_in: false, email: null, balance: null };

export async function getQumgeAccount(): Promise<QumgeAccount> {
  try {
    const res = await authedFetch(`${httpBase()}/v1/qumge/account`);
    if (!res.ok) return SIGNED_OUT;
    const body = await res.json();
    // An older sidecar has no such route and a proxy can hand back anything;
    // treating a shape we do not recognise as signed-out keeps the footer from
    // rendering `undefined` at someone.
    return typeof body?.signed_in === "boolean" ? body : SIGNED_OUT;
  } catch {
    return SIGNED_OUT;
  }
}

/** Sign out of Qumge: drop the stored key. The account row's sign-out has to
 * end the session the row is naming — it used to sign the user out of a
 * different service than the one written above it. */
export async function qumgeSignOut(): Promise<void> {
  await authedFetch(`${httpBase()}/v1/providers/qumge`, { method: "DELETE" }).catch(() => {});
}

// -- Qumge device sign-in (RFC 8628) ------------------------------------------
// The key itself never rides through here — the server exchanges it and writes it straight
// to the SecretStore (see manager.poll_qumge_device); these two calls only ever see the
// user-facing code/URL and a bare status string.
export interface QumgeDeviceStart {
  user_code: string;
  verification_uri: string;
  verification_uri_complete: string;
  interval: number;
  expires_in: number;
}

export interface QumgeDevicePoll {
  status: "pending" | "connected" | "denied" | "expired" | "error";
  interval?: number; // present when the server widens the poll interval (slow_down)
  error?: string;
}

// A JSON body is not success: the sidecar's auth middleware answers a bad/missing launch
// token with a 401 `{"error": "..."}` — valid, parseable JSON that would otherwise sail
// through `res.json()` untouched, leaving `data.interval` `undefined` and feeding a
// `setTimeout(..., NaN)` retry loop. Both helpers must reject on a non-OK response so the
// ONE try/catch in QumgeConnect is where a failure becomes a message.
/** A sign-in failure the sidecar could name. `kind` is what the panel phrases in the
 * user's language — the sidecar's `message` is English (it has no locale) and is kept
 * only as the last-resort text for failures nothing classified. */
export class QumgeSignInError extends Error {
  readonly kind?: "rate_limited" | "unreachable";
  readonly statusCode?: number;

  constructor(message: string, kind?: "rate_limited" | "unreachable", statusCode?: number) {
    super(message);
    this.name = "QumgeSignInError";
    this.kind = kind;
    this.statusCode = statusCode;
  }
}

export async function startQumgeDevice(
  deviceName?: string,
  locale?: string,
): Promise<QumgeDeviceStart> {
  const res = await authedFetch(`${httpBase()}/v1/qumge/device/start`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    // The server hands back a locale-scoped approval URL and cannot guess which language
    // this window is in, so the window says so.
    body: JSON.stringify({
      ...(deviceName ? { device_name: deviceName } : {}),
      ...(locale ? { locale } : {}),
    }),
  });
  const data = await res.json();
  // Two distinct failure shapes here: a non-OK HTTP response, and a 200 that is ITSELF a
  // failure (qumge.com rate-limited/unreachable — device_flow.py's typed
  // `{status: "error", ...}`). A real success body never carries a `status` field, so this
  // check can't misfire on one.
  if (!res.ok || data?.status === "error") {
    throw new QumgeSignInError(
      data?.error || `Qumge sign-in request failed (HTTP ${res.status}).`,
      data?.kind,
      typeof data?.status_code === "number" ? data.status_code : undefined,
    );
  }
  return data;
}

export async function pollQumgeDevice(): Promise<QumgeDevicePoll> {
  const res = await authedFetch(`${httpBase()}/v1/qumge/device/poll`);
  const data = await res.json();
  // Only a non-OK HTTP response throws here — an app-level `{status: "error", ...}` body
  // (e.g. "no sign-in in progress") is a normal, meaningful poll result; the caller's
  // switch inspects `status` itself (see QumgeConnect.tsx).
  if (!res.ok) {
    throw new Error(data?.error || `Qumge poll request failed (HTTP ${res.status}).`);
  }
  return data;
}
