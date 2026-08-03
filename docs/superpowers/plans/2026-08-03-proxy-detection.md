# 应用自己找到代理 —— 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 墙后的用户开着 VPN 就能下载语音模型、也能连上 qumge —— 不用配任何东西。

**Architecture:** 壳里新增一个 std-only 模块 `proxy.rs` 回答「这台机器上该用哪个代理」（环境变量优先，其次 macOS `scutil` / Windows 注册表）。两个消费者显式取用：Python 边车在 spawn 时注入 `HTTPS_PROXY`/`ALL_PROXY`（httpx 自己认，Python 一行不改），语音模型下载每次点的时候现取并传给 ureq 的 `.proxy()`。

**Tech Stack:** Rust（Tauri 壳 `openworker-desktop` + `ocw-stt` 库，都是 edition 2021）；React + Vitest（提示文案）。

**规格：** `docs/superpowers/specs/2026-08-03-proxy-detection-design.md`

## Global Constraints

- **Rust 必须用 rustup 那套工具链。** PATH 上的 Homebrew rustc 是 1.87，而锁文件要 1.88+。每条 cargo 命令前面加：
  ```
  PATH=$HOME/.rustup/toolchains/stable-aarch64-apple-darwin/bin:$PATH
  ```
  不加的话报的是一串 `requires rustc 1.88`，和你的改动无关。
- **`cmake` 已装**（4.4.2，本计划开工前装的）。没有它 `whisper-rs-sys` 编不了，整个壳连 `cargo check` 都过不去。
- **SOCKS 一律跳过。** ureq 的 socks 在没开的 feature 后面，关着时是**运行时**才报 `SOCKS feature disabled.`；httpx 走 socks 要 `socksio`，而它不是 `pyproject.toml` 里声明的依赖。判据写成**白名单**（只认 `http://` 和裸 `host:port`），不是黑名单。
- **i18n：`en.ts` 是唯一真源。** 每加一条 key 必须同时加进 `zh.ts`，漏了 `npx tsc --noEmit` 会炸。
- **前端测试命令：** `cd surfaces/gui && npx vitest run <file>`。
- **本机 pytest 基准是 5 failed，不是 0** —— 本计划不碰 Python，但全量回归时会看到。

---

### Task 1: `proxy.rs` —— 检测与解析

**Files:**
- Create: `surfaces/gui/src-tauri/src/proxy.rs`
- Test: 同一个文件里的 `#[cfg(test)] mod tests`

**Interfaces:**
- Produces: `pub fn detect() -> Option<String>` —— 返回 `http://host:port`，找不到就是 `None`。Task 3 用它。

- [ ] **Step 1: 写整个模块，测试在前**

新建 `surfaces/gui/src-tauri/src/proxy.rs`：

```rust
//! 这台机器上该用哪个代理。
//!
//! 【为什么需要它】lib.rs 顶上那段注释写着「A Finder-launched app has no shell env」——
//! 双击启动的应用没有 shell 环境变量。而边车用的 httpx 靠 HTTPS_PROXY 认代理，语音模型
//! 下载用的 ureq 连环境变量都不读（proxy-from-env 那个 feature 没开）。于是墙后的用户
//! 开着 VPN 也连不上：qumge 直连 15 秒超时，huggingface 的 TLS 握手被重置。
//!
//! 检测在这里做一次，两个消费者显式取用（见 lib.rs）。不用 std::env::set_var 那套：
//! 那是进程级全局副作用，而且 ureq 那条路会变成隐式的 —— 将来谁给它加个
//! default-features = false，代理就静悄悄断了，断的表现是「墙后用户下载失败」。

/// 环境变量的查找顺序。
///
/// 【ALL_PROXY 排在最后，不是最前】常见客户端把 ALL_PROXY 导成 socks5://，而 socks
/// 我们用不了（见 normalize）。这个仓库 owner 自己的机器就是这样：
///   all_proxy=socks5://127.0.0.1:7897
///   https_proxy=http://127.0.0.1:7897   ← 要的是这个
const ENV_KEYS: [&str; 6] = [
    "HTTPS_PROXY",
    "https_proxy",
    "HTTP_PROXY",
    "http_proxy",
    "ALL_PROXY",
    "all_proxy",
];

/// 这台机器上该用哪个代理，形如 `http://127.0.0.1:7897`。
///
/// 环境变量优先（终端启动的情况，也是高级用户手动指定的唯一出口），其次问操作系统。
pub fn detect() -> Option<String> {
    pick_env(|k| std::env::var(k).ok()).or_else(from_system)
}

/// 【取 get 闭包而不是直接读 env】读真环境变量的测试要改进程状态，而 cargo test 默认
/// 多线程跑 —— 那种测试之间会互相踩。这样顺序逻辑可以用一张假表测，不碰进程。
fn pick_env(get: impl Fn(&str) -> Option<String>) -> Option<String> {
    ENV_KEYS.iter().filter_map(|k| get(k)).find_map(|v| normalize(&v))
}

/// 只认两种形状：`http://host:port` 和裸的 `host:port`（补成前者）。
///
/// 【白名单，不是黑名单】漏掉一种 scheme，漏掉的那种会一路走到运行时才炸：ureq 关着
/// socks feature 时不是编译错误，是连接时返回 "SOCKS feature disabled."（stream.rs:623）。
/// `https://`（代理本身跑在 TLS 上）ureq 的 Proxy::new 也不收 —— 它只认 http / socks*。
///
/// 【要求带端口】`HTTP_PROXY=proxy.corp` 这种不带端口的写法，补默认端口就是猜；猜错的
/// 表现和没有代理一样难查。宁可当作没有，让用户看到「没有检测到系统代理」。
fn normalize(raw: &str) -> Option<String> {
    let v = raw.trim().trim_end_matches('/');
    if v.is_empty() {
        return None;
    }
    let rest = match v.split_once("://") {
        Some(("http", rest)) => rest,
        Some(_) => return None,
        None => v,
    };
    if !rest.contains(':') || rest.starts_with(':') || rest.ends_with(':') {
        return None;
    }
    Some(format!("http://{rest}"))
}

#[cfg(target_os = "macos")]
fn from_system() -> Option<String> {
    // 壳里已经有 Command::new("caffeinate") / "/usr/bin/open" 这类外部命令，scutil 走的
    // 是同一条既有路子 —— 为读一次系统设置引一个 crate 不值。
    let out = std::process::Command::new("/usr/sbin/scutil")
        .arg("--proxy")
        .output()
        .ok()?;
    parse_scutil(&String::from_utf8_lossy(&out.stdout))
}

#[cfg(target_os = "windows")]
fn from_system() -> Option<String> {
    let out = std::process::Command::new("reg")
        .args([
            "query",
            r"HKCU\Software\Microsoft\Windows\CurrentVersion\Internet Settings",
        ])
        .output()
        .ok()?;
    parse_winreg(&String::from_utf8_lossy(&out.stdout))
}

#[cfg(not(any(target_os = "macos", target_os = "windows")))]
fn from_system() -> Option<String> {
    None
}

/// `scutil --proxy` 的输出：
///
/// ```text
/// <dictionary> {
///   HTTPEnable : 1
///   HTTPPort : 7897
///   HTTPProxy : 127.0.0.1
///   HTTPSEnable : 1
///   ...
/// }
/// ```
///
/// 【Enable 必须看】字段在、值是 0 的时候代理是关着的。只看有没有 HTTPProxy，会给出
/// 一个用户已经关掉的代理，然后每个请求都超时。
fn parse_scutil(out: &str) -> Option<String> {
    let field = |name: &str| -> Option<String> {
        out.lines().find_map(|line| {
            let rest = line.trim().strip_prefix(name)?.trim_start();
            let v = rest.strip_prefix(':')?.trim();
            (!v.is_empty()).then(|| v.to_string())
        })
    };
    let pick = |enable: &str, host: &str, port: &str| -> Option<String> {
        if field(enable)? != "1" {
            return None;
        }
        normalize(&format!("{}:{}", field(host)?, field(port)?))
    };
    pick("HTTPSEnable", "HTTPSProxy", "HTTPSPort")
        .or_else(|| pick("HTTPEnable", "HTTPProxy", "HTTPPort"))
}

/// `reg query …\Internet Settings` 的输出：
///
/// ```text
///     ProxyEnable    REG_DWORD    0x1
///     ProxyServer    REG_SZ    127.0.0.1:7890
/// ```
///
/// ProxyServer 有两种形状：裸的 `host:port`，或者分协议的
/// `http=1.2.3.4:80;https=1.2.3.4:443;socks=…` —— 后者取 https，没有就取 http，
/// socks 那段永远不取。
#[cfg_attr(not(target_os = "windows"), allow(dead_code))]
fn parse_winreg(out: &str) -> Option<String> {
    let val = |name: &str| -> Option<String> {
        out.lines().find_map(|line| {
            let mut it = line.split_whitespace();
            (it.next()? == name).then(|| ())?;
            it.next()?; // 类型列（REG_DWORD / REG_SZ）
            let v = it.collect::<Vec<_>>().join(" ");
            (!v.is_empty()).then(|| v)
        })
    };
    if val("ProxyEnable")? != "0x1" {
        return None;
    }
    let server = val("ProxyServer")?;
    if !server.contains('=') {
        return normalize(&server);
    }
    // "https=" 要先试：strip_prefix("http=") 匹配不上 "https=…"（第五个字符是 s 不是 =），
    // 所以两条互不干扰，但顺序仍然要 https 在前 —— 我们下载的是 https。
    let part = |k: &str| {
        server
            .split(';')
            .find_map(|s| s.trim().strip_prefix(k).map(str::to_string))
    };
    // 先绑到变量再借：`part(..).or_else(..).as_deref()` 借的是一个临时 Option，
    // 借用检查器会拒（temporary value dropped while borrowed）。
    let picked = part("https=").or_else(|| part("http="))?;
    normalize(&picked)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::HashMap;

    fn env_of(pairs: &[(&str, &str)]) -> impl Fn(&str) -> Option<String> {
        let map: HashMap<String, String> = pairs
            .iter()
            .map(|(k, v)| (k.to_string(), v.to_string()))
            .collect();
        move |k: &str| map.get(k).cloned()
    }

    const SCUTIL: &str = "\
<dictionary> {
  ExceptionsList : <array> {
    0 : *.local
  }
  FTPPassive : 1
  HTTPEnable : 1
  HTTPPort : 7897
  HTTPProxy : 127.0.0.1
  HTTPSEnable : 1
  HTTPSPort : 7897
  HTTPSProxy : 127.0.0.1
  SOCKSEnable : 1
  SOCKSPort : 7897
  SOCKSProxy : 127.0.0.1
}";

    #[test]
    fn reads_the_macos_system_proxy() {
        assert_eq!(parse_scutil(SCUTIL).as_deref(), Some("http://127.0.0.1:7897"));
    }

    #[test]
    fn a_switched_off_proxy_is_not_a_proxy() {
        // 【否定对照】字段还在，值是 0。只看有没有 HTTPProxy 的话，会返回一个用户
        // 已经关掉的代理，然后每个请求都超时 —— 比没有代理更难查。
        let off = SCUTIL
            .replace("HTTPEnable : 1", "HTTPEnable : 0")
            .replace("HTTPSEnable : 1", "HTTPSEnable : 0");
        assert_eq!(parse_scutil(&off), None);
    }

    #[test]
    fn falls_back_to_the_http_proxy_when_https_is_off() {
        let only_http = SCUTIL.replace("HTTPSEnable : 1", "HTTPSEnable : 0");
        assert_eq!(
            parse_scutil(&only_http).as_deref(),
            Some("http://127.0.0.1:7897")
        );
    }

    #[test]
    fn socks_is_never_a_candidate() {
        // ureq 关着 socks feature，httpx 没有 socksio —— 两边都用不了它。给出一个
        // 用不了的地址，比说"没检测到"更糟：前者每个请求都炸，后者用户知道该去开
        // 客户端的 HTTP 代理。
        //
        // （scutil 那边 SOCKS-only 的情形由上面 a_switched_off_proxy_is_not_a_proxy
        // 覆盖 —— 那份样本里 SOCKSEnable 本来就是 1，把两个 HTTP 开关关掉之后剩下的
        // 正是 SOCKS-only。）
        assert_eq!(normalize("socks5://127.0.0.1:7897"), None);
        assert_eq!(normalize("socks://127.0.0.1:7897"), None);
        assert_eq!(normalize("socks4://127.0.0.1:7897"), None);
    }

    #[test]
    fn env_beats_the_system_and_http_beats_socks() {
        // 【这一条照抄 owner 机器上的真实环境】ALL_PROXY 排在最前的话会选中 socks5，
        // 而那在两个消费者上都是运行时才炸。开发机上因为 https_proxy 恰好也在，
        // 症状看不出来 —— 只有 socks-only 的用户会踩。
        let get = env_of(&[
            ("all_proxy", "socks5://127.0.0.1:7897"),
            ("https_proxy", "http://127.0.0.1:7897"),
        ]);
        assert_eq!(pick_env(get).as_deref(), Some("http://127.0.0.1:7897"));
    }

    #[test]
    fn only_socks_in_the_env_is_no_proxy() {
        let get = env_of(&[("all_proxy", "socks5://127.0.0.1:7897")]);
        assert_eq!(pick_env(get), None);
    }

    #[test]
    fn a_bare_host_port_gets_a_scheme_and_a_schemeless_hostname_is_rejected() {
        assert_eq!(
            normalize("127.0.0.1:7890").as_deref(),
            Some("http://127.0.0.1:7890")
        );
        assert_eq!(
            normalize("http://127.0.0.1:7890/").as_deref(),
            Some("http://127.0.0.1:7890")
        );
        // 不带端口就补一个默认值等于猜，猜错的表现和没有代理一样难查。
        assert_eq!(normalize("proxy.corp"), None);
        assert_eq!(normalize(""), None);
        assert_eq!(normalize("https://proxy.corp:443"), None);
    }

    const WINREG: &str = "\
HKEY_CURRENT_USER\\Software\\Microsoft\\Windows\\CurrentVersion\\Internet Settings
    ProxyEnable    REG_DWORD    0x1
    ProxyServer    REG_SZ    127.0.0.1:7890
";

    #[test]
    fn reads_the_windows_system_proxy() {
        assert_eq!(parse_winreg(WINREG).as_deref(), Some("http://127.0.0.1:7890"));
    }

    #[test]
    fn windows_per_protocol_string_takes_https_never_socks() {
        let per_proto = WINREG.replace(
            "127.0.0.1:7890",
            "http=1.2.3.4:80;https=1.2.3.4:443;socks=1.2.3.4:1080",
        );
        assert_eq!(
            parse_winreg(&per_proto).as_deref(),
            Some("http://1.2.3.4:443")
        );
    }

    #[test]
    fn windows_proxy_disabled_is_no_proxy() {
        let off = WINREG.replace("0x1", "0x0");
        assert_eq!(parse_winreg(&off), None);
    }
}
```

- [ ] **Step 2: 挂上模块并跑测试，确认失败**

`surfaces/gui/src-tauri/src/lib.rs` 的 `use` 之前加一行：

```rust
mod proxy;
```

Run:
```
cd surfaces/gui/src-tauri && PATH=$HOME/.rustup/toolchains/stable-aarch64-apple-darwin/bin:$PATH cargo test -p openworker-desktop --lib
```

Expected: 编译错误或测试失败 —— 这一步是为了确认测试真的在跑（上一次跑是 `running 0 tests`）。如果编译不过，按报错修 `proxy.rs`，别改测试。

- [ ] **Step 3: 跑到全绿**

Run: 同上。
Expected: `10 passed`（这个模块的 10 条），`test result: ok`。

`detect()` 此刻还没有调用方，编译器会报 `dead_code` 警告 —— Task 3 接上就没了，这一步不用管。

- [ ] **Step 4: 提交**

```bash
git add surfaces/gui/src-tauri/src/proxy.rs surfaces/gui/src-tauri/src/lib.rs
git commit -m "feat: 壳里知道这台机器该用哪个代理

lib.rs 顶上那段注释写着「A Finder-launched app has no shell env」。而边车用的 httpx
靠 HTTPS_PROXY 认代理 —— 双击启动的打包版拿不到它，墙后的用户连 qumge 都连不上
（实测直连 15 秒超时）。

环境变量优先，其次 macOS scutil / Windows 注册表。socks 一律跳过：ureq 的 socks 在
没开的 feature 后面（关着时是【运行时】才报错），httpx 走 socks 要 socksio 而它不是
声明的依赖。判据是白名单不是黑名单 —— 漏一种 scheme，漏掉的那种会一路走到运行时。"
```

---

### Task 2: `ocw-stt` —— 下载走代理

**Files:**
- Modify: `stt/src/lib.rs:130-133`（删死函数）、`stt/src/lib.rs:138-141`（签名）、`stt/src/lib.rs:166-169`（agent）

**Interfaces:**
- Produces: `pub fn install_default_model_with_progress(&self, proxy: Option<&str>, on_progress: impl FnMut(DownloadProgress)) -> Result<(), String>`。Task 3 按这个签名调用。

- [ ] **Step 1: 删掉零调用的那个包装**

`stt/src/lib.rs:130-134` 整段删掉：

```rust
    /// Downloads the default model atomically. Hosts should call this only after an explicit
    /// user action because it is a sizeable download.
    pub fn install_default_model(&self) -> Result<(), String> {
        self.install_default_model_with_progress(|_| {})
    }
```

全仓库零调用（`grep -rn "install_default_model\b"` 只命中它自己的定义）。给它也加一个 proxy 参数，等于凭空造一条「悄悄不走代理」的路 —— 正是这次要消灭的东西。这个 crate 是 path 依赖（`ocw-stt = { path = "../../../stt" }`），没发布，只有一个消费者。

- [ ] **Step 2: 改签名**

`stt/src/lib.rs:138-141`：

```rust
    /// Downloads and verifies the default model atomically, reporting byte progress to the host.
    /// A canceled/failed transfer never replaces a previously verified model.
    ///
    /// `proxy` 形如 `http://127.0.0.1:7897`，由宿主决定（壳里的 proxy::detect）。这个
    /// 库【不自己去探】：探测要读环境变量和操作系统设置，那是宿主的事，两处各探一遍
    /// 必然会漂。传 None 就是直连。
    pub fn install_default_model_with_progress(
        &self,
        proxy: Option<&str>,
        mut on_progress: impl FnMut(DownloadProgress),
    ) -> Result<(), String> {
```

- [ ] **Step 3: 把代理配到 agent 上**

`stt/src/lib.rs:166-169` 那个 builder 换成：

```rust
            // Per-read timeout, not overall: a 142 MB transfer legitimately takes minutes, but
            // a stalled connection must surface as an error — the cancel flag is only observed
            // between reads, so an indefinitely blocked read would also make Cancel unresponsive.
            let mut builder = ureq::AgentBuilder::new()
                .timeout_connect(std::time::Duration::from_secs(30))
                .timeout_read(std::time::Duration::from_secs(30));
            // 【显式传，不靠 ureq 的 proxy-from-env】那个 feature 没开，而且就算开了，
            // 它读的也只是环境变量 —— 双击启动的 app 没有 shell 环境变量。
            if let Some(p) = proxy {
                builder = builder.proxy(
                    ureq::Proxy::new(p).map_err(|e| format!("Bad proxy {p}: {e}"))?,
                );
            }
            let agent = builder.build();
```

- [ ] **Step 4: 编译，确认只剩调用方那一处错**

Run:
```
cd stt && PATH=$HOME/.rustup/toolchains/stable-aarch64-apple-darwin/bin:$PATH cargo test
```
Expected: PASS（`stt` 自己的测试不调这个函数；`stt/src/lib.rs:654` 那条只用 `Dictation::new`）。壳那边会因为签名变了而编译失败 —— Task 3 修。

- [ ] **Step 5: 提交**

```bash
git add stt/src/lib.rs
git commit -m "feat: 语音模型下载能走代理

AgentBuilder 原来是裸的，没有 .proxy()。而 ureq 读环境变量的能力被 proxy-from-env
这个没开的 feature 关着 —— 所以连从终端启动都救不了它，VPN 开着照样被重置。

代理由宿主传，这个库不自己探：探测要读环境变量和操作系统设置，那是宿主的事，两处
各探一遍必然会漂。

顺带删掉 install_default_model —— 全仓库零调用，给它也加一个 proxy 参数等于凭空造
一条「悄悄不走代理」的路。"
```

---

### Task 3: 壳接线 —— 边车注入 + 下载现取

**Files:**
- Modify: `surfaces/gui/src-tauri/src/lib.rs:491-504`（下载命令）、`:693-715`（命令注册）、`:717-727`（边车 spawn）

**Interfaces:**
- Consumes: Task 1 的 `proxy::detect()`；Task 2 的新签名。
- Produces: Tauri 命令 `system_proxy() -> Option<String>`。Task 4 用它。

- [ ] **Step 1: 边车 spawn 时注入**

`lib.rs:717` 那个 `server_cmd` 的链式调用之后（`.stdin(Stdio::null());` 那一行之后）插入：

```rust
            // 【边车的代理】httpx 默认就读这两个变量（trust_env=True），所以 Python 侧
            // 一行不用改。这里是唯一能设它的时机 —— 进程环境只有 spawn 那一刻能定。
            //
            // 不设 HTTP_PROXY：我们出网的目标全是 https，而多设一个变量就多一处会和
            // 上面那两个不一致。
            if let Some(p) = proxy::detect() {
                server_cmd.env("HTTPS_PROXY", &p).env("ALL_PROXY", &p);
            }
```

- [ ] **Step 2: 下载命令每次现取**

`lib.rs:491-504` 的 `download_dictation_model` 改成：

```rust
#[tauri::command]
async fn download_dictation_model(
    app: tauri::AppHandle,
    state: tauri::State<'_, Arc<Dictation>>,
) -> Result<VoiceInputStatus, String> {
    let dictation = state.inner().clone();
    // 【每次点的时候现取，不缓存】用户很可能刚打开 VPN 就来点这个按钮。启动时探到的
    // 值会是开 VPN 之前的那个空。
    let proxy = proxy::detect();
    tauri::async_runtime::spawn_blocking(move || {
        dictation.install_default_model_with_progress(proxy.as_deref(), |progress: DownloadProgress| {
            let _ = app.emit("dictation-download-progress", progress);
        })?;
        Ok::<VoiceInputStatus, String>(voice_input_status(&dictation))
    })
    .await
    .map_err(|e| format!("Voice model download stopped unexpectedly: {e}"))?
}
```

- [ ] **Step 3: 加 `system_proxy` 命令**

`download_dictation_model` 上面加：

```rust
/// 这台机器上探到的代理，没探到就是 null。
///
/// 【给界面用来解释失败】下载失败时，「网络坏了」和「你的代理没被用上」是两回事，
/// 而后者用户自己能解决（把 VPN 客户端切到系统代理模式）。界面据此决定要不要多说
/// 那一句 —— 文案在界面那边，才能跟着语言走。
#[tauri::command]
fn system_proxy() -> Option<String> {
    proxy::detect()
}
```

并在 `lib.rs:693` 那个 `generate_handler!` 列表里，`download_dictation_model,` 那行上面加一行：

```rust
            system_proxy,
```

- [ ] **Step 4: 编译并跑测试**

Run:
```
cd surfaces/gui/src-tauri && PATH=$HOME/.rustup/toolchains/stable-aarch64-apple-darwin/bin:$PATH cargo test -p openworker-desktop --lib
```
Expected: PASS，10 条测试全绿，且**没有 `dead_code` 警告**（`detect()` 现在有三个调用方了）。

- [ ] **Step 5: 提交**

```bash
git add surfaces/gui/src-tauri/src/lib.rs
git commit -m "feat: 边车和语音模型下载都用上代理

边车在 spawn 时注入 HTTPS_PROXY/ALL_PROXY —— httpx 默认就读它们，Python 侧一行不改。
那也是唯一能设的时机：进程环境只有 spawn 那一刻能定。

下载则每次点的时候现取：用户很可能刚打开 VPN 就来点这个按钮，启动时探到的值会是开
VPN 之前的那个空。"
```

---

### Task 4: 界面把「网络坏了」和「代理没被用上」分开

**Files:**
- Modify: `surfaces/gui/src/tauri.ts:89` 附近（加绑定）
- Create: `surfaces/gui/src/voiceProxyHint.ts`
- Modify: `surfaces/gui/src/components/SettingsView.tsx:202-215`（download 的 catch）
- Modify: `surfaces/gui/src/i18n/en.ts`、`surfaces/gui/src/i18n/zh.ts`
- Test: `surfaces/gui/src/voiceProxyHint.test.ts`（新建）

**【为什么单独一个文件，而不是放进 SettingsView】** 两个理由，都跟测试有关：

1. `SettingsView.tsx` 现在没有任何测试，import 它会把整棵组件树的依赖图拉进来 —— 这个判断只有三行，不值得为它承担一整棵树在 jsdom 里跑不起来的风险。
2. 更实际的：测试要 mock `../tauri`。`vi.mock("../tauri", () => ({ systemProxy: vi.fn() }))` 会把那个模块**整个**换掉，于是 `SettingsView` 从它 import 的其它十来个名字全都不存在，Vitest 在 import 期就抛 "No export is defined on the mock"。一个只 import `systemProxy` 的小模块没有这个问题。

**Interfaces:**
- Consumes: Task 3 的 `system_proxy` 命令。

- [ ] **Step 1: 加前端绑定**

`surfaces/gui/src/tauri.ts` 在 `downloadDictationModel` 那行下面加：

```ts
/** 这台机器上探到的代理，没探到就是 null —— 下载失败时用来解释是不是代理没被用上。 */
export const systemProxy = () => invokeStrict<string | null>("system_proxy");
```

- [ ] **Step 2: 加两条文案**

`en.ts` 里 `setVoiceActionFailed` 附近加：

```ts
  // 【失败时最该说的那句】「连不上」和「你的代理没被用上」是两回事，后者用户自己
  // 能解决（把 VPN 客户端切到系统代理模式）。
  setVoiceNoProxy: "No system proxy detected. If you use a VPN, switch it to system-proxy mode and try again.",
```

`zh.ts` 同一位置：

```ts
  setVoiceNoProxy: "没有检测到系统代理。如果你在用 VPN，把它切到系统代理模式再试一次。",
```

先确认 `setVoiceActionFailed` 在两个文件里的确切行号：

```bash
grep -n "setVoiceActionFailed" surfaces/gui/src/i18n/en.ts surfaces/gui/src/i18n/zh.ts
```

- [ ] **Step 3: 写失败的测试**

新建 `surfaces/gui/src/voiceProxyHint.test.ts`：

```ts
// 下载失败时，「连不上」和「你的代理没被用上」是两回事 —— 后者用户自己能解决。
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./tauri", () => ({ systemProxy: vi.fn() }));

import { systemProxy } from "./tauri";
import { setLocale } from "./i18n";
import { downloadHint } from "./voiceProxyHint";

// 默认 locale 是英文（ModelChecklist.test.tsx 的断言就是英文串）。这里断言中文，
// 所以显式设一下。
beforeEach(() => setLocale("zh"));
afterEach(() => vi.clearAllMocks());

describe("语音模型下载失败时的提示", () => {
  it("没探到代理时，多说一句怎么办", async () => {
    // 用户开着 VPN 却下载失败，看到的是一句 ureq 的英文原话。他没法从那句话知道
    // 问题出在"客户端是系统代理模式还是 TUN 模式"上。
    (systemProxy as any).mockResolvedValue(null);
    expect(await downloadHint()).toContain("系统代理");
  });

  it("探到了代理就不多嘴 —— 那时失败是别的原因", async () => {
    // 【否定对照】代理明明在用还说"没检测到代理"，会把人支到完全错误的方向去。
    (systemProxy as any).mockResolvedValue("http://127.0.0.1:7897");
    expect(await downloadHint()).toBe("");
  });

  it("问不出来时不瞎说", async () => {
    // 命令本身失败（浏览器构建里根本没有 Tauri、老版本的壳没注册这个命令）时，
    // 不能断言"没有代理"—— 那和"探到了"一样是在编造一个我们不知道的事实。
    (systemProxy as any).mockRejectedValue(new Error("unknown command"));
    expect(await downloadHint()).toBe("");
  });
});
```

- [ ] **Step 4: 跑，确认失败**

Run: `cd surfaces/gui && npx vitest run src/voiceProxyHint.test.ts`
Expected: FAIL —— `voiceProxyHint` 这个模块还不存在。

- [ ] **Step 5: 实现 `downloadHint`**

新建 `surfaces/gui/src/voiceProxyHint.ts`：

```ts
import { t } from "./i18n";
import { systemProxy } from "./tauri";

/// 下载失败时要不要多说一句 —— 取决于探没探到代理。
///
/// 三个分支，只有中间那个该说话：
///   探到了     → 不说。代理明明在用还说"没检测到"，会把人支到完全错误的方向。
///   没探到     → 说。这是用户自己能解决的那一种失败（把 VPN 切到系统代理模式）。
///   问不出来   → 不说。浏览器构建里没有 Tauri，老版本的壳没注册这个命令 —— 那时
///                断言"没有代理"和断言"有代理"一样，都是在编造我们不知道的事实。
export const downloadHint = async (): Promise<string> => {
  const proxy = await systemProxy().catch(() => "unknown");
  return proxy === null ? t("setVoiceNoProxy") : "";
};
```

先确认 `t` 在 `./i18n` 里是这么导出的（`SettingsView.tsx:148` 的 `voiceError` 直接用了 `t(...)`，照它的写法来）：

```bash
grep -n "^export const t\|^export function t\|export { t" surfaces/gui/src/i18n/index.ts
```

- [ ] **Step 6: 跑到全绿，再接进 SettingsView**

Run: `cd surfaces/gui && npx vitest run src/voiceProxyHint.test.ts`
Expected: PASS，3 条。

绿了之后接线。`SettingsView.tsx` 顶部 import 里加：

```tsx
import { downloadHint } from "../voiceProxyHint";
```

`download()` 的 catch（207-211 行）改成：

```tsx
    } catch (downloadError) {
      const hint = await downloadHint();
      setError([voiceError(downloadError), hint].filter(Boolean).join(" "));
      const latest = await getDictationStatus();
      if (latest) publish(latest);
    } finally {
```

- [ ] **Step 7: 全量回归**

Run: `cd surfaces/gui && npx vitest run`
Expected: PASS（全部）。

Run: `cd surfaces/gui && npx tsc --noEmit`
Expected: 无输出。漏了 `zh.ts` 那条会在这里炸。

Run:
```
cd surfaces/gui/src-tauri && PATH=$HOME/.rustup/toolchains/stable-aarch64-apple-darwin/bin:$PATH cargo test -p openworker-desktop --lib
```
Expected: PASS。

- [ ] **Step 8: 提交**

```bash
git add surfaces/gui/src/tauri.ts surfaces/gui/src/components/SettingsView.tsx \
        surfaces/gui/src/voiceProxyHint.ts surfaces/gui/src/voiceProxyHint.test.ts \
        surfaces/gui/src/i18n/en.ts surfaces/gui/src/i18n/zh.ts
git commit -m "fix: 下载失败时说清楚是不是代理没被用上

用户开着 VPN 却下载失败，看到的是一句 ureq 的英文原话 —— 从那句话没法知道问题出在
客户端是系统代理模式还是 TUN 模式上。没探到代理时多说一句该怎么办；探到了就不多嘴
（代理明明在用还说没检测到，会把人支到完全错误的方向）。"
```

---

## 收尾时的人工验证（测试覆盖不到的那部分）

自动化测试盖的是解析和分支。真正要确认的那件事 —— **代理有没有真的被用上** —— 只能手动看一次：

1. `cd surfaces/gui && npm run tauri:dev`，进设置 → 语音输入 → 下载模型。终端启动的情况下，环境变量那条路会命中。
2. 更关键的是**双击启动**那条路（`npm run tauri:build` 之后打开 .app）：那时没有 shell 环境变量，走的是 `scutil` 那条。这是这次改动唯一真正新增的能力，也是唯一没有自动化守卫的地方。
3. 验证边车那半：双击启动后打开技能页，目录应该能出结果（改动之前那里是连不上的）。
