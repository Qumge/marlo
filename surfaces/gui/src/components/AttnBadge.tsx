// 需要你处理的条数。侧栏的三处（Inbox 行、分组头、Scheduled 带）和账号菜单
// 都用它 —— 独立成文件是因为账号行抽成 AccountRow 之后，从 Sidebar 导出它
// 会形成 Sidebar → AccountRow → Sidebar 的循环 import。
import { useT } from "../i18n";

export function AttnBadge({ n }: { n: number }) {
  const t = useT();
  if (!n) return null;
  return (
    <span
      className="text-[10px] font-semibold text-ink bg-faint/30 rounded-full px-1.5 leading-[15px] shrink-0"
      title={t("tplAwaitingAttention")(n)}
    >
      {n > 99 ? "99+" : n}
    </span>
  );
}
