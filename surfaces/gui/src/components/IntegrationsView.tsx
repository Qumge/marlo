import { useTranslation } from "react-i18next";
import { ConnectorsSection } from "./connectors/ConnectorsSection";

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
  const { t } = useTranslation();

  return (
    <main className="flex-1 min-w-0 flex bg-paper">
      <div className="flex-1 min-w-0 overflow-y-auto hairline-scroll">
        <div className="max-w-4xl mx-auto px-7 py-6">
          <PanelHead title={t("integrations.connections_title")} sub={t("integrations.connections_sub")} />
          <ConnectorsSection />

          {/* 「高级：工具服务器」那个折叠区去掉了。它当初是为了不让 MCP 单占一个
              标签页 —— 上游 UX-034 用同一个理由把 MCP 内联进了连接页本身
              （ConnectorsList 里的 CustomMcpGroup）。两个都留的话，MCP 预设会在
              一个页面上渲染两遍，e2e 的 strict mode 当场报重复元素。 */}
        </div>
      </div>
    </main>
  );
}

export function PanelHead({ title, sub }: { title: string; sub: string }) {
  return (
    <div className="mb-4">
      <h2 className="text-[20px] font-semibold tracking-tight">{title}</h2>
      <p className="text-[13px] text-muted mt-0.5">{sub}</p>
    </div>
  );
}
