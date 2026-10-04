import { Send, AlertTriangle } from 'lucide-react';
import type { WidgetConfig, CommandFrame } from '../../../types';
import type { Lang } from '../../../i18n';
import { translate } from '../../../i18n';
import { bytesToHex, bytesToAscii } from '../../../lib/utils/commandParser';

interface Props {
  params: Extract<WidgetConfig, { kind: 'Command' }>['params'];
  /// 当前选中帧 — 追加换行/发送模式/定时间隔为帧级设置
  frame: CommandFrame;
  computed: {
    bytes: Uint8Array | null;
    error: string | null;
    perBlock: Uint8Array[][];
  };
  error: string | null;
  lastSent: string | null;
  /// 无字节边路由 (loopbackOut 未连接) — 禁用发送并提示
  routeMissing: boolean;
  /// 工作区未运行 — 手动发送要求运行态, 禁用发送并提示
  notRunning: boolean;
  onSend: () => void;
  onUpdateParams: (changes: Partial<Props['params']>) => void;
  onUpdateFrame: (changes: Partial<CommandFrame>) => void;
  lang: Lang;
}

export function CommandSenderSidebar({
  params,
  frame,
  computed,
  error,
  lastSent,
  routeMissing,
  notRunning,
  onSend,
  onUpdateParams,
  onUpdateFrame,
  lang,
}: Props) {
  const sendMode = frame.sendMode ?? 'manual';
  const timerMs = frame.timerMs ?? 100;
  const sendDisabled =
    routeMissing || notRunning || !computed.bytes || computed.bytes.length === 0 || !!computed.error;

  return (
    <div className="w-[300px] shrink-0 border-l border-border bg-bg-sidebar overflow-y-auto flex flex-col gap-2 p-3">
      {/* 预览 */}
      <div className="section-heading section-heading--micro">{translate('cmdPreview', lang)}</div>
      <div className="bg-bg-editor border border-border rounded px-2 py-1.5 flex flex-col gap-1">
        <div className="flex items-center justify-between text-[10px] text-text-secondary uppercase tracking-wide">
          <span>HEX</span>
          {computed.bytes && (
            <span className="font-mono text-blue">{computed.bytes.length}B</span>
          )}
        </div>
        {computed.error ? (
          <div className="flex items-center gap-1 bg-red/10 border border-red/30 text-red px-1.5 py-1 rounded-sm text-xs">
            <AlertTriangle size={11} />
            <span>{computed.error}</span>
          </div>
        ) : computed.bytes && computed.bytes.length > 0 ? (
          <>
            <div className="font-mono text-sm text-green break-all leading-relaxed">
              {bytesToHex(computed.bytes)}
            </div>
            <div className="font-mono text-xs text-text-secondary break-all leading-relaxed opacity-secondary">
              {bytesToAscii(computed.bytes)}
            </div>
          </>
        ) : (
          <div className="text-xs text-text-secondary opacity-muted italic py-1">{translate('cmdPreviewEmpty', lang)}</div>
        )}
      </div>

      {/* 发送 */}
      <button
        className="justify-center px-4 py-1.5 bg-bg-button text-text-inverse border-none rounded cursor-pointer text-sm transition-colors hover:bg-bg-button-hover font-semibold inline-flex items-center gap-1.5 disabled:opacity-disabled disabled:cursor-default"
        onClick={onSend}
        disabled={sendDisabled}
        title={
          notRunning
            ? translate('cmdSendRequiresRun', lang)
            : routeMissing
              ? translate('cmdNoByteRoute', lang)
              : undefined
        }
      >
        <Send size={12} />
        <span>{translate('cmdSend', lang)}</span>
      </button>

      {notRunning ? (
        <div className="flex items-center gap-1 bg-yellow/10 border border-yellow/30 text-yellow px-1.5 py-1 rounded-sm text-xs">
          <AlertTriangle size={11} />
          <span>{translate('cmdSendRequiresRun', lang)}</span>
        </div>
      ) : null}

      {routeMissing && (
        <div className="flex items-center gap-1 bg-yellow/10 border border-yellow/30 text-yellow px-1.5 py-1 rounded-sm text-xs">
          <AlertTriangle size={11} />
          <span>{translate('cmdNoByteRoute', lang)}</span>
        </div>
      )}

      {error && (
        <div className="flex items-center gap-1 bg-red/10 border border-red/30 text-red px-1.5 py-1 rounded-sm text-xs">
          <AlertTriangle size={11} />
          <span>{error}</span>
        </div>
      )}
      {lastSent && (
        <div className="flex items-center gap-1 px-1.5 py-1 bg-bg-editor rounded-sm text-[10px]" title={lastSent}>
          <span className="text-text-secondary shrink-0">{translate('cmdLastSent', lang)}:</span>
          <span className="font-mono text-text-primary whitespace-nowrap overflow-hidden text-ellipsis">{lastSent}</span>
        </div>
      )}

      {/* 全局设置 */}
      <div className="section-heading section-heading--micro pt-1">{translate('cmdSettings', lang)}</div>
      <div className="flex flex-col gap-2 p-2 bg-bg-editor border border-border rounded">
        <div className="field-grid field-grid--default">
          <label className="text-xs text-text-secondary">{translate('cmdLabel', lang)}</label>
          <input
            type="text"
            value={params.label}
            onChange={(e) => onUpdateParams({ label: e.target.value })}
            className="text-xs w-full px-2 py-1 bg-bg-input text-text-primary border border-border rounded focus:outline-none focus:border-accent transition-colors"
          />
        </div>
      </div>

      {/* 帧设置 (当前选中帧) */}
      <div className="section-heading section-heading--micro pt-1">{translate('cmdFrameSettings', lang)}</div>
      <div className="flex flex-col gap-2 p-2 bg-bg-editor border border-border rounded">
        <div className="field-grid field-grid--default">
          <label className="text-xs text-text-secondary">{translate('cmdAppendNewline', lang)}</label>
          <button
            className={`bg-bg-input border border-border text-text-secondary px-2 py-0.5 text-xs rounded-sm cursor-pointer motion-transition hover:text-text-primary ${frame.appendNewline ? 'bg-bg-button text-text-inverse border-bg-button' : ''}`}
            onClick={() => onUpdateFrame({ appendNewline: !frame.appendNewline })}
          >
            {frame.appendNewline ? translate('cmdNewlineOn', lang) : translate('cmdNewlineOff', lang)}
          </button>
        </div>
        <div className="field-grid field-grid--default">
          <label className="text-xs text-text-secondary">{translate('cmdSendMode', lang)}</label>
          <select
            value={sendMode}
            onChange={(e) => onUpdateFrame({ sendMode: e.target.value as 'manual' | 'onChange' | 'timer' })}
            className="text-xs w-full px-2 py-1 bg-bg-input text-text-primary border border-border rounded focus:outline-none focus:border-accent"
          >
            <option value="manual">{translate('cmdSendModeManual', lang)}</option>
            <option value="onChange">{translate('cmdSendModeOnChange', lang)}</option>
            <option value="timer">{translate('cmdSendModeTimer', lang)}</option>
          </select>
        </div>
        {sendMode === 'timer' && (
          <div className="field-grid field-grid--default">
            <label className="text-xs text-text-secondary">{translate('cmdSendModeInterval', lang)}</label>
            <input
              type="number"
              min={10}
              max={10000}
              value={timerMs}
              onChange={(e) => onUpdateFrame({ timerMs: parseInt(e.target.value) || 100 })}
              className="text-xs w-full px-2 py-1 bg-bg-input text-text-primary border border-border rounded focus:outline-none focus:border-accent"
            />
          </div>
        )}
      </div>

      {/* 回环模式设置 */}
      <div className="section-heading section-heading--micro pt-2">{translate('cmdLoopback', lang)}</div>
      <div className="flex flex-col gap-2 p-2 bg-bg-editor border border-border rounded">
        <div className="field-grid field-grid--default">
          <label className="text-xs text-text-secondary">{translate('cmdLoopback', lang)}</label>
          <button
            className={`bg-bg-input border border-border text-text-secondary px-2 py-0.5 text-xs rounded-sm cursor-pointer motion-transition hover:text-text-primary ${params.loopbackEnabled ? 'bg-bg-button text-text-inverse border-bg-button' : ''}`}
            onClick={() => onUpdateParams({ loopbackEnabled: !params.loopbackEnabled })}
          >
            {params.loopbackEnabled ? translate('cmdNewlineOn', lang) : translate('cmdNewlineOff', lang)}
          </button>
        </div>
      </div>
    </div>
  );
}
