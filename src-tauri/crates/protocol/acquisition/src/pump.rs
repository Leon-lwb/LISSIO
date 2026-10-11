//! 字节连接读写泵 — `AsyncRead`/`AsyncWrite` 连接共用的任务骨架。
//!
//! TCP 客户端与服务端经 [`spawn_byte_pump`] / [`BytePump`] 使用本实现; UDP
//! (`UdpSocket` 不实现读写 trait)、candleLight (nusb 端点) 与串口 (阻塞线程)
//! 保留各自的循环, 但持有同一三元组契约。
//!
//! 每个连接持有同一三元组: 写端 (`mpsc` 队列)、广播数据端、取消标志。
//! 读任务把设备字节变成 [`ByteMessage`] 广播给订阅者, 写任务把队列里的字节
//! 顺序写给设备; 两个任务都以 100ms 粒度轮询取消标志, 与既有实现逐字一致。

use crate::ByteMessage;
use data_model::INGEST_CHANNEL_CAPACITY;
use std::sync::Arc;
use std::sync::atomic::{AtomicBool, Ordering};
use std::time::Duration;
use tokio::io::{AsyncRead, AsyncReadExt, AsyncWrite, AsyncWriteExt};
use tokio::sync::{broadcast, mpsc};

/// 写端 — 调用方提交待发送字节
pub type ByteWriteSender = mpsc::Sender<Vec<u8>>;
/// 数据端 — 读任务广播设备字节
pub type ByteDataSender = broadcast::Sender<ByteMessage>;
/// 取消标志 — 置位后两个任务在下一个 100ms 轮询点退出
pub type ByteCancel = Arc<AtomicBool>;

/// 取消轮询间隔 — 与各传输既有实现一致
const CANCEL_POLL: Duration = Duration::from_millis(100);
/// 写队列深度 — 与各传输既有实现一致
const WRITE_QUEUE: usize = 64;

/// 字节连接泵 — 连接三元组 + 尚未交给写任务的队列接收端
pub struct BytePump {
    write_tx: ByteWriteSender,
    data_tx: ByteDataSender,
    cancel: ByteCancel,
    write_rx: mpsc::Receiver<Vec<u8>>,
}

impl BytePump {
    /// 创建连接三元组 (尚未启动任务)
    #[must_use]
    pub fn new() -> Self {
        let (data_tx, _) = broadcast::channel(INGEST_CHANNEL_CAPACITY);
        let (write_tx, write_rx) = mpsc::channel::<Vec<u8>>(WRITE_QUEUE);
        Self {
            write_tx,
            data_tx,
            cancel: Arc::new(AtomicBool::new(false)),
            write_rx,
        }
    }

    /// 连接句柄 — 可在启动任务前交给调用方 (TCP 服务端先返回句柄, 接受连接后再启动)
    #[must_use]
    pub fn handles(&self) -> (ByteWriteSender, ByteDataSender, ByteCancel) {
        (
            self.write_tx.clone(),
            self.data_tx.clone(),
            Arc::clone(&self.cancel),
        )
    }

    /// 用给定读写端启动读/写任务
    pub fn start<R, W>(&mut self, reader: R, writer: W, label: &'static str)
    where
        R: AsyncRead + Unpin + Send + 'static,
        W: AsyncWrite + Unpin + Send + 'static,
    {
        let data_tx = self.data_tx.clone();
        let cancel = Arc::clone(&self.cancel);
        spawn_read_loop(reader, data_tx, cancel, label);

        let write_rx = std::mem::replace(&mut self.write_rx, mpsc::channel::<Vec<u8>>(1).1);
        let cancel = Arc::clone(&self.cancel);
        spawn_write_loop(writer, write_rx, cancel, label);
    }
}

impl Default for BytePump {
    fn default() -> Self {
        Self::new()
    }
}

/// 启动读写泵 — 返回连接三元组 (TCP 客户端 / 一次性连接)
pub fn spawn_byte_pump<R, W>(
    reader: R,
    writer: W,
    label: &'static str,
) -> (ByteWriteSender, ByteDataSender, ByteCancel)
where
    R: AsyncRead + Unpin + Send + 'static,
    W: AsyncWrite + Unpin + Send + 'static,
{
    let mut pump = BytePump::new();
    let handles = pump.handles();
    pump.start(reader, writer, label);
    handles
}

fn spawn_read_loop<R>(
    mut reader: R,
    data_tx: ByteDataSender,
    cancel: ByteCancel,
    label: &'static str,
) where
    R: AsyncRead + Unpin + Send + 'static,
{
    tokio::spawn(async move {
        let mut buf = vec![0u8; 65536].into_boxed_slice();
        loop {
            tokio::select! {
                result = reader.read(&mut buf[..]) => {
                    match result {
                        Ok(0) => break,
                        Ok(n) => {
                            let _ = data_tx.send(ByteMessage::from_device(buf[..n].to_vec()));
                        }
                        Err(error) => {
                            log::error!("{label} 接收错误: {error}");
                            break;
                        }
                    }
                }
                () = tokio::time::sleep(CANCEL_POLL) => {
                    if cancel.load(Ordering::Relaxed) {
                        break;
                    }
                }
            }
        }
        log::debug!("{label} 读任务退出");
    });
}

fn spawn_write_loop<W>(
    mut writer: W,
    mut write_rx: mpsc::Receiver<Vec<u8>>,
    cancel: ByteCancel,
    label: &'static str,
) where
    W: AsyncWrite + Unpin + Send + 'static,
{
    tokio::spawn(async move {
        loop {
            tokio::select! {
                data = write_rx.recv() => {
                    match data {
                        Some(data) => {
                            if let Err(error) = writer.write_all(&data).await {
                                log::error!("{label} 发送错误: {error}");
                                break;
                            }
                        }
                        None => break,
                    }
                }
                () = tokio::time::sleep(CANCEL_POLL) => {
                    if cancel.load(Ordering::Relaxed) {
                        break;
                    }
                }
            }
        }
        log::debug!("{label} 写任务退出");
    });
}
