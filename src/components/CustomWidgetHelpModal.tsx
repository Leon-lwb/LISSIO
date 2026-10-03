import { X, BookOpen, Code, Lightbulb, Send, Settings, Workflow } from 'lucide-react';
import { useAppStore } from '../store/appStore';
import { translate } from '../i18n';

interface CustomWidgetHelpModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export function CustomWidgetHelpModal({ isOpen, onClose }: CustomWidgetHelpModalProps) {
  const lang = useAppStore((s) => s.lang);

  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 dialog-overlay flex items-center justify-center z-modal motion-overlay-in"
      onClick={(event) => { if (event.target === event.currentTarget) onClose(); }}
      onKeyDown={(event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); onClose(); } }}
      role="button"
      tabIndex={0}
    >
      <div
        className="flex flex-col dialog-surface overflow-hidden motion-surface-in"
        style={{ width: '80vw', height: '85vh', maxWidth: 1000, maxHeight: 800 }}
      >
        <div className="flex items-center gap-2 px-3 py-2 dialog-chrome border-b border-border text-text-primary font-semibold">
          <BookOpen size={16} />
          <span>{translate('helpTitle', lang)}</span>
          <button
            className="w-6 h-6 flex items-center justify-center rounded text-text-secondary hover:bg-bg-hover hover:text-text-primary transition-colors cursor-pointer ml-auto"
            onClick={onClose}
          >
            <X size={14} />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-5 py-4 flex flex-col gap-5">
          {/* 快速入门 */}
          <section className="flex flex-col gap-2">
            <h2 className="flex items-center gap-1.5 text-base font-semibold text-text-primary m-0 pb-1 border-b border-border">
              <Lightbulb size={14} className="text-accent shrink-0" />
              {translate('helpQuickStart', lang)}
            </h2>
            <ol className="m-0 pl-5 text-sm text-text-primary leading-[1.7] list-decimal">
              <li>{translate('helpStep1', lang)}</li>
              <li>{translate('helpStep2', lang)}</li>
              <li>{translate('helpStep3', lang)}</li>
              <li>{translate('helpStep4', lang)}</li>
              <li>{translate('helpStep5', lang)}</li>
            </ol>
          </section>

          {/* 代码结构 */}
          <section className="flex flex-col gap-2">
            <h2 className="flex items-center gap-1.5 text-base font-semibold text-text-primary m-0 pb-1 border-b border-border">
              <Code size={14} className="text-accent shrink-0" />
              {translate('helpCodeStructure', lang)}
            </h2>
            <p className="m-0 text-sm text-text-secondary leading-[1.5]">{translate('helpCodeStructureDesc', lang)}</p>
            <pre className="m-0 px-3 py-2.5 bg-bg-input border border-border rounded font-mono text-xs text-text-primary leading-[1.5] overflow-x-auto whitespace-pre">{`({
  name: 'MyWidget',           // ${translate('helpFieldName', lang)}
  description: '描述信息',     // ${translate('helpFieldDescription', lang)}
  inputs: [                    // ${translate('helpFieldInputs', lang)}
    { id: 'value', label: 'Value' },
    { id: 'setpoint', label: 'Setpoint' }
  ],
  outputs: [                   // ${translate('helpFieldOutputs', lang)}
    { id: 'alarm', label: 'Alarm' }
  ],
  settings: [                  // ${translate('helpFieldSettings', lang)}
    { id: 'threshold', label: '阈值', type: 'number', default: 50 },
    { id: 'color', label: '颜色', type: 'color', default: '#ff0000' },
    { id: 'text', label: '文本', type: 'text', default: 'ALARM' },
    { id: 'enabled', label: '启用', type: 'boolean', default: true }
  ],
  onMount: function(ctx) {     // ${translate('helpFieldOnMount', lang)}
    ctx.state.count = 0;
  },
  render: function(ctx) {      // ${translate('helpFieldRender', lang)}
    const v = ctx.inputs.value ?? 0;
    ctx.el.innerHTML = '<div>' + v + '</div>';
  },
  onUnmount: function(ctx) {}  // ${translate('helpFieldOnUnmount', lang)}
})`}</pre>
          </section>

          {/* ctx API */}
          <section className="flex flex-col gap-2">
            <h2 className="flex items-center gap-1.5 text-base font-semibold text-text-primary m-0 pb-1 border-b border-border">
              <Workflow size={14} className="text-accent shrink-0" />
              {translate('helpCtxApi', lang)}
            </h2>
            <p className="m-0 text-sm text-text-secondary leading-[1.5]">{translate('helpCtxApiDesc', lang)}</p>
            <table className="w-full border-collapse text-xs">
              <thead>
                <tr className="dialog-chrome text-text-secondary font-semibold text-left">
                  <th className="px-2 py-1.5 border-b border-border">{translate('helpApiField', lang)}</th>
                  <th className="px-2 py-1.5 border-b border-border">{translate('helpApiType', lang)}</th>
                  <th className="px-2 py-1.5 border-b border-border">{translate('helpApiDesc', lang)}</th>
                </tr>
              </thead>
              <tbody className="text-text-primary">
                <tr>
                  <td className="px-2 py-1.5 border-b border-border"><code className="bg-bg-input px-1 py-0.5 rounded-sm text-accent font-mono">ctx.el</code></td>
                  <td className="px-2 py-1.5 border-b border-border">HTMLElement</td>
                  <td className="px-2 py-1.5 border-b border-border">{translate('helpApiEl', lang)}</td>
                </tr>
                <tr>
                  <td className="px-2 py-1.5 border-b border-border"><code className="bg-bg-input px-1 py-0.5 rounded-sm text-accent font-mono">ctx.inputs</code></td>
                  <td className="px-2 py-1.5 border-b border-border">{'Record<string, number>'}</td>
                  <td className="px-2 py-1.5 border-b border-border">{translate('helpApiInputs', lang)}</td>
                </tr>
                <tr>
                  <td className="px-2 py-1.5 border-b border-border"><code className="bg-bg-input px-1 py-0.5 rounded-sm text-accent font-mono">ctx.settings</code></td>
                  <td className="px-2 py-1.5 border-b border-border">{'Record<string, any>'}</td>
                  <td className="px-2 py-1.5 border-b border-border">{translate('helpApiSettings', lang)}</td>
                </tr>
                <tr>
                  <td className="px-2 py-1.5 border-b border-border"><code className="bg-bg-input px-1 py-0.5 rounded-sm text-accent font-mono">ctx.state</code></td>
                  <td className="px-2 py-1.5 border-b border-border">{'Record<string, any>'}</td>
                  <td className="px-2 py-1.5 border-b border-border">{translate('helpApiState', lang)}</td>
                </tr>
                <tr>
                  <td className="px-2 py-1.5 border-b border-border"><code className="bg-bg-input px-1 py-0.5 rounded-sm text-accent font-mono">ctx.send(port, value)</code></td>
                  <td className="px-2 py-1.5 border-b border-border">function</td>
                  <td className="px-2 py-1.5 border-b border-border">{translate('helpApiSend', lang)}</td>
                </tr>
                <tr>
                  <td className="px-2 py-1.5 border-b border-border"><code className="bg-bg-input px-1 py-0.5 rounded-sm text-accent font-mono">ctx.log(...args)</code></td>
                  <td className="px-2 py-1.5 border-b border-border">function</td>
                  <td className="px-2 py-1.5 border-b border-border">{translate('helpApiLog', lang)}</td>
                </tr>
              </tbody>
            </table>
          </section>

          {/* 输入输出 */}
          <section className="flex flex-col gap-2">
            <h2 className="flex items-center gap-1.5 text-base font-semibold text-text-primary m-0 pb-1 border-b border-border">
              <Send size={14} className="text-accent shrink-0" />
              {translate('helpInputsOutputs', lang)}
            </h2>
            <p className="m-0 text-sm text-text-secondary leading-[1.5]">{translate('helpIoDesc', lang)}</p>
            <ul className="m-0 pl-5 text-sm text-text-primary leading-[1.7] list-disc">
              <li>{translate('helpIoInputItem', lang)}</li>
              <li>{translate('helpIoOutputItem', lang)}</li>
              <li>{translate('helpIoChannelSource', lang)}</li>
              <li>{translate('helpIoMathChain', lang)}</li>
            </ul>
          </section>

          {/* 设置项类型 */}
          <section className="flex flex-col gap-2">
            <h2 className="flex items-center gap-1.5 text-base font-semibold text-text-primary m-0 pb-1 border-b border-border">
              <Settings size={14} className="text-accent shrink-0" />
              {translate('helpSettingsTypes', lang)}
            </h2>
            <p className="m-0 text-sm text-text-secondary leading-[1.5]">{translate('helpSettingsDesc', lang)}</p>
            <ul className="m-0 pl-5 text-sm text-text-primary leading-[1.7] list-disc">
              <li><code className="bg-bg-input px-1 py-0.5 rounded-sm text-accent font-mono">number</code> — {translate('helpSettingsNumber', lang)}</li>
              <li><code className="bg-bg-input px-1 py-0.5 rounded-sm text-accent font-mono">text</code> — {translate('helpSettingsText', lang)}</li>
              <li><code className="bg-bg-input px-1 py-0.5 rounded-sm text-accent font-mono">color</code> — {translate('helpSettingsColor', lang)}</li>
              <li><code className="bg-bg-input px-1 py-0.5 rounded-sm text-accent font-mono">boolean</code> — {translate('helpSettingsBoolean', lang)}</li>
            </ul>
          </section>

          {/* 示例 */}
          <section className="flex flex-col gap-2">
            <h2 className="flex items-center gap-1.5 text-base font-semibold text-text-primary m-0 pb-1 border-b border-border">
              <Code size={14} className="text-accent shrink-0" />
              {translate('helpExamples', lang)}
            </h2>
            <p className="m-0 text-sm text-text-secondary leading-[1.5]">{translate('helpExamplesDesc', lang)}</p>
            <pre className="m-0 px-3 py-2.5 bg-bg-input border border-border rounded font-mono text-xs text-text-primary leading-[1.5] overflow-x-auto whitespace-pre">{`// ${translate('helpExample1Title', lang)}
({
  name: 'ThresholdAlarm',
  inputs: [
    { id: 'value', label: 'Value' },
    { id: 'setpoint', label: 'Setpoint' }
  ],
  outputs: [{ id: 'alarm', label: 'Alarm' }],
  settings: [
    { id: 'threshold', label: 'Threshold', type: 'number', default: 50 },
    { id: 'color', label: 'Color', type: 'color', default: '#ff5555' }
  ],
  onMount: function(ctx) {
    ctx.el.innerHTML = '<div style="padding:8px;text-align:center;font-family:sans-serif"></div>';
    var alarmDiv = ctx.el.querySelector('div');
    alarmDiv.addEventListener('click', function() {
      ctx.send('alarm', 1);
      ctx.log('Alarm sent');
    });
  },
  render: function(ctx) {
    var v = ctx.inputs.value ?? 0;
    var sp = ctx.inputs.setpoint ?? 0;
    var threshold = Number(ctx.settings.threshold) || 50;
    var color = ctx.settings.color || '#ff5555';
    var alarm = Math.abs(v - sp) > threshold;
    var div = ctx.el.querySelector('div');
    if (div) {
      div.style.background = alarm ? color : '#333';
      div.style.color = 'white';
      div.style.padding = '8px';
      div.style.borderRadius = '4px';
      div.textContent = alarm ? '⚠ ALARM' : 'OK';
    }
  }
})

// ${translate('helpExample2Title', lang)}
({
  name: 'Oscilloscope',
  inputs: [{ id: 'value', label: 'Value' }],
  outputs: [],
  settings: [
    { id: 'maxPoints', label: 'Max Points', type: 'number', default: 100 },
    { id: 'color', label: 'Color', type: 'color', default: '#75beff' }
  ],
  onMount: function(ctx) {
    ctx.state.data = [];
    var canvas = document.createElement('canvas');
    canvas.style.width = '100%';
    canvas.style.height = '80px';
    ctx.el.appendChild(canvas);
    ctx.state.canvas = canvas;
  },
  render: function(ctx) {
    var v = ctx.inputs.value ?? 0;
    var max = Number(ctx.settings.maxPoints) || 100;
    ctx.state.data.push(v);
    if (ctx.state.data.length > max) ctx.state.data.shift();
    var canvas = ctx.state.canvas;
    if (!canvas) return;
    var ctx2d = canvas.getContext('2d');
    var w = canvas.width = canvas.offsetWidth;
    var h = canvas.height = canvas.offsetHeight;
    ctx2d.clearRect(0, 0, w, h);
    ctx2d.strokeStyle = ctx.settings.color || '#75beff';
    ctx2d.lineWidth = 1.5;
    ctx2d.beginPath();
    var data = ctx.state.data;
    var min = Math.min.apply(null, data);
    var max2 = Math.max.apply(null, data);
    var range = (max2 - min) || 1;
    for (var i = 0; i < data.length; i++) {
      var x = (i / (max - 1)) * w;
      var y = h - ((data[i] - min) / range) * h;
      if (i === 0) ctx2d.moveTo(x, y);
      else ctx2d.lineTo(x, y);
    }
    ctx2d.stroke();
  }
})`}</pre>
          </section>

          {/* 安全说明 */}
          <section className="flex flex-col gap-2">
            <h2 className="flex items-center gap-1.5 text-base font-semibold text-text-primary m-0 pb-1 border-b border-border">
              <Lightbulb size={14} className="text-accent shrink-0" />
              {translate('helpSecurity', lang)}
            </h2>
            <p className="m-0 text-sm text-text-secondary leading-[1.5]">{translate('helpSecurityDesc', lang)}</p>
            <ul className="m-0 pl-5 text-sm text-text-primary leading-[1.7] list-disc">
              <li>{translate('helpSecuritySandbox', lang)}</li>
              <li>{translate('helpSecurityNoDom', lang)}</li>
              <li>{translate('helpSecurityPostMessage', lang)}</li>
              <li>{translate('helpSecurityError', lang)}</li>
            </ul>
          </section>
        </div>

        <div className="px-3 py-2 flex justify-end dialog-chrome border-t border-border">
          <button className="px-3 py-1.5 bg-bg-button text-text-inverse border-none rounded cursor-pointer text-sm text-center transition-colors hover:bg-bg-button-hover" onClick={onClose}>
            {translate('helpClose', lang)}
          </button>
        </div>
      </div>
    </div>
  );
}
