use super::*;
use app::AppState;
use std::sync::Arc;

/// 动态路由覆盖注册表全部工具,每个路由名与注册表一致。
#[test]
fn router_covers_registry_tools() {
    let registry = Arc::new(CapabilityRegistry::builtin());
    let router = build_router(
        &registry,
        Arc::new(AppState::new()),
        Arc::new(events::NullEventSink),
    );
    let mut router_names: Vec<_> = router
        .into_iter()
        .map(|r| r.attr.name.to_string())
        .collect();
    router_names.sort_unstable();
    let mut registry_names: Vec<_> = registry.tools().map(|(_, t)| t.name.to_string()).collect();
    registry_names.sort_unstable();
    assert_eq!(router_names, registry_names);
    assert!(router_names.len() >= 45);
}
