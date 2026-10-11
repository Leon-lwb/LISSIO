use std::sync::Arc;

/// 未运行 (stopped) 时会话生命周期操作被门控拒绝。
#[tokio::test]
async fn session_create_requires_paused_run() {
    let state = app::AppState::new();
    let tb = Arc::new(state);
    let error = super::create_session(&tb).await.expect_err("应被门控拒绝");
    assert!(error.contains("paused"));
}
