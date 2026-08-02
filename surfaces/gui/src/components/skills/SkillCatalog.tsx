import { useEffect, useState } from "react";
import {
  installSkill,
  searchSkills,
  skillDetail,
  type CatalogSkill,
} from "../../api";
import { useT } from "../../i18n";
import { GRP, GRP_H, PILL_QUIET, ROW } from "../connectors/ui";

// 按分类分组，我们审过的排最前。分类名直接用目录给的（marketing-growth 这种）
// —— 翻译它们意味着维护一张 20+ 项、还会随目录增长的表，而用户在网站上看到的
// 也是这些名字。
function groupsOf(rows: CatalogSkill[]): [string, CatalogSkill[]][] {
  const by = new Map<string, CatalogSkill[]>();
  for (const r of rows) {
    const g = r.group || "other";
    (by.get(g) ?? by.set(g, []).get(g)!).push(r);
  }
  return [...by.entries()].sort((a, b) =>
    a[0] === "__vetted__" ? -1 : b[0] === "__vetted__" ? 1 : b[1].length - a[1].length,
  );
}

// 技能目录 —— qumge.com 上 4500+ 条公开技能的搜索/浏览/安装界面。
//
// 【关于搜索】规格 D' 说发现发生在对话里：用户说要做什么，Marlo 自己去找。那仍然
// 是主路径。但 owner 的判断是用户也要能自己看 —— 一个东西你完全看不见里面有什么，
// 是很难信任它的。所以这里给搜索，而不是把它藏起来。两条路指向同一个目录。
//
// 搜索框的 placeholder 写"搜技能目录"而不是"搜索"，空结果提示写"试试直接说你要做
// 的事，而不是工具的名字"—— 这个目录是按【用途】索引的，按工具名搜经常是空的，而
// 空结果不解释原因的话，人会以为目录里没东西。
export function SkillCatalog({
  installedNames,
  onInstalled,
}: {
  installedNames: Set<string>;
  onInstalled: () => void;
}) {
  const t = useT();
  const [q, setQ] = useState("");
  const [results, setResults] = useState<CatalogSkill[] | null>(null);
  const [searchErr, setSearchErr] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(false);
  // 目录把非英文查询翻成英文搜时，实际搜的那串词。
  const [searchedAs, setSearchedAs] = useState("");
  const [loadingMore, setLoadingMore] = useState(false);
  // 装之前先看看它到底会做什么 —— 一条技能就是一段【会被当成指令读】的文字。
  const [detail, setDetail] = useState<{ name: string; body: string } | null>(null);

  // 输入停下来再搜。每敲一个字就打一次目录，既慢又白费 —— 而这条路要出网。
  useEffect(() => {
    const term = q.trim();
    // 没输入【不是】不搜 —— 那是浏览：铺一份排名靠前的默认列表。空白会让人
    // 以为目录里没东西。
    const h = setTimeout(() => {
      searchSkills(term)
        .then((r) => {
          setResults(r.results || []);
          setHasMore(!!r.has_more);
          setSearchedAs(r.searched_as || "");
          setSearchErr(r.error || "");
        })
        .catch((e) => setSearchErr(String(e?.message || e)));
    }, q.trim() ? 400 : 0);   // 浏览是首屏，不用等防抖
    return () => clearTimeout(h);
  }, [q]);

  const loadMore = async () => {
    setLoadingMore(true);
    // 用【当前已加载的条数】当 offset，而不是页码：分组是客户端做的，页码和
    // 服务端的偏移量对不上。
    const r = await searchSkills(q.trim(), (results || []).length).catch(() => null);
    setLoadingMore(false);
    if (!r) return;
    setResults([...(results || []), ...(r.results || [])]);
    setHasMore(!!r.has_more);
  };

  const openDetail = async (c: CatalogSkill) => {
    setDetail({ name: c.name, body: "" });
    const r = await skillDetail(c.slug).catch((e: any) => ({ body: "", error: String(e) }));
    setDetail({ name: c.name, body: r.body || r.error || "" });
  };

  const add = async (s: CatalogSkill) => {
    setBusy(s.slug);
    const r = await installSkill(s.slug).catch((e) => ({ ok: false, error: String(e) }));
    setBusy(null);
    if (r.ok) onInstalled();          // 【唯一的行为改动】原来是 reload()，现在通知外层
    else setSearchErr(r.error || "install failed");
  };

  return (
    <>
      {/* 和「连接」页一模一样的搜索框：右对齐的短框。两页并列在同一个菜单
          里，长得不一样会让人以为是两种东西。 */}
      <div className="flex items-center justify-end mb-4">
        <input
          className="w-44 px-3.5 py-1.5 rounded-full border border-line bg-panel text-[13px] outline-none focus:border-accent"
          placeholder={t("abilitiesSearch")}
          value={q}
          onChange={(e) => setQ(e.target.value)}
          data-testid="abilities-search"
        />
      </div>

      {/* 用中文搜出来一屏英文标题，得说清楚为什么。不说的话，用户既无法理解
          这些结果从哪来，也无从发现翻错了——而翻错时改用词是他唯一的补救。 */}
      {searchedAs && !searchErr && (
        <div className="text-[12px] text-dim mb-4" data-testid="abilities-translated">
          {t("abilitiesTranslated")} “{searchedAs}”
        </div>
      )}

      {searchErr && (
        <div className="text-[12px] text-warnInk mb-4" data-testid="abilities-error">
          {t("abilitiesSearchFailed")} {searchErr}
        </div>
      )}

      {/* 目录：按分类分组，和「连接」页的 邮件/日历/聊天 一个形状。
          我们审过的单独一组排最前 —— 那是它们相对于四千条第三方技能的
          唯一区别，也是用户最该先看到的。 */}
      {results !== null &&
        (results.length === 0 && !searchErr ? (
          <div className="text-[12.5px] text-muted">{t("abilitiesNoResults")}</div>
        ) : (
          <div data-testid="abilities-results">
            {groupsOf(results).map(([g, rows]) => (
              <div key={g}>
                <div className={GRP_H}>{g === "__vetted__" ? t("abilitiesVetted") : g}</div>
                <div className={GRP}>
                  {rows.map((s) => (
                    <div key={s.slug} className={ROW} data-testid={`catalog-${s.name}`}>
                      <span className="min-w-0 flex-1">
                        <span className="font-medium text-[13.5px]">{s.name}</span>
                        <span className="block text-[12px] text-muted">{s.summary}</span>
                        <span className="block text-[11.5px] text-faint mt-0.5">{s.meta}</span>
                        {s.needs && (
                          // 装之前就说清楚它要账号 —— 装完才发现连不上是最差的顺序。
                          <span className="block text-[11.5px] text-warnInk mt-0.5">
                            {t("abilitiesNeeds")} {s.needs}
                          </span>
                        )}
                      </span>
                      <button
                        className="shrink-0 text-[11.5px] text-faint hover:text-ink mr-2"
                        onClick={() => openDetail(s)}
                        data-testid={`view-${s.name}`}
                      >
                        {t("abilitiesView")}
                      </button>
                      {installedNames.has(s.name) ? (
                        <span className="text-[11.5px] text-faint shrink-0">
                          {t("abilitiesInstalled")}
                        </span>
                      ) : (
                        <button
                          className={PILL_QUIET + " shrink-0 disabled:opacity-50"}
                          disabled={busy === s.slug}
                          onClick={() => add(s)}
                          data-testid={`install-${s.name}`}
                        >
                          {busy === s.slug ? t("abilitiesInstalling") : t("abilitiesInstall")}
                        </button>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            ))}
            {hasMore && (
              <button
                className="mt-3 w-full py-2 rounded-xl border border-line text-[12.5px] text-muted hover:text-ink disabled:opacity-50"
                disabled={loadingMore}
                onClick={loadMore}
                data-testid="abilities-more"
              >
                {loadingMore ? t("abilitiesLoading") : t("abilitiesMore")}
              </button>
            )}
          </div>
        ))}

      {/* 装之前先看看它到底会做什么。
          一条技能就是一段【会被当成指令读】的文字，来自公开的 GitHub 仓库
          ——用户有权先读一遍。面板顶部那句话不是免责声明，是在说明我们怎么
          对待它：当参考读，不当命令执行（隔离框做的就是这件事）。 */}
      {detail && (
        <div
          className="fixed inset-0 z-40 grid place-items-center bg-black/30 p-8"
          onClick={() => setDetail(null)}
          data-testid="ability-detail"
        >
          <div
            className="max-w-3xl w-full max-h-[80vh] overflow-y-auto rounded-2xl bg-panel border border-line p-6"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-start gap-3 mb-3">
              <div className="font-semibold text-[15px] flex-1">{detail.name}</div>
              <button
                className="text-[12.5px] text-faint hover:text-ink"
                onClick={() => setDetail(null)}
              >
                {t("abilitiesClose")}
              </button>
            </div>
            <div className="text-[11.5px] text-faint mb-3">{t("abilitiesUntrusted")}</div>
            <pre className="text-[12px] leading-relaxed whitespace-pre-wrap break-words">
              {detail.body || t("abilitiesLoading")}
            </pre>
          </div>
        </div>
      )}
    </>
  );
}
