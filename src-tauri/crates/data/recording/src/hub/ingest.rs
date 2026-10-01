//! 写入路径与写入控制 — 生产者提交批次、运行态同步、flush / stop。
//!
//! 热路径契约: **任何数据库侧的问题都不许升级成采集故障**。队列打满与图编辑
//! 竞态只丢弃该批次并返回 `Ok(false)`; 只有已受理批次落不了盘才返回 `Err`
//! (由 `data_plane` 据此停止采集)。这条线一旦画错, 界面就是「点开始只出几个
//! 字符、暂停也解不开」。

use super::RecordingHub;
use super::fault::{FailureClass, apply, classify};
use crate::{BatchPayload, PortIdentity, RecordBatch, RecordingError, SessionState};

impl RecordingHub {
    /// 提交一个批次, 返回**是否被受理用于录制**。
    ///
    /// `Ok(false)` 同时表示「端口未绑定」「数据库已关闭」「背压丢弃」「绑定
    /// 竞态被拒」— 对生产者而言四者都无需处理, 更不允许据此停止采集。
    pub fn record(
        &self,
        port: &PortIdentity,
        epoch: u64,
        sequence_start: u64,
        timestamps_us: Vec<u64>,
        payload: BatchPayload,
    ) -> Result<bool, RecordingError> {
        let mut state = self.state.write();
        let Some(binding_id) = binding_id(&state, port) else {
            return Ok(false);
        };
        let Some(recorder) = state.recorder.clone() else {
            return Ok(false);
        };
        match recorder.append(RecordBatch {
            binding_id,
            epoch,
            sequence_start,
            timestamps_us,
            payload,
        }) {
            Ok(()) => Ok(settle_ok(&mut state)),
            Err(error) => settle_err(&mut state, error),
        }
    }

    /// [`Self::record`] 的序号自增变体 — 调用方不提供 `sequence_start`, 由 hub
    /// 按端口维护连续序号。
    pub fn record_next(
        &self,
        port: &PortIdentity,
        epoch: u64,
        timestamps_us: Vec<u64>,
        payload: BatchPayload,
    ) -> Result<bool, RecordingError> {
        let mut state = self.state.write();
        let Some(binding_id) = binding_id(&state, port) else {
            return Ok(false);
        };
        let Some(recorder) = state.recorder.clone() else {
            return Ok(false);
        };
        let sequence = state.sequences.get(port).copied().unwrap_or_default();
        let count = payload.item_count() as u64;
        let outcome = recorder.append(RecordBatch {
            binding_id,
            epoch,
            sequence_start: sequence,
            timestamps_us,
            payload,
        });
        // 无论受理与否都推进序号: 被丢弃的批次必须在录制序列里留下真实的空洞,
        // 而不是让后续批次盖在同一段序号上。
        state
            .sequences
            .insert(port.clone(), sequence.saturating_add(count));
        match outcome {
            Ok(()) => Ok(settle_ok(&mut state)),
            Err(error) => settle_err(&mut state, error),
        }
    }

    /// 同步会话状态。**不持状态锁**跨 writer 往返 — 一次卡住的写入最坏等待
    /// 应答上限, 持锁等待会连同采集热路径一起堵死 (运行控制也拿不到锁)。
    pub fn set_state(&self, state: SessionState) -> Result<(), RecordingError> {
        let Some(recorder) = self.state.read().recorder.clone() else {
            return Ok(());
        };
        match recorder.set_state(state) {
            Ok(()) => Ok(()),
            Err(error) => {
                self.note_failure(&error);
                Err(error)
            }
        }
    }

    /// 强制把在途批次落盘。同样在锁外等待。
    pub fn flush(&self) -> Result<(), RecordingError> {
        let Some(recorder) = self.state.read().recorder.clone() else {
            return Ok(());
        };
        match recorder.flush() {
            Ok(()) => Ok(()),
            Err(error) => {
                self.note_failure(&error);
                Err(error)
            }
        }
    }

    /// 摘除并关闭在册 writer (退出路径), 同时交出实例守卫。
    /// 锁在关停前已释放。
    pub fn stop(&self) -> Result<(), RecordingError> {
        let recorder = self.state.write().recorder.take();
        if let Some(recorder) = recorder {
            recorder.shutdown()?;
        }
        self.state.write().guard = None;
        Ok(())
    }
}

/// 已绑定且开关打开时取出绑定 id, 否则 `None` (生产者无需做任何事)。
fn binding_id(state: &super::HubState, port: &PortIdentity) -> Option<String> {
    if !state.enabled {
        return None;
    }
    state.active.get(port).map(|binding| binding.id.clone())
}

/// 写入成功即自动恢复 — 一次瞬态故障不得永久粘住整个会话。
fn settle_ok(state: &mut super::HubState) -> bool {
    state.fault = None;
    true
}

/// 处置一次写入错误: 丢弃类返回 `Ok(false)`, 只有契约类才返回 `Err`。
fn settle_err(state: &mut super::HubState, error: RecordingError) -> Result<bool, RecordingError> {
    apply(state, &error);
    if classify(&error) == FailureClass::Dropped {
        Ok(false)
    } else {
        Err(error)
    }
}
