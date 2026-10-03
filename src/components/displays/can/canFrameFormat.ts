import type { CanFrame } from '../../../types';

export const ROW_HEIGHT = 24;

/// 格式化微秒时间戳为 HH:MM:SS.mmmuuu
export function formatCanTime(us: number): string {
  if (!us) return '--:--:--.------';
  const d = new Date(us / 1000);
  const h = d.getHours().toString().padStart(2, '0');
  const m = d.getMinutes().toString().padStart(2, '0');
  const s = d.getSeconds().toString().padStart(2, '0');
  const ms = d.getMilliseconds().toString().padStart(3, '0');
  const us3 = Math.floor(us % 1000).toString().padStart(3, '0');
  return `${h}:${m}:${s}.${ms}${us3}`;
}

/// 格式化 CAN ID
export function formatCanId(id: number, extended: boolean): string {
  return extended
    ? id.toString(16).toUpperCase().padStart(8, '0')
    : id.toString(16).toUpperCase().padStart(3, '0');
}

/// 格式化数据为 HEX 字符串
export function formatDataHex(data: readonly number[]): string {
  return data.map((b) => b.toString(16).toUpperCase().padStart(2, '0')).join(' ');
}

/// 将帧列表转换为 CSV 文本
export function framesToCsv(frames: readonly CanFrame[]): string {
  const rows = [
    ['Time', 'Dir', 'ID', 'Extended', 'RTR', 'DLC', 'Data'].join(','),
    ...frames.map((f) =>
      [
        formatCanTime(f.timestamp),
        f.direction,
        formatCanId(f.id, f.extended),
        f.extended ? 'X' : '',
        f.rtr ? 'R' : '',
        f.dlc,
        f.rtr ? '' : formatDataHex(f.data),
      ].join(',')
    ),
  ];
  return rows.join('\n');
}

/// 导出帧列表为 CSV 文件
export function exportFramesToCsv(frames: readonly CanFrame[]): void {
  const blob = new Blob([framesToCsv(frames)], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `can-frames-${new Date().toISOString().replace(/[:.]/g, '-')}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}
