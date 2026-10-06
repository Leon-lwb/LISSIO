import { useState, useMemo, useEffect } from 'react';
import { X, Play, Save, FileCode, AlertCircle, AlertTriangle, RotateCcw, HelpCircle } from 'lucide-react';
import { CodeEditor } from './CodeEditor';
import { CustomWidget } from './widgets/custom/CustomWidget';
import { evalCustomWidgetDef } from '../lib/models/customWidgetDef';
import { CustomWidgetHelpModal } from './CustomWidgetHelpModal';
import type { WidgetConfig } from '../types';
import { useAppStore } from '../store/appStore';
import { translate } from '../i18n';
import { DialogOverlay, DialogSurface } from './ui/Dialog';

interface CustomWidgetEditorProps {
  widget: Extract<WidgetConfig, { kind: 'Custom' }>;
  isOpen: boolean;
  onClose: () => void;
  onSave: (next: Extract<WidgetConfig, { kind: 'Custom' }>) => void;
}

/// 默认模板 — 新建 Custom widget 时使用
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

const PRESET_TEMPLATES: { name: string; description: string; code: string }[] = [
  {
    name: '基础数值',
    description: '显示一个数值与单位',
    code: DEFAULT_CUSTOM_CODE,
  },
  {
    name: '进度条',
    description: '水平进度条',
    code: `({
  name: 'ProgressBar',
  inputs: [{ id: 'value', label: 'Value' }],
  outputs: [],
  settings: [
    { id: 'min', label: 'Min', type: 'number', default: 0 },
    { id: 'max', label: 'Max', type: 'number', default: 100 },
    { id: 'color', label: 'Color', type: 'color', default: '#89d185' }
  ],
  render: function(ctx) {
    var v = ctx.inputs.value ?? 0;
    var min = Number(ctx.settings.min) || 0;
    var max = Number(ctx.settings.max) || 100;
    var color = ctx.settings.color || '#89d185';
    var ratio = Math.max(0, Math.min(1, (v - min) / (max - min || 1)));
    ctx.el.innerHTML =
      '<div style="padding:6px;font-family:sans-serif">' +
        '<div style="font-size:11px;color:#888;margin-bottom:4px">' + Number(v).toFixed(2) + '</div>' +
        '<div style="width:100%;height:8px;background:#3c3c3c;border-radius:4px;overflow:hidden">' +
          '<div style="width:' + (ratio * 100) + '%;height:100%;background:' + color + '"></div>' +
        '</div>' +
      '</div>';
  }
})
`,
  },
  {
    name: '按钮',
    description: '点击发送值',
    code: `({
  name: 'Button',
  inputs: [],
  outputs: [{ id: 'click', label: 'Click' }],
  settings: [
    { id: 'label', label: 'Label', type: 'text', default: 'Send' },
    { id: 'value', label: 'Value', type: 'number', default: 1 }
  ],
  onMount: function(ctx) {
    var label = ctx.settings.label || 'Send';
    var value = Number(ctx.settings.value) || 0;
    ctx.el.innerHTML =
      '<button style="width:100%;padding:8px;background:#0e639c;color:white;border:none;border-radius:4px;cursor:pointer;font-size:12px">' +
        label +
      '</button>';
    var btn = ctx.el.querySelector('button');
    if (btn) {
      btn.addEventListener('click', function() {
        ctx.send('click', value);
        ctx.log('Sent:', value);
      });
    }
  },
  render: function(ctx) {
    // 设置变化时重建按钮
    var btn = ctx.el.querySelector('button');
    if (btn) {
      btn.textContent = ctx.settings.label || 'Send';
    }
  }
})
`,
  },
];

/// 自定义控件编辑器 — CodeMirror 编辑 + 实时预览
export function CustomWidgetEditor({ widget, isOpen, onClose, onSave }: CustomWidgetEditorProps) {
  const lang = useAppStore((s) => s.lang);
  const [code, setCode] = useState(widget.params.code);
  const [label, setLabel] = useState(widget.params.label);
  const [settings, setSettings] = useState(widget.params.settings);
  const [previewKey, setPreviewKey] = useState(0);
  const [isHelpOpen, setIsHelpOpen] = useState(false);

  // 同步外部 widget 变化
  useEffect(() => {
    if (isOpen) {
      setCode(widget.params.code);
      setLabel(widget.params.label);
      setSettings(widget.params.settings);
    }
  }, [widget, isOpen]);

  // 实时校验代码
  const validation = useMemo(() => evalCustomWidgetDef(code), [code]);

  // 预览用的 widget 对象 (基于当前编辑内容)
  const previewWidget: Extract<WidgetConfig, { kind: 'Custom' }> = {
    kind: 'Custom',
    params: {
      id: '__preview__',
      label,
      code,
      settings,
    },
  };

  const handleSave = () => {
    const next: Extract<WidgetConfig, { kind: 'Custom' }> = {
      kind: 'Custom',
      params: {
        id: widget.params.id,
        label: label.trim() || 'Custom',
        code,
        settings,
      },
    };
    onSave(next);
    onClose();
  };

  const handleApplyTemplate = (tmplCode: string) => {
    setCode(tmplCode);
    setPreviewKey((k) => k + 1);
  };

  const handleRebuildPreview = () => {
    setPreviewKey((k) => k + 1);
  };

  return (
    <DialogOverlay open={isOpen} onDismiss={onClose}>
      <DialogSurface
        className="flex flex-col w-[90vw] h-[85vh] max-w-[1200px] max-h-[800px]"
        label={translate('customWidgetEditor', lang)}
      >
        <div className="flex items-center gap-3 px-4 py-3 dialog-chrome border-b border-border text-text-bright font-semibold flex-shrink-0">
          <FileCode size={16} />
          <span>{translate('customWidgetEditor', lang)}</span>
          <button
            className="w-6 h-6 flex items-center justify-center rounded text-text-secondary hover:bg-bg-hover hover:text-text-primary transition-colors cursor-pointer ml-auto"
            onClick={() => setIsHelpOpen(true)}
            title={translate('helpTitle', lang)}
          >
            <HelpCircle size={14} />
          </button>
          <button className="w-6 h-6 flex items-center justify-center rounded text-text-secondary hover:bg-bg-hover hover:text-text-primary transition-colors cursor-pointer" onClick={onClose} title={translate('customCancel', lang)}>
            <X size={14} />
          </button>
        </div>

        {/* 性能警告横幅 — 提示用户 Custom JS 性能低于原生 Rust 节点 */}
        <div
          className="flex items-start gap-2 px-3 py-1.5 bg-yellow/10 border-b border-yellow/30 text-yellow text-xs leading-relaxed"
        >
          <AlertTriangle size={14} className="flex-shrink-0 mt-0.25" />
          <div>
            <strong>{translate('customPerfWarningTitle', lang)}</strong>
            <span className="ml-1.5">
              {translate('customPerfWarning', lang)}
            </span>
          </div>
        </div>

        <div className="flex-1 flex min-h-0">
          {/* 左侧: 代码编辑器 */}
          <div className="flex-1 flex flex-col min-w-0 border-r border-border">
            <div className="flex items-center justify-between px-2.5 py-1.5 dialog-chrome border-b border-border gap-1.5">
              <span className="text-text-secondary text-xs">
                {translate('customWidgetCode', lang)}
              </span>
              <div className="flex gap-1 items-center">
                <select
                  value=""
                  onChange={(e) => {
                    if (e.target.value) {
                      const tmpl = PRESET_TEMPLATES.find((t) => t.name === e.target.value);
                      if (tmpl) handleApplyTemplate(tmpl.code);
                      e.target.value = '';
                    }
                  }}
                  className="bg-bg-input border border-border text-text-primary text-xs px-1.5 py-0.5 rounded-sm"
                >
                  <option value="">{translate('customTemplate', lang)}</option>
                  {PRESET_TEMPLATES.map((t) => (
                    <option key={t.name} value={t.name}>
                      {t.name} - {t.description}
                    </option>
                  ))}
                </select>
                <button
                  className="w-6 h-6 flex items-center justify-center rounded text-text-secondary hover:bg-bg-hover hover:text-text-primary transition-colors cursor-pointer"
                  onClick={handleRebuildPreview}
                  title={translate('customRebuildPreview', lang)}
                >
                  <RotateCcw size={12} />
                </button>
              </div>
            </div>

            <div className="flex items-center gap-1.5 px-2.5 py-1.5 border-b border-border">
              <label className="text-xs text-text-secondary">
                {translate('label', lang)}
              </label>
              <input
                type="text"
                value={label}
                onChange={(e) => setLabel(e.target.value)}
                placeholder="Custom Widget"
                className="flex-1 bg-bg-input border border-border text-text-primary text-sm px-1.5 py-0.5 rounded-sm font-ui"
              />
            </div>

            <div className="flex-1 min-h-0 overflow-hidden relative">
              <CodeEditor value={code} onChange={setCode} height="100%" />
            </div>

            {/* 错误提示 */}
            {validation.error && (
              <div className="flex items-start gap-1.5 px-2.5 py-1.5 bg-red/10 border-t border-red/30 text-red text-xs">
                <AlertCircle size={12} className="flex-shrink-0 mt-0.25" />
                <pre className="m-0 whitespace-pre-wrap text-xs">{validation.error}</pre>
              </div>
            )}

            {/* 解析出的 schema 信息 */}
            {validation.def && (
              <div className="px-2.5 py-1.5 dialog-chrome border-t border-border text-xs text-text-secondary">
                <div className="flex gap-1.5 items-baseline py-0.5">
                  <span className="text-blue min-w-[80px]">{translate('customInputs', lang)}:</span>
                  <span>{validation.def.inputs?.map((i) => i.label).join(', ') ?? '-'}</span>
                </div>
                <div className="flex gap-1.5 items-baseline py-0.5">
                  <span className="text-blue min-w-[80px]">{translate('customOutputs', lang)}:</span>
                  <span>{validation.def.outputs?.map((o) => o.label).join(', ') ?? '-'}</span>
                </div>
                <div className="flex gap-1.5 items-baseline py-0.5">
                  <span className="text-blue min-w-[80px]">{translate('customSettings', lang)}:</span>
                  <span>{validation.def.settings?.map((s) => s.id).join(', ') ?? '-'}</span>
                </div>
              </div>
            )}
          </div>

          {/* 右侧: 预览 */}
          <div className="frost-content w-[320px] flex flex-col flex-shrink-0">
            <div className="flex items-center gap-1.5 px-2.5 py-1.5 dialog-chrome border-b border-border">
              <Play size={12} className="text-green" />
              <span className="text-xs">{translate('customPreview', lang)}</span>
            </div>
            {/* 内层保持透明: 外层容器已经承担磨砂底色, 再叠一层会让预览区明显偏暗 */}
            <div className="flex-1 p-3 overflow-auto">
              {validation.def ? (
                <CustomWidget
                  key={previewKey}
                  widget={previewWidget}
                />
              ) : (
                <div className="flex flex-col items-center gap-2 p-8 text-text-secondary text-sm">
                  <AlertCircle size={24} className="opacity-subtle" />
                  <span>{translate('customPreviewUnavailable', lang)}</span>
                </div>
              )}
            </div>

            {/* 设置项编辑 */}
            {validation.def?.settings && validation.def.settings.length > 0 && (
              <div className="px-3 py-2 border-t border-border dialog-chrome-muted max-h-[40%] overflow-y-auto">
                <div className="text-xs text-text-secondary uppercase tracking-wide mb-1.5">{translate('customSettingsValues', lang)}</div>
                {validation.def.settings.map((s) => (
                  <div key={s.id} className="flex items-center gap-2 py-1">
                    <label className="text-xs text-text-primary min-w-[60px]">{s.label}</label>
                    {s.type === 'boolean' ? (
                      <input
                        type="checkbox"
                        checked={settings[s.id] === true}
                        onChange={(e) =>
                          setSettings({ ...settings, [s.id]: e.target.checked })
                        }
                        className="cursor-pointer"
                      />
                    ) : s.type === 'color' ? (
                      <input
                        type="color"
                        value={String(settings[s.id] ?? s.default)}
                        onChange={(e) =>
                          setSettings({ ...settings, [s.id]: e.target.value })
                        }
                        className="w-7 h-5 p-0 border border-border bg-transparent cursor-pointer rounded-sm"
                      />
                    ) : (
                      <input
                        type={s.type === 'number' ? 'number' : 'text'}
                        value={String(settings[s.id] ?? s.default)}
                        onChange={(e) =>
                          setSettings({
                            ...settings,
                            [s.id]:
                              s.type === 'number'
                                ? parseFloat(e.target.value) || 0
                                : e.target.value,
                          })
                        }
                        className="flex-1 bg-bg-input border border-border text-text-primary text-xs px-1 py-0.5 rounded-sm font-mono min-w-0"
                      />
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        <div className="px-3 py-2 flex justify-end gap-2 dialog-chrome border-t border-border">
          <button className="px-3 py-1.5 bg-transparent text-text-secondary border-none rounded cursor-pointer text-sm text-center transition-colors hover:bg-bg-hover hover:text-text-primary" onClick={onClose}>
            {translate('customCancel', lang)}
          </button>
          <button
            className="px-3 py-1.5 bg-bg-button text-text-inverse border-none rounded cursor-pointer text-sm text-center transition-colors hover:bg-bg-button-hover inline-flex items-center gap-1 disabled:opacity-disabled disabled:cursor-default"
            onClick={handleSave}
            disabled={!validation.def}
          >
            <Save size={12} />
            {translate('customSave', lang)}
          </button>
        </div>
      </DialogSurface>

      {/* 帮助说明弹窗 */}
      <CustomWidgetHelpModal isOpen={isHelpOpen} onClose={() => setIsHelpOpen(false)} />
    </DialogOverlay>
  );
}
