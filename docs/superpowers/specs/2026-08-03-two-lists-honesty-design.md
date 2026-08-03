# 两份列表不再骗人 —— 技能页的空白，模型页的「56 个」

日期：2026-08-03

## 问题

两页各有一处让用户以为「就这些了」。一处是**什么都不显示**，一处是**显示了一个假的总数**。

### 一、技能页：进页面先空白四秒半

`SkillCatalog.tsx:88-92` 挂载时就 `run("")` 去铺默认列表 —— 那段注释写着「首屏【不是】空白：空白会让人以为目录里没东西」。意图是对的，但拦不住这件事：

- `results` 初始是 `null`，而整个目录区包在 `SkillCatalog.tsx:213` 的 `results !== null &&` 里 —— **null 期间一个像素都不渲染**。
- 那次请求要出网。实测 `qumge_catalog.search("")` 回来要 **4.5 秒**；`qumge_catalog.py:29` 的 `TIMEOUT = 20.0` 是最坏值。
- 没有任何缓存，每次切进这一页都重打一次。

四秒半里唯一的迹象是「搜索」按钮变灰（`SkillCatalog.tsx:177-179` 的 `disabled={searching}`）—— 一个没人会盯着看的信号。

还有一个更长的空白：`SkillCatalog.tsx:81-83` 的 catch 分支只写 `searchErr`，`results` 永远停在 `null`。请求抛异常时，那块地方**再也不会有东西**。

### 二、模型页：「Qumge 上还有 56 个」是假的

`ModelChecklist.tsx:263-265` 报的 56 = 已加载的 60 条减去已勾的 4 条。而这 60 条不是网关的全部：

- **`list_models` 的 `limit` 上限就是 60。** 工具 schema 原话：`"How many to return. Default 20, max 60."`。实测 `20→20`、`30→30`、`60→60`、`61→60`、`200→60` —— 超出的值被服务端悄悄夹住。`api.ts:672` 传的正是 `200`。
- **返回表头里那个数是「这次返回了几条」，措辞却是「网关上有几个」。** 实测：

  ```
  limit=5  => "5 model(s) on the Qumge gateway, most used first."
  limit=20 => "20 model(s) on the Qumge gateway, most used first."
  limit=60 => "60 model(s) on the Qumge gateway, most used first."
  ```

  问它要 5 条，它就说网关上有 5 个模型。Marlo 界面上那句谎话是从这里转述来的。
- **网关实际远不止 60。** 用 16 个关键词探了一轮，摸出 **157 个不同的模型 id，其中 97 个在默认那 60 条之外**（`mistral` 23 条、`llama` 10 条、`kimi` 8 条、`minimax` 8 条、`cohere command` 2 条）。157 只是这轮探测的下限，真实总数只有 qumge 自己知道。

而**搜索框根本不出网**：`ModelChecklist.tsx:142-146` 的 `matches()` 只是对已加载的那 60 条做字符串包含。现在敲 `mistral` 得到的是「没有匹配的模型」，而网关上有 23 条。**文案说了谎，唯一的补救路又恰好是堵死的。**

附带一处同源的：已选列表里如果有那 60 条之外的模型（用户搜出来勾上的），`metaOf`（`ModelChecklist.tsx:137-141`）在 `gwById` 里查不到，那几行没有厂商也没有价格 —— 正是 `ModelChecklist.tsx:39-41` 那段注释骂过的病：「价格只在【还没选】的那一半可见：选进来之后就看不到自己在花多少钱，恰恰是事后想复查时唯一想看的数字。」

## 不做什么

- **agent 能力过滤。** qumge 那边已经保证了。`list_models` 的工具说明原话：`"Only tool-calling models are listed: an agent cannot use the others."` 而且它没有第二个模型接口 —— qumge 的 MCP 一共四个工具：`search_skills` / `get_skill` / `list_categories` / `list_models`。Marlo 这边不加任何能力过滤，也不硬编黑名单（`list_models` 返回的字段只有 名字·价格·vision，没有工具能力这一项，硬编必漂）。
- **技能页的目录缓存 / 启动预热。** owner 砍过。进页面仍然要等那 4.5 秒，这一轮只让这四秒半**看起来**是在干活。

## 决定

### 一、技能页：补加载态

`SkillCatalog.tsx` 里，搜索表单和结果块之间，条件 `results === null && !searchErr`：

- `results` 只在**首次挂载到第一次响应回来**之间是 `null`。之后的搜索和重置都保留旧结果 —— 把用户已经看得见的列表换成灰条是倒退，那时候「在忙」由搜索按钮变灰表示就够了。
- `!searchErr` 管的是上面那个 catch 分支：不加这个条件，请求抛异常时骨架会在错误条底下一直转。

形状抄 `GalleryModal.tsx:401-410` 已有的那套语法（一句话 + `animate-pulse` 灰条 + `aria-busy`），但骨架行用这一页的 `GRP` / `ROW`：一张卡、5 行、每行两条灰条（标题一条、说明一条），行高走 `ROW` 自带的 `min-h-[44px]`。形状和真结果一致，出结果时不会整块跳版。

文案新增 `skLoadingCatalog`：中文「正在读取技能目录…」/ 英文 `Loading the skill catalog…`。**不复用**现成的 `skLoading`（「加载中…」）—— 用户的原话是「以为什么也没有」，这句话必须点名在等的是**目录**；光说「加载中」仍然没回答「里面到底有没有东西」。

### 二、模型页

#### 2.1 总数从接口拿，拿不到就不报

qumge 侧把 `list_models` 表头改成：

```
Showing 60 of 312 model(s) on the Qumge gateway, most used first.
```

**M（312）只数能当 agent 用的那些。** qumge 上还有视频、图片这类模型，把它们算进 M，Marlo 就会显示一个用户永远搜不到的总数 —— 等于把「56」这个谎换成一个更大的谎。M 的口径必须和「列出来的」「搜得到的」是同一个集合。

Marlo 侧在 `qumge_catalog.py` 配一条正则 `^Showing (\d+) of (\d+)`，解析不到就是 `None`，文案退回不报总数的那一版 —— 两边发版不同步时不会断。

`models()` 现在返回裸 list，要带 total 就改成 `{"models": [...], "total": int | None}`。调用方只有 `app.py:657` 一处，加上 4 个测试点（`tests/test_qumge_catalog.py:123,135,164,172`）。**不另开第二个函数** —— 同一件事两条路，这库里是明令避免的。

#### 2.2 文案分成两截

分组标题保持「渲染了多少就说多少」的诚实计数，把「这只是一部分」挪到底下一行 `mlist-note`：

```
Qumge 上的其他模型 · 56
[列表]
网关上共 312 个，这里是最常用的一批 —— 搜名字或厂商能找到其余的。
```

- `gatewayOthers` 从「Qumge 上还有 ${n} 个」改成「Qumge 上的其他模型 · ${n}」/ `Other models on Qumge · ${n}`。
- 新增两条 note 文案：拿到 total 用 `gatewayPartialOf(total)`，拿不到用 `gatewayPartial`（「这是最常用的一批。网关上还有更多 —— 搜名字或厂商就能找到。」）。
- 那句 note **只在没筛选时出现**：筛选后用户看到的是搜索结果，再说「这是最常用的一批」就又错了一次。

#### 2.3 本地筛不到就出网

- **触发**：`filtering` 且两段都是 0 条。
- **防抖 400ms**。不防的话敲 `mistral` 会在 `mis` / `mist` / `mistr`… 每一步都 0 结果、每一步打一次网。
- **记住搜过的词**（`useRef(new Set())`），同一个词不重复出网。在**发请求时**就记，不等返回 —— 否则 StrictMode 的双调用会打两次。
- **`seq` 竞态守卫**，照 `SkillCatalog.tsx:66` 那个写法：晚回来的旧结果不能盖掉新的。
- **结果并进 `gModels`**（按 id 去重），不单独存一份。并进去之后本地 `matches()` 自然就把它们显示出来，后续再筛同一个词也不用再出网。

这条能成立是因为**网关的 query 是子串匹配**，不是语义检索 —— 实测 `便宜的能看图的模型` / `cheap vision model` / `写代码` 一律返回 0 条。所以服务端能命中的词，本地 `matches()` 那三段拼接（`nameOf` / `metaOf` / `id`）里必然也有，并进来的结果不会被本地筛再滤掉。

保留 `ModelChecklist.tsx:71-74` 那段注释的理由：常见情况（找 Claude / GPT）仍然是敲字即筛、不出网。

#### 2.4 出网时的加载态

`mlist-note` 位上显示 `gatewaySearching`（「正在 Qumge 上找…」/ `Searching Qumge…`）。没有它就是技能页那个病的翻版 —— 空白加一句「没有匹配的模型」，而其实正在搜。

`gatewayNoMatch` 改成只在 **`filtering` 且本地 0 条且不在搜且这个词已经搜过** 时才出。

#### 2.5 已选行补价格

挂载后首批到手时，取已选里 `gwById` 查不到的 id，按**厂商 slug 去重**各搜一次（通常 0～2 个请求），结果并进同一份 `gModels` 缓存。

slug 从 id 里取：`qumge:mistralai/mistral-medium-3.1` → `mistralai`（`:` 之后到 `/` 之前）。实测这些 slug 服务端全都命中：`mistralai`→23、`meta-llama`→6、`z-ai`→14、`x-ai`→12、`moonshotai`→8、`deepseek`→14、`qwen`→52。

#### 2.6 `limit` 200 → 60

`api.ts:672` 的默认 `limit = 200` 改成 `60`。超出契约的值现在靠服务端夹住，哪天它改成报错就断了。

## 改动面

| 文件 | 改什么 |
| --- | --- |
| `surfaces/gui/src/components/skills/SkillCatalog.tsx` | 加载骨架 |
| `surfaces/gui/src/components/ModelChecklist.tsx` | 文案两截、出网回退、加载态、已选补价格 |
| `surfaces/gui/src/api.ts` | `limit` 200→60；`gatewayModels` 返回带 `total` |
| `coworker/skills/qumge_catalog.py` | `models()` 返回 `{models, total}`；解析 `Showing N of M` |
| `coworker/server/app.py:657` | 跟着 `models()` 的新返回改 |
| `surfaces/gui/src/i18n/{en,zh}.ts` | `skLoadingCatalog`、`gatewaySearching`、`gatewayPartial`、`gatewayPartialOf`；改 `gatewayOthers` |

## 测试

- `SkillCatalog.test.tsx`：用手动 resolve 的 fetch，断言 resolve 前骨架在、resolve 后骨架没了且结果在；再一条断言请求失败时骨架不残留（只剩错误条）。
- `ModelChecklist.test.tsx`：**既有的 194-195 行要改** —— 现在断言敲 `zzzz` 立刻出 `gateway-nomatch`，加了防抖和出网之后得改成「等网关回来之后才 nomatch」。
- 新增：本地筛不到 → 出网搜一次 → 结果出现在列表里；同一个词不重复出网；出网期间显示 `gateway-searching`。
- 新增：已选里有 60 条之外的模型时，挂载后补搜一次，那一行拿到厂商和价格。
- `tests/test_qumge_catalog.py`：`models()` 新返回形状；表头带 `Showing N of M` 时解析出 total，不带时是 `None`。

## 跨仓库的活（不在本仓库）

qumge 侧改 `list_models` 表头为 `Showing N of M model(s) on the Qumge gateway, most used first.`，**M 只数 tool-calling 的模型**（不含视频、图片等）。Marlo 这边先上带回退的解析，qumge 上线后数字自动变真，不用再发一次 Marlo。
