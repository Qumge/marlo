# 「能力」与「技能」合并成一个词、一个页

日期：2026-08-02

## 问题

界面上有两个地方在说同一件事，用了两个词：

- **账号菜单 ▸ 能力** —— `surfaces/gui/src/components/AbilitiesView.tsx`（293 行，Marlo 自己写的，从 `1088de5` 起 5 次提交）
- **设置 ▸ 技能** —— `surfaces/gui/src/components/SkillsTab.tsx`（464 行，上游 `70e4610` #391 合进来的）

两者的已装列表**打的是同一个接口**：`api.ts` 里 `getSkills()`（631 行）和 `listSkills()`（1262 行）都是 `GET /v1/skills`，只是各写了一份类型。目录里装进来的技能走 `SkillStore.create`（`51d51fa`），所以两张列表里是同一批文件、同一个目录。

这不是叫法不一致，是同一份数据渲染了两遍。已经因此坏了三处：

1. **「移除」按钮是死的。** `AbilitiesView.tsx:118` 调 `uninstallSkill()` → `POST /v1/skills/uninstall`，**这个路由后端不存在**（`coworker/server/app.py:632` 的注释早就写明「没有 uninstall，上游的 DELETE /v1/skills/{name} 就是卸载，前端改调那个」，前端没改）。错误被 `.catch(() => {})` 吞掉，列表一刷新技能又回来。

它能活下来是因为**移除这条路从来没被测过**：`AbilitiesView.test.tsx` 的 `serve()` 助手里有个 `/v1/skills/uninstall` 分支（36-39 行），但 `opts.removed` 全文件只出现在那一次 push 里 —— 13 条测试没有一条传过它。那个分支是死代码，它让人以为移除被覆盖了。
2. **禁用状态在「能力」页看不见。** `InstalledSkill` 只取 `name` / `description`，丢掉了 `enabled`。在设置里关掉的技能，「能力」页照样显示成「已装」。
3. **设置 ▸ 技能 ▸ 添加 ▸ 浏览目录会把人甩出设置**（`App.tsx:1399` → `setSurface("abilities")`），正在用的那个抽屉没了。

第三个词还在别处：`PersonaView.tsx:139` 的「内置能力」（`zh-text.ts:38`）指的是**工具**，不是技能。

## 决定

1. **一个词：技能 / Skills。**「能力」从界面上完全消失。
2. **一个页：账号菜单 ▸ 技能。** 设置里的技能 tab 删掉。
3. **页面形态：上下两段**，上「已装」下「目录」，目录常驻。

选「技能」而不是「能力」：`zh-text.ts` 里已有 15 处「技能」；目录本身叫「Qumge 技能目录」—— 现在这一页叫「能力」，搜索框却写着「搜 Qumge 的技能目录…」（`zh.ts:644`），它自己都没统一；磁盘上是 `SKILL.md`；英文版 `Skills` 不用动。

落在账号菜单而不是设置：账号菜单是「Marlo 有什么」（收件箱 / 技能 / 外部连接），设置是「怎么配」（通用 / 模型 / 语音输入）—— 技能是内容不是参数。而且现在的跳转方向本来就是设置 → 账号菜单页。

目录常驻而不是收进菜单：`0e1b2a0`「没搜索时也有列表」是已经做过的决定 —— 用户要能自己看见目录里有什么。收进菜单等于推翻它。而且目录在同一页之后，「浏览目录」这个门自己就不需要了。

## 页面

```
┌──────────────────────────────────────────┐
│ 技能                            [+ 添加 ▾] │
│ 它干活时会照着做的做法。          [ 搜目录 ] │
├─ 已装 · 2 ─────────────────────────────────┤
│ weekly-report    📁2    ✏  🗑    ● 开       │
│ 每周一整理进度汇报                          │
│ pdf-fill         qumge  ✏  🗑    ○ 关       │
│ 填 PDF 表单                                 │
├─ Qumge 精选 ───────────────────────────────┤
│ invoice-parser           看看   [ 添加 ]    │
├─ marketing-growth ─────────────────────────┤
│ seo-audit                看看   [ 添加 ]    │
│                     [ 加载更多 ]            │
└──────────────────────────────────────────┘

[+ 添加 ▾] ── 自己写 / 导入文件 / 让 Marlo 做
```

「+ 添加 ▾」剩**三个门**。第四个门（浏览 Qumge 目录）删掉 —— 它是页面下半部分。

已装行同时具备 `SkillsTab` 的开关 / 编辑 / 文件夹 / 来源徽章，和 `AbilitiesView` 的完整描述换行（`SkillsTab.tsx:411` 的注释：截断会藏掉技能是干什么的）。

目录段保留：分类分组、Qumge 精选置顶、装前读正文、`abilitiesUntrusted` 那句隔离说明、`searched_as` 的翻译提示、加载更多。

## 文件划分

合并后 600+ 行，不放一个文件。拆成一组，每块一件事：

```
surfaces/gui/src/components/skills/
  SkillsView.tsx       页面外壳：标题、「+ 添加 ▾」菜单、错误条、notice 条、两段编排、5 秒轮询
  InstalledSkills.tsx  已装列表：开关 / 编辑 / 删 / 文件夹 / 来源徽章
  SkillCatalog.tsx     搜索框、分组结果、加载更多、正文预览弹层
  SkillEditor.tsx      「自己写」表单 + 「导入文件」预览卡
```

删除 `AbilitiesView.tsx`、`SkillsTab.tsx`。

`SkillsView` 持有 `rows` / `error` / `notice` 并向下传；`InstalledSkills` 和 `SkillCatalog` 只收 props 和回调，各自能单独测。

## 路由与入口

| 文件 | 改动 |
|---|---|
| `App.tsx:232` | `surface` 联合类型 `"abilities"` → `"skills"` |
| `App.tsx:219,222` | `SetTab` 去掉 `"skills"` |
| `App.tsx:1388` | `<AbilitiesView />` → `<SkillsView />` |
| `App.tsx:1399` | `onBrowseCatalog` 整个删掉 |
| `App.tsx:1370,1375` | `onOpenAbilities` / `abilitiesActive` → `onOpenSkills` / `skillsActive` |
| `SettingsView.tsx:56,72,141` | 删掉 `"skills"` tab（联合类型、TABS 行、渲染分支） |
| `AccountRow.tsx:157` | `t("abilities")` → `t("skills")`；图标 `sparkle` → `book`（跟原设置 tab 一致，`sparkle` 太泛） |
| `Sidebar.tsx:123` + 两份 test | prop 改名跟上 |
| `Icon.tsx:71` | 注释里的「(Settings ▸ Skills)」指的是删掉的那个 tab，改成「(账号菜单 ▸ 技能)」 |

`onCreateSkill`（`App.tsx:1400` 起，会开一个新对话并预填 composer）保留 —— 它是「让 Marlo 做」那个门，只是调用点从 `SettingsView` 移到 `SkillsView`。

## 数据层

`api.ts` 删三个东西：

- `getSkills()`（631）—— 和 `listSkills()` 是同一个 `GET /v1/skills`
- `InstalledSkill`（626）—— `SkillRow` 的子集
- `uninstallSkill()`（693）—— 打的是不存在的路由

已装列表统一走 `listSkills()` → `SkillRow`（带 `enabled` / `source` / `files` / `instructions`）。移除统一走 `deleteSkill()` → `DELETE /v1/skills/{name}`。

保留 `searchSkills()` / `skillDetail()` / `installSkill()` —— 这三个是「能力」页独有的、后端也确实有的。

顺带修好：已装行拿到 `enabled` 之后，关掉的技能不会再伪装成「已装」；`source` 徽章让 qumge 装来的和自己写的分得开。

`AbilitiesView.tsx:67` 的 5 秒轮询（让对话里装上的技能自己冒出来，不用重开页面）保留，挪进 `SkillsView`。

## 文案

**`zh.ts` / `en.ts`：** `abilities*` 那一组（21 个键，`zh.ts:639-657` + `897-898`）整体重命名为 `sk*`，并进已有的 `sk*` 块（`zh.ts:102-117`）。其中：

- `abilities: "能力"` → `skills: "技能"`
- `abilitiesSub` 要同时覆盖上下两段，改成：**「它干活时会照着做的做法。你可以自己加，它自己也会去找。」**
- `abilitiesFound`（`zh.ts:646`，"目录里的"）**已经没人用了**，直接删
- `scSavesToSkills`：「保存到 **设置 ▸** 技能」→「保存到技能」（`ApprovalCard.tsx:110`）—— 那个路径不存在了；英文同理 `"saves to Settings ▸ Skills"` → `"saves to Skills"`
- `en.ts:684 abilities: "Abilities"` 删掉，英文侧只留 `navSkills: "Skills"`

**`zh-text.ts`：** `"Built-in capabilities": "内置能力"` → **`"内置工具"`**（`PersonaView.tsx:139` 指的是 tools）。

**从 `zh-text.ts` 迁到 `zh.ts`：** `zh-text.ts` 按英文原文索引，存在的理由是「上游文件一个字节都不想改」（该文件头部注释）。合并之后这一页是我们的代码，文案该走 `zh.ts` 的键索引。

这是个有代价的取舍：以后上游改 Skills UI 得自己合。接受它，因为「不改一个字节」这个前提已经不成立 —— `51d51fa` 已经改过 `SkillsTab.tsx`（加第四个门），现在还要删那个门、删 `<h2>Skills</h2>`、换整个布局。

`zh-text.ts` 里 `SkillsTab` **独占**的条目删掉，共享的留着。**不要照着 `grep -i skill` 的结果删** —— `"Loading skills…"` 和 `"No matching skills."`（70、78 行）是 `Composer.tsx:491,493` 的技能选择器，`"Approving adds it to your skills…"`（33 行）是审批卡。删除清单用 `node packaging/check_i18n_text.mjs --list` 在改完之后重新提取，比对出真正的死条目。

## 测试

- **拆分保留** `AbilitiesView.test.tsx` —— 那 13 条测试是有价值的（offset 分页、翻译提示、正文预览、目录错误态、no-english 守卫），按新的文件划分拆成 `SkillCatalog.test.tsx`（目录相关 9 条）和 `InstalledSkills.test.tsx`（已装列表 3 条），空状态那条跟着 `SkillsView.test.tsx`。`serve()` 助手里的 `/v1/skills/uninstall` 死分支删掉，换成 `DELETE /v1/skills/{name}`
- **重写** `e2e/skills-catalog-door.spec.ts` —— 现在验的是「设置▸技能▸添加▸第四个门 → 跳到能力页」，那条路整个没了；改成验「技能页上目录段直接可见」
- **改** `e2e/skills-settings.spec.ts` —— 入口从设置改成账号菜单
- **改** `Sidebar.test.tsx` / `Sidebar.account.test.tsx` —— prop 改名
- **新增** e2e：**在技能页点「移除」，技能真的从列表里消失**。先写这条，它会红（证明 bug 在），改完变绿（证明修好了）
- **新增** 单测：已装行在 `enabled: false` 时显示「关」
- **新增** i18n 守卫：`no-english.ts` / `check_i18n_text.mjs` 跑通，且全仓 `grep "能力"` 在 `.tsx` / `zh.ts` / `zh-text.ts` 里为零

## 不做

- 不动后端。`/v1/skills` 那一组路由已经够用，`uninstall` 的问题在前端。
- 不动对话内的技能发现路径（MCP `mcp__qumge__search_skills`）。规格 D' 说发现发生在对话里，这一页是第二个入口，不是替代品。
- 不动技能人格（personas）带来的技能 —— 那些在人格页管理（SKILLS-SPEC §10），不进这一页。
