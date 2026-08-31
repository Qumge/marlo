# 同步上游 openworker（211 个提交），并把 i18n 迁到上游那套 —— 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把 `upstream/main`（andrewyng/openworker，领先 211 个非 merge 提交）合进 marlo，并在合并**之前**把 GUI 的 i18n 迁到上游的 react-i18next 上 —— 让这次的冲突面从 72 个文件降到 23 个，并且让**以后每一次**上游改文案都不再产生 TSX 冲突。

**Architecture:** 三段。**Phase A 在合并之前**，在我们自己的树上把 49 个「因 i18n 而冲突」的文件改写成上游的 `t("key")` 形式 —— 两边的那些行变成逐字节相同，合并时自然消失，而且每一步都能跑测试、能提交、能回滚；这是这份计划的核心，不这么做就得在一个 72 文件的冲突态里改代码，那种状态下什么都跑不起来。**Phase B** 只解剩下的 23 个真功能冲突。**Phase C** 退役我们那套 i18n（连带构建期 transform 整条路），对账译文，回归走查。

**Tech Stack:** Python 3.10+ / FastAPI（sidecar）、React + TypeScript + Vite（GUI）、i18next + react-i18next、pytest、vitest、Playwright

**配套 spec:** 无独立 spec，背景写在本文「现在的数字」和「两个已经定了的决定」两节里。

**上一次同步的范本:** `git log -1 6710777`（上游 0.1.7，48 个提交 / 11 处冲突）。那条提交信息把每一处冲突的判断都写了下来，本次请照同样的密度写。

---

## 这份计划怎么用

- 从上到下做，任务之间有依赖。Phase A 的 8 个任务不能跳 —— Phase B 的工作量是建立在 Phase A 已经把 49 个文件压掉的前提上的。
- 每个任务末尾都有一次提交。提交信息用中文，写清楚**判断**而不只是**动作**（这个仓库的惯例，看 `git log` 就知道）。
- 遇到「这个上游行为和我们的产品决定冲突」时**停下来问 owner**，别自己定。已知的几处列在最后一节。
- 全部命令从仓库根目录起。Python 用 `.venv/bin/pytest`，GUI 用 `cd surfaces/gui && ...`。

---

## 现在的数字（2026-08-31 实测）

| | |
|---|---|
| 共同祖先 | `9702c86` |
| 上游最新 | `fb1bfc6` |
| 上游领先 | 211 个非 merge 提交（含 merge 共 250） |
| 我们领先 | 192 个非 merge 提交 |
| 上游改过的文件 | 341 |
| 我们改过的文件 | 311 |
| 双方都动过 | 102 |
| **试合并的真实冲突** | **72 个文件** |
| &nbsp;&nbsp;其中被上游 i18n 改造撞出来的 | **49** |
| &nbsp;&nbsp;真正的功能冲突 | **23** |
| 漂移分（`check_upstream_drift.py`） | 6327 |

上游这 211 个提交带进来的大件：permission modes / auto-approve 审阅者、project memory 与 board、Triage Lead、ChatGPT 订阅登录（OAuth PKCE）、31 个安全类 persona、`ocw` CLI 与 team-board MCP、0.2.0/0.2.1 两次发版，以及一批安全修复（附件鉴权、worker item 可见性、技能上传令牌收敛、session id 路径穿越、密钥文件私有创建、mcp 依赖抬到 >=1.28.1）。

---

## 两个已经定了的决定（owner 2026-08-31 拍板，不要再推翻）

**1. 全量合并 `upstream/main`，不是只挑安全修复。**
理由：要挑的安全修复正好落在分歧最重的 `app.py`（上游 34 提交）/ `manager.py`（48）/ `engine.py`（30）上，单独 cherry-pick 的解冲突成本和全量合并差不多，却拿不到新功能；而且漂移是复利，这次跳过下次更贵。

**2. i18n 迁到上游那套，中文以我们的为准。**
上游自己做了一套 react-i18next（`src/i18n.ts` + `src/locales/{en,zh}.json`，1654 键，221 处 `{{}}` 插值，64 个 `_one/_other` 复数），并把 72 个 GUI 文件里的英文字面量改写成了 `t("key")`。我们有自己的两套：按键索引的 `src/i18n/`（904 键，`useT()`）给我们自己写的组件用，按英文原文索引的 `zh-text.ts` + 构建期 JSX transform 给上游的 JSX 用。两边改写了同一批行，所以 49 个文件冲突。

迁过去之后：**第二条路（transform）整条可以删掉** —— 它存在的唯一理由是「上游的 JSX 里是生英文，我们一个字节都不想改」，而上游现在自己包完了。这一条本身就值这次迁移。

已在 `WorkspaceTrustPrompt.tsx` 上实测确认过机制成立：

```tsx
// 我们的（现在）                          // 上游的（目标）
import { useT } from "../i18n";           import { useTranslation } from "react-i18next";
const t = useT();                         const { t } = useTranslation();
t("wtSaveFailed")                         t("workspace_trust.save_failed")
<h2>Trust this workspace…</h2>            <h2>{t("workspace_trust.title")}</h2>   // 我们这行是生英文，靠 transform 翻
{t("wtKeepAsking")}                       {t("workspace_trust.keep_asking")}
```

改成右边之后，这些行和上游逐字节相同，合并时不再是冲突。

---

## Global Constraints

- **本机跑 pytest 的基线是 5 failed，不是 0。** 那 5 条（slack_relay / github_installs 的超时）在动手之前就是红的，与本次无关，**不要去修**。Task 1 会把基线存下来，之后每次比对的是「和基线相比多了哪几条」。
- **本机跑 e2e 必须绕代理：** `NO_PROXY="localhost,127.0.0.1" no_proxy="localhost,127.0.0.1" npm run e2e`。报 `Timed out waiting 120000ms from config.webServer` 就是没加，**不要去改 `playwright.config.ts`**。
- **i18n 基线只减不增。** `packaging/i18n_baseline.txt` 现在是**空的**（写死的英文 = 0），`tests/test_check_i18n.py::test_the_baseline_matches_what_the_scan_finds_today` 在 pytest 里守着它。上游带进来的英文一律**翻掉**，不许 `--rebaseline` 把它加回去。
- **品牌守卫不扫 `.json`，而且不在 CI 里。** `packaging/check_branding.py` 的 `SUFFIXES` 是 `{.ts,.tsx,.css,.rs,.py,.plist}`，且没有任何 workflow 调它。上游的 `locales/en.json` 和 `zh.json` 里各有 **38 处 OpenWorker**，照现状会**静默发给用户**。Task 4 专门堵这个洞。
- **给上游文件加新东西 → 开新文件。** 沿用 `AccountRow.tsx:10-12`、`api.qumge.ts:1-8` 写明的策略：新文件永不冲突。
- **`App.tsx` 结构不动。** 上游改得最勤（24 个提交），我们只改了 32 行，拆它的收益不抵风险 —— 这是既有决定，见 `check_upstream_drift.py` 末尾。
- **机密不进这个仓库。** marlo 是公开仓库；网关内部细节、密钥、内部 URL 一律留在 qumg 私有仓，这边只放指针。
- **不要用 `--rebaseline`、`-X ours`、`-X theirs` 这类"一键解决"。** 冲突是要人做判断的地方，批量选边等于把判断丢掉。

---

## 验证基线（下文所有「跑一遍验证」指的是这几条）

```bash
# 一次性：装开发环境（如果是新 clone / 新 worktree）
bash packaging/setup_dev_env.sh
cd surfaces/gui && npm ci && cd ../..

# Python
.venv/bin/pytest tests -q                      # 期望：和 Task 1 存下的基线一致（现在是 5 failed）

# GUI
cd surfaces/gui
npx tsc --noEmit                               # 期望：0 error
npm test                                       # vitest
NO_PROXY="localhost,127.0.0.1" no_proxy="localhost,127.0.0.1" npm run e2e
cd ../..

# 守卫（check_branding / check_icons 不在 CI 里，必须手动跑）
python3 packaging/check_i18n.py                # 写死的英文有没有【新增】
node packaging/check_i18n_text.mjs             # 上游 JSX 的英文翻了没（Phase C 之后退役）
python3 packaging/check_branding.py            # 界面上有没有跑出「OpenWorker」
python3 packaging/check_icons.py
python packaging/check_model_matrix.py
python3 packaging/check_upstream_drift.py      # 要 upstream remote；输出是给人看的，不是通过/失败
```

---

## 文件结构：这次会动到什么

**Phase A 新增/引入（来自上游，尽量逐字节相同）**
- `surfaces/gui/src/i18n.ts` —— 上游的 react-i18next 初始化
- `surfaces/gui/src/locales/en.json`、`zh.json` —— 上游的 1654 键目录，**中文值以我们的为准**
- `surfaces/gui/src/i18n.test.ts` —— 上游的键对齐/插值对齐测试
- `surfaces/gui/src/test-setup.ts` —— vitest 里同步初始化 i18n
- `surfaces/gui/src/i18nTyped.d.ts` —— **我们新加的**，把 `en.json` 声明成 i18next 的资源类型，保住「键写错构建就红」这条性质

**Phase A 改名（纯机械，为了消掉模块解析歧义）**
- `surfaces/gui/src/i18n/` → `surfaces/gui/src/legacyI18n/`（连带 72 处 import）

**Phase C 删除（第二条路整条）**
- `surfaces/gui/i18n-transform.ts`(30)、`surfaces/gui/i18n-jsx.mjs`(232)
- `surfaces/gui/src/legacyI18n/`（`index.ts` 72、`en.ts` 1084、`zh.ts` 1005、`zh-text.ts` 331、`tx.ts` 32、`no-english.ts` 22 及其测试）
- `packaging/check_i18n_text.mjs`(155)、`surfaces/gui/e2e/i18n-transform.spec.ts`(76)
- `surfaces/gui/src/components/connectors/ToolsDisclosure.i18n.test.tsx`(59)
- `vite.config.ts` / `vitest.config.ts` 里的 `i18nText()` 插件挂载
- `.github/workflows/ci.yml` 里的「i18n — 上游 JSX 的英文有没有中文」这一步

**Phase B 要动手解的 23 个功能冲突**
```
配置/文档   .gitignore  pyproject.toml  README.md  coworker/personas/builtin/ops.md
Python      coworker/{agent,catalog,engine,events,inbox}.py
            coworker/server/{app,manager}.py   tests/test_engine.py
GUI         surfaces/gui/src/{api.ts,types.ts,itemsFromMessages.ts,styles.css}
e2e         surfaces/gui/e2e/fixtures.ts + automations-manage / automations-quickstart /
            boot / mcp-oauth / settings / sidebar-account / usage-chip 七个 spec
```

---

# Phase 0 —— 准备

### Task 1: 工作区、分支、基线快照

**Files:**
- Create: `/private/tmp/marlo-upstream-sync/`（worktree）
- Create: `docs/superpowers/plans/2026-08-31-upstream-sync-baseline.txt`

**Interfaces:**
- Consumes: 无
- Produces: 分支 `chore/upstream-sync-0.2.x`；一份合并**之前**的测试基线，Phase B/C 的「有没有引入回归」全部以它为准。

- [ ] **Step 1: 清掉两个残留 worktree 和分支**

`feat/upstream-memory-and-ask` 和 `chore/upstream-security-and-compat` 都已经并回 main（`git rev-list --count main..<branch>` 都是 0），它们的 worktree 目录已经被删了但记录还在（`prunable`）。

```bash
cd /Users/jiangxin/projects/marlo
git worktree prune
git worktree list                       # 期望：只剩主检出这一行
git branch -d feat/upstream-memory-and-ask chore/upstream-security-and-compat
```

- [ ] **Step 2: 拉上游，确认数字对得上**

```bash
git fetch upstream --prune
git rev-list --count HEAD..upstream/main            # 期望 250 上下（会随上游继续增长）
git merge-base HEAD upstream/main                   # 期望 9702c86…
python3 packaging/check_upstream_drift.py | tee docs/superpowers/plans/2026-08-31-drift-before.txt
```

如果 `merge-base` 不再是 `9702c86`，说明期间有人已经合过一次 —— **停下来问 owner**，本计划的所有数字都要重算。

- [ ] **Step 3: 建 worktree 和分支**

```bash
git worktree add /private/tmp/marlo-upstream-sync -b chore/upstream-sync-0.2.x main
cd /private/tmp/marlo-upstream-sync
bash packaging/setup_dev_env.sh
cd surfaces/gui && npm ci && npx playwright install --with-deps chromium && cd ../..
```

之后所有命令都在 `/private/tmp/marlo-upstream-sync` 下跑。

- [ ] **Step 4: 存下合并前的基线**

```bash
{
  echo "=== pytest（合并前）==="
  .venv/bin/pytest tests -q 2>&1 | tail -20
  echo "=== vitest（合并前）==="
  (cd surfaces/gui && npm test 2>&1 | tail -15)
  echo "=== e2e（合并前）==="
  (cd surfaces/gui && NO_PROXY="localhost,127.0.0.1" no_proxy="localhost,127.0.0.1" npm run e2e 2>&1 | tail -15)
} | tee docs/superpowers/plans/2026-08-31-upstream-sync-baseline.txt
```

**期望：pytest 5 failed（预存），vitest 全绿，e2e 全绿。** 如果 e2e 报 `Timed out waiting 120000ms from config.webServer`，是漏了 `NO_PROXY`，不是配置坏了。如果这一步就有基线之外的红灯，**先停下来问 owner**，不要带着未知的红灯进合并。

- [ ] **Step 5: 提交**

```bash
git add docs/superpowers/plans/
git commit -m "chore: 上游同步的基线快照与漂移报告（合并前）"
```

---

# Phase A —— 合并之前把 i18n 迁过去

> Phase A 全程**不碰** `upstream/main`，只在我们自己的树上改。每个任务结束时 `npx tsc --noEmit` 和 `npm test` 必须是绿的。

### Task 2: 我们的 i18n 模块改名 `legacyI18n`

**为什么先做这个：** 上游的文件是 `src/i18n.ts`，我们的是 `src/i18n/index.ts`。TypeScript 和 Vite 解析 `./i18n` 时**文件优先于目录**，所以上游那份一旦进来，我们那 72 处 `from "../i18n"` 会集体指到上游模块上（它导出的是 `initI18n`/`SUPPORTED_LANGS`，没有 `useT`）—— 72 个文件同时编译不过。改名把这个歧义彻底消掉，两套系统就能并存到迁移做完为止。

**Files:**
- Rename: `surfaces/gui/src/i18n/` → `surfaces/gui/src/legacyI18n/`
- Modify: 72 处 import（机械替换）
- Modify: `surfaces/gui/vite.config.ts`、`surfaces/gui/vitest.config.ts`、`packaging/check_i18n_text.mjs`、`packaging/check_i18n.py`（如有写死路径）

**Interfaces:**
- Consumes: 无
- Produces: `import { useT } from "../legacyI18n"` —— Task 5-7 逐个把它换成 `useTranslation`。

- [ ] **Step 1: 改名 + 机械替换 import**

```bash
cd surfaces/gui/src
git mv i18n legacyI18n
cd ..
# ../i18n  ../../i18n  ../i18n/en  ../../i18n/no-english …
grep -rlE 'from "(\.\./)+i18n(/|")' --include='*.ts' --include='*.tsx' src \
  | xargs sed -i '' -E 's#from "((\.\./)+)i18n(/|")#from "\1legacyI18n\3#g'
# ./i18n（src 根下的文件）
grep -rlE 'from "\./i18n(/|")' --include='*.ts' --include='*.tsx' src \
  | xargs sed -i '' -E 's#from "\./i18n(/|")#from "./legacyI18n\1#g'
cd ../..
```

`i18n-jsx.mjs` 的 import 写作 `from "../../i18n-jsx.mjs"`，`i18n` 后面既不是 `/` 也不是 `"`，正则不会碰它 —— 这是刻意的。

- [ ] **Step 2: 补掉写死路径的地方**

```bash
grep -rn 'src/i18n\|"\./i18n\|/i18n/' --include='*.ts' --include='*.mjs' --include='*.py' \
  surfaces/gui/vite.config.ts surfaces/gui/vitest.config.ts surfaces/gui/i18n-transform.ts \
  surfaces/gui/i18n-jsx.mjs packaging/check_i18n.py packaging/check_i18n_text.mjs
```

把找到的 `src/i18n` 改成 `src/legacyI18n`。

- [ ] **Step 3: 验证没有漏网**

```bash
grep -rnE 'from "(\.\./|\./)+i18n"' --include='*.ts' --include='*.tsx' surfaces/gui/src | wc -l
# 期望：0
```

- [ ] **Step 4: 跑验证**

```bash
cd surfaces/gui && npx tsc --noEmit && npm test && cd ../..
.venv/bin/pytest tests/test_check_i18n.py -q
node packaging/check_i18n_text.mjs
```

期望全绿。这一步**一个字符串都没改**，红了就是替换伤到了别的东西。

- [ ] **Step 5: 提交**

```bash
git add -A
git commit -m "refactor(i18n): 我们那套改名 legacyI18n —— 给上游的 src/i18n.ts 让出解析优先级

上游把 i18n 放在 src/i18n.ts（文件），我们的在 src/i18n/index.ts（目录）。
TS 与 Vite 解析 './i18n' 时文件优先于目录，两份并存时我们那 72 处 import
会集体指到上游模块上。改名是为了让两套能并存到迁移做完，不是重构。

纯机械替换，没有改任何一条文案。"
```

---

### Task 3: 引入上游的 i18n runtime，并把键的类型安全接回来

**Files:**
- Create（取自上游）: `surfaces/gui/src/i18n.ts`、`src/locales/en.json`、`src/locales/zh.json`、`src/i18n.test.ts`、`src/test-setup.ts`
- Create（我们自己写）: `surfaces/gui/src/i18nTyped.d.ts`
- Modify: `surfaces/gui/package.json`、`surfaces/gui/src/main.tsx`、`surfaces/gui/vitest.config.ts`

**Interfaces:**
- Consumes: Task 2 腾出来的 `./i18n` 解析位
- Produces: `useTranslation()` 可用；`t("不存在的键")` 会被 `tsc` 报错（靠 `i18nTyped.d.ts`）。

- [ ] **Step 1: 把上游那几个文件原样取过来**

```bash
git checkout upstream/main -- \
  surfaces/gui/src/i18n.ts \
  surfaces/gui/src/locales/en.json \
  surfaces/gui/src/locales/zh.json \
  surfaces/gui/src/i18n.test.ts \
  surfaces/gui/src/test-setup.ts
```

- [ ] **Step 2: 装依赖**

```bash
cd surfaces/gui
npm i i18next@^26.3.6 react-i18next@^17.0.11
cd ../..
```

版本对齐上游的 `package.json`；`package-lock.json` 会一起变，一并提交。

- [ ] **Step 3: `main.tsx` 里在首次渲染前初始化**

我们的 `main.tsx` 和上游只差这一处。加两行 —— 一个 import，一个把 render 包进 `initI18n().finally()`：

```tsx
import { initI18n } from "./i18n";

// Initialize i18n before the first render so t() resolves everywhere.
initI18n().finally(() => {
  ReactDOM.createRoot(document.getElementById("root")!).render(
    <React.StrictMode>
      <App />
    </React.StrictMode>,
  );
});
```

- [ ] **Step 4: vitest 挂上 setup**

`surfaces/gui/vitest.config.ts` 的 `test` 块里加一行（`i18nText()` 插件**先留着**，Phase C 才退役）：

```ts
  test: {
    environment: "jsdom",
    include: ["src/**/*.test.{ts,tsx}"],
    setupFiles: ["./src/test-setup.ts"],
  },
```

没有这一行，组件测试里的 `t("key")` 会渲染出键名本身，断言会以一种很难看懂的方式红。

- [ ] **Step 5: 把「键写错就构建红」接回来**

我们原来的 `en.ts` 是 TypeScript 目录，`Strings` 类型让写错的键在 `npm run build` 就红 —— 那段注释里写着「五次改名从这个仓库溜过去，因为唯一看着的是人在读 diff」。换成 JSON 之后这条性质默认没有了。新建 `surfaces/gui/src/i18nTyped.d.ts`：

```ts
// 键的类型安全：把 en.json 声明成 i18next 的资源类型，t("拼错的键") 就会被 tsc 拦下。
//
// 【为什么单独一个 .d.ts】原来的 en.ts 是 TypeScript，Strings 类型天然守着这件事
// （见 legacyI18n/en.ts 顶部：五次改名从这个仓库溜过去，因为唯一看着的是人在读
// diff）。迁到 JSON 之后这条性质会默认消失 —— 这个文件是把它接回来，不是锦上添花。
import "i18next";
import type en from "./locales/en.json";

declare module "i18next" {
  interface CustomTypeOptions {
    defaultNS: "translation";
    resources: { translation: typeof en };
    returnNull: false;
  }
}
```

`tsconfig.json` 需要 `resolveJsonModule: true`（上游已开，确认一下）。

- [ ] **Step 6: 验证类型守卫真的会红**

临时在任意组件里写一行 `t("definitely.not.a.key")`，跑 `npx tsc --noEmit`，**必须报错**；确认之后删掉这行。守卫要先看见它拦住一次，才算装好了 —— 这个仓库为「从来没人跑过的守卫」付过一次代价（`ci.yml` 里 check_i18n 那段注释）。

- [ ] **Step 7: 跑验证**

```bash
cd surfaces/gui && npx tsc --noEmit && npm test && cd ../..
```

上游的 `i18n.test.ts` 会跟着跑，它守四条：en/zh 键集对齐、插值占位符对齐、重要运行时键两边都有、中文重要串能完整插值。

- [ ] **Step 8: 提交**

```bash
git add -A
git commit -m "feat(i18n): 引入上游的 react-i18next，并把「键写错就红」接回来

上游的 locales 是 JSON，类型安全默认丢了。i18nTyped.d.ts 把 en.json 声明成
i18next 的资源类型补回来 —— 这不是锦上添花，legacyI18n/en.ts 顶上写着五次
改名就是从没有这条守卫的缝里溜过去的。

两套 i18n 从这一步开始并存，Task 5-7 逐文件迁完之后 legacyI18n 整个删掉。"
```

---

### Task 4: 品牌守卫覆盖 `.json`，并改掉 locales 里的 76 处 OpenWorker

**为什么现在做：** `check_branding.py` 的 `SUFFIXES` 是 `{.ts,.tsx,.css,.rs,.py,.plist}` —— **`.json` 不在里面**，而且这个守卫**不在任何 workflow 里**（全仓搜过，只有手动跑）。上游的 `en.json` / `zh.json` 各有 38 处 `OpenWorker`。照现状，这 76 条会直接显示在用户界面上，而所有绿灯都不会变红。我们的旧目录是 `.ts`，一直是被扫的 —— 这次迁移会**静默地**弄丢这份覆盖，所以补洞必须和迁移同一步走，不能排到后面。

**Files:**
- Modify: `packaging/check_branding.py`（`SUFFIXES`）
- Modify: `surfaces/gui/src/locales/en.json`、`zh.json`
- Modify: `.github/workflows/ci.yml`

**Interfaces:**
- Consumes: Task 3 引入的 locales
- Produces: `python3 packaging/check_branding.py` 扫 `.json`，且在 CI 里真的会跑。

- [ ] **Step 1: 先确认它现在确实看不见**

```bash
grep -c 'OpenWorker' surfaces/gui/src/locales/en.json surfaces/gui/src/locales/zh.json   # 各 38
python3 packaging/check_branding.py                                                       # 现在是绿的 —— 这就是问题
```

- [ ] **Step 2: `SUFFIXES` 加上 `.json`**

`packaging/check_branding.py:72`：

```python
SUFFIXES = {".ts", ".tsx", ".css", ".rs", ".py", ".plist", ".json"}
```

加的同时在旁边写清楚为什么（这个仓库的守卫都带着自己的历史）：

```python
# .json 是 2026-08-31 补的：i18n 迁到上游的 locales/*.json 之后，界面上每一条
# 文案都住在 JSON 里，而这个后缀表当时不含 .json —— 上游那两份各带 38 处
# OpenWorker，会一路绿灯发给用户。我们原来的 en.ts/zh.ts 是 .ts，一直被扫着，
# 这份覆盖是迁移【静默】弄丢的，不是本来就没有。
```

- [ ] **Step 3: 跑一遍，看它报出 76 条**

```bash
python3 packaging/check_branding.py     # 期望：非零退出，列出 en.json / zh.json 里的 OpenWorker
```

守卫要先看见它拦住一次。**报不出来就别往下走** —— 说明 `.json` 没真的进扫描（注意 `node_modules` / `package-lock.json` 要排除，`scanned` 计数不能爆炸）。

- [ ] **Step 4: 改掉那 76 条**

```bash
sed -i '' 's/OpenWorker/Marlo/g' surfaces/gui/src/locales/en.json surfaces/gui/src/locales/zh.json
python3 -c "import json;[json.load(open(f'surfaces/gui/src/locales/{l}.json')) for l in ('en','zh')];print('JSON ok')"
python3 packaging/check_branding.py     # 期望：绿
```

逐条看一眼替换结果：像 `"Starting OpenWorker…"` → `"Starting Marlo…"` 是对的；如果有句子因为改名读起来不通（比如提到上游项目本身的），单独改措辞，**不要放宽 `ALLOWED` 清单** —— 那张表一旦变便宜就没用了。

- [ ] **Step 5: 把品牌守卫放进 CI**

`.github/workflows/ci.yml` 的 `pytest` job 末尾加一步（它只要 Python，不要 npm）：

```yaml
      # 手动的守卫等于没有守卫 —— check_i18n_text 为这句话付过一次代价（见 gui-unit）。
      # check_branding 从来没进过 CI，而 2026-08-31 起界面文案全在 locales/*.json 里。
      - name: 品牌 — 界面上有没有跑出上游的产品名
        run: python3 packaging/check_branding.py
```

- [ ] **Step 6: 跑验证并提交**

```bash
.venv/bin/pytest tests -q                  # 和基线一致
cd surfaces/gui && npx tsc --noEmit && npm test && cd ../..
git add -A
git commit -m "security(brand): 品牌守卫扫 .json，并进 CI —— locales 里 76 处 OpenWorker

守卫的 SUFFIXES 里没有 .json，而且它从来不在任何 workflow 里。迁到上游的
locales/*.json 之后，界面上每一条文案都住在 JSON 里 —— 上游那两份各带 38 处
OpenWorker，两个洞叠起来的结果是：它们会一路绿灯发给用户。

我们原来的 en.ts/zh.ts 是 .ts，一直被扫着。这份覆盖是迁移静默弄丢的。

补洞的顺序是先让它报出那 76 条，再改 —— 没见它红过的守卫不算装好了。"
```

---

### Task 5: Tier 1 迁移 —— 15 个文件，我们的非 i18n 改动 ≤ 7 行

**分诊依据：** 对每个文件统计「我们相对共同祖先改了多少行」以及「其中不含 `useT` / i18n import / `t("` 的有多少行」。后者越少，说明我们对这个文件的改动几乎只有 i18n，直接取上游版本再把那几行贴回来最省事。

> 这是**分诊启发式，不是判决**。我们那些"靠 transform 翻译的生英文行"不含 `t(`，会被算进「非 i18n 行」里 —— 也就是说这个数偏保守，实际可能比看上去更容易。每个文件动手前都要用 Step 1 的命令亲眼确认。

**Files（非i18n行 / 总改动行）:**
```
1/4   surfaces/gui/src/components/Markdown.tsx
1/4   surfaces/gui/src/components/SelectMenu.tsx
1/4   surfaces/gui/src/components/TodoPanel.tsx
2/6   surfaces/gui/src/components/connectors/ConnectorsSection.tsx
3/9   surfaces/gui/src/components/connectors/CloudSignIn.tsx
4/10  surfaces/gui/src/components/connectors/AvailableDetail.tsx
4/10  surfaces/gui/src/components/RootRow.tsx
4/10  surfaces/gui/src/components/SearchModal.tsx
5/10  surfaces/gui/src/components/WorkspaceTrustPrompt.tsx
6/14  surfaces/gui/src/components/AddFolderForm.tsx
6/14  surfaces/gui/src/components/DirectoryRequestCard.tsx
6/15  surfaces/gui/src/components/SubscriptionsChip.tsx
7/16  surfaces/gui/src/components/AuditView.tsx
7/16  surfaces/gui/src/components/FolderGate.tsx
7/16  surfaces/gui/src/components/PlanCard.tsx
```

**Interfaces:**
- Consumes: Task 3 的 `useTranslation`、上游 locales 的键
- Produces: 这 15 个文件里 i18n 相关的行与 `upstream/main` 逐字节相同

- [ ] **Step 1: 对每个文件，先看清两边各改了什么**

```bash
F=surfaces/gui/src/components/Markdown.tsx
git diff 9702c86 HEAD -- $F          # 我们改了什么
git diff 9702c86 upstream/main -- $F # 上游改了什么
git show upstream/main:$F > /private/tmp/up.tsx
```

- [ ] **Step 2: 取上游版本，把我们的功能改动贴回去**

```bash
git checkout upstream/main -- $F
```

然后照 Step 1 里"我们改了什么"的那几行，逐条重新加回去。**只加功能改动，不要把 `useT` 加回来** —— 那正是要消掉的东西。

- [ ] **Step 3: 顺手核对中文（这一步不能省）**

这个文件用到的每个上游键，去 `surfaces/gui/src/locales/zh.json` 看它的中文值，和我们旧目录里对应的译文比：

```bash
grep -n "wtSaveFailed\|wtKeepAsking" surfaces/gui/src/legacyI18n/zh.ts
grep -n "Trust this workspace" surfaces/gui/src/legacyI18n/zh-text.ts
```

**不一致时以我们的为准**，直接改 `zh.json`。理由：我们的译文是逐条校过的（英式日期格式、"Mac" 后面那个空格、按用户想干的事而不是开发术语译分类名），上游那份是社区 PR 一次性产出的。把对账放在迁移的**当下**做，比留到最后一次性对 1654 条便宜得多，也不容易漏。

- [ ] **Step 4: 每个文件跑一次**

```bash
cd surfaces/gui && npx tsc --noEmit && npx vitest run src/components/Markdown.test.tsx && cd ../..
```

没有对应测试文件的就跑 `npm test` 全量。

- [ ] **Step 5: 每 5 个文件提交一次**

```bash
git add -A
git commit -m "i18n: Tier 1 迁到上游的 t() —— Markdown / SelectMenu / TodoPanel / ConnectorsSection / CloudSignIn

这几个文件我们只改了 i18n（非 i18n 改动 1-3 行），所以取上游版本再把那几行
贴回来。迁完之后这些行和 upstream/main 逐字节相同，合并时不再是冲突。

中文按键逐条核对过 zh.json，与我们旧目录不一致的以我们的为准。"
```

- [ ] **Step 6: 15 个做完之后，量一下冲突降了多少**

```bash
git merge-tree --write-tree --name-only HEAD upstream/main | tail -n +2 | sed '/^$/,$d' | wc -l
# 期望：从 72 降到 57 附近
```

**没降**说明迁移方式不对（多半是键名没用上游的，或者格式不一致）—— 停下来查，别继续往下堆。

---

### Task 6: Tier 2 迁移 —— 20 个文件，非 i18n 改动 8–40 行

**Files（非i18n行 / 总改动行）:**
```
8/19   connectors/AccountsDetail.tsx        9/21   connectors/CalendarDetail.tsx
12/28  connectors/HubSpotDetail.tsx        12/28   InboxItemCard.tsx
13/28  PersonaView.tsx                     14/33   connectors/GmailDetail.tsx
15/25  InboxView.tsx                       15/32   PersonasTab.tsx
17/27  MemorySection.tsx                   19/31   providers/ProviderSetup.tsx
20/42  GalleryModal.tsx                    22/49   ApprovalCard.tsx
22/51  connectors/GithubDetail.tsx         26/56   connectors/AddConnectionModal.tsx
30/68  connectors/SlackDetail.tsx          31/68   RightRail.tsx
33/49  Transcript.tsx                      34/61   InboxConfigure.tsx
35/61  connectors/SlackHowItWorks.tsx      38/64   AccessSection.tsx
```

**Interfaces:**
- Consumes: 同 Task 5
- Produces: 同 Task 5

- [ ] **Step 1: 换方向 —— 保留我们的文件，只换 i18n 调用**

Tier 2 的功能改动已经多到"贴回去"不划算了。改成在**我们的文件上**动手：

```bash
F=surfaces/gui/src/components/InboxItemCard.tsx
git show upstream/main:$F > /private/tmp/up.tsx   # 对照用，找上游给同一处 UI 起的键名
```

逐处替换：
```tsx
import { useT } from "../legacyI18n";      →  import { useTranslation } from "react-i18next";
const t = useT();                          →  const { t } = useTranslation();
t("ourKey")                                →  t("upstream.key")          // 键名从 /private/tmp/up.tsx 同一处 UI 找
<span>Raw English</span>                   →  <span>{t("upstream.key")}</span>   // 靠 transform 翻的生英文，一并包掉
```

- [ ] **Step 2: 带参数的调用要改成插值**

我们的目录里有 **72 个函数值**，调用点形如 `t("key")(args)`（全仓 89 处）。上游用 `{{}}` 插值和 `_one/_other` 复数：

```tsx
// 我们的
t("planSteps")(n)
// 上游
t("plan.steps", { count: n })          // 复数：zh.json 里是 plan.steps_one / plan.steps_other
t("greeting", { name: who })           // 普通插值：en.json 里写 "Hi {{name}}"
```

上游 `i18n.test.ts` 里的「插值占位符对齐」会守住 en/zh 两边 `{{}}` 一致 —— 改完跑它。

- [ ] **Step 3: 中文对账**

同 Task 5 Step 3：逐键比对 `zh.json` 与 `legacyI18n/zh.ts` / `zh-text.ts`，不一致以我们的为准。

- [ ] **Step 4: 每个文件跑一次**

```bash
cd surfaces/gui && npx tsc --noEmit && npx vitest run src/components/InboxItemCard.test.tsx && cd ../..
```

`ApprovalCard.tsx` 和 `Transcript.tsx` 有各自的测试（`ApprovalCard.test.tsx`、`Transcript.test.tsx`），一定要跑。

- [ ] **Step 5: 每 5 个文件提交一次**（提交信息格式同 Task 5 Step 5）

- [ ] **Step 6: 量一次**

```bash
git merge-tree --write-tree --name-only HEAD upstream/main | tail -n +2 | sed '/^$/,$d' | wc -l
# 期望：降到 38 附近
```

---

### Task 7: Tier 3 迁移 —— 13 个文件，非 i18n 改动 > 40 行

这一档是我们改得最重的地方，**上游也改得最勤**。做法同 Tier 2（在我们的文件上换调用），但**逐个文件单独提交**，因为每一个都可能需要判断。

**Files（非i18n行 / 总改动行 / 上游提交数）:**
```
55/62   UpdateBanner.tsx            —— 我们改了更新入口走 CDN 镜像、失败不再伪装成"已是最新"
68/85   ScheduledView.tsx
72/89   SessionIntro.tsx            —— 我们的开场问句
93/120  Composer.tsx        (上游 11) —— 我们的零余额闸门在这里，别碰判据
97/102  IntegrationsView.tsx
113/122 connectors/ConnectorsList.tsx —— 我们把连接列表合成了一个分组列表
135/168 App.tsx             (上游 24) —— 【结构不动】，只换 i18n 调用
140/176 AutomationQuickstart.tsx
169/202 Onboarding.tsx              —— 我们的首屏是"连接 Qumge"，不是厂商画廊
178/240 SettingsView.tsx    (上游  8)
204/261 ManageTabs.tsx
263/305 Sidebar.tsx         (上游  4)
315/330 ModelChecklist.tsx          —— 我们的网关模型浏览器在这里
```

**Interfaces:**
- Consumes: 同 Task 6
- Produces: 同 Task 6；`legacyI18n` 在这 48 个文件里不再被 import（第 49 个 `SkillsTab.tsx` 见 Step 4）

- [ ] **Step 1: 一个文件一轮，做法同 Task 6 Step 1-3**

- [ ] **Step 2: 这几处特别注意**

- **`App.tsx`** —— 只换 i18n 调用，**不要顺手重构**。它是上游改得最勤的文件（24 个提交），我们只改了 32 行，"拆它的收益不抵风险"是既有决定。
- **`Composer.tsx`** —— 零余额闸门的判据在服务端（`can_spend`），GUI 只渲染。迁 i18n 时不要碰任何条件判断。
- **`ModelChecklist.tsx`** —— 上游新加了 `openai-codex`（OAuth PKCE 订阅登录）这个 provider。我们的 qumge 和它是**两个并列条目，不是二选一** —— 这是上一次合并（`6710777`）就踩过的坑，文本合并会把两边交织在一起。
- **`Onboarding.tsx` / `SessionIntro.tsx`** —— 我们的文案是产品决定（首屏连 Qumge、开场问他的苦）。上游的键名可以用，**中文值一律以我们的为准**。

- [ ] **Step 3: 每个文件单独跑、单独提交**

```bash
cd surfaces/gui && npx tsc --noEmit && npm test && cd ../..
git add -A && git commit -m "i18n: SettingsView 迁到上游的 t()（178 行功能改动原样保留）"
```

- [ ] **Step 4: `SkillsTab.tsx` —— 第 49 个，是「我们删了、上游还在改」**

上面 48 个是"两边都在改同一个文件"。第 49 个不是：**我们把 `SkillsTab.tsx` 删了**（`7a0baa7` 把「能力」和「技能」合成一页，拆成了 `src/components/skills/` 下的 `SkillsView` / `InstalledSkills` / `SkillCatalog` / `SkillEditor`），而上游还在改它（433 行，两个提交：i18n 改造 + design system）。合并时这是一个 **delete/modify 冲突**，git 不会自动选边，会停下来问。

```bash
git show upstream/main:surfaces/gui/src/components/SkillsTab.tsx > /private/tmp/SkillsTab-upstream.tsx
git log --format='  %s' --no-merges 9702c86..upstream/main -- surfaces/gui/src/components/SkillsTab.tsx
```

**决定：保持我们的删除**（拆分是产品决定，不是重构洁癖）。但上游那两个提交里有东西要搬过来：

1. **i18n 键** —— 我们 `src/components/skills/` 下那四个文件现在用的是 `legacyI18n`，而且它们**不在冲突清单里**（上游没碰过这些新文件），所以 Phase A 不强制迁。但它们渲染的是**同一批 UI**，上游在 `SkillsTab.tsx` 里已经给这些串起好了键（`skills.*`）。迁的时候**复用上游的键**，别另起一套 —— 否则 locales 里会出现两份说同一件事的键，而 `i18n.test.ts` 的键集对齐守不住这种重复。具体迁移放在 Task 14 Step 1。
2. **design system** —— 上游 `Design system: bundled Inter + JetBrains Mono, 6-step type scale, bright canvas` 那个提交改了字号/字体类名。对照 `/private/tmp/SkillsTab-upstream.tsx`，把我们四个组件里对应的类名跟上，否则技能页会是全应用里唯一一处旧字号。

合并时（Task 9）遇到它，直接：

```bash
git rm surfaces/gui/src/components/SkillsTab.tsx
```

并在合并提交信息里写明"保持删除，上游的两个改动已搬进 components/skills/"。

---

### Task 8: Phase A 验收 —— 冲突面必须掉到 23 附近

**Files:** 无（只产出一份报告）

- [ ] **Step 1: 确认那 48 个文件里没有 legacyI18n 残留**

先把"因 i18n 而冲突"的清单原地重算一遍（不要依赖任何临时文件）：

```bash
B=$(git merge-base HEAD upstream/main)
# 当前还会冲突的文件
git merge-tree --write-tree --name-only HEAD upstream/main \
  | tail -n +2 | sed '/^$/,$d' | sort > /private/tmp/conflicts-now.txt
# 上游 i18n 改造碰过的文件
{ git show --name-only --format= 086be2a
  git show --name-only --format= 709a9ba
  git diff --name-only c104854^1 c104854; } | sort -u > /private/tmp/i18nfiles.txt
# 原始的 49 个（用共同祖先重算，与当前进度无关）
git merge-tree --write-tree --name-only "$B" upstream/main >/dev/null 2>&1 || true
comm -12 <(git diff --name-only "$B" upstream/main | sort) \
         <(git diff --name-only "$B" HEAD | sort) > /private/tmp/both.txt

# 检查：还在 import legacyI18n 的文件里，有没有属于 i18n 冲突集的
comm -12 <(grep -rln 'legacyI18n' surfaces/gui/src | sort) /private/tmp/i18nfiles.txt
# 期望：空。有输出就是漏迁了。
```

- [ ] **Step 2: 重新试合并**

```bash
git merge-tree --write-tree --name-only HEAD upstream/main \
  | tail -n +2 | sed '/^$/,$d' | tee /private/tmp/conflicts-after.txt | wc -l
```

**验收线：≤ 26 个文件**，且剩下的应该基本就是「文件结构」一节里列的那 23 个。

如果还剩 40+，**停下来问 owner**，不要硬着头皮进 Phase B —— Phase A 的全部意义就是这个数字。

- [ ] **Step 3: 跑全量验证并提交报告**

```bash
.venv/bin/pytest tests -q
cd surfaces/gui && npx tsc --noEmit && npm test \
  && NO_PROXY="localhost,127.0.0.1" no_proxy="localhost,127.0.0.1" npm run e2e && cd ../..
python3 packaging/check_branding.py && python3 packaging/check_i18n.py && node packaging/check_i18n_text.mjs

cp /private/tmp/conflicts-after.txt docs/superpowers/plans/2026-08-31-conflicts-after-phase-a.txt
git add -A
git commit -m "chore: Phase A 验收 —— 冲突面从 72 个文件降到 N 个

49 个"因 i18n 而冲突"的文件迁完，剩下的是真功能冲突。附冲突清单。"
```

---

# Phase B —— 合并

> 合并是一个原子提交，中途 `git commit` 不了。做法是 `git merge` 之后**分组解冲突**，每组解完 `git add` 保住进度、跑能跑的那部分测试，全部解完再 `git merge --continue`。中途别 `git merge --abort`，会把已解的全丢掉；真要重来先 `git stash` 或者记下已解的文件。

### Task 9: 起合并，解掉配置与文档类冲突

**Files:** `.gitignore`、`pyproject.toml`、`README.md`、`coworker/personas/builtin/ops.md`

- [ ] **Step 1: 起合并**

```bash
git fetch upstream --prune
git merge upstream/main
# 期望：CONFLICT，列出 ~23 个文件
git status --short | grep -E '^(UU|AA|DU|UD)' | tee /private/tmp/conflicted.txt
```

- [ ] **Step 2: `pyproject.toml` —— mcp 那一行两边都要**

上游把下界抬到 `mcp>=1.28.1`（PYSEC-2026-3481/3482/3483），我们那行是 `mcp>=1.1,<2`，上面压着一大段注释解释**上界不能省**（2026-07-28 mcp 2.0.0 一发布，CI 装了它，`streamablehttp_client` 被删，`coworker/mcp/client.py:21` 当场 import 失败，而且因为几乎每个测试模块都 import 这条链，CI 连着三次运行**一条测试都没真跑过**）。

**两个都要**，我们的注释整段保留：

```toml
    "mcp>=1.28.1,<2",
```

并在注释里补一句为什么下界动了：

```python
    # 【下界】2026-08-31 从 1.1 抬到 1.28.1：PYSEC-2026-3481/3482/3483，
    # 上游 deps 提交同步。上界的理由见下面那段，没有变。
```

其余上游改动照收：`ocw = "coworker.teams.cli:main"` 这个 console script、`personas/builtin/*/manifest.md` 和 `*/skills/*/SKILL.md` 两条包数据、`pythonpath = ["."]`。

- [ ] **Step 3: 依赖锁重新生成（带约束）**

我们有一把依赖锁（`aac03f8`、`766541c`）。抬了 mcp 下界之后要重新生成，**必须拿旧锁当约束**，否则 uv 会整份重新求解，把 cryptography / fastapi / openai 一起抬上去 —— 那种升级要单独一个提交，不能混在合并里。做法照 `6710777` 里 `ci.yml` 那条的记录。

- [ ] **Step 4: `.gitignore` / `README.md` / `ops.md`**

- `.gitignore` —— 两边的条目都留（我们有 `.claude/worktrees`、`.superpowers`）。
- `README.md` —— 上游重写成了 security-first（`5c799b0`）并加了 `SECURITY.md`。**结构可以跟上游走，但所有 Marlo 特有的段落必须保住**：Contributing 段区分 Marlo 与上游的 bug 路由（`a73c01c`）、有可下载构建这件事（`a700de4`）、开发环境那段的 `bash packaging/setup_dev_env.sh`。品牌一律 Marlo。上游新增的 `SECURITY.md` 照收，但里面的上报地址要改成我们的。
- `ops.md` —— 上游改了内容，我们只动过品牌/措辞，取上游版本再把品牌改回来。

- [ ] **Step 5: `SkillsTab.tsx` 的 delete/modify —— 保持删除**

git 会把它报成 `DU`（我们删了、上游改了），不会自动选边。判断在 Task 7 Step 4 里做过了，这里执行：

```bash
git status --short | grep -E '^(DU|UD)'          # 期望：SkillsTab.tsx
git rm surfaces/gui/src/components/SkillsTab.tsx
```

**执行之前确认 Task 7 Step 4 的两件事都搬完了**（i18n 键复用上游的、design system 的类名跟上），否则技能页会带着旧字号和一套重复的键上线。

- [ ] **Step 6: 标记已解**

```bash
git add .gitignore pyproject.toml README.md coworker/personas/builtin/ops.md uv.lock
.venv/bin/pip install -e ".[dev]"      # 依赖变了，重装
```

---

### Task 10: Python 侧冲突

**Files:** `coworker/{agent,catalog,engine,events,inbox}.py`、`coworker/server/{app,manager}.py`、`coworker/secrets.py`、`tests/test_engine.py`

**上游在这些文件里干了什么（先读一遍再动手）：**
```
app.py     (34 提交)  附件读取鉴权、worker item 可见性、auto-title 改到 turn 开始、Recents 顺序
manager.py (48 提交)  首次接触改走 ask_user、auto-title、team wake、staffing gate、digests
engine.py  (30 提交)  approval provenance 持久化、auto-approve 5 连拒断路器、reviewer 跟随模型切换
agent.py   (17 提交)  project identity（binding > git > path）、toolset 去重、windowed reader
catalog.py ( 2 提交)  toolset 去重、universal scratch
events.py  ( 3 提交)  propose_work_items 闸门、team wake 渲染成卡片
inbox.py   ( 1 提交)  给 coworker 真实工具链，不再静默跳过
secrets.py ( 1 提交)  密钥文件私有创建，不再事后 chmod（#143）
```

**我们在这些文件里的东西（不能丢）：**
- `secrets.py` —— 状态目录从 `coworker` 改名 `marlo`，带一次迁移（`98a29c6`，`tests/test_state_dir_migration.py` 守着）
- `app.py` —— Qumge 的四个路由做成了 APIRouter（`b9dd3e5`）、设备码授权搬进了自己的文件（`8658872`）
- `manager.py` —— 设备码登录做成了 mixin（`483fe22`）
- `engine.py` —— 对话里的授权卡片（`e8be3ea`）、connector_requester（`1329d3f`）
- `agent.py` —— 开场问句（`44c4d11`）、技能搜索与安装（`e74d500`）、改文件是整文件重写不是打补丁（`85bc781`）

- [ ] **Step 1: `secrets.py` —— 两边都要，而且顺序有讲究**

上游的修复是"创建时就私有，不要事后 chmod"；我们的是状态目录改名 + 迁移。两者不冲突，但**迁移过来的旧文件也必须是私有权限** —— 上游的修复只管新建。迁移那段要跟着补一次权限收紧，否则从 `~/.config/coworker` 搬过来的 `.env` 会带着旧权限落地。

写一条测试钉住它，加到 `tests/test_state_dir_migration.py`：

```python
def test_migrated_secrets_land_private(tmp_path, monkeypatch):
    """从旧状态目录搬过来的文件也要是 0600 —— 上游的修复只管新建的那条路。"""
    old = tmp_path / "coworker"; old.mkdir()
    env = old / ".env"; env.write_text("K=v")
    env.chmod(0o644)                       # 旧目录里就是宽的
    # …触发迁移…
    assert (tmp_path / "marlo" / ".env").stat().st_mode & 0o077 == 0
```

- [ ] **Step 2: 上游新代码里的硬编码路径**

上游有若干处直接拼 `~/.config/coworker` / `%APPDATA%\coworker`（`secrets.py:33-44`、`manager.py:3335` 的注释）。合并后**全仓搜一遍**，凡是绕过我们 helper 自己拼路径的都要改：

```bash
grep -rn '\.config.*coworker\|APPDATA.*coworker' coworker/ | grep -v '迁移\|migration'
```

漏一处的后果是：用户的密钥写到一个界面永远读不到的目录里。

- [ ] **Step 3: 其余几个文件 —— 逐 hunk 判断，不要批量选边**

原则（上一次合并总结出来的）：**大多数冲突不是二选一，两边都要。** 上游加的是新功能，我们加的是并列的另一件东西，文本合并只是把它们交织在了一起。真正需要做取舍的是"同一个行为两边定义不同"的地方 —— 那种要停下来判断，并把判断写进提交信息。

- [ ] **Step 4: `tests/test_engine.py` —— 断言跟着行为走**

上游改了 engine 的 approval 语义（provenance、断路器）。我们的测试如果断言的是旧语义，**改断言，不要改产品行为**；如果发现上游的新语义和我们的授权卡片打架，**停下来问 owner**。

- [ ] **Step 5: 跑 Python 侧（GUI 还在冲突态，跑不了）**

```bash
.venv/bin/pytest tests -q
```

期望：和 Task 1 的基线相比不多红。上游新增的测试会一起跑，这时候可能会红一批 —— 逐条看是"我们没接上"还是"上游自己的测试依赖了我们改掉的东西"。

- [ ] **Step 6: 标记已解**

```bash
git add coworker/ tests/
```

---

### Task 11: GUI 侧冲突

**Files:** `surfaces/gui/src/{api.ts,types.ts,itemsFromMessages.ts,styles.css}`

```
api.ts    (上游 29 提交)  composer 附件菜单、reviewer cache token、订阅登录面板、文件浏览器
types.ts  (上游 18 提交)  approval provenance、reviewer 迟疑、auto-approve 说明
styles.css(上游 28 提交)  Auto-Approve 横幅、topbar/transcript 调整、MCP 失败提示
```

我们在这些文件里的：Qumge 客户端调用已经搬到了 `api.qumge.ts`（`2fe6693`），所以 `api.ts` 里我们的残留只剩几行；`types.ts` 有 Qumge 账号/余额的类型；`styles.css` 有我们的品牌样式和几处对齐修复。

- [ ] **Step 1: 逐 hunk 解，原则同 Task 10 Step 3**

- [ ] **Step 2: `styles.css` 特别注意**

我们改过的几处是**视觉修复**（菜单栏图标小一号、一行里并排控件定死同高、模态框标题贴着分隔线、bundle 标题贴住上面的卡片）。上游改了大量布局。解完之后这几处要**用眼睛看**，不能只看编译过没过 —— 它们本来就是编译不出来的问题。

- [ ] **Step 3: 跑 GUI**

```bash
cd surfaces/gui && npx tsc --noEmit && npm test && cd ../..
```

- [ ] **Step 4: 标记已解**

```bash
git add surfaces/gui/src/
```

---

### Task 12: e2e 冲突

**Files:** `surfaces/gui/e2e/fixtures.ts`（上游 38 提交）+ `automations-manage` / `automations-quickstart` / `boot` / `mcp-oauth` / `settings` / `sidebar-account` / `usage-chip` 七个 spec

我们的 Qumge 假状态和假路由已经搬出 `fixtures.ts`（`63b9aa5`），所以我们在里面的残留不多。

- [ ] **Step 1: 逐 hunk 解**

- [ ] **Step 2: 上游自己红着的用例，先去干净的上游树上验一遍**

上一次合并踩过：`usage-chip` 的「Settings toggle」在**干净的 `upstream/main` 上也是红的**（它中途 `page.goto("/")` 重载，新开的 WebSocket 没让 fixture 的假 agent 重新武装）。这次遇到红的用例，先建一个临时 worktree 在纯上游上跑一遍：

```bash
git worktree add /private/tmp/marlo-upstream-check upstream/main
cd /private/tmp/marlo-upstream-check/surfaces/gui && npm ci && npx playwright install chromium
NO_PROXY="localhost,127.0.0.1" no_proxy="localhost,127.0.0.1" npx playwright test e2e/usage-chip.spec.ts
```

**是上游本来就红的** → skip 掉并写明理由，能确定成立的那一半移到我们自己的新文件里（上游文件每改一行，下次合并就多一处要人判断的地方）。
**是我们合坏的** → 修。

- [ ] **Step 3: 标记已解**

```bash
git add surfaces/gui/e2e/
```

---

### Task 13: 落合并提交，跑全量

- [ ] **Step 1: 确认没有残留冲突标记**

```bash
git status --short | grep -E '^(UU|AA|DU|UD)'      # 期望：空
grep -rn '^<<<<<<<\|^>>>>>>>\|^=======$' --include='*.py' --include='*.ts' --include='*.tsx' \
  --include='*.css' --include='*.json' --include='*.toml' coworker surfaces packaging tests
# 期望：空
```

- [ ] **Step 2: 全量验证**

```bash
.venv/bin/pytest tests -q
cd surfaces/gui && npx tsc --noEmit && npm test \
  && NO_PROXY="localhost,127.0.0.1" no_proxy="localhost,127.0.0.1" npm run e2e && cd ../..
python3 packaging/check_i18n.py
node packaging/check_i18n_text.mjs
python3 packaging/check_branding.py
python3 packaging/check_icons.py
python packaging/check_model_matrix.py
```

**和 Task 1 的基线比。** 红的每一条都要有结论：是上游带进来的、是我们合坏的、还是基线里本来就有的。没结论就不要落提交。

- [ ] **Step 3: 落合并提交**

提交信息照 `6710777` 的密度写：带进来了什么、**每一处冲突的判断是什么**、守卫抓到了什么、最后的测试数字。这份记录是下一个人唯一能读到的东西。

```bash
git merge --continue
```

---

# Phase C —— 收尾

### Task 14: 退役第二条路，删掉 legacyI18n

**为什么现在能删：** 构建期 transform 存在的唯一理由是"上游的 JSX 里是生英文，我们一个字节都不想改"。上游现在自己全包完了，这条路没有服务对象了。

**Files:**
- Modify: 剩下还在 import `legacyI18n` 的文件（Phase A 只迁了 49 个冲突文件，全仓共 72 个）
- Delete: `surfaces/gui/src/legacyI18n/`、`surfaces/gui/i18n-transform.ts`、`i18n-jsx.mjs`、`packaging/check_i18n_text.mjs`、`surfaces/gui/e2e/i18n-transform.spec.ts`、`src/components/connectors/ToolsDisclosure.i18n.test.tsx`
- Modify: `surfaces/gui/vite.config.ts`、`vitest.config.ts`、`.github/workflows/ci.yml`、`tests/test_check_i18n.py`

- [ ] **Step 1: 迁完剩下的文件**

```bash
grep -rln 'legacyI18n' surfaces/gui/src
```

做法同 Task 6，一批一提交。

- [ ] **Step 2: 确认 zh-text.ts 里的译文都已经落到 zh.json**

**这一步在删之前做，删了就找不回来了。** `zh-text.ts` 有 317 条按英文原文索引的中文。逐条确认它对应的 UI 现在走的是哪个上游键，以及 `zh.json` 里那个键的值是不是我们这条：

```bash
python3 - <<'PY'
import json, re, pathlib
zh = json.load(open("surfaces/gui/src/locales/zh.json"))
flat = {}
def walk(d, p=""):
    for k, v in d.items():
        walk(v, f"{p}{k}.") if isinstance(v, dict) else flat.setdefault(f"{p}{k}", v)
walk(zh)
have = set(flat.values())
src = pathlib.Path("surfaces/gui/src/legacyI18n/zh-text.ts").read_text()
missing = [m.group(2) for m in re.finditer(r'"((?:[^"\\]|\\.)*)":\s*"((?:[^"\\]|\\.)*)"', src)
           if m.group(2) not in have]
print(f"zh-text.ts 里没有落到 zh.json 的译文：{len(missing)}")
for t in missing[:40]: print(" ", t)
PY
```

输出不为空的，逐条落到 `zh.json` 对应的键上（或者确认那条 UI 上游已经删了）。

- [ ] **Step 3: 删**

```bash
git rm -r surfaces/gui/src/legacyI18n
git rm surfaces/gui/i18n-transform.ts surfaces/gui/i18n-jsx.mjs \
       packaging/check_i18n_text.mjs surfaces/gui/e2e/i18n-transform.spec.ts \
       surfaces/gui/src/components/connectors/ToolsDisclosure.i18n.test.tsx
```

- [ ] **Step 4: 解绑插件和 CI 步骤**

- `vite.config.ts`：去掉 `import { i18nText }` 和 `plugins: [i18nText(), react()]` 里的 `i18nText()`
- `vitest.config.ts`：同上（`setupFiles` 留着）
- `.github/workflows/ci.yml`：删掉「i18n — 上游 JSX 的英文有没有中文」这一步及其上面那段注释
- `tests/test_check_i18n.py`：`test_the_guards_survive_a_cp1252_console` 是扫 `packaging/check_*.py` 自动发现的，删掉 `.mjs` 不影响；确认一下没有别处写死了它的路径

- [ ] **Step 5: 跑验证并提交**

```bash
cd surfaces/gui && npx tsc --noEmit && npm test \
  && NO_PROXY="localhost,127.0.0.1" no_proxy="localhost,127.0.0.1" npm run e2e && cd ../..
.venv/bin/pytest tests -q
git add -A
git commit -m "refactor(i18n): 退役构建期 transform 整条路（-1800 行）

它存在的唯一理由是「上游的 JSX 里是生英文，我们一个字节都不想改」。上游自己
包完了，这条路没有服务对象了。删掉：transform、jsx 判据、zh-text 表、tx、
对账脚本、e2e，以及 CI 里那一步。

zh-text.ts 的 317 条译文在删之前逐条对过 zh.json，没落地的补齐了。"
```

---

### Task 15: 译文对账与守卫收口

**Files:** `surfaces/gui/src/locales/zh.json`、`surfaces/gui/src/i18n.test.ts`、`packaging/i18n_baseline.txt`

- [ ] **Step 1: 加一把「中文不能等于英文」的尺子**

上游的 `i18n.test.ts` 守的是**键集对齐**和**插值对齐** —— 一条中文值原样抄英文照样能过。我们这个 fork 的产品价值就在中文上，这个缺口要补。加到 `surfaces/gui/src/i18n.test.ts`：

```ts
// 键齐了不等于翻了 —— 一条值原样抄英文，上游那四条断言全绿。这个 fork 的产品
// 价值就在中文上，所以单独量一把「zh 的值不等于 en 的值」。
//
// 白名单是专名，不是"暂时没翻"的地方：加进去要写清楚为什么，那张表一旦变便宜
// 就没用了（改名守卫的注释里写着同一件事）。
const PROPER_NOUNS = new Set([
  "Marlo", "Qumge", "GitHub", "Slack", "Gmail", "HubSpot", "MCP", "OAuth", "PAT", "API",
]);

it("keeps Chinese values from being English copies", () => {
  const same: string[] = [];
  for (const [key, enVal] of Object.entries(flatten(en))) {
    const zhVal = flatten(zh)[key];
    if (typeof enVal !== "string" || typeof zhVal !== "string") continue;
    if (zhVal !== enVal) continue;
    if (PROPER_NOUNS.has(enVal.trim())) continue;
    if (!/[A-Za-z]{3}/.test(enVal)) continue;   // 数字、符号、单字母不算
    same.push(`${key}: ${enVal}`);
  }
  expect(same).toEqual([]);
});
```

- [ ] **Step 2: 先让它红，再改**

跑一遍，它应该会报出一批 —— 上游 `zh.json` 里没翻到位的、以及合并带进来的新键。逐条翻掉。**没见它红过的守卫不算装好了。**

- [ ] **Step 3: i18n 基线重新生成 —— 只减不增**

上游的组件现在都走 `t()`，写死的英文应该比合并前更少：

```bash
python3 packaging/check_i18n.py
```

**报出新增的写死英文 → 翻掉，不要 `--rebaseline`。** 基线现在是空的（0 条），合并之后只能还是 0 或者更少。如果发现基线文件需要变**大**才能过，那就是有英文没翻 —— 那是活没做完，不是基线该改。

- [ ] **Step 4: 跑验证并提交**

---

### Task 16: 回归走查 —— 我们的定制 × 上游新功能的交叉点

这些地方编译能过、测试能绿，但行为可能已经不对了。**用真的应用点一遍**（`cd surfaces/gui && npm run tauri:dev`）。

- [ ] **Step 1: Provider —— Qumge 和上游新的订阅登录并列**

上游加了 `openai-codex`（OAuth PKCE）。确认：设置 ▸ 模型里两个都在、都能进各自的登录流程、模型 id 路由到各自的能力矩阵（`c26d508` 那条修的就是这个）。

- [ ] **Step 2: 授权卡片 × 上游的 approval provenance / auto-approve**

我们有对话里的授权卡片（`request_connector` / `connector_requester`）；上游新加了 provenance 持久化、5 连拒断路器、reviewer 迟疑提示。确认两套卡片不打架，我们的设备码卡片还能印出验证码。

- [ ] **Step 3: 技能页 × 上游 SkillsTab 改动 + 技能上传令牌收敛**

我们把「能力」和「技能」合成了一页并拆成了三个组件；上游改了 SkillsTab 并收敛了 staged upload token（`e4d3953`）。确认目录搜索、一步安装 bundle、移除都还能用（`013326a` 修过"移除打的是后端没有的路由"）。

- [ ] **Step 4: 状态目录 × 上游新模块**

装一个干净的 profile，确认迁移还成立、上游新模块（`ocw` CLI、team-board MCP）写的也是 `marlo` 目录不是 `coworker`。

- [ ] **Step 5: 零余额闸门 × 上游 metering 改造**

零余额账号发消息，确认还是在**发送之前**拦住并保住草稿，402 还是那条带充值按钮的人话。

- [ ] **Step 6: 代理 × 上游新下载路径**

上游新增的下载（persona bundle、security corpora）走不走我们的代理检测（`392e151`、`e2b97bb`）。不走的话补上。

- [ ] **Step 7: 更新入口 × 上游 0.2.x 发版脚本**

确认更新清单还带 `macos-x64`（`6710777` 里补的洞），CDN 镜像入口还优先（`6a9208f`），失败还是会说话（`6b3dfd7`、`94c4cd1`）。

- [ ] **Step 8: 把走查结果写成一条提交**

发现的问题一个一提交修掉；没问题的也要留记录。

---

### Task 17: 版本、漂移报告、收尾

- [ ] **Step 1: 版本号**

版本住在 `surfaces/gui/src-tauri/tauri.marlo.conf.json`（overlay，`21cd141` 之后上游那份是字节相同的，所以**没有版本冲突**）。这次带进来的东西很多，升 minor：`0.7.7` → `0.8.0`。

- [ ] **Step 2: 重跑漂移报告，和合并前比**

```bash
python3 packaging/check_upstream_drift.py | tee docs/superpowers/plans/2026-08-31-drift-after.txt
diff docs/superpowers/plans/2026-08-31-drift-before.txt docs/superpowers/plans/2026-08-31-drift-after.txt
```

合并本身会把分数清零（共同祖先前移），有意义的是**结构性的变化**：`legacyI18n` 删掉之后，i18n 不再是漂移来源；`App.tsx` 应该还在榜首（这是决定，不是遗漏）。把这次的结论追加到脚本末尾「已知的、故意不动的」那一节。

- [ ] **Step 3: 全量验证最后一遍**（验证基线那一整段）

- [ ] **Step 4: 合回 main**

```bash
git checkout main
git merge --no-ff chore/upstream-sync-0.2.x
```

- [ ] **Step 5: 清理 worktree**

```bash
git worktree remove /private/tmp/marlo-upstream-sync
git worktree remove /private/tmp/marlo-upstream-check 2>/dev/null
git worktree prune
```

---

## 必须回来问 owner 的几处（不要自己定）

1. **上游的新功能对不对用户开。** permission modes / auto-approve 审阅者、Triage Lead、project memory 与 board、31 个安全 persona —— 合并会把它们全带进来。是直接开放，还是先藏起来，是产品决定。
2. **上游改了某个行为的语义，而这对我们不是中性的。** 上一次就有一例：上游把 MCP 同名冲突的优先级从「workspace 覆盖 global」翻成「global 赢」，而我们的 `qumge-skills` 写在 global，翻转之后受信任的仓库没法用同名条目顶掉它。这类要 owner 判断，判断要写进提交信息。
3. **新产品概念的中文怎么说。** "Triage Lead"、"provenance"、"board"、"scratch" 这些词的译法会定下来长期用，不要随手译。
4. **`SECURITY.md` 的上报地址。** 上游那份指向上游，我们要自己的。
5. **依赖大版本升级。** 解锁的时候如果 uv 想把 cryptography / fastapi / openai 一起抬上去 —— 那是单独一件事，单独一个提交，不要混进这次合并。

---

## 自查（写完这份计划时过的）

- **决定覆盖：** 两个已定决定（全量合并、迁上游 i18n）都有对应任务；72 个冲突文件全部落在某个任务的 Files 里（49 → Task 5/6/7，23 → Task 9/10/11/12）。
- **数字一致：** 分诊表 Tier 1 = 15、Tier 2 = 20、Tier 3 = 13，合 48；第 49 个是 `SkillsTab.tsx`（我们删了、上游还在改，delete/modify，Task 7 Step 4 单独处理）。48 + 1 = 49，与「因 i18n 冲突」的数字对得上；49 + 23 = 72，与试合并的冲突总数对得上。
- **顺序依赖：** Task 2（改名）必须在 Task 3（引入上游 runtime）之前，否则 72 处 import 集体指错；Task 14 Step 2（对账 zh-text）必须在 Step 3（删除）之前。
- **守卫都先红后绿：** Task 3 Step 6、Task 4 Step 3、Task 15 Step 2 都写了"先确认它会红"—— 这个仓库为"从来没人跑过的守卫"付过一次代价。
