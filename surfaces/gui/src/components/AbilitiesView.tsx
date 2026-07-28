import { useEffect, useState } from "react";
import {
  getSkills,
  installSkill,
  searchSkills,
  uninstallSkill,
  type CatalogSkill,
  type InstalledSkill,
} from "../api";
import { PanelHead } from "./IntegrationsView";
import { useT } from "../i18n";

// 「能力」——分类里的另一半（另一半是「连接」）。
//
// 这一页回答两个问题：它现在会什么，以及还能会什么。
//
// 【关于搜索】：规格 D' 说发现发生在对话里——用户说要做什么，Marlo 自己去找。
// 那仍然是主路径，也仍然是我们优化的方向。但 owner 的判断是用户也要能自己看：
// 一个东西你完全看不见里面有什么，是很难信任它的。所以这里给搜索，而不是把它
// 藏起来。两条路指向同一个目录。
//
// 搜索框的 placeholder 写"搜技能目录"而不是"搜索"，空结果提示写"试试直接说你
// 要做的事，而不是工具的名字"——因为这个目录是按【用途】索引的，按工具名搜
// 经常是空的，而空结果不解释原因的话，人会以为目录里没东西。
export function AbilitiesView() {
  const t = useT();
  const [installed, setInstalled] = useState<InstalledSkill[] | null>(null);
  const [q, setQ] = useState("");
  const [results, setResults] = useState<CatalogSkill[] | null>(null);
  const [searchErr, setSearchErr] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [skillsDir, setSkillsDir] = useState("");

  const reload = () =>
    getSkills()
      .then((r) => {
        setInstalled(r.skills);
        setSkillsDir(r.dir || "");
      })
      .catch(() => setInstalled([]));

  useEffect(() => {
    reload();
    // 对话里装上的技能要能自己出现，不用重开页面。
    const i = setInterval(reload, 5000);
    return () => clearInterval(i);
  }, []);

  // 输入停下来再搜。每敲一个字就打一次目录，既慢又白费 —— 而这条路要出网。
  useEffect(() => {
    const term = q.trim();
    if (!term) {
      setResults(null);
      setSearchErr("");
      return;
    }
    const h = setTimeout(() => {
      searchSkills(term)
        .then((r) => {
          setResults(r.results || []);
          setSearchErr(r.error || "");
        })
        .catch((e) => setSearchErr(String(e?.message || e)));
    }, 400);
    return () => clearTimeout(h);
  }, [q]);

  const installedNames = new Set((installed || []).map((s) => s.name));

  const add = async (s: CatalogSkill) => {
    setBusy(s.slug);
    const r = await installSkill(s.slug).catch((e) => ({ ok: false, error: String(e) }));
    setBusy(null);
    if (r.ok) reload();
    else setSearchErr(r.error || "install failed");
  };

  const remove = async (name: string) => {
    setBusy(name);
    await uninstallSkill(name).catch(() => {});
    setBusy(null);
    reload();
  };

  return (
    <main className="flex-1 min-w-0 flex bg-paper">
      <div className="flex-1 min-w-0 overflow-y-auto hairline-scroll">
        <div className="max-w-4xl mx-auto px-7 py-6">
          <PanelHead title={t("abilities")} sub={t("abilitiesSub")} />

          <input
            className="w-full px-3.5 py-2 mb-5 rounded-full border border-line bg-panel text-[13px] outline-none focus:border-accent"
            placeholder={t("abilitiesSearch")}
            value={q}
            onChange={(e) => setQ(e.target.value)}
            data-testid="abilities-search"
          />

          {searchErr && (
            <div className="text-[12px] text-warnInk mb-4" data-testid="abilities-error">
              {t("abilitiesSearchFailed")} {searchErr}
            </div>
          )}

          {results !== null && (
            <section className="mb-6" data-testid="abilities-results">
              <div className="text-[12px] text-muted mb-2">{t("abilitiesFound")}</div>
              {results.length === 0 && !searchErr ? (
                <div className="text-[12.5px] text-muted">{t("abilitiesNoResults")}</div>
              ) : (
                <div className="rounded-xl border border-line overflow-hidden">
                  {results.map((s) => (
                    <div
                      key={s.slug}
                      className="flex items-start gap-3 px-4 py-3 border-b border-line last:border-b-0"
                      data-testid={`catalog-${s.name}`}
                    >
                      <span className="min-w-0 flex-1">
                        <span className="font-medium text-[13.5px]">{s.name}</span>
                        <span className="block text-[12px] text-muted mt-0.5">{s.summary}</span>
                        <span className="block text-[11.5px] text-faint mt-0.5">{s.meta}</span>
                        {s.needs && (
                          // 装之前就说清楚它要账号 —— 装完才发现连不上是最差的顺序。
                          <span className="block text-[11.5px] text-warnInk mt-0.5">
                            {t("abilitiesNeeds")} {s.needs}
                          </span>
                        )}
                      </span>
                      {installedNames.has(s.name) ? (
                        <span className="text-[11.5px] text-faint shrink-0 mt-0.5">
                          {t("abilitiesInstalled")}
                        </span>
                      ) : (
                        <button
                          className="shrink-0 px-3 py-1 rounded-full border border-line text-[12.5px] hover:bg-paper disabled:opacity-50"
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
              )}
            </section>
          )}

          <div className="text-[12px] text-muted mb-2">{t("abilitiesInstalled")}</div>
          {installed === null ? null : installed.length === 0 ? (
            <div
              className="rounded-xl border border-line bg-panel/50 p-5 text-[13px]"
              data-testid="abilities-empty"
            >
              <div className="font-medium">{t("abilitiesEmpty")}</div>
              <div className="text-muted mt-1.5 leading-relaxed">{t("abilitiesEmptyHow")}</div>
            </div>
          ) : (
            <div className="rounded-xl border border-line overflow-hidden" data-testid="abilities-list">
              {installed.map((s) => (
                <div
                  key={s.name}
                  className="flex items-start gap-3 px-4 py-3 border-b border-line last:border-b-0"
                  data-testid={`ability-${s.name}`}
                >
                  <span className="min-w-0 flex-1">
                    <span className="font-medium text-[13.5px]">{s.name}</span>
                    <span className="block text-[12px] text-muted mt-0.5">{s.description}</span>
                  </span>
                  <button
                    className="shrink-0 px-3 py-1 rounded-full text-[12.5px] text-faint hover:text-ink disabled:opacity-50"
                    disabled={busy === s.name}
                    onClick={() => remove(s.name)}
                    data-testid={`remove-${s.name}`}
                  >
                    {t("abilitiesRemove")}
                  </button>
                </div>
              ))}
            </div>
          )}

          {skillsDir && <div className="text-[11.5px] text-faint mt-3">{t("abilitiesWhere")(skillsDir)}</div>}
        </div>
      </div>
    </main>
  );
}
