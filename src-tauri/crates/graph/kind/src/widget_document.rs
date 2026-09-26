//! Widget business configuration → graph semantics. UI-only properties do not
//! enter the graph.
//!
//! 语义规则 (端口/默认/校验) 全部来自 [`crate::widgets`] 注册表 — 本模块只是
//! `NodeDocument::lower` 到注册表的薄委托, 不再维护第二份 kind switch。
use crate::document::CustomPorts;
use crate::kind::NodeKind;
use crate::widgets;

pub fn lower(
    kind: &str,
    params: &serde_json::Value,
    ports: Option<&CustomPorts>,
) -> Result<NodeKind, String> {
    widgets::lower(kind, params, ports)
}
