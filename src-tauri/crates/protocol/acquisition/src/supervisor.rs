use crate::{
    AcquisitionError, DriverContext, DriverPayload, SourceFactory, SourceSession, ValidatedConfig,
};
use serde::{Deserialize, Serialize};
use std::sync::Arc;
use std::time::Duration;
use tokio::sync::{Mutex, watch};
use tokio::task::JoinHandle;

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum SourceState {
    Disabled,
    Validating,
    Connecting,
    Online { connection_epoch: u64 },
    Degraded { detail: String },
    Backoff { attempt: u32 },
    Closing,
    Closed,
}

#[derive(Clone, Copy, Debug)]
pub struct SourceSupervisor {
    pub max_reconnect_attempts: u32,
    pub initial_backoff: Duration,
    pub max_backoff: Duration,
}

impl Default for SourceSupervisor {
    fn default() -> Self {
        Self {
            max_reconnect_attempts: 5,
            initial_backoff: Duration::from_millis(100),
            max_backoff: Duration::from_secs(5),
        }
    }
}

/// 监督器句柄。`current_session` 让节点运行时始终投影当前重连会话。
pub struct SupervisorHandle {
    state: watch::Receiver<SourceState>,
    session: watch::Receiver<Option<Arc<dyn SourceSession>>>,
    cancel: watch::Sender<bool>,
    task: Mutex<Option<JoinHandle<()>>>,
}

impl SourceSupervisor {
    pub fn spawn(
        self,
        factory: Arc<dyn SourceFactory>,
        payload: DriverPayload,
        context: DriverContext,
    ) -> SupervisorHandle {
        self.spawn_with_validated(factory, None, payload, context)
    }

    /// 使用已经通过语义校验的首个配置句柄启动监督器；重连仍按 payload 重新校验。
    pub fn spawn_with_validated(
        self,
        factory: Arc<dyn SourceFactory>,
        validated: Option<ValidatedConfig>,
        payload: DriverPayload,
        context: DriverContext,
    ) -> SupervisorHandle {
        let (state_tx, state) = watch::channel(SourceState::Disabled);
        let (session_tx, session) = watch::channel(None);
        let (cancel, mut cancel_rx) = watch::channel(false);
        let task = tokio::spawn(async move {
            let mut attempt = 0_u32;
            let mut epoch = context.connection_epoch;
            let mut initial_validated = validated;
            loop {
                if *cancel_rx.borrow() {
                    break;
                }
                let _ = state_tx.send(SourceState::Validating);
                let validated = if let Some(value) = initial_validated.take() {
                    value
                } else {
                    match factory.validate(&payload) {
                        Ok(value) => value,
                        Err(error) => {
                            let _ = state_tx.send(SourceState::Degraded {
                                detail: error.to_string(),
                            });
                            break;
                        }
                    }
                };
                let _ = state_tx.send(SourceState::Connecting);
                let mut open_context = context.clone();
                open_context.connection_epoch = epoch;
                match factory.open(validated, open_context).await {
                    Ok(session) => {
                        let session: Arc<dyn SourceSession> = session.into();
                        epoch = epoch.max(session.epoch());
                        attempt = 0;
                        session_tx.send_replace(Some(session.clone()));
                        let _ = state_tx.send(SourceState::Online {
                            connection_epoch: epoch,
                        });
                        tokio::select! {
                            stopped = session.stopped() => {
                                if let Err(error) = stopped {
                                    let _ = state_tx.send(SourceState::Degraded { detail: error.to_string() });
                                }
                            }
                            changed = cancel_rx.changed() => {
                                let _ = changed;
                            }
                        }
                        session_tx.send_replace(None);
                        let _ = session.close().await;
                        if *cancel_rx.borrow() {
                            break;
                        }
                    }
                    Err(error) => {
                        let _ = state_tx.send(SourceState::Degraded {
                            detail: error.to_string(),
                        });
                    }
                }
                attempt = attempt.saturating_add(1);
                if attempt > self.max_reconnect_attempts {
                    break;
                }
                let _ = state_tx.send(SourceState::Backoff { attempt });
                let factor = 1_u32
                    .checked_shl(attempt.saturating_sub(1))
                    .unwrap_or(u32::MAX);
                let delay = self
                    .initial_backoff
                    .saturating_mul(factor)
                    .min(self.max_backoff);
                epoch = epoch.saturating_add(1);
                tokio::select! {
                    () = tokio::time::sleep(delay) => {}
                    changed = cancel_rx.changed() => { let _ = changed; }
                }
            }
            session_tx.send_replace(None);
            let _ = state_tx.send(SourceState::Closing);
            let _ = state_tx.send(SourceState::Closed);
        });
        SupervisorHandle {
            state,
            session,
            cancel,
            task: Mutex::new(Some(task)),
        }
    }
}

impl SupervisorHandle {
    /// Observe session replacement without coupling consumers to reconnect policy.
    pub fn sessions(&self) -> watch::Receiver<Option<Arc<dyn SourceSession>>> {
        self.session.clone()
    }

    pub fn state(&self) -> watch::Receiver<SourceState> {
        self.state.clone()
    }

    /// 返回当前可用会话；重连空窗期为 `None`。
    pub fn current_session(&self) -> Option<Arc<dyn SourceSession>> {
        self.session.borrow().clone()
    }

    /// 等待首次打开进入可观测的稳定状态（在线、失败或退避）。
    pub async fn wait_for_settled(&self) {
        let mut state = self.state();
        loop {
            if matches!(
                *state.borrow(),
                SourceState::Online { .. }
                    | SourceState::Degraded { .. }
                    | SourceState::Backoff { .. }
                    | SourceState::Closed
            ) {
                return;
            }
            if state.changed().await.is_err() {
                return;
            }
        }
    }

    pub async fn close(&self) -> Result<(), AcquisitionError> {
        let _ = self.cancel.send(true);
        // 先释放 task 锁再 await, 避免 tokio MutexGuard 跨 await 点存活
        let task = self.task.lock().await.take();
        if let Some(task) = task {
            task.await
                .map_err(|error| AcquisitionError::Driver(error.to_string()))?;
        }
        Ok(())
    }
}
