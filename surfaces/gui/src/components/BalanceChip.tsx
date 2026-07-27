import { type QumgeBalance } from "../api";
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
// The figure arrives from the account poll that already drives the row this chip
// sits in, rather than from a timer of its own. Two components polling the same
// endpoint on independent clocks is how a row and the number beside it end up
// disagreeing on screen for up to a minute.
export function BalanceChip({ balance }: { balance: QumgeBalance | null }) {
  const t = useT();

  // Signed out, offline, or the server is down — all the same here. Showing
  // nothing is the honest state; an error would be about us, not about them.
  if (!balance) return null;

  const amount = `$${balance.balance.toFixed(2)}`;

  // A span, not a button: the account row is a <button>, and a button inside a
  // button is invalid HTML that browsers resolve however they like. React said
  // so on every render, into a console nothing was reading — it only surfaces
  // when the app is actually run, which is how it survived a green unit suite
  // and a green e2e suite. The inbox chip beside it has always been a span.
  //
  // Deliberately NOT stopPropagation, unlike that inbox chip. This row is the
  // app's primary navigation — Settings, Connectors, Inbox and Automations all
  // live behind it — and it is narrow enough that the chip sits near its centre
  // once the inbox badge appears. Swallowing the click there means someone
  // pressing their own account row gets a payment page and no menu. Opening
  // top-up AND the menu is the lesser of the two.
  return (
    <span
      role="button"
      tabIndex={0}
      className={"balance-chip" + (balance.low ? " is-low" : "")}
      data-testid="balance-chip"
      title={balance.low ? t("balanceLowTitle") : t("balanceTitle")}
      onClick={() => openExternal(balance.topup_url)}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          openExternal(balance.topup_url);
        }
      }}
    >
      <span className="balance-chip__amount">{amount}</span>
      {balance.low && <span className="balance-chip__add">{t("addCredit")}</span>}
    </span>
  );
}
