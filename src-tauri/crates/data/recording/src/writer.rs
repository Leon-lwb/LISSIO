use std::collections::HashMap;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, mpsc};
use std::thread::JoinHandle;
use std::time::Duration;

use parking_lot::{Mutex, RwLock};
use thiserror::Error;

use crate::{
    BindingInfo, DisplayBinding, Domain, HistoryPage, HistoryQuery, RecordBatch,
    RecordingCleanupResult, RecordingDatabaseInfo, RecordingHealth, RecordingLimits,
    RecordingStore, SessionInfo, SessionState, SessionSummary, SqlResult,
};

pub mod channel;
mod worker;

use channel::{Deadline, budget, receive_reply, send_bounded};
pub use channel::{QueryCancellation, RecordingReader};

#[derive(Debug, Error)]
pub enum RecordingError {
    #[error("database error: {0}")]
    Database(#[from] duckdb::Error),
    #[error("recording I/O error: {0}")]
    Io(#[from] std::io::Error),
    #[error("invalid recording data: {0}")]
    Invalid(String),
    #[error("corrupt recording data: {0}")]
    Corrupt(String),
    #[error("recording queue is full")]
    Backpressure,
    #[error("recording writer is closed")]
    Closed,
    /// 录制不可用 — 数据库打不开 / 被关掉 / writer 已死。**必须带上真实原因**:
    /// 统一报 [`Self::Closed`] 会让用户看到「writer is closed」这种既真实又不可
    /// 行动的提示, 真正的原因 (例如文件损坏) 只剩在健康报告里。
    #[error("recording is unavailable: {0}")]
    Unavailable(String),
    #[error("recording writer failed: {0}")]
    Failed(String),
    #[error("recording writer did not answer within {0:?}")]
    Timeout(Duration),
}

#[derive(Debug, Default)]
struct HealthState {
    accepted_batches: AtomicU64,
    accepted_bytes: AtomicU64,
    persisted_batches: AtomicU64,
    persisted_bytes: AtomicU64,
    accepted_sequence: AtomicU64,
    persisted_sequence: AtomicU64,
    queued_batches: AtomicU64,
    dropped_batches: AtomicU64,
    rejected_batches: AtomicU64,
    failed: Mutex<Option<String>>,
}

/// writer 线程的应答通道类型 — 结果以字符串回报, 由调用方映射回具体错误。
pub type Reply<T> = mpsc::Sender<Result<T, String>>;

#[derive(Debug)]
pub enum Command {
    Append(RecordBatch),
    Bind(DisplayBinding, Reply<()>),
    Unbind(String, Reply<()>),
    State(SessionState, Reply<()>),
    DeleteSessions(Vec<String>, Reply<RecordingCleanupResult>),
    Flush(Reply<()>),
    /// 读请求 — 与写共用**同一个** DuckDB 连接, 所以读不会开第二个实例。
    ListSessions(Reply<Vec<SessionInfo>>),
    SessionSummaries(Reply<Vec<SessionSummary>>),
    DatabaseInfo(Reply<RecordingDatabaseInfo>),
    Bindings(String, Reply<Vec<BindingInfo>>),
    SessionIsEmpty(String, Reply<bool>),
    DeleteSession(String, Reply<()>),
    HistoryPage(Box<HistoryQuery>, Reply<HistoryPage>),
    Sql {
        sql: String,
        max_rows: usize,
        cancellation: Arc<QueryCancellation>,
        reply: Reply<SqlResult>,
    },
    Shutdown(Reply<()>),
}

#[derive(Debug)]
pub struct Recorder {
    store: RecordingStore,
    session: SessionInfo,
    sender: mpsc::SyncSender<Command>,
    health: Arc<HealthState>,
    bindings: Arc<RwLock<HashMap<String, Domain>>>,
    thread: Mutex<Option<JoinHandle<()>>>,
}

impl Recorder {
    pub fn start(
        store: RecordingStore,
        bindings: Vec<DisplayBinding>,
        limits: RecordingLimits,
    ) -> Result<Self, RecordingError> {
        check_limits(&limits)?;
        let session = store.create_session(&bindings)?;
        Self::spawn(store, session, bindings, limits)
    }

    /// Attach to an existing (resumed) session instead of creating a new one.
    pub fn attach(
        store: RecordingStore,
        session: SessionInfo,
        bindings: Vec<DisplayBinding>,
        limits: RecordingLimits,
    ) -> Result<Self, RecordingError> {
        check_limits(&limits)?;
        Self::spawn(store, session, bindings, limits)
    }

    fn spawn(
        store: RecordingStore,
        session: SessionInfo,
        bindings: Vec<DisplayBinding>,
        limits: RecordingLimits,
    ) -> Result<Self, RecordingError> {
        let binding_domains = bindings
            .into_iter()
            .map(|binding| (binding.id, binding.domain))
            .collect();
        let bindings = Arc::new(RwLock::new(binding_domains));
        let health = Arc::new(HealthState::default());
        let (sender, receiver) = mpsc::sync_channel(limits.queue_batches);
        // 读路径挂到写线程的通道上: 查询 / 导出 / 会话检查从此共用这一个连接。
        let store = store.with_reader(RecordingReader::new(sender.clone()));
        // 写线程只做原始连接操作, 拿到不带读句柄的副本 — 万一将来有人在写线程里
        // 调了读路径, 那也只会退化成独占打开, 不会自锁。
        let writer_store = store.without_reader();
        let writer_session = session.id.clone();
        let writer_health = health.clone();
        let thread = std::thread::Builder::new()
            .name("recording-writer".into())
            .spawn(move || {
                worker::run_writer(
                    &writer_store,
                    &writer_session,
                    limits,
                    receiver,
                    &writer_health,
                );
            })?;
        Ok(Self {
            store,
            session,
            sender,
            health,
            bindings,
            thread: Mutex::new(Some(thread)),
        })
    }

    #[must_use]
    pub const fn session(&self) -> &SessionInfo {
        &self.session
    }

    #[must_use]
    pub const fn store(&self) -> &RecordingStore {
        &self.store
    }

    pub fn append(&self, batch: RecordBatch) -> Result<(), RecordingError> {
        let failure = self.health.failed.lock().clone();
        if let Some(error) = failure {
            return Err(RecordingError::Failed(error));
        }
        let expected = self.bindings.read().get(&batch.binding_id).copied();
        if expected != Some(batch.payload.domain()) {
            self.health.rejected_batches.fetch_add(1, Ordering::Relaxed);
            return Err(RecordingError::Invalid(format!(
                "binding {} is absent or has a different domain",
                batch.binding_id
            )));
        }
        let bytes = batch.payload.effective_bytes() as u64;
        let sequence = batch.sequence_end();
        self.sender
            .try_send(Command::Append(batch))
            .map_err(|error| match error {
                mpsc::TrySendError::Full(_) => {
                    // 正常背压: 磁盘一时跟不上。计数后交给调用方决定策略,
                    // 绝不在这里升级成故障。
                    self.health.dropped_batches.fetch_add(1, Ordering::Relaxed);
                    RecordingError::Backpressure
                }
                mpsc::TrySendError::Disconnected(_) => RecordingError::Closed,
            })?;
        self.health.accepted_batches.fetch_add(1, Ordering::Relaxed);
        self.health
            .accepted_bytes
            .fetch_add(bytes, Ordering::Relaxed);
        self.health
            .accepted_sequence
            .fetch_max(sequence, Ordering::Relaxed);
        self.health.queued_batches.fetch_add(1, Ordering::Relaxed);
        Ok(())
    }

    pub fn bind(&self, binding: DisplayBinding) -> Result<(), RecordingError> {
        self.round_trip(
            |reply| Command::Bind(binding.clone(), reply),
            budget::CONTROL,
        )?;
        self.bindings.write().insert(binding.id, binding.domain);
        Ok(())
    }

    pub fn unbind(&self, binding_id: &str) -> Result<(), RecordingError> {
        self.round_trip(
            |reply| Command::Unbind(binding_id.to_string(), reply),
            budget::CONTROL,
        )?;
        self.bindings.write().remove(binding_id);
        Ok(())
    }

    pub fn set_state(&self, state: SessionState) -> Result<(), RecordingError> {
        self.round_trip(|reply| Command::State(state, reply), budget::CONTROL)
    }

    pub fn flush(&self) -> Result<(), RecordingError> {
        self.round_trip(Command::Flush, budget::MAINTENANCE)
    }

    pub fn delete_sessions(
        &self,
        session_ids: Vec<String>,
    ) -> Result<RecordingCleanupResult, RecordingError> {
        self.round_trip(
            |reply| Command::DeleteSessions(session_ids, reply),
            budget::MAINTENANCE,
        )
    }

    pub fn shutdown(&self) -> Result<(), RecordingError> {
        let mut thread = self.thread.lock();
        let Some(handle) = thread.take() else {
            return Ok(());
        };
        match self.round_trip(Command::Shutdown, budget::SHUTDOWN) {
            Ok(()) => {
                handle.join().map_err(|_| RecordingError::Closed)?;
                Ok(())
            }
            // writer 线程卡在 DuckDB 调用里: 不能 join — 那会把换库/退出路径
            // 永久挂住。直接 detach, 句柄随进程结束由操作系统回收。
            Err(error) => Err(error),
        }
    }

    /// 一次有界往返 — **投递**与**应答**共享同一份预算, 总等待不超过一份超时。
    ///
    /// 投递也必须有界: writer 卡死时队列会被生产者填满, 只限应答的话 `send`
    /// 一样会永远阻塞。
    fn round_trip<T>(
        &self,
        build: impl FnOnce(Reply<T>) -> Command,
        timeout: Duration,
    ) -> Result<T, RecordingError> {
        let (reply, response) = mpsc::channel();
        let deadline = Deadline::after(timeout);
        send_bounded(&self.sender, build(reply), timeout, deadline)?;
        receive_reply(response, timeout, deadline)
    }

    #[must_use]
    pub fn health(&self) -> RecordingHealth {
        RecordingHealth {
            accepted_batches: self.health.accepted_batches.load(Ordering::Relaxed),
            accepted_bytes: self.health.accepted_bytes.load(Ordering::Relaxed),
            persisted_batches: self.health.persisted_batches.load(Ordering::Relaxed),
            persisted_bytes: self.health.persisted_bytes.load(Ordering::Relaxed),
            accepted_sequence: self.health.accepted_sequence.load(Ordering::Relaxed),
            persisted_sequence: self.health.persisted_sequence.load(Ordering::Relaxed),
            queued_batches: self.health.queued_batches.load(Ordering::Relaxed),
            enabled: true,
            dropped_batches: self.health.dropped_batches.load(Ordering::Relaxed),
            rejected_batches: self.health.rejected_batches.load(Ordering::Relaxed),
            // 提示由 hub 汇总 (它才知道这次打开是否触发了自动重建)。
            warning: None,
            failed: self.health.failed.lock().clone(),
        }
    }
}

impl Drop for Recorder {
    fn drop(&mut self) {
        let _ = self.shutdown();
    }
}

/// 回归测试专用构造 — **不新增生产 API**(仅 `cfg(test)` 编译)。
#[cfg(test)]
impl Recorder {
    /// 造一个**卡死的 writer**: 队列容量为零 (没有线程在 `recv` 时 `try_send`
    /// 立即报满, 正是生产者把队列填满时的行为), 线程只做 park、永不应答。
    ///
    /// 用来复现 Windows 上的冻结路径: writer 卡在 DuckDB 调用里 → 队列被填满 →
    /// 调用方必须仍然在有限时间内返回, 且采集热路径不得被堵住。
    pub fn wedged_for_test(store: RecordingStore, bindings: Vec<DisplayBinding>) -> Self {
        let binding_domains = bindings
            .into_iter()
            .map(|binding| (binding.id, binding.domain))
            .collect();
        let (sender, receiver) = mpsc::sync_channel(0);
        // 读路径同样挂在这个卡死的通道上: 查询 / 检查不得绕过写线程自己开实例。
        let store = store.with_reader(RecordingReader::new(sender.clone()));
        let thread = std::thread::Builder::new()
            .name("recording-writer-wedged".into())
            .spawn(move || {
                let _held = receiver;
                loop {
                    std::thread::park();
                }
            })
            .expect("测试 writer 线程应可启动");
        Self {
            store,
            session: SessionInfo {
                id: "wedged-session".into(),
                started_at_us: 0,
                ended_at_us: None,
                state: SessionState::Running,
            },
            sender,
            health: Arc::new(HealthState::default()),
            bindings: Arc::new(RwLock::new(binding_domains)),
            thread: Mutex::new(Some(thread)),
        }
    }
}

fn check_limits(limits: &RecordingLimits) -> Result<(), RecordingError> {
    if limits.queue_batches == 0 || limits.transaction_bytes == 0 || limits.commit_interval_ms == 0
    {
        return Err(RecordingError::Invalid(
            "recording limits must be greater than zero".into(),
        ));
    }
    Ok(())
}
