//! 从领域注册对象组装只读 [`ModelCatalog`]。
//!
//! 组装来源 (全部是启动时实际注册的对象, 不是手写总表):
//! - widget: `kind::widgets` 注册表 (29 类, 含 Math/Str/Filter 变体)
//! - protocol: `schema_types` 预设工厂 (JustFloat/FireWater/RawData/Slcan/
//!   CandleLight/LogicDecode; Diagnostic 不提供独立创建条目)
//! - device: `device_tree::DriverRegistry::manifests()` (feature 决定注册集)
//! - pointSelector: 固定结构节点
//! - aiProvider: `llm::types::ADAPTERS` (可配置, 不伪装成图节点)

// 目录排序值等有界索引转换 — 统一豁免逐个标注的噪音。
#![allow(clippy::cast_possible_truncation, clippy::cast_sign_loss)]

mod panels;
use panels::panel_descriptors;

use data_model::model_descriptor::{
    ConfigurationSchema, ModelAction, ModelAvailability, ModelCatalog, ModelDescriptor,
    ModelDisplay, ModelFamily, ModelUiHints, ModelVariant,
};
use serde_json::{Value, json};

use crate::models::issue;

/// 目录组装所需的领域注册快照。
pub struct CatalogSources<'a> {
    pub drivers: &'a device_tree::DriverRegistry,
    /// AI provider 描述 (由 L4 组合根从 `llm::types::ADAPTERS` 投影注入 —
    /// app 是 L3, 不能反向依赖 llm)。
    pub ai_providers: &'a [ModelDescriptor],
}

/// 目录 revision — 对注册描述的稳定哈希 (不透明字符串)。
fn revision(catalog: &ModelCatalog) -> String {
    // 稳定序列化 (BTreeMap 无影响; models/panels 按固定顺序) 后取简单 FNV-1a
    // 64 位。目录是只读静态描述, 哈希碰撞风险与实现简单性在这里是正确折中。
    // 面板也是目录的一部分 — 任一侧变化都必须换 revision。
    let Ok(bytes) = serde_json::to_vec(&(&catalog.models, &catalog.panels)) else {
        return "rev-unknown".into();
    };
    let mut hash: u64 = 0xcbf2_9ce4_8422_2325;
    for byte in &bytes {
        hash ^= u64::from(*byte);
        hash = hash.wrapping_mul(0x0000_0100_0000_01b3);
    }
    format!("rev-{hash:016x}")
}

pub fn build_model_catalog(sources: CatalogSources<'_>) -> Result<ModelCatalog, String> {
    // 注册表完整性: id 唯一 / renderer 合同 / 面板规格自洽 — 失败即启动失败
    kind::widgets::ensure_valid()?;

    let mut models = Vec::new();
    models.extend(widget_descriptors());
    models.extend(protocol_descriptors());
    models.extend(point_selector_descriptor());
    models.extend(device_descriptors(sources.drivers)?);
    models.extend(sources.ai_providers.iter().cloned());

    let mut catalog = ModelCatalog {
        contract_version: data_model::model_descriptor::MODEL_CATALOG_CONTRACT_VERSION,
        revision: String::new(),
        models,
        panels: panel_descriptors()?,
    };
    catalog.revision = revision(&catalog);
    Ok(catalog)
}

fn display(fallback: &str, category: &str, sort: u32) -> ModelDisplay {
    ModelDisplay {
        label_key: None,
        fallback_label: fallback.to_owned(),
        description_key: None,
        category: Some(category.to_owned()),
        sort_value: sort,
    }
}

const NODE_ACTIONS: &[data_model::model_descriptor::ModelAction] =
    &[ModelAction::CreateNode, ModelAction::Configure];

const CREATE_ONLY: &[data_model::model_descriptor::ModelAction] = &[ModelAction::CreateNode];

fn open_schema() -> ConfigurationSchema {
    ConfigurationSchema::open(1)
}

// ============ widget 家族 ============

/// 排序值按注册表顺序生成, 保证目录顺序稳定。
fn widget_descriptors() -> Vec<ModelDescriptor> {
    kind::widgets::definitions()
        .enumerate()
        .map(|(index, def)| ModelDescriptor {
            id: format!("widget:{}", def.kind),
            family: ModelFamily::Widget,
            schema_version: 1,
            display: display(def.fallback_label, def.category.as_str(), index as u32),
            ui: ModelUiHints {
                renderer_key: Some(def.renderer_key.to_owned()),
                editor_key: Some(def.renderer_key.to_owned()),
                icon: None,
            },
            configuration: open_schema(),
            default_config: Value::Null,
            variants: widget_variants(def.kind),
            actions: NODE_ACTIONS.to_vec(),
            availability: ModelAvailability::AVAILABLE,
        })
        .collect()
}

/// 变体构造器 — 同一 widgetKind 的全部变体共用一条 patch 规则。
fn variants_of(widget_kind: &str, entries: &[(&str, &str)]) -> Vec<ModelVariant> {
    entries
        .iter()
        .enumerate()
        .map(|(index, (id, label))| ModelVariant {
            id: (*id).to_owned(),
            display: display(label, "variants", index as u32),
            config_patch: match widget_kind {
                "Math" => {
                    json!({ "op": id, "inputCount": if math_text_unary(id) { 1 } else { 2 } })
                }
                "Str" => json!({ "op": id }),
                "Filter" => json!({ "preset": id }),
                _ => Value::Null,
            },
        })
        .collect()
}

/// Math op 变体 — 与 `kind::math_op::MathOp` 一一对应 (serde lowercase)。
fn math_variants() -> Vec<ModelVariant> {
    variants_of(
        "Math",
        &[
            ("add", "Math add"),
            ("sub", "Math sub"),
            ("mul", "Math mul"),
            ("div", "Math div"),
            ("avg", "Math avg"),
            ("min", "Math min"),
            ("max", "Math max"),
            ("abs", "Math abs"),
            ("neg", "Math neg"),
            ("square", "Math square"),
            ("sqrt", "Math sqrt"),
            ("sin", "Math sin"),
            ("cos", "Math cos"),
            ("tan", "Math tan"),
            ("log", "Math log"),
        ],
    )
}

/// Str op 变体 — 与 `kind::str_op::StrOp` 一一对应。
fn str_variants() -> Vec<ModelVariant> {
    variants_of(
        "Str",
        &[
            ("len", "Str len"),
            ("find", "Str find"),
            ("contains", "Str contains"),
            ("left", "Str left"),
            ("right", "Str right"),
            ("mid", "Str mid"),
            ("concat", "Str concat"),
            ("insert", "Str insert"),
            ("delete", "Str delete"),
            ("replace", "Str replace"),
            ("upper", "Str upper"),
            ("lower", "Str lower"),
            ("trim", "Str trim"),
            ("reverse", "Str reverse"),
            ("format", "Str format"),
            ("parse", "Str parse"),
            ("encode_hex", "Str encode_hex"),
        ],
    )
}

fn filter_variants() -> Vec<ModelVariant> {
    variants_of(
        "Filter",
        &[
            ("Lowpass", "Filter Lowpass"),
            ("Highpass", "Filter Highpass"),
            ("Bandpass", "Filter Bandpass"),
            ("Bandstop", "Filter Bandstop"),
        ],
    )
}

fn widget_variants(widget_kind: &str) -> Vec<ModelVariant> {
    match widget_kind {
        "Math" => math_variants(),
        "Str" => str_variants(),
        "Filter" => filter_variants(),
        _ => Vec::new(),
    }
}

fn math_text_unary(op: &str) -> bool {
    matches!(
        op,
        "abs" | "neg" | "square" | "sqrt" | "sin" | "cos" | "tan" | "log"
    )
}

// ============ protocol 家族 ============

const PROTOCOL_PRESETS: &[(&str, &str)] = &[
    ("JustFloat", "JustFloat"),
    ("FireWater", "FireWater"),
    ("RawData", "RawData"),
    ("Slcan", "Slcan (CAN)"),
    ("CandleLight", "candleLight (CAN)"),
    ("LogicDecode", "LogicDecode"),
];

fn protocol_descriptors() -> Vec<ModelDescriptor> {
    PROTOCOL_PRESETS
        .iter()
        .enumerate()
        .map(|(index, (kind, label))| {
            // LogicDecode 需要 decoder 配置 — 目录 default 用默认 UART 解码器
            let config_value = if *kind == "LogicDecode" {
                json!({ "kind": "LogicDecode", "decoder": { "kind": "Uart",
                    "params": { "baud_rate": 115200, "data_bits": 8, "parity": "none",
                    "stop_bits": "one", "channel": 0 } } })
            } else {
                json!({ "kind": kind })
            };
            let config: schema_types::ProtocolConfig =
                serde_json::from_value(config_value).expect("known protocol kind");
            ModelDescriptor {
                id: format!("protocol:{kind}"),
                family: ModelFamily::Protocol,
                schema_version: 1,
                display: display(label, "protocol", index as u32),
                ui: ModelUiHints {
                    renderer_key: Some("protocol".to_owned()),
                    editor_key: Some("protocol".to_owned()),
                    icon: None,
                },
                configuration: open_schema(),
                default_config: serde_json::to_value(&config).expect("protocol config"),
                variants: Vec::new(),
                actions: CREATE_ONLY.to_vec(),
                availability: ModelAvailability::AVAILABLE,
            }
        })
        .collect()
}

// ============ pointSelector 家族 ============

fn point_selector_descriptor() -> Vec<ModelDescriptor> {
    vec![ModelDescriptor {
        id: "pointSelector".to_owned(),
        family: ModelFamily::PointSelector,
        schema_version: 1,
        display: display("Point Selector", "structure", 0),
        ui: ModelUiHints {
            renderer_key: Some("point-selector".to_owned()),
            editor_key: Some("point-selector".to_owned()),
            icon: None,
        },
        configuration: open_schema(),
        default_config: json!({ "points": [] }),
        variants: Vec::new(),
        actions: CREATE_ONLY.to_vec(),
        availability: ModelAvailability::AVAILABLE,
    }]
}

// ============ device 家族 ============

fn device_descriptors(
    registry: &device_tree::DriverRegistry,
) -> Result<Vec<ModelDescriptor>, String> {
    let mut models = Vec::new();
    let manifests = registry.manifests();
    for (index, projection) in manifests.iter().enumerate() {
        let driver_id = projection.driver_id.as_str();
        // 仿真驱动是子节点语义, 由设备树父子约束创建, 不作为独立目录条目暴露
        if driver_id == data_model::device_tree::SIMULATION_DRIVER_ID {
            continue;
        }
        let default_config = registry
            .get(&projection.driver_id.clone())
            .ok_or_else(|| format!("driver vanished: {driver_id}"))?
            .default_config(driver_id)
            .unwrap_or(Value::Null);
        models.push(ModelDescriptor {
            id: format!("driver:{driver_id}"),
            family: ModelFamily::Device,
            schema_version: data_model::device_tree::DEVICE_TREE_SCHEMA_VERSION,
            display: display(&projection_display(projection), "device", index as u32),
            ui: ModelUiHints {
                renderer_key: Some("acquisition".to_owned()),
                editor_key: Some("acquisition".to_owned()),
                icon: None,
            },
            configuration: projection.config_schema.clone(),
            default_config,
            variants: Vec::new(),
            actions: CREATE_ONLY.to_vec(),
            availability: ModelAvailability::AVAILABLE,
        });
    }
    Ok(models)
}

fn projection_display(projection: &device_tree::DriverProjection) -> String {
    // DriverProjection 不携带展示名 — id 即稳定 fallback; 翻译仍在前端。
    projection.driver_id.as_str().to_owned()
}

/// 未知 model id 的标准结构化问题。
pub fn unknown_model_issue(model_id: &str) -> data_model::model_descriptor::ModelIssue {
    issue(
        "model/unknown",
        None,
        format!("unknown model id: {model_id}"),
        data_model::model_descriptor::IssueSeverity::Error,
    )
}

#[cfg(test)]
mod tests;
