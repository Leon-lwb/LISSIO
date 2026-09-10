use crate::{AcquisitionError, DriverContext, DriverPayload, SourceFactory};
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

pub struct SupervisorHandle {
    state: watch::Receiver<SourceState>,
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
        let (state_tx, state) = watch::channel(SourceState::Disabled);
        let (cancel, mut cancel_rx) = watch::channel(false);
        let task = tokio::spawn(async move {
            let mut attempt = 0_u32;
            let mut epoch = 0_u64;
            loop {
                if *cancel_rx.borrow() {
                    break;
                }
                let _ = state_tx.send(SourceState::Validating);
                let validated = match factory.validate(&payload) {
                    Ok(value) => value,
                    Err(error) => {
                        let _ = state_tx.send(SourceState::Degraded {
                            detail: error.to_string(),
                        });
                        break;
                    }
                };
                let _ = state_tx.send(SourceState::Connecting);
                match factory.open(validated, context.clone()).await {
                    Ok(session) => {
                        epoch = epoch.saturating_add(1).max(session.epoch());
                        attempt = 0;
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
                tokio::select! {
                    () = tokio::time::sleep(delay) => {}
                    changed = cancel_rx.changed() => { let _ = changed; }
                }
            }
            let _ = state_tx.send(SourceState::Closing);
            let _ = state_tx.send(SourceState::Closed);
        });
        SupervisorHandle {
            state,
            cancel,
            task: Mutex::new(Some(task)),
        }
    }
}

impl SupervisorHandle {
    pub fn state(&self) -> watch::Receiver<SourceState> {
        self.state.clone()
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
