//! 面板规格 — 数据驱动控件在注册表内声明的「可独立开窗的数据面板」语义。
//!
//! 这里是面板语义的**单一权威**：控件的 kind / 类别 / 端口 / lowering 与「它是否
//! 是可独立开窗的数据面板、以哪个 tab 打开、数据面走哪种投递、如何绑定图节点」
//! 声明在同一处。`app::models::catalog` 从这里投影 `PanelDescriptor` 下发前端，
//! 前端不再各自维护 kind → tab 类型 / 数据面 / 绑定的平行表。
//!
//! `None` 表示该控件不是数据面板（Knob、Math、Str、Gauge、LED 等就地展示控件），
//! 以及 `compile-errors` / `operation-history` / `node-properties` 这类纯应用外壳。

use data_model::panel_descriptor::{PanelDelivery, PanelKind, panel_ops};

/// 面板的输入绑定语义 — 参数无关的形式，具体端口在投影时由端口表派生。
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum PanelBindingSpec {
    /// 跟随控件输入端口的首条上游边（端口表在投影时按 params 解析）。
    EdgeBound,
    /// 由配置字段持有端口引用（RawData 的 `selectedInput`）。
    ConfigBound {
        /// 存放端口引用的参数名。
        config_key: &'static str,
        /// 端口引用模板，含 `{source}` / `{handle}` 占位符。
        port_template: &'static str,
    },
    /// 整库面板，不寻址单个节点（CAN 总线 / 逻辑分析仪）。
    Singleton,
    /// 通过面板自身参数寻址节点（CAN 负载统计）。
    NodeScoped {
        /// 存放目标节点 id 的参数名。
        node_id_param: &'static str,
    },
}

/// 一个数据驱动面板的完整语义。
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct PanelSpec {
    /// 稳定面板身份（目录 id 为 `panel:<kind wire>`）。
    pub panel: PanelKind,
    /// 前端数据面板 tab 类型（取代前端 `widgetTab.ts` 的硬编码映射）。
    pub tab_type: &'static str,
    /// 面板 tab 标题的 i18n 键（en/zh 同名），由前端解析。
    pub label_key: &'static str,
    /// 该面板数据面支持的投递模式。
    pub delivery: PanelDelivery,
    /// 推送投递使用的显示请求 kind —— `data_model::panel_descriptor::panel_ops`
    /// 的 push 名，也是 `DisplayRequest` 的 wire tag。
    pub push_request: Option<&'static str>,
    /// 拉取投递使用的能力名 —— `panel_ops` 的 fetch 名。
    pub fetch_op: Option<&'static str>,
    /// 输入绑定语义。
    pub binding: PanelBindingSpec,
    /// 订阅建议间隔（毫秒）。
    pub default_interval_ms: Option<u32>,
    /// 订阅建议批上限。
    pub default_max_items: Option<u32>,
}

/// 纯应用外壳的 tab 类型 — 它们不是数据面板，注册表不得声明为面板。
pub const SHELL_TAB_TYPES: &[&str] = &[
    "compile-errors",
    "compile-results",
    "operation-history",
    "node-properties",
    "recording-database",
];

/// 校验一条面板规格的自洽性（`ensure_valid` 逐条调用）。
pub fn validate(spec: &PanelSpec, widget_kind: &str) -> Result<(), String> {
    if spec.tab_type.trim().is_empty() {
        return Err(format!("{widget_kind}: panel tab_type must not be empty"));
    }
    if SHELL_TAB_TYPES.contains(&spec.tab_type) {
        return Err(format!(
            "{widget_kind}: panel tab_type {} is an application shell, not a data panel",
            spec.tab_type
        ));
    }
    if spec.label_key.trim().is_empty() {
        return Err(format!("{widget_kind}: panel label_key must not be empty"));
    }
    if spec.delivery.supports_push() && spec.push_request.is_none() {
        return Err(format!(
            "{widget_kind}: panel declares push delivery without a push_request"
        ));
    }
    if spec.delivery.supports_fetch() && spec.fetch_op.is_none() {
        return Err(format!(
            "{widget_kind}: panel declares fetch delivery without a fetch_op"
        ));
    }
    // 尚未实现数据面的面板必须两个操作都不声明 — 不得预支未来的能力名
    if !spec.delivery.is_available() && (spec.push_request.is_some() || spec.fetch_op.is_some()) {
        return Err(format!(
            "{widget_kind}: panel has no data plane yet but declares a delivery operation"
        ));
    }
    if let Some(push) = spec.push_request
        && !panel_ops::ALL_PUSH.contains(&push)
    {
        return Err(format!(
            "{widget_kind}: panel push_request {push} is not a known display request"
        ));
    }
    if let Some(fetch) = spec.fetch_op
        && !panel_ops::ALL_FETCH.contains(&fetch)
    {
        return Err(format!(
            "{widget_kind}: panel fetch_op {fetch} is not a known panel operation"
        ));
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn spec() -> PanelSpec {
        PanelSpec {
            panel: PanelKind::Waveform,
            tab_type: "waveform-extra",
            label_key: "dataTabWaveform",
            delivery: PanelDelivery::Both,
            push_request: Some(panel_ops::PUSH_WAVEFORM),
            fetch_op: Some(panel_ops::FETCH_WAVEFORM_WINDOW),
            binding: PanelBindingSpec::EdgeBound,
            default_interval_ms: Some(33),
            default_max_items: Some(1000),
        }
    }

    #[test]
    fn valid_spec_passes() {
        assert_eq!(validate(&spec(), "Waveform"), Ok(()));
    }

    #[test]
    fn shell_tab_type_is_rejected() {
        let mut spec = spec();
        spec.tab_type = "compile-errors";
        assert!(
            validate(&spec, "Waveform")
                .unwrap_err()
                .contains("application shell")
        );
    }

    #[test]
    fn push_without_request_is_rejected() {
        let mut spec = spec();
        spec.push_request = None;
        assert!(
            validate(&spec, "Waveform")
                .unwrap_err()
                .contains("push_request")
        );
    }

    #[test]
    fn fetch_without_operation_is_rejected() {
        let mut spec = spec();
        spec.fetch_op = None;
        assert!(
            validate(&spec, "Waveform")
                .unwrap_err()
                .contains("fetch_op")
        );
    }

    #[test]
    fn push_only_panel_needs_no_fetch_operation() {
        let mut spec = spec();
        spec.delivery = PanelDelivery::Push;
        spec.fetch_op = None;
        assert_eq!(validate(&spec, "Waveform"), Ok(()));
    }

    #[test]
    fn empty_label_key_is_rejected() {
        let mut spec = spec();
        spec.label_key = "";
        assert!(
            validate(&spec, "Waveform")
                .unwrap_err()
                .contains("label_key")
        );
    }

    #[test]
    fn unknown_push_request_is_rejected() {
        let mut spec = spec();
        spec.push_request = Some("waveform_raster");
        assert!(
            validate(&spec, "Waveform")
                .unwrap_err()
                .contains("not a known display request")
        );
    }

    #[test]
    fn unknown_fetch_operation_is_rejected() {
        let mut spec = spec();
        spec.fetch_op = Some("waveform_window");
        assert!(
            validate(&spec, "Waveform")
                .unwrap_err()
                .contains("not a known panel operation")
        );
    }

    #[test]
    fn unavailable_data_plane_must_declare_no_operations() {
        let mut spec = spec();
        spec.delivery = PanelDelivery::Unavailable;
        spec.push_request = None;
        spec.fetch_op = None;
        assert_eq!(validate(&spec, "Image"), Ok(()));

        // 预支未来能力名 = 契约说谎, 必须拒绝
        spec.fetch_op = Some(panel_ops::FETCH_GRAPH_OUTPUTS);
        assert!(
            validate(&spec, "Image")
                .unwrap_err()
                .contains("no data plane yet")
        );
        spec.fetch_op = None;
        spec.push_request = Some(panel_ops::PUSH_RAW_DATA);
        assert!(
            validate(&spec, "Image")
                .unwrap_err()
                .contains("no data plane yet")
        );
    }
}
