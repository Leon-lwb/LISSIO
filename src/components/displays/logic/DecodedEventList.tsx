import { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { useAppStore } from '../../../store/appStore';
import { decodedEventBuffer, DecodedEventBuffer } from '../../../lib/buffers/logicBuffer';
import { clearDecodedBuffer, subscribeDecodedEventsFiltered, type DecodedEventFilterOptions } from '../../../lib/buffers/logicSubscription';
import { translate } from '../../../i18n';
import { ToolbarIconButton } from '../../ui/ToolbarIconButton';
import { HorizontalScrollArea } from '../../ui/HorizontalScrollArea';
import { usePanelFollowing, usePanelGoLive, usePanelKey } from '../common/PanelLiveness';
import { useListScrollPause } from '../../../lib/buffers/listScrollPause';
import { Trash2, ArrowDown } from 'lucide-react';
import type { DecodedEvent, I2cEvent } from '../../../types';

/// 格式化微秒时间戳为定宽字符串
function formatTs(us: number): string {
  return us.toString().padStart(10, '0');
}

/// 格式化 I2C 事件为字符串与颜色
function formatI2cEvent(event: I2cEvent): { text: string; color: string } {
  if ('Start' in event) return { text: 'START', color: '#89d185' };
  if ('Stop' in event) return { text: 'STOP', color: '#ff8c69' };
  if ('Address' in event) {
    const a = event.Address;
    return {
      text: `ADDR ${a.addr.toString(16).toUpperCase().padStart(2, '0')} ${a.read ? 'R' : 'W'} ${a.ack ? 'ACK' : 'NACK'}`,
      color: '#75beff',
    };
  }
  if ('Data' in event) {
    const d = event.Data;
    return {
      text: `DATA ${d.byte.toString(16).toUpperCase().padStart(2, '0')} ${d.ack ? 'ACK' : 'NACK'}`,
      color: '#dcdcaa',
    };
  }
  return { text: '?', color: '#888' };
}

/// 解码事件列表 — 支持 UART/I2C/SPI 类型过滤与自动滚动
export function DecodedEventList() {
  const lang = useAppStore((s) => s.lang);
  const [events, setEvents] = useState<DecodedEvent[]>([]);
  const [autoScroll, setAutoScroll] = useState(true);
  const [filterType, setFilterType] = useState<'all' | 'Uart' | 'I2c' | 'Spi'>('all');
  const listRef = useRef<HTMLDivElement>(null);
  const userScrolledRef = useRef(false);
  // userScrolledRef 的响应式镜像 — 驱动显示时效角标 (仅在翻转时重渲染)
  const [detached, setDetached] = useState(false);
  // 用户已上滚接管 — 追底让位, 直到显式回到最新 (或内容无滚动余量) 才解除
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

  // 过滤条件 (后端过滤): 协议类型
  const filterOptions = useMemo<DecodedEventFilterOptions | null>(
    () => (filterType === 'all' ? null : { kind: filterType }),
    [filterType]
  );

  // 过滤模式: 本地 buffer + 后端过滤订阅 (切换条件时重建, 后端重推匹配历史)
  const [filteredBuffer, setFilteredBuffer] = useState<DecodedEventBuffer | null>(null);
  useEffect(() => {
    if (!filterOptions) {
      setFilteredBuffer(null);
      return;
    }
    const buf = new DecodedEventBuffer();
    setFilteredBuffer(buf);
    const sub = subscribeDecodedEventsFiltered(
      filterOptions,
      (batch) => buf.push(batch.events),
      { intervalMs: 100, maxEvents: 500 }
    );
    return () => sub.cancel();
  }, [filterOptions]);

  const buffer = filteredBuffer ?? decodedEventBuffer;

  // 订阅 buffer (过滤模式下后端已筛选, 无需前端再过滤)
  useEffect(() => {
    const unsub = buffer.subscribe(() => {
      setEvents(buffer.getRecent(500));
    });
    setEvents(buffer.getRecent(500));
    return unsub;
  }, [buffer]);

  // 自动滚动到底部
  useEffect(() => {
    const el = listRef.current;
    if (!autoScroll || !el) return;
    // 无滚动余量 (内容不足一屏): 用户上滚输入并未真的离开最新, 解除约束
    if (el.scrollHeight - el.clientHeight <= 0) markUserScrolledUp(false);
    if (userScrolledRef.current || userIntentRef.current) return;
    el.scrollTop = el.scrollHeight;
  }, [events, autoScroll, markUserScrolledUp]);

  // 用户滚动输入 (滚轮/触摸): 高频追底会把视口一直拉回最新, 位置比较无法区分
  // "用户上滚"与"自身定位写回", 故以输入事件本身为准让位
  const handleUserScrollIntent = (awayFromLatest: boolean) => {
    if (!awayFromLatest) return;
    const el = listRef.current;
    // 没有可滚动余量: 上滚改变不了视口, 不算"离开最新"
    if (!el || el.scrollHeight - el.clientHeight <= 0) return;
    markUserScrolledUp(true);
  };

  const handleScroll = () => {
    const el = listRef.current;
    if (!el) return;
    const previousScrollTop = lastScrollTopRef.current;
    lastScrollTopRef.current = el.scrollTop;
    const next = el.scrollHeight - el.scrollTop - el.clientHeight > 30;
    // 视口滑到底部只恢复跟随, 不清除"用户上滚": 暂停后的恢复是显式动作
    if (next && previousScrollTop !== null && el.scrollTop < previousScrollTop) markUserScrolledUp(true);
    userScrolledRef.current = next;
    setDetached(next);
  };

  // 显示时效: 跟随最新 = 自动滚动开启且未被用户上滚拖离
  const reportFollowing = usePanelFollowing();
  const panelKey = usePanelKey();
  const eventsFollowing = autoScroll && !detached;
  useEffect(() => {
    reportFollowing(eventsFollowing);
  }, [reportFollowing, eventsFollowing]);

  // 用户主动上滚 → 暂停工作区 (多面板按 key 计数); 显式回最新/卸载时释放
  useListScrollPause(panelKey, userScrolledUp);

  // 从暂停恢复 → 统一跳最新 (恢复自动滚动并跳到列表末尾)
  const handleGoLive = useCallback(() => {
    userScrolledRef.current = false;
    markUserScrolledUp(false);
    setDetached(false);
    setAutoScroll(true);
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight });
  }, [markUserScrolledUp]);
  usePanelGoLive(handleGoLive);

  const handleClear = () => {
    void clearDecodedBuffer();
    decodedEventBuffer.clear();
    filteredBuffer?.clear();
    // 清空 = 显式回到最新: 同时释放"用户上滚"约束
    userScrolledRef.current = false;
    markUserScrolledUp(false);
    setDetached(false);
    setEvents([]);
  };

  const renderEvent = (e: DecodedEvent, i: number) => {
    if ('Uart' in e) {
      const u = e.Uart;
      return (
        <div key={i} className="grid grid-cols-[7rem_4rem_1fr] sm:grid-cols-[8rem_4rem_1fr] gap-2 px-3 sm:px-4 py-1 border-b border-border/30 hover:bg-bg-hover/60 transition-colors font-mono text-xs items-center">
          <span className="text-text-secondary">{formatTs(u.timestamp)}</span>
          <span className="text-green font-semibold">UART</span>
          <span className="flex items-center gap-2 min-w-0">
            <span className="text-text-bright">0x{u.byte.toString(16).toUpperCase().padStart(2, '0')}</span>
            <span className="text-text-secondary">({String.fromCharCode(u.byte)})</span>
            {!u.parity_ok && <span className="text-red text-[10px] border border-red/50 rounded px-1">PERR</span>}
          </span>
        </div>
      );
    }
    if ('I2c' in e) {
      const i2c = e.I2c;
      const { text, color } = formatI2cEvent(i2c.event);
      return (
        <div key={i} className="grid grid-cols-[7rem_4rem_1fr] sm:grid-cols-[8rem_4rem_1fr] gap-2 px-3 sm:px-4 py-1 border-b border-border/30 hover:bg-bg-hover/60 transition-colors font-mono text-xs items-center">
          <span className="text-text-secondary">{formatTs(i2c.timestamp)}</span>
          <span style={{ color }} className="font-semibold">I2C</span>
          <span style={{ color }} className="truncate">{text}</span>
        </div>
      );
    }
    if ('Spi' in e) {
      const s = e.Spi;
      return (
        <div key={i} className="grid grid-cols-[7rem_4rem_1fr] sm:grid-cols-[8rem_4rem_1fr] gap-2 px-3 sm:px-4 py-1 border-b border-border/30 hover:bg-bg-hover/60 transition-colors font-mono text-xs items-center">
          <span className="text-text-secondary">{formatTs(s.timestamp)}</span>
          <span className="text-orange font-semibold">SPI</span>
          <span className="flex items-center gap-2 min-w-0">
            <span className="text-text-bright">MOSI:0x{s.mosi.toString(16).toUpperCase().padStart(2, '0')}</span>
            <span className="text-text-primary">MISO:0x{s.miso.toString(16).toUpperCase().padStart(2, '0')}</span>
          </span>
        </div>
      );
    }
    return null;
  };

  return (
    <div className="h-full flex flex-col overflow-hidden bg-bg-editor">
      <HorizontalScrollArea
        shellClassName="flex-shrink-0"
        className="flex flex-nowrap gap-2 p-2 items-center border-b border-border bg-bg-panel-header"
      >
        <div className="flex flex-shrink-0 items-center gap-0.5">
          {(['all', 'Uart', 'I2c', 'Spi'] as const).map((tp) => (
            <button
              key={tp}
              type="button"
              className={`px-2 py-0.5 text-[11px] border rounded cursor-pointer motion-transition ${
                filterType === tp
                  ? 'bg-accent border-accent text-text-inverse'
                  : 'bg-bg-input text-text-secondary border-border hover:bg-bg-hover hover:text-text-primary'
              }`}
              onClick={() => setFilterType(tp)}
            >
              {tp === 'all' ? translate('all', lang) : tp}
            </button>
          ))}
        </div>

        <div className="flex-1 min-w-2" />

        <span className="flex-shrink-0 whitespace-nowrap text-xs text-text-secondary font-mono">{events.length} events</span>
        <ToolbarIconButton
          className="flex-shrink-0"
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
          icon={<Trash2 />}
          variant="danger"
          title={translate('clear', lang)}
          onClick={handleClear}
        />
      </HorizontalScrollArea>

      {/* 表头 */}
      <div className="grid grid-cols-[7rem_4rem_1fr] sm:grid-cols-[8rem_4rem_1fr] gap-2 px-3 sm:px-4 py-1 border-b border-border bg-bg-panel-header text-[10px] font-semibold uppercase tracking-wide text-text-secondary shrink-0">
        <span>{translate('time', lang)}</span>
        <span>Protocol</span>
        <span>Data</span>
      </div>

      <div
        className="flex-1 overflow-y-auto min-h-0"
        ref={listRef}
        onScroll={handleScroll}
        onWheel={(e) => handleUserScrollIntent(e.deltaY < 0)}
        onTouchMove={() => handleUserScrollIntent(true)}
      >
        {events.length === 0 ? (
          <div className="flex items-center justify-center h-48 text-text-secondary text-xs">
            {translate('noDecodedEvents', lang)}
          </div>
        ) : (
          events.map(renderEvent)
        )}
      </div>
    </div>
  );
}
