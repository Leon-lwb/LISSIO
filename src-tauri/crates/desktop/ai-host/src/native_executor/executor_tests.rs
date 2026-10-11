use super::*;
use serde_json::json;
use std::sync::Arc;

fn executor() -> NativeToolExecutor {
    NativeToolExecutor::new(
        Arc::new(CapabilityRegistry::builtin()),
        Arc::new(app::AppState::new()),
        Arc::new(events::NullEventSink),
        Arc::new(events::NullEventSink),
        Arc::new(Mutex::new(HashMap::new())),
        Lang::Zh,
        NativeToolOptions {
            builtin: true,
            web: true,
        },
    )
}

/// 规格清单 = 注册表工具 + 前端托管工具, 无重名。
#[test]
fn specs_derive_from_registry() {
    let executor = executor();
    let registry_count = executor.registry.tools().count();
    let specs = executor.tools();
    let mut seen = std::collections::HashSet::new();
    for t in &specs {
        assert!(seen.insert(t.name.clone()), "重复工具名: {}", t.name);
    }
    assert_eq!(
        specs.len(),
        registry_count + frontend::BUILTIN_FRONTEND_TOOLS.len() + frontend::WEB_TOOLS.len()
    );
    assert!(seen.contains("read_skill"));
    assert!(seen.contains("connect_edge"));
    assert!(seen.contains("fetch_webpage"));
    assert!(
        !seen.contains("connect_nodes"),
        "旧名 connect_nodes 应并入 connect_edge"
    );
}

/// 注册表工具经执行器调用: read_skill 命中知识库节点。
#[tokio::test]
async fn dispatches_registry_tools() {
    let executor = executor();
    let out = executor
        .call("read_skill", json!({"skill_id": "overview"}))
        .await
        .expect("read_skill 应命中注册表");
    assert!(out.len() > 200);
}

/// 参数错误与未知工具都映射为工具失败。
#[tokio::test]
async fn unknown_and_invalid_report_tool_failure() {
    let executor = executor();
    assert!(executor.call("nope", json!({})).await.is_err());
    assert!(
        executor
            .call("read_skill", json!({"skill_id": "不存在"}))
            .await
            .is_err()
    );
}

/// handles 覆盖注册表与前端两组工具。
#[test]
fn handles_covers_both_groups() {
    let executor = executor();
    assert!(executor.handles("send_bytes"));
    assert!(executor.handles("add_node"));
    assert!(executor.handles("fetch_webpage"));
    assert!(!executor.handles("nope"));
}

#[test]
fn builtin_and_web_sources_are_independent() {
    let make = |builtin, web| {
        NativeToolExecutor::new(
            Arc::new(CapabilityRegistry::builtin()),
            Arc::new(app::AppState::new()),
            Arc::new(events::NullEventSink),
            Arc::new(events::NullEventSink),
            Arc::new(Mutex::new(HashMap::new())),
            Lang::Zh,
            NativeToolOptions { builtin, web },
        )
    };
    let web_only = make(false, true);
    assert!(web_only.handles("fetch_webpage"));
    assert!(!web_only.handles("read_skill"));
    assert!(!web_only.handles("add_node"));
    assert_eq!(web_only.tools().len(), 1);

    let builtin_only = make(true, false);
    assert!(!builtin_only.handles("fetch_webpage"));
    assert!(builtin_only.handles("read_skill"));
    assert!(builtin_only.handles("add_node"));
    assert!(
        !builtin_only
            .tools()
            .iter()
            .any(|tool| tool.name == "fetch_webpage")
    );
}
