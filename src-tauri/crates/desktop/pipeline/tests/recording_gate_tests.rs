//! 录制可用性与采集门控的集成回归测试
//!
//! 根因背景 (Windows): 启动时录制数据库打不开 — 另一个残留的 `lissio-server`
//! 实例以强制文件锁持有 `acquisition.duckdb` — 曾被记录成"录制写入故障", 读任务
//! 因此在每批字节之后都判定录制契约被破坏并把工作区强制停回 `Stopped`。
//! 现象: 每次点界面左下角"开始"只有单个批次 (几字节) 进入 raw 收集器, Raw data
//! 看起来完全不刷新 (Mac/Linux 上文件锁不是强制的, 数据库能打开, 因此不复现)。
//!
//! 契约: 录制**不可用** (没有 recorder / 没有绑定批次) 不是写入故障 — 采集必须
//! 一直运行, 只是没有录制; 只有已受理批次的写入失败才停止采集。

use std::sync::Arc;
use std::time::Duration;

use app::AppState;
use data_model::TransportConfig;
use data_model::device_tree::NodeDecl;
use events::NullEventSink;
use pipeline::RunState;
use recording::{RecordingLimits, SessionState};

mod common;

fn app_state() -> AppState {
    AppState::with_acquisition(common::runtime(
        "test-data",
        TransportConfig::TestData(data_model::TestDataConfig::default()),
        Arc::new(transport::test_data::TestDataBackend),
    ))
}

fn device_node(id: &str) -> NodeDecl {
    let defaults = serde_json::to_value(TransportConfig::TestData(
        data_model::TestDataConfig::default(),
    ))
    .unwrap();
    common::node(id, "test-data", defaults["params"].clone(), None)
}

/// 让录制数据库不可打开 — 与"另一个进程持有数据库锁"在启动路径上等效。
/// 返回需要清理的临时目录。
fn make_recording_unavailable(state: &AppState) -> std::path::PathBuf {
    let name = format!("lissio-recording-gate-{}", std::process::id());
    let base = std::env::temp_dir().join(name);
    let _ = std::fs::remove_dir_all(&base);
    std::fs::create_dir_all(&base).unwrap();
    // 父路径是普通文件 → 打开/建库必然失败 (跨平台确定)
    let blocker = base.join("not-a-directory");
    std::fs::write(&blocker, b"blocker").unwrap();
    let database = blocker.join("acquisition.duckdb");
    let limits = RecordingLimits::default();
    let recording = state.eval_state().recording;
    let outcome = recording.start(database, Vec::new(), limits, SessionState::Paused);
    assert!(outcome.is_err());
    base
}

fn collected_chunks(state: &AppState, id: &str) -> usize {
    state.data_plane.raw_collector_for(id).lock().chunk_count()
}

#[tokio::test]
async fn recording_unavailable_does_not_stop_acquisition() {
    let state = app_state();
    let base = make_recording_unavailable(&state);
    // 前提: 录制不可用, 但 hub 不报告写入故障 (这正是采集门控依据)
    assert!(
        state.eval_state().recording.fault().is_none(),
        "录制不可用不得算作写入故障 (采集门控依据)"
    );
    assert!(state.eval_state().recording.health().failed.is_some());

    state.transport.open_node(device_node("tp")).await.unwrap();
    state.data_plane.attach(Arc::new(NullEventSink), "tp").await;
    app::apply_workspace_run(
        &state.transport,
        &state.data_plane,
        &state.stream_groups,
        pipeline::RunAction::Start,
    )
    .await;
    assert_eq!(
        state.data_plane.eval.execution.snapshot().state,
        RunState::Running
    );

    // 合成数据源持续产出: 字节必须真的进入 raw 收集器, 且采集一直处于运行态
    let deadline = tokio::time::Instant::now() + Duration::from_secs(3);
    while collected_chunks(&state, "tp") < 2 {
        assert!(
            tokio::time::Instant::now() < deadline,
            "合成测试数据源未产出字节"
        );
        assert_eq!(
            state.data_plane.eval.execution.snapshot().state,
            RunState::Running,
            "录制不可用不得停止采集 (每次点开始只进一批字节的根因)"
        );
        tokio::time::sleep(Duration::from_millis(10)).await;
    }

    let _ = std::fs::remove_dir_all(&base);
}
