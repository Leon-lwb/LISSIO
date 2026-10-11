//! 轮询会话的共享连接状态机 — modbus 与 s7 的唯一实现。
//!
//! 两个适配器各自复制过同一段 `ensure_connected` (关闭检查 → 已连接短路 →
//! 连接 / 指数退避 / epoch 递增 / 状态迁移) 与同一份 `stopped` / `close` 骨架。
//! 这里持有唯一版本: 适配器的 `Runtime` 实现 [`SessionState`] 与
//! [`ConnectionSlot`], 协议差异只留在 `connect` 与 `disconnect` 闭包里。

use crate::config::{ReconnectConfig, reconnect_delay};
use crate::{AcquisitionError, AcquisitionResult, SourceState};
use std::future::Future;
use std::sync::atomic::{AtomicU64, Ordering};
use tokio::sync::{Mutex, watch};

/// 会话状态 — 由适配器的 `Runtime` 实现
pub trait SessionState: Sync {
    /// 运行状态 (与既有实现同一把锁)
    fn state(&self) -> &parking_lot::RwLock<SourceState>;
    /// 关闭信号
    fn closed(&self) -> &watch::Sender<bool>;
    /// 连接代数 (每次成功连接递增)
    fn connection_epoch(&self) -> &AtomicU64;
    /// 采样序号 (每次成功连接清零)
    fn sequence(&self) -> &AtomicU64;
}

/// 连接槽 — 共享状态机读写协议连接
pub trait ConnectionSlot<C>: SessionState {
    /// 当前连接 (未连接为 `None`)
    fn connection(&self) -> &Mutex<Option<C>>;
}

/// 标记降级 — 保留失败原因供诊断
pub fn mark_degraded<S: SessionState + ?Sized>(session: &S, detail: &str) {
    *session.state().write() = SourceState::Degraded {
        detail: detail.into(),
    };
}

/// 标记在线 — 使用当前连接代数
pub fn mark_online<S: SessionState + ?Sized>(session: &S) {
    *session.state().write() = SourceState::Online {
        connection_epoch: session.connection_epoch().load(Ordering::Acquire),
    };
}

/// 确保已连接 — 已连接直接返回, 否则按 [`ReconnectConfig`] 指数退避重连
///
/// `connect` 每次尝试新建协议连接; `on_ready` 在连接写入槽位前执行 (适配器
/// 据此记录协商结果, 例如 S7 的 PDU 预算)。
///
/// # Errors
/// 会话已关闭时返回 [`AcquisitionError::Closed`]; 超过重连上限时返回最后一次
/// 连接错误。
pub async fn ensure_connected<C, S, Connect, Fut, Ready>(
    session: &S,
    reconnect: &ReconnectConfig,
    connect: Connect,
    on_ready: Ready,
) -> AcquisitionResult<()>
where
    C: Send + 'static,
    S: ConnectionSlot<C> + Sync + ?Sized,
    Connect: Fn() -> Fut + Send,
    Fut: Future<Output = AcquisitionResult<C>> + Send,
    Ready: FnOnce(&C) + Send,
{
    if *session.closed().borrow() {
        return Err(AcquisitionError::Closed);
    }
    if session.connection().lock().await.is_some() {
        return Ok(());
    }
    let mut attempt = 0_u32;
    loop {
        *session.state().write() = SourceState::Connecting;
        let mut closed = session.closed().subscribe();
        let connected = tokio::select! {
            _ = closed.changed() => return Err(AcquisitionError::Closed),
            result = connect() => result,
        };
        match connected {
            Ok(connection) => {
                on_ready(&connection);
                *session.connection().lock().await = Some(connection);
                session.sequence().store(0, Ordering::Release);
                let epoch = session.connection_epoch().fetch_add(1, Ordering::AcqRel) + 1;
                *session.state().write() = SourceState::Online {
                    connection_epoch: epoch,
                };
                return Ok(());
            }
            Err(error) if attempt >= reconnect.max_attempts => {
                mark_degraded(session, &error.to_string());
                return Err(error);
            }
            Err(error) => {
                mark_degraded(session, &error.to_string());
                attempt = attempt.saturating_add(1);
                *session.state().write() = SourceState::Backoff { attempt };
                let mut closed = session.closed().subscribe();
                tokio::select! {
                    () = tokio::time::sleep(reconnect_delay(reconnect, attempt)) => {}
                    _ = closed.changed() => return Err(AcquisitionError::Closed),
                }
            }
        }
    }
}

/// 等待关闭信号
///
/// # Errors
/// 关闭信号发送端被丢弃时返回 [`AcquisitionError::Closed`]。
pub async fn wait_closed<S: SessionState + Sync + ?Sized>(session: &S) -> AcquisitionResult<()> {
    let mut closed = session.closed().subscribe();
    while !*closed.borrow() {
        closed
            .changed()
            .await
            .map_err(|_| AcquisitionError::Closed)?;
    }
    Ok(())
}

/// 关闭会话 — 置位关闭信号, 取出连接交给 `disconnect`, 最后标记已关闭
///
/// # Errors
/// `disconnect` 失败时返回其错误 (状态仍置为 `Closed`)。
pub async fn close_with<C, S, Disconnect, Fut>(
    session: &S,
    disconnect: Disconnect,
) -> AcquisitionResult<()>
where
    C: Send + 'static,
    S: ConnectionSlot<C> + Sync + ?Sized,
    Disconnect: FnOnce(C) -> Fut + Send,
    Fut: Future<Output = AcquisitionResult<()>> + Send,
{
    *session.state().write() = SourceState::Closing;
    let _ = session.closed().send(true);
    // 先取出连接再 await, 避免 tokio MutexGuard 跨 await 点存活
    let connection = session.connection().lock().await.take();
    let result = match connection {
        Some(connection) => disconnect(connection).await,
        None => Ok(()),
    };
    *session.state().write() = SourceState::Closed;
    result
}
