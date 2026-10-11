use super::*;
use crate::capabilities::registry::CapabilityRegistry;
use crate::capabilities::tool::ToolContext;
use app::AppState;
use std::sync::Arc;

fn ctx() -> ToolContext {
    ToolContext {
        registry: Arc::new(CapabilityRegistry::builtin()),
        toolbox: Arc::new(AppState::new()),
        sink: Arc::new(events::NullEventSink),
        lang: Lang::Zh,
    }
}

/// 注册表内全部文档可经 list_skills 枚举,read_skill 读全文。
#[tokio::test]
async fn skills_dispatch_through_registry() {
    let n = node();
    let list = n
        .tools
        .iter()
        .find(|t| t.name == "list_skills")
        .expect("list_skills 存在");
    let out = list
        .invoke(ctx(), serde_json::Value::Null)
        .await
        .expect("枚举成功");
    let skills = out.to_json_value()["skills"]
        .as_array()
        .expect("数组")
        .clone();
    assert!(skills.len() >= 5, "至少 5 篇文档, 实际 {}", skills.len());

    let read = n
        .tools
        .iter()
        .find(|t| t.name == "read_skill")
        .expect("read_skill 存在");
    let args = json!({"skill_id": "overview", "lang": "en"});
    let out = read.invoke(ctx(), args).await.expect("读取成功");
    assert!(out.to_text().len() > 200);
}

/// 未知 skill id 报执行失败 (消息含 id)。
#[tokio::test]
async fn unknown_skill_fails() {
    let n = node();
    let read = n.tools.iter().find(|t| t.name == "read_skill").unwrap();
    let Err(err) = read.invoke(ctx(), json!({"skill_id": "nope"})).await else {
        panic!("未知 id 应报错");
    };
    assert!(err.to_string().contains("nope"));
    assert!(!err.is_invalid_params());
}
