//! `app_state` — L3 应用核心: 全局状态容器 + 显示订阅服务 + 传输/协议操作 +
//! 工作区持久化
//!
//! 层级: L3 app。向下只依赖 L2 (pipeline: data_plane/bus/dispatcher/stream/
//! runtime) 与 L0 foundation 基座; L1 类型 (engine/kind/transport/…) 一律经
//! [`runtime`] 门面转发引用, 不直接依赖 L1 crate — 「每层只调前一层」的机械
//! 校验见 `scripts/check-crate-layers.mjs`。禁止依赖任何 `cmd/*` 命令 crate。
//!
//! 模块职责:
//! - [`AppState`](app::AppState) 全局状态容器 (传输注册表 / 数据平面 /
//!   源图 / 工作区 / 各类缓冲);
//! - [`display`] 显示订阅编排 (原 cmd/display 的 spawn 循环与二进制编码);
//! - `transport_ops` / `protocol_ops` 传输连接与协议配置操作 (原 cmd/can_transport
//!   命令体下沉);
//! - `workspace` 工作区持久化;
//! - `background` 二进制组合根的后台任务启动与退出 flush。
//!
//! 后台 ticker (发送调度/TextOut/字符串输出/频谱) 定义在 L2 [`runtime`] 门面
//! crate, 此处 re-export 供二进制组合根与既有调用方使用。

// 异步块持有 GpuContext (wgpu 类型树过深), Send 求值超出默认 128 层递归上限
#![recursion_limit = "256"]

pub mod display;
pub mod models;

mod app_state;
mod background;
mod measure;
mod protocol_ops;
mod run_ops;
mod transport_ops;
mod workspace;

// ---- 本 crate 核心 ----
pub use app_state::{AppState, SerialDiscovery, SerialDiscoveryUnavailable, WaveformSnapshot};
pub use background::{
    TaskSpawner, flush_workspace, spawn_backend_tasks, start_recording, stop_recording,
    workspace_autosave_loop,
};
pub use transport_ops::{
    can_bitrate_bps, can_bitrate_choice, can_bitrate_with_source, close_device_session,
    open_device_session,
};

pub use measure::{
    ChannelMeasurement, SourceMeasurements, compute_autoset_suggestion, compute_source_measurements,
};
pub use measurement::AutoSetSuggestion;
pub use run_ops::apply_workspace_run;
pub use transport_ops::LoopbackResult;
pub use workspace::{
    DataTabMeta, Position, TabGraphFile, TabGraphSnapshot, TabMeta, WORKSPACE_FILE_NAME,
    WorkspaceFile, WorkspaceInner, WorkspaceSnapshot, WorkspaceState, await_restore_done,
    collect_workspace_file, load_workspace, save_workspace, workspace_path, workspace_snapshot,
};

// ---- 源图数据模型 (权威定义在 L2 runtime, 此处转发保持既有公共路径) ----
pub use pipeline::{SourceGraphs, SourceNodeHint, TabSourceGraph, WidgetRecord};

// ---- L1 类型统一转发 (来自 L2 runtime 门面) ----
pub use pipeline::{
    AcquisitionRuntime, BytePlan, CommandFrameDto, CompiledGraph, DecoderBlockDef, EdgeClass,
    FieldType, FrameParser, HirNode, InputFormat, MathOp, NodeDef, NodeKind, NodeOrigin,
    PortDomain, ProtocolEngine, SourceFramesMap, SourceTextsMap, TriggerMatchResult,
    TriggerMatcher, TriggerRuleDef, TypedGraph, ValuesMap, command_frame, compute_frame_bytes,
    create_engine, detect_format, frame_checksum, frame_field, parse_ascii, parse_hex, port_domain,
    protocol_source_port_names,
};
pub use pipeline::{
    resolve_widget_inputs, send_scheduler_ticker, spectrum_ticker, text_output_ticker,
    textout_sender_ticker,
};

// ---- L2 数据平面/数据总线 API 转发 (L4 命令薄壳经此引用) ----
pub use bus::{RuntimeHealth, RuntimeLimits, TopicKey};
pub use display::encode_waveform_window;
pub use pipeline::data_plane::{byte_router, frame_dispatch};
pub use pipeline::decoder_feed::DecoderFeedCache;
pub use pipeline::execution::{RunSnapshot, SendMode, SendStatus, SendTask};
pub use pipeline::run_control::apply_run_action;
pub use pipeline::{RunAction, RunState};
