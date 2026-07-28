import { useEffect, useState, type ReactNode } from "react";
import { AttnBadge } from "./AttnBadge";
import { BalanceChip } from "./BalanceChip";
import { Icon, type IconName } from "./Icon";
import { QumgeSignInModal } from "./QumgeSignInModal";
import { getQumgeAccount, qumgeSignOut, type QumgeAccount } from "../api.qumge";
import { CLOUD_CHANGED } from "../api";
import { useT } from "../i18n";

// 侧栏底部那一行 —— 账号、余额、以及那个菜单。
//
// 抽出来有两个理由。一是 Sidebar.tsx 是上游会动的文件（分叉至今 4 次），我们
// 在里面改了 174 行，其中绝大部分是这一块；搬到新文件后上游怎么改 Sidebar 都
// 不会撞上。二是这本来就该是一个组件：Sidebar 已经 1300 行，这一块自成一体。
//
// 行为一个字没改 —— 包括那些看起来奇怪但都是修过的 bug 的地方：
//   · signed_in 来自磁盘上的 key，不是"余额取到了"。离线不等于登出。
//   · 余额徽标【不】stopPropagation：这一行是主导航（设置、连接、收件箱都在
//     菜单里），收件箱徽标一出现它就落在行的中心，吞掉点击等于让人打不开
//     自己的设置。
//   · 邮箱未知时退回"已登录 Qumge"，不是"未登录"。

// 每 60 秒刷一次：余额随着干活在变，只靠窗口聚焦会一直显示旧数字。
const ACCOUNT_REFRESH_MS = 60_000;

export function AccountRow({
  onOpenInbox,
  inboxActive,
  onOpenIntegrations,
  integrationsActive,
  onOpenAbilities,
  abilitiesActive,
  onManage,
  onOpenScheduled,
  scheduledActive,
  onOpenAudit,
  auditActive,
  totalAttention,
  inboxUnlocked,
}: {
  onOpenInbox: () => void;
  inboxActive: boolean;
  onOpenIntegrations: () => void;
  integrationsActive: boolean;
  onOpenAbilities: () => void;
  abilitiesActive: boolean;
  onManage: () => void;
  onOpenScheduled: () => void;
  scheduledActive: boolean;
  onOpenAudit: () => void;
  auditActive: boolean;
  totalAttention: number;
  inboxUnlocked: boolean;
}) {
  const t = useT();
  const [appMenuOpen, setAppMenuOpen] = useState(false);
  const [signInOpen, setSignInOpen] = useState(false);
  const [account, setAccount] = useState<QumgeAccount>({
    signed_in: false,
    email: null,
    balance: null,
  });

  const refreshAccount = () => getQumgeAccount().then(setAccount).catch(() => {});
  useEffect(() => {
    refreshAccount();
    const onFocus = () => refreshAccount();
    window.addEventListener("focus", onFocus);
    window.addEventListener(CLOUD_CHANGED, onFocus);
    const timer = window.setInterval(refreshAccount, ACCOUNT_REFRESH_MS);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener("focus", onFocus);
      window.removeEventListener(CLOUD_CHANGED, onFocus);
    };
  }, []);

  const appMenuItem = (
  icon: IconName,
  label: string,
  onClick: () => void,
  active?: boolean,
  trailing?: ReactNode,
) => (
  <button
    className={
      "w-full flex items-center gap-2.5 px-3 py-1.5 text-[13px] text-left " +
      (active ? "text-ink bg-paper" : "hover:bg-paper")
    }
    onClick={() => {
      setAppMenuOpen(false);
      onClick();
    }}
  >
    <Icon name={icon} size={15} className="shrink-0 text-muted" />
    <span className="flex-1">{label}</span>
    {/* aria-hidden: the badge/shortcut must not leak into the accessible name (the old
        Inbox row's name-includes-the-badge-count nuisance, not repeated). */}
    {trailing != null && <span aria-hidden>{trailing}</span>}
    </button>
  );

  // Display identity for the account row: the cloud profile only carries the email, so the
  // row shows the capitalized local part ("rohit@…" → "Rohit"); the menu header shows it all.
  const accountEmail = account.signed_in ? account.email || "" : "";
  const accountName = accountEmail
    ? accountEmail.split("@")[0].replace(/^./, (c) => c.toUpperCase())
    : "";

  return (
    <>
    {/* Bottom (§26): exactly ONE row — the account anchor. The inbox chip on it is
        state-driven with a sticky unlock (quiet when empty, accent + count when pending);
        everything else lives in the account menu, which ALWAYS lists Inbox + Connectors. */}
    <div className="px-2.5 py-2 border-t border-line">
      <div className="relative">
        {appMenuOpen && (
          <>
            <div className="fixed inset-0 z-30" onClick={() => setAppMenuOpen(false)} />
            <div
              className="absolute z-40 bottom-full left-0 right-0 mb-1 rounded-xl border border-line bg-panel shadow-2xl py-1"
              data-testid="account-menu"
              role="menu"
            >
              {account.signed_in ? (
                <div
                  className="px-3 py-1.5 mb-1 text-[11px] text-faint truncate border-b border-line"
                  data-testid="account-header"
                  title={accountEmail ? t("accountOf")(accountEmail) : t("signedInToQumge")}
                >
                  {accountEmail ? t("accountOf")(accountEmail) : t("signedInToQumge")}
                </div>
              ) : (
                <>
                  <div className="px-3 py-1.5 text-[11px] text-faint border-b border-line">
                    {t("signedOutHint")}
                  </div>
                  <button
                    className="w-full flex items-center gap-2.5 px-3 py-1.5 mb-1 text-[13px] text-left text-accent hover:bg-paper"
                    data-testid="account-sign-in"
                    onClick={() => {
                      setAppMenuOpen(false);
                      setSignInOpen(true);
                    }}
                  >
                    <Icon name="plug" size={15} className="shrink-0" /> {t("signInToQumge")}
                  </button>
                </>
              )}
              {appMenuItem(
                "inbox",
                t("inbox"),
                onOpenInbox,
                inboxActive,
                <AttnBadge n={totalAttention} />,
              )}
              {appMenuItem("sparkle", t("abilities"), onOpenAbilities, abilitiesActive)}
              {appMenuItem("plug", t("connectors"), onOpenIntegrations, integrationsActive)}
              <div className="h-px bg-line my-1 mx-2" />
              {appMenuItem(
                "gear",
                t("settings"),
                onManage,
                false,
                <span className="text-[11px] text-faint">⌘ ,</span>,
              )}
              {appMenuItem("clock", t("automations"), onOpenScheduled, scheduledActive)}
              {appMenuItem("audit", t("activity"), onOpenAudit, auditActive)}
              {account.signed_in && (
                <>
                  <div className="h-px bg-line my-1 mx-2" />
                  {/* Ends the session the header names. This used to sign the
                      user out of OpenWorker Cloud while the line above it
                      showed their Qumge address. */}
                  {appMenuItem("signOut", t("signOut"), async () => {
                    await qumgeSignOut();
                    await refreshAccount();
                  })}
                </>
              )}
            </div>
          </>
        )}

        <button
          className={
            "w-full flex items-center gap-2 px-2.5 py-2 rounded-lg text-[13px] text-left " +
            (appMenuOpen ? "bg-paper text-ink" : "hover:bg-paper")
          }
          data-testid="account-row"
          onClick={() => {
            if (!appMenuOpen) void refreshAccount();
            setAppMenuOpen((v) => !v);
          }}
          aria-haspopup="menu"
          aria-expanded={appMenuOpen}
          aria-label={
            account.signed_in && accountEmail
              ? t("accountAria")(accountEmail)
              : account.signed_in
                ? t("signedInToQumge")
                : t("accountAriaSignedOut")
          }
        >
          <span
            className={
              "w-6 h-6 rounded-full grid place-items-center text-[10.5px] font-semibold shrink-0 " +
              (account.signed_in
                ? "bg-accentSoft text-accent"
                : "bg-paper text-faint border border-line")
            }
            aria-hidden
          >
            {account.signed_in ? accountName.slice(0, 1).toUpperCase() : "?"}
          </span>
          <span className={"truncate " + (account.signed_in ? "" : "text-muted")}>
            {account.signed_in
              ? accountEmail
                ? accountName
                : t("signedInToQumge")
              : t("notSignedIn")}
          </span>
          {account.signed_in && (
            <span
              className="w-[7px] h-[7px] rounded-full bg-ok shrink-0"
              title={t("signedInToQumge")}
              aria-hidden
            />
          )}
          <span className="flex-1" />
            {/* Credit, where someone already looks for account things.
                Renders nothing when it cannot be fetched — offline and
                server-down read the same to a person. Fed from the account
                poll rather than one of its own: two timers asking the same
                server the same question is how the row and the number end up
                disagreeing on screen. */}
            <BalanceChip balance={account.balance} />
          {inboxUnlocked && (
            <span
              className={
                "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11.5px] shrink-0 cursor-pointer " +
                (totalAttention > 0
                  ? "bg-accentSoft text-accent font-semibold"
                  : "text-faint hover:text-ink")
              }
              data-testid="inbox-chip"
              role="button"
              aria-label={
                totalAttention > 0 ? t("inboxNeedsYou")(totalAttention) : t("inbox")
              }
              title={totalAttention > 0 ? `Inbox — ${totalAttention} items need you` : "Inbox"}
              onClick={(e) => {
                // The chip goes STRAIGHT to Inbox — the menu is the row's target, not the chip's.
                e.stopPropagation();
                setAppMenuOpen(false);
                onOpenInbox();
              }}
            >
              <Icon name="inbox" size={13} />
              {totalAttention > 0 ? totalAttention : null}
            </span>
          )}
          <Icon
            name="chevronDown"
            size={14}
            className={"text-faint shrink-0 transition-transform " + (appMenuOpen ? "" : "rotate-180")}
          />
        </button>
      </div>
    </div>
      {signInOpen && (
        <QumgeSignInModal
          onClose={() => setSignInOpen(false)}
          onConnected={() => void refreshAccount()}
        />
      )}
    </>
  );
}
