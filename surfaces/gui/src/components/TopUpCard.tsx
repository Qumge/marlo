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
