import type { WaveformSeriesSelection, WaveformWindow } from '../../../types';

export function buildRawClipboardCsv(
  windowData: WaveformWindow,
  selection: WaveformSeriesSelection,
  widgetId: string,
): string {
  const csvCell = (value: number | undefined) =>
    value !== undefined && Number.isFinite(value) ? String(value) : '';
  const channels = selection.channels;
  const derived = selection.derived;
  const headers = [
    'timestamp_us',
    ...channels.map((channel) => `CH${channel}`),
    ...derived.map((series) =>
      `${series.sink_id}:${series.source_id}:${series.source_handle}`,
    ),
  ];
  const rows = [headers.join(',')];
  const latestUs = windowData.latest_timestamp_us;
  for (let index = 0; index < windowData.timestamps.length; index++) {
    const timestampUs = Math.round(latestUs + windowData.timestamps[index] * 1000);
    rows.push([
      String(timestampUs),
      ...channels.map((channel) => csvCell(windowData.channels[channel]?.[index])),
      ...derived.map((series) => csvCell(
        windowData.derived[series.sink_id]?.[series.source_id]?.[series.source_handle]?.[index]
          ?? windowData.derived[widgetId]?.[series.source_id]?.[series.source_handle]?.[index]
          ?? NaN,
      )),
    ].join(','));
  }
  return rows.join('\n');
}
