# Tier 2 键映射表与两处待定 —— 接着 Task 6 做的人先读这个

> 状态：Task 1-5 已完成（Tier 1 全部 15 个文件迁完，冲突 72 → 65）。
> 本文是 Task 6（Tier 2，20 个文件）的**准备成果**，不是已完成的工作。

## 自动匹配已经做好了

判据是**英文原文**：我们的键 → `legacyI18n/en.ts` 的英文 → `locales/en.json` 里值相同的上游键。
三个迁移期工具在 scratchpad（不进仓库，迁完就没用了）：

```
zhcheck.py   译文对账：上游键的中文 vs 我们对同一句英文的译文。--apply 按「我们的为准」回填
migrate.py   按英文原文把 t("ourKey") 改写成 t("upstream.key")，换掉 import 和 hook
suggest.py   匹配不上的键，从【上游同一个文件用到的键】里按相似度找候选
```

对 Tier 2 全部 20 个文件干跑的结果：**278 个键自动匹配，50 个要人工**。

**工具有两个坑，都已修，但下一个人可能重踩：**

1. `t\(` 前面必须有词边界。没有的话 `act("allow")`、`import("xlsx")`、
   `createElement("canvas")` 都会被当成 i18n 调用 —— 它们都以 `t(` 结尾。
2. `useT` 是 `useTranslation` 的前缀。查「还有没有 legacyI18n 残留」时要用
   `\buseT\(`，否则迁移成功的文件会被报成没迁。

## 那 50 个人工映射，表在这里

下面是逐个查过上游文件之后确定的对应关系。**带 `(参数)` 的那些不是改个键名就完了** ——
我们的目录里是函数值（全仓 72 个函数值、89 处 `t("key")(args)` 调用），上游用 `{{}}` 插值：

```tsx
t("tplShowAllLines")(n)          →   t("approval.preview_all_lines", { n })
t("tplRunningSteps")(steps)      →   t("transcript.turn.running", { label: steps })
```

参数名要用**上游 en.json 里那个占位符的名字**，不是我们的形参名。写错了 tsc 不会说话，
上游 `i18n.test.ts` 的「插值占位符对齐」也不会说话（它只比 en/zh 两边），只有界面上会
出现一个没被替换掉的 `{{name}}`。这是这一档最容易出错的地方。

| 我们的键 | 上游的键 | 备注 |
|---|---|---|
| `connRemove` | `common.remove` | HubSpot / Gmail / Github / Slack 四个文件都有 |
| `icQuestionN` (n) | `inbox.question_n` | `{{n}}` |
| `tplAlwaysAllowAgainst` (target, task) | `inbox.always_task_title` | `{{target}}` `{{task}}` |
| `memDeleteAllConfirm` | `memory.wipe_confirm` | 逐字相同 |
| `memRulesPlaceholder` | `memory.rules_placeholder` | 逐字相同 |
| `psTestedAndSaved` | `provider.tested_saved_pill` | 上游多一个 `✓` 前缀 |
| `prCreateOneAt` | `provider.create_key_at` | 上游带 `{{label}}`，我们的是裸串 —— 调用点要改 |
| `prInstallOllama` | `provider.install_ollama` | 上游没有 `↗`，箭头在 JSX 里 |
| `prCustomEndpoint` | `provider.custom_endpoint` | 同上，`⌄` 在 JSX 里 |
| `tplLeavesMac` (target) | `approval.scope.leaves_mac` | 占位符叫 `{{dest}}`，**不是** `target` |
| `tplShowAllLines` (n) | `approval.preview_all_lines` | `{{n}}` |
| `tplAlwaysAllowAuto` (what, target, task) | `approval.btn.always_task_title` | 占位符是 `{{name}}` `{{target}}` `{{task}}` |
| `tplAlwaysAllowSession2` (what) | `approval.btn.always_tool_title` | 占位符叫 `{{name}}` |
| `tplConnectName` (name) | `modal.connect_title` | 占位符叫 `{{title}}` |
| `nToolCallsSoFar` (n) | `rail.tool_calls` | `{{count}}`，**复数走 i18next 的 `_one`/`_other`**，别自己拼 `${n === 1 ? "" : "s"}` |
| `workingWithTools` (n) | `rail.working_task_with_tools` | 同上 |
| `rrNoPreview` | `rail.office_no_preview` | 上游带 `{{type}}`，我们的是裸串 —— 调用点要改 |
| `tplShowingFirstRows` (shown, total) | `rail.table_truncated` | 占位符是 `{{max}}` `{{total}}` |
| `rrPdfFailed` | `rail.pdf_error` | 上游带 `{{error}}`，我们把错误拼在 JSX 里 —— 调用点要改 |
| `rrSheetFailed` | `rail.sheet_error` | 同上 |
| `tplApprovedVia` (how) | `transcript.approval.approved_scope` | 上游是 `approved by you · {{scope}}`，**多了 "by you"** —— 文案有实质差别，要判断 |
| `tplAutoAllowedFull` (rule) | `transcript.step.auto_allowed_tip` | 占位符叫 `{{name}}` |
| `tplNSteps` (n) | `transcript.turn.steps_label` | 上游有 `_one` / 无后缀两条，走 `{{count}}` |
| `tplRunningSteps` (steps) | `transcript.turn.running` | 占位符叫 `{{label}}` |
| `ibChannelConflict2` | `inbox.collision_title` | 逐字相同 |
| `cxDemoMsgShort` | `slack.hiw_msg_traction` | 上游那句更长（`… since the post…`） |
| `giveFolderAccess` | `access.give_folder` | 我们多个 `+ ` 前缀，前缀移进 JSX |
| `acNotListening` (label) | `access.no_channels` | `{{label}}` |
| `acSubscribedChannels` | `access.subscribed` | **上游带 `· {{count}}`**，我们的是裸串 —— 调用点要改 |

**上游没有对应键，要新加**（加到 `en.json` + `zh.json`，中文用我们旧目录里的原译）：

| 我们的键 | 建议的新键 | 英文 |
|---|---|---|
| `tplOpenLabel` (label) | `inbox.open_label` | `Open “{{label}}”` |
| `scSavesToSkills` | `approval.scope.saves_to_skills` | `saves to Skills` |
| `addCredit2` | `transcript.add_credit` | `Add credit` |
| `nFolders` (n) | `access.n_folders` | `{{count}} folders` + `_one` |
| `uiEnabledTapMute` | `access.enabled_tap_mute` | `Enabled for this session — tap to mute here` |

这五个都是我们 fork 自己的功能带来的（零余额充值、技能安装、文件夹授权），
上游没有对应 UI，所以是新增不是替换。

## 待定一：上游把 Persona 改名成了 Coworker —— 这是产品决定，不是翻译

`PersonaView.tsx` / `PersonasTab.tsx` / `GalleryModal.tsx` 三个文件先没做，因为上游
在**英文**里就把这个概念改名了：

```
我们        Could not load this persona.     Enable this persona     All personas
上游        Could not load this coworker.    Enable this coworker    All coworkers
```

中文两边也不一样，而且**我们自己就是混的**：

```
我们的旧目录   角色 29 处、同事 26 处、人设 1 处
上游 zh.json   同事 53 处（一致）
```

（我们那 26 处「同事」是构建期 transform 翻上游 JSX 里的 "coworker" 来的 —— 也就是说
这个混用不是谁疏忽，是两条 i18n 路径各自跟着各自的英文走的必然结果。）

用上游的键就等于接受这次改名。这会把界面上「角色」全部变成「同事」，是用户看得见的
产品词汇变更，**不该混在一次同步提交里悄悄发生**。要 owner 定：

1. 跟上游改名（角色 → 同事），一次性扫干净；
2. 保留「角色」，用上游的键但 zh.json 的值一律改回「角色」（键名里的 persona/coworker
   不影响用户）；
3. 换第三个词。

定了之后这三个文件十分钟就能做完，映射关系已经查好了：

| 我们的键 | 上游的键 |
|---|---|
| `pvLoadFailed` | `persona.load_error` |
| `uiPersona` | `persona.persona` |
| `uiEnablePersona` | `persona.enable_title` |
| `tplConfigureName` (name) | `personas.configure_title`（`{{name}}`） |
| `uiLocalDirectory` | `personas.mode_local`（上游作 "Local folder"） |
| `psRecommendedMode` (mode) | `personas.consent_recommended_mode`（`{{mode}}`，上游那句更短） |
| `tplInstalledPersonas` (n) | 上游没有，要新加 |
| `glAllPersonas` | `gallery.all_personas` |
| `glNoMatch` | `gallery.empty_search` |
| `glNonePublished` | `gallery.empty_none` |
| `glTeamEmpty` | `gallery.team_teaser` |
| `glCanMsg` | `gallery.can_message` |
| `uiSearchPersonas` | `gallery.search_placeholder` |

## 待定二：我们的 i18n 标准比上游严，这会持续制造冲突

`check_i18n.py` 的基线是 **0 条写死英文**。上游没有这条要求 —— 它自己的组件里就留着
没包进 `t()` 的英文。Tier 1 收尾时守卫抓到两条（`Markdown.tsx` 的 `title="Open the board"`、
`CloudSignIn.tsx` 的默认 blurb）。

包起来就意味着**又和上游那个文件分叉了**：那两个文件刚因为「逐字节相同」掉出冲突清单，
包完又回去了（冲突数 63 → 65）。

这是结构性的，不是这两个文件的问题。三条路：

1. **就这么包**（现在的做法）。每个上游漏包的文件都会长期冲突，但每个只差一两行。
2. **把包装贡献回上游**。上游正在积极接收 i18n 的 PR（`#127` 就是社区做的），我们
   把漏包的地方提上去，合并后分叉自动消失。**成本最低、最治本的一条**。
3. **留一个瘦身版的 transform** 专门管上游漏包的英文。能保住零分叉，但 Phase C 要删的
   1800 行就删不掉了 —— 为了两个文件留一整套机制，不划算。

建议走 2，短期用 1 兜着。

## 接着做的顺序

1. owner 定「待定一」。
2. 按上表做完 Tier 2 的 17 个非 persona 文件（映射已查好，注意插值参数名）。
3. persona 三个文件。
4. Task 7（Tier 3，13 个）→ Task 8 验收（≤30，见计划里更正过的那节）。
