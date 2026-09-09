//! `runtime` — L2 管线运行时门面
//!
//! 层级: L2 pipeline。向下允许依赖 L1 (protocol/transport/node) 与 L0 foundation,
//! 同层可依赖 pipeline 兄弟 crate; 向上只被 L3 (app/ai) 依赖, 不得依赖任何
//! `cmd/*` 命令 crate。
//!
//! 职责:
//! 1. 承载位置应在 L2 的运行时逻辑 — 后台发送 ticker (自动命令帧调度 /
//!    TextOut 写回 / 字符串输出与频谱推送) 与协议引擎工厂;
//! 2. 源图数据模型 (最近一次成功编译的 NodeDef/Edge/端口提示/widget 配置记录)
//!    的后端权威存储类型 — 发送调度按它解析 widget 输入;
//! 3. L1 类型统一转发 — L3 及以上一律经本门面引用 L1 类型 (engine/kind/
//!    transport/schema_engine/trigger/protocol_engine), 不直接依赖 L1 crate,
//!    使「每层只调前一层」机械可查 (见 scripts/check-crate-layers.mjs)。

pub mod protocol_factory;
pub mod source_graph;
pub mod tickers;

// ---- L1 类型统一转发 ----
pub use can_transport::candle;
pub use graph::{
    BytePlan, CompiledGraph, EdgeClass, HirNode, SourceFramesMap, SourceTextsMap, TypedGraph,
    ValuesMap,
};
pub use frame_decoder::FrameParser;
pub use kind::{
    port_domain, port_table, protocol_source_port_names, DecoderBlockDef, FieldType, MathOp,
    NodeDef, NodeKind, PortDomain, PortSpec, PortTable,
};
pub use protocol::{detect_format, parse_ascii, parse_hex, InputFormat, ProtocolEngine};
pub use schema::command_frame::{compute_frame_bytes, CommandFrameDto};
pub use schema::{command_frame, frame_checksum, frame_field};
pub use acquisition::AcquisitionRuntime;
pub use trigger::{TriggerMatchResult, TriggerMatcher, TriggerRuleDef};

// ---- 本 crate 模块的核心 API ----
pub use protocol_factory::create_engine;
pub use source_graph::{SourceGraphs, SourceNodeHint, TabSourceGraph, WidgetRecord};
pub use tickers::{
    resolve_widget_inputs, send_scheduler_ticker, spectrum_ticker, text_output_ticker,
    textout_sender_ticker,
};
