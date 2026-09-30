import {
  Trash2,
  ArrowDown,
  Clock,
  Settings2,
  X,
  Copy,
  Check,
  FileWarning,
} from 'lucide-react';
import { t } from '../../../i18n';
import type { Lang } from '../../../i18n';
import type { RawDataGrouping, RawDataRepr, DirectionFilter } from './rawDataViewHelpers';
import { activateOnKeyboard } from '../../../lib/utils/a11y';
import { directionColorClass } from './rawDataViewHelpers';
import { SearchInput } from '../../ui/SearchInput';

const GROUPING_OPTIONS: { value: RawDataGrouping; label: string }[] = [
  { value: 'grid', label: 'gridView' },
  { value: 'line', label: 'lineView' },
  { value: 'terminal', label: 'terminalView' },
];

const REPR_OPTIONS: { value: RawDataRepr; label: string }[] = [
  { value: 'hex', label: 'hexView' },
  { value: 'ascii', label: 'asciiView' },
  { value: 'utf8', label: 'utf8View' },
];

const DIRECTION_OPTIONS: { value: DirectionFilter; label: string; symbol: string }[] = [
  { value: 'all', label: 'rawDataDirectionAll', symbol: '↕' },
  { value: 'rx', label: 'rawDataDirectionRx', symbol: '↓' },
  { value: 'tx', label: 'rawDataDirectionTx', symbol: '↑' },
];

interface ChannelOption {
  key: string;
  sourceId: string;
  sourceHandle: string | undefined;
  /// 字节平面源 (Transport/Protocol) 的完整标签 (如 "Serial (a1b2)·rx") — 缺省回退 handle/widget 标签
  label?: string;
}

/// 选中源连接状态 (null = 该通道无固定连接语义, 不显示徽章)
export type RawDataConnState = 'Connected' | 'Connecting' | 'Disconnected' | 'Error';

interface Props {
  // state
  grouping: RawDataGrouping;
  repr: RawDataRepr;
  directionFilter: DirectionFilter;
  searchTerm: string;
  channel: string;
  autoScroll: boolean;
  showTimestamp: boolean;
  showSettings: boolean;
  isNum: boolean;
  /// 字符串通道 — 分组/表示/方向为字节平面专用, 禁用; 统计区显示行数
  isStr: boolean;
  stringRowCount?: number;
  isFiltered: boolean;
  totalBytes: number;
  modeCount: number;
  droppedBytes: number;
  channelOptions: ChannelOption[];
  connState: RawDataConnState | null;
  selectionCount: number;
  copyFeedback: boolean;
  /// 已脱离最新数据 (用户上滚) — 响应式标记, 自动滚动按钮据此显示非激活态
  detached: boolean;
  lang: Lang;
  sourceLabel: (id: string) => string;
  // setters
  onGroupingChange: (v: RawDataGrouping) => void;
  onReprChange: (v: RawDataRepr) => void;
  onDirectionFilterChange: (v: DirectionFilter) => void;
  onSearchTermChange: (v: string) => void;
  onChannelChange: (v: string) => void;
  onAutoScrollChange: (v: boolean) => void;
  /// 用户主动回到底部语义 (点自动滚动按钮时清除脱离标记)
  onResetUserScroll: () => void;
  onShowTimestampChange: (v: boolean) => void;
  onShowSettingsChange: (v: boolean) => void;
  onClear: () => void;
  onClearSelection: () => void;
  onCopySelected: () => void;
  onDroppedInfoOpen: () => void;
}

export function RawDataViewHeader({
  grouping,
  repr,
  directionFilter,
  searchTerm,
  channel,
  autoScroll,
  showTimestamp,
  showSettings,
  isNum,
  isStr,
  stringRowCount,
  isFiltered,
  totalBytes,
  modeCount,
  droppedBytes,
  channelOptions,
  connState,
  selectionCount,
  copyFeedback,
  detached,
  lang,
  sourceLabel,
  onGroupingChange,
  onReprChange,
  onDirectionFilterChange,
  onSearchTermChange,
  onChannelChange,
  onAutoScrollChange,
  onResetUserScroll,
  onShowTimestampChange,
  onShowSettingsChange,
  onClear,
  onClearSelection,
  onCopySelected,
  onDroppedInfoOpen,
}: Props) {
  return (
    <>
      <div className="flex gap-1 p-1.5 items-center border-b border-border bg-bg-panel-header shrink-0">
        <div className="flex items-center bg-bg-input rounded p-0.5">
          {GROUPING_OPTIONS.map((opt) => (
            <button
              key={opt.value}
              disabled={isNum || isStr}
              className={`px-2 py-0.5 rounded-sm text-xs font-medium transition-all duration-150 motion-safe:active:scale-95 cursor-pointer disabled:cursor-not-allowed disabled:pointer-events-none disabled:opacity-40 ${grouping === opt.value ? 'bg-bg-button text-text-inverse' : 'text-text-secondary hover:text-text-primary'}`}
              onClick={() => onGroupingChange(opt.value)}
            >
              {t(lang, opt.label)}
            </button>
          ))}
        </div>
        <div className="flex items-center bg-bg-input rounded p-0.5">
          {REPR_OPTIONS.map((opt) => (
            <button
              key={opt.value}
              disabled={isNum || isStr || grouping === 'terminal'}
              title={grouping === 'terminal' ? t(lang, 'terminalReprDisabled') : undefined}
              className={`px-2 py-0.5 rounded-sm text-xs font-medium transition-all duration-150 motion-safe:active:scale-95 cursor-pointer disabled:cursor-not-allowed disabled:pointer-events-none disabled:opacity-40 ${repr === opt.value ? 'bg-bg-button text-text-inverse' : 'text-text-secondary hover:text-text-primary'}`}
              onClick={() => onReprChange(opt.value)}
            >
              {t(lang, opt.label)}
            </button>
          ))}
        </div>

        <div className="flex items-center bg-bg-input rounded p-0.5">
          {DIRECTION_OPTIONS.map((opt) => (
            <button
              key={opt.value}
              disabled={isNum || isStr}
              title={t(lang, opt.label)}
              className={`px-2 py-0.5 rounded-sm text-xs font-medium transition-all duration-150 motion-safe:active:scale-95 cursor-pointer disabled:cursor-not-allowed disabled:pointer-events-none disabled:opacity-40 ${directionFilter === opt.value ? 'bg-bg-button text-text-inverse' : 'text-text-secondary hover:text-text-primary'}`}
              onClick={() => onDirectionFilterChange(opt.value)}
            >
              <span className={`mr-1 ${directionFilter === opt.value ? 'text-text-inverse' : opt.value === 'all' ? 'text-text-secondary' : directionColorClass(opt.value)}`}>
                {opt.symbol}
              </span>
              {t(lang, opt.label)}
            </button>
          ))}
        </div>

        {/* 150ms 防抖: 高速打字只重建一次后端过滤订阅 (acquire/release + 匹配历史重推) */}
        <SearchInput
          size="sm"
          className="w-[140px]"
          debounceMs={150}
          disabled={isNum}
          placeholder={t(lang, 'rawDataSearchPlaceholder')}
          value={searchTerm}
          onChange={onSearchTermChange}
        />

        {/* 选中源连接状态徽章 — Connected 不显示 (避免常驻噪音); Error 红灯 */}
        {connState && connState !== 'Connected' && (
          <span
            className={`flex items-center gap-1 text-[10px] font-mono px-1.5 py-0.5 rounded-sm border shrink-0 ${
              connState === 'Error'
                ? 'text-red border-red/40 bg-red/10'
                : connState === 'Connecting'
                  ? 'text-yellow border-yellow/40 bg-yellow/10'
                  : 'text-text-secondary border-border bg-bg-input'
            }`}
            title={t(lang, connState === 'Error' ? 'connError' : connState === 'Connecting' ? 'connecting' : 'notConnected')}
          >
            <span
              className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${
                connState === 'Error' ? 'bg-red animate-pulse' : connState === 'Connecting' ? 'bg-yellow animate-pulse' : 'bg-text-muted'
              }`}
            />
            {t(lang, connState === 'Error' ? 'connError' : connState === 'Connecting' ? 'connecting' : 'notConnected')}
          </span>
        )}

        {channelOptions.length > 0 && (
          <label className="flex items-center gap-1 text-xs text-text-secondary shrink-0">
            <span>{t(lang, 'rawDataChannel')}</span>
            <select
              value={channel}
              onChange={(e) => onChannelChange(e.target.value)}
              className="bg-bg-input border border-border rounded px-1 py-0.5 text-xs font-mono text-text-primary transition-colors hover:border-accent focus:outline-none focus:border-accent focus:ring-1 focus:ring-accent/40 cursor-pointer max-w-[160px]"
            >
              {channelOptions.map((o) => (
                <option key={o.key} value={o.key}>
                  {o.label ?? (o.sourceHandle ?? sourceLabel(o.sourceId))}
                </option>
              ))}
            </select>
          </label>
        )}

        <div className="flex items-center gap-1 text-text-secondary text-xs font-mono">
          {isStr ? (
            // 字符串通道: 无字节统计, 显示历史行数
            <span>{(stringRowCount ?? 0).toLocaleString()} rows</span>
          ) : (
            <>
              <span className={isNum ? 'opacity-40' : ''}>
                {totalBytes.toLocaleString()} B
              </span>
              {!isNum && isFiltered && (
                <span className="text-text-disabled">
                  {modeCount.toLocaleString()} rows
                </span>
              )}
              {droppedBytes > 0 && (
                <span
                  className="text-yellow flex items-center gap-0.5 cursor-pointer hover:underline"
                  title={t(lang, 'rawDataDropped')}
                  onClick={onDroppedInfoOpen}
                  onKeyDown={activateOnKeyboard}
                  role="button"
                  tabIndex={0}
                >
                  <FileWarning size={12} />
                  +{droppedBytes.toLocaleString()}
                </span>
              )}
            </>
          )}
        </div>

        <div className="flex-1" />

        {selectionCount > 0 && (
          <>
            <span className="text-text-secondary text-xs">{selectionCount}</span>
            <button
              disabled={isNum}
              className={`w-7 h-7 flex items-center justify-center rounded text-text-secondary hover:bg-bg-hover hover:text-text-primary transition-all duration-150 motion-safe:active:scale-95 cursor-pointer disabled:cursor-not-allowed disabled:pointer-events-none disabled:opacity-40 ${copyFeedback ? 'text-green' : ''}`}
              title={t(lang, 'copySelected')}
              onClick={onCopySelected}
            >
              {copyFeedback ? <Check size={14} /> : <Copy size={14} />}
            </button>
            <button
              disabled={isNum}
              className="w-7 h-7 flex items-center justify-center rounded text-text-secondary hover:bg-bg-hover hover:text-text-primary transition-all duration-150 motion-safe:active:scale-95 cursor-pointer disabled:cursor-not-allowed disabled:pointer-events-none disabled:opacity-40"
              title={t(lang, 'clearSelection')}
              onClick={onClearSelection}
            >
              <X size={14} />
            </button>
          </>
        )}

        <button
          className={`w-7 h-7 flex items-center justify-center rounded text-text-secondary hover:bg-bg-hover hover:text-text-primary transition-all duration-150 motion-safe:active:scale-95 cursor-pointer ${showTimestamp ? 'text-text-bright bg-bg-hover' : ''}`}
          title={t(lang, 'showTimestamp')}
          onClick={() => onShowTimestampChange(!showTimestamp)}
        >
          <Clock size={14} />
        </button>
        <button
          className={`w-7 h-7 flex items-center justify-center rounded text-text-secondary hover:bg-bg-hover hover:text-text-primary transition-all duration-150 motion-safe:active:scale-95 cursor-pointer ${autoScroll && !detached ? 'text-text-bright bg-bg-hover' : ''}`}
          title={t(lang, 'autoScroll')}
          onClick={() => {
            const next = !autoScroll;
            onAutoScrollChange(next);
            // 打开自动滚动即恢复跟随; 关闭时保留脱离状态 — 视口仍不在最新, 按钮应继续显示
            if (next) onResetUserScroll();
          }}
        >
          <ArrowDown size={14} />
        </button>
        <button
          className={`w-7 h-7 flex items-center justify-center rounded text-text-secondary hover:bg-bg-hover hover:text-text-primary transition-all duration-150 motion-safe:active:scale-95 cursor-pointer ${showSettings ? 'text-text-bright bg-bg-hover' : ''}`}
          title={t(lang, 'settings')}
          onClick={() => onShowSettingsChange(!showSettings)}
        >
          <Settings2 size={14} />
        </button>
        <button
          className="w-7 h-7 flex items-center justify-center rounded text-text-secondary hover:bg-bg-danger hover:text-text-bright transition-all duration-150 motion-safe:active:scale-95 cursor-pointer"
          title={t(lang, 'clear')}
          onClick={onClear}
        >
          <Trash2 size={14} />
        </button>
      </div>
    </>
  );
}
