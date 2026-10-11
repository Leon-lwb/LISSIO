use super::*;

#[test]
fn changes_coalesce_and_first_value_only_arms() {
    let mut schedule = SendSchedule::default();
    assert!(!schedule.due(0, SendMode::OnChange, 50, Some(b"A")));
    assert!(!schedule.due(20, SendMode::OnChange, 50, Some(b"B")));
    assert!(schedule.due(50, SendMode::OnChange, 50, Some(b"C")));
    schedule.complete(b"C", Ok(()));
    assert!(!schedule.due(100, SendMode::OnChange, 50, Some(b"C")));
    assert_eq!(schedule.status.sent, 1);
}

#[test]
fn missed_timer_periods_are_skipped_and_failures_do_not_replay() {
    let mut schedule = SendSchedule::default();
    assert!(!schedule.due(0, SendMode::Timer, 100, Some(b"A")));
    assert!(schedule.due(350, SendMode::Timer, 100, Some(b"A")));
    assert_eq!(schedule.status.skipped, 2);
    schedule.complete(b"A", Err("disconnected".into()));
    assert!(!schedule.due(400, SendMode::Timer, 100, None));
    assert!(!schedule.due(500, SendMode::Timer, 100, Some(b"B")));
    assert!(!schedule.due(599, SendMode::Timer, 100, Some(b"B")));
    assert!(schedule.due(600, SendMode::Timer, 100, Some(b"B")));
}

#[test]
fn encoding_failure_invalidates_previous_bytes() {
    let mut schedule = SendSchedule::default();
    schedule.due(0, SendMode::OnChange, 1, Some(b"A"));
    assert!(!schedule.due(1, SendMode::OnChange, 1, None));
    assert!(!schedule.due(2, SendMode::OnChange, 1, Some(b"B")));
}

#[test]
fn lifecycle_tickets_cannot_survive_restart() {
    let control = ExecutionControl::default();
    assert!(control.ticket().is_none());
    control.transition(RunState::Running);
    let ticket = control.ticket().unwrap();
    control.transition(RunState::Paused);
    control.transition(RunState::Running);
    assert!(!control.accepts(ticket));
}

#[test]
fn pause_keeps_ingest_open_and_closes_send() {
    let control = ExecutionControl::default();
    assert!(control.ingest_ticket().is_none(), "停止态数据链关闭");

    control.transition(RunState::Running);
    let running = control.ingest_ticket().unwrap();
    assert!(control.accepts_ingest(running));

    control.transition(RunState::Paused);
    assert!(control.ticket().is_none(), "暂停必须停自动发送与设备写");
    assert!(
        control.ingest_ticket().is_some(),
        "暂停期间数据链继续, 字节入缓存"
    );
    assert!(!control.accepts_ingest(running), "切换后旧数据链票据失效");

    control.transition(RunState::Stopped);
    assert!(control.ingest_ticket().is_none(), "停止是硬门控: 直接丢弃");
}

#[test]
fn resume_from_pause_keeps_the_start_boundary() {
    let control = ExecutionControl::default();
    control.transition(RunState::Running);
    let started_at = control.resumed_at_unix_ns();
    control.transition(RunState::Paused);
    control.transition(RunState::Running);
    assert_eq!(
        control.resumed_at_unix_ns(),
        started_at,
        "从暂停恢复不推进恢复点, 暂停期尾字节不被误判为陈旧"
    );

    control.transition(RunState::Stopped);
    control.transition(RunState::Running);
    assert!(
        control.resumed_at_unix_ns() >= started_at,
        "真正启动必须重建恢复点"
    );
}

fn frame_task(widget_id: &str, frame_id: &str, mode: SendMode) -> SendTask {
    SendTask {
        widget_id: widget_id.to_string(),
        frame_id: frame_id.to_string(),
        frame: CommandFrameDto {
            blocks: Vec::new(),
            append_newline: false,
        },
        mode,
        interval_ms: 100,
    }
}

#[test]
fn widget_task_replacement_preserves_other_widgets() {
    let mut scheduler = SendScheduler::default();
    scheduler.set_widget_tasks("w1", vec![frame_task("w1", "f1", SendMode::Timer)]);
    scheduler.set_widget_tasks("w2", vec![frame_task("w2", "f1", SendMode::OnChange)]);
    assert_eq!(scheduler.len(), 2);

    // 同 widget 重挂 (编辑/StrictMode 双挂) — 键集合不增长
    scheduler.set_widget_tasks("w1", vec![frame_task("w1", "f1", SendMode::Timer)]);
    assert_eq!(scheduler.len(), 2);

    // 手动模式不入注册表
    scheduler.set_widget_tasks("w3", vec![frame_task("w3", "f1", SendMode::Manual)]);
    assert_eq!(scheduler.len(), 2);

    // 空列表 = 注销
    scheduler.set_widget_tasks("w1", Vec::new());
    assert_eq!(scheduler.len(), 1);
}

#[test]
fn prune_and_status_surface() {
    let mut scheduler = SendScheduler::default();
    scheduler.set_widget_tasks("w1", vec![frame_task("w1", "f1", SendMode::Timer)]);
    scheduler.retain_existing(|id| id != "w1");
    assert!(scheduler.is_empty());
    scheduler.set_widget_tasks("w2", vec![frame_task("w2", "f1", SendMode::OnChange)]);
    assert!(scheduler.status_map().contains_key("w2\u{0}f1"));
}
