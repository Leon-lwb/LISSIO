import { useEffect, useMemo, useRef, useState } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import { canFrameBuffer } from '../../../lib/buffers/canBuffer';
import { clearCanBuffer } from '../../../lib/buffers/canSubscription';
import { useAppStore } from '../../../store/appStore';
import { t } from '../../../i18n';
import { ToolbarIconButton } from '../../ui/ToolbarIconButton';
import { Trash2 } from 'lucide-react';
import type { CanFrame } from '../../../types';

function canId(frame: CanFrame): string {
  return `0x${frame.id.toString(16).toUpperCase().padStart(frame.extended ? 8 : 3, '0')}`;
}

function dataHex(frame: CanFrame): string {
  return frame.rtr ? '(remote)' : frame.data.map((byte) => byte.toString(16).toUpperCase().padStart(2, '0')).join(' ');
}

function frameTime(us: number): string {
  if (!us) return '--:--:--.------';
  const date = new Date(us / 1000);
  return `${date.getHours().toString().padStart(2, '0')}:${date.getMinutes().toString().padStart(2, '0')}:${date.getSeconds().toString().padStart(2, '0')}.${date.getMilliseconds().toString().padStart(3, '0')}${Math.floor(us % 1000).toString().padStart(3, '0')}`;
}

export function CanIdLatestView() {
  const lang = useAppStore((state) => state.lang);
  const [version, setVersion] = useState(canFrameBuffer.version);
  const parent = useRef<HTMLDivElement>(null);

  useEffect(() => canFrameBuffer.subscribe(() => setVersion(canFrameBuffer.version)), []);

  const rows = useMemo(() => {
    void version;
    return canFrameBuffer.getLatestById();
  }, [version]);
  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => parent.current,
    estimateSize: () => 30,
    overscan: 8,
  });

  return (
    <div className="h-full flex flex-col text-xs font-mono" data-testid="can-latest-view">
      <div className="flex justify-end border-b border-border px-2 py-1">
        <ToolbarIconButton icon={<Trash2 />} variant="danger" title={t(lang, 'clear')} onClick={() => {
          void clearCanBuffer();
          canFrameBuffer.clear();
        }} />
      </div>
      <div className="grid grid-cols-[100px_48px_48px_48px_64px_124px_1fr] border-b border-border bg-bg-panel-header text-text-secondary px-2 py-2">
        <span>ID</span><span>EXT</span><span>DIR</span><span>DLC</span>
        <span>{t(lang, 'canFrameCount')}</span><span>{t(lang, 'time')}</span><span>DATA</span>
      </div>
      <div ref={parent} className="flex-1 overflow-auto">
        {rows.length === 0 && <div className="h-full flex items-center justify-center text-text-secondary">{t(lang, 'noCanFrames')}</div>}
        <div className="relative" style={{ height: virtualizer.getTotalSize() }}>
          {virtualizer.getVirtualItems().map((item) => {
            const row = rows[item.index];
            const { frame } = row;
            return (
              <div key={row.key} className="absolute left-0 right-0 grid grid-cols-[100px_48px_48px_48px_64px_124px_1fr] items-center border-b border-border/30 px-2" style={{ height: item.size, transform: `translateY(${item.start}px)` }}>
                <span className="text-text-bright">{canId(frame)}</span>
                <span>{frame.extended ? 'X' : ''}</span>
                <span>{frame.direction}</span>
                <span>{frame.dlc}</span>
                <span>{row.count}</span>
                <span>{frameTime(frame.timestamp)}</span>
                <span className="truncate" title={dataHex(frame)}>{dataHex(frame)}</span>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
