/// 工程单位格式化 — 全前端唯一实现 (频率 / 周期 / 字节数)。
/// 原先 SpectrumChart / MeasureItem / FFTWidget / recordingFormat /
/// PerformanceMonitorView / StatusBar 各自实现了一份, 单位与位数互相漂移。

/// 频率 (Hz) — 工程前缀 + 单位: `1.00kHz` / `1.00MHz` / `10.00Hz`
export function formatFreq(hz: number): string {
  if (hz >= 1e6) return `${(hz / 1e6).toFixed(2)}MHz`;
  if (hz >= 1e3) return `${(hz / 1e3).toFixed(2)}kHz`;
  return `${hz.toFixed(2)}Hz`;
}

/// 周期 (s) — 工程前缀, 沿用既有约定省略基准单位: `1.00` / `1.00m` / `1.00µ`
export function formatPeriod(sec: number): string {
  if (sec >= 1) return sec.toFixed(2);
  if (sec >= 1e-3) return `${(sec * 1e3).toFixed(2)}m`;
  if (sec >= 1e-6) return `${(sec * 1e6).toFixed(2)}µ`;
  return `${(sec * 1e9).toFixed(2)}n`;
}

/// 字节数 — 1024 进制换算, 用 IEC 前缀标注 (KiB/MiB/GiB/TiB)
export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 ** 2) return `${(bytes / 1024).toFixed(1)} KiB`;
  if (bytes < 1024 ** 3) return `${(bytes / 1024 ** 2).toFixed(1)} MiB`;
  if (bytes < 1024 ** 4) return `${(bytes / 1024 ** 3).toFixed(2)} GiB`;
  return `${(bytes / 1024 ** 4).toFixed(2)} TiB`;
}

/// 字节数 (可空) — 缺失值渲染为破折号
export function formatBytesOrDash(bytes: number | null | undefined): string {
  return bytes == null ? '—' : formatBytes(bytes);
}
