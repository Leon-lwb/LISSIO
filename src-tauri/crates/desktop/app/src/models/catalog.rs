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

use data_model::model_descriptor::{
    ConfigurationSchema, ModelAction, ModelAvailability, ModelCatalog, ModelDescriptor,
    ModelDisplay, ModelFamily, ModelUiHints, ModelVariant, NodePortDescriptor, NodePortDomain,
};
use data_model::panel_descriptor::{
    PanelBinding, PanelDataPlane, PanelDelivery, PanelDescriptor, PanelKind, panel_ops,
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

const CONFIGURE_ONLY: &[data_model::model_descriptor::ModelAction] = &[ModelAction::Configure];

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

// ============ panel 家族 ============
//
// 面板不是独立的模型家族 — 它是显示控件面向窗口/停靠区的另一面, 因此与
// `models` 并列而不是混进 `models`。投影来源同样是**实际注册的控件定义**
// (`kind::widgets` 的 `panel` 字段), 加上两个无宿主控件的整库面板
// (CAN 总线 / 逻辑分析仪 — 它们是独立 tab, 不对应画布节点)。

/// 无宿主控件的整库面板 — 前端 `can` / `logic` 两个独立 tab。
///
/// 与派生面板不同, 它们不寻址任何画布节点 (`hostWidgetKind` 缺省,
/// `binding` 为 `Singleton`), 参数与端口也因此为空。
const STANDALONE_PANELS: &[StandalonePanelSpec] = &[
    StandalonePanelSpec {
        kind: PanelKind::Can,
        tab_type: "can",
        label_key: "menuPanelOpenCan",
        fallback_label: "CAN Frames",
        delivery: PanelDelivery::Both,
        push_request: panel_ops::PUSH_CAN_FRAMES,
        fetch_op: panel_ops::FETCH_CAN_FRAMES,
        default_interval_ms: 100,
        default_max_items: 200,
    },
    StandalonePanelSpec {
        kind: PanelKind::Logic,
        tab_type: "logic",
        label_key: "menuPanelOpenLogic",
        fallback_label: "Logic Analyzer",
        delivery: PanelDelivery::Both,
        push_request: panel_ops::PUSH_LOGIC_SAMPLES,
        fetch_op: panel_ops::FETCH_LOGIC_SAMPLES,
        default_interval_ms: 33,
        default_max_items: 500,
    },
];

/// 无宿主控件面板的静态形状 — 字段已是目录可下发的值类型 (控件侧同名字段是
/// `Option`/`&'static str`, 这里不存在缺省态)。
struct StandalonePanelSpec {
    kind: PanelKind,
    tab_type: &'static str,
    label_key: &'static str,
    fallback_label: &'static str,
    delivery: PanelDelivery,
    push_request: &'static str,
    fetch_op: &'static str,
    default_interval_ms: u32,
    default_max_items: u32,
}

/// 面板目录 — 从控件注册表投影 + 追加无宿主的整库面板。
///
/// 顺序即 frontend 菜单顺序: 先派生面板 (按注册表顺序), 再整库面板。
fn panel_descriptors() -> Result<Vec<PanelDescriptor>, String> {
    let mut descriptors = Vec::new();
    for def in kind::widgets::definitions() {
        let Some(spec) = def.panel else { continue };
        descriptors.push(host_panel_descriptor(def, &spec));
    }
    for spec in STANDALONE_PANELS {
        descriptors.push(standalone_panel_descriptor(spec));
    }

    // 排序值 = 投影顺序; 目录顺序稳定是前端菜单稳定的前提。
    for (index, descriptor) in descriptors.iter_mut().enumerate() {
        descriptor.display.sort_value = index as u32;
    }

    let ids = descriptors
        .iter()
        .map(|descriptor| descriptor.id.clone())
        .collect::<std::collections::BTreeSet<_>>();
    if ids.len() != descriptors.len() {
        return Err("duplicate panel descriptor id".to_owned());
    }
    Ok(descriptors)
}

/// 有宿主控件的面板 — 端口默认词表取自宿主控件在缺省参数下的端口表,
/// 使面板无需描述节点实例即可声明自己的通道/输入口。
fn host_panel_descriptor(
    def: &'static kind::widgets::WidgetDefinition,
    spec: &kind::widgets::PanelSpec,
) -> PanelDescriptor {
    // 缺省参数只用于解析端口词表; 实例 id 不进入面板描述 (hints only)。
    let params = def.default_params("panel");
    let table = def.ports(&params);
    let inputs = table
        .inputs
        .iter()
        .map(|p| port(p.handle.clone(), p.domain))
        .collect::<Vec<_>>();
    let outputs = table
        .outputs
        .iter()
        .map(|p| port(p.handle.clone(), p.domain))
        .collect::<Vec<_>>();

    PanelDescriptor {
        id: format!("panel:{}", spec.panel.as_str()),
        kind: spec.panel,
        tab_type: spec.tab_type.to_owned(),
        display: ModelDisplay {
            label_key: Some(spec.label_key.to_owned()),
            fallback_label: def.fallback_label.to_owned(),
            description_key: None,
            // 分组: 由控件派生的面板 / 无宿主的整库面板。
            category: Some("derived".to_owned()),
            sort_value: 0,
        },
        ui: ModelUiHints {
            // 面板复用宿主控件的渲染键; 面板自身没有独立属性编辑器。
            renderer_key: Some(def.renderer_key.to_owned()),
            editor_key: None,
            icon: None,
        },
        host_widget_kind: Some(def.kind.to_owned()),
        default_params: Value::Null,
        configuration: open_schema(),
        data_plane: PanelDataPlane {
            delivery: spec.delivery,
            push_request: spec.push_request.map(str::to_owned),
            fetch_op: spec.fetch_op.map(str::to_owned),
            default_interval_ms: spec.default_interval_ms,
            default_max_items: spec.default_max_items,
        },
        binding: resolve_binding(&spec.binding, &inputs),
        inputs,
        outputs,
    }
}

/// 无宿主控件的整库面板 — 不寻址节点, 端口为空。
fn standalone_panel_descriptor(spec: &StandalonePanelSpec) -> PanelDescriptor {
    PanelDescriptor {
        id: format!("panel:{}", spec.kind.as_str()),
        kind: spec.kind,
        tab_type: spec.tab_type.to_owned(),
        display: ModelDisplay {
            label_key: Some(spec.label_key.to_owned()),
            fallback_label: spec.fallback_label.to_owned(),
            description_key: None,
            category: Some("standalone".to_owned()),
            sort_value: 0,
        },
        ui: ModelUiHints {
            // 整库面板没有宿主控件; 渲染键回落为 tab 类型 (前端面板视图自行分派)。
            renderer_key: Some(spec.tab_type.to_owned()),
            editor_key: None,
            icon: None,
        },
        host_widget_kind: None,
        default_params: Value::Null,
        configuration: open_schema(),
        data_plane: PanelDataPlane {
            delivery: spec.delivery,
            push_request: Some(spec.push_request.to_owned()),
            fetch_op: Some(spec.fetch_op.to_owned()),
            default_interval_ms: Some(spec.default_interval_ms),
            default_max_items: Some(spec.default_max_items),
        },
        binding: PanelBinding::Singleton,
        inputs: Vec::new(),
        outputs: Vec::new(),
    }
}

/// 控件侧参数无关的绑定语义 → 目录侧可下发的具体绑定。
///
/// `EdgeBound` 在这里才展开成具体 handle 列表 (端口表由 params 解析, 只能在
/// 投影时确定)。
fn resolve_binding(
    spec: &kind::widgets::PanelBindingSpec,
    inputs: &[NodePortDescriptor],
) -> PanelBinding {
    match spec {
        kind::widgets::PanelBindingSpec::EdgeBound => PanelBinding::EdgeBound {
            input_handles: inputs.iter().map(|p| p.handle.clone()).collect(),
        },
        kind::widgets::PanelBindingSpec::ConfigBound {
            config_key,
            port_template,
        } => PanelBinding::ConfigBound {
            config_key: (*config_key).to_owned(),
            port_template: (*port_template).to_owned(),
        },
        kind::widgets::PanelBindingSpec::Singleton => PanelBinding::Singleton,
        kind::widgets::PanelBindingSpec::NodeScoped { node_id_param } => PanelBinding::NodeScoped {
            node_id_param: (*node_id_param).to_owned(),
        },
    }
}

const fn port(handle: String, domain: NodePortDomain) -> NodePortDescriptor {
    NodePortDescriptor {
        handle,
        label: String::new(),
        domain,
        connect_domains: Vec::new(),
        dynamic: false,
        max_connections: None,
    }
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
