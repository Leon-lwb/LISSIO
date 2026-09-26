//! 模型目录、文档准备与描述 — 前后端共享模型的 L3 用例层。
//!
//! 职责边界:
//! - [`catalog`]: 从各领域**实际注册对象**组装只读 [`ModelCatalog`]
//!   (kind 控件注册表 / schema_types 预设工厂 / device-tree 驱动注册表 /
//!   llm provider 注册表) — 不存在第二份全局总表。
//! - [`prepare`]: 纯用例 — 创建/归一化 NodeDocument 草稿, 不改图、不开设备、
//!   不落盘。默认工厂与变体解释在各领域 owner (kind/schema_types/device-tree)。
//! - [`describe`]: 纯用例 — 配置与拓扑的完整端口描述, 不要求整图编译成功。
//!
//! wire 合同类型在 `data_model::model_descriptor`; 包含 NodeDocument 的
//! 请求/响应在这里定义 (避免 L0 依赖 kind)。

pub mod catalog;
pub mod describe;
pub mod prepare;

pub use catalog::{CatalogSources, build_model_catalog};
pub use data_model::model_descriptor::{
    ModelCatalog as ModelCatalogSnapshot, ModelDescriptor, ModelDisplay, ModelFamily, ModelUiHints,
};
pub use describe::{
    DescribeRequest, DescribeResult, GraphEdgeRef, NodeDescription, NodeDescriptionStatus,
    NodeHint, describe_documents,
};
pub use prepare::{
    PrepareIssue, PrepareOperation, PrepareResult, PreparedDocument, prepare_documents,
};

use data_model::model_descriptor::{IssueSeverity, MODEL_CATALOG_CONTRACT_VERSION, ModelIssue};

pub const fn contract_version() -> u32 {
    MODEL_CATALOG_CONTRACT_VERSION
}

/// 结构化问题构造 (code 为稳定机器标识)。
pub fn issue(
    code: &str,
    path: Option<String>,
    message: impl Into<String>,
    severity: IssueSeverity,
) -> ModelIssue {
    ModelIssue {
        code: code.to_owned(),
        path,
        message: message.into(),
        severity,
    }
}
