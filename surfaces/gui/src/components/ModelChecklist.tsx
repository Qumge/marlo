import { useEffect, useState } from "react";
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
// other row reveals "Make default". A free-type row below adds models by hand, so brand-new
// releases work without an app update. Shared by Onboarding and Manage → Configure Models.
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
  const [browsing, setBrowsing] = useState(false);
  const [gq, setGq] = useState("");
  const [gModels, setGModels] = useState<GatewayModel[]>([]);

  // 打开时取一次，输入时防抖再取。关着的时候不发请求 —— 这条要出网。
  useEffect(() => {
    if (!browsing) return;
    const h = setTimeout(() => {
      gatewayModels(gq.trim()).then((r) => setGModels(r.models || [])).catch(() => setGModels([]));
    }, gq.trim() ? 400 : 0);
    return () => clearTimeout(h);
  }, [browsing, gq]);

  // 上游 0.1.7 加的 family 下拉：Bedrock/Vertex 的同一个 provider 下挂着不同
  // 模型家族（Anthropic / Nova / Nemotron…），加模型时要先选家族。和上面那个
  // 网关浏览器互不相干 —— 两边都留。
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

  return (
    <div className="mlist">
      {rows.map((id) => {
        const isDefault = id === defaultModel;
        return (
          <div className={"mlist-row" + (checked(id) ? "" : " off")} key={id}>
            <label className="mlist-main">
              <input
                type="checkbox"
                checked={checked(id)}
                disabled={isDefault}
                title={isDefault ? t("mtDefaultAlwaysShown") : undefined}
                onChange={(e) => tick(id, e.target.checked)}
              />
              <span className="mlist-name" title={id}>
                {labels?.[id] || bare(id)}
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
      })}
      {/* Qumge 是【网关】：一个 key 后面有 244 个能跑 agent 的模型，而这份清单
          里只有 4 个精选的。在这之前想用别的，用户得手打完整 id
          （qumge:google/gemini-2.5-pro）——一个中小商家老板不知道有哪些模型，
          也不知道 id 长什么样，等于没有这条路。
          只对 qumge 显示：别的 provider 我们问不到它的模型清单。 */}
      {provider === "qumge" && (
        <div className="mt-3">
          <button
            className="text-[12.5px] text-accent hover:underline"
            onClick={() => setBrowsing((v) => !v)}
            data-testid="gateway-browse"
          >
            {t("gatewayBrowse")}
          </button>
          {browsing && (
            <div className="mt-2 rounded-xl border border-line p-3">
              <div className="text-[11.5px] text-faint mb-2">{t("gatewayHint")}</div>
              <input
                className="w-full px-3 py-1.5 mb-2 rounded-full border border-line bg-panel text-[13px] outline-none focus:border-accent"
                placeholder={t("gatewaySearch")}
                value={gq}
                onChange={(e) => setGq(e.target.value)}
                data-testid="gateway-search"
              />
              <div className="max-h-64 overflow-y-auto">
                {gModels.map((m) => (
                  <div key={m.id} className="flex items-center gap-2 py-1.5" data-testid={`gw-${m.id}`}>
                    <span className="min-w-0 flex-1 text-[12.5px] truncate">{m.label}</span>
                    {curated.includes(m.id) ? (
                      <span className="text-[11.5px] text-faint shrink-0">{t("gatewayAdded")}</span>
                    ) : (
                      <button
                        className="shrink-0 text-[12px] text-accent hover:underline"
                        onClick={async () => {
                          await addModel(m.id);
                          await refresh();
                        }}
                        data-testid={`gw-add-${m.id}`}
                      >
                        {t("gatewayAdd")}
                      </button>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

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
