import { useState } from "react";
import { McpTab } from "./ManageTabs";
import { ConnectorsSection } from "./connectors/ConnectorsSection";
import { Icon } from "./Icon";
import { useT } from "../i18n";

// 一个页面，一个列表。
//
// 这里【曾经】是两个标签：Connectors 和 MCP servers。对我们是两件事（一个是账号，
// 一个是工具服务器），对用户是同一件事：「Marlo 能用什么」。分成两个标签的代价是
// 具体的——两段几乎一样的说明文字（"External tool servers…" 在这里和 ManageTabs
// 里各写了一遍，改一处另一处就漂），以及一个非技术用户会以为自己要在两处各配一次。
//
// MCP 收进折叠的「高级」：它有用，但一个刚打开 Marlo 的人不该在这里被 stdio/HTTP
// 拦住。默认收起 = 默认不存在；想要的人点一下就有。
export function IntegrationsView() {
  const t = useT();
  const [showServers, setShowServers] = useState(false);

  return (
    <main className="flex-1 min-w-0 flex bg-paper">
      <div className="flex-1 min-w-0 overflow-y-auto hairline-scroll">
        <div className="max-w-4xl mx-auto px-7 py-6">
          <PanelHead title={t("connectionsTitle")} sub={t("connectionsSub")} />
          <ConnectorsSection />

          <section className="mt-8 border-t border-line pt-5">
            <button
              className="w-full flex items-center gap-2 text-left text-[13px] text-muted hover:text-ink"
              data-testid="advanced-tool-servers"
              aria-expanded={showServers}
              onClick={() => setShowServers((v) => !v)}
            >
              <Icon name="code" size={15} />
              <span className="font-medium">{t("advancedToolServers")}</span>
              <span className="ml-auto text-faint text-[16px] leading-none">
                {showServers ? "−" : "+"}
              </span>
            </button>
            {showServers && (
              <div className="mt-4">
                <p className="text-[12.5px] text-muted mb-4">{t("advancedToolServersSub")}</p>
                <McpTab />
              </div>
            )}
          </section>
        </div>
      </div>
    </main>
  );
}

export function PanelHead({ title, sub }: { title: string; sub: string }) {
  return (
    <div className="mb-4">
      <h2 className="text-[18px] font-semibold tracking-tight">{title}</h2>
      <p className="text-[12.5px] text-muted mt-0.5">{sub}</p>
    </div>
  );
}
