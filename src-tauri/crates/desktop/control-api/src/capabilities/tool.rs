//! 工具定义 — 能力节点声明的单个工具 (名称/描述/JSON schema/异步处理器)。
//!
//! [`tool`] / [`tool0`] 泛型构造器从入参类型 `P` 的 `JsonSchema` 派生 JSON Schema,
//! 调用时用 serde 反序列化参数再委托处理器;schema 只此一份,MCP 工具路由与
//! 内置 AI 工具规格都从 [`ToolDefinition`] 派生。

use std::future::Future;
use std::pin::Pin;
use std::sync::Arc;

use events::EventSinkHandle;
use schemars::JsonSchema;
use serde::de::DeserializeOwned;
use serde_json::Value;

use super::registry::CapabilityRegistry;
use super::skill::Lang;
use crate::Toolbox;

/// 工具调用上下文 — 由出口 (MCP server / 内置 AI 执行器) 在调用时组装。
pub struct ToolContext {
    /// 完整能力注册表 (跨节点自省工具如 list_skills 使用)。
    pub registry: Arc<CapabilityRegistry>,
    /// 业务状态切片。
    pub toolbox: Toolbox,
    /// 后端事件端口 (图变更实时同步前端)。
    pub sink: EventSinkHandle,
    /// 会话语言 (无明确语言参数的工具结果使用)。
    pub lang: Lang,
}

/// 工具调用返回的未来。
pub type ToolFuture = Pin<Box<dyn Future<Output = Result<ToolOutput, ToolError>> + Send>>;

/// 工具处理器 — 类型擦除的异步调用入口。
pub type ToolHandler = Arc<dyn Fn(ToolContext, Value) -> ToolFuture + Send + Sync>;

/// 工具输出:JSON 值或纯文本 (如 read_skill 的 markdown 全文)。
#[derive(Debug)]
pub enum ToolOutput {
    /// 结构化 JSON 结果。
    Json(Value),
    /// 纯文本结果。
    Text(String),
}

impl ToolOutput {
    /// 取 JSON 值 (文本输出取其字符串)。
    #[must_use]
    pub fn to_json_value(&self) -> Value {
        match self {
            Self::Json(v) => v.clone(),
            Self::Text(s) => Value::String(s.clone()),
        }
    }

    /// 取文本 (JSON 输出序列化为紧凑 JSON 字符串)。
    #[must_use]
    pub fn to_text(&self) -> String {
        match self {
            Self::Json(v) => v.to_string(),
            Self::Text(s) => s.clone(),
        }
    }
}

/// 工具错误:参数非法 (协议层参数错误) 或执行失败 (AI 可见的失败原因)。
#[derive(Debug)]
pub enum ToolError {
    /// 参数反序列化/校验失败。
    InvalidParams(String),
    /// 工具执行失败,消息面向 AI 客户端展示。
    Failed(String),
}

impl std::fmt::Display for ToolError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::InvalidParams(msg) => write!(f, "参数非法: {msg}"),
            Self::Failed(msg) => write!(f, "{msg}"),
        }
    }
}

impl std::error::Error for ToolError {}

impl ToolError {
    /// 是否为参数错误 (出口据此映射协议层 invalid params)。
    pub const fn is_invalid_params(&self) -> bool {
        matches!(self, Self::InvalidParams(_))
    }
}

/// 单个工具的完整声明 — 注册表的最小组成单元 (克隆仅复制 Arc 与 schema)。
#[derive(Clone)]
pub struct ToolDefinition {
    /// 稳定工具名 (跨出口唯一)。
    pub name: &'static str,
    /// 面向 AI 客户端的用途描述。
    pub description: &'static str,
    /// 入参 JSON Schema (由 `P: JsonSchema` 派生)。
    pub input_schema: Value,
    /// 类型擦除的异步处理器。
    pub handler: ToolHandler,
}

impl ToolDefinition {
    /// 调用工具:参数反序列化在 handler 内完成。
    pub fn invoke(&self, ctx: ToolContext, arguments: Value) -> ToolFuture {
        (self.handler)(ctx, arguments)
    }
}

/// 实现层 `Result<T, String>` 结果的统一转换 (可序列化成功 / 字符串错误)。
///
/// # Errors
/// 序列化失败与实现层字符串错误都映射为 [`ToolError::Failed`]。
pub fn json_result<T: serde::Serialize>(
    result: Result<T, String>,
) -> Result<ToolOutput, ToolError> {
    result
        .and_then(|v| serde_json::to_value(v).map_err(|e| e.to_string()))
        .map(ToolOutput::Json)
        .map_err(ToolError::Failed)
}

/// 可序列化成功值 → JSON 输出 (序列化失败归为执行错误)。
///
/// # Errors
/// 序列化失败映射为 [`ToolError::Failed`]。
pub fn json_ok<T: serde::Serialize>(value: T) -> Result<ToolOutput, ToolError> {
    serde_json::to_value(value)
        .map(ToolOutput::Json)
        .map_err(|e| ToolError::Failed(e.to_string()))
}

/// 从入参 JSON 派生 schema。`schemars::Schema` 是纯数据类型,序列化不会失败。
fn param_schema<P: JsonSchema>() -> Value {
    serde_json::to_value(schemars::schema_for!(P))
        .expect("schemars Schema 为纯数据类型, JSON 序列化不会失败")
}

/// 反序列化入参:缺省 (`null`) 按空对象处理,失败归一为 [`ToolError::InvalidParams`]。
fn parse_params<P: DeserializeOwned>(arguments: Value) -> Result<P, ToolError> {
    let value = match arguments {
        Value::Null => serde_json::Map::new().into(),
        other => other,
    };
    serde_json::from_value(value).map_err(|e| ToolError::InvalidParams(e.to_string()))
}

/// 构造带类型化入参的工具:schema 来自 `P: JsonSchema`,调用时反序列化后委托 `handler`。
pub fn tool<P, F, Fut>(name: &'static str, description: &'static str, handler: F) -> ToolDefinition
where
    P: JsonSchema + DeserializeOwned + Send + 'static,
    F: Fn(ToolContext, P) -> Fut + Send + Sync + 'static,
    Fut: Future<Output = Result<ToolOutput, ToolError>> + Send + 'static,
{
    let handler = Arc::new(handler);
    ToolDefinition {
        name,
        description,
        input_schema: param_schema::<P>(),
        handler: Arc::new(move |ctx, arguments| {
            let handler = Arc::clone(&handler);
            Box::pin(async move {
                let params = parse_params::<P>(arguments)?;
                handler(ctx, params).await
            })
        }),
    }
}

/// 构造无入参工具 (MCP 客户端对无参工具可能不发 arguments 或发空对象)。
pub fn tool0<F, Fut>(name: &'static str, description: &'static str, handler: F) -> ToolDefinition
where
    F: Fn(ToolContext) -> Fut + Send + Sync + 'static,
    Fut: Future<Output = Result<ToolOutput, ToolError>> + Send + 'static,
{
    let handler = Arc::new(handler);
    ToolDefinition {
        name,
        description,
        input_schema: param_schema::<serde_json::Map<String, Value>>(),
        handler: Arc::new(move |ctx, _arguments| {
            let handler = Arc::clone(&handler);
            Box::pin(async move { handler(ctx).await })
        }),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use app::AppState;
    use serde::Deserialize;
    use serde_json::json;

    #[derive(Debug, Deserialize, JsonSchema)]
    struct EchoParams {
        /// 回显文本。
        text: String,
        /// 可选重复次数。
        #[serde(default)]
        count: u32,
    }

    fn ctx() -> ToolContext {
        ToolContext {
            registry: Arc::new(CapabilityRegistry::new(Vec::new()).expect("空注册表合法")),
            toolbox: Toolbox::from_state(&AppState::new()),
            sink: Arc::new(events::NullEventSink),
            lang: Lang::Zh,
        }
    }

    /// schema 由参数类型派生,含必填字段。
    #[tokio::test]
    async fn typed_tool_schema_and_dispatch() {
        let def = tool::<EchoParams, _, _>("echo", "回显", |_, p: EchoParams| async move {
            Ok(ToolOutput::Text(format!("{}*{}", p.text, p.count)))
        });
        assert_eq!(def.name, "echo");
        assert_eq!(def.input_schema["properties"]["text"]["type"], "string");

        let out = def.invoke(ctx(), json!({"text": "hi", "count": 3})).await;
        assert_eq!(out.expect("合法参数").to_text(), "hi*3");
    }

    /// null/空对象按默认值反序列化,缺必填字段报 InvalidParams。
    #[tokio::test]
    async fn params_defaults_and_errors() {
        let def = tool::<EchoParams, _, _>("echo", "回显", |_, p: EchoParams| async move {
            Ok(ToolOutput::Text(p.text))
        });
        let err = def.invoke(ctx(), Value::Null).await.expect_err("缺 text");
        assert!(err.is_invalid_params());

        let err = def.invoke(ctx(), json!({})).await.expect_err("缺 text");
        assert!(err.is_invalid_params());
    }

    /// 无参工具不接收 arguments。
    #[tokio::test]
    async fn no_param_tool() {
        let def = tool0("ping", "探活", |_| async {
            Ok(ToolOutput::Json(json!({"ok": true})))
        });
        let out = def.invoke(ctx(), Value::Null).await.expect("无参调用");
        assert_eq!(out.to_json_value()["ok"], true);
    }

    /// 输出转换:JSON 与文本互取。
    #[test]
    fn output_conversion() {
        assert_eq!(ToolOutput::Text("md".into()).to_json_value(), json!("md"));
        assert_eq!(ToolOutput::Json(json!({"a": 1})).to_text(), r#"{"a":1}"#);
    }

    /// 工具错误消息可读。
    #[test]
    fn error_display() {
        assert_eq!(
            ToolError::InvalidParams("缺 node_id".into()).to_string(),
            "参数非法: 缺 node_id"
        );
        assert_eq!(
            ToolError::Failed("设备未连接".into()).to_string(),
            "设备未连接"
        );
    }
}
