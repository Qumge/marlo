import { useEffect, useState } from "react";
import { getSkills, type InstalledSkill } from "../api";
import { PanelHead } from "./IntegrationsView";
import { useT } from "../i18n";

// 「能力」——分类里的另一半。
//
// 用户看到的是两类：能力（技能）和连接（账号 + 工具服务器）。「连接」早就有页面，
// 「能力」一个界面都没有 —— 用户完全看不到 Marlo 会做什么、装了什么。
//
// 【它是管理台，不是发现入口】。规格 D' 定的：一般用户不去挑技能，他在对话里说
// 要做什么，Marlo 自己去 Qumge 的目录找。所以这一页不做"浏览 4,500 条技能"——
// 那会把产品变回一个应用商店，而且和实际的使用方式相反。这里回答的是另一个问题：
// 「它现在会什么？这些是哪来的？」
//
// 空状态因此要【解释机制】而不是给一个"去逛逛"的按钮：一个刚装好的用户看到
// "还没装任何能力"，第一反应是"那我去哪儿装"，而正确答案是"你不用装"。
export function AbilitiesView() {
  const t = useT();
  const [skills, setSkills] = useState<InstalledSkill[] | null>(null);

  useEffect(() => {
    const load = () => getSkills().then(setSkills).catch(() => setSkills([]));
    load();
    // 对话里装上的技能要能自己出现，不用重开页面。
    const i = setInterval(load, 5000);
    return () => clearInterval(i);
  }, []);

  return (
    <main className="flex-1 min-w-0 flex bg-paper">
      <div className="flex-1 min-w-0 overflow-y-auto hairline-scroll">
        <div className="max-w-4xl mx-auto px-7 py-6">
          <PanelHead title={t("abilities")} sub={t("abilitiesSub")} />

          {skills === null ? null : skills.length === 0 ? (
            <div
              className="rounded-xl border border-line bg-panel/50 p-5 text-[13px]"
              data-testid="abilities-empty"
            >
              <div className="font-medium">{t("abilitiesEmpty")}</div>
              <div className="text-muted mt-1.5 leading-relaxed">{t("abilitiesEmptyHow")}</div>
            </div>
          ) : (
            <div className="rounded-xl border border-line overflow-hidden" data-testid="abilities-list">
              {skills.map((s) => (
                <div
                  key={s.name}
                  className="flex items-start gap-3 px-4 py-3 border-b border-line last:border-b-0"
                  data-testid={`ability-${s.name}`}
                >
                  <span className="min-w-0 flex-1">
                    <span className="font-medium text-[13.5px]">{s.name}</span>
                    <span className="block text-[12px] text-muted mt-0.5">{s.description}</span>
                  </span>
                </div>
              ))}
            </div>
          )}

          <div className="text-[11.5px] text-faint mt-3">{t("abilitiesWhere")}</div>
        </div>
      </div>
    </main>
  );
}
