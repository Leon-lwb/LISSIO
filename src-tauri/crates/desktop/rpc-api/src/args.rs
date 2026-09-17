//! RPC 参数归一与错误契约。
//!
//! 出口无关: 桌面 IPC 与 HTTP-RPC 共用同一套命令名与参数名, 差异只在传输。
//! `args` 是前端 `invoke(cmd, args)` 的原样 JSON 对象 (顶层 camelCase), 本模块
//! 负责复刻 Tauri v2 的参数转换规则并做类型化取值。

use serde::Serialize;
use serde::de::DeserializeOwned;
use serde_json::{Map, Value, json};

/// 出口无关的 RPC 错误 — 线上形状与 IPC 错误契约对齐 (`kind` / `message`)。
///
/// 前端 `errorGuidance` 按 `kind` 分支, 因此域错误必须保留
/// [`error::Error::kind`] 原文, 不得改写为泛化字符串。
#[derive(Debug, Clone, Serialize)]
pub struct RpcError {
    /// 稳定错误种类 (与前端 `NodeErrorKind` 对应)。
    pub kind: String,
    /// 面向用户的错误文案 (与 IPC 路径逐字一致)。
    pub message: String,
    /// 域错误的完整序列化形状 (`source` / `data`), 便于诊断。
    #[serde(skip_serializing_if = "Option::is_none")]
    pub data: Option<Value>,
}

impl RpcError {
    /// 该命令尚未在 RPC 出口实现 (见 [`crate::catalog`])。
    pub fn unsupported(cmd: &str) -> Self {
        Self {
            kind: "UnsupportedCommand".to_string(),
            message: format!("该出口暂不支持命令: {cmd}"),
            data: None,
        }
    }

    /// 参数缺失或反序列化失败 — 调用方 (出口层) 的契约错误。
    pub fn invalid_args(cmd: &str, message: impl Into<String>) -> Self {
        Self {
            kind: "InvalidArguments".to_string(),
            message: format!("命令 {cmd} 参数无效: {}", message.into()),
            data: None,
        }
    }

    /// 域错误 — 保留 `kind` 与文案原文。
    pub fn domain(error: &data_model::Error) -> Self {
        use error::Error as _;
        Self {
            kind: error.kind().to_string(),
            message: error.to_string(),
            data: serde_json::to_value(error).ok(),
        }
    }

    /// 字符串错误 (无头出口沿用 `Result<_, String>` 的能力)。
    pub fn text(message: impl Into<String>) -> Self {
        Self {
            kind: "CommandFailed".to_string(),
            message: message.into(),
            data: None,
        }
    }
}

/// 顶层 camelCase → snake_case — 复刻 Tauri v2 命令参数转换规则。
///
/// 只转换顶层键: 嵌套结构由各自的 serde 重命名策略负责 (前端发来的嵌套 DTO
/// 已是其声明的形状), 深度转换会破坏这些字段。
pub fn normalize_args(args: Value) -> Value {
    match args {
        Value::Object(map) => Value::Object(
            map.into_iter()
                .map(|(key, value)| (to_snake_case(&key), value))
                .collect(),
        ),
        other => other,
    }
}

/// 单个键的 camelCase → snake_case。
fn to_snake_case(key: &str) -> String {
    if !key.bytes().any(|byte| byte.is_ascii_uppercase()) {
        return key.to_string();
    }
    let mut out = String::with_capacity(key.len() + 4);
    for ch in key.chars() {
        if ch.is_ascii_uppercase() {
            out.push('_');
            out.push(ch.to_ascii_lowercase());
        } else {
            out.push(ch);
        }
    }
    out
}

/// 取必填参数 (缺省 = 契约错误, 不静默使用默认值)。
pub fn required<T: DeserializeOwned>(args: &Value, cmd: &str, key: &str) -> Result<T, RpcError> {
    let value = args
        .get(key)
        .ok_or_else(|| RpcError::invalid_args(cmd, format!("缺少字段 {key}")))?;
    serde_json::from_value(value.clone())
        .map_err(|error| RpcError::invalid_args(cmd, format!("字段 {key}: {error}")))
}

/// 取可选参数 (`null` 与缺省都视为 None)。
pub fn optional<T: DeserializeOwned>(
    args: &Value,
    cmd: &str,
    key: &str,
) -> Result<Option<T>, RpcError> {
    match args.get(key) {
        None | Some(Value::Null) => Ok(None),
        Some(value) => serde_json::from_value(value.clone())
            .map(|parsed| Some(parsed))
            .map_err(|error| RpcError::invalid_args(cmd, format!("字段 {key}: {error}"))),
    }
}

/// 空对象参数 — 返回 `Value::Null` 以便无返回值命令的响应体稳定。
pub const fn empty() -> Value {
    Value::Null
}

/// 序列化命令结果 (失败 = 内部契约错误, 不是用户输入错误)。
pub fn encode<T: Serialize>(value: &T) -> Result<Value, RpcError> {
    serde_json::to_value(value).map_err(|error| RpcError::text(format!("结果序列化失败: {error}")))
}

/// 无返回值命令的成功响应。
pub const fn ok() -> Result<Value, RpcError> {
    Ok(empty())
}

/// 域结果 (`data_model::Result<T>`) → RPC 响应。
pub fn domain<T: Serialize>(result: data_model::Result<T>) -> Result<Value, RpcError> {
    match result {
        Ok(value) => encode(&value),
        Err(error) => Err(RpcError::domain(&error)),
    }
}

/// 文本结果 (`Result<T, String>`, 无头能力沿用形状) → RPC 响应。
pub fn text<T: Serialize>(result: Result<T, String>) -> Result<Value, RpcError> {
    match result {
        Ok(value) => encode(&value),
        Err(message) => Err(RpcError::text(message)),
    }
}

/// 构造 `{ "ok": true }` 形状 (与 CLI 的轻量确认一致)。
pub fn acknowledged() -> Result<Value, RpcError> {
    Ok(json!({ "ok": true }))
}

/// 空参数对象的缺省值 — 供单元测试与出口层构造请求。
pub fn empty_args() -> Value {
    Value::Object(Map::new())
}

#[cfg(test)]
mod tests {
    use super::{RpcError, normalize_args, optional, required, to_snake_case};
    use serde_json::json;

    #[test]
    fn snake_case_conversion_matches_tauri_rules() {
        assert_eq!(to_snake_case("tabId"), "tab_id");
        assert_eq!(to_snake_case("baseVersion"), "base_version");
        assert_eq!(to_snake_case("documents"), "documents");
        assert_eq!(to_snake_case("nodeId"), "node_id");
    }

    #[test]
    fn normalize_only_touches_top_level_keys() {
        let args = json!({ "tabId": "t1", "payload": { "driverId": "serial" } });
        let normalized = normalize_args(args);
        assert_eq!(normalized["tab_id"], json!("t1"));
        assert_eq!(normalized["payload"]["driverId"], json!("serial"));
    }

    #[test]
    fn required_and_optional_report_missing_fields() {
        let args = json!({ "node_id": "n1", "interval": null });
        assert_eq!(
            required::<String>(&args, "send_raw", "node_id").unwrap(),
            "n1"
        );
        assert!(required::<String>(&args, "send_raw", "data").is_err());
        assert_eq!(
            optional::<u64>(&args, "send_raw", "interval").unwrap(),
            None
        );
    }

    #[test]
    fn unsupported_error_carries_command_name() {
        let error = RpcError::unsupported("inspect_element");
        assert_eq!(error.kind, "UnsupportedCommand");
        assert!(error.message.contains("inspect_element"));
    }
}
