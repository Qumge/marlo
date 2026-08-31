import { useEffect } from "react";
import { type QumgeBalance } from "../api.qumge";
import { setAccountPollFast } from "../useQumgeAccount";
import { openExternal } from "../tauri";
import { useT } from "../legacyI18n";

// 余额为 0 时挡在 composer 上方的那张卡片。
//
// 它是【卡片不是 modal】，因为用户刚打完一句话：modal 会正好盖住输入框，制造
// 「我打的字还在吗」这一秒的焦虑，而这个闸门存在的全部理由就是不让他觉得白打了。
//
// 挂载期间把账号轮询降到 5 秒（卸载时还原）。用户去浏览器充值，回到 app 时
// focus 会立刻刷一次；但他也可能在手机上扫码付款——那时 app 从没失去过焦点，
// focus 不触发，只有这个快轮询能把他解锁。
//
// 【只有一个动作】（owner 裁定 2026-08-09）。原来还有一个「用我自己的 key」按钮，
// 点了会 setSurface("settings") —— 而 App.tsx 的 surface 三元把整个会话视图连同
// <Composer> 一起卸载掉。草稿只活在 Composer 的本地 text state 里，没有上提、
// 没有持久化，于是那个按钮做的恰恰是砸掉这张卡片存在的全部理由要保住的东西。
// 自带 key 的退路已经在 设置 ▸ 模型 里，不需要卡片再开一个会弄丢草稿的入口。
// 想再加回去之前，先把草稿状态提到会话视图之上。
export function TopUpCard({ balance }: { balance: QumgeBalance }) {
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
      </div>
    </div>
  );
}
