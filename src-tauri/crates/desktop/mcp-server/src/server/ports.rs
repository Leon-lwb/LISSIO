//! 监听端口检查 — 冲突诊断、占用者识别与替代端口建议。
//!
//! MCP 监听端口是用户可见的配置 (设置 → AI → MCP / `--mcp-port` / `LISSIO_MCP_PORT`),
//! 所以端口被占用时必须能解释清楚: 谁占了、还能用哪个、是不是系统保留区间。
//! [`check_port`] 是这条诊断链路的唯一入口。
//!
//! 检查是**建议性**的: 探测用"先绑再释放", 与真正的监听之间存在竞态, 冲突判定仍以
//! [`crate::start`] 的 bind 结果为准。占用者识别调用系统工具 (`netstat` + `tasklist`、
//! `lsof`), 工具缺失或被限制时只报"端口不可用", 不猜进程。

use serde::Serialize;

/// 向上搜索替代端口的跨度 — 超出则不再建议。
const SUGGEST_SPAN: u16 = 32;

/// 一次端口检查的结果。
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct PortCheck {
    /// 被检查的端口。
    pub port: u16,
    /// 当前能否绑定 `127.0.0.1:port`。
    pub available: bool,
    /// 占用该端口的进程 (形如 `chrome.exe (PID 1234)`; 识别不到为 `None`)。
    pub occupant: Option<String>,
    /// 端口不可用但未识别到占用进程 — 多为系统保留区间 (Hyper-V / WSL2 / Docker)
    /// 或权限限制, 而不是某个程序的监听套接字。
    pub reserved_hint: bool,
    /// 从 `port` 向上找到的第一个可用端口 (被检查端口本身可用时为 `None`)。
    pub suggested_port: Option<u16>,
}

/// 检查 `port` 能否用于监听, 并在不可用时给出冲突诊断与替代端口。
///
/// 被检查端口可用时只回报事实; 不可用时按"探测 → 识别占用者 → 向上找可用端口"
/// 补齐诊断信息 (系统工具不可用也不会失败)。
#[must_use]
pub fn check_port(port: u16) -> PortCheck {
    if probe(port) {
        return PortCheck {
            port,
            available: true,
            occupant: None,
            reserved_hint: false,
            suggested_port: None,
        };
    }
    let occupant = occupant(port);
    PortCheck {
        port,
        available: false,
        reserved_hint: occupant.is_none(),
        occupant,
        suggested_port: suggest_port(port),
    }
}

/// `127.0.0.1:port` 当前能否绑定 (绑上立即释放)。
fn probe(port: u16) -> bool {
    std::net::TcpListener::bind(("127.0.0.1", port)).is_ok()
}

/// 从 `port` 向上找第一个可用端口, 最多 [`SUGGEST_SPAN`] 个候选。
fn suggest_port(port: u16) -> Option<u16> {
    let start = port.checked_add(1)?;
    (start..=port.saturating_add(SUGGEST_SPAN)).find(|candidate| probe(*candidate))
}

/// 占用 `port` 的进程描述 — 平台工具取不到时返回 `None`。
fn occupant(port: u16) -> Option<String> {
    platform_occupant(port)
}

/// Windows: `netstat -ano` 拿 PID, `tasklist` 拿进程名。
#[cfg(windows)]
fn platform_occupant(port: u16) -> Option<String> {
    let table = run("netstat", &["-ano", "-p", "tcp"])?;
    let pid = parse_netstat_pid(&table, port)?;
    let name = run(
        "tasklist",
        &["/FI", &format!("PID eq {pid}"), "/FO", "CSV", "/NH"],
    )
    .and_then(|output| parse_tasklist_name(&output));
    Some(name.map_or_else(
        || format!("PID {pid}"),
        |name| format!("{name} (PID {pid})"),
    ))
}

/// Unix: `lsof` 直接给出监听进程。
#[cfg(unix)]
fn platform_occupant(port: u16) -> Option<String> {
    let listing = run("lsof", &["-nP", &format!("-iTCP:{port}"), "-sTCP:LISTEN"])?;
    parse_lsof_listener(&listing)
}

/// 其它平台不猜进程 — 端口事实仍然正确。
#[cfg(not(any(windows, unix)))]
fn platform_occupant(_port: u16) -> Option<String> {
    None
}

/// 执行系统工具并取 stdout — 工具缺失、退出码非零或输出非 UTF-8 都按"识别不到"处理。
#[cfg(any(windows, unix))]
fn run(program: &str, args: &[&str]) -> Option<String> {
    let output = std::process::Command::new(program)
        .args(args)
        .output()
        .ok()?;
    if !output.status.success() {
        return None;
    }
    String::from_utf8(output.stdout).ok()
}

/// `netstat -ano -p tcp` 输出里监听 `port` 的 PID — 优先 `LISTENING` 行。
///
/// 状态列在非英文系统上可能被本地化, 所以匹配不到 `LISTENING` 时退回同端口的第一行,
/// 而不是直接放弃。
#[cfg(any(windows, test))]
fn parse_netstat_pid(text: &str, port: u16) -> Option<u32> {
    let mut fallback = None;
    for line in text.lines() {
        let columns: Vec<&str> = line.split_whitespace().collect();
        if columns.len() < 5 || !columns[0].eq_ignore_ascii_case("TCP") {
            continue;
        }
        if local_port(columns[1]) != Some(port) {
            continue;
        }
        let Ok(pid) = columns[4].parse::<u32>() else {
            continue;
        };
        if columns[3].eq_ignore_ascii_case("LISTENING") {
            return Some(pid);
        }
        fallback = fallback.or(Some(pid));
    }
    fallback
}

/// 本地地址列 (`127.0.0.1:8765` / `[::]:8765`) 的端口部分。
#[cfg(any(windows, test))]
fn local_port(address: &str) -> Option<u16> {
    address.rsplit(':').next()?.parse().ok()
}

/// `tasklist /FO CSV /NH` 第一行的进程名 (去掉引号)。
#[cfg(any(windows, test))]
fn parse_tasklist_name(text: &str) -> Option<String> {
    let line = text.lines().find(|line| !line.trim().is_empty())?;
    let name = line
        .split(',')
        .next()?
        .trim()
        .trim_matches('"')
        .trim()
        .to_string();
    (!name.is_empty()).then_some(name)
}

/// `lsof -nP -iTCP:<port> -sTCP:LISTEN` 输出里第一行监听进程。
#[cfg(any(unix, test))]
fn parse_lsof_listener(text: &str) -> Option<String> {
    for line in text.lines().skip(1) {
        let columns: Vec<&str> = line.split_whitespace().collect();
        let (Some(command), Some(pid)) = (columns.first(), columns.get(1)) else {
            continue;
        };
        if pid.parse::<u32>().is_err() {
            continue;
        }
        return Some(format!("{command} (PID {pid})"));
    }
    None
}

#[cfg(test)]
#[path = "ports_tests.rs"]
mod tests;
