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
