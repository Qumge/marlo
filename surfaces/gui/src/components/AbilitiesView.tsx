import { useEffect, useState } from "react";
import { deleteSkill, listSkills, type SkillRow } from "../api";
import { PanelHead } from "./IntegrationsView";
import { useT } from "../i18n";
import { GRP, GRP_H, ROW } from "./connectors/ui";
import { SkillCatalog } from "./skills/SkillCatalog";

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
  const [installed, setInstalled] = useState<SkillRow[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [removeErr, setRemoveErr] = useState("");

  const reload = () =>
    listSkills()
      .then(setInstalled)
      .catch(() => setInstalled([]));

  useEffect(() => {
    reload();
    // 对话里装上的技能要能自己出现，不用重开页面。
    const i = setInterval(reload, 5000);
    return () => clearInterval(i);
  }, []);

  const remove = async (name: string) => {
    setBusy(name);
    // DELETE /v1/skills/{name} —— 上游唯一的卸载路径。以前这里打的是
    // POST /v1/skills/uninstall，后端根本没有那个路由（app.py:632）。
    const r = await deleteSkill(name).catch((e) => ({ ok: false, error: String(e) }));
    setBusy(null);
    if (!r.ok) setRemoveErr(r.error || "remove failed");
    reload();
  };

  return (
    <main className="flex-1 min-w-0 flex bg-paper">
      <div className="flex-1 min-w-0 overflow-y-auto hairline-scroll">
        <div className="max-w-4xl mx-auto px-7 py-6">
          <PanelHead title={t("abilities")} sub={t("abilitiesSub")} />

          {removeErr && (
            <div className="text-[12px] text-warnInk mb-4" data-testid="abilities-error">
              {removeErr}
            </div>
          )}

          {/* 已装的在最上面 —— 和「连接」页的 Connected 一样。用户先关心
              "我现在有什么"，再看"还能有什么"。 */}
          {installed !== null && installed.length > 0 && (
            <>
              <div className={GRP_H + " !mt-0"}>
                {t("abilitiesInstalled")} · {installed.length}
              </div>
              <div className={GRP} data-testid="abilities-list">
                {installed.map((s) => (
                  <div key={s.name} className={ROW} data-testid={`ability-${s.name}`}>
                    <span className="min-w-0 flex-1">
                      <span className="font-medium text-[13.5px]">{s.name}</span>
                      <span className="block text-[12px] text-muted">{s.description}</span>
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
            </>
          )}

          {installed !== null && installed.length === 0 && (
            <div
              className="rounded-xl border border-line bg-panel/50 p-5 text-[13px] mb-2"
              data-testid="abilities-empty"
            >
              <div className="font-medium">{t("abilitiesEmpty")}</div>
              <div className="text-muted mt-1.5 leading-relaxed">{t("abilitiesEmptyHow")}</div>
            </div>
          )}

          <SkillCatalog
            installedNames={new Set((installed || []).map((s) => s.name))}
            onInstalled={reload}
          />
        </div>
      </div>
    </main>
  );
}
