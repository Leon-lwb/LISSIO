//! 面板目录 — 显示控件面向窗口/停靠区的另一面, 与 `models` 并列。
//!
//! 投影来源是**实际注册的控件定义** (`kind::widgets` 的 `panel` 字段), 加上两个
//! 无宿主控件的整库面板 (CAN 总线 / 逻辑分析仪 — 独立 tab, 不对应画布节点)。
//! 面板不是独立的模型家族, 因此不与 `models` 混装。

use data_model::model_descriptor::{
    ModelDisplay, ModelUiHints, NodePortDescriptor, NodePortDomain,
};
use data_model::panel_descriptor::{
    PanelBinding, PanelDataPlane, PanelDelivery, PanelDescriptor, PanelKind, panel_ops,
};
use serde_json::Value;

use super::open_schema;

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
pub(super) fn panel_descriptors() -> Result<Vec<PanelDescriptor>, String> {
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
