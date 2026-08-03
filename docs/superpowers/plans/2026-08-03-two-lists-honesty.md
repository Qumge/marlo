# 两份列表不再骗人 —— 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 技能页进去不再是四秒半的空白，模型页不再报一个假的总数、搜索能真的够到那 60 条之外的模型。

**Architecture:** 三层各改一点，互不依赖。Python 侧 `models()` 从返回裸 list 改成 `{"models": [...], "total": int | None}`，total 来自新表头 `Showing N of M`（解析不到就 `None`）。前端 `SkillCatalog` 补一个 `results === null` 时的骨架；`ModelChecklist` 把「这是一部分」的话从段标题挪进底下的 note，并在本地筛不到时防抖 400ms 去网关搜一次、结果并进同一份缓存。

**Tech Stack:** React 18 + TypeScript + Vitest + Testing Library（`surfaces/gui`）；FastAPI + pytest（`coworker`）；httpx 打 qumge 的 MCP。

**规格：** `docs/superpowers/specs/2026-08-03-two-lists-honesty-design.md`

## Global Constraints

- **i18n：`en.ts` 是唯一真源。** 每加一条 key 必须同时加进 `zh.ts`，漏了会在 `npm run build` 时炸（`zh.ts` 的类型是 `typeof en`）。
- **中文文案里不能出现英文虚词。** `src/i18n/no-english.ts` 扫渲染结果，判据是 `the|and|your|with|from|…` 那张表。专名（Qumge、Marlo、模型 id）可以，因为整句含中文就跳过。
- **测试命令：** 前端 `cd surfaces/gui && npx vitest run <file>`；Python `.venv/bin/python -m pytest <file> -v`。
- **本机 pytest 基准是 5 failed，不是 0。** 那 5 条是预存失败，与本计划无关，不要去查。只看你改的那个文件。
- **不做 agent 能力过滤。** qumge 的 `list_models` 已经保证「Only tool-calling models are listed」。
- **不做技能页目录缓存。** owner 砍过。
- **`limit` 上限是 60。** qumge 的 schema 原话 `"Default 20, max 60."`，超出的值被服务端悄悄夹住。

---

### Task 1: Python 侧 —— `models()` 带上总数

**Files:**
- Modify: `coworker/skills/qumge_catalog.py:185-231`（`models()`）
- Modify: `coworker/server/app.py:649-659`（`gateway_models`）
- Test: `tests/test_qumge_catalog.py:100-172`

**Interfaces:**
- Produces: `qumge_catalog.models(query="", *, limit=30, client=None) -> {"models": list[dict], "total": int | None}`。`models` 里每条仍是 `{id, name, vendor, price, vision, label}`，字段一个不动。`total` 是**网关上能当 agent 用的模型总数**，表头没给就是 `None`。
- Consumes（Task 2 用）：`GET /v1/gateway/models` 现在返回 `{"models": [...], "total": int | None}`，出错时 `{"models": [], "error": "..."}`（`total` 缺席）。

- [ ] **Step 1: 写失败的测试**

加到 `tests/test_qumge_catalog.py`，紧跟在 `test_models_survives_a_catalog_that_says_nothing` 后面：

```python
# qumge 表头改造后的形状。M【只数能当 agent 用的】—— 网关上还有视频、图片模型，
# 把它们算进去，界面就会显示一个用户永远搜不到的总数。
MODELS_TEXT_WITH_TOTAL = """Showing 4 of 312 model(s) on the Qumge gateway, most used first.
Use the full id (the `qumge:` line) as the model.

  qumge:anthropic/claude-opus-5
    Claude Opus 5 · $5.00/$25.00 per Mtok · vision
"""


def test_models_reports_the_gateway_total_not_the_page_size():
    """界面上那句「Qumge 上还有 56 个」的 56 本来是【这次返回了几条】。

    limit 上限是 60，而网关上远不止 —— 总数只能由目录自己给。
    """
    r = q.models(client=_Fake(MODELS_TEXT_WITH_TOTAL))
    assert r["total"] == 312
    assert len(r["models"]) == 1


def test_models_total_is_none_when_the_catalog_does_not_say():
    """【回退】qumge 还没上线新表头时，宁可不报总数，也不报一个假的。

    老表头那个数是"这次返回了几条"，措辞却是"网关上有几个"—— 拿它当总数，
    等于把一个谎换成另一个谎。
    """
    r = q.models(client=_Fake(MODELS_TEXT))
    assert r["total"] is None
    assert len(r["models"]) == 4
```

- [ ] **Step 2: 跑，确认它失败**

Run: `.venv/bin/python -m pytest tests/test_qumge_catalog.py -v -k total`
Expected: FAIL —— `TypeError: list indices must be str` 之类（`models()` 现在返回 list）。

- [ ] **Step 3: 改 `models()`**

在 `coworker/skills/qumge_catalog.py` 里，`_TRANSLATED` 那条正则下面加：

```python
# 表头的总数：`Showing 60 of 312 model(s) on the Qumge gateway, most used first.`
#
# 【为什么不能用老表头那个数】老表头是 `60 model(s) on the Qumge gateway`，而那个
# 60 就是【这次返回了几条】—— 问它要 5 条，它就说网关上有 5 个模型。limit 的上限
# 是 60，网关上远不止，所以总数只能由目录自己给。给不出就是 None，界面退回不报
# 总数的文案：不报，好过报一个假的。
_TOTAL = re.compile(r"^\s*Showing\s+\d+\s+of\s+(\d+)\b")
```

把 `models()` 的签名和 docstring 改成：

```python
def models(
    query: str = "",
    *,
    limit: int = 30,
    client: Optional[httpx.Client] = None,
) -> dict[str, Any]:
    """返回 {"models": [...], "total": int | None}。

    每条模型是 {id, name, vendor, price, vision, label}：id 可以直接用，其余几个是
    把 label 那一整串拆开的结果。

    【为什么拆】界面要把它们排成不同的列：名字是主角，厂商和价格是次要信息。
    糊成一个字符串的话，每个调用方都得自己再拆一遍,而拆法散在各处必然会漂。
    label 原样留着当兜底。

    【total 是网关上的总数，不是这次返回了几条】limit 上限是 60，而网关上远不止
    ——「还有多少个」这件事界面自己数不出来，只能由目录给。
    """
```

函数体最后那行 `return out` 改成：

```python
    m = _TOTAL.match(text)
    return {"models": out, "total": int(m.group(1)) if m else None}
```

- [ ] **Step 4: 改 4 个既有测试点**

`tests/test_qumge_catalog.py` 里这四处取 list 的地方，改成取 `["models"]`：

```python
# 123 行
r = q.models(client=_Fake(MODELS_TEXT))["models"]
# 135 行
r = {m["id"]: m for m in q.models(client=_Fake(MODELS_TEXT))["models"]}
# 164 行
r = q.models(client=_Fake(
    "1 model\n\n  qumge:openai/gpt-5-turbo\n    GPT-5: Turbo · $1.00/$2.00 per Mtok\n"
))["models"]
# 172 行
assert q.models(client=_Fake("No models match 'zzz'."))["models"] == []
```

- [ ] **Step 5: 改 `app.py`**

`coworker/server/app.py:657` 那行：

```python
            return qumge_catalog.models(q, limit=limit)
```

`models()` 现在返回的就是 `{"models": ..., "total": ...}`，不用再包一层。出错分支（659 行）保持 `{"models": [], "error": str(exc)}` 不动 —— 那时候没有总数可报。

- [ ] **Step 6: 跑，确认全绿**

Run: `.venv/bin/python -m pytest tests/test_qumge_catalog.py -v`
Expected: PASS（这个文件里全部）。

Run: `.venv/bin/python -m pytest tests/ -q 2>&1 | tail -3`
Expected: 5 failed —— 就是那 5 条预存失败，不多不少。多出来的才是你弄坏的。

- [ ] **Step 7: 提交**

```bash
git add coworker/skills/qumge_catalog.py coworker/server/app.py tests/test_qumge_catalog.py
git commit -m "feat: 网关模型的总数由目录给，给不出就不报

界面上那句「Qumge 上还有 56 个」的 56 是【这次返回了几条】—— list_models 的 limit
上限就是 60（我们传 200 被服务端夹住），而它的表头写着「N model(s) on the Qumge
gateway」。问它要 5 条，它就说网关上有 5 个模型。

models() 改成返回 {models, total}，total 从新表头 Showing N of M 解析。qumge 还没
上线新表头时是 None，界面退回不报总数的文案 —— 不报好过报一个假的。"
```

---

### Task 2: 前端 API —— 传合法的 limit，接住 total

**Files:**
- Modify: `surfaces/gui/src/api.ts:670-678`

**Interfaces:**
- Consumes: Task 1 的 `GET /v1/gateway/models` 返回 `{models, total?}`。
- Produces: `gatewayModels(q = "", limit = 60) -> Promise<{ models: GatewayModel[]; total?: number | null; error?: string }>`。Task 5、6、7 都用这个签名。

- [ ] **Step 1: 改签名和默认值**

`surfaces/gui/src/api.ts:670` 起，整个函数替换成：

```ts
export async function gatewayModels(
  q = "",
  // 【60 不是随便选的】qumge 的 list_models schema 原话："Default 20, max 60."
  // 原来这里写 200，靠服务端悄悄夹到 60 —— 哪天它改成报错就断了。
  limit = 60,
): Promise<{ models: GatewayModel[]; total?: number | null; error?: string }> {
  const res = await fetch(
    `${httpBase()}/v1/gateway/models?q=${encodeURIComponent(q)}&limit=${limit}`,
  );
  return res.json();
}
```

- [ ] **Step 2: 确认没编译错**

Run: `cd surfaces/gui && npx tsc --noEmit`
Expected: 无报错（`total` 是可选字段，现有调用方不受影响）。

- [ ] **Step 3: 提交**

```bash
git add surfaces/gui/src/api.ts
git commit -m "fix: 网关模型的 limit 传 60，别靠服务端夹

qumge 的 list_models schema 写着 max 60，我们传的是 200。现在靠它悄悄夹住，
哪天改成报错就断了。顺带接住新的 total 字段。"
```

---

### Task 3: 五条文案

**Files:**
- Modify: `surfaces/gui/src/i18n/en.ts`（`skLoading` 附近 + `gatewayOthers` 附近）
- Modify: `surfaces/gui/src/i18n/zh.ts`（同样两处）

**Interfaces:**
- Produces: `skLoadingCatalog: string`、`gatewaySearching: string`、`gatewayPartial: string`、`gatewayPartialOf: (total: number) => string`；`gatewayOthers` 的文案变了，签名不变（`(n: number) => string`）。Task 4、5、6 用这些 key。

- [ ] **Step 1: `en.ts` 加技能页那条**

找到 `skLoading: "Loading…",`（78 行附近），在它下面加：

```ts
  // 【不复用 skLoading】用户的原话是「以为什么也没有」—— 这句话必须点名在等的是
  // 【目录】。光说「加载中」仍然没回答「里面到底有没有东西」。
  skLoadingCatalog: "Loading the skill catalog…",
```

- [ ] **Step 2: `en.ts` 改模型页那几条**

`gatewayOthers`（763 行）那一行替换成，并在 `gatewayNoMatch` 下面补三条：

```ts
  // 段标题只说【渲染了多少】。原来写的是「N more on Qumge」，而那个 N 是"已加载的
  // 60 条减去已勾的"—— list_models 一次最多给 60，网关上远不止，那句话是假的。
  gatewayOthers: (n: number) => `Other models on Qumge · ${n}`,
```

```ts
  // 「这只是一部分」从段标题挪到这里。拿得到总数就报真数字，拿不到就只说是一批
  // —— 总数只有目录知道，界面自己数不出来。
  gatewayPartial:
    "This is the most-used batch. There are more on the gateway — search by name or vendor to find them.",
  gatewayPartialOf: (total: number) =>
    `${total} models on the gateway; this is the most-used batch — search by name or vendor to reach the rest.`,
  // 出网搜的时候要说话。没有它就是技能页那个病的翻版：空白加一句「没有匹配的
  // 模型」，而其实正在搜。
  gatewaySearching: "Searching Qumge…",
```

- [ ] **Step 3: `zh.ts` 补齐同样五条**

`skLoading: "加载中…",` 下面：

```ts
  skLoadingCatalog: "正在读取技能目录…",
```

`gatewayOthers`（713 行）替换，并在 `gatewayNoMatch` 下面补三条：

```ts
  gatewayOthers: (n) => `Qumge 上的其他模型 · ${n}`,
```

```ts
  gatewayPartial: "这是最常用的一批。网关上还有更多 —— 搜名字或厂商就能找到。",
  gatewayPartialOf: (total) =>
    `网关上共 ${total} 个，这里是最常用的一批 —— 搜名字或厂商能找到其余的。`,
  gatewaySearching: "正在 Qumge 上找…",
```

- [ ] **Step 4: 确认类型对齐**

Run: `cd surfaces/gui && npx tsc --noEmit`
Expected: 无报错。漏一条 zh 就会在这里炸 —— 这是 i18n 唯一的守卫。

- [ ] **Step 5: 跑 i18n 测试**

Run: `cd surfaces/gui && npx vitest run src/i18n/i18n.test.tsx`
Expected: PASS。

- [ ] **Step 6: 提交**

```bash
git add surfaces/gui/src/i18n/en.ts surfaces/gui/src/i18n/zh.ts
git commit -m "i18n: 技能目录加载中、网关只是一批"
```

---

### Task 4: 技能页 —— 首屏骨架

**Files:**
- Modify: `surfaces/gui/src/components/skills/SkillCatalog.tsx:196`（`searchedAs` 那块之前插入）
- Test: `surfaces/gui/src/components/skills/SkillCatalog.test.tsx`

**Interfaces:**
- Consumes: Task 3 的 `skLoadingCatalog`；`GRP` / `ROW` 已经从 `../connectors/ui` 导入（9 行）。
- Produces: `data-testid="skills-catalog-loading"` 这个节点。

- [ ] **Step 1: 写失败的测试**

加到 `surfaces/gui/src/components/skills/SkillCatalog.test.tsx` 的 `describe("技能目录", …)` 里：

```typescript
  it("首屏在等目录回来时是骨架，不是空白", async () => {
    // 挂载那次 run("") 要出网，实测 4.5 秒（超时上限 20 秒）。那段时间里
    // results 还是 null，而整个目录区包在 results !== null 里 —— 一个像素都不
    // 渲染。用户看到的就是"什么也没有"。
    let release: (v: any) => void = () => {};
    vi.stubGlobal(
      "fetch",
      vi.fn(
        () =>
          new Promise((resolve) => {
            release = () =>
              resolve({ json: async () => ({ results: [{ name: "autowhisper", summary: "内容创作", slug: "x/y/aw", meta: "vetted by qumge" }] }) });
          }),
      ),
    );

    render(<SkillCatalog installedNames={new Set()} onInstalled={() => {}} onError={() => {}} />);

    expect(await screen.findByTestId("skills-catalog-loading")).toBeTruthy();
    expect(screen.queryByTestId("skills-results")).toBeNull();

    release(null);

    expect(await screen.findByTestId("skills-results")).toBeTruthy();
    // 出了结果骨架必须走 —— 两个一起在，读起来像"还有一批没加载完"。
    expect(screen.queryByTestId("skills-catalog-loading")).toBeNull();
  });

  it("目录连不上时骨架不残留，只剩错误条", async () => {
    // catch 分支（SkillCatalog.tsx:81-83）只写 searchErr，results 永远停在
    // null。骨架只看 null 的话，会在错误条底下一直转。
    vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("connection refused"); }));

    render(<SkillCatalog installedNames={new Set()} onInstalled={() => {}} onError={() => {}} />);

    expect(await screen.findByTestId("skills-error")).toBeTruthy();
    expect(screen.queryByTestId("skills-catalog-loading")).toBeNull();
  });
```

- [ ] **Step 2: 跑，确认它失败**

Run: `cd surfaces/gui && npx vitest run src/components/skills/SkillCatalog.test.tsx -t 骨架`
Expected: FAIL —— 找不到 `skills-catalog-loading`。

- [ ] **Step 3: 加骨架**

`SkillCatalog.tsx` 里，`</form>` 之后、`{searchedAs && …}` 之前插入：

```tsx
      {/* 【首屏骨架】上面那个 run("") 要出网，实测 4.5 秒（TIMEOUT 是 20 秒）。
          results 初始是 null，而目录区整个包在 results !== null 里 —— 那四秒半
          一个像素都不渲染，用户看到的就是"什么也没有"，正是这一页最怕的误会。

          【只管 null】results 只在首次挂载到第一次响应回来之间是 null。之后的
          搜索和重置都保留旧结果 —— 把用户已经看得见的列表换成灰条是倒退，那时候
          「在忙」由搜索按钮变灰表示就够了。

          【!searchErr】catch 分支只写 searchErr，results 会永远停在 null。少了
          这个条件，请求失败时骨架会在错误条底下一直转。

          形状和真结果一致（同一个 GRP / ROW），出结果时不会整块跳版。 */}
      {results === null && !searchErr && (
        <div data-testid="skills-catalog-loading" aria-busy="true">
          <div className="text-[12.5px] text-muted mb-2">{t("skLoadingCatalog")}</div>
          <div className={GRP}>
            {[0, 1, 2, 3, 4].map((i) => (
              <div key={i} className={ROW + " animate-pulse"}>
                <span className="min-w-0 flex-1">
                  <span className="block h-3.5 w-40 max-w-full rounded bg-line" />
                  <span className="block h-3 w-64 max-w-full rounded bg-line/60 mt-1.5" />
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
```

- [ ] **Step 4: 跑，确认通过**

Run: `cd surfaces/gui && npx vitest run src/components/skills/SkillCatalog.test.tsx`
Expected: PASS（整个文件，既有的也不能坏）。

- [ ] **Step 5: 提交**

```bash
git add surfaces/gui/src/components/skills/SkillCatalog.tsx surfaces/gui/src/components/skills/SkillCatalog.test.tsx
git commit -m "fix: 技能页进去先空白四秒半

挂载那次 run(\"\") 要出网（实测 4.5 秒，超时上限 20 秒），而 results 是 null 时
整个目录区不渲染 —— 用户看到的就是"什么也没有"，正是这一页最怕的误会。唯一的
迹象是搜索按钮变灰，没人会盯着那个看。

顺带一个更长的空白：catch 分支只写 searchErr，results 永远停在 null，那块地方
再也不会有东西。骨架的条件因此是 results === null && !searchErr。"
```

---

### Task 5: 模型页 —— 段标题不再报总数

**Files:**
- Modify: `surfaces/gui/src/components/ModelChecklist.tsx:65`（加 `gTotal` state）、`75-86`（初次加载）、`261-268`（其余段）
- Test: `surfaces/gui/src/components/ModelChecklist.test.tsx`

**Interfaces:**
- Consumes: Task 2 的 `gatewayModels(...)` 返回带 `total`；Task 3 的 `gatewayOthers` / `gatewayPartial` / `gatewayPartialOf`。
- Produces: `data-testid="gateway-partial"` 节点；state `gTotal: number | null`（Task 6 不改它）。

- [ ] **Step 1: 写失败的测试**

加到 `ModelChecklist.test.tsx` 的 `describe("ModelChecklist — qumge 合成一个列表", …)` 里：

```typescript
  it("列表说自己只是一批，总数由目录给", async () => {
    // 原来段标题写「Qumge 上还有 56 个」，那个 56 是"已加载的 60 条减去已勾的"。
    // list_models 一次最多给 60，网关上远不止 —— 这个数不是我们能算出来的。
    (gatewayModels as any).mockResolvedValueOnce({ models: GW, total: 312 });
    renderList("qumge", { curated: [SOL] });

    const note = await screen.findByTestId("gateway-partial");
    expect(note.textContent).toContain("312");
    // 段标题只说渲染了多少 —— 一条没勾的。
    expect(screen.getByTestId("mlist-others").textContent).toContain("1");
  });

  it("目录给不出总数时，只说是一批，不报数字", async () => {
    // 【回退】qumge 还没上线新表头。宁可不报，也不报一个假的。
    (gatewayModels as any).mockResolvedValueOnce({ models: GW });
    renderList("qumge", { curated: [SOL] });

    const note = await screen.findByTestId("gateway-partial");
    expect(note.textContent).toContain("最常用的一批");
    expect(note.textContent).not.toMatch(/\d/);
  });

  it("筛选之后不再说「这是最常用的一批」", async () => {
    // 筛完看到的是搜索结果，不是那一批。这句话在这一刻正好说反了。
    renderList("qumge", { curated: [SOL] });
    await screen.findByTestId("gateway-partial");

    fireEvent.change(screen.getByTestId("gateway-search"), { target: { value: "anthropic" } });
    expect(screen.queryByTestId("gateway-partial")).toBeNull();
  });
```

- [ ] **Step 2: 跑，确认它失败**

Run: `cd surfaces/gui && npx vitest run src/components/ModelChecklist.test.tsx -t 一批`
Expected: FAIL —— 找不到 `gateway-partial`。

- [ ] **Step 3: 存住总数**

`ModelChecklist.tsx:65` 那组 state 里，`gErr` 下面加：

```tsx
  // 网关上一共有多少个能当 agent 用的模型 —— 【由目录给】，界面数不出来：
  // list_models 一次最多给 60。目录给不出就是 null，文案退回不报总数的那版。
  const [gTotal, setGTotal] = useState<number | null>(null);
```

初次加载那个 effect（75-86 行）的 `.then` 里补一行：

```tsx
      .then((r) => {
        setGModels(r.models || []);
        setGTotal(r.total ?? null);
        setGErr(!!r.error);
      })
```

- [ ] **Step 4: 段标题下面挂 note**

`ModelChecklist.tsx:261-268` 那块替换成：

```tsx
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
```

- [ ] **Step 5: 跑，确认通过**

Run: `cd surfaces/gui && npx vitest run src/components/ModelChecklist.test.tsx`
Expected: PASS（整个文件）。

- [ ] **Step 6: 提交**

```bash
git add surfaces/gui/src/components/ModelChecklist.tsx surfaces/gui/src/components/ModelChecklist.test.tsx
git commit -m "fix: 「Qumge 上还有 56 个」是假的

那个 56 是"已加载的 60 条减去已勾的"。list_models 的 limit 上限就是 60，而网关上
远不止 —— 16 个关键词就探出 157 个不同 id，97 个在默认那 60 条之外。

段标题改回"渲染了多少就说多少"，把"这只是一部分"挪到底下一行；总数由目录给，
给不出就只说是一批。"
```

---

### Task 6: 模型页 —— 本地筛不到就去网关搜

**Files:**
- Modify: `surfaces/gui/src/components/ModelChecklist.tsx`（state、新 effect、`gateway-searching` / `gateway-nomatch` 两处渲染）
- Test: `surfaces/gui/src/components/ModelChecklist.test.tsx:194-195`（**既有断言要改**）+ 新增

**Interfaces:**
- Consumes: Task 2 的 `gatewayModels`；Task 3 的 `gatewaySearching`。
- Produces: `merge(incoming: GatewayModel[]): void`（并进 `gModels`，按 id 去重）、`tried: MutableRefObject<Set<string>>`（搜过的词，小写）—— **Task 7 复用这两个**。`data-testid="gateway-searching"` 节点。

- [ ] **Step 1: 改既有的那条断言**

`ModelChecklist.test.tsx:194-195` 现在是：

```typescript
    fireEvent.change(screen.getByTestId("gateway-search"), { target: { value: "zzzz" } });
    expect(screen.getByTestId("gateway-nomatch")).toBeTruthy();
```

改成：

```typescript
    // 【时机变了】本地筛不到不再等于"没有"——网关上还有一百多个够不着的模型。
    // 现在要等它去问过一轮，才能说没有。
    fireEvent.change(screen.getByTestId("gateway-search"), { target: { value: "zzzz" } });
    expect(await screen.findByTestId("gateway-nomatch")).toBeTruthy();
```

- [ ] **Step 2: 写新的失败测试**

加到同一个 describe 里：

```typescript
  const MISTRAL = {
    id: "qumge:mistralai/mistral-medium-3.1",
    name: "Mistral Medium 3.1",
    vendor: "Mistral",
    price: "$0.40/$2.00 per Mtok",
    vision: false,
    label: "Mistral: Mistral Medium 3.1 · $0.40/$2.00 per Mtok",
  };

  it("本地筛不到就去网关搜 —— 那是够到另外一百多个的唯一通道", async () => {
    // list_models 一次最多给 60 条，而筛选原来只对这 60 条做字符串包含。敲
    // mistral 得到「没有匹配的模型」，网关上其实有 23 条 —— 文案说了谎，唯一的
    // 补救路又恰好是堵死的。
    (gatewayModels as any)
      .mockResolvedValueOnce({ models: GW, total: 312 })
      .mockResolvedValueOnce({ models: [MISTRAL] });
    renderList("qumge", { curated: [SOL] });
    await screen.findByTestId(`mrow-${OPUS}`);

    fireEvent.change(screen.getByTestId("gateway-search"), { target: { value: "mistral" } });

    expect(await screen.findByTestId(`mrow-${MISTRAL.id}`)).toBeTruthy();
    expect(gatewayModels).toHaveBeenCalledWith("mistral");
  });

  it("出网期间说自己在找，找完了才说没有", async () => {
    // 不说的话就是技能页那个病的翻版：空白加一句「没有匹配的模型」，而其实
    // 正在搜。
    renderList("qumge", { curated: [SOL] });
    await screen.findByTestId(`mrow-${OPUS}`);

    fireEvent.change(screen.getByTestId("gateway-search"), { target: { value: "zzzz" } });

    expect(await screen.findByTestId("gateway-searching")).toBeTruthy();
    // 正在找的时候不能同时说"没有匹配的模型"—— 那是还没问出结果的话。
    expect(screen.queryByTestId("gateway-nomatch")).toBeNull();

    expect(await screen.findByTestId("gateway-nomatch")).toBeTruthy();
    expect(screen.queryByTestId("gateway-searching")).toBeNull();
  });

  it("同一个词不重复出网", async () => {
    // 结果并进了同一份缓存，第二次筛同一个词是纯本地的事。
    (gatewayModels as any)
      .mockResolvedValueOnce({ models: GW })
      .mockResolvedValueOnce({ models: [MISTRAL] });
    renderList("qumge", { curated: [SOL] });
    await screen.findByTestId(`mrow-${OPUS}`);

    const box = screen.getByTestId("gateway-search");
    fireEvent.change(box, { target: { value: "mistral" } });
    await screen.findByTestId(`mrow-${MISTRAL.id}`);

    fireEvent.change(box, { target: { value: "" } });
    fireEvent.change(box, { target: { value: "mistral" } });
    await screen.findByTestId(`mrow-${MISTRAL.id}`);

    // 挂载 1 次 + 搜索 1 次，就这两次。
    expect((gatewayModels as any).mock.calls.length).toBe(2);
  });
```

- [ ] **Step 3: 跑，确认它失败**

Run: `cd surfaces/gui && npx vitest run src/components/ModelChecklist.test.tsx -t 网关搜`
Expected: FAIL —— 找不到 `mrow-qumge:mistralai/mistral-medium-3.1`。

- [ ] **Step 4: 加 state 和 merge**

先补 import —— `ModelChecklist.tsx:1` 现在是 `import { useEffect, useMemo, useState } from "react";`，`useRef` 还没进来：

```tsx
import { useEffect, useMemo, useRef, useState } from "react";
```

`gTotal` 下面加：

```tsx
  // 正在去网关搜（含防抖那 400ms —— 那段时间也得说话，否则又是一段空白）。
  const [remote, setRemote] = useState(false);
  // 【已经问过网关的词】小写。同一个词不重复出网：结果并进了 gModels，第二次筛
  // 就是纯本地的事了。Task 7 的厂商 slug 也记在这里 —— 都是"问过了"。
  const tried = useRef(new Set<string>());
  // 【谁最后发的谁说了算】连着改筛选词时，先发的那次晚回来会把后发的盖掉，而
  // 界面上看不出任何异常，只是列表和输入框对不上。
  const seq = useRef(0);
```

`gwById` 那行（134 行）下面加：

```tsx
  // 网关搜回来的并进同一份缓存，不单独存一份：并进去之后本地 matches() 自然就
  // 把它们显示出来，后续再筛同一个词也不用再出网。
  const merge = (incoming: GatewayModel[]) =>
    setGModels((prev) => {
      const seen = new Set(prev.map((m) => m.id));
      return [...prev, ...incoming.filter((m) => !seen.has(m.id))];
    });
```

- [ ] **Step 5: 加出网回退的 effect**

`ModelChecklist.tsx` 里 `const shownOthers = others.filter(matches);`（231 行）下面加：

```tsx
  // 【本地筛不到，就去网关问一次】list_models 一次最多给 60 条，网关上远不止 ——
  // 搜索是够到其余那些的唯一通道。原来 matches() 只对已加载的 60 条做字符串包含，
  // 敲 mistral 得到「没有匹配的模型」，而网关上有 23 条。
  //
  // 【防抖 400ms】不防的话敲 mistral 会在 mis / mist / mistr… 每一步都 0 结果、
  // 每一步打一次网。常见情况（找 Claude / GPT）本地就筛到了，根本走不到这里。
  //
  // 【能这么做是因为网关的 query 是子串匹配】实测「便宜的能看图的模型」/「cheap
  // vision model」一律返回 0 条。服务端能命中的词，本地 matches() 那三段拼接里
  // 必然也有，所以并进来的结果不会被本地筛再滤掉。
  const q = gq.trim();
  const localHits = shownSelected.length + shownOthers.length;
  useEffect(() => {
    if (!isGateway || !q || localHits > 0 || tried.current.has(q.toLowerCase())) return;
    const mine = ++seq.current;
    setRemote(true);
    const timer = setTimeout(async () => {
      tried.current.add(q.toLowerCase());
      const r = await gatewayModels(q).catch(() => null);
      if (mine !== seq.current) return;   // 更新的那次会自己收尾
      setRemote(false);
      if (r) merge(r.models || []);
    }, 400);
    // 【cleanup 里也关掉 remote】改词时先归位，新的那次要么重新点亮、要么本地就
    // 筛到了。不归位的话，本地筛到之后指示灯会一直亮着。
    return () => {
      clearTimeout(timer);
      setRemote(false);
    };
  }, [q, localHits, isGateway]);
```

- [ ] **Step 6: 改两处渲染**

`gateway-nomatch` 那块（270-272 行）替换成：

```tsx
      {/* 【正在找的时候不说"没有"】那是还没问出结果的话。防抖那 400ms 也算在
          "正在找"里 —— 否则会先闪一下"没有匹配的模型"再改口。 */}
      {remote && (
        <div className="mlist-note" data-testid="gateway-searching">{t("gatewaySearching")}</div>
      )}

      {filtering && !remote && !shownSelected.length && !shownOthers.length && (
        <div className="mlist-note" data-testid="gateway-nomatch">{t("gatewayNoMatch")}</div>
      )}
```

- [ ] **Step 7: 跑，确认通过**

Run: `cd surfaces/gui && npx vitest run src/components/ModelChecklist.test.tsx`
Expected: PASS（整个文件，包括改过的那条既有断言）。

- [ ] **Step 8: 提交**

```bash
git add surfaces/gui/src/components/ModelChecklist.tsx surfaces/gui/src/components/ModelChecklist.test.tsx
git commit -m "feat: 模型筛选筛不到就去网关搜

筛选原来只对已加载的 60 条做字符串包含。敲 mistral 得到「没有匹配的模型」，而
网关上有 23 条 —— 前一个提交刚把文案的谎话修掉，这个提交修的是那条被堵死的补救路。

防抖 400ms（不防的话 mis/mist/mistr 每一步都打一次网），同一个词只问一次，结果
并进同一份缓存。「正在找」和「没有匹配」分开 —— 边搜边说没有是最差的顺序。"
```

---

### Task 7: 模型页 —— 已选行补上厂商和价格

**Files:**
- Modify: `surfaces/gui/src/components/ModelChecklist.tsx`（一个新 effect + 一个 `vendorOf` 小函数）
- Test: `surfaces/gui/src/components/ModelChecklist.test.tsx`

**Interfaces:**
- Consumes: Task 6 的 `merge()` 和 `tried`；Task 2 的 `gatewayModels`。
- Produces: 无新对外接口。

- [ ] **Step 1: 写失败的测试**

加到同一个 describe 里（用 Task 6 定义的 `MISTRAL`）：

```typescript
  it("已选里有那 60 条之外的模型时，补上它的厂商和价格", async () => {
    // 用户搜出一个 mistral 勾上，下次进页面时它不在默认那 60 条里 —— metaOf 查
    // 不到，那一行就没有厂商也没有价格。正是这一页返工时骂过的病：「价格只在
    // 还没选的那一半可见，选进来之后就看不到自己在花多少钱」。
    (gatewayModels as any)
      .mockResolvedValueOnce({ models: GW, total: 312 })
      .mockResolvedValueOnce({ models: [MISTRAL] });
    renderList("qumge", { curated: [MISTRAL.id] });

    const row = await screen.findByTestId(`mrow-${MISTRAL.id}`);
    await waitFor(() => expect(row.textContent).toContain("$0.40/$2.00 per Mtok"));
    expect(row.textContent).toContain("Mistral");
    // 按【厂商 slug】去补，不是按模型 id 一个一个问 —— 一个厂商一次请求。
    expect(gatewayModels).toHaveBeenCalledWith("mistralai");
  });

  it("已选全在默认那批里时，不多打一次网", async () => {
    // 【否定对照】不加"查不到的才补"这个判断的话，每次进页面都会白白多出一轮
    // 请求。等一会儿再数 —— 立刻数的话，补搜还没来得及发出，这条测试会假绿。
    renderList("qumge", { curated: [SOL] });
    await screen.findByTestId(`mrow-${OPUS}`);
    await new Promise((r) => setTimeout(r, 100));
    expect((gatewayModels as any).mock.calls.length).toBe(1);
  });
```

顶部 import 补上 `waitFor`：

```typescript
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
```

- [ ] **Step 2: 跑，确认它失败**

Run: `cd surfaces/gui && npx vitest run src/components/ModelChecklist.test.tsx -t 厂商和价格`
Expected: FAIL —— 那一行里没有价格。

- [ ] **Step 3: 加 `vendorOf` 和补搜的 effect**

`ModelChecklist.tsx` 里 `merge` 下面加：

```tsx
  // qumge:mistralai/mistral-medium-3.1 -> mistralai（冒号之后、斜杠之前那一段）。
  const vendorOf = (id: string) => {
    const tail = id.includes(":") ? id.slice(id.indexOf(":") + 1) : id;
    return tail.includes("/") ? tail.slice(0, tail.indexOf("/")) : "";
  };
```

`selected` / `others` 那两行（150-156 行）下面加：

```tsx
  // 【已选里那些不在默认 60 条中的，把它们的厂商和价格补回来】用户搜出一个
  // mistral 勾上，下次进页面它不在默认那批里，metaOf 查不到 —— 那一行就没有厂商
  // 也没有价格。这一页返工时骂过的正是这个病：「价格只在还没选的那一半可见，
  // 选进来之后就看不到自己在花多少钱，恰恰是事后想复查时唯一想看的数字」。
  //
  // 【按厂商 slug 去重，不是一个 id 一个请求】通常 0～2 个请求就够。实测这些
  // slug 服务端全都命中：mistralai→23、meta-llama→6、z-ai→14、qwen→52。
  useEffect(() => {
    if (!isGateway || !gModels.length) return;   // 等首批到手再说
    const slugs = [
      ...new Set(selected.filter((id) => !gwById.has(id)).map(vendorOf).filter(Boolean)),
    ].filter((s) => !tried.current.has(s.toLowerCase()));
    if (!slugs.length) return;
    slugs.forEach((s) => tried.current.add(s.toLowerCase()));
    Promise.all(slugs.map((s) => gatewayModels(s).catch(() => null))).then((rs) =>
      merge(rs.flatMap((r) => r?.models || [])),
    );
  }, [isGateway, gModels.length, selected.join(",")]);
```

- [ ] **Step 4: 跑，确认通过**

Run: `cd surfaces/gui && npx vitest run src/components/ModelChecklist.test.tsx`
Expected: PASS（整个文件）。

- [ ] **Step 5: 全量回归**

Run: `cd surfaces/gui && npx vitest run`
Expected: PASS。

Run: `cd surfaces/gui && npx tsc --noEmit`
Expected: 无报错。

Run: `.venv/bin/python -m pytest tests/ -q 2>&1 | tail -3`
Expected: 5 failed —— 就是那 5 条预存失败。

- [ ] **Step 6: 提交**

```bash
git add surfaces/gui/src/components/ModelChecklist.tsx surfaces/gui/src/components/ModelChecklist.test.tsx
git commit -m "fix: 已选里那 60 条之外的模型，补回厂商和价格

用户搜出一个 mistral 勾上，下次进页面它不在默认那批里，metaOf 查不到 —— 那一行
就没有厂商也没有价格。这一页返工时骂过的正是这个病：价格只在还没选的那一半可见。

按厂商 slug 去重补搜，通常 0～2 个请求。"
```

---

## 跨仓库的活（不在本仓库，Marlo 这边已经带回退）

qumge 侧把 `list_models` 的表头改成：

```
Showing 60 of 312 model(s) on the Qumge gateway, most used first.
```

**M 只数能当 agent 用的（tool-calling）模型。** qumge 上还有视频、图片这类模型，把它们算进 M，Marlo 就会显示一个用户永远搜不到的总数 —— 等于把「56」这个谎换成一个更大的谎。M 的口径必须和「列出来的」「搜得到的」是同一个集合。

Marlo 这边 Task 1 已经带上解析和回退，qumge 上线后数字自动变真，不用再发一次 Marlo。
