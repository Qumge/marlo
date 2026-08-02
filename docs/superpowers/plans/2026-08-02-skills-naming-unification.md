# 「能力」与「技能」合并 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把界面上说同一件事的两个词（「能力」/「技能」）和两个页面（账号菜单 ▸ 能力、设置 ▸ 技能）合并成一个词、一个页，顺带修掉合并暴露出的三处死代码。

**Architecture:** 两个页面的已装列表打的是同一个 `GET /v1/skills`。保留账号菜单那个入口作为唯一的页，设置里的 tab 删掉。页面拆成 `components/skills/` 下四个各管一件事的文件。先修 bug（独立可发布），再重构，最后统一文案。

**Tech Stack:** React 18 + TypeScript + Tailwind（`surfaces/gui`）、Vitest + @testing-library/react（单测）、Playwright（e2e）、构建期 i18n transform（`i18n-transform.ts` + `i18n/zh-text.ts`）+ 键索引 i18n（`i18n/zh.ts`、`i18n/en.ts`）。

## Global Constraints

- 规格：`docs/superpowers/specs/2026-08-02-skills-naming-unification-design.md`
- **界面上不许再出现「能力」二字。** 完工后 `grep -rn "能力" surfaces/gui/src` 在 `.tsx` / `zh.ts` / `zh-text.ts` 里必须为零（源码注释里讲历史可以留）。
- 英文侧只留 `Skills`，不留 `Abilities`。
- 所有命令在 `surfaces/gui/` 下跑：单测 `npm test`，e2e `npm run e2e`，类型 `npx tsc --noEmit`。
- **本机 pytest 基准是 5 failed 不是 0**（预存失败，与本计划无关，别去查）。本计划不动 Python，`pytest` 只在最后跑一次确认没多出新的失败。
- 提交信息用中文，句子说清「为什么」，跟仓库现有风格一致。
- 每个任务结束时 `npm test` 和 `npx tsc --noEmit` 都要过。
- `components/skills/` 下的新组件一律用 `useT()`（`i18n/index.ts:58`），不用模块级的 `t()`。`SkillsTab` 用的是后者，搬运时顺手换掉 —— `useT()` 订阅语言变化，切语言不用重开页面。
- 新组件的 i18n import 路径是 `../../i18n`（多一层目录），别照抄 `../i18n`。

---

### Task 1: 修死按钮 —— 移除打的是不存在的路由

「能力」页的「移除」按钮调 `POST /v1/skills/uninstall`，后端**没有这个路由**（`coworker/server/app.py:632` 的注释早写明该走 `DELETE /v1/skills/{name}`）。错误被 `.catch(() => {})` 吞掉，列表一刷新技能又回来。

它能活下来是因为移除从来没被测过：`AbilitiesView.test.tsx` 的 `serve()` 助手里有个 uninstall 分支（36-39 行），但 `opts.removed` 全文件只出现在那一次 push 里，13 条测试没有一条传过它。

**Files:**
- Modify: `surfaces/gui/src/components/AbilitiesView.test.tsx`（加一条测试；删 `serve()` 里的 uninstall 死分支）
- Modify: `surfaces/gui/src/api.ts:693-700`（删 `uninstallSkill`）
- Modify: `surfaces/gui/src/components/AbilitiesView.tsx:7,116-121`

**Interfaces:**
- Consumes: `deleteSkill(name: string, workspace?: string): Promise<{ ok: boolean; error?: string }>`（`api.ts:1293`，已存在，打 `DELETE /v1/skills/{name}`）
- Produces: `uninstallSkill` 从 `api.ts` 消失；后续任务一律用 `deleteSkill`

- [ ] **Step 1: 写会红的测试**

在 `AbilitiesView.test.tsx` 的 `describe("能力页", ...)` 里追加：

```tsx
  it("点移除，技能真的从列表里消失", async () => {
    // 【这条在修之前是红的】移除打的是 POST /v1/skills/uninstall，后端没有这个
    // 路由（app.py:632 的注释早写明该走 DELETE /v1/skills/{name}）。错误被
    // .catch(() => {}) 吞掉，列表一刷新技能又回来 —— 用户点了没反应，也没有提示。
    //
    // 断言分两半，缺一不可：列表里真的没了（用户看到的），且打出去的是 DELETE
    // （打对了路由）。只断言前者的话，一个"乐观地本地删掉"的假实现也能过。
    const calls: string[] = [];
    let skills: any[] = [{ name: "autowhisper", description: "已装的那条" }];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init?: any) => {
        const path = String(url).replace(/^https?:\/\/[^/]+/, "");
        calls.push(`${init?.method || "GET"} ${path}`);
        if (path.includes("/v1/skills/search")) return { json: async () => ({ results: [] }) };
        if (init?.method === "DELETE") {
          skills = [];
          return { json: async () => ({ ok: true }) };
        }
        return { json: async () => ({ skills }) };
      }),
    );

    render(<AbilitiesView />);
    await waitFor(() => expect(screen.getByTestId("ability-autowhisper")).toBeTruthy());
    fireEvent.click(screen.getByTestId("remove-autowhisper"));

    await waitFor(() => expect(screen.queryByTestId("ability-autowhisper")).toBeNull());
    expect(calls).toContain("DELETE /v1/skills/autowhisper");
  });
```

- [ ] **Step 2: 跑，确认它红**

```bash
cd surfaces/gui && npx vitest run src/components/AbilitiesView.test.tsx -t "点移除"
```

预期：FAIL。`waitFor` 超时，因为技能还在列表里（POST 打到了兜底分支，`skills` 没被清空）。

- [ ] **Step 3: 删掉 `uninstallSkill`**

`api.ts` 里整段删掉（693-700 行）：

```ts
export async function uninstallSkill(name: string): Promise<{ ok: boolean; error?: string }> {
  const res = await fetch(`${httpBase()}/v1/skills/uninstall`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ name }),
  });
  return res.json();
}
```

- [ ] **Step 4: `AbilitiesView` 改调 `deleteSkill`**

改 import（`AbilitiesView.tsx:2-10`），把 `uninstallSkill` 换成 `deleteSkill`：

```tsx
import {
  deleteSkill,
  getSkills,
  installSkill,
  searchSkills,
  skillDetail,
  type CatalogSkill,
  type InstalledSkill,
} from "../api";
```

改 `remove`（116-121 行）：

```tsx
  const remove = async (name: string) => {
    setBusy(name);
    // DELETE /v1/skills/{name} —— 上游唯一的卸载路径。以前这里打的是
    // POST /v1/skills/uninstall，后端根本没有那个路由（app.py:632）。
    const r = await deleteSkill(name).catch((e) => ({ ok: false, error: String(e) }));
    setBusy(null);
    if (!r.ok) setSearchErr(r.error || "remove failed");
    reload();
  };
```

- [ ] **Step 5: 删掉测试助手里的 uninstall 死分支**

`AbilitiesView.test.tsx` 的 `serve()` 里删掉这四行：

```tsx
      if (String(url).includes("/v1/skills/uninstall")) {
        opts.removed?.push(JSON.parse(init.body).name);
        return { json: async () => ({ ok: true }) };
      }
```

- [ ] **Step 6: 跑，确认全绿**

```bash
cd surfaces/gui && npm test && npx tsc --noEmit
```

预期：`AbilitiesView.test.tsx` 14 条全过，其余不受影响。

- [ ] **Step 7: 提交**

```bash
cd /Users/jiangxin/projects/marlo
git add surfaces/gui/src/api.ts surfaces/gui/src/components/AbilitiesView.tsx surfaces/gui/src/components/AbilitiesView.test.tsx
git commit -F - <<'EOF'
fix: 「移除」打的是后端没有的路由，点了等于没点

POST /v1/skills/uninstall 不存在，app.py:632 的注释早写明该走
DELETE /v1/skills/{name}。错误被 .catch(() => {}) 吞掉，列表一刷新
技能又回来。

它能活到现在是因为移除从来没被测过：测试助手里那个 uninstall 分支
是死代码，13 条测试没有一条传过 opts.removed。

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
```

---

### Task 2: 数据层收口 —— 一个类型、一个取数函数

`getSkills()`（`api.ts:631`）和 `listSkills()`（`api.ts:1262`）是同一个 `GET /v1/skills`，只是各写了一份类型。`InstalledSkill` 丢掉了 `enabled`，所以在设置里关掉的技能在「能力」页照样显示成「已装」。

顺带一处死代码：后端 `GET /v1/skills` 只返回 `{"skills": [...]}`，**没有 `dir`**（`manager.py:3822` → `skill_store.rows()`）。所以 `getSkills()` 里的 `b.dir ?? ""` 恒为空串，`AbilitiesView.tsx:288` 那行「装在 {dir}」从来没渲染过。连同 `abilitiesWhere` 一起删。

**Files:**
- Modify: `surfaces/gui/src/api.ts:625-636`（删 `InstalledSkill` 和 `getSkills`）
- Modify: `surfaces/gui/src/components/AbilitiesView.tsx`
- Modify: `surfaces/gui/src/components/AbilitiesView.test.tsx`
- Modify: `surfaces/gui/src/i18n/zh.ts`、`surfaces/gui/src/i18n/en.ts`（删 `abilitiesWhere`、`abilitiesFound`）

**Interfaces:**
- Consumes: `listSkills(workspace?: string): Promise<SkillRow[]>`（`api.ts:1262`）；`SkillRow { name, description, instructions, scope, source, enabled, path, files? }`（`api.ts:1227`）
- Produces: 全仓只剩 `listSkills` / `SkillRow` 一条取数路径；后续任务的已装列表都拿得到 `enabled` / `source` / `files`

**这一步不写新测试，是故意的。** 它是纯粹的类型收口，护栏是现有的 13 条测试 + `tsc` —— 两份类型合成一份，行为一个字节都不该变。

「关掉的技能不能伪装成已装」那个用户可见的修复**落在 Task 4**（`InstalledSkills` 的开关）。在这里造一个临时的「关」标签，Task 5 就会被开关取代 —— 等于写一个注定要删的 i18n 键和一条注定要删的测试。

- [ ] **Step 1: 删掉 `api.ts` 里重复的那一份**

删掉 625-636 行整段（`InstalledSkill` 接口 + `getSkills` 函数 + 它上面那句注释）。

- [ ] **Step 2: `AbilitiesView` 改用 `listSkills` / `SkillRow`**

import 换成：

```tsx
import {
  deleteSkill,
  installSkill,
  listSkills,
  searchSkills,
  skillDetail,
  type CatalogSkill,
  type SkillRow,
} from "../api";
```

state 和 reload 换成（删掉 `skillsDir`，它恒为空）：

```tsx
  const [installed, setInstalled] = useState<SkillRow[] | null>(null);

  const reload = () =>
    listSkills()
      .then(setInstalled)
      .catch(() => setInstalled([]));
```

`SkillRow` 比 `InstalledSkill` 多几个字段，行的渲染（`AbilitiesView.tsx:164-178`）用到的 `s.name` / `s.description` 两个都在，**JSX 不用动**。

- [ ] **Step 3: 删掉那行从未渲染过的「装在 {dir}」**

删掉 `AbilitiesView.tsx:288`：

```tsx
          {skillsDir && <div className="text-[11.5px] text-faint mt-3">{t("abilitiesWhere")(skillsDir)}</div>}
```

- [ ] **Step 4: 删掉两个死键**

`zh.ts` 和 `en.ts` 各删两行：`abilitiesWhere`（`zh.ts:643`，后端不返回 `dir`，从来没渲染过）和 `abilitiesFound`（`zh.ts:646`，全仓 0 引用）。

- [ ] **Step 5: 跑，确认全绿**

```bash
cd surfaces/gui && npm test && npx tsc --noEmit
```

预期：13 条测试**一条不少地全过** —— 纯收口，行为没变。`tsc` 会在 `getSkills` / `InstalledSkill` / `abilitiesWhere` 还有别处引用时报错，有的话按同样方式改掉。

- [ ] **Step 6: 提交**

```bash
cd /Users/jiangxin/projects/marlo
git add surfaces/gui/src/api.ts surfaces/gui/src/components/AbilitiesView.tsx surfaces/gui/src/components/AbilitiesView.test.tsx surfaces/gui/src/i18n/zh.ts surfaces/gui/src/i18n/en.ts
git commit -F - <<'EOF'
refactor: 取数收口到 listSkills/SkillRow

getSkills 和 listSkills 是同一个 GET /v1/skills，只是各写了一份类型，
而 InstalledSkill 那份丢掉了 enabled / source / files —— 合并后的页面
要用到这三个。

顺带删掉「装在 {dir}」：后端这个接口从来不返回 dir（manager.py:3822），
所以那行从来没渲染过。

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
```

---

### Task 3: 抽出 `SkillCatalog`

把「能力」页的目录部分（搜索框、翻译提示、错误条、分组结果、加载更多、正文预览弹层）抽成独立组件。纯搬运，行为不变 —— 测试跟着搬，断言一个字不改。

**Files:**
- Create: `surfaces/gui/src/components/skills/SkillCatalog.tsx`
- Create: `surfaces/gui/src/components/skills/SkillCatalog.test.tsx`
- Modify: `surfaces/gui/src/components/AbilitiesView.tsx`（改成用 `<SkillCatalog>`）
- Modify: `surfaces/gui/src/components/AbilitiesView.test.tsx`（目录相关的 9 条搬走）

**Interfaces:**
- Consumes: `searchSkills(q, offset?)`、`skillDetail(slug)`、`installSkill(slug)`、`CatalogSkill`（都在 `api.ts`，不动）
- Produces:

```tsx
export function SkillCatalog({
  installedNames,   // 已装技能名的集合，用来把「添加」换成「已装」
  onInstalled,      // 装成功后通知外层重新拉列表
}: {
  installedNames: Set<string>;
  onInstalled: () => void;
}): JSX.Element
```

`data-testid` 全部保持原样（`abilities-search` / `abilities-translated` / `abilities-error` / `abilities-results` / `abilities-more` / `catalog-{name}` / `install-{name}` / `view-{name}` / `ability-detail`）—— Task 6 才统一改名，这一步只搬位置。

- [ ] **Step 1: 建 `skills/SkillCatalog.tsx`**

把 `AbilitiesView.tsx` 里这些整段搬过去，一个字符都不改：`groupsOf()`（18-27 行）、state `q` / `results` / `searchErr` / `busy` / `hasMore` / `searchedAs` / `loadingMore` / `detail`、两个 `useEffect`（防抖搜索那个）、`loadMore` / `openDetail` / `add`，以及 JSX 里从搜索框（131 行）到详情弹层（286 行）之间的全部。

文件头写清楚它是什么：

```tsx
// 技能目录 —— qumge.com 上 4500+ 条公开技能的搜索/浏览/安装界面。
//
// 【关于搜索】规格 D' 说发现发生在对话里：用户说要做什么，Marlo 自己去找。那仍然
// 是主路径。但 owner 的判断是用户也要能自己看 —— 一个东西你完全看不见里面有什么，
// 是很难信任它的。所以这里给搜索，而不是把它藏起来。两条路指向同一个目录。
//
// 搜索框的 placeholder 写"搜技能目录"而不是"搜索"，空结果提示写"试试直接说你要做
// 的事，而不是工具的名字"—— 这个目录是按【用途】索引的，按工具名搜经常是空的，而
// 空结果不解释原因的话，人会以为目录里没东西。
```

骨架 —— 搬运时对着它放：

```tsx
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
  const [searchedAs, setSearchedAs] = useState("");
  const [loadingMore, setLoadingMore] = useState(false);
  const [detail, setDetail] = useState<{ name: string; body: string } | null>(null);

  // 防抖搜索的 useEffect（AbilitiesView.tsx:72-87）原样搬。
  // loadMore / openDetail 原样搬。

  const add = async (s: CatalogSkill) => {
    setBusy(s.slug);
    const r = await installSkill(s.slug).catch((e) => ({ ok: false, error: String(e) }));
    setBusy(null);
    if (r.ok) onInstalled();          // 【唯一的行为改动】原来是 reload()，现在通知外层
    else setSearchErr(r.error || "install failed");
  };

  return (
    <>
      {/* 搜索框 → 翻译提示 → 错误条 → 分组结果 → 加载更多 → 详情弹层 */}
    </>
  );
}
```

两处**只此两处**的行为改动：`installedNames` 从 props 拿（原来是组件内 `new Set((installed || []).map(...))` 算的），`add()` 成功后调 `onInstalled()` 而不是 `reload()`。其余一个字符不改。

- [ ] **Step 2: `AbilitiesView` 改成用它**

删掉搬走的那些 state / effect / 函数 / JSX，换成：

```tsx
          <SkillCatalog
            installedNames={new Set((installed || []).map((s) => s.name))}
            onInstalled={reload}
          />
```

`searchErr` 现在归 `SkillCatalog` 管，所以 Task 2 里 `remove()` 的报错要换个去处 —— `AbilitiesView` 自己留一个 `const [removeErr, setRemoveErr] = useState("")`，渲染在已装列表上方：

```tsx
          {removeErr && (
            <div className="text-[12px] text-warnInk mb-4" data-testid="abilities-error">
              {removeErr}
            </div>
          )}
```

- [ ] **Step 3: 测试跟着搬**

新建 `skills/SkillCatalog.test.tsx`，把 `AbilitiesView.test.tsx` 里这 9 条搬过去，**断言一个字不改**：

- 「能搜目录，结果里带来源和「需要先连」」
- 「已经装了的不再显示「添加」」
- 「点添加会把 slug 发过去」
- 「目录连不上要说原因 —— 空列表会被读成「什么都没搜到」」
- 「还有下一页时才显示「加载更多」」
- 「点「加载更多」用【已加载条数】当 offset，不是页码」
- 「能在装之前看正文，并说明我们怎么对待它」
- 「中文搜出英文结果时，说清楚实际搜的是什么」
- 「没翻译时不说自己翻了」

`serve()` 助手复制一份过去（去掉已装列表那个兜底分支，改成只服务 search / detail / install）。渲染改成：

```tsx
    render(<SkillCatalog installedNames={new Set()} onInstalled={() => {}} />);
```

「已经装了的不再显示「添加」」那条改成传 `installedNames={new Set(["autowhisper"])}`。

- [ ] **Step 4: 跑，确认全绿**

```bash
cd surfaces/gui && npm test && npx tsc --noEmit
```

预期：`SkillCatalog.test.tsx` 9 条过，`AbilitiesView.test.tsx` 剩 5 条过。总数不变。

- [ ] **Step 5: 提交**

```bash
cd /Users/jiangxin/projects/marlo
git add surfaces/gui/src/components/skills/ surfaces/gui/src/components/AbilitiesView.tsx surfaces/gui/src/components/AbilitiesView.test.tsx
git commit -F - <<'EOF'
refactor: 目录部分抽成 SkillCatalog —— 纯搬运，断言一个字没改

为合并「能力」和「技能」两个页面做准备。搬完两个文件都在
300 行以内，各管一件事。

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
```

---

### Task 4: 抽出 `InstalledSkills` 和 `SkillEditor`

把 `SkillsTab` 的两块拆开：已装列表（开关 / 编辑 / 删 / 文件夹 / 来源徽章）和编辑表单（自己写 + 导入预览）。这一步 `SkillsTab` 还活着，只是变薄。

**Files:**
- Create: `surfaces/gui/src/components/skills/InstalledSkills.tsx`
- Create: `surfaces/gui/src/components/skills/SkillEditor.tsx`
- Create: `surfaces/gui/src/components/skills/InstalledSkills.test.tsx`
- Modify: `surfaces/gui/src/components/SkillsTab.tsx`

**Interfaces:**
- Consumes: `SkillRow`（`api.ts:1227`）、`SkillUploadPreview`（`api.ts:1245`）、`updateSkill` / `deleteSkill` / `revealSkill` / `createSkill` / `stageSkillUpload` / `confirmSkillUpload`
- Produces:

```tsx
export function InstalledSkills({
  rows,
  onEdit,      // 点铅笔：把这一行的内容交给外层，由它打开编辑器
  onChanged,   // 开关/删除成功后通知外层刷新列表
  onNotice,    // 状态变化提示条（name-first，SKILLS-SPEC §4.1 #2）
  onError,
}: {
  rows: SkillRow[];
  onEdit: (row: SkillRow) => void;
  onChanged: () => void;
  onNotice: (n: { name: string; text: string; tone: "ok" | "warn" } | null) => void;   // null = 清掉上一条
  onError: (msg: string) => void;
}): JSX.Element

export type SkillDraft = {
  mode: "new" | "edit";
  name: string;
  description: string;
  instructions: string;
};

export function SkillEditor({
  draft,
  upload,
  onSaved,     // 保存成功：外层收起编辑器并刷新
  onCancel,
  onNotice,
  onError,
}: {
  draft: SkillDraft | null;
  upload: SkillUploadPreview | null;
  onSaved: () => void;   // 只收尾（收起编辑器 + 刷新）；提示条由 SkillEditor 自己按 mode 决定
  onCancel: () => void;
  onNotice: (n: { name: string; text: string; tone: "ok" | "warn" } | null) => void;   // null = 清掉上一条
  onError: (msg: string) => void;
}): JSX.Element | null
```

- [ ] **Step 1: 建 `skills/InstalledSkills.tsx`**

搬 `SkillsTab.tsx:383-460` 那个列表（含空状态、来源徽章、文件夹 chip、铅笔、两步删除、开关），以及它用到的 `CARD` / `BTN_BORDERED` / `BADGE` 常量和 `armedDelete` state、`remove()` 函数。

保留原有注释，尤其这两条 —— 它们记的是踩过的坑：

```tsx
                {/* §6: a rich skill must not look identical to a one-file one. Styled as a
                    chip with a folder icon so it READS as clickable (live drive: plain
                    text hid the affordance). */}
```

```tsx
              {/* Full description, wrapping — a skill's one-liner is its menu entry; cutting
                  it mid-word hid what the skill does (live drive). */}
```

骨架：

```tsx
export function InstalledSkills({ rows, onEdit, onChanged, onNotice, onError }: {
  rows: SkillRow[];
  onEdit: (row: SkillRow) => void;
  onChanged: () => void;
  onNotice: (n: { name: string; text: string; tone: "ok" | "warn" } | null) => void;   // null = 清掉上一条
  onError: (msg: string) => void;
}) {
  const t = useT();
  const [armedDelete, setArmedDelete] = useState<string | null>(null);

  const fail = (res: { ok?: boolean; error?: string }) => {
    // 【第一行必须是它】原版 fail() 每次调用都先清掉上一条横幅，不管成败。掉了这行
    // 会出现：关掉技能 A 弹出绿条，接着删技能 B 失败弹出红条 —— 两条不相干的提示
    // 并排挂着。这也是 onNotice 的签名要接受 null 的原因。
    onNotice(null);
    if (res.ok === false) {
      onError(res.error || t("skWentWrong"));
      return true;
    }
    onError("");
    return false;
  };

  // 两步删除（SkillsTab.tsx:160-170 原样搬）：第一下上膛，第二下才发 DELETE。
  const remove = async (row: SkillRow) => {
    if (armedDelete !== row.name) {
      setArmedDelete(row.name);
      return;
    }
    setArmedDelete(null);
    const res = await deleteSkill(row.name);
    if (fail(res)) return;
    onNotice({ name: row.name, text: t("skRemoved"), tone: "warn" });
    onChanged();
  };

  return <div className={`${CARD} divide-y divide-line`}>{/* 空状态 + rows.map */}</div>;
}
```

每行加 `data-testid={`ability-${row.name}`}`，删除按钮加 `data-testid={`remove-${row.name}`}` —— 和「能力」页原来的 testid 对齐，这样 Task 5 合并时 e2e 不用两套选择器（Task 7 再统一改成 `skill-*`）。

- [ ] **Step 2: 建 `skills/SkillEditor.tsx`**

搬 `SkillsTab.tsx:303-381`（导入预览卡 + 编辑表单）和 `save()` / `confirmUpload()`。`fileToB64`（50-68 行）跟着搬 —— 只有上传用得到，它上面那句注释（`File.arrayBuffer is missing in some webviews (and jsdom)`）记的是踩过的坑，一起搬。

骨架：

```tsx
export type SkillDraft = {
  mode: "new" | "edit";
  name: string;
  description: string;
  instructions: string;
};

export const emptySkillDraft = (): SkillDraft => ({
  mode: "new",
  name: "",
  description: "",
  instructions: "",
});

export function SkillEditor({ draft, upload, onSaved, onCancel, onNotice, onError }: {
  draft: SkillDraft | null;
  upload: SkillUploadPreview | null;
  onSaved: () => void;   // 只收尾（收起编辑器 + 刷新）；提示条由 SkillEditor 自己按 mode 决定
  onCancel: () => void;
  onNotice: (n: { name: string; text: string; tone: "ok" | "warn" } | null) => void;   // null = 清掉上一条
  onError: (msg: string) => void;
}) {
  // 本地草稿：外层给初值，敲字不往上冒泡（每敲一个字都重渲染整页是没必要的）。
  const [local, setLocal] = useState<SkillDraft | null>(draft);
  useEffect(() => setLocal(draft), [draft]);

  if (!local && !upload) return null;
  // upload 有值 → 渲染导入预览卡（SkillsTab.tsx:303-330）
  // local 有值  → 渲染编辑表单（SkillsTab.tsx:332-381）
}
```

`emptySkillDraft()` 从 `SkillsTab.tsx:43-48` 的 `emptyEditor()` 改名导出 —— Task 5 的「自己写」那个门要用它。

- [ ] **Step 3: `SkillsTab` 改成用这两个**

`SkillsTab` 只剩：标题、「Add skill」菜单、error / notice 条、`rows` state、`refresh()`，以及：

```tsx
      <SkillEditor
        draft={editor}
        upload={upload}
        {/* 只收尾，【不要】在这里弹提示条 —— 原版 save() 是 `if (editor.mode === "new")`
            才弹的，编辑保存是静默的。在父层无条件弹，会让「改一句说明」也冒出
            「—— 之后每次对话它都能用了。」这句只属于新建的话。提示由 SkillEditor
            自己按 mode 决定（新建弹、上传确认弹、编辑不弹）。 */}
        onSaved={() => {
          setEditor(null);
          setUpload(null);
          refresh();
        }}
        onCancel={() => {
          setEditor(null);
          setUpload(null);
        }}
        onNotice={setNotice}
        onError={setError}
      />
      <InstalledSkills
        rows={rows}
        onEdit={(row) =>
          setEditor({
            mode: "edit",
            name: row.name,
            description: row.description,
            instructions: row.instructions,
          })
        }
        onChanged={refresh}
        onNotice={setNotice}
        onError={setError}
      />
```

- [ ] **Step 4: 给 `InstalledSkills` 写单测**

新建 `skills/InstalledSkills.test.tsx`。这是**新增覆盖** —— 开关和删除以前只有 e2e 测过：

```tsx
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { InstalledSkills } from "./InstalledSkills";
import { setLocale } from "../../i18n";

const ROWS = [
  { name: "weekly-report", description: "周一进度汇报", instructions: "x",
    scope: "global" as const, source: "local", enabled: true, path: "/s/weekly-report", files: 0 },
  { name: "html-to-markdown", description: "HTML 转 markdown", instructions: "y",
    scope: "global" as const, source: "uploaded", enabled: false, path: "/s/html-to-markdown", files: 2 },
];

beforeEach(() => setLocale("zh"));
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const noop = () => {};

describe("已装技能列表", () => {
  it("关掉的那条要看得出是关的", () => {
    render(<InstalledSkills rows={ROWS} onEdit={noop} onChanged={noop} onNotice={noop} onError={noop} />);
    expect((screen.getByLabelText("html-to-markdown enabled") as HTMLInputElement).checked).toBe(false);
    expect((screen.getByLabelText("weekly-report enabled") as HTMLInputElement).checked).toBe(true);
  });

  it("带附件的技能要看得出来 —— 和单文件的长一样就等于藏了", () => {
    // §6：live drive 里纯文字藏掉了这个可点击的入口，所以做成带文件夹图标的 chip。
    render(<InstalledSkills rows={ROWS} onEdit={noop} onChanged={noop} onNotice={noop} onError={noop} />);
    expect(screen.getByTitle("Show folder").textContent).toContain("2 file");
  });

  it("删除要两步 —— 第一下只是上膛", async () => {
    const calls: string[] = [];
    vi.stubGlobal("fetch", vi.fn(async (url: string, init?: any) => {
      calls.push(`${init?.method || "GET"} ${String(url).replace(/^https?:\/\/[^/]+/, "")}`);
      return { json: async () => ({ ok: true }) };
    }));
    const onChanged = vi.fn();
    render(<InstalledSkills rows={ROWS} onEdit={noop} onChanged={onChanged} onNotice={noop} onError={noop} />);

    fireEvent.click(screen.getByTestId("remove-weekly-report"));
    expect(calls).toEqual([]);            // 上膛不发请求

    fireEvent.click(screen.getByTestId("remove-weekly-report"));
    await waitFor(() => expect(calls).toContain("DELETE /v1/skills/weekly-report"));
    await waitFor(() => expect(onChanged).toHaveBeenCalled());
  });

  it("开关改的是 enabled，且提示条点名是哪一条", async () => {
    const bodies: any[] = [];
    vi.stubGlobal("fetch", vi.fn(async (_url: string, init?: any) => {
      if (init?.body) bodies.push(JSON.parse(init.body));
      return { json: async () => ({ ok: true }) };
    }));
    const onNotice = vi.fn();
    render(<InstalledSkills rows={ROWS} onEdit={noop} onChanged={noop} onNotice={onNotice} onError={noop} />);

    fireEvent.click(screen.getByLabelText("weekly-report enabled"));
    await waitFor(() => expect(bodies).toEqual([{ enabled: false }]));
    await waitFor(() =>
      expect(onNotice).toHaveBeenCalledWith(
        expect.objectContaining({ name: "weekly-report", tone: "warn" }),
      ),
    );
  });
});
```

- [ ] **Step 5: 跑，确认全绿**

```bash
cd surfaces/gui && npm test && npx tsc --noEmit
```

预期：新增 4 条过；`skills-settings.spec.ts` 这一步还没跑（e2e 单独跑），但 `SkillsTab` 行为没变，Task 5 之后再验。

- [ ] **Step 6: 提交**

```bash
cd /Users/jiangxin/projects/marlo
git add surfaces/gui/src/components/skills/ surfaces/gui/src/components/SkillsTab.tsx
git commit -F - <<'EOF'
refactor: SkillsTab 拆成 InstalledSkills + SkillEditor

同时给开关和两步删除补上单测 —— 这两条路以前只有 e2e 覆盖，
而 e2e 跑得慢、失败时也不指哪儿。

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
```

---

### Task 5: 合成一页 —— `SkillsView`，删掉两个旧组件和设置里的 tab

**Files:**
- Create: `surfaces/gui/src/components/skills/SkillsView.tsx`
- Create: `surfaces/gui/src/components/skills/SkillsView.test.tsx`
- Delete: `surfaces/gui/src/components/AbilitiesView.tsx`、`AbilitiesView.test.tsx`、`SkillsTab.tsx`
- Modify: `surfaces/gui/src/App.tsx`、`SettingsView.tsx`、`AccountRow.tsx`、`Sidebar.tsx`、`Sidebar.test.tsx`、`Sidebar.account.test.tsx`、`Icon.tsx`

**Interfaces:**
- Consumes: `SkillCatalog`（Task 3）、`InstalledSkills` / `SkillEditor` / `SkillDraft`（Task 4）
- Produces:

```tsx
export function SkillsView({
  onCreateSkill,   // 「让 Marlo 做」那个门：开新对话 + 预填 composer
}: {
  onCreateSkill?: (description: string) => void;
}): JSX.Element
```

- [ ] **Step 1: 建 `skills/SkillsView.tsx`**

页面外壳。持有 `rows` / `error` / `notice` / `editor` / `upload` / `addOpen`，以及 5 秒轮询。

```tsx
// 技能 —— 唯一的一页。账号菜单里「Marlo 有什么」的三件之一（收件箱 / 技能 / 外部连接）。
//
// 【为什么只有一页】2026-08-02 之前这里是两页：账号菜单的「能力」和设置里的「技能」。
// 两者打的是同一个 GET /v1/skills —— 不是叫法不一致，是同一份数据渲染了两遍，而且
// 已经因此坏了三处（移除按钮打了不存在的路由、禁用状态看不见、从设置里点目录会把人
// 甩出设置）。规格：docs/superpowers/specs/2026-08-02-skills-naming-unification-design.md
//
// 【为什么目录常驻在下半页，而不是收进「添加」菜单】0e1b2a0 定过：没搜索时也要有列表，
// 用户得能自己看见目录里有什么。收进菜单等于推翻它。目录在同一页之后，「浏览目录」
// 那个门自己就不需要了 —— 添加菜单从四个门变回三个。
export function SkillsView({ onCreateSkill }: { onCreateSkill?: (description: string) => void }) {
  const t = useT();
  const [rows, setRows] = useState<SkillRow[]>([]);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState<{ name: string; text: string; tone: "ok" | "warn" } | null>(null);
  const [editor, setEditor] = useState<SkillDraft | null>(null);
  const [upload, setUpload] = useState<SkillUploadPreview | null>(null);
  const [addOpen, setAddOpen] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);

  const refresh = () => listSkills().then(setRows).catch(() => setRows([]));

  useEffect(() => {
    refresh();
    // 对话里装上的技能要能自己出现，不用重开页面。
    const i = setInterval(refresh, 5000);
    return () => clearInterval(i);
  }, []);
  ...
}
```

渲染结构（`main` / `overflow-y-auto` / `max-w-4xl` 那三层外壳照搬 `AbilitiesView.tsx:124-126`，让它和「外部连接」页保持同一个形状）：

```tsx
  return (
    <main className="flex-1 min-w-0 flex bg-paper">
      <div className="flex-1 min-w-0 overflow-y-auto hairline-scroll">
        <div className="max-w-4xl mx-auto px-7 py-6">
          <div className="flex items-start justify-between gap-3">
            <PanelHead title={t("skills")} sub={t("skillsSub")} />
            {/* 一个添加动作，后面三个门。第四个（浏览目录）不需要了 —— 目录就在下面。 */}
            <AddMenu
              open={addOpen}
              onToggle={() => setAddOpen((v) => !v)}
              onClose={() => setAddOpen(false)}
              onWrite={() => setEditor(emptySkillDraft())}
              onImport={() => fileInput.current?.click()}
              onAskMarlo={onCreateSkill}
            />
          </div>

          {error ? <div className="text-[12.5px] text-red-500 mb-3" role="alert">{error}</div> : null}
          {notice ? <NoticeBar notice={notice} onDismiss={() => setNotice(null)} /> : null}

          <SkillEditor
            draft={editor}
            upload={upload}
            {/* 只收尾，【不要】在这里弹提示条 —— 提示由 SkillEditor 自己按 mode 决定
                （新建弹、上传确认弹、编辑保存静默）。父层无条件弹会让「改一句说明」
                也冒出「—— 之后每次对话它都能用了。」这句只属于新建的话。 */}
            onSaved={() => {
              setEditor(null);
              setUpload(null);
              refresh();
            }}
            onCancel={() => { setEditor(null); setUpload(null); }}
            onNotice={setNotice}
            onError={setError}
          />

          <InstalledSkills
            rows={rows}
            onEdit={(row) =>
              setEditor({
                mode: "edit",
                name: row.name,
                description: row.description,
                instructions: row.instructions,
              })
            }
            onChanged={refresh}
            onNotice={setNotice}
            onError={setError}
          />

          <SkillCatalog
            installedNames={new Set(rows.map((r) => r.name))}
            onInstalled={refresh}
          />
        </div>
      </div>
    </main>
  );
```

`AddMenu` 和 `NoticeBar` 不另开文件 —— 它们只有这一个用处，写成同文件里的局部函数组件。「添加 ▾」菜单的内容从 `SkillsTab.tsx:194-260` 搬，**删掉第四个门**（`skills-browse-catalog` 那一项，243-257 行）和 `onBrowseCatalog` prop；隐藏的 `<input type="file">`（263-273 行）跟着搬。

- [ ] **Step 2: 删掉三个旧文件**

```bash
cd /Users/jiangxin/projects/marlo
git rm surfaces/gui/src/components/AbilitiesView.tsx surfaces/gui/src/components/AbilitiesView.test.tsx surfaces/gui/src/components/SkillsTab.tsx
```

`AbilitiesView.test.tsx` 里剩下的 5 条（已装列表、空状态、后端挂了、移除、英文界面）搬进 `SkillsView.test.tsx`，断言不改，渲染改成 `<SkillsView />`。**「点移除，技能真的从列表里消失」这条必须搬** —— 它是 Task 1 的护栏。

- [ ] **Step 3: `App.tsx` 改路由**

219、222 行的 `SetTab` 去掉 `"skills"`：

```tsx
    "appearance" | "models" | "voice" | "personas"
```

232 行的 `surface` 把 `"abilities"` 改成 `"skills"`：

```tsx
    "session" | "scheduled" | "integrations" | "skills" | "audit" | "inbox" | "persona" | "settings"
```

57 行 import 换成 `import { SkillsView } from "./components/skills/SkillsView";`。

1370、1375 行 prop 改名：`onOpenAbilities` → `onOpenSkills`（`setSurface("skills")`）、`abilitiesActive` → `skillsActive`（`surface === "skills"`）。

1388-1389 行：

```tsx
      ) : surface === "skills" ? (
        <SkillsView onCreateSkill={...} />
      ) : ...
```

`onCreateSkill` 那个回调（1400-1412 行）整段从 `<SettingsView>` 挪到 `<SkillsView>`。1396-1399 行的 `onBrowseCatalog` **整个删掉**，连同它上面那条注释。

- [ ] **Step 4: `SettingsView.tsx` 删掉技能 tab**

- 56 行：`type SetTab = "appearance" | "models" | "voice" | "personas";`
- 72 行：删掉 `{ key: "skills", label: "navSkills", icon: "book" },`
- 141-142 行：删掉 `) : tab === "skills" ? (` 和 `<SkillsTab ... />` 那两行
- 删掉 `SkillsTab` 的 import，以及 `onCreateSkill` / `onBrowseCatalog` 两个 props（连同类型签名）
- `SET_TABS` 的 icon 联合类型里 `"book"` 不再有人用，一起删

- [ ] **Step 5: `AccountRow.tsx` 换标签和图标**

157 行：

```tsx
              {appMenuItem("book", t("skills"), onOpenSkills, skillsActive)}
```

prop 名跟着改（31-32、45-46 行）。`sparkle` 太泛（人格也在用），`book` 是原设置 tab 用的图标 —— 一本菜谱。

- [ ] **Step 6: `Sidebar.tsx` 和两份 test 的 prop 改名**

`Sidebar.tsx:123` 及往下传的地方，`onOpenAbilities` / `abilitiesActive` → `onOpenSkills` / `skillsActive`。`Sidebar.test.tsx:60-61`、`Sidebar.account.test.tsx:64-65` 跟着改。

- [ ] **Step 7: `Icon.tsx` 改注释**

71 行注释里的 `(Settings ▸ Skills)` 指的是删掉的那个 tab：

```tsx
      // A playbook — Skills are the worker's recipe book (账号菜单 ▸ 技能).
```

- [ ] **Step 8: 跑，确认全绿**

```bash
cd surfaces/gui && npm test && npx tsc --noEmit
```

`tsc` 是这一步的主力：prop 改名和删 tab 会牵出所有没改到的引用点。逐个改完为止。

- [ ] **Step 9: 提交**

```bash
cd /Users/jiangxin/projects/marlo
git add -A surfaces/gui/src
git commit -F - <<'EOF'
refactor: 「能力」和「技能」合成一页 —— 账号菜单 ▸ 技能

设置里的技能 tab 删掉。目录常驻在页面下半部分，所以「添加」菜单里
「浏览 Qumge 目录」那个门不需要了，从四个门变回三个 —— 也就不会再
把人从设置里甩出去。

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
```

---

### Task 6: 文案统一 —— 「能力」从界面上消失

**Files:**
- Modify: `surfaces/gui/src/i18n/zh.ts`、`surfaces/gui/src/i18n/en.ts`、`surfaces/gui/src/i18n/zh-text.ts`
- Modify: `surfaces/gui/src/components/skills/*.tsx`（`abilities*` → `sk*`，裸英文 → `t()`）
- Modify: `surfaces/gui/src/components/ApprovalCard.tsx:110`
- Modify: `surfaces/gui/src/components/PersonaView.tsx`（只改译文，不改源码）

**Interfaces:**
- Consumes: `t` / `useT`（`i18n/index.ts:49,58`）
- Produces: `zh.ts` / `en.ts` 里 `abilities*` 全部消失，统一在 `sk*` 前缀下

- [ ] **Step 1: `abilities*` 改名成 `sk*`**

`zh.ts:639-657` 和 `897-898` 那一组（Task 2 已删掉 `abilitiesWhere` / `abilitiesFound`，剩 19 个键）整体挪到 `sk*` 块（102-117 行）里并改名：

| 旧 | 新 |
|---|---|
| `abilities` | `skills` |
| `abilitiesSub` | `skillsSub` |
| `abilitiesEmpty` | `skEmpty` |
| `abilitiesEmptyHow` | `skEmptyHow` |
| `abilitiesSearch` | `skSearch` |
| `abilitiesInstalled` | `skInstalled` |
| `abilitiesInstall` | `skInstall` |
| `abilitiesInstalling` | `skInstalling` |
| `abilitiesRemove` | `skRemove` |
| `abilitiesNeeds` | `skNeeds` |
| `abilitiesNoResults` | `skNoResults` |
| `abilitiesVetted` | `skVetted` |
| `abilitiesMore` | `skMore` |
| `abilitiesLoading` | `skLoading` |
| `abilitiesView` | `skViewBody` |
| `abilitiesClose` | `skClose` |
| `abilitiesUntrusted` | `skUntrusted` |
| `abilitiesSearchFailed` | `skSearchFailed` |
| `abilitiesTranslated` | `skTranslated` |

改值：

```ts
  skills: "技能",
  skillsSub: "它干活时会照着做的做法。你可以自己加，它自己也会去找。",
  skEmpty: "还没装任何技能。",
```

`en.ts` 同步，并删掉 `abilities: "Abilities"`：

```ts
  skills: "Skills",
  skillsSub: "What Marlo follows while it works. You can add your own; it also finds new ones itself.",
  skEmpty: "Nothing installed yet.",
```

`skEmptyHow` 的中文里有「能力」吗？原文是「这些不用你从列表里挑 —— 跟 Marlo 说你要做什么，它自己会去找。」没有，照搬。

- [ ] **Step 2: `scSavesToSkills` 去掉不存在的路径**

`zh.ts:117`：

```ts
  scSavesToSkills: "保存到技能",
```

`en.ts:31`：

```ts
  scSavesToSkills: "saves to Skills",
```

（`ApprovalCard.tsx:110` 引用它，键名不变，不用动组件。）

- [ ] **Step 3: 「内置能力」改成「内置工具」**

`zh-text.ts:38`：

```ts
  "Built-in capabilities": "内置工具",
```

`PersonaView.tsx:139` 的源码是裸英文 `Built-in capabilities`，走 transform，**不动源码**。

- [ ] **Step 4: `skills/*.tsx` 里的裸英文改走 `t()`**

Task 3-5 从 `SkillsTab` 搬过来的裸英文全部换成 `t("键")`。键加进 `zh.ts` / `en.ts` 的 `sk*` 块 —— 中文取 `zh-text.ts` 里已有的译文，别重译：

| 新键 | zh（取自 `zh-text.ts`） | en（源码原文） |
|---|---|---|
| `skAdd` | `添加技能` | `Add skill` |
| `skDoorWrite` | `自己写` | `Write it myself` |
| `skDoorWriteSub` | `一个名字、一句说明，和具体做法` | `A name, a description, and the instructions` |
| `skDoorImport` | `导入文件` | `Import a file` |
| `skDoorImportSub` | `别人分享的 .zip 或 SKILL.md —— 安装前你先过目` | `A .zip or SKILL.md someone shared — you review before it installs` |
| `skDoorMarlo` | `让 Marlo 做` | `Create with Marlo` |
| `skDoorMarloSub` | `会开一个对话 —— 它来写，写完问过你再加进技能库` | `Starts a conversation — the worker builds it and asks before adding it to your skills` |
| `skUploadLabel` | `上传技能压缩包` | `Upload a skill archive` |
| `skReviewFirst` | `安装前先过目` | `Review before installing` |
| `skReviewLede` | `把做法读一遍 —— 安装一个技能，意味着它会照着做。` | `Read the instructions — installing a skill means the worker will follow them.` |
| `skInstallBtn` | `安装技能` | `Install skill` |
| `skCancel` | `取消` | `Cancel` |
| `skFieldName` | `名字` | `Name` |
| `skFieldDesc` | `说明` | `Description` |
| `skFieldInstructions` | `做法` | `Instructions` |
| `skDescPlaceholder` | `一句话，让它据此判断什么时候该用这个技能` | `One line the worker uses to decide when this applies` |
| `skSave` | `保存技能` | `Save skill` |
| `skNoneYet` | `还没有技能 ——` | `No skills yet —` |
| `skNoneYetHow` | `教它第一个技能，比如「帮我准备周一的进度汇报」。` | `teaches your worker its first one, like "prepare my Monday status report".` |
| `skShowFolder` | `显示文件夹` | `Show folder` |
| `skOn` | `开` | `On` |
| `skNoDescription` | `没有说明` | `no description` |
| `skBundledFiles` | `附带文件：` | `Bundled files:` |

`Skills` 那个 `<h2>` 和它下面那句 lede 不进这张表 —— Step 1 的 `skills` / `skillsSub` 已经覆盖了，`PanelHead` 用的就是它俩。

**留下例外，写清楚为什么：** `aria-label` 里的 `${row.name} enabled` 和 `Delete ${row.name}` 保持英文 —— `skills-settings.spec.ts` 用它们定位，且它们是无障碍标签不是可见文案。在代码里注明：

```tsx
              // aria-label 保持英文：它是给读屏和测试用的稳定句柄，不是可见文案。
```

- [ ] **Step 5: 清 `zh-text.ts` 的死条目**

改完之后重新提取，比对出真正没人用的条目再删：

```bash
cd surfaces/gui && node ../../packaging/check_i18n_text.mjs --list > /tmp/after.txt
```

**不要照着 `grep -i skill` 的结果删。** 这三条不是 `SkillsTab` 的，删了会让别处变英文：

- `"Loading skills…"`（70 行）→ `Composer.tsx:491`
- `"No matching skills."`（78 行）→ `Composer.tsx:493`
- `"Approving adds it to your skills on this computer — usable in every conversation from then on."`（33 行）→ 审批卡

- [ ] **Step 6: 守卫 —— 「能力」必须归零**

```bash
cd /Users/jiangxin/projects/marlo
grep -rn "能力" surfaces/gui/src --include="*.tsx" --include="*.ts" | grep -v "^.*://" 
```

预期：只剩源码注释里讲历史的那几处（`SkillsView.tsx` 顶部那段）。JSX 文本、`zh.ts` 的值、`zh-text.ts` 的值里一处都不能有。

再跑一次 `Abilities`：

```bash
grep -rn "Abilities\|abilities" surfaces/gui/src surfaces/gui/e2e
```

预期：`data-testid` 里还有（Task 7 改），i18n 键里为零。

- [ ] **Step 7: 跑，确认全绿**

```bash
cd surfaces/gui && npm test && npx tsc --noEmit && node ../../packaging/check_i18n_text.mjs
```

- [ ] **Step 8: 提交**

```bash
cd /Users/jiangxin/projects/marlo
git add surfaces/gui/src packaging
git commit -F - <<'EOF'
i18n: 「能力」从界面上消失，只留「技能」

abilities* 那组键并进 sk*；scSavesToSkills 去掉「设置 ▸」——
那个路径不存在了；PersonaView 的「内置能力」改成「内置工具」，
它指的是 tools 不是 skills，是第三个占用这个词的地方。

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
```

---

### Task 7: e2e 收尾 —— testid 改名，两条旧路重写

**Files:**
- Modify: `surfaces/gui/src/components/skills/*.tsx`（`data-testid` 改名）
- Delete: `surfaces/gui/e2e/skills-catalog-door.spec.ts`
- Create: `surfaces/gui/e2e/skills.spec.ts`
- Modify: `surfaces/gui/e2e/skills-settings.spec.ts`

**Interfaces:**
- Consumes: `e2e/fixtures.ts` 里已有的 `/v1/skills` 假后端（580-581 行两条种子数据，940-966 行的 GET/POST/PATCH/DELETE 分发）
- Produces: `data-testid` 一律 `skill-*` / `skills-*` 前缀

- [ ] **Step 1: `data-testid` 改名**

| 旧 | 新 |
|---|---|
| `abilities-search` | `skills-search` |
| `abilities-translated` | `skills-translated` |
| `abilities-error` | `skills-error` |
| `abilities-results` | `skills-results` |
| `abilities-more` | `skills-more` |
| `abilities-empty` | `skills-empty` |
| `abilities-list` | `skills-list` |
| `ability-{name}` | `skill-{name}` |
| `ability-detail` | `skill-detail` |

`catalog-{name}` / `install-{name}` / `view-{name}` / `remove-{name}` 不动 —— 它们本来就没带「ability」。

单测里的 `getByTestId` 同步改（`SkillCatalog.test.tsx`、`InstalledSkills.test.tsx`、`SkillsView.test.tsx`）。

- [ ] **Step 2: 删掉 `skills-catalog-door.spec.ts`**

```bash
cd /Users/jiangxin/projects/marlo
git rm surfaces/gui/e2e/skills-catalog-door.spec.ts
```

它验的是「设置▸技能▸添加▸第四个门 → 跳到能力页」。那个门和那条路都没了，改不动，重写更省事 —— 换成下一步的 `skills.spec.ts`。

- [ ] **Step 3: 建 `e2e/skills.spec.ts`**

```ts
import { test, expect } from "./fixtures";

// 技能页 —— 账号菜单 ▸ 技能，唯一的一页。
//
// 2026-08-02 之前这里是两页：账号菜单的「能力」和设置里的「技能」，打的是同一个
// GET /v1/skills。这条测试盯着合并之后的两件事：目录不用点菜单就在页面上，以及
// 「移除」真的能移除（那个按钮以前打的是后端不存在的路由，点了等于没点）。

const openSkills = async (page: import("@playwright/test").Page) => {
  await page.goto("/");
  await page.getByTestId("account-row").click();
  await page.getByRole("button", { name: "Skills", exact: true }).click();
};

test("skills: 已装列表和目录在同一页上，不用先点菜单", async ({ page }) => {
  await openSkills(page);

  // 上半页：装了的（fixtures 种了两条）。
  await expect(page.getByTestId("skill-weekly-report")).toBeVisible();
  await expect(page.getByTestId("skill-html-to-markdown")).toBeVisible();

  // 下半页：目录搜索框常驻 —— 0e1b2a0 定过，没搜索时也要有列表。
  await expect(page.getByTestId("skills-search")).toBeVisible();

  // 「添加」菜单剩三个门，第四个（浏览目录）没了 —— 目录就在下面。
  await page.getByRole("button", { name: /Add skill/ }).click();
  await expect(page.getByText("Write it myself")).toBeVisible();
  await expect(page.getByText("Import a file")).toBeVisible();
  await expect(page.getByText("Create with Marlo")).toBeVisible();
  await expect(page.getByTestId("skills-browse-catalog")).toHaveCount(0);
});

test("skills: 点移除，技能真的没了", async ({ page }) => {
  // 【这条以前是不可能过的】移除打的是 POST /v1/skills/uninstall，后端没有
  // 这个路由，错误被吞掉，列表一刷新技能又回来。
  await openSkills(page);
  await expect(page.getByTestId("skill-weekly-report")).toBeVisible();

  // 两步删除：第一下上膛，第二下才真删。
  await page.getByTestId("remove-weekly-report").click();
  await expect(page.getByTestId("skill-weekly-report")).toBeVisible();
  await page.getByText("Confirm delete").click();

  await expect(page.getByTestId("skill-weekly-report")).toHaveCount(0);
});

test("skills: 设置里没有技能这一栏了", async ({ page }) => {
  // 一个词一个地方。设置里再出现「技能」就等于合并没做完。
  await page.goto("/");
  await page.getByTestId("account-row").click();
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await expect(page.getByRole("button", { name: "Skills", exact: true })).toHaveCount(0);
});
```

- [ ] **Step 4: 改 `skills-settings.spec.ts`**

只改入口 —— 断言全部保留（它覆盖的是 SKILLS-SPEC §9 journey 1，那些行为一条没变）。

文件名改成 `skills-manage.spec.ts`（不再是 settings 里的东西）：

```bash
cd /Users/jiangxin/projects/marlo
git mv surfaces/gui/e2e/skills-settings.spec.ts surfaces/gui/e2e/skills-manage.spec.ts
```

改 `openSkills` 助手（9-14 行），去掉走设置那两步：

```ts
const openSkills = async (page: import("@playwright/test").Page) => {
  await page.goto("/");
  await page.getByTestId("account-row").click();
  await page.getByRole("button", { name: "Skills", exact: true }).click();
};
```

顶部注释里的「Settings ▸ Skills as the management home」改成「账号菜单 ▸ Skills as the management home」。

- [ ] **Step 5: 跑 e2e**

```bash
cd surfaces/gui && npm run e2e -- skills
```

预期：`skills.spec.ts` 3 条 + `skills-manage.spec.ts` 2 条全过。

- [ ] **Step 6: 全量跑一遍**

```bash
cd surfaces/gui && npm test && npx tsc --noEmit && npm run e2e
cd /Users/jiangxin/projects/marlo && python -m pytest -q 2>&1 | tail -3
```

预期：前三条全绿。pytest **预期 5 failed** —— 那是本机预存的失败，与本计划无关；只要不多于 5 条就是没引入新问题。

- [ ] **Step 7: 提交**

```bash
cd /Users/jiangxin/projects/marlo
git add -A surfaces/gui
git commit -F - <<'EOF'
test: e2e 跟上合并 —— testid 统一 skill 前缀，两条旧路重写

skills-catalog-door 验的是「设置▸技能▸第四个门→跳能力页」，那条路
整个没了，换成 skills.spec.ts：目录常驻在页面上、移除真的能移除、
设置里不再有技能栏。

skills-settings 只换入口，断言一条没改 —— 它覆盖的行为没变。

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
```

---

## 完工验收

全部做完后逐条确认：

- [ ] `grep -rn "能力" surfaces/gui/src --include="*.tsx"` 只剩讲历史的源码注释
- [ ] `grep -rn "abilities\|Abilities" surfaces/gui/src surfaces/gui/e2e` 为零
- [ ] `surfaces/gui/src/components/skills/` 下四个文件，每个 300 行以内
- [ ] `AbilitiesView.tsx` / `SkillsTab.tsx` 已删
- [ ] 设置里剩四栏：通用 / 模型 / 技能人格 / 语音输入
- [ ] `npm test`、`npx tsc --noEmit`、`npm run e2e` 三绿
- [ ] `pytest` 不多于 5 failed（本机预存基准）
