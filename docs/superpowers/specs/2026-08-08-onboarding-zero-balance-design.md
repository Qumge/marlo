# 把 onboarding 串起来 —— 新用户零余额是预设，那就得有人告诉他

日期：2026-08-08

## 问题

新用户注册完 Qumge 余额就是 0，这是**预设行为**，不是 bug。站上写得明白：「下载免费，按用量充值付费」。

问题是这条链跨 app 和站点两侧，而**没有一处是按整条链设计的** —— 每一端都合理地假设了另一端会交代，于是「要花钱」这件事在用户撞上之前谁也没说。

**本文档只管 marlo 这一侧。** 站点侧有配套改动（把「要注册」和「要充值」在下载之前就说清楚），设计和实施计划在 qumge 的内部仓库里，不在这里展开。

### 一、第一单必然失败，且失败得看不懂

`errors.py:23-34` 的 `_NO_QUOTA` 只认 OpenAI 和 Anthropic 的字样（`insufficient_quota`、`credit balance is too low`）。Qumge 网关的 402 不在里面，于是 `engine.py:387-395` 直接把 `str(exc)` 抛给用户。

这正是 `balance.py:4-6` 自己写下过的那个 failure mode：

> Marlo is pay-as-you-go and said nothing about money anywhere. The first thing a
> user would have learned about their balance is a request failing — and a 402
> from a gateway is not something a person can act on.

那段注释之后做了余额 chip，但**没做错误映射**。所以这个 failure mode 至今原样存在，只是旁边多了个小角标。

### 二、余额 chip 出现得太晚，正好错过要用它的那一分钟

`Onboarding.tsx` 的 `handleQumgeConnected` 只调了 `ps.refreshProviders()`，没通知账号那一侧。而 `AccountRow.tsx:70` 的轮询是 60 秒一次。

所以刚登录完的用户最长 60 秒看不到自己的余额 —— 而那 60 秒正是他准备打第一句话的时候。

### 三、app 从没提过「你可能得先注册一个账号」

面板上写的是「连接 Qumge」，从头到尾没有一个字提到用户可能需要先注册。他点开浏览器，看到的是一个登录页，得自己意识到要去点注册。

（回跳本身是通的 —— 注册或登录完会回到带 code 的审批页，站点侧已验证并有测试覆盖。所以这里不是断链，是没交代。）

`QumgeConnect.tsx` 的 waiting 态另有一个真问题：出路只有一个「重试」，而它做的是重新 `start()`。浏览器根本没打开、开错浏览器、标签页被关掉时，用户没有轻量的路可走。

### 四、Windows 用户被告知自己有一台 Mac

`en.ts:176` 和 `zh.ts:80` 的 `onboardLede`、`en.ts:658` 和 `zh.ts:627` 的 `deviceHint` 都把「this Mac / 这台 Mac」写死了。而 `release.yml:53` 在造 `Marlo-windows-setup.exe` 和 `.msi`，官网也正挂着。

第一屏第一句话就在说一个和用户无关的设备。

### 五、README 说没有可下载的构建

`README.md:24` 的 Pre-release 横幅和 `README.md:35-45` 的 Download 段都写着「Not yet」，还把人引去上游 OpenWorker。

实际上 GitHub 上有 v0.4.4 到 v0.7.5 十个 release，v0.7.5 发布于 2026-08-07，CDN（`cdn.qumge.com/marlo/latest/`）上五个产物全部 200，`latest.json` 三平台签名齐全。

从 GitHub 进来的人，第一步就被劝退了。

## 不做什么

- **不在 onboarding 里加一屏充值。** 在用户还没看到任何价值之前就要钱，首屏流失会明显变高。
- **不按预估成本拦。** 用户还没发出去之前那个数很难准，容易误伤。
- **不猜 Qumge 402 的 body 长什么样。** 猜错就是白写，网关改文案还会悄悄失效。
- **不给 README 加防漂移守卫。** 让那段没有可漂移的东西，比给它配警报好。

## 决定

三层闸门从早到晚，互不依赖 —— 哪一层坏了其余两层还在；另外几节是把链条其余几处断点接上。

### 一、判据在服务端

`balance.py` 的 `fetch()` 返回值里，和 `low` 并排加一个字段：

```python
"low": micro < 1_000_000,
"can_spend": micro > 0,
```

判据是一行，但它在服务端。以后要改成别的阈值时，改这一行，GUI 一个字不动。

这条沿用 `balance.py:90-93` 已经写下的原则：

> The threshold is here, not in the GUI, so the warning and the number it is
> based on cannot drift apart.

**「拿不到余额算不算能花」不需要额外规则。** `fetch()` 拿不到时返回 `None`，`can_spend` 根本不存在。GUI 侧的规则因此是：只有拿到了余额且 `can_spend === false` 才拦。离线、服务端抽风、老 sidecar 没这个字段，一律不拦。这不是额外加的兜底，是 `None` 这个状态自带的，写不反。

### 二、一个时钟，不是两个

composer 需要余额，但目前只有 `AccountRow.tsx:64` 在轮询。让 composer 自己再拉一次就会犯 `BalanceChip.tsx:16-18` 骂过的病：

> Two components polling the same endpoint on independent clocks is how a row
> and the number beside it end up disagreeing on screen for up to a minute.

新文件 `surfaces/gui/src/useQumgeAccount.ts`：模块级单例状态 + 订阅，内部只有一个定时器。`AccountRow` 改用它，composer 也用它。

不提到 `App.tsx`，因为那是上游会动的文件 —— 沿用 `AccountRow.tsx:10-12` 和 `api.qumge.ts:1-8` 写明的同一条策略（上游活跃维护的文件里加东西 = 每次同步都要手工合，新文件永不冲突）。

刷新触发点沿用现有四个（mount / `focus` / `CLOUD_CHANGED` / 60s），**新增一个**：拦截卡片可见期间降到 5 秒一次。

两条路都能解锁：用户在这台机器上充完值切回来，`focus` 立刻刷；用户在手机上扫码充值（app 从没失去焦点，`focus` 不触发），5 秒轮询兜住。

**卡片上不放「我充好了」按钮** —— 上面两条已覆盖全，再加一个按钮是让用户替我们做我们自己能做的事。

### 三、第一层：发消息前拦住

composer 里已有一个形状完全相同的闸门，`Composer.tsx:330-334`：

```ts
// No model connected: keep the draft (don't drop it) and send the user to setup instead.
if (needsModel) { props.onConnectModel?.(); return; }
```

余额闸门是同一件事，只是理由不同。加两个 prop，和 `modelReady` / `onConnectModel` 并排：

```ts
// False when the active Qumge model's account has zero credit — keeps the draft and
// shows the top-up card instead of sending. Undefined = not applicable or not known
// (BYO-key provider, offline, older sidecar) and never gates.
canSpend?: boolean;
onTopUp?: () => void;
```

判断顺序：**`needsModel` 在前，`needsCredit` 在后**。没连模型的时候谈余额是答非所问。

**闸门只对 Qumge 模型生效。** 判据用前缀：

```ts
const isQumgeModel = (m: string) => m.startsWith("qumge:");
```

这个前缀测试是精确的，不是近似 —— `manager.py:1622` 定了这条约定：「OpenAI models stay bare (the router's default); others carry their prefix.」裸 id 一定是 OpenAI 的，不需要任何表。

在 `App.tsx:1634` 已有的调用点旁边多一行：

```tsx
canSpend={isQumgeModel(model) ? account.balance?.can_spend : undefined}
```

三种情况自动落到 `undefined`（非 Qumge 模型、余额拿不到、老 sidecar），全都不拦。

**卡片出现在 composer 上方，不是 modal。** 输入框和草稿始终可见。modal 会正好盖住输入框，制造「我打的字还在吗」这一秒的焦虑 —— 而这个闸门存在的全部理由就是不让用户觉得自己白打了。

卡片内容：余额 `$0.00` / 一句「充值后就能跑这一单，按用量扣费，不订阅」/ 两个动作：

- **去充值** → `openExternal(balance.topup_url)`，卡片进入等待态（5 秒轮询起）
- **用我自己的 key** → `openModelSetup()`，和 composer 现有的「No model connected」chip 同一个入口

第二个不能省。onboarding 第一屏就承诺过这条路（`Onboarding.tsx` 的 `ob-use-own-key`），在用户最需要它的时刻把它藏起来，等于那句承诺只在没人用得上的时候有效。

**解锁之后不自动发送。** `can_spend` 变 true → 卡片消失、输入框恢复可发，但不替用户按回车。用户去充值的路上可能改了主意或想改那句话；替他发出去是替他花钱，而这是他第一次为 Marlo 花钱。

### 四、第二层：让 chip 早一分钟出现

低额提醒已经全须全尾地存在（`BalanceChip` 读 `low`，`$0.00` 时显示金额 + 「去充值」）。余额为 0 时它自然也是 low 态，和第一层叠加不冲突。**这一层的组件改动是零。**

唯一要修的是它出现得太晚（见「问题」二）。`handleQumgeConnected` 里加一行：

```ts
window.dispatchEvent(new Event(CLOUD_CHANGED));
```

`AccountRow.tsx:69` 已经在监听。chip 于是在登录成功的那一瞬间出现，写着 `$0.00 去充值`。

这一行让第二层从「第一单失败后的补救」变成「用户还没打字就已经知道」。整条链上性价比最高的一处改动。

### 五、第三层：402 兜底

`errors.py` 改成认状态码，不猜 body：

```python
if getattr(exc, "status_code", None) == 402:
    return no_credit_message
```

这不违反 `errors.py:9` 那条原则（「Matching is on the error BODY text, not just HTTP status」）。那条原则针对的是 **404 和 429 这种一码多义**的情况 —— 404 也可能是 base_url 写错，429 也可能只是让你慢点。**402 Payment Required 没有第二个含义。**

再加一组宽松文本兜底（`insufficient balance`、`payment required`），以防 SDK 包装时丢了状态码。

要让这条消息可点，`engine.py:388-391` 的 payload 多带一个 kind：

```python
payload = {"error": ..., "error_type": ..., "error_kind": "no_credit"}
```

GUI 的错误渲染看到 `no_credit` 就在文案下面挂一个「去充值」按钮，`topup_url` 从同一个 account hook 拿，不新开数据源。`errors.py` 仍然只管文案，`engine.py` 只多传一个字符串。

**光改 payload 不够 —— 按钮会在刷新后消失。** 错误在转录里是一条持久化的 notice（`engine.py:394` 的 `_append_notice("error", ...)`），刷新后由 `itemsFromMessages.ts:80` 重建。live 事件的 payload 到不了那里，所以 notice 本身也要带上这个原因：

```python
self._append_notice("error", friendly or str(exc), cause="no_credit")
```

`_append_notice`（`engine.py:256`）相应多一个可选参数，写进 notice dict。

**kind 必须仍然是 `"error"`，不能改成 `"no_credit"`。** `retry()`（`engine.py:265`）的守卫是「尾部必须是一条 error notice」，换掉 kind 会让重试静默失效 —— 而这条错误恰恰是最该能重试的那种（充完值点一下就好）。原因走新字段，不走 kind。

### 六、设备面板：把注册说清楚，顺手补一个浏览器兜底

**（一）把注册说在前面，而且说实话。** 面板加一句，在点开浏览器**之前**就可见：

> 还没有 Qumge 账号？在打开的页面上注册一个 —— 注册完会自动回到这一步。

后半句不是安慰，是事实：注册或登录完会回到带 code 的审批页（站点侧已验证并有测试覆盖）。把它写出来，用户就不会在浏览器里犹豫「我注册完还得自己找回来吗」。

**（二）waiting 态加一个次级动作：「浏览器没打开？再试一次」。**

它只做一件事：用**同一个** `verification_uri_complete` 再 `openExternal` 一次。

**它不能是重新 `start()`。** 重新开流程会换一个新 code，白白吃掉 qumge.com 每小时 20 次里的一次（`manager_mixin.py:40-45` 专门为这个限额写过错误分支），而且旧 code 还在服务端挂着。现有的「重试」按钮做的正是 `start()`，所以这是一个**新的、更轻的**动作，不是复用它。

它覆盖的是三类真实故障：浏览器压根没打开、开到了错的浏览器、用户手滑关了标签页。**注册回跳不在其中** —— 那条路本来就是通的。这个按钮成本几乎为零，所以仍然值得做，但它的分量比原先设想的小，措辞也不该再暗示注册会出问题。

**（三）过期文案给出路。** `codeExpired` 现在只说「这个验证码还没用就过期了」，是个死胡同。改成说清下一步：点重试会给一个新码。

### 七、站点侧的配套改动

站上要在下载之前就把「要注册」和「要充值」说清楚 —— app 里那张拦截卡片挡的正是没被告知过的人：站上先说过，卡片是提醒；没说过，卡片是埋伏。

具体设计和实施计划在 qumge 的内部仓库，**先于本计划发布**。

### 八、「这台 Mac」

i18n 已有函数形式的键（`en.ts:170` 的 `workingWithTools: (n) => ...`），所以加一个 `thisDevice` 键，由 `platformOS()`（`tauri.ts:13`）决定取「这台 Mac」还是「这台电脑」，四处文案改成函数接它。

不直接换成中性词，是因为 Mac 是主力平台（官网标题就是 "an AI coworker for your Mac"），把它降级成「这台电脑」是让 90% 的用户为 10% 买单。这个键让两边都对。

### 九、README

Download 段重写时**不写版本号** —— 只指向 `qumge.com` 和 GitHub 的 `releases/latest`。让这段没有可漂移的东西，它就再也不会漂。同时删掉顶部那条 Pre-release 横幅。

## 改动面

| 文件 | 改动 |
|---|---|
| `coworker/qumge/balance.py` | `fetch()` 返回值加 `can_spend` |
| `coworker/providers/errors.py` | 402 状态码分支 + 文本兜底 + 无额度文案 |
| `coworker/engine.py` | 错误 payload 加 `error_kind`；`_append_notice` 加 `cause` 参数并写进 notice |
| `surfaces/gui/src/itemsFromMessages.ts` | notice 的 `cause` 透到 item 上（否则刷新后按钮消失） |
| `surfaces/gui/src/components/Transcript.tsx` | `no_credit` 的 notice 多一个「去充值」，和已有的 Retry 并排 |
| `surfaces/gui/src/useQumgeAccount.ts` | **新文件** —— 单例账号状态 + 订阅 + 可变轮询间隔 |
| `surfaces/gui/src/components/AccountRow.tsx` | 改用 hook（删掉自己的定时器） |
| `surfaces/gui/src/components/Composer.tsx` | `canSpend` / `onTopUp` 两个 prop + 拦截分支 |
| `surfaces/gui/src/components/TopUpCard.tsx` | **新文件** —— 拦截卡片 |
| `surfaces/gui/src/App.tsx` | 调用点加一行 `canSpend`（紧挨已有的 `modelReady`） |
| `surfaces/gui/src/components/Onboarding.tsx` | `handleQumgeConnected` 加一行 `CLOUD_CHANGED` |
| `surfaces/gui/src/providers/QumgeConnect.tsx` | 注册提示 + 「再打开一次」+ 过期文案 |
| `surfaces/gui/src/i18n/{en,zh}.ts` | `thisDevice` 键；四处文案改函数；新增卡片/面板文案 |
| `README.md` | 删 Pre-release 横幅，重写 Download 段 |

## 测试

| 层 | 测什么 | 在哪 |
|---|---|---|
| 服务端判据 | `can_spend` 随余额翻转；`fetch()` 拿不到时返回 `None` 而非 `can_spend: false` | `tests/test_qumge_balance.py` |
| 402 映射 | `status_code=402` → 文案 + `error_kind`；404/429 不受影响 | `tests/test_model_errors.py` |
| 402 持久化 | notice 带 `cause` 且 `kind` 仍是 `"error"`（`retry()` 的守卫不破） | `tests/test_engine.py` + `itemsFromMessages` 单测 |
| 第一层 | `canSpend=false` 按回车不发送且草稿还在；`undefined` 照常发；非 qumge 模型不拦 | `Composer` 单测 |
| 设备兜底 | 「再打开一次」重开同一个 URL 且**不**触发新的 `start()` | `QumgeConnect.test.tsx` |
| 串起来 | 零余额 → 拦 → 充值 → 解锁 → 可发，全程草稿不丢 | 新增 e2e spec |


最后那条 e2e 是唯一新增的测试文件，也是唯一能证明「串起来了」的那个。其余四条都是往已有文件里加 case。

跑 e2e 时本机需要绕开代理：

```bash
cd surfaces/gui && NO_PROXY="localhost,127.0.0.1" no_proxy="localhost,127.0.0.1" npm run e2e
```

