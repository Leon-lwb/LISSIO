//! run_control (工作区运行控制) 集成测试
//!
//! 注: 以 tests/ 集成测试形式存在 — 内联测试经 dev-dep 反向依赖 `app_state`
//! 时, cargo 在 dev-dep 循环下不统一两个同源码 `DataPlaneState` 类型 (E0308),
//! 同 `byte_router_tests` 的处理方式。

use app::AppState;
use pipeline::eval_state::StreamGroupState;
use pipeline::execution::{SendMode, SendTask};
use pipeline::run_control::{StreamGroups, apply_run_action};
use pipeline::{RunAction, RunState};
use schema::command_frame::CommandFrameDto;
use std::sync::Arc;
use std::sync::atomic::AtomicU64;

fn test_state() -> (pipeline::DataPlaneState, StreamGroups) {
    let state = AppState::new();
    (state.data_plane.clone(), state.stream_groups)
}

#[tokio::test]
async fn start_pause_resume_stop_transition_epochs() {
    let (plane, groups) = test_state();

    let started = apply_run_action(&plane, &groups, RunAction::Start).await;
    assert_eq!(started.state, RunState::Running);
    assert!(plane.eval.execution.ticket().is_some());

    let paused = apply_run_action(&plane, &groups, RunAction::Pause).await;
    assert_eq!(paused.state, RunState::Paused);
    assert!(
        plane.eval.execution.ticket().is_none(),
        "暂停必须停自动发送与设备写"
    );
    assert!(
        plane.eval.execution.ingest_ticket().is_some(),
        "暂停期间数据链继续 — 字节照常入缓存与录制"
    );
    assert_eq!(plane.eval.execution.snapshot().epoch, 2);

    let resumed = apply_run_action(&plane, &groups, RunAction::Start).await;
    assert_eq!(resumed.state, RunState::Running);
    assert_eq!(
        resumed.epoch,
        paused.epoch + 1,
        "恢复必须推进 epoch — 旧票据失效"
    );

    let stopped = apply_run_action(&plane, &groups, RunAction::Stop).await;
    assert_eq!(stopped.state, RunState::Stopped);
    assert_eq!(stopped.epoch, resumed.epoch + 1);
}

#[tokio::test]
async fn idempotent_actions_do_not_bump_epoch() {
    let (plane, groups) = test_state();
    let first = apply_run_action(&plane, &groups, RunAction::Start).await;
    let again = apply_run_action(&plane, &groups, RunAction::Start).await;
    assert_eq!(first.epoch, again.epoch);

    let stopped = apply_run_action(&plane, &groups, RunAction::Stop).await;
    let stopped_again = apply_run_action(&plane, &groups, RunAction::Stop).await;
    assert_eq!(stopped.epoch, stopped_again.epoch);
}

#[tokio::test]
async fn pause_from_stopped_is_noop() {
    let (plane, groups) = test_state();
    let paused = apply_run_action(&plane, &groups, RunAction::Pause).await;
    assert_eq!(paused.state, RunState::Stopped, "停止态没有可暂停的采集");
    assert_eq!(paused.epoch, 0, "no-op 不推进 epoch");
    assert!(
        plane.eval.execution.ingest_ticket().is_none(),
        "从未启动不放行数据链"
    );
}

#[tokio::test]
async fn stop_clears_send_tasks() {
    let (plane, groups) = test_state();
    plane.eval.send.lock().set_widget_tasks(
        "w1",
        vec![SendTask {
            widget_id: "w1".into(),
            frame_id: "f1".into(),
            frame: CommandFrameDto {
                blocks: Vec::new(),
                append_newline: false,
            },
            mode: SendMode::OnChange,
            interval_ms: 100,
        }],
    );
    apply_run_action(&plane, &groups, RunAction::Start).await;
    assert_eq!(plane.eval.send.lock().len(), 1);

    apply_run_action(&plane, &groups, RunAction::Stop).await;
    assert!(
        plane.eval.send.lock().is_empty(),
        "停止必须同时清空待发送任务"
    );
}

#[tokio::test]
async fn pause_keeps_tasks_but_resets_schedules() {
    let (plane, groups) = test_state();
    plane.eval.send.lock().set_widget_tasks(
        "w1",
        vec![SendTask {
            widget_id: "w1".into(),
            frame_id: "f1".into(),
            frame: CommandFrameDto {
                blocks: Vec::new(),
                append_newline: false,
            },
            mode: SendMode::OnChange,
            interval_ms: 100,
        }],
    );
    apply_run_action(&plane, &groups, RunAction::Start).await;
    apply_run_action(&plane, &groups, RunAction::Pause).await;
    assert_eq!(
        plane.eval.send.lock().len(),
        1,
        "暂停保留任务定义 (界面配置不受运行态影响)"
    );
}

#[tokio::test]
async fn start_resets_stream_group_sequences() {
    let (plane, groups) = test_state();
    groups.lock().insert(
        "g1".into(),
        StreamGroupState {
            seq: Arc::new(AtomicU64::new(42)),
            shards: 1,
            source: Arc::new(()),
        },
    );
    apply_run_action(&plane, &groups, RunAction::Start).await;
    assert_eq!(
        groups.lock()["g1"]
            .seq
            .load(std::sync::atomic::Ordering::SeqCst),
        0,
        "从停止启动必须建立新流序列 (组序号归零)"
    );
}

#[tokio::test]
async fn resume_from_pause_keeps_stream_group_sequences() {
    let (plane, groups) = test_state();
    groups.lock().insert(
        "g1".into(),
        StreamGroupState {
            seq: Arc::new(AtomicU64::new(0)),
            shards: 1,
            source: Arc::new(()),
        },
    );
    apply_run_action(&plane, &groups, RunAction::Start).await;
    groups.lock()["g1"]
        .seq
        .store(7, std::sync::atomic::Ordering::SeqCst);

    apply_run_action(&plane, &groups, RunAction::Pause).await;
    apply_run_action(&plane, &groups, RunAction::Start).await;
    assert_eq!(
        groups.lock()["g1"]
            .seq
            .load(std::sync::atomic::Ordering::SeqCst),
        7,
        "从暂停恢复保持数据连续 — 不重建流序列"
    );
}
