import { memo } from 'react';
import type { CanFrame } from '../../../types';
import {
  ROW_HEIGHT,
  formatCanId,
  formatCanTime,
  formatDataHex,
} from './canFrameFormat';

interface RowProps {
  index: number;
  frame: CanFrame;
  isSelected: boolean;
  onMouseDown: (e: React.MouseEvent, index: number) => void;
}

/// CAN 帧行 — memo 化避免无关重渲染
export const Row = memo(function Row({ index, frame, isSelected, onMouseDown }: RowProps) {
  return (
    <div
      className={`flex items-center text-xs font-mono border-b border-border/30 select-none ${
        isSelected ? 'bg-accent/20' : 'hover:bg-bg-hover/60'
      }`}
      style={{ height: ROW_HEIGHT }}
      onMouseDown={(e) => onMouseDown(e, index)}
      role="presentation"
    >
      <span className="px-3 py-1 text-accent whitespace-nowrap min-w-[132px]">
        {formatCanTime(frame.timestamp)}
      </span>
      <span className="px-2 py-1 whitespace-nowrap min-w-[56px]">
        <span
          className={`inline-flex items-center gap-1 text-[10px] font-semibold ${
            frame.direction === 'Tx' ? 'text-purple' : 'text-green'
          }`}
        >
          {frame.direction === 'Tx' ? '→ Tx' : '← Rx'}
        </span>
      </span>
      <span className="px-3 py-1 text-text-bright whitespace-nowrap min-w-[76px]">
        0x{formatCanId(frame.id, frame.extended)}
      </span>
      <span className="px-2 py-1 text-center text-text-secondary min-w-[40px]">
        {frame.extended ? 'X' : ''}
      </span>
      <span className="px-2 py-1 text-center text-text-secondary min-w-[40px]">
        {frame.rtr ? 'R' : ''}
      </span>
      <span className="px-2 py-1 text-center text-text-secondary min-w-[40px]">
        {frame.dlc}
      </span>
      <span className="px-3 py-1 text-text-primary flex-1 min-w-0 truncate">
        {frame.rtr ? (
          <span className="text-text-secondary italic">(remote)</span>
        ) : (
          formatDataHex(frame.data)
        )}
      </span>
    </div>
  );
});
