import { useState } from "react";
import { type CloudStatus, type Connector, type SlackStatus } from "../../api";
import { ConnectorBadge } from "../../connectors/ConnectorIcon";
import { AddConnectionModal } from "./AddConnectionModal";
import { CHIP_OK, CHIP_OFF, CHIP_WARN, GRP, GRP_H, FOOT, PILL_QUIET, ROW } from "./ui";
import { t, useT } from "../../i18n";

// The Connectors LIST (UX-DECISIONS §21): connected first in their own inset group —
// rows navigate to the connector's detail subpage; problems surface as a chip in the
// list, never one click deep. Available connectors below with a Connect pill.

const AVAILABLE_FOLD = 8; // rows shown before "show all"

// 分组顺序固定：邮件/日历/聊天在前 —— 白领的活先落在这几样上；「其他」永远垫底。
const GROUP_ORDER = ["mail", "calendar", "chat", "files", "web", "other"] as const;
const GROUP_LABELS = {
  mail: "groupMail", calendar: "groupCalendar", chat: "groupChat",
  files: "groupFiles", web: "groupWeb", other: "groupOther",
} as const;

/** 这个版本连不上的：只有 OAuth 一条路，而托管那条正卡在上游审核里。
 *
 *  判据是【没有别的路可走】，不是「managed_paused 为真」：一个连接器如果还有
 *  手填字段（比如 token），用户仍然能连上，那不是死胡同。 */
function blocked(c: Connector): boolean {
  return Boolean(c.managed_paused) && c.auth === "oauth" && c.fields.length <= 1;
}

export function ConnectorsList({
  connectors,
  cloud,
  slack,
  onOpen,
  onChanged,
}: {
  connectors: Connector[];
  cloud: CloudStatus | null;
  slack: SlackStatus | null;
  onOpen: (name: string) => void;
  onChanged: () => void;
}) {
  const t = useT();
  const [filter, setFilter] = useState("");
  const [showAll, setShowAll] = useState(false);
  const [connecting, setConnecting] = useState<string | null>(null);

  const q = filter.trim().toLowerCase();
  const match = (c: Connector) => !q || c.title.toLowerCase().includes(q) || c.name.includes(q);
  const connected = connectors.filter((c) => c.connected && match(c));
  const available = connectors.filter((c) => !c.connected && c.available && match(c));
  const shown = showAll || q ? available : available.slice(0, AVAILABLE_FOLD);
  const connectingC = connecting ? connectors.find((c) => c.name === connecting) : null;

  return (
    <div>
      <div className="flex items-center justify-end mb-4">
        <input
          placeholder={t("searchPlaceholder")}
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          className="w-44 px-3.5 py-1.5 rounded-full border border-line bg-panel text-[13px] outline-none focus:border-accent"
        />
      </div>

      {/* No cloud strip here anymore (§26): the sidebar's account row is the permanent
          sign-in home, and the connect modals keep their inline sign-in panes. */}
      {connected.length > 0 && (
        <>
          <div className={GRP_H + " !mt-0"}>Connected · {connected.length}</div>
          <div className={GRP}>
            {connected.map((c) => (
              <button
                key={c.name}
                data-testid={`connector-${c.name}`}
                className={ROW + " w-full text-left hover:bg-paper/60"}
                onClick={() => onOpen(c.name)}
              >
                <ConnectorBadge connector={c} size={34} title={c.title} />
                <span className="min-w-0 flex-1">
                  <span className="font-medium text-[13.5px]">{c.title}</span>
                  <span className="block text-[12px] text-muted">{statusLine(c)}</span>
                </span>
                {healthChip(c, slack)}
                <span className="text-faint text-[15px] shrink-0">›</span>
              </button>
            ))}
          </div>
        </>
      )}

      {/* 按用户认得的东西分组。原来是一个平铺的 Available 列表 + 「显示全部」，
          36 个连接器堆在一起，找自己的邮箱要从头扫到尾。分组顺序是固定的：
          邮件/日历/聊天在前，因为白领的活先落在这几样上。 */}
      {GROUP_ORDER.map((g) => {
        const rows = shown.filter((c) => (c.group || "other") === g);
        if (rows.length === 0) return null;
        return (
          <div key={g}>
            <div className={GRP_H}>{t(GROUP_LABELS[g])}</div>
            <div className={GRP}>
              {rows.map((c) => (
                /* The row navigates to the pre-connect detail page (§38); the pill
                   stays the fast path straight into the modal. */
                <button
                  key={c.name}
                  data-testid={`connector-${c.name}`}
                  className={ROW + " w-full text-left hover:bg-paper/60"}
                  onClick={() => onOpen(c.name)}
                >
                  <ConnectorBadge connector={c} size={34} title={c.title} />
                  <span className="min-w-0 flex-1">
                    <span className="font-medium text-[13.5px]">{c.title}</span>
                    <span className="block text-[12px] text-muted truncate">{c.blurb}</span>
                  </span>
                  {blocked(c) ? (
                    /* 死胡同不给「连接」按钮。这几个只有 OAuth 一条路，而那条路
                       正卡在上游审核里 —— 显示一个点了没反应的按钮，用户会以为
                       是坏了；直说它在等，并指去能用的那条路。 */
                    <span
                      className={
                        "text-[11.5px] shrink-0 " +
                        ((c.group || "other") === "mail" ? "text-accent cursor-pointer hover:underline" : "text-faint")
                      }
                      data-testid={`blocked-${c.name}`}
                      role={(c.group || "other") === "mail" ? "button" : undefined}
                      onClick={(e) => {
                        // 邮件类的死胡同【有出路】：Email (IMAP) 能连同一个邮箱。
                        // 规格 E 说的就是这个 —— 别显示一个灰按钮让人以为坏了，
                        // 直接把他带到走得通的那条路上。
                        if ((c.group || "other") !== "mail") return;
                        e.stopPropagation();
                        setConnecting("email");
                      }}
                    >
                      {(c.group || "other") === "mail"
                        ? t("connectorUseImapInstead")
                        : t("connectorWaitingUpstream")}
                    </span>
                  ) : (
                    <span
                      className={PILL_QUIET + " cursor-pointer"}
                      role="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        setConnecting(c.name);
                      }}
                    >
                      {t("connect")}
                    </span>
                  )}
                </button>
              ))}
            </div>
          </div>
        );
      })}
      {shown.length === 0 && (
        <div className={ROW + " text-[12.5px] text-muted"}>{t("connNothingMatches")}</div>
      )}
      {!showAll && !q && available.length > AVAILABLE_FOLD && (
        <div className={FOOT}>
          {available.length - AVAILABLE_FOLD} more ·{" "}
          <button className="text-muted hover:text-ink" onClick={() => setShowAll(true)}>
            show all
          </button>
        </div>
      )}

      {connectingC && (
        <AddConnectionModal
          c={connectingC}
          cloud={cloud}
          onClose={() => setConnecting(null)}
          onChanged={onChanged}
        />
      )}
    </div>
  );
}

function statusLine(c: Connector): string {
  if (c.name === "slack" && c.mode === "relay") {
    const n = c.workspaces?.length ?? 0;
    return t("tplNWorkspacesRelay")(n);
  }
  if ((c.accounts?.length ?? 0) > 1) return `${c.accounts!.length} accounts`;
  if ((c.portals?.length ?? 0) > 1) return `${c.portals!.length} portals`;
  if (c.auth === "none") return "Built in";
  return c.account || "Connected";
}

function healthChip(c: Connector, slack: SlackStatus | null) {
  // Slack relay gets a LIVE chip from /v1/connectors/slack/status — problems
  // surface in the list, never one click deep. Named honestly per layer; we
  // never claim "Slack↔cloud down" (the desktop can't see that leg).
  if (c.name === "slack" && c.mode === "relay" && slack) {
    if (!slack.signed_in) return <span className={CHIP_WARN}>● Sign-in needed</span>;
    if (slack.relay.state === "offline") return <span className={CHIP_OFF}>● Offline</span>;
    if (slack.relay.state === "reconnecting")
      return <span className={CHIP_WARN}>● Reconnecting</span>;
    if (Object.values(slack.teams).some((t) => !t.token_ok))
      return <span className={CHIP_WARN}>⚠ Token</span>;
    return <span className={CHIP_OK}>● Live</span>;
  }
  if (c.two_way && c.connected) return <span className={CHIP_OK}>● Live</span>;
  return <span className={CHIP_OK}>● Ready</span>;
}

