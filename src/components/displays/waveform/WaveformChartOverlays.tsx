import type { RefObject } from 'react';
import { Check, Copy, Download, X } from 'lucide-react';
import { useAppStore } from '../../../store/appStore';
import { translate } from '../../../i18n';
import { formatTimeMs } from './wavechartFormatters';
import { WaveformCursorReadout } from './WaveformCursorReadout';

export interface WaveformCursorReadoutValue {
  leftPx: number;
  topPx: number;
  xSec: number;
  yDiv: number;
  yVal: number;
  yUnit: string;
  channels: { label: string; val: number; color: string; isDerived: boolean }[];
}

interface WaveformChartOverlaysProps {
  cursorHidden: boolean;
  isMac: boolean;
  derate: { tier: number; overflow: number } | null;
  selectedRange: { startSec: number; endSec: number } | null;
  copyFeedback: boolean;
  onCopySelection: () => Promise<void>;
  onExportSelection: () => void;
  onClearSelection: () => void;
  dynamicSeriesVisible: boolean;
  dynamicSeries: boolean;
  onToggleDynamicSeries: () => void;
  cursorReadout: WaveformCursorReadoutValue | null;
  cursorReadoutVisible: boolean;
  tooltipPos: { left: number; top: number } | null;
  tooltipRef: RefObject<HTMLDivElement | null>;
  snapshotError: string | null;
  running: boolean;
  isConnected: boolean;
}

export function WaveformChartOverlays({
  cursorHidden,
  isMac,
  derate,
  selectedRange,
  copyFeedback,
  onCopySelection,
  onExportSelection,
  onClearSelection,
  dynamicSeriesVisible,
  dynamicSeries,
  onToggleDynamicSeries,
  cursorReadout,
  cursorReadoutVisible,
  tooltipPos,
  tooltipRef,
  snapshotError,
  running,
  isConnected,
}: WaveformChartOverlaysProps) {
  const lang = useAppStore((s) => s.lang);
  return (
    <>
              {/* 左上角提示: 按住 Ctrl/Cmd 隐藏光标 */}
              <div className="absolute top-1.5 right-2 z-[100] px-2 py-0.5 text-[10px] text-text-primary bg-bg-editor/95 border border-border/30 rounded pointer-events-none select-none shadow whitespace-nowrap">
                {cursorHidden
                  ? translate('cursorHiddenHint', lang)
                  : (isMac ? '⌘ ' : 'Ctrl ') + translate('cursorHideHint', lang)}
              </div>

              {/* 降载提示: 原始层装不下视图窗口, 由金字塔层提供真实包络 (不变量 2) */}
              {derate && (
                <div className="absolute top-7 right-2 z-[100] px-2 py-0.5 text-[10px] text-text-warning bg-bg-editor/95 border border-warning/40 rounded pointer-events-none select-none shadow whitespace-nowrap">
                  {translate('waveformDerated', lang)} · tier {derate.tier} · Δ
                  {derate.overflow}
                </div>
              )}

              {/* 框选导出/复制工具栏 */}
              {selectedRange && (
                <div className="absolute top-9 right-2 z-[100] flex items-center gap-1 px-1.5 py-1 bg-bg-editor/95 border border-border/30 rounded shadow-lg select-none">
                  <span className="text-[10px] text-text-secondary font-mono px-1">
                    {formatTimeMs(selectedRange.startSec * 1000)} - {formatTimeMs(selectedRange.endSec * 1000)}
                  </span>
                  <button
                    className="p-1 text-text-secondary hover:text-text-primary hover:bg-bg-hover rounded transition-colors"
                    title={translate('copySelection', lang)}
                    onClick={() => { void onCopySelection(); }}
                  >
                    {copyFeedback ? <Check size={12} className="text-green" /> : <Copy size={12} />}
                  </button>
                  <button
                    className="p-1 text-text-secondary hover:text-text-primary hover:bg-bg-hover rounded transition-colors"
                    title={translate('exportSelection', lang)}
                    onClick={onExportSelection}
                  >
                    <Download size={12} />
                  </button>
                  <button
                    className="p-1 text-text-secondary hover:text-text-primary hover:bg-bg-hover rounded transition-colors"
                    title={translate('clearSelection', lang)}
                    onClick={onClearSelection}
                  >
                    <X size={12} />
                  </button>
                </div>
              )}

              {/* 右下角动态 series 开关 (仅用户创建的波形图, default-waveform 不显示) */}
              {dynamicSeriesVisible && (
                <button
                  className={`absolute bottom-1.5 right-2 z-[100] px-2.5 py-0.5 text-[10px] text-text-primary bg-bg-editor/95 border border-border/30 rounded cursor-pointer select-none shadow whitespace-nowrap motion-transition hover:bg-bg-hover hover:border-border/50 ${dynamicSeries ? 'text-orange border-orange/50 bg-orange/10' : ''}`}
                  onClick={onToggleDynamicSeries}
                  title={translate('dynamicSeriesToggle', lang)}
                >
                  {dynamicSeries
                    ? translate('dynamicSeriesOn', lang)
                    : translate('dynamicSeriesOff', lang)}
                </button>
              )}

              <WaveformCursorReadout
                readout={cursorReadout}
                hidden={!cursorReadoutVisible || cursorHidden}
                tooltipPos={tooltipPos}
                tooltipRef={tooltipRef}
              />
              {snapshotError && !running && (
                <div className="absolute bottom-2 left-2 z-[100] max-w-[70%] rounded border border-orange/50 bg-bg-editor/95 px-2 py-1 text-[10px] text-orange shadow">
                  {translate('waveformSnapshotUnavailable', lang)}: {snapshotError}
                </div>
              )}

      {!isConnected && (
        <div className="absolute inset-0 flex items-center justify-center text-text-secondary text-sm pointer-events-none">
          <span>{translate('emptyWaveform', lang)}</span>
        </div>
      )}
    </>
  );
}
