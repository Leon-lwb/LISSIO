//! 写线程的命令通道 — 投递、应答与读路径句柄。
//!
//! 这里集中两件曾经把界面挂死、把库写坏的事:
//! - **有界往返**: 投递 (`try_send` 重试到截止时刻) 与应答 (`recv_timeout`) 共享
//!   一份预算。writer 卡死时队列会被生产者填满, 只限应答的话 `send` 一样会永远
//!   阻塞 — 运行控制的 `set_state` 就再也投不出去, 暂停解不开。
//! - **唯一连接**: 查询 / 导出 / 会话检查经 [`RecordingReader`] 发到同一个写线程、
//!   同一个 DuckDB 连接上执行。每个读都新开实例会让多个实例各自 checkpoint 并
//!   互相覆盖, 静默抹掉已提交写入。

use std::sync::Arc;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::mpsc;
use std::time::{Duration, Instant};

use duckdb::InterruptHandle;
use parking_lot::Mutex;

use super::Command;
use crate::{
    BindingInfo, HistoryPage, HistoryQuery, RecordingDatabaseInfo, RecordingError, SessionInfo,
    SessionSummary, SqlResult,
};

/// 队列打满时重试投递命令的间隔。
const SEND_RETRY_INTERVAL: Duration = Duration::from_millis(5);

/// 写线程往来的时间预算。
///
/// 语义是**有界**, 不是性能目标: 生产值按「健康 writer 在重载下也必须宽裕通过」
/// 校准; 单测把预算压到毫秒级, 因为回归测试验证的是「一定会返回」这一机制本身,
/// 不需要真的等满生产预算 (集成测试用的是生产值, 因为它们链接的是非 cfg(test)
/// 编译的库)。
pub mod budget {
    use std::time::Duration;

    /// 控制往返上限 — 运行控制 (`set_state`)、绑定同步 (`bind`/`unbind`) 这些热
    /// 路径等待 writer 应答的上限。
    ///
    /// 没有这个上限, 一次卡住的写入会把调用方永久挂住: 界面表现为「点开始只出几
    /// 个字符, 暂停也解不开」。
    #[cfg(not(test))]
    pub const CONTROL: Duration = Duration::from_secs(5);
    #[cfg(test)]
    pub const CONTROL: Duration = Duration::from_millis(200);

    /// 关停上限 — 退出 / 换库路径等 writer 收尾的上限, 超时即 detach 线程。
    /// 关停要落最后一批已受理数据, 所以比控制往返宽, 但仍然有限。
    #[cfg(not(test))]
    pub const SHUTDOWN: Duration = Duration::from_secs(10);
    #[cfg(test)]
    pub const SHUTDOWN: Duration = Duration::from_millis(200);

    /// 维护上限 — `flush` / 删除会话是用户显式发起的重活 (可能搬动 GB 级数据),
    /// 上限只为「一定会返回」兜底, 不作为性能预算: 秒级预算在负载下会误伤正常的
    /// 大批量落盘, 把健康的 writer 判成卡死。
    #[cfg(not(test))]
    pub const MAINTENANCE: Duration = Duration::from_secs(120);
    #[cfg(test)]
    pub const MAINTENANCE: Duration = Duration::from_millis(200);

    /// 读上限 — 历史分页 / 只读 SQL 同样可能很慢 (大表扫描), 用户可用
    /// [`super::QueryCancellation`] 取消。与维护预算同级。
    #[cfg(not(test))]
    pub const READ: Duration = Duration::from_secs(120);
    #[cfg(test)]
    pub const READ: Duration = Duration::from_millis(200);
}

/// 一次有界往返的截止时刻 — 投递与应答共享同一条预算, 总等待不超过一份超时。
#[derive(Clone, Copy)]
pub struct Deadline(Instant);

impl Deadline {
    pub fn after(timeout: Duration) -> Self {
        Self(Instant::now() + timeout)
    }

    /// 剩余预算; 已用尽返回 `None`。
    pub fn remaining(self) -> Option<Duration> {
        self.0
            .checked_duration_since(Instant::now())
            .filter(|left| !left.is_zero())
    }
}

/// 有界投递一条命令 — 队列打满时按 [`SEND_RETRY_INTERVAL`] 重试到截止时刻。
///
/// **过去这里是 `send` (无界阻塞)**: writer 卡在 DuckDB 调用里时, 队列会被生产者
/// 填满, 于是运行控制的 `set_state` 永远投不出去 — 暂停再也解不开。
pub fn send_bounded(
    sender: &mpsc::SyncSender<Command>,
    mut command: Command,
    timeout: Duration,
    deadline: Deadline,
) -> Result<(), RecordingError> {
    loop {
        match sender.try_send(command) {
            Ok(()) => return Ok(()),
            Err(mpsc::TrySendError::Full(returned)) => {
                if deadline.remaining().is_none() {
                    return Err(RecordingError::Timeout(timeout));
                }
                command = returned;
                std::thread::sleep(SEND_RETRY_INTERVAL);
            }
            Err(mpsc::TrySendError::Disconnected(_)) => return Err(RecordingError::Closed),
        }
    }
}

/// 等待 writer 的**带载荷**应答 (清理结果 / 读结果) — 有界。
pub fn receive_reply<T>(
    receiver: mpsc::Receiver<Result<T, String>>,
    timeout: Duration,
    deadline: Deadline,
) -> Result<T, RecordingError> {
    let Some(left) = deadline.remaining() else {
        return Err(RecordingError::Timeout(timeout));
    };
    match receiver.recv_timeout(left) {
        Ok(result) => result.map_err(RecordingError::Failed),
        Err(mpsc::RecvTimeoutError::Timeout) => Err(RecordingError::Timeout(timeout)),
        Err(mpsc::RecvTimeoutError::Disconnected) => Err(RecordingError::Closed),
    }
}

/// 读路径句柄 — 把查询 / 导出 / 会话检查串行化到写线程的**唯一** DuckDB 连接。
///
/// 由 `Recorder` 挂到它持有的 [`crate::RecordingStore`] 上; 没有挂载时 (构造期、
/// 修复路径、测试直接 `RecordingStore::open`) 读路径退化为独占打开。
#[derive(Clone)]
pub struct RecordingReader {
    sender: mpsc::SyncSender<Command>,
}

impl std::fmt::Debug for RecordingReader {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter.write_str("RecordingReader(<writer thread>)")
    }
}

impl RecordingReader {
    pub const fn new(sender: mpsc::SyncSender<Command>) -> Self {
        Self { sender }
    }

    /// 发一次读请求并等应答 — 投递与应答共享一份 [`budget::READ`]。
    fn request<T>(
        &self,
        build: impl FnOnce(mpsc::Sender<Result<T, String>>) -> Command,
    ) -> Result<T, RecordingError> {
        let (reply, response) = mpsc::channel();
        let deadline = Deadline::after(budget::READ);
        send_bounded(&self.sender, build(reply), budget::READ, deadline)?;
        receive_reply(response, budget::READ, deadline)
    }

    pub fn sessions(&self) -> Result<Vec<SessionInfo>, RecordingError> {
        self.request(Command::ListSessions)
    }

    pub fn session_summaries(&self) -> Result<Vec<SessionSummary>, RecordingError> {
        self.request(Command::SessionSummaries)
    }

    pub fn database_info(&self) -> Result<RecordingDatabaseInfo, RecordingError> {
        self.request(Command::DatabaseInfo)
    }

    pub fn bindings(&self, session_id: &str) -> Result<Vec<BindingInfo>, RecordingError> {
        let session_id = session_id.to_string();
        self.request(move |reply| Command::Bindings(session_id, reply))
    }

    pub fn session_is_empty(&self, session_id: &str) -> Result<bool, RecordingError> {
        let session_id = session_id.to_string();
        self.request(move |reply| Command::SessionIsEmpty(session_id, reply))
    }

    pub fn history_page(&self, query: HistoryQuery) -> Result<HistoryPage, RecordingError> {
        self.request(move |reply| Command::HistoryPage(Box::new(query), reply))
    }

    pub fn delete_session(&self, session_id: &str) -> Result<(), RecordingError> {
        let session_id = session_id.to_string();
        self.request(move |reply| Command::DeleteSession(session_id, reply))
    }

    pub fn sql(
        &self,
        sql: String,
        max_rows: usize,
        cancellation: Arc<QueryCancellation>,
    ) -> Result<SqlResult, RecordingError> {
        self.request(move |reply| Command::Sql {
            sql,
            max_rows,
            cancellation,
            reply,
        })
    }
}

/// 只读 SQL 的取消槽。
///
/// 查询在写线程上执行, 中断句柄只有写线程拿得到, 因此取消请求与句柄登记通过这个
/// 槽交汇: 取消先到就记下意图, 句柄登记时立刻中断; 句柄先到就直接中断。
#[derive(Default)]
pub struct QueryCancellation {
    interrupt: Mutex<Option<Arc<InterruptHandle>>>,
    cancelled: AtomicBool,
}

impl std::fmt::Debug for QueryCancellation {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter
            .debug_struct("QueryCancellation")
            .field("attached", &self.interrupt.lock().is_some())
            .field("cancelled", &self.cancelled.load(Ordering::Relaxed))
            .finish()
    }
}

impl QueryCancellation {
    /// writer 线程在执行前登记中断句柄。
    pub fn attach(&self, interrupt: Arc<InterruptHandle>) {
        let cancelled = self.cancelled.load(Ordering::SeqCst);
        *self.interrupt.lock() = Some(interrupt.clone());
        if cancelled {
            interrupt.interrupt();
        }
    }

    /// 执行结束, 摘掉句柄 — 取消不再有意义。
    pub fn detach(&self) {
        *self.interrupt.lock() = None;
    }

    /// 请求取消: 无论句柄是否就绪都记下意图。
    pub fn cancel(&self) {
        self.cancelled.store(true, Ordering::SeqCst);
        let handle = self.interrupt.lock().clone();
        if let Some(handle) = handle {
            handle.interrupt();
        }
    }
}
