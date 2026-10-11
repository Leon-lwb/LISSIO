//! 解析输入缓冲上限 — 防止无界增长。
//!
//! 字节级引擎在找不到帧边界时会把未消费数据留在缓冲里; 超过上限后保留最新
//! 部分, 丢弃已无法构成完整帧的最老字节。

/// 触发截断的缓冲长度
pub const MAX_BUFFER: usize = 8192;
/// 截断后保留的最新字节数
pub const KEEP_BUFFER: usize = 4096;

/// 超过 [`MAX_BUFFER`] 时保留最新 [`KEEP_BUFFER`] 字节
pub fn truncate_buffer(buf: &mut Vec<u8>) {
    if buf.len() > MAX_BUFFER {
        let drop = buf.len() - KEEP_BUFFER;
        buf.drain(..drop);
    }
}
