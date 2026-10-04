import { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import { useAppStore } from '../../../store/appStore';
import { canFrameBuffer, CanFrameBuffer } from '../../../lib/buffers/canBuffer';
import { clearCanBuffer, subscribeCanFramesFiltered } from '../../../lib/buffers/canSubscription';
import { useSelection } from '../../../lib/hooks/useSelection';
import { writeTextToClipboard } from '../../../lib/utils/clipboard';
import { translate } from '../../../i18n';
import { ToolbarIconButton } from '../../ui/ToolbarIconButton';
import { SearchInput } from '../../ui/SearchInput';
import { HorizontalScrollArea } from '../../ui/HorizontalScrollArea';
import { usePanelFollowing, usePanelGoLive, usePanelKey } from '../common/PanelLiveness';
import { useListScrollPause } from '../../../lib/buffers/listScrollPause';
import { Trash2, ArrowDown, Download, Copy, Check, X } from 'lucide-react';
import type { CanFrame, CanFrameFilter } from '../../../types';
import { errorText } from '../../../types/errors';
import { Row } from './CanFrameRow';
import {
  exportFramesToCsv,
  framesToCsv,
  ROW_HEIGHT,
} from './canFrameFormat';

/// CAN 帧列表显示 — 虚拟滚动 + 选中复制 + 过滤
export function CanFrameList() {
  const lang = useAppStore((s) => s.lang);

  const [version, setVersion] = useState(0);
  const [autoScroll, setAutoScroll] = useState(true);
  const [filterId, setFilterId] = useState('');
  const [filterDir, setFilterDir] = useState<'all' | 'Rx' | 'Tx'>('all');
  const [copyFeedback, setCopyFeedback] = useState(false);
  const parentRef = useRef<HTMLDivElement>(null);
  const userScrolledRef = useRef(false);
  const isAutoScrollingRef = useRef(false);
  // userScrolledRef 的响应式镜像 — 驱动显示时效角标 (仅在翻转时重渲染)
  const [detached, setDetached] = useState(false);
  // 用户已上滚接管 — 追底让位, 直到回到底部 (或内容无滚动余量) 才解除
  const userIntentRef = useRef(false);
  // 响应式镜像 — 驱动"上滚暂停工作区" (视口瞬时不在底部不等于用户上滚)
  const [userScrolledUp, setUserScrolledUp] = useState(false);
  /// 上一次观察到的滚动位置 — 识别"位置变小 = 用户朝最新之外滚动" (拖滚动条);
  /// null = 尚未观察到 (首个事件只记录基线, 不下方向判断)
  const lastScrollTopRef = useRef<number | null>(null);
  const markUserScrolledUp = useCallback((value: boolean) => {
    if (userIntentRef.current === value) return;
    userIntentRef.current = value;
    setUserScrolledUp(value);
  }, []);

  // 过滤条件 (后端过滤): 方向 + ID (HEX); 非法 ID 显式报错，不发送空过滤请求
  const isFiltered = filterDir !== 'all' || filterId.trim() !== '';
  const parsedFilterId = useMemo(() => parseCanFilterId(filterId), [filterId]);
  const filterOptions = useMemo<CanFrameFilter | null>(() => {
    if (!isFiltered || parsedFilterId.kind === 'error') return null;
    const opts: CanFrameFilter = {};
    if (filterDir !== 'all') opts.direction = filterDir;
    if (parsedFilterId.kind === 'id') opts.id = parsedFilterId.value;
    return opts;
  }, [isFiltered, parsedFilterId, filterDir]);

  // 过滤模式: 本地 buffer + 后端过滤订阅 (切换条件时重建, 后端重推匹配历史)
  const [filteredBuffer, setFilteredBuffer] = useState<CanFrameBuffer | null>(null);
  const [subscriptionError, setSubscriptionError] = useState<unknown>(null);
  const hasSubscriptionError = parsedFilterId.kind === 'error' || subscriptionError !== null;
  useEffect(() => {
    setSubscriptionError(null);
    if (!filterOptions) {
      setFilteredBuffer(null);
      return;
    }
    const buf = new CanFrameBuffer();
    setFilteredBuffer(buf);
    const sub = subscribeCanFramesFiltered(
      filterOptions,
      (batch) => buf.push(batch.frames),
      {
        intervalMs: 100,
        maxFrames: 500,
        onError: (error) => setSubscriptionError(error),
      },
    );
    return () => sub.cancel();
  }, [filterOptions]);

  const buffer = filteredBuffer ?? canFrameBuffer;

  // 订阅 buffer 变化, 用 version 触发重渲染
  useEffect(() => {
    const unsub = buffer.subscribe(() => setVersion((v) => v + 1));
    setVersion((v) => v + 1);
    return unsub;
  }, [buffer]);

  // 当前数据源: 过滤模式下后端已筛选, 直接取内部引用 (无需前端再过滤)
  const frames = buffer.getUnsafeRef();
  // Rx/Tx 计数: 从内部引用遍历, 避免两次 getAll 拷贝
  const rxTxCounts = useMemo(() => {
    void version; // version 仅用于触发统计重算
    const all = buffer.getUnsafeRef();
    let rx = 0, tx = 0;
    for (const frame of all) {
      if (frame.direction === 'Rx') rx++;
      else tx++;
    }
    return { rxCount: rx, txCount: tx, total: all.length };
  }, [buffer, version]);
  const { rxCount, txCount } = rxTxCounts;

  const virtualizer = useVirtualizer({
    count: frames.length,
    getScrollElement: () => parentRef.current,
    // 固定行高: estimateSize 返回常量, 跳过 measureElement 的 DOM 测量开销,
    // 行高波动时由浏览器处理, 保证 60fps 滚动
    estimateSize: () => ROW_HEIGHT,
    overscan: 5,
    // CAN 帧无唯一 id, 追加型缓冲区中 index 即稳定身份 (过滤切换时按 index 重取帧)
    getItemKey: (index) => index,
  });

  const selection = useSelection(frames.length);

  // 自动滚动到底部
  useEffect(() => {
    if (!autoScroll || frames.length === 0) return;
    const el = parentRef.current;
    // 无滚动余量 (内容不足一屏): 用户上滚输入并未真的离开最新, 解除约束
    if (el && el.scrollHeight - el.clientHeight <= 0) markUserScrolledUp(false);
    if (userScrolledRef.current || userIntentRef.current) return;
    isAutoScrollingRef.current = true;
    virtualizer.scrollToIndex(frames.length - 1, { align: 'end' });
    const t = setTimeout(() => {
      isAutoScrollingRef.current = false;
    }, 50);
    return () => clearTimeout(t);
  }, [frames.length, autoScroll, version, virtualizer, markUserScrolledUp]);

  // 用户滚动输入 (滚轮/触摸): 高频追底会把视口一直拉回最新, 位置比较无法区分
  // "用户上滚"与"自身定位写回", 故以输入事件本身为准让位
  const handleUserScrollIntent = useCallback(
    (awayFromLatest: boolean) => {
      isAutoScrollingRef.current = false;
      if (!awayFromLatest) return;
      const el = parentRef.current;
      // 没有可滚动余量: 上滚改变不了视口, 不算"离开最新"
      if (!el || el.scrollHeight - el.clientHeight <= 0) return;
      markUserScrolledUp(true);
    },
    [markUserScrolledUp]
  );

  // 检测用户手动滚动
  const handleScroll = useCallback(() => {
    const el = parentRef.current;
    if (!el) return;
    const previousScrollTop = lastScrollTopRef.current;
    lastScrollTopRef.current = el.scrollTop;
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 30;
    // 视口滑到底部只恢复跟随, 不清除"用户上滚": 暂停后的恢复是显式动作
    if (!atBottom && isAutoScrollingRef.current && !userIntentRef.current) return;
    if (atBottom) isAutoScrollingRef.current = false;
    else if (previousScrollTop !== null && el.scrollTop < previousScrollTop) markUserScrolledUp(true);
    userScrolledRef.current = !atBottom;
    setDetached(!atBottom);
  }, [markUserScrolledUp]);

  // 显示时效: 跟随最新 = 自动滚动开启且未被用户上滚拖离
  const reportFollowing = usePanelFollowing();
  const panelKey = usePanelKey();
  const canFollowing = autoScroll && !detached;
  useEffect(() => {
    reportFollowing(canFollowing);
  }, [reportFollowing, canFollowing]);

  // 用户主动上滚 → 暂停工作区 (多面板按 key 计数); 显式回最新/卸载时释放
  useListScrollPause(panelKey, userScrolledUp);

  // 从暂停恢复 → 统一跳最新 (恢复自动滚动并定位到末尾)
  const handleGoLive = useCallback(() => {
    userScrolledRef.current = false;
    markUserScrolledUp(false);
    setDetached(false);
    setAutoScroll(true);
    if (frames.length > 0) virtualizer.scrollToIndex(frames.length - 1, { align: 'end' });
  }, [frames.length, virtualizer, markUserScrolledUp]);
  usePanelGoLive(handleGoLive);

  const handleClear = () => {
    void clearCanBuffer();
    canFrameBuffer.clear();
    filteredBuffer?.clear();
    selection.clear();
    userScrolledRef.current = false;
    markUserScrolledUp(false);
    setDetached(false);
    setVersion((v) => v + 1);
  };

  const copySelected = useCallback(async () => {
    const indices = selection.selectedSorted;
    if (indices.length === 0) return;
    const selected = indices
      .map((index) => frames[index])
      .filter((frame): frame is CanFrame => frame !== undefined);
    const text = framesToCsv(selected);
    const ok = await writeTextToClipboard(text);
    if (ok) {
      setCopyFeedback(true);
      setTimeout(() => setCopyFeedback(false), 1200);
    }
  }, [selection.selectedSorted, frames]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      const target = e.target as HTMLElement;
      if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable) return;
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'a') {
        e.preventDefault();
        selection.selectAll();
      }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'c') {
        e.preventDefault();
        void copySelected();
      }
    },
    [selection, copySelected]
  );

  const handleRowMouseDown = useCallback(
    (e: React.MouseEvent, index: number) => {
      if (e.button !== 0) return;
      selection.handleClick(index, e);
    },
    [selection]
  );

  const virtualItems = virtualizer.getVirtualItems();

  return (
    <div className="h-full flex flex-col overflow-hidden bg-bg-editor">
      {/* 工具栏 */}
      <HorizontalScrollArea
        shellClassName="flex-shrink-0"
        className="flex flex-nowrap gap-2 p-2 items-center border-b border-border bg-bg-panel-header"
      >
        <SearchInput
          mono
          className="w-24 sm:w-28 flex-shrink-0"
          placeholder={translate('canFilterById', lang)}
          value={filterId}
          onChange={setFilterId}
        />

        <div className="flex flex-shrink-0 items-center gap-0.5">
          {(['all', 'Rx', 'Tx'] as const).map((d) => (
            <button
              key={d}
              type="button"
              className={`px-2 py-0.5 text-[11px] border rounded cursor-pointer motion-transition ${
                filterDir === d
                  ? 'bg-accent border-accent text-text-inverse'
                  : 'bg-bg-input text-text-secondary border-border hover:bg-bg-hover hover:text-text-primary'
              }`}
              onClick={() => setFilterDir(d)}
            >
              {d === 'all' ? translate('all', lang) : d}
            </button>
          ))}
        </div>

        {hasSubscriptionError && (
          <div className="flex-shrink-0 whitespace-nowrap text-[11px] text-red" role="alert">
            {parsedFilterId.kind === 'error'
              ? translate('canInvalidFilterId', lang)
              : formatSubscriptionError(subscriptionError)}
          </div>
        )}

        <div className="flex-1 min-w-2" />

        <div className="flex flex-shrink-0 items-center gap-1.5 text-xs text-text-secondary font-mono">
          <span className="hidden sm:inline">{rxTxCounts.total}</span>
          <span className="px-1.5 py-0.5 rounded bg-green/10 text-green">Rx:{rxCount}</span>
          <span className="px-1.5 py-0.5 rounded bg-purple/10 text-purple">Tx:{txCount}</span>
        </div>

        {selection.selected.size > 0 && (
          <div className="flex flex-shrink-0 items-center gap-1">
            <span className="text-text-secondary text-xs">{selection.selected.size}</span>
            <button
              className={`w-7 h-7 flex items-center justify-center rounded text-text-secondary hover:bg-bg-hover hover:text-text-primary transition-colors cursor-pointer ${
                copyFeedback ? 'text-green' : ''
              }`}
              title={translate('copySelected', lang)}
              onClick={() => void copySelected()}
            >
              {copyFeedback ? <Check size={14} /> : <Copy size={14} />}
            </button>
            <button
              className="w-7 h-7 flex items-center justify-center rounded text-text-secondary hover:bg-bg-hover hover:text-text-primary transition-colors cursor-pointer"
              title={translate('clearSelection', lang)}
              onClick={selection.clear}
            >
              <X size={14} />
            </button>
          </div>
        )}

        <ToolbarIconButton
          icon={<ArrowDown />}
          active={autoScroll && !detached}
          title={translate('autoScroll', lang)}
          onClick={() => {
            const next = !autoScroll;
            setAutoScroll(next);
            // 只有重新开启自动滚动才是"显式回到最新"; 关闭跟随不动暂停语义
            if (!next) return;
            userScrolledRef.current = false;
            markUserScrolledUp(false);
            setDetached(false);
          }}
        />
        <ToolbarIconButton
          className="flex-shrink-0"
          icon={<Download />}
          title="Export CSV"
          onClick={() => exportFramesToCsv(frames.slice())}
        />
        <ToolbarIconButton
          className="flex-shrink-0"
          icon={<Trash2 />}
          variant="danger"
          title={translate('clear', lang)}
          onClick={handleClear}
        />
      </HorizontalScrollArea>

      {/* 表头 */}
      <div className="flex items-center text-[10px] uppercase text-text-secondary font-mono border-b border-border bg-bg-panel-header shrink-0 select-none">
        <span className="px-3 py-1.5 text-left font-medium whitespace-nowrap min-w-[132px]">
          {translate('time', lang)}
        </span>
        <span className="px-2 py-1.5 text-left font-medium whitespace-nowrap min-w-[56px]">Dir</span>
        <span className="px-3 py-1.5 text-left font-medium whitespace-nowrap min-w-[76px]">ID</span>
        <span className="px-2 py-1.5 text-center font-medium whitespace-nowrap min-w-[40px]">Ext</span>
        <span className="px-2 py-1.5 text-center font-medium whitespace-nowrap min-w-[40px]">RTR</span>
        <span className="px-2 py-1.5 text-center font-medium whitespace-nowrap min-w-[40px]">DLC</span>
        <span className="px-3 py-1.5 text-left font-medium whitespace-nowrap flex-1">Data</span>
      </div>

      {/* 虚拟滚动列表 */}
      <div
        className="flex-1 overflow-auto font-mono text-xs leading-relaxed min-h-0 outline-none"
        ref={parentRef}
        onScroll={handleScroll}
        onWheel={(e) => handleUserScrollIntent(e.deltaY < 0)}
        onTouchMove={() => handleUserScrollIntent(true)}
        onKeyDown={handleKeyDown}
        tabIndex={0}
        role="grid"
      >
        {frames.length === 0 ? (
          <div className="flex items-center justify-center h-48 text-text-secondary text-xs">
            {translate('noCanFrames', lang)}
          </div>
        ) : (
          <div style={{ height: `${virtualizer.getTotalSize()}px`, position: 'relative' }}>
            <div
              style={{
                position: 'absolute',
                top: 0,
                left: 0,
                width: '100%',
                transform: `translateY(${virtualItems[0]?.start ?? 0}px)`,
              }}
            >
              {virtualItems.map((virtualRow) => {
                const frame = frames[virtualRow.index];
                if (!frame) return null;
                return (
                  <Row
                    key={virtualRow.key}
                    index={virtualRow.index}
                    frame={frame}
                    isSelected={selection.isSelected(virtualRow.index)}
                    onMouseDown={handleRowMouseDown}
                  />
                );
              })}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}


type ParsedCanFilterId =
  | { kind: 'empty' }
  | { kind: 'id'; value: number }
  | { kind: 'error' };

function parseCanFilterId(input: string): ParsedCanFilterId {
  const text = input.trim().toLowerCase().replace(/^0x/, '');
  if (text === '') return { kind: 'empty' };
  if (!/^[0-9a-f]+$/.test(text)) return { kind: 'error' };
  const value = Number.parseInt(text, 16);
  if (!Number.isSafeInteger(value) || value < 0 || value > 0x1fff_ffff) {
    return { kind: 'error' };
  }
  return { kind: 'id', value };
}

function formatSubscriptionError(error: unknown): string {
  return errorText(error);
}
