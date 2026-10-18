//! writer 失败分类的单元回归 — **死在哪一个阶段决定处置**, 不是错误类型。
//!
//! 审计 M2: `run_writer` 曾经为任何写入循环错误置粘性的 `health.failed`,
//! 包括跑在任何批次之前的 bootstrap 调用 (连接 / 首批序号)。已有集成回归
//! ([`super::super::hub::bootstrap_tests`]) 覆盖「受理前失败 ⇒ 不置 fault」;
//! 这里锁住另一半: **受理之后**的失败必须仍然进粘性故障通道 (分类 → `Contract`
//! → 停止采集), 且两个通道互斥。

use crate::RecordingError;

use super::{HealthState, record_writer_failure};

#[test]
fn a_failure_before_the_first_batch_never_takes_the_fault_channel() {
    let health = HealthState::default();
    // 契约类错误也不例外: 这个 writer 一个批次都没取到, 没有任何已受理数据。
    record_writer_failure(
        &health,
        false,
        &RecordingError::Io(std::io::Error::other("connect failed")),
    );
    assert!(
        health.failed.lock().is_none(),
        "受理前的失败不得进粘性故障通道: {:?}",
        health.failed.lock()
    );
    assert_eq!(
        health.unavailable.lock().as_deref(),
        Some("recording I/O error: connect failed"),
        "真实原因必须留在非故障通道里 (可见但不停止采集)"
    );
}

#[test]
fn a_failure_after_the_first_batch_stays_a_sticky_contract_fault() {
    let health = HealthState::default();
    record_writer_failure(&health, true, &RecordingError::Failed("disk gone".into()));
    assert_eq!(
        health.failed.lock().as_deref(),
        Some("recording writer failed: disk gone"),
        "已受理批次落不了盘 = 契约破坏, 必须进粘性故障通道"
    );
    assert!(
        health.unavailable.lock().is_none(),
        "两个通道互斥 (hub 只认其中一个)"
    );
}
