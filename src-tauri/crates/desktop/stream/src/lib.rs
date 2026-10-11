//! `stream` — Lissio 数据流分发层
//!
//! 层级: L2 pipeline — 数据流分发; 允许依赖 L0-L1。
//!
//! 两个核心组件:
//! - [`stream`] — 统一分片流框架 (`StreamSource` trait), 大数据流与
//!   小数据流共用同一套订阅协议与分发机制 (分片组 + 自动并发 +
//!   自适应速率推送 + 顺序保证)
//! - [`dispatcher`] — 自适应并发分发器 (`AdaptiveRate` 速率控制 +
//!   `adaptive_stream_loop` 单订阅者推送循环); 也供 ticker 循环使用

pub mod dispatcher;
pub mod sink;
pub mod stream;

pub use dispatcher::{AdaptiveRate, adaptive_stream_loop};
pub use sink::{StreamPayload, StreamSink};
pub use stream::{
    CanStreamSource, DecodedStreamSource, GroupMembership, LogicStreamSource, MAX_STREAM_SHARDS,
    RawDataSource, StreamSource, WaveformSource, WaveformViewSpec, bounded_drain_size,
    join_or_create_group, leave_group, sharded_stream_loop, sharded_stream_loop_map,
};
