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
        toolbox: Arc::new(AppState::new()),
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
