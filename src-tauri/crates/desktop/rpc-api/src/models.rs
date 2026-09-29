//! 模型目录与文档准备/描述 RPC — 前后端共享模型的统一入口。
//!
//! - `get_model_catalog`: 只读目录 (来自实际注册对象; 装配后不可变)。
//! - `prepare_node_documents`: 纯用例 — 创建/归一化草稿, 不改图不开设备。
//! - `describe_node_documents`: 纯用例 — 完整端口描述, 不要求整图编译成功。
//!
//! 三个命令对 Desktop/Web/CLI/MCP 同源 (dispatch 共用); 无副作用。

use serde::{Deserialize, Serialize};
use serde_json::Value;

use crate::RpcError;

/// `prepare_node_documents` 请求项 (tag = "op")。
#[derive(Debug, Clone, Deserialize, ts_rs::TS)]
#[serde(tag = "op", rename_all = "camelCase", rename_all_fields = "camelCase")]
pub enum PrepareOperationDto {
    Create {
        model_id: String,
        #[serde(default)]
        variant_id: Option<String>,
        node_id: String,
        tab_id: String,
        layout: kind::document::NodeLayout,
        #[serde(default)]
        label: Option<String>,
        #[serde(default)]
        config_patch: Value,
    },
    Normalize {
        document: kind::document::NodeDocument,
    },
}

#[derive(Debug, Clone, Deserialize, ts_rs::TS)]
#[serde(rename_all = "camelCase")]
pub struct PrepareRequest {
    /// 客户端当前持有的目录版本; 不匹配时返回可重试错误, 前端刷新目录。
    #[serde(default)]
    pub catalog_revision: String,
    pub operations: Vec<PrepareOperationDto>,
}

/// 单项结果 (tag = "ok")。
#[derive(Debug, Clone, Serialize, ts_rs::TS)]
#[serde(tag = "status", rename_all = "camelCase")]
pub enum PrepareOutcome {
    #[serde(rename = "ok")]
    Ok {
        document: Box<kind::document::NodeDocument>,
        issues: Vec<data_model::model_descriptor::ModelIssue>,
    },
    #[serde(rename = "failed")]
    Failed { code: String, message: String },
}

#[derive(Debug, Clone, Serialize, ts_rs::TS)]
#[serde(rename_all = "camelCase")]
pub struct PrepareResponse {
    pub catalog_revision: String,
    pub results: Vec<PrepareOutcome>,
}

#[derive(Debug, Clone, Serialize, ts_rs::TS)]
#[serde(rename_all = "camelCase")]
pub struct DescribeResponse {
    pub request_revision: u64,
    pub catalog_revision: String,
    pub nodes: Vec<app::models::NodeDescription>,
}

/// 稳定错误 kind — 前端按 kind 刷新目录后重试。
pub const CATALOG_REVISION_MISMATCH: &str = "CatalogRevisionMismatch";

/// `get_model_catalog` — 只读快照; 目录缺失说明宿主尚未装配 (不支持)。
pub async fn get_model_catalog(
    host: &crate::BackendHost,
    cmd: &str,
    _args: &Value,
) -> Result<Value, RpcError> {
    let catalog = host
        .state
        .model_catalog()
        .ok_or_else(|| RpcError::text("model catalog not assembled"))?;
    serde_json::to_value(&*catalog).map_err(|error| {
        RpcError::invalid_args(cmd, format!("catalog serialization failed: {error}"))
    })
}

/// `prepare_node_documents` — 批量创建/归一化草稿。
pub async fn prepare_node_documents(
    host: &crate::BackendHost,
    cmd: &str,
    args: &Value,
) -> Result<Value, RpcError> {
    let request: PrepareRequest = serde_json::from_value(args.clone()).map_err(|error| {
        RpcError::invalid_args(cmd, format!("prepare request decode failed: {error}"))
    })?;
    let catalog = host
        .state
        .model_catalog()
        .ok_or_else(|| RpcError::text("model catalog not assembled"))?;
    if !request.catalog_revision.is_empty() && request.catalog_revision != catalog.revision {
        // 目录已失效 — 前端刷新后重新准备 (可重试, 非命令失败)
        return Err(RpcError {
            kind: CATALOG_REVISION_MISMATCH.to_owned(),
            message: format!(
                "catalog revision mismatch: client {} vs server {}",
                request.catalog_revision, catalog.revision
            ),
            data: Some(serde_json::json!({ "expected": catalog.revision })),
        });
    }
    let operations = request
        .operations
        .into_iter()
        .map(app::models::PrepareOperation::from)
        .collect();
    let result = app::models::prepare_documents(&catalog, operations);
    let response = PrepareResponse {
        catalog_revision: catalog.revision.clone(),
        results: result.items.into_iter().map(PrepareOutcome::from).collect(),
    };
    serde_json::to_value(&response).map_err(|error| {
        RpcError::invalid_args(cmd, format!("prepare serialization failed: {error}"))
    })
}

/// 描述请求信封 — 字段名与 `app::models::DescribeRequest` (ts-rs 导出合同) 一致。
///
/// 唯一的差别是 `documents` 的元素保持为原始 JSON 值: 若在此处解码为
/// `NodeDocument`, 单条文档结构不合法就会让整次调用 `invalid_args`, 与「一次请求
/// 内某节点参数不完整不阻断其他节点」的契约相违 —— 画布上任意一条坏文档都会让
/// 全部 widget 节点失去端口。逐条解码由 `app::models::DescribeBatch::decode` 负责。
///
/// 本信封是**整体载荷** (`catalog::PAYLOAD_ARGS`): 顶层键直接对应 DTO 字段, 因此
/// `dispatch` 不会对它做顶层参数名归一。若把它从 `PAYLOAD_ARGS` 移除,
/// `requestRevision` 会被改名为 `request_revision` 而在此处解码失败。
#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
struct DescribeEnvelope {
    documents: Vec<Value>,
    edges: Vec<app::models::GraphEdgeRef>,
    request_revision: u64,
}

/// `describe_node_documents` — 批量端口描述 (逐节点容错)。
pub async fn describe_node_documents(
    host: &crate::BackendHost,
    cmd: &str,
    args: &Value,
) -> Result<Value, RpcError> {
    // 信封整体结构错误属协议错误 → invalid_args; 信封内的单条文档不合法属节点
    // 配置错误 → 只影响该节点 (产出 Unsupported 描述 + document/invalid 问题)。
    let envelope: DescribeEnvelope = serde_json::from_value(args.clone()).map_err(|error| {
        RpcError::invalid_args(cmd, format!("describe request decode failed: {error}"))
    })?;
    let catalog = host
        .state
        .model_catalog()
        .ok_or_else(|| RpcError::text("model catalog not assembled"))?;
    let batch = app::models::DescribeBatch::decode(
        &envelope.documents,
        envelope.edges,
        envelope.request_revision,
    );
    let result = app::models::describe_batch(&batch);
    let response = DescribeResponse {
        request_revision: result.request_revision,
        catalog_revision: catalog.revision.clone(),
        nodes: result.nodes,
    };
    serde_json::to_value(&response).map_err(|error| {
        RpcError::invalid_args(cmd, format!("describe serialization failed: {error}"))
    })
}

// ---- app 用例类型 → wire DTO 转换 ----

impl From<PrepareOperationDto> for app::models::PrepareOperation {
    fn from(dto: PrepareOperationDto) -> Self {
        match dto {
            PrepareOperationDto::Create {
                model_id,
                variant_id,
                node_id,
                tab_id,
                layout,
                label,
                config_patch,
            } => Self::Create {
                model_id,
                variant_id,
                node_id,
                tab_id,
                layout,
                label,
                config_patch,
            },
            PrepareOperationDto::Normalize { document } => Self::Normalize { document },
        }
    }
}

impl From<Result<app::models::PreparedDocument, app::models::PrepareIssue>> for PrepareOutcome {
    fn from(result: Result<app::models::PreparedDocument, app::models::PrepareIssue>) -> Self {
        match result {
            Ok(prepared) => Self::Ok {
                document: Box::new(prepared.document),
                issues: prepared.issues,
            },
            Err(failed) => Self::Failed {
                code: failed.code,
                message: failed.message,
            },
        }
    }
}
