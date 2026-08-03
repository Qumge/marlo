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
    ENV_KEYS
        .iter()
        .filter_map(|k| get(k))
        .find_map(|v| normalize(&v))
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
#[cfg_attr(not(target_os = "macos"), allow(dead_code))]
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
            if it.next()? != name {
                return None;
            }
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
        // 顺带这也是 SOCKS-only 的情形：这份样本里 SOCKSEnable 本来就是 1。
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
