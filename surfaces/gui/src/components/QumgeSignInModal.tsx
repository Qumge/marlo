import { useEffect } from "react";
import { QumgeConnect } from "../providers/QumgeConnect";
import { useT } from "../i18n";

// Sign in to Qumge from inside the running app.
//
// The device flow lived in onboarding and nowhere else, so anyone who got past
// the first run and later ended up signed out — a rotated key, a machine
// restored from backup, or just pressing the sign-out this dialog exists to make
// safe — had no route back in. The account menu is where a person looks for it.
//
// This is a shell around <QumgeConnect>: the code, the polling, the browser
// hand-off and every failure state already live there, and duplicating them here
// is how two sign-in flows drift apart.
export function QumgeSignInModal(props: { onClose: () => void; onConnected: () => void }) {
  const t = useT();

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && props.onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [props.onClose]);

  return (
    <div
      className="fixed inset-0 z-50 grid place-items-center bg-black/30 p-6"
      data-testid="qumge-signin-modal"
      onClick={props.onClose}
    >
      <div
        className="w-full max-w-[420px] rounded-2xl border border-line bg-panel shadow-2xl p-6 space-y-4"
        role="dialog"
        aria-modal="true"
        aria-label={t("signInToQumge")}
        onClick={(e) => e.stopPropagation()}
      >
        <div>
          <div className="text-[15px] font-semibold text-ink">{t("signInToQumge")}</div>
          <p className="text-[12.5px] text-muted mt-1">{t("onboardLede")}</p>
        </div>

        <QumgeConnect
          onConnected={() => {
            props.onConnected();
            props.onClose();
          }}
        />

        <button
          className="text-[12.5px] text-muted hover:text-ink"
          data-testid="qumge-signin-cancel"
          onClick={props.onClose}
        >
          {t("dismiss")}
        </button>
      </div>
    </div>
  );
}
