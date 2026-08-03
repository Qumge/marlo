import { useEffect, useRef, useState } from "react";
import {
  installSkill,
  searchSkills,
  skillDetail,
  type CatalogSkill,
} from "../../api";
import { useT } from "../../i18n";
import { GRP, GRP_H, PILL_LINE, PILL_QUIET, ROW } from "../connectors/ui";

// 按分类分组，我们审过的排最前。分组本身就是页签的来源 —— 名字在 i18n 里译
// （skCategory），这里只管分。
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
  onError,
}: {
  installedNames: Set<string>;
  onInstalled: () => void;
  // 安装失败往【页面级】错误条走（和另外三个子组件一样）。不塞进 searchErr ——
  // 那条渲染时前缀是「连不上目录：」，后端拒绝一次安装会被读成目录连不上。
  onError: (msg: string) => void;
}) {
  const t = useT();
  // 【q 和 term 是两件事】q 是输入框里的字，term 是【已经提交过】的那个词。加了
  // 「搜索」按钮之后敲字不再等于搜索，而结果和「加载更多」的 offset 必须跟着
  // term 走：跟 q 走的话，用户改完字还没点搜索，翻页就已经用新词去要下一段了。
  const [q, setQ] = useState("");
  const [term, setTerm] = useState("");
  const [results, setResults] = useState<CatalogSkill[] | null>(null);
  const [searchErr, setSearchErr] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(false);
  // 目录把非英文查询翻成英文搜时，实际搜的那串词。
  const [searchedAs, setSearchedAs] = useState("");
  const [loadingMore, setLoadingMore] = useState(false);
  const [searching, setSearching] = useState(false);
  // 选中的分类页签；空串是「全部」。
  const [tab, setTab] = useState("");
  // 装之前先看看它到底会做什么 —— 一条技能就是一段【会被当成指令读】的文字。
  const [detail, setDetail] = useState<{ name: string; body: string } | null>(null);

  // 【谁最后发的谁说了算】原来靠防抖 effect 的 cleanup 挡乱序，改成点按钮触发之后
  // 那层没有了 —— 连点两下搜索，先发的那次晚回来会盖掉后发的结果，而界面上看不出
  // 任何异常，只是显示了一批不对应输入框的结果。
  const seq = useRef(0);

  const run = async (next: string) => {
    const mine = ++seq.current;
    setTerm(next);
    setSearching(true);
    setTab("");   // 换了一批结果，旧页签多半已经不在里面了
    try {
      const r = await searchSkills(next);
      if (mine !== seq.current) return;
      setResults(r.results || []);
      setHasMore(!!r.has_more);
      setSearchedAs(r.searched_as || "");
      setSearchErr(r.error || "");
    } catch (e: any) {
      if (mine !== seq.current) return;
      setSearchErr(String(e?.message || e));
    } finally {
      if (mine === seq.current) setSearching(false);
    }
  };

  // 首屏【不是】空白：没输入不是"不搜"，是浏览 —— 铺一份排名靠前的默认列表。
  // 空白会让人以为目录里没东西。
  useEffect(() => {
    run("");
  }, []);

  const loadMore = async () => {
    setLoadingMore(true);
    // 用【当前已加载的条数】当 offset，而不是页码：分组是客户端做的，页码和
    // 服务端的偏移量对不上。
    const r = await searchSkills(term, (results || []).length).catch(() => null);
    setLoadingMore(false);
    if (!r) return;
    setResults([...(results || []), ...(r.results || [])]);
    setHasMore(!!r.has_more);
  };

  const groups = groupsOf(results || []);
  // 页签名：全部 / Qumge 精选 / 译过的分类名。
  const label = (g: string) =>
    g === "" ? t("skAll") : g === "__vetted__" ? t("skVetted") : t("skCategory")(g);
  const shown = tab ? groups.filter(([g]) => g === tab) : groups;

  // 条目自己的 meta 里也带着分类：「category: personal-productivity · 312 stars on …」。
  // 页签上已经译成「个人效率」了，这里再露出 slug，同一个词在同一屏上就有了两种
  // 写法 —— 那比两处都不译更糟，因为它看起来像是两个不同的东西。
  // 只换开头那一段：后面的仓库名、星数是专有名词和事实，翻译它们只会弄坏。
  const metaOf = (s: CatalogSkill) => {
    if (!s.meta.startsWith("category:")) return s.meta;
    const rest = s.meta.split("·").slice(1).join("·").trim();
    return [label(s.group), rest].filter(Boolean).join(" · ");
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
    if (r.ok) {
      onError("");
      onInstalled();                  // 【唯一的行为改动】原来是 reload()，现在通知外层
    } else {
      // 安装失败【不是】搜索失败：searchErr 只归搜索，它的前缀是「连不上目录：」。
      onError(r.error || t("skWentWrong"));
    }
  };

  return (
    <>
      {/* 搜索框在【页面中部】，紧贴它过滤的那批结果，而不是像「连接」页那样蹲在
          页头。合页之后这一页有两批东西：上半页是已装的，下半页才是目录 —— 搜索
          只作用于后者。搬到页顶会让它看起来像在搜整页（包括已装列表）。
          外形仍和「连接」页一致（右对齐的短圆框）：两页并列在同一个菜单里，长得
          不一样会让人以为是两种东西。

          【mt-6】原来只有 mb-4。上面是已装列表那张卡，搜索框贴着卡的下沿，读起来
          像是那张卡的一部分 —— 而它搜的是下面的目录。mt-6 就是这一页分组标题
          （GRP_H）用的那个间距。

          【两个按钮】原来是敲字 400ms 防抖自动搜。改成显式提交：这条路要出网，
          而"我到底什么时候真的搜了"在自动搜里是看不见的。「重置」不等于「清空
          输入框」—— 它把默认的浏览列表放回来，那是光靠删字回不去的状态（删字只
          是把 q 变空，不会重新去要一次）。
          用 <form> 而不是给 input 挂 onKeyDown：回车提交是浏览器自带的，手写一遍
          意味着以后有人改按钮时，回车那条路会悄悄和它分叉。 */}
      <form
        className="flex items-center justify-end gap-2 mt-6 mb-4"
        onSubmit={(e) => {
          e.preventDefault();
          run(q.trim());
        }}
      >
        {/* h-9 挂在三个上面，而不是让 py-1.5 各自算各自的：输入框是 13px 文字、
            按钮是 12.5px，同样的内边距算出来差一两个像素 —— 并排放着一眼就看得出
            没对齐。定死一个高度是唯一不会随字号漂的做法。 */}
        <input
          className="h-9 w-44 px-3.5 rounded-full border border-line bg-panel text-[13px] outline-none focus:border-accent"
          placeholder={t("skSearch")}
          value={q}
          onChange={(e) => setQ(e.target.value)}
          data-testid="skills-search"
        />
        <button
          type="submit"
          className={PILL_QUIET + " h-9 disabled:opacity-50"}
          disabled={searching}
          data-testid="skills-search-go"
        >
          {t("skSearchBtn")}
        </button>
        <button
          type="button"
          className={PILL_LINE + " h-9"}
          onClick={() => {
            setQ("");
            run("");
          }}
          data-testid="skills-reset"
        >
          {t("skReset")}
        </button>
      </form>

      {/* 用中文搜出来一屏英文标题，得说清楚为什么。不说的话，用户既无法理解
          这些结果从哪来，也无从发现翻错了——而翻错时改用词是他唯一的补救。 */}
      {searchedAs && !searchErr && (
        <div className="text-[12px] text-dim mb-4" data-testid="skills-translated">
          {t("skTranslated")} “{searchedAs}”
        </div>
      )}

      {searchErr && (
        <div className="text-[12px] text-warnInk mb-4" data-testid="skills-error">
          {t("skSearchFailed")} {searchErr}
        </div>
      )}

      {/* 目录：按分类分组，和「连接」页的 邮件/日历/聊天 一个形状。
          我们审过的单独一组排最前 —— 那是它们相对于四千条第三方技能的
          唯一区别，也是用户最该先看到的。 */}
      {results !== null &&
        (results.length === 0 && !searchErr ? (
          <div className="text-[12.5px] text-muted">{t("skNoResults")}</div>
        ) : (
          <div data-testid="skills-results">
            {/* 分类做成页签，而不是一路堆下去的分节标题：浏览一次回来 30 条、横跨
                七八个分类，堆叠意味着想看某一类得先滚过前面所有类。页签把"挑一类"
                变成一次点击，而带上条数是为了让它诚实 —— 页签过滤的是【已经加载的
                这批】，不是目录里那一整个分类。
                标签必须翻译：marketing-growth 是 qumge 内部的写法，中文界面上出现
                它等于把实现细节摊给用户看。译名表在 i18n 里（skCategory）。 */}
            <div className="flex flex-wrap gap-1.5 mb-1" data-testid="skills-tabs">
              {([["", results.length]] as [string, number][])
                .concat(groups.map(([g, rows]) => [g, rows.length]))
                .map(([g, n]) => (
                  <button
                    key={g || "__all__"}
                    className={
                      "text-[12px] font-medium px-2.5 py-1 rounded-full border " +
                      (tab === g
                        ? "bg-accent text-white border-transparent"
                        : "bg-panel text-muted border-line hover:text-ink")
                    }
                    onClick={() => setTab(g)}
                    data-testid={`skills-tab-${g || "all"}`}
                  >
                    {label(g)} · {n}
                  </button>
                ))}
            </div>
            {shown.map(([g, rows], i) => (
              <div key={g}>
                {/* 选中某一个页签时不再重复它的名字 —— 页签自己就是那个标题。
                    第一组压成 !mt-3：上面紧挨着页签条，GRP_H 自带的 mt-6 是"和
                    上一组拉开距离"用的，用在这里会把标题和它的页签扯断。 */}
                {!tab && (
                  <div
                    className={GRP_H + (i === 0 ? " !mt-3" : "")}
                    data-testid={`skills-group-${g}`}
                  >
                    {label(g)}
                  </div>
                )}
                <div className={GRP + (tab ? " mt-3" : "")}>
                  {rows.map((s) => (
                    <div key={s.slug} className={ROW} data-testid={`catalog-${s.name}`}>
                      <span className="min-w-0 flex-1">
                        <span className="font-medium text-[13.5px]">{s.name}</span>
                        <span className="block text-[12px] text-muted">{s.summary}</span>
                        <span className="block text-[11.5px] text-faint mt-0.5">{metaOf(s)}</span>
                        {s.needs && (
                          // 装之前就说清楚它要账号 —— 装完才发现连不上是最差的顺序。
                          <span className="block text-[11.5px] text-warnInk mt-0.5">
                            {t("skNeeds")} {s.needs}
                          </span>
                        )}
                      </span>
                      <button
                        className="shrink-0 text-[11.5px] text-faint hover:text-ink mr-2"
                        onClick={() => openDetail(s)}
                        data-testid={`view-${s.name}`}
                      >
                        {t("skViewBody")}
                      </button>
                      {installedNames.has(s.name) ? (
                        <span className="text-[11.5px] text-faint shrink-0">
                          {t("skInstalled")}
                        </span>
                      ) : (
                        <button
                          className={PILL_QUIET + " shrink-0 disabled:opacity-50"}
                          disabled={busy === s.slug}
                          onClick={() => add(s)}
                          data-testid={`install-${s.name}`}
                        >
                          {busy === s.slug ? t("skInstalling") : t("skInstall")}
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
                data-testid="skills-more"
              >
                {loadingMore ? t("skLoading") : t("skMore")}
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
          data-testid="skill-detail"
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
                {t("skClose")}
              </button>
            </div>
            <div className="text-[11.5px] text-faint mb-3">{t("skUntrusted")}</div>
            <pre className="text-[12px] leading-relaxed whitespace-pre-wrap break-words">
              {detail.body || t("skLoading")}
            </pre>
          </div>
        </div>
      )}
    </>
  );
}
