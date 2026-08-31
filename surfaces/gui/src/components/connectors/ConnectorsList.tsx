import { useState } from "react";
import { useTranslation } from "react-i18next";
import type { TFunction } from "i18next";
import { type CloudStatus, type Connector, type McpServer, type SlackStatus } from "../../api";
import { ConnectorBadge } from "../../connectors/ConnectorIcon";
import { AddConnectionModal } from "./AddConnectionModal";
import { AddMcpModal, CustomMcpGroup } from "./CustomMcp";
import { CHIP_OK, CHIP_OFF, CHIP_WARN, GRP, GRP_H, PILL_QUIET, FOOT, ROW } from "./ui";

// The Connectors LIST (UX-DECISIONS §21): connected first in their own inset group —
// rows navigate to the connector's detail subpage; problems surface as a chip in the
// list, never one click deep. Available connectors below with a Connect pill.
// Custom MCP servers (UX-034) render as their own group after Connected; the "Add
// custom server" affordance sits at the top of the page (owner ruling: top).

const AVAILABLE_FOLD = 8; // rows shown before "show all"

// 分组顺序固定：邮件/日历/聊天在前 —— 白领的活先落在这几样上；「其他」永远垫底。
const GROUP_ORDER = ["mail", "calendar", "chat", "files", "web", "other"] as const;
const GROUP_LABELS = {
  // 值是 i18n 的键。分组本身是我们 fork 的（ac6f51a：连接列表按用户认得的东西
  // 分组），上游没有对应 UI，所以这六个键住在 overlay 里。
  mail: "connector.group_mail", calendar: "connector.group_calendar", chat: "connector.group_chat",
  files: "connector.group_files", web: "connector.group_web", other: "connector.group_other",
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
  mcpServers,
  cloud,
  slack,
  onOpen,
  onChanged,
}: {
  connectors: Connector[];
  mcpServers: McpServer[];
  cloud: CloudStatus | null;
  slack: SlackStatus | null;
  onOpen: (name: string) => void;
  onChanged: () => void;
}) {
  const { t } = useTranslation();
  const [filter, setFilter] = useState("");
  const [connecting, setConnecting] = useState<string | null>(null);
  const [addingMcp, setAddingMcp] = useState(false);

  const q = filter.trim().toLowerCase();
  const match = (c: Connector) => !q || c.title.toLowerCase().includes(q) || c.name.includes(q);
  const connected = connectors.filter((c) => c.connected && match(c));
  const available = connectors.filter((c) => !c.connected && c.available && match(c));
  const customMcp = mcpServers.filter((s) => !q || s.name.toLowerCase().includes(q));
  const [showAll, setShowAll] = useState(false);
  const shown = showAll || q ? available : available.slice(0, AVAILABLE_FOLD);
  const connectingC = connecting ? connectors.find((c) => c.name === connecting) : null;

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <button
          className={PILL_QUIET}
          onClick={() => setAddingMcp(true)}
          data-testid="add-custom-server"
        >
          {t("connector.add_custom_mcp")}
        </button>
        <input
          placeholder={t("connector.search")}
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          className="w-44 px-3.5 py-1.5 rounded-full border border-line bg-panel text-[13px] outline-none focus:border-accent"
        />
      </div>

      {/* No cloud strip here anymore (§26): the sidebar's account row is the permanent
          sign-in home, and the connect modals keep their inline sign-in panes. */}
      {connected.length > 0 && (
        <>
          <div className={GRP_H + " !mt-0"}>{t("connector.connected_count", { count: connected.length })}</div>
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
                  <span className="font-medium text-[13px]">{c.title}</span>
                  <span className="block text-[12px] text-muted">{statusLine(c, t)}</span>
                </span>
                {healthChip(c, slack, t)}
                <span className="text-faint text-[14px] shrink-0">›</span>
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
                        ? t("connector.use_imap_instead")
                        : t("connector.waiting_upstream")}
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
                      {t("automations.connect")}
                    </span>
                  )}
                </button>
              ))}
            </div>
          </div>
        );
      })}
      {shown.length === 0 && (
        <div className={ROW + " text-[12.5px] text-muted"}>{t("connector.nothing_matches")}</div>
      )}
      <CustomMcpGroup
        servers={customMcp}
        onOpen={(name) => onOpen("mcp:" + name)}
        onChanged={onChanged}
      />

      {/* 上游在这里还有一份平铺的 Available 列表。我们的分组列表（上面 GROUP_ORDER
          那段，ac6f51a：按用户认得的东西分组）已经把同一批连接器渲染过一遍了 ——
          两份都留会让每个连接器出现两次，e2e 的 strict mode 当场报重复元素。 */}

      {/* 展开入口：分组列表默认只铺前 AVAILABLE_FOLD 个。上游把它放在自己那份
          平铺列表的末尾，删那份的时候连它一起删了 —— 结果 36 个连接器里只看得见
          8 个，而且没有任何办法看到其余的。 */}
      {!showAll && !q && available.length > AVAILABLE_FOLD && (
        <div className={FOOT}>
          {t("connector.more_count", { count: available.length - AVAILABLE_FOLD })}{" "}
          <button className="text-muted hover:text-ink" onClick={() => setShowAll(true)}>
            {t("connector.show_all")}
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
      {addingMcp && <AddMcpModal onClose={() => setAddingMcp(false)} onChanged={onChanged} />}
    </div>
  );
}

function statusLine(c: Connector, t: TFunction): string {
  if (c.name === "slack" && c.mode === "relay") {
    const n = c.workspaces?.length ?? 0;
    return t("connector.slack_status", { count: n });
  }
  if ((c.accounts?.length ?? 0) > 1) return t("connector.account_count", { count: c.accounts!.length });
  if ((c.portals?.length ?? 0) > 1) return t("connector.portal_count", { count: c.portals!.length });
  if (c.auth === "none") return t("connector.built_in");
  return c.account || t("connector.connected");
}

function healthChip(c: Connector, slack: SlackStatus | null, t: TFunction) {
  // Slack relay gets a LIVE chip from /v1/connectors/slack/status — problems
  // surface in the list, never one click deep. Named honestly per layer; we
  // never claim "Slack↔cloud down" (the desktop can't see that leg).
  if (c.name === "slack" && c.mode === "relay" && slack) {
    if (!slack.signed_in) return <span className={CHIP_WARN}>{"● " + t("connector.sign_in_needed")}</span>;
    if (slack.relay.state === "offline") return <span className={CHIP_OFF}>{"● " + t("connector.offline")}</span>;
    if (slack.relay.state === "reconnecting")
      return <span className={CHIP_WARN}>{"● " + t("connector.reconnecting")}</span>;
    if (Object.values(slack.teams).some((tm) => !tm.token_ok))
      return <span className={CHIP_WARN}>{"⚠ " + t("connector.token")}</span>;
    return <span className={CHIP_OK}>{"● " + t("connector.live")}</span>;
  }
  if (c.two_way && c.connected) return <span className={CHIP_OK}>{"● " + t("connector.live")}</span>;
  return <span className={CHIP_OK}>{"● " + t("connector.ready")}</span>;
}
