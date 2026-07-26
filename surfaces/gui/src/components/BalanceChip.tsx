import { useEffect, useState } from "react";
import { getQumgeBalance, type QumgeBalance } from "../api";
import { openExternal } from "../tauri";
import { useT } from "../i18n";

// Marlo is pay-as-you-go and used to say nothing about money anywhere. The first
// thing a user would have learned about their balance was a request failing, and
// a 402 from a gateway is not something a person can act on.
//
// It sits in the sidebar footer, which is where someone looks for anything to do
// with their account — and which, until now, reported whether they were signed
// in to OpenWorker Cloud. That is a third party whose connectors this build
// hides, so the line read "Not signed in" to people who had just signed in to
// Qumge.
//
// Refreshed on a timer rather than pushed. The number moves as work happens, and
// a poll that fails changes nothing on screen; a socket for this would be more
// machinery than a figure in a corner is worth.
const REFRESH_MS = 60_000;

export function BalanceChip() {
  const t = useT();
  const [balance, setBalance] = useState<QumgeBalance | null>(null);

  useEffect(() => {
    let alive = true;
    const load = () => {
      getQumgeBalance().then((b) => {
        if (alive) setBalance(b);
      });
    };
    load();
    const timer = setInterval(load, REFRESH_MS);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, []);

  // Signed out, offline, or the server is down — all the same here. Showing
  // nothing is the honest state; an error would be about us, not about them.
  if (!balance) return null;

  const amount = `$${balance.balance.toFixed(2)}`;

  return (
    <button
      type="button"
      className={"balance-chip" + (balance.low ? " is-low" : "")}
      data-testid="balance-chip"
      title={balance.low ? t("balanceLowTitle") : t("balanceTitle")}
      onClick={() => openExternal(balance.topup_url)}
    >
      <span className="balance-chip__amount">{amount}</span>
      {balance.low && <span className="balance-chip__add">{t("addCredit")}</span>}
    </button>
  );
}
