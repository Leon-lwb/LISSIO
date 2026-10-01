use std::collections::{HashMap, HashSet};
use std::path::{Path, PathBuf};
use std::sync::Arc;

use parking_lot::RwLock;

use crate::writer::QueryCancellation;
use crate::{
    DisplayBinding, PortIdentity, Recorder, RecordingCleanupPolicy, RecordingError,
    RecordingLimits, SessionInfo, SessionState,
};

mod fault;
mod guard;
mod ingest;
mod query;
mod spawn;
mod state;
#[cfg(test)]
mod wedge;

use guard::InstanceGuard;
use spawn::{RecordingTarget, open_recorder};

pub use fault::RecordingFault;

/// Database coordinates captured at `start` so creating or resuming a session
/// reuses the same store without the caller supplying them again.
#[derive(Debug, Clone)]
struct HubDatabase {
    path: PathBuf,
    limits: RecordingLimits,
}

#[derive(Debug)]
struct HubState {
    recorder: Option<Arc<Recorder>>,
    active: HashMap<PortIdentity, DisplayBinding>,
    sequences: HashMap<PortIdentity, u64>,
    /// 在册 writer 的写入故障 — 绑定批次已受理却写不下去, 录制契约被破坏
    /// ([`RecordingHub::fault`] 据此让采集停止)。**只有**这一种情况会置位。
    fault: Option<RecordingFault>,
    /// 录制不可用 — 未能建立 recorder (数据库打开/建库失败, 或数据库文件正被
    /// 另一个实例独占), 或 writer 失去响应。此时没有任何绑定批次, 因此**不是**
    /// 写入故障: 采集照常运行, 只是没有录制。
    unavailable: Option<String>,
    /// 打开时自动重建过数据库 — **可见但非故障**的消息 (走健康报告的 warning,
    /// 绝不进 `failed`: 那会被当成录制契约破坏而停掉采集)。
    recovered: Option<String>,
    /// 数据库写入总开关 (设置项, 默认开)。`false` 时不建任何 DuckDB 连接,
    /// 所有生产者看到未绑定, 采集与运行控制完全不受影响。
    enabled: bool,
    /// 数据库文件的进程级独占守卫 — 两个实例同时写一个 DuckDB 文件会互相
    /// checkpoint 覆盖, 静默抹掉已提交写入。
    guard: Option<InstanceGuard>,
    database: Option<HubDatabase>,
}

impl Default for HubState {
    fn default() -> Self {
        Self {
            recorder: None,
            active: HashMap::new(),
            sequences: HashMap::new(),
            fault: None,
            unavailable: None,
            recovered: None,
            // 默认开启: 关闭是用户显式选择, 不是默认行为。
            enabled: true,
            guard: None,
            database: None,
        }
    }
}

/// Cloneable recording port shared by producers in all four domains.
#[derive(Clone, Default)]
pub struct RecordingHub {
    state: Arc<RwLock<HubState>>,
    /// 进行中的只读 SQL — 查询在写线程的唯一连接上执行, 取消经这里的中断槽。
    queries: Arc<RwLock<HashMap<String, Arc<QueryCancellation>>>>,
}

impl RecordingHub {
    /// Start recording at `path` with initial session state `initial`.
    ///
    /// The newest session is resumed when it holds no batches (see
    /// [`RecordingStore::resumable_empty_session`]), so restarts without any
    /// recorded data keep writing into one session instead of accumulating
    /// empty ones; otherwise a brand-new session is created.
    ///
    /// Failure to open the database leaves the hub without a recorder: recording
    /// stays unavailable ([`Self::health`]) and producers keep running — an
    /// unusable database must never be reported as a writer fault
    /// ([`Self::fault`]).
    pub fn start(
        &self,
        path: impl AsRef<Path>,
        bindings: Vec<DisplayBinding>,
        limits: RecordingLimits,
        initial: SessionState,
    ) -> Result<SessionInfo, RecordingError> {
        let path = path.as_ref().to_path_buf();
        let active = unique_bindings(bindings);
        self.replace_recording(
            &path,
            limits,
            active,
            RecordingTarget::ContinueEmpty,
            initial,
        )
    }

    /// Start writing into a brand-new session in the same database, replacing
    /// the current recorder. The replaced session is marked stopped.
    pub fn create_session(&self, initial: SessionState) -> Result<SessionInfo, RecordingError> {
        let (path, limits, active) = self.database_and_bindings()?;
        self.replace_recording(&path, limits, active, RecordingTarget::New, initial)
    }

    /// Resume writing into an existing stopped session, replacing the current
    /// recorder. The replaced session is marked stopped.
    pub fn switch_session(
        &self,
        session_id: &str,
        initial: SessionState,
    ) -> Result<SessionInfo, RecordingError> {
        let (path, limits, active) = self.database_and_bindings()?;
        if self.current_session_id().as_deref() == Some(session_id) {
            return Err(RecordingError::Invalid(
                "session is already the active recording target".into(),
            ));
        }
        {
            let store = self.store().ok_or_else(|| self.unavailable_error())?;
            let target = store
                .list_sessions()?
                .into_iter()
                .find(|session| session.id == session_id)
                .ok_or_else(|| {
                    RecordingError::Invalid(format!(
                        "recording session was not found: {session_id}"
                    ))
                })?;
            if target.state != SessionState::Stopped {
                return Err(RecordingError::Invalid(format!(
                    "only stopped recording sessions can be resumed: {session_id}"
                )));
            }
        }
        self.replace_recording(
            &path,
            limits,
            active,
            RecordingTarget::Resume(session_id.to_string()),
            initial,
        )
    }

    /// Apply persisted storage preferences replayed from settings: the
    /// database path and the empty-session continuation toggle. Only swaps
    /// the recorder when the effective target changed; must not be called
    /// while the run is active (see [`RecordingHub::create_session`]).
    pub fn apply_settings(
        &self,
        database_path: Option<PathBuf>,
        continue_empty: bool,
        initial: SessionState,
    ) -> Result<bool, RecordingError> {
        spawn::apply_settings(self, database_path, continue_empty, initial)
    }

    /// Swap in a recorder for `target`, resuming into `initial`.
    ///
    /// The previous writer must fully close its DuckDB instance before the
    /// replacement opens its own: `Connection::open` creates an independent
    /// database instance, and concurrent instances on one file checkpoint over
    /// each other, silently erasing committed writes. While the recorder is
    /// absent no batches are produced, so the caller must exclude in-flight
    /// producers for the whole swap (the desktop path holds the execution
    /// boundary write lock) — a paused run keeps feeding data.
    ///
    /// A swap that cannot open the database leaves recording *unavailable*
    /// ([`Self::health`] reports it) without raising a writer fault — nothing
    /// is bound, so the acquisition contract is intact.
    ///
    /// 打开前先取数据库文件的进程级独占守卫: 两个实例同时写一个 DuckDB 文件
    /// 会各自 checkpoint 并互相覆盖。拿不到守卫同样是「不可用」而不是故障。
    fn replace_recording(
        &self,
        path: &Path,
        limits: RecordingLimits,
        active: HashMap<PortIdentity, DisplayBinding>,
        target: RecordingTarget,
        initial: SessionState,
    ) -> Result<SessionInfo, RecordingError> {
        let shutdown = self.take_recorder().map(|recorder| recorder.shutdown());
        if let Some(Err(error)) = shutdown {
            // 旧的 writer 关不掉 = 已受理批次可能没落盘, 这是真故障; 但卡死的
            // writer 只算不可用 — 继续持有它只会把换库路径一起拖死。
            self.note_failure(&error);
            return Err(error);
        }
        // 换库/重开前先交出旧守卫, 否则同一进程重开会把自己挡住。
        self.state.write().guard = None;
        let guard = match InstanceGuard::acquire(path) {
            Ok(Some(guard)) => guard,
            Ok(None) => {
                let message = format!(
                    "recording database is held by another instance: {}",
                    path.display()
                );
                self.mark_unavailable(path, limits, message.clone());
                return Err(RecordingError::Failed(message));
            }
            Err(error) => {
                let message = format!("recording database guard failed: {error}");
                self.mark_unavailable(path, limits, message.clone());
                return Err(RecordingError::Failed(message));
            }
        };
        let outcome = open_recorder(path, limits, active.clone(), target, initial, guard);
        match outcome {
            Ok((recorder, guard, recovered)) => {
                let session = recorder.session().clone();
                let mut state = self.state.write();
                state.recorder = Some(recorder);
                state.active = active;
                state.sequences.clear();
                state.fault = None;
                state.unavailable = None;
                state.recovered = recovered;
                state.enabled = true;
                state.guard = Some(guard);
                state.database = Some(HubDatabase {
                    path: path.to_path_buf(),
                    limits,
                });
                Ok(session)
            }
            Err(error) => {
                let message = error.to_string();
                self.mark_unavailable(path, limits, message);
                Err(error)
            }
        }
    }

    /// 记「录制不可用」并登记坐标 — 采集照常, 但用户必须看得见没有录制。
    fn mark_unavailable(&self, path: &Path, limits: RecordingLimits, message: String) {
        let mut state = self.state.write();
        state.recorder = None;
        state.guard = None;
        // 打不开 = 没有录制, 不是录制写入失败: 记入 unavailable, 让 fault 只描述
        // 在册 writer 的失败 (否则采集会被永久挡住)。
        state.fault = None;
        state.unavailable = Some(message);
        state.recovered = None;
        // 打开失败不算「关闭」: 开关仍是开的, 只是这一次没打开。
        state.enabled = true;
        state.database = Some(HubDatabase {
            path: path.to_path_buf(),
            limits,
        });
    }

    fn database_and_bindings(
        &self,
    ) -> Result<
        (
            PathBuf,
            RecordingLimits,
            HashMap<PortIdentity, DisplayBinding>,
        ),
        RecordingError,
    > {
        let (database, active) = {
            let state = self.state.read();
            (state.database.clone(), state.active.clone())
        };
        let database = database.ok_or_else(|| self.unavailable_error())?;
        Ok((database.path, database.limits, active))
    }

    fn take_recorder(&self) -> Option<Arc<Recorder>> {
        self.state.write().recorder.take()
    }

    #[must_use]
    fn current_session_id(&self) -> Option<String> {
        self.state
            .read()
            .recorder
            .as_ref()
            .map(|recorder| recorder.session().id.clone())
    }

    /// Replace active display bindings. Existing rows stay queryable; a removed
    /// binding immediately stops accepting new batches.
    ///
    /// The writer round-trips run **不持状态锁** — 一次卡住的 writer 会让
    /// `bind`/`unbind` 最坏等待 [`Recorder`] 的应答上限, 持锁等待会连带堵死
    /// 采集热路径。
    pub fn sync_bindings(&self, bindings: Vec<DisplayBinding>) -> Result<(), RecordingError> {
        let next = unique_bindings(bindings);
        let (recorder, current) = {
            let state = self.state.read();
            (state.recorder.clone(), state.active.clone())
        };
        if let Some(recorder) = recorder {
            for (port, binding) in &current {
                if !next.contains_key(port)
                    && let Err(error) = recorder.unbind(&binding.id)
                {
                    self.note_failure(&error);
                    return Err(error);
                }
            }
            for (port, binding) in &next {
                if !current.contains_key(port)
                    && let Err(error) = recorder.bind(binding.clone())
                {
                    self.note_failure(&error);
                    return Err(error);
                }
            }
        }
        self.state.write().active = next;
        Ok(())
    }

    #[must_use]
    pub fn is_bound(&self, port: &PortIdentity) -> bool {
        let state = self.state.read();
        // 关闭、打不开、被别的实例占住时生产者都看到未绑定, 于是所有热路径自然
        // 停录 (连批次载荷都不必构造) — 不需要改任何写入方。
        state.enabled && state.recorder.is_some() && state.active.contains_key(port)
    }
}

fn unique_bindings(bindings: Vec<DisplayBinding>) -> HashMap<PortIdentity, DisplayBinding> {
    bindings
        .into_iter()
        .map(|binding| (binding.port.clone(), binding))
        .collect()
}

fn cleanup_session_ids(
    sessions: &[SessionInfo],
    current_session_id: &str,
    policy: &RecordingCleanupPolicy,
) -> Result<Vec<String>, RecordingError> {
    let by_id: HashMap<&str, &SessionInfo> = sessions
        .iter()
        .map(|session| (session.id.as_str(), session))
        .collect();
    for id in &policy.session_ids {
        if id == current_session_id {
            return Err(RecordingError::Invalid(
                "the current recording session cannot be deleted".into(),
            ));
        }
        if !(by_id.contains_key(id.as_str())) {
            return Err(RecordingError::Invalid(format!(
                "recording session was not found: {id}"
            )));
        }
    }
    let mut selected: HashSet<String> = policy.session_ids.iter().cloned().collect();
    let is_terminal = |session: &SessionInfo| {
        session.state == SessionState::Stopped || session.state == SessionState::Failed
    };
    for session in sessions {
        if session.id == current_session_id || !(is_terminal(session)) {
            continue;
        }
        if (policy.delete_stopped && session.state == SessionState::Stopped)
            || (policy.delete_failed && session.state == SessionState::Failed)
        {
            selected.insert(session.id.clone());
        }
        if let Some(threshold) = policy.older_than_us {
            let ended_at = session.ended_at_us.unwrap_or(session.started_at_us);
            if ended_at < threshold {
                selected.insert(session.id.clone());
            }
        }
    }
    if let Some(keep_latest) = policy.keep_latest {
        let mut terminal: Vec<&SessionInfo> = sessions
            .iter()
            .filter(|session| session.id != current_session_id && is_terminal(session))
            .collect();
        terminal.sort_by_key(|session| std::cmp::Reverse(session.started_at_us));
        for session in terminal.into_iter().skip(keep_latest) {
            selected.insert(session.id.clone());
        }
    }
    Ok(selected.into_iter().collect())
}
