# 墙后能用：应用自己找到代理

日期：2026-08-03

## 问题

一个开着 VPN 的用户点「下载模型」，拿到的是：

```
Could not download the local voice model:
https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-base.en.bin:
Connection Failed: tls connection init failed: Connection reset by peer (os error 54)
```

VPN 是开着的，终端里别的东西都通，唯独它失败。原因不是网络，是**这个下载器从头到尾没打算走代理**。

### 一、语音模型下载：编译期就把代理排除了

`stt/src/lib.rs:166` 是裸的 builder，没有 `.proxy()`：

```rust
let agent = ureq::AgentBuilder::new()
    .timeout_connect(...)
    .timeout_read(...)
    .build();
```

ureq 确实有读环境变量的能力（`agent.rs:286`），但被 feature 关着：

```rust
#[cfg(feature = "proxy-from-env")]      try_proxy_from_env: true,
#[cfg(not(feature = "proxy-from-env"))] try_proxy_from_env: false,   // ← 我们是这条
```

而 `stt/Cargo.toml:13` 写的是 `ureq = "2.12"`，只有默认 features。所以 `try_proxy_from_env = false` —— **连从终端启动都救不了它**。

实测同一个 URL：绕开代理 → `Recv failure: Connection reset by peer`（和应用里那条报错一字不差）；走代理 → `HTTP/1.1 200 Connection established`。确认是直连出去被重置的。

### 二、Python 边车：只在从终端启动时才有代理

`surfaces/gui/src-tauri/src/lib.rs:13-15` 自己写着：

> The sidecar inherits this process's environment, so a shell-launched `npm run tauri dev` passes `OPENAI_API_KEY` through. **A Finder-launched app has no shell env.**

边车用 httpx，httpx 默认读 `HTTPS_PROXY` / `ALL_PROXY`。所以：

- 从**终端**启动 → shell 的代理变量一路传下去 → 一切正常（开发时一直是这个状态，所以这个洞没人踩到）。
- **双击**打包版 → 边车拿不到任何代理变量。实测 `qumge.com` 直连是 15 秒超时 —— 技能目录、模型清单、网关请求**全都连不上**，不只是语音模型那一个下载。

两个洞同一个根因：**没有任何一处在回答「这台机器上该用哪个代理」**。

## 决定

一处检测，两个消费者。

### 一、新模块 `surfaces/gui/src-tauri/src/proxy.rs`

只有一个职责，也只有一个对外函数：

```rust
/// 这台机器上该用哪个代理。返回 `http://host:port`，找不到就是 None。
pub fn detect() -> Option<String>
```

**查找顺序**：

1. **环境变量**，按这个次序取第一个可用的：`HTTPS_PROXY`、`https_proxy`、`HTTP_PROXY`、`http_proxy`、`ALL_PROXY`、`all_proxy`。这既覆盖终端启动，也是用户想手动指定时唯一的出口 —— 我们不做界面，这条就是那个逃生口。
2. **系统代理**：
   - **macOS**：跑 `scutil --proxy`。`HTTPSEnable: 1` 就取 `HTTPSProxy:HTTPSPort`，否则看 `HTTPEnable: 1` 取 `HTTPProxy:HTTPPort`。输出长这样：

     ```
     <dictionary> {
       HTTPEnable : 1
       HTTPPort : 7897
       HTTPProxy : 127.0.0.1
       HTTPSEnable : 1
       HTTPSPort : 7897
       HTTPSProxy : 127.0.0.1
     }
     ```
   - **Windows**：`reg query "HKCU\Software\Microsoft\Windows\CurrentVersion\Internet Settings"`。`ProxyEnable REG_DWORD 0x1` 时取 `ProxyServer`。它有两种形状：裸的 `127.0.0.1:7890`，或者分协议的 `http=1.2.3.4:80;https=1.2.3.4:443;socks=…` —— 后者取 `https=` 那段，没有就取 `http=` 那段，`socks=` 那段永远不取（理由见下一节）。
   - **其他平台**：只有第 1 条。
3. 都没有 → `None`。

**只认两种形状**：`http://host:port`，或者裸的 `host:port`（补成前者）。别的 scheme 一律跳过 —— 不只是 `socks*`，`https://` 这种「代理本身跑在 TLS 上」的写法 ureq 的 `Proxy::new` 也不收（`proxy.rs:110` 那个 match 只认 http / socks4 / socks4a / socks / socks5）。跳过的判据写成白名单而不是黑名单：黑名单漏一种，漏掉的那种会一路走到运行时才炸。

### 一之二、SOCKS 一律跳过（两边都用不了它）

**`socks*://` 开头的候选值直接跳过**，环境变量和系统代理都是。这不是偷懒，是两个消费者都用不了：

- **ureq**：socks 在 `socks-proxy` feature 后面，没开。而且关着的时候它**不是编译错误，是运行时错误** —— `stream.rs:623-635` 那个空实现返回 `SOCKS feature disabled.`。也就是说传一个 socks 地址进去，编译器一声不吭，用户点下载才炸。
- **httpx**：socks 代理要 `socksio`。它只出现在 `requirements-ci.txt:273`，**不是 `pyproject.toml` 里声明的依赖** —— 打包出去的边车不能假定有它。传 `ALL_PROXY=socks5://…` 给一个没有 socksio 的边车，等于把「能连」换成「每个请求都抛 ImportError」。

这条排序不是纸上谈兵：**这个仓库 owner 自己的机器上就是**

```
all_proxy=socks5://127.0.0.1:7897     ← 排第一就会选中它，然后两边都炸
https_proxy=http://127.0.0.1:7897     ← 要的是这个
```

好在常见客户端（Clash 一类）HTTP/HTTPS/SOCKS 指向同一个端口 —— 上面那份 `scutil` 输出里 `HTTPPort` / `SOCKSPort` 都是 7897，取 HTTP 那条不丢任何能力。

只有 SOCKS、没有 HTTP 的环境会得到 `None` 和一句「没有检测到系统代理」。这是诚实的结果，也是罕见的配置；真遇到了，再开 ureq 的 feature 并把 `socksio` 提成正式依赖 —— 两件事要一起做，只做一半就是上面那两个炸法之一。

**用 `Command` 跑外部命令而不是引依赖**：壳里已经有 `Command::new("caffeinate")`（`lib.rs:193`）、`/usr/bin/open`（`lib.rs:289`）、`cmd`（`lib.rs:295`），`scutil` / `reg` 走的是同一条既有路子。

### 二、边车：spawn 时注入

`lib.rs:717` 那个 `server_cmd` 上加：

```rust
if let Some(p) = proxy::detect() {
    server_cmd.env("HTTPS_PROXY", &p).env("ALL_PROXY", &p);
}
```

httpx 默认就认这两个（`trust_env=True`），**Python 侧一行不用改**。

### 三、语音模型下载：显式传参

`ocw_stt` 的下载函数加一个参数：

```rust
pub fn install_default_model_with_progress(
    &self,
    proxy: Option<&str>,
    mut on_progress: impl FnMut(DownloadProgress),
) -> Result<(), String>
```

内部：

```rust
let mut builder = ureq::AgentBuilder::new()
    .timeout_connect(Duration::from_secs(30))
    .timeout_read(Duration::from_secs(30));
if let Some(p) = proxy {
    builder = builder.proxy(
        ureq::Proxy::new(p).map_err(|e| format!("Bad proxy {p}: {e}"))?,
    );
}
let agent = builder.build();
```

调用方 `download_dictation_model`（`lib.rs:492`）在**每次点下载时**现取 `proxy::detect()`。

**为什么不用 `std::env::set_var` + 打开 ureq 的 `proxy-from-env`**，虽然那样代码更少：那条路是隐式的。将来谁给 ureq 加个 `default-features = false`，代理就静悄悄断了，而断掉的表现是「墙后的用户下载失败」—— 没人会立刻联想到一个 feature flag。显式传参断不了，编译器会拦。而且 `set_var` 是进程级全局副作用。

### 四、检测时机：两边不一样，且必须不一样

- **边车**只能在启动时检测一次 —— 进程环境本来就只有 spawn 那一刻能定。
- **下载**每次点的时候重新检测。这是用户主动动作，而且他很可能**刚打开 VPN 就来点它**；启动时缓存下来的值会是开 VPN 之前的那个空值，而那正是本文档开头那张截图的场景。

### 五、错误信息里把两件事分开

现在失败只说 `Could not download the local voice model: <ureq 的原话>`，用户拿着这句话只能问「我开了 VPN 为什么还失败」。

改成：`proxy::detect()` 返回 `None` 时，在错误后面附一句「没有检测到系统代理」。把「网络坏了」和「你的代理没被用上」分开 —— 后者用户自己能解决（把 VPN 客户端切到系统代理模式），前者不能。

文案走 i18n，中文「（没有检测到系统代理）」/ 英文 `(no system proxy detected)`。

## 不做什么

- **界面上填代理的框。** 自动检测覆盖了「开着 VPN 的普通用户」这个实际场景，环境变量是高级用户的逃生口。PAC 脚本、需要认证的企业代理不在这一轮里 —— 真遇到了再说。
- **SOCKS。** 见「一之二」。开它要同时改两处（ureq 的 feature + 把 `socksio` 提成正式依赖），只改一处比不改更糟。
- **Python 侧读系统代理。** 边车的代理由壳注入，Python 不用知道系统代理这回事。两处各读一遍必然会漂。

## 改动面

| 文件 | 改什么 |
| --- | --- |
| `surfaces/gui/src-tauri/src/proxy.rs` | 新建：`detect()` + 两个平台的解析函数 + 单元测试 |
| `surfaces/gui/src-tauri/src/lib.rs` | `mod proxy;`；边车 spawn 注入；下载命令现取代理并传下去 |
| `stt/src/lib.rs` | 下载函数加 `proxy` 参数；`AgentBuilder` 配 `.proxy()`；删掉无人调用的 `install_default_model` |
| `surfaces/gui/src/i18n/{en,zh}.ts` | 「没有检测到系统代理」那句 |

**`install_default_model`（`stt/src/lib.rs:132`）全仓库零调用**，是死的 public API。给它也加一个 proxy 参数等于凭空造一条「悄悄不走代理」的路，正是这份规格要消灭的东西 —— 直接删掉。这个 crate 是 path 依赖（`ocw-stt = { path = "../../../stt" }`），没发布，只有一个消费者。

## 测试

解析是纯字符串函数，都可测。`openworker-desktop` 这个包现在还没有测试，这是第一批（`stt/src/lib.rs:612` 已有 `#[cfg(test)]`）。

- 真实的 `scutil --proxy` 输出 → `http://127.0.0.1:7897`。
- `HTTPSEnable : 0` 且 `HTTPEnable : 0` → `None`（**开关必须看**：字段在、值是 0 的时候代理是关的，只看有没有 `HTTPProxy` 会给出一个关着的代理）。
- 只有 `HTTPEnable : 1` 没有 HTTPS → 退回取 HTTP 那组。
- Windows：`ProxyEnable REG_DWORD 0x1` + 裸 `127.0.0.1:7890` → `http://127.0.0.1:7890`；分协议串 `http=…;https=…` → 取 https 那段；`ProxyEnable 0x0` → `None`。
- 环境变量优先于系统代理。
- 环境变量里已经带 `http://` scheme 时原样返回，不重复补。
- **`all_proxy=socks5://127.0.0.1:7897` + `https_proxy=http://127.0.0.1:7897` → 取后者。** 这条直接照抄 owner 机器上的真实环境，是这份规格里最容易写错、错了又最难发现的一处（编译通过、开发机上因为 https_proxy 恰好也在而看不出来，只有 socks-only 的用户会炸）。
- 只有 `all_proxy=socks5://…`、没有任何 http 代理 → `None`（**不是** 那个 socks 地址）。
- macOS 只有 `SOCKSEnable : 1`、HTTP/HTTPS 都关 → `None`。
