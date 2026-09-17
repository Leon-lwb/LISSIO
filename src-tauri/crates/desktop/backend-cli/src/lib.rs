//! # backend-cli
//!
//! 无界面后端宿主 (组合根级) — 与 Tauri 组合根 (`lissio`) 共用同一份装配与
//! 能力核心, 保证 GUI 与 CLI 看到的适配器注册、点位投影、工作区恢复、收尾
//! 行为完全一致:
//!
//! - 装配: [`backend_host`] (`build_acquisition_runtime` / `install_point_observer` /
//!   `restore_workspace` / `shutdown`);
//! - 能力: [`control_api`] (与 MCP 工具 / Tauri IPC 同一函数, 零重复);
//! - 事件: [`events::BackendEventSink`] 端口的 stderr JSON-lines 实现;
//! - 常驻: `serve` 子命令在进程内启动 [`mcp_server`] (127.0.0.1)。
//!
//! 本 crate 不依赖 Tauri。输出约定: 命令结果以 JSON 打印到 stdout, 诊断与
//! 事件走 stderr, 错误以非零退出码结束。

pub mod cmd;
pub mod sink;

use std::sync::Arc;

use events::EventSinkHandle;

/// 已装配的无界面后端宿主 — 一次性子命令与 `serve` 共用。
///
/// 装配本体在 [`backend_host::assemble`] (GUI 与全部无界面出口同源); 本出口
/// 只提供 stderr JSON-lines 事件端口。
pub use backend_host::BackendHost as Host;

/// CLI 入口 — 解析参数并在多线程 tokio 运行时上执行。
///
/// 返回进程退出码: 0 成功, 1 命令失败 (错误已打印到 stderr)。
pub fn run() -> i32 {
    env_logger::Builder::from_env(env_logger::Env::default().default_filter_or("info"))
        .format_timestamp_millis()
        .init();
    let cli = clap::Parser::parse();
    let runtime = match tokio::runtime::Builder::new_multi_thread()
        .enable_all()
        .build()
    {
        Ok(runtime) => runtime,
        Err(error) => {
            eprintln!("tokio runtime init failed: {error}");
            return 1;
        }
    };
    match runtime.block_on(cmd::execute(cli)) {
        Ok(()) => 0,
        Err(error) => {
            eprintln!("error: {error}");
            1
        }
    }
}

/// 装配无界面后端 (适配器注册 + 点位观察者 + 可选工作区恢复 + 后台任务)。
///
/// 与 GUI 组合根 `.setup` 的顺序一致: 装配 → 观察者 → 恢复 (后台语义此处
/// 同步 await) → `signal_restore_done` → 录制启动 → 后台任务。
pub async fn assemble(restore: bool) -> Result<Host, String> {
    let sink: EventSinkHandle = Arc::new(sink::CliEventSink);
    backend_host::assemble(None, restore, sink).await
}

/// 收尾 — 停录制并把未落盘的工作区变更同步写盘 (幂等)。
pub fn teardown(host: &Host) {
    backend_host::teardown(host);
}

/// 把命令结果以 pretty JSON 打印到 stdout。
pub fn print_json(value: &serde_json::Value) {
    match serde_json::to_string_pretty(value) {
        Ok(text) => println!("{text}"),
        Err(error) => eprintln!("result serialization failed: {error}"),
    }
}

/// 解析 `rpc` 子命令的参数 — 内联 JSON 或 `@文件路径`, 缺省为空对象。
///
/// 形状与前端 `invoke(cmd, args)` 的第二个参数一致 (顶层 camelCase), 因此
/// `backend-cli rpc update_tab_graph --args '{"tabId":"t1",...}'` 与浏览器
/// 发出的请求走同一份派发与参数归一。
pub fn parse_json_arg(raw: Option<&str>) -> Result<serde_json::Value, String> {
    let Some(raw) = raw.map(str::trim).filter(|value| !value.is_empty()) else {
        return Ok(serde_json::json!({}));
    };
    let text = match raw.strip_prefix('@') {
        Some(path) => read_json_text(path)?,
        None => raw.to_string(),
    };
    serde_json::from_str(&text).map_err(|error| format!("参数 JSON 解析失败: {error}"))
}

/// 读取 `@文件路径` 形式的内联参数。
fn read_json_text(path: &str) -> Result<String, String> {
    std::fs::read_to_string(path).map_err(|error| format!("读取 {path} 失败: {error}"))
}

/// 解析 hex 字节串 — 接受 `AABB` / `AA BB` / `0xAA,0xBB` 三种写法。
pub fn parse_hex(input: &str) -> Result<Vec<u8>, String> {
    let cleaned: String = input
        .split([' ', ',', ':'])
        .map(str::trim)
        .filter(|segment| !segment.is_empty())
        .map(|segment| {
            segment
                .strip_prefix("0x")
                .or_else(|| segment.strip_prefix("0X"))
                .unwrap_or(segment)
        })
        .collect();
    if cleaned.is_empty() {
        return Ok(Vec::new());
    }
    if !cleaned.len().is_multiple_of(2) {
        return Err(format!("hex 字节串长度必须为偶数: {input}"));
    }
    (0..cleaned.len())
        .step_by(2)
        .map(|index| {
            u8::from_str_radix(&cleaned[index..index + 2], 16)
                .map_err(|error| format!("hex 字节串解析失败 ({input}): {error}"))
        })
        .collect()
}

/// 解析 `name=value` 键值对列表 (命令帧 var_ref 输入)。
pub fn parse_inputs(pairs: &[String]) -> Result<std::collections::HashMap<String, f64>, String> {
    pairs
        .iter()
        .map(|pair| {
            let (name, value) = pair
                .split_once('=')
                .ok_or_else(|| format!("输入项格式应为 name=value: {pair}"))?;
            let value: f64 = value
                .trim()
                .parse()
                .map_err(|error| format!("输入项数值解析失败 ({pair}): {error}"))?;
            Ok((name.trim().to_string(), value))
        })
        .collect()
}

/// 读取 JSON 文件 (命令帧定义 / 导出请求等)。
pub fn read_json_file(path: &str) -> Result<serde_json::Value, String> {
    let text =
        std::fs::read_to_string(path).map_err(|error| format!("读取 {path} 失败: {error}"))?;
    serde_json::from_str(&text).map_err(|error| format!("解析 {path} 失败: {error}"))
}

#[cfg(test)]
mod tests {
    use super::{parse_hex, parse_inputs};

    #[test]
    fn hex_parsing_accepts_common_writings() {
        assert_eq!(parse_hex("AABB"), Ok(vec![0xAA, 0xBB]));
        assert_eq!(parse_hex("aa bb"), Ok(vec![0xAA, 0xBB]));
        assert_eq!(parse_hex("0xAA,0x01"), Ok(vec![0xAA, 0x01]));
        assert_eq!(parse_hex(""), Ok(Vec::new()));
        // 空白/逗号是分隔符: 奇数长度的分段拼接连读 (A B = AB)
        assert_eq!(parse_hex("A B"), Ok(vec![0xAB]));
        assert!(parse_hex("A B C").is_err(), "拼后为奇数长度应报错");
        assert!(parse_hex("ZZ").is_err());
    }

    #[test]
    fn input_pairs_parse_to_map() {
        let inputs = parse_inputs(&["ch1=1.5".into(), "ch2=-2".into()]).expect("valid pairs");
        assert_eq!(inputs.get("ch1"), Some(&1.5));
        assert_eq!(inputs.get("ch2"), Some(&-2.0));
        assert!(parse_inputs(&["novalue".into()]).is_err());
    }
}
