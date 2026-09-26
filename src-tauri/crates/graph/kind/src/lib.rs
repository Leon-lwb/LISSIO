//! # kind
//!
//! Lissio 节点种类系统 — 节点定义 + 端口域模型 + Math 运算 + DecoderBlockDef 转发.
//!
//! 模块（按职责拆分，原 505 行的 `kind.rs` 现拆为四层）：
//! - [`NodeKind`][] 节点种类枚举（`kind.rs`）
//! - [`NodeDef`][] 节点定义（`spec.rs`）
//! - [`PortDomain`][crate::ports::PortDomain] / 强类型端口表
//!   ([`PortSpec`][]/[`PortTable`][]) + 端口 handle 常量（`ports.rs`）
//! - [`MathOp`][] / [`StrOp`][] / [`StrNumParams`][] / [`StrResult`][]（`math_op.rs` / `str_op`）
//! - [`DecoderBlockDef`][] FrameDecoder 块定义 re-export（`decoder_block.rs`）
//!
//! serde 约定：`NodeKind` 是 `#[serde(tag = "kind", content = "params")]`，前端 TS 镜像见
//! `src/lib/utils/nodeDef.ts`.

mod decoder_block;
mod kind;
mod math_op;
mod ports;
mod spec;
mod str_op;
pub mod widgets;

pub use decoder_block::{
    AsciiBase, DecoderBlockDef, DecoderChecksumCover, DecoderChecksumPosition, FieldType,
    LengthUnit,
};
pub use kind::{NewlineMode, NodeKind, is_protocol_source, is_raw_data_handle};
pub use math_op::MathOp;
pub use ports::{
    FRAME_DECODER_IN_HANDLE, LOOPBACK_OUT_HANDLE, PROTOCOL_IN_HANDLE, PROTOCOL_OUT_HANDLE,
    PortDomain, PortSpec, PortTable, RAW_DATA_PORT_PREFIX, TRANSPORT_RX_HANDLE,
    TRANSPORT_TX_HANDLE, port_domain, port_table,
};
pub use spec::{NodeDef, protocol_source_port_names};
pub use str_op::{StrNumParams, StrOp, StrResult, str_num_default};
pub use widgets::{
    WidgetDefinition, WidgetPort, WidgetPortTable, definition as widget_definition, definitions,
    ensure_valid, lower as lower_widget, normalize_params, ports_for,
};

/// 判断 (StrOp, 输入端口) 是否取内联回退文本 (`NodeKind::Str::tmpl`, 仅 FORMAT "fmt") —
/// lowering / 快慢两条求值路径共用的单一事实源
pub fn uses_str_inline_text(op: StrOp, port: &str) -> bool {
    op.uses_inline_text_default(port)
}
pub mod document;
mod widget_document;
