//! Recorder construction for write-target swaps (same split as `writer/worker`).
//!
//! 打开数据库这一段是**有界**且**先探测**的: Windows 强制文件锁下
//! `Connection::open` 可能一直阻塞而不是报错, 而调用方 (换库 / 启动 / 开关)
//! 往往正持着数据链边界锁。

use std::collections::HashMap;
use std::fs::OpenOptions;
use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::sync::mpsc;
use std::time::Duration;

use super::guard::InstanceGuard;
use crate::{
    DisplayBinding, PortIdentity, Recorder, RecordingError, RecordingLimits, RecordingStore,
    SessionState,
};

/// Write target for a recorder swap: a brand-new session, an explicitly named
/// session, or the startup path that continues the newest session while it
/// stays empty.
#[derive(Debug, Clone)]
pub(super) enum RecordingTarget {
    New,
    Resume(String),
    ContinueEmpty,
}

/// 打开数据库的总上限 — 超时即归「录制不可用」(采集照常), 不再等下去。
const OPEN_TIMEOUT: Duration = Duration::from_secs(30);

/// 打开前可写性探测的重试退避 — 另一个实例正在收尾时, 短暂重试比立刻判死更贴近
/// 用户预期; 每次探测只是一次 `try_lock`, 不进入 DuckDB。
const PROBE_BACKOFF: [Duration; 3] = [
    Duration::from_millis(50),
    Duration::from_millis(200),
    Duration::from_millis(500),
];

/// 有界打开并构造 recorder, 返回 `(recorder, 守卫, 自动重建提示)`。
///
/// `guard` 由调用方创建后移交到这里: 打开可能卡住, 守卫必须跟着打开线程活到它
/// 结束 — 否则在「我们仍可能拿到连接」的窗口里, 别的实例会接管同一个文件。
///
/// 打开失败 / 超时都由调用方转成「录制不可用」: 数据库侧的问题不得波及采集。
pub(super) fn open_recorder(
    path: &Path,
    limits: RecordingLimits,
    active: HashMap<PortIdentity, DisplayBinding>,
    target: RecordingTarget,
    initial: SessionState,
    guard: InstanceGuard,
) -> Result<(Arc<Recorder>, InstanceGuard, Option<String>), RecordingError> {
    probe_writable(path)?;
    let (sender, receiver) = mpsc::channel();
    let owned = path.to_path_buf();
    std::thread::Builder::new()
        .name("recording-open".into())
        .spawn(move || {
            let outcome = build_recorder(&owned, limits, active, target, initial);
            // 打开结束后守卫随消息交回调用方; 超时则由本线程持有到打开真的结束。
            let _ = sender.send((outcome, guard));
        })?;
    match receiver.recv_timeout(OPEN_TIMEOUT) {
        Ok((Ok((recorder, note)), guard)) => Ok((recorder, guard, note)),
        Ok((Err(error), _guard)) => Err(error),
        Err(mpsc::RecvTimeoutError::Timeout) => Err(RecordingError::Timeout(OPEN_TIMEOUT)),
        Err(mpsc::RecvTimeoutError::Disconnected) => Err(RecordingError::Closed),
    }
}

/// 打开 + 校验 + 建/续会话 — 在 `recording-open` 线程里跑, 因此这里允许阻塞。
fn build_recorder(
    path: &Path,
    limits: RecordingLimits,
    active: HashMap<PortIdentity, DisplayBinding>,
    target: RecordingTarget,
    initial: SessionState,
) -> Result<(Arc<Recorder>, Option<String>), RecordingError> {
    // 打开即校验: 目录损坏时走既有重建路径, 提示经健康报告的 warning 通道外显。
    let (store, note) = RecordingStore::open_checked(path)?;
    let bindings = active.values().cloned().collect();
    let resumed = match target {
        RecordingTarget::ContinueEmpty => match store.resumable_empty_session()? {
            Some(session_id) => Some(store.reopen_session(&session_id, initial)?),
            None => None,
        },
        RecordingTarget::Resume(session_id) => Some(store.reopen_session(&session_id, initial)?),
        RecordingTarget::New => None,
    };
    let recorder = match resumed {
        Some(session) => Recorder::attach(store, session, bindings, limits)?,
        None => Recorder::start(store, bindings, limits)?,
    };
    if initial != SessionState::Running {
        recorder.set_state(initial)?;
    }
    Ok((Arc::new(recorder), note))
}

/// 打开前的可写性探测 — 在把文件交给 DuckDB 之前确认它可以读写。
///
/// Windows 上 `Connection::open` 遇到别的进程的强制锁会**阻塞**; 探测用
/// `try_lock` 把这种情况变成一次立即失败 (再按 [`PROBE_BACKOFF`] 重试几次) —
/// 拿不到就归「录制不可用」, 而不是让调用方挂在打开上。
fn probe_writable(path: &Path) -> Result<(), RecordingError> {
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent)?;
    }
    let mut last: Option<std::io::Error> = None;
    for (index, backoff) in PROBE_BACKOFF.iter().enumerate() {
        match probe_once(path) {
            Ok(()) => return Ok(()),
            Err(error) => last = Some(error),
        }
        if index + 1 < PROBE_BACKOFF.len() {
            std::thread::sleep(*backoff);
        }
    }
    Err(RecordingError::Failed(format!(
        "recording database is not writable: {}",
        last.map_or_else(|| "unknown".to_string(), |error| error.to_string())
    )))
}

/// 一次探测 — 锁**立刻释放**: 持有它会挡住 DuckDB 自己对同一个文件的锁。
///
/// 只探测**已存在**的文件: 用 `create(true)` 会先造出一个 0 字节文件, 而 DuckDB
/// 见到「存在但不是合法数据库文件」会直接报错, 于是首次启动反而建不了库。
fn probe_once(path: &Path) -> std::io::Result<()> {
    let file = match OpenOptions::new().read(true).write(true).open(path) {
        Ok(file) => file,
        // 文件不存在 = 没有实例占着它, DuckDB 会自己创建。
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(()),
        Err(error) => return Err(error),
    };
    file.try_lock().map_err(|error| match error {
        std::fs::TryLockError::WouldBlock => std::io::Error::new(
            std::io::ErrorKind::WouldBlock,
            "database file is locked by another process",
        ),
        std::fs::TryLockError::Error(inner) => inner,
    })
}

/// Apply persisted storage preferences replayed from settings: the database
/// path and the empty-session continuation toggle. Swaps the recorder only
/// when the effective target differs — another database path, or continuation
/// disabled while the boot-resumed session is still empty. Returns whether a
/// swap happened. The caller must ensure the run is paused or stopped and must
/// exclude in-flight producers while the recorder is absent (see
/// `replace_recording`).
pub(super) fn apply_settings(
    hub: &super::RecordingHub,
    database_path: Option<PathBuf>,
    continue_empty: bool,
    initial: SessionState,
) -> Result<bool, RecordingError> {
    let (current_path, limits, active) = hub.database_and_bindings()?;
    let target_path = database_path.unwrap_or_else(|| current_path.clone());
    if !hub.is_enabled() {
        // 总开关已关: 只登记新坐标, **不打开任何文件** — 避免打开正是关掉它的理由。
        if target_path != current_path {
            hub.remember_database(&target_path, limits);
            return Ok(true);
        }
        return Ok(false);
    }
    if target_path != current_path {
        let target = if continue_empty {
            RecordingTarget::ContinueEmpty
        } else {
            RecordingTarget::New
        };
        hub.replace_recording(&target_path, limits, active, target, initial)?;
        return Ok(true);
    }
    // Continuation disabled: abandon the boot-resumed session while it still
    // holds no batches, restoring one-session-per-start behavior.
    if !continue_empty && current_session_is_empty(hub)? {
        hub.replace_recording(&target_path, limits, active, RecordingTarget::New, initial)?;
        return Ok(true);
    }
    Ok(false)
}

/// Whether the active session holds no batches, queried on the hub's store.
fn current_session_is_empty(hub: &super::RecordingHub) -> Result<bool, RecordingError> {
    let query = {
        let state = hub.state.read();
        state
            .recorder
            .as_ref()
            .map(|recorder| (recorder.store().clone(), recorder.session().id.clone()))
    };
    match query {
        Some((store, session_id)) => store.session_is_empty(&session_id),
        None => Ok(false),
    }
}
