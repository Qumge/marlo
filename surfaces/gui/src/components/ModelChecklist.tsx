import { useEffect, useMemo, useState } from "react";
import {
  addModel,
  gatewayModels,
  getSettings,
  removeModel,
  setDefaultModel,
  type GatewayModel,
} from "../api";
import { useT } from "../i18n";
import type { Strings } from "../i18n/en";

// Cloud-account providers dispatch by a family segment baked into the model id
// (`bedrock:claude/…`, `vertex:openweight/…`). The add-model row shows a dropdown so
// users pick the family instead of memorizing the prefix; curated matrix ids already
// carry theirs.
// label 存的是 i18n 【键】不是英文：常量因此保持纯数据，不需要在模块作用域调 hook，
// 渲染时才 t(key)。这是这个代码库里数据数组的既有写法（见 check_i18n.py 的 ALLOWED）。
const MODEL_FAMILIES: Record<string, { value: string; label: keyof Strings }[]> = {
  bedrock: [
    { value: "claude", label: "mcClaudeFamily" },
    { value: "other", label: "mcOtherModels" },
  ],
  vertex: [
    { value: "gemini", label: "mcGeminiFamily" },
    { value: "claude", label: "mcClaudeFamily" },
    { value: "openweight", label: "mcOpenWeight" },
  ],
};

// One provider's models as a checklist: tick = shown in the composer's model picker (the
// curated list), the black "default" badge marks the model new sessions use, and hovering any
// other row reveals "Make default". Shared by Onboarding and Manage → Configure Models.
//
// 【qumge 是一个列表，别的 provider 是另一种形状】
// 这一屏原来有两份列表在讲同一件事：上面是 matrix.py 硬编码的四条精选（勾选框），
// 下面是折叠面板里网关实时的六十条超集（「加入」链接）。同一个模型在两处长得不一样、
// 用两套控件、语义还不对称 —— 勾选可以撤销，「已加入」不能，要撤得滚回上面那份去找。
// 而且价格只在【还没选】的那一半可见：选进来之后就看不到自己在花多少钱，恰恰是事后
// 想复查时唯一想看的数字。两份之间也没有任何东西在对账，结果就是硬编码那份漂掉了
// （claude-opus-4-6 在网关上根本不存在，而它默认勾着）。
//
// 现在是一个列表、一种控件：已选的排在上面，其余的排在下面，勾和撤是同一个动作的
// 正反面。别的 provider 我们问不到模型清单，保持原样（静态勾选清单 + 手打行）。
export function ModelChecklist({
  provider,
  knownProviders,
  suggested,
  curated,
  defaultModel,
  labels,
  onChanged,
}: {
  provider: string; // decides the id prefix; OpenAI models stay bare
  knownProviders: string[]; // all provider names, to parse prefixes in curated ids
  suggested: string[]; // bare model names suggested by the provider
  curated: string[]; // the full curated list (all providers, full ids)
  defaultModel: string;
  labels?: Record<string, string>; // curated display names (full id → label); raw id when absent
  onChanged: (next: { models: string[]; model: string }) => void;
}) {
  const t = useT();
  const [draft, setDraft] = useState("");
  const [gq, setGq] = useState("");
  const [gModels, setGModels] = useState<GatewayModel[]>([]);
  const [gErr, setGErr] = useState(false);
  // 网关上一共有多少个能当 agent 用的模型 —— 【由目录给】，界面数不出来：
  // list_models 一次最多给 60。目录给不出就是 null，文案退回不报总数的那版。
  const [gTotal, setGTotal] = useState<number | null>(null);

  // qumge 是唯一一个我们能把模型清单【问出来】的 provider —— 也就只有它能把
  // 「已选」和「可选」合成一个列表。
  const isGateway = provider === "qumge";

  // 【一次取全量，在本地筛】网关上是六十来条，一次拿回来毫无压力。按 gq 去服务端
  // 筛的话有两个代价：每敲一次字要出网；而且【已选】那一段的价格也是从这份清单里
  // 来的，筛掉之后那几行的价格会跟着闪没。
  useEffect(() => {
    if (!isGateway) return;
    gatewayModels("")
      .then((r) => {
        setGModels(r.models || []);
        setGTotal(r.total ?? null);
        setGErr(!!r.error);
      })
      .catch(() => {
        setGModels([]);
        setGErr(true);
      });
  }, [isGateway]);

  // 上游 0.1.7 加的 family 下拉：Bedrock/Vertex 的同一个 provider 下挂着不同
  // 模型家族（Anthropic / Nova / Nemotron…），加模型时要先选家族。
  const families = MODEL_FAMILIES[provider];
  const [family, setFamily] = useState(families?.[0]?.value || "");

  const provOf = (id: string) => {
    const i = id.indexOf(":");
    return i > 0 && knownProviders.includes(id.slice(0, i)) ? id.slice(0, i) : "openai";
  };
  const prefixed = (m: string) => (provider === "openai" || provOf(m) !== "openai" ? m : `${provider}:${m}`);
  const bare = (id: string) => (id.startsWith(`${provider}:`) ? id.slice(provider.length + 1) : id);

  const rows = [
    ...suggested.map(prefixed),
    ...curated.filter((id) => provOf(id) === provider),
  ].filter((id, i, a) => a.indexOf(id) === i);

  const checked = (id: string) => curated.includes(id);
  const refresh = async () => {
    const s = await getSettings();
    onChanged({ models: s.models, model: s.model });
  };

  const tick = async (id: string, on: boolean) => {
    const res = on ? await addModel(id) : await removeModel(id);
    if (res.ok) onChanged({ models: res.models, model: res.model });
  };
  const makeDefault = async (id: string) => {
    if (!checked(id)) await addModel(id); // defaulting an unticked row ticks it too
    await setDefaultModel(id);
    await refresh();
  };
  const add = async () => {
    let typed = draft.trim();
    if (!typed) return;
    // Fold the family choice into the id unless the user already typed one.
    if (families && !families.some((f) => typed.startsWith(`${f.value}/`))) {
      typed = `${family}/${typed}`;
    }
    const res = await addModel(prefixed(typed));
    if (res.ok) {
      setDraft("");
      onChanged({ models: res.models, model: res.model });
    }
  };

  const gwById = useMemo(() => new Map(gModels.map((m) => [m.id, m])), [gModels]);

  const nameOf = (id: string) => gwById.get(id)?.name || labels?.[id] || bare(id);
  const metaOf = (id: string) => {
    const g = gwById.get(id);
    if (!g) return "";
    return [g.vendor, g.price, g.vision ? t("gatewayVision") : ""].filter(Boolean).join(" · ");
  };
  const matches = (id: string) => {
    const q = gq.trim().toLowerCase();
    if (!q) return true;
    return `${nameOf(id)} ${metaOf(id)} ${id}`.toLowerCase().includes(q);
  };

  // 【已选来自本地设置，可选来自网关】合成一个列表，但两个来源的可用性不一样：
  // 网关连不上时，用户仍然要能取消勾选、换默认，所以已选那一段绝不能依赖网络。
  const selected = rows.filter(checked);
  const others = isGateway
    ? [
        ...rows.filter((id) => !checked(id)),
        ...gModels.map((m) => m.id).filter((id) => !rows.includes(id)),
      ]
    : [];

  // 勾选时【不】立即重排：行留在原地，等下次进入或筛选变化时才归位。点一下就把
  // 脚下的地抽走，是这类列表最容易犯的错。
  const row = (id: string) => {
    const isDefault = id === defaultModel;
    const meta = metaOf(id);
    return (
      <div className={"mlist-row" + (checked(id) ? "" : " off")} key={id} data-testid={`mrow-${id}`}>
        <label className="mlist-main">
          <input
            type="checkbox"
            checked={checked(id)}
            disabled={isDefault}
            title={isDefault ? t("mtDefaultAlwaysShown") : undefined}
            onChange={(e) => tick(id, e.target.checked)}
            data-testid={`mcheck-${id}`}
          />
          <span className="mlist-text">
            <span className="mlist-name" title={id}>
              {nameOf(id)}
            </span>
            {meta && <span className="mlist-meta">{meta}</span>}
          </span>
        </label>
        {isDefault ? (
          <span className="mlist-default">default</span>
        ) : (
          <button className="mlist-make" onClick={() => makeDefault(id)}>
            {t("mtMakeDefault")}
          </button>
        )}
      </div>
    );
  };

  if (!isGateway) {
    return (
      <div className="mlist">
        {rows.map(row)}
        <div className="mlist-add">
          {families && (
            <select
              value={family}
              onChange={(e) => setFamily(e.target.value)}
              aria-label={t("mcModelFamily")}
              data-testid="mlist-family"
            >
              {families.map((f) => (
                <option key={f.value} value={f.value}>
                  {t(f.label) as string}
                </option>
              ))}
            </select>
          )}
          {/* 别的 provider 我们问不到模型清单，手打是唯一的路 —— 也是新模型发布
              当天不用等我们发版的那条路。qumge 不需要它：整份清单就在下面。 */}
          <input
            placeholder={t("uiAddAnotherModel")}
            value={draft}
            spellCheck={false}
            autoComplete="off"
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && add()}
          />
          <button className="btn-primary sm" onClick={add} disabled={!draft.trim()}>
            {t("uiAdd")}
          </button>
        </div>
      </div>
    );
  }

  const filtering = !!gq.trim();
  const shownSelected = selected.filter(matches);
  const shownOthers = others.filter(matches);

  return (
    <div className="mlist">
      <input
        className="mlist-filter"
        placeholder={t("gatewaySearch")}
        value={gq}
        spellCheck={false}
        autoComplete="off"
        onChange={(e) => setGq(e.target.value)}
        data-testid="gateway-search"
      />

      {/* 【筛选时空段整段不渲染】否则会留下一个"已加进选择器 · 1"底下一条都没有的
          孤儿标题 —— 那个 1 说的是总数，读起来却像"这里应该有一条但它不见了"。
          而没筛选时【要】显示 0：那时它说的是"你的选择器是空的"，是有用的信息。 */}
      {(!filtering || shownSelected.length > 0) && (
        <>
          <div className="mlist-sec" data-testid="mlist-selected">
            {t("gatewaySelected")(filtering ? shownSelected.length : selected.length)}
          </div>
          {shownSelected.map(row)}
        </>
      )}

      {/* 离线提示【不能】挂在"其余"那一段里：网关挂了那段就是空的，一旦用户还在
          筛选，整段被隐藏，最该看到的那句话就跟着没了。 */}
      {gErr && <div className="mlist-note" data-testid="gateway-offline">{t("gatewayOffline")}</div>}

      {(!filtering || shownOthers.length > 0) && (
        <>
          <div className="mlist-sec" data-testid="mlist-others">
            {t("gatewayOthers")(filtering ? shownOthers.length : others.length)}
          </div>
          <div className="mlist-others">{shownOthers.map(row)}</div>
          {/* 【「这只是一部分」在这里说，不在标题里说】标题的职责是"渲染了多少就
              说多少"。原来它写「Qumge 上还有 56 个」，而 56 是已加载的 60 条减去
              已勾的 —— list_models 一次最多给 60，网关上远不止，那句话是假的。

              【只在没筛选时出现】筛选后用户看到的是搜索结果，再说"这是最常用的
              一批"就又错了一次。网关连不上时也不说 —— 那时该看的是 gErr 那句。 */}
          {!filtering && !gErr && (
            <div className="mlist-note" data-testid="gateway-partial">
              {gTotal ? t("gatewayPartialOf")(gTotal) : t("gatewayPartial")}
            </div>
          )}
        </>
      )}

      {filtering && !shownSelected.length && !shownOthers.length && (
        <div className="mlist-note" data-testid="gateway-nomatch">{t("gatewayNoMatch")}</div>
      )}
    </div>
  );
}
