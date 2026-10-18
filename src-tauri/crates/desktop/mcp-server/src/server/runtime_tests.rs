//! MCP 启动端口决策的优先级测试 — 证明两个组合根共享同一份顺序。
//!
//! 环境变量是进程级状态, 不能在本进程内安全地改写, 因此优先级本身由纯函数
//! ([`super::decide`]) 穷举断言; [`super::resolve_mcp_port`] 只再验证"注入的
//! 设置层确实被采用"与"`--no-mcp` 关闭端口决策"。

use super::{DEFAULT_MCP_PORT, MCP_PORT_ENV, decide, resolve_mcp_port, resolve_port};

/// `LISSIO_MCP_PORT` 的有效值 — 与实现同义 (非法/空白视为未配置)。
fn env_port() -> Option<u16> {
    std::env::var(MCP_PORT_ENV)
        .ok()
        .and_then(|value| value.trim().parse().ok())
}

/// 文档化顺序: 显式参数 > `LISSIO_MCP_PORT` > `settings.json` > 默认值。
#[test]
fn precedence_is_explicit_then_env_then_settings_then_default() {
    assert_eq!(decide(Some(9001), Some(9002), || Some(9003)), 9001);
    assert_eq!(decide(None, Some(9002), || Some(9003)), 9002);
    assert_eq!(decide(None, None, || Some(9003)), 9003);
    assert_eq!(decide(None, None, || None), DEFAULT_MCP_PORT);
}

/// `--mcp-port 0` = 由操作系统分配端口, 是"已给出"的显式值而非缺省。
#[test]
fn explicit_zero_is_not_treated_as_missing() {
    assert_eq!(decide(Some(0), Some(9002), || Some(9003)), 0);
}

/// `--no-mcp` 必须关闭端口决策 — `serve --no-http --no-mcp` 靠它不启动 MCP。
#[test]
fn disabled_never_yields_a_port() {
    assert_eq!(resolve_mcp_port(Some(9001), true, || Some(9002)), None);
    assert_eq!(resolve_mcp_port(None, true, || None), None);
}

/// 显式端口优先于设置文件, 且设置层闭包在显式值存在时不会被采用。
#[test]
fn explicit_port_wins_over_the_settings_layer() {
    let mut called = false;
    let resolved = resolve_mcp_port(Some(9001), false, || {
        called = true;
        Some(9002)
    });
    assert_eq!(resolved, Some(9001));
    assert!(!called, "显式端口已定案时不应再读设置文件");
}

/// 设置层是调用方注入的文件来源: 无显式值与无环境变量时必须被采用,
/// 且前面的层已定案时不再读设置文件 (短路)。
#[test]
fn settings_layer_is_used_when_explicit_and_env_are_absent() {
    let env = env_port();
    let resolved = resolve_mcp_port(None, false, || Some(9003));
    assert_eq!(resolved, env.or(Some(9003)));
    if let Some(env_port) = env {
        assert_eq!(
            resolved,
            Some(env_port),
            "LISSIO_MCP_PORT 必须优先于设置文件"
        );
    }
}

/// `resolve_port` 是"无设置文件来源"的兜底 (Tauri AI 宿主运行期重启)。
#[test]
fn resolve_port_falls_back_to_env_then_default() {
    assert_eq!(resolve_port(Some(9004)), 9004);
    assert_eq!(resolve_port(None), env_port().unwrap_or(DEFAULT_MCP_PORT));
}
