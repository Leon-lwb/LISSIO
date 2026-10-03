import { Palette, PanelRight, AlignLeft, Terminal } from 'lucide-react';
import { translate, type Lang } from '../../../i18n';
import type { HexColorMode, SendPanelMode } from './rawDataViewHelpers';

interface Props {
  hexColorMode: HexColorMode;
  sendPanelMode: SendPanelMode;
  showTimestamp: boolean;
  showOffset: boolean;
  /// 终端模式选项 (仅终端分组下显示)
  localEcho: boolean;
  ansiDecode: boolean;
  showTerminalOptions: boolean;
  onHexColorModeChange: (v: HexColorMode) => void;
  onSendPanelModeChange: (v: SendPanelMode) => void;
  onShowTimestampChange: (v: boolean) => void;
  onShowOffsetChange: (v: boolean) => void;
  onLocalEchoChange: (v: boolean) => void;
  onAnsiDecodeChange: (v: boolean) => void;
  lang: Lang;
}

export function RawDataViewSettings({
  hexColorMode,
  sendPanelMode,
  showTimestamp,
  showOffset,
  localEcho,
  ansiDecode,
  showTerminalOptions,
  onHexColorModeChange,
  onSendPanelModeChange,
  onShowTimestampChange,
  onShowOffsetChange,
  onLocalEchoChange,
  onAnsiDecodeChange,
  lang,
}: Props) {
  const hexColorOptions: { mode: HexColorMode; label: string }[] = [
    { mode: 'none', label: translate('hexColorNone', lang) },
    { mode: 'printable', label: translate('hexColorPrintable', lang) },
    { mode: 'range', label: translate('hexColorRange', lang) },
  ];

  const sendPanelOptions: { mode: SendPanelMode; label: string }[] = [
    { mode: 'bottom', label: translate('sendPanelBottom', lang) },
    { mode: 'separate', label: translate('sendPanelSeparate', lang) },
  ];

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h4 className="text-xs font-semibold text-text-secondary mb-2 flex items-center gap-1">
          <Palette size={12} /> {translate('hexColorMode', lang)}
        </h4>
        <div className="flex flex-col gap-1">
          {hexColorOptions.map((opt) => (
            <button
              key={opt.mode}
              className={`text-left px-2 py-1 rounded text-xs transition-colors ${hexColorMode === opt.mode ? 'bg-bg-active text-text-bright' : 'text-text-secondary hover:bg-bg-hover hover:text-text-primary'}`}
              onClick={() => onHexColorModeChange(opt.mode)}
            >
              {opt.label}
            </button>
          ))}
        </div>
      </div>
      <div>
        <h4 className="text-xs font-semibold text-text-secondary mb-2 flex items-center gap-1">
          <PanelRight size={12} /> {translate('sendPanelMode', lang)}
        </h4>
        <div className="flex flex-col gap-1">
          {sendPanelOptions.map((opt) => (
            <button
              key={opt.mode}
              className={`text-left px-2 py-1 rounded text-xs transition-colors ${sendPanelMode === opt.mode ? 'bg-bg-active text-text-bright' : 'text-text-secondary hover:bg-bg-hover hover:text-text-primary'}`}
              onClick={() => onSendPanelModeChange(opt.mode)}
            >
              {opt.label}
            </button>
          ))}
        </div>
      </div>
      <div>
        <h4 className="text-xs font-semibold text-text-secondary mb-2 flex items-center gap-1">
          <AlignLeft size={12} /> {translate('displayOptions', lang)}
        </h4>
        <label className="flex items-center gap-2 text-xs text-text-secondary hover:text-text-primary cursor-pointer mb-1.5">
          <input
            type="checkbox"
            checked={showTimestamp}
            onChange={(e) => onShowTimestampChange(e.target.checked)}
            className="accent-accent"
          />
          {translate('showTimestamp', lang)}
        </label>
        <label className="flex items-center gap-2 text-xs text-text-secondary hover:text-text-primary cursor-pointer">
          <input
            type="checkbox"
            checked={showOffset}
            onChange={(e) => onShowOffsetChange(e.target.checked)}
            className="accent-accent"
          />
          {translate('showOffset', lang)}
        </label>
      </div>
      {showTerminalOptions && (
        <div>
          <h4 className="text-xs font-semibold text-text-secondary mb-2 flex items-center gap-1">
            <Terminal size={12} /> {translate('terminalOptions', lang)}
          </h4>
          <label className="flex items-center gap-2 text-xs text-text-secondary hover:text-text-primary cursor-pointer mb-1.5">
            <input
              type="checkbox"
              checked={ansiDecode}
              onChange={(e) => onAnsiDecodeChange(e.target.checked)}
              className="accent-accent"
            />
            {translate('ansiDecode', lang)}
          </label>
          <label className="flex items-center gap-2 text-xs text-text-secondary hover:text-text-primary cursor-pointer">
            <input
              type="checkbox"
              checked={localEcho}
              onChange={(e) => onLocalEchoChange(e.target.checked)}
              className="accent-accent"
            />
            {translate('localEcho', lang)}
          </label>
        </div>
      )}
    </div>
  );
}
