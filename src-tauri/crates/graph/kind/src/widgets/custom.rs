//! 自定义 JS 控件 (Custom) — 用户代码在**前端执行环境**解析与渲染。
//!
//! 后端不执行该 JS (也不应执行): 端口合同由 NodeDocument 的 `customPorts`
//! 携带 (前端从用户代码解析后随文档下发), 后端只校验声明的 ID 非空且去重。

use serde_json::{Value, json};

use super::WidgetDefinition;
use super::WidgetPortTable;

/// Custom 控件默认代码 — 与前端 CustomWidgetEditor 常量保持一致。
/// 后端只保存这段文本, 绝不执行。
pub const DEFAULT_CUSTOM_CODE: &str = r#"({
  name: 'MyWidget',
  description: '自定义控件示例',
  inputs: [
    { id: 'value', label: 'Value' }
  ],
  outputs: [],
  settings: [
    { id: 'unit', label: 'Unit', type: 'text', default: 'V' },
    { id: 'color', label: 'Color', type: 'color', default: '#75beff' }
  ],
  onMount: function(ctx) {
    ctx.state.count = 0;
  },
  render: function(ctx) {
    const v = ctx.inputs.value ?? 0;
    const u = ctx.settings.unit || '';
    const c = ctx.settings.color || '#75beff';
    ctx.el.innerHTML =
      '<div style="padding:8px;text-align:center;font-family:sans-serif">' +
        '<div style="font-size:24px;color:' + c + ';font-weight:bold">' +
          Number(v).toFixed(2) +
        '</div>' +
        '<div style="font-size:11px;color:#888">' + u + '</div>' +
      '</div>';
  }
})
"#;

fn custom_ports(_params: &Value) -> WidgetPortTable {
    // Custom 的端口声明是拓扑/文档层面的合同 (customPorts), 不是 params 的
    // 纯函数 — 这里返回空表, 描述层必须改用文档的 customPorts (不可伪造默认口)
    WidgetPortTable::default()
}

pub(super) const CUSTOM_DEF: WidgetDefinition = WidgetDefinition {
    kind: "Custom",
    category: super::WidgetCategory::Custom,
    renderer_key: "Custom",
    fallback_label: "Custom",
    default_params: |node_id| json!({ "id": node_id, "label": "Custom", "code": DEFAULT_CUSTOM_CODE, "settings": {} }),
    normalize: |params| {
        let _ = params;
    },
    ports: custom_ports,
    lower: |_, ports| {
        let ports = ports.ok_or("custom widget port contract required")?;
        Ok(crate::kind::NodeKind::Custom {
            inputs: ports.inputs.clone(),
            outputs: ports.outputs.clone(),
        })
    },
    panel: None,
};

pub(super) static CUSTOM: WidgetDefinition = CUSTOM_DEF;
