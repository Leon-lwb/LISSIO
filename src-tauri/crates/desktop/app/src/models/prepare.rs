//! 文档准备用例 — 创建/归一化 NodeDocument 草稿。
//!
//! 纯用例: 不修改图、不保存文件、不打开设备。支持批量 (快速开始模板)。
//! 合并顺序: 后端默认 → 后端变体 patch → discovery patch → 用户 configPatch;
//! 对象按字段合并, 数组整体替换, null 是显式值。
//! 子 ID (option/frame/rule) 由 nodeId 确定性派生 — 重复请求不产生不同 ID。

// 目录排序值等有界索引转换 — 统一豁免逐个标注的噪音。
#![allow(clippy::cast_possible_truncation, clippy::cast_sign_loss)]

use data_model::model_descriptor::ModelIssue;
use kind::document::NodeDocument;
use serde_json::{Value, json};

use crate::models::{catalog, issue};

/// 一次准备批请求中的单项操作。
#[derive(Debug, Clone)]
pub enum PrepareOperation {
    /// 从目录创建: modelId + 变体 + 布局 + 可选标签与配置补丁。
    Create {
        model_id: String,
        variant_id: Option<String>,
        node_id: String,
        tab_id: String,
        layout: kind::document::NodeLayout,
        label: Option<String>,
        config_patch: Value,
    },
    /// 归一化既有文档 (工作区恢复 / graph:source / AI 写入前的统一入口)。
    Normalize { document: NodeDocument },
}

/// 单项准备产物: 文档草稿 + 结构化问题。
#[derive(Debug, Clone)]
pub struct PreparedDocument {
    pub document: NodeDocument,
    pub issues: Vec<ModelIssue>,
}

/// 批量准备结果 — 与请求项一一对应。
#[derive(Debug, Clone)]
pub struct PrepareResult {
    pub items: Vec<Result<PreparedDocument, PrepareIssue>>,
}

/// 致命问题 (无法产出可编辑草稿, 如未知 model / 重复 identity)。
#[derive(Debug, Clone)]
pub struct PrepareIssue {
    pub code: String,
    pub message: String,
}

impl From<PrepareIssue> for ModelIssue {
    fn from(value: PrepareIssue) -> Self {
        Self {
            code: value.code,
            path: None,
            message: value.message,
            severity: data_model::model_descriptor::IssueSeverity::Error,
        }
    }
}

/// 归一化既有 widget 文档 (kind 注册表统一入口)。
pub fn normalize_widget_document(document: &mut NodeDocument) -> Result<(), String> {
    if let kind::document::NodeBusiness::Widget {
        widget_kind,
        params,
        ..
    } = &mut document.business
    {
        let widget_kind = widget_kind.clone();
        kind::widgets::normalize_params(&widget_kind, params)?;
    }
    Ok(())
}

/// 批量准备。`catalog` 提供模型查找; 子设备父子合同由调用方传入的
/// 父上下文解析 (父节点 NodeDecl 由当前文档/批次提供, 客户端不得伪造
/// 父能力)。
pub fn prepare_documents(
    catalog: &data_model::model_descriptor::ModelCatalog,
    operations: Vec<PrepareOperation>,
) -> PrepareResult {
    PrepareResult {
        items: operations
            .into_iter()
            .map(|operation| prepare_one(catalog, operation))
            .collect(),
    }
}

fn prepare_one(
    catalog: &data_model::model_descriptor::ModelCatalog,
    operation: PrepareOperation,
) -> Result<PreparedDocument, PrepareIssue> {
    match operation {
        PrepareOperation::Create {
            model_id,
            variant_id,
            node_id,
            tab_id,
            layout,
            label,
            config_patch,
        } => {
            if node_id.trim().is_empty() || tab_id.is_empty() {
                return Err(PrepareIssue {
                    code: "identity/invalid".to_owned(),
                    message: "nodeId and tabId are required".to_owned(),
                });
            }
            let widget_id = format!("widget:{model_id}");
            let Some(model) = catalog
                .models
                .iter()
                .find(|model| model.id == model_id || model.id == widget_id)
            else {
                return Err(PrepareIssue {
                    code: "model/unknown".to_owned(),
                    message: format!("unknown model id: {model_id}"),
                });
            };
            match model.family {
                data_model::model_descriptor::ModelFamily::Widget => create_widget_document(
                    model,
                    &node_id,
                    tab_id,
                    layout,
                    label,
                    config_patch,
                    variant_id,
                ),
                data_model::model_descriptor::ModelFamily::Protocol => {
                    create_protocol_document(model, node_id, tab_id, layout, label, config_patch)
                }
                data_model::model_descriptor::ModelFamily::Device => {
                    create_device_document(model, &node_id, tab_id, layout, label, config_patch)
                }
                data_model::model_descriptor::ModelFamily::PointSelector => {
                    Ok(create_point_selector_document(
                        model,
                        &node_id,
                        tab_id,
                        layout,
                        label,
                        &config_patch,
                    ))
                }
                data_model::model_descriptor::ModelFamily::AiProvider => Err(PrepareIssue {
                    code: "model/unknown".to_owned(),
                    message: format!("model {model_id} does not support create"),
                }),
            }
        }
        PrepareOperation::Normalize { mut document } => {
            let mut issues = Vec::new();
            if let kind::document::NodeBusiness::Widget {
                widget_kind,
                params,
                ..
            } = &mut document.business
            {
                let widget_kind = widget_kind.clone();
                if kind::widget_definition(&widget_kind).is_none() {
                    issues.push(issue(
                        "widget/unsupported",
                        Some("widgetKind".to_owned()),
                        format!("unknown widget kind: {widget_kind}"),
                        data_model::model_descriptor::IssueSeverity::Error,
                    ));
                    return Ok(PreparedDocument { document, issues });
                }
                kind::widgets::normalize_params(&widget_kind, params).map_err(|message| {
                    PrepareIssue {
                        code: "normalize/failed".to_owned(),
                        message,
                    }
                })?;
            }
            Ok(PreparedDocument { document, issues })
        }
    }
}

fn create_widget_document(
    model: &data_model::model_descriptor::ModelDescriptor,
    node_id: &str,
    tab_id: String,
    layout: kind::document::NodeLayout,
    label: Option<String>,
    config_patch: Value,
    variant_id: Option<String>,
) -> Result<PreparedDocument, PrepareIssue> {
    let widget_kind = model
        .id
        .strip_prefix("widget:")
        .unwrap_or_default()
        .to_owned();
    let Some(definition) = kind::widget_definition(&widget_kind) else {
        return Err(PrepareIssue {
            code: "model/unknown".to_owned(),
            message: format!("unknown widget kind: {widget_kind}"),
        });
    };
    let mut params = definition.default_params(node_id);
    // 合并顺序: 后端默认 → 后端变体 → 用户 configPatch (对象递归, 数组替换)
    if let Some(variant_id) = variant_id.as_deref() {
        let Some(variant) = model.variants.iter().find(|v| v.id == variant_id) else {
            return Err(PrepareIssue {
                code: "variant/unknown".to_owned(),
                message: format!("unknown variant {variant_id} for {widget_kind}"),
            });
        };
        merge_patch(&mut params, variant.config_patch.clone());
    }
    merge_patch(&mut params, config_patch);
    // 身份权威在后端: params.id 恒等于 nodeId, 子 ID (option/frame/rule) 由它派生
    if let Some(object) = params.as_object_mut() {
        object.insert("id".into(), json!(node_id));
    }
    kind::widgets::normalize_params(&widget_kind, &mut params).map_err(|message| PrepareIssue {
        code: "normalize/failed".to_owned(),
        message,
    })?;
    let mut document = NodeDocument {
        id: node_id.to_owned(),
        tab_id,
        label: params
            .get("label")
            .and_then(Value::as_str)
            .unwrap_or(widget_kind.as_str())
            .to_owned(),
        layout,
        business: kind::document::NodeBusiness::Widget {
            widget_kind,
            params,
            custom_ports: None,
        },
    };
    if let Some(label) = label {
        document.label = label;
    }
    Ok(PreparedDocument {
        document,
        issues: Vec::new(),
    })
}

fn create_protocol_document(
    model: &data_model::model_descriptor::ModelDescriptor,
    node_id: String,
    tab_id: String,
    layout: kind::document::NodeLayout,
    label: Option<String>,
    config_patch: Value,
) -> Result<PreparedDocument, PrepareIssue> {
    let protocol: schema_types::ProtocolConfig =
        serde_json::from_value(model.default_config.clone()).map_err(|error| PrepareIssue {
            code: "default/invalid".to_owned(),
            message: error.to_string(),
        })?;
    let mut protocol_value = serde_json::to_value(&protocol).expect("protocol serializes");
    if let Some(patch) = config_patch.get("protocol") {
        merge_patch(&mut protocol_value, patch.clone());
    }
    let protocol: schema_types::ProtocolConfig =
        serde_json::from_value(protocol_value).map_err(|error| PrepareIssue {
            code: "patch/invalid".to_owned(),
            message: error.to_string(),
        })?;
    let schema = schema_types::schema_from_protocol_config(&protocol);
    let document = NodeDocument {
        id: node_id,
        tab_id,
        label: label.unwrap_or_else(|| model.display.fallback_label.clone()),
        layout,
        business: kind::document::NodeBusiness::Protocol {
            protocol,
            convert_to: None,
            schema,
        },
    };
    Ok(PreparedDocument {
        document,
        issues: Vec::new(),
    })
}

fn create_device_document(
    model: &data_model::model_descriptor::ModelDescriptor,
    node_id: &str,
    tab_id: String,
    layout: kind::document::NodeLayout,
    label: Option<String>,
    config_patch: Value,
) -> Result<PreparedDocument, PrepareIssue> {
    // 设备默认配置由驱动 default_config 提供; 客户端不得伪造父能力
    let mut config_patch = config_patch;
    let mut config = if model.default_config.is_null() {
        Value::Object(serde_json::Map::new())
    } else {
        model.default_config.clone()
    };
    if let Some(patch) = config_patch.get_mut("config") {
        merge_patch(&mut config, std::mem::take(patch));
    }
    let name = label.unwrap_or_else(|| model.display.fallback_label.clone());
    let document = NodeDocument {
        id: node_id.to_owned(),
        tab_id,
        label: name.clone(),
        layout,
        business: kind::document::NodeBusiness::Device {
            node: data_model::device_tree::NodeDecl {
                id: data_model::device_tree::NodeId::new(node_id).map_err(|error| {
                    PrepareIssue {
                        code: "identity/invalid".to_owned(),
                        message: error.to_string(),
                    }
                })?,
                name,
                driver: data_model::device_tree::DriverId(
                    model
                        .id
                        .strip_prefix("driver:")
                        .unwrap_or_default()
                        .to_owned(),
                ),
                schema_version: model.schema_version,
                config,
                enabled: true,
                capability_endpoint_id: config_patch
                    .get("capabilityEndpointId")
                    .and_then(Value::as_str)
                    .map(str::to_owned),
                children: Vec::new(),
            },
        },
    };
    Ok(PreparedDocument {
        document,
        issues: Vec::new(),
    })
}

fn create_point_selector_document(
    model: &data_model::model_descriptor::ModelDescriptor,
    node_id: &str,
    tab_id: String,
    layout: kind::document::NodeLayout,
    label: Option<String>,
    config_patch: &Value,
) -> PreparedDocument {
    let points = config_patch
        .get("points")
        .cloned()
        .unwrap_or_else(|| json!([]));
    let document = NodeDocument {
        id: node_id.to_owned(),
        tab_id,
        label: label.unwrap_or_else(|| model.display.fallback_label.clone()),
        layout,
        business: kind::document::NodeBusiness::PointSelector {
            points: serde_json::from_value(points).unwrap_or_default(),
        },
    };
    PreparedDocument {
        document,
        issues: Vec::new(),
    }
}

/// 配置补丁合并 (计划固化行为 2): 对象按字段递归合并, 数组整体替换,
/// null 是显式值 (覆盖默认), 缺省保留默认。
pub fn merge_patch(target: &mut Value, patch: Value) {
    match (target, patch) {
        (Value::Object(target_map), Value::Object(patch_map)) => {
            for (key, value) in patch_map {
                match value {
                    Value::Null => {
                        target_map.insert(key, Value::Null);
                    }
                    value => match target_map.get_mut(&key) {
                        Some(slot) => merge_patch(slot, value),
                        None => {
                            target_map.insert(key, value);
                        }
                    },
                }
            }
        }
        (target, patch) => *target = patch,
    }
}

#[cfg(test)]
mod tests;
