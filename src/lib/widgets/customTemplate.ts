//! Custom 控件编辑器的默认模板代码 — UI 编辑器内容, 非业务默认值
//! (业务默认仍由后端模型目录产出; 此常量只是「新建 Custom」的编辑器起点)。

export const DEFAULT_CUSTOM_CODE = `({
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
`;
