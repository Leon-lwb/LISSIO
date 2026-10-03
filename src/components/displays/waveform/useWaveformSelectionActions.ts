import { useCallback, type Dispatch, type MutableRefObject, type SetStateAction } from 'react';
import type uPlot from 'uplot';
import { api } from '../../../lib/tauri/tauri';
import { notify, formatError } from '../../../lib/tauri/notifications';
import { writeTextToClipboard } from '../../../lib/utils/clipboard';
import { platform } from '../../../lib/platform';
import { useAppStore } from '../../../store/appStore';
import { translate } from '../../../i18n';
import type { WaveformSeriesSelection } from '../../../types';
import { absoluteTimeRangeUs } from './waveformChartExport';
import { buildRawClipboardCsv } from './waveformChartClipboard';

interface WaveformSelectionActionsOptions {
  selectedRange: { startSec: number; endSec: number } | null;
  selectionAnchorUsRef: MutableRefObject<number>;
  sourceId: string | null;
  snapshotId: string | null;
  detailSelection: WaveformSeriesSelection;
  widgetId: string;
  plotRef: MutableRefObject<uPlot | null>;
  setSelectedRange: Dispatch<SetStateAction<{ startSec: number; endSec: number } | null>>;
  setCopyFeedback: Dispatch<SetStateAction<boolean>>;
}

export function useWaveformSelectionActions({
  selectedRange,
  selectionAnchorUsRef,
  sourceId,
  snapshotId,
  detailSelection,
  widgetId,
  plotRef,
  setSelectedRange,
  setCopyFeedback,
}: WaveformSelectionActionsOptions) {
  const lang = useAppStore((s) => s.lang);

  const getAbsoluteSelection = useCallback(() => {
    if (!selectedRange) return null;
    const latestUs = selectionAnchorUsRef.current;
    if (!latestUs) return null;
    return absoluteTimeRangeUs(selectedRange, latestUs);
  }, [selectedRange, selectionAnchorUsRef]);

  const exportSelection = useCallback(() => {
    const absolute = getAbsoluteSelection();
    if (!absolute || !sourceId) return;
    void platform.saveFile({
      defaultPath: 'waveform.csv',
      filters: [{ name: 'CSV', extensions: ['csv'] }],
    }).then(async (path) => {
      if (!path) return;
      try {
        const rows = await api.exportWaveformCsv(
          sourceId,
          snapshotId,
          absolute.startUs,
          absolute.endUs,
          detailSelection,
          path,
        );
        notify.info('CSV', translate('waveformCsvExported', lang).replace('{{count}}', String(rows)));
      } catch (error) {
        notify.error('CSV', formatError(error));
      }
    });
  }, [detailSelection, getAbsoluteSelection, lang, snapshotId, sourceId]);

  const copySelection = useCallback(async () => {
    const absolute = getAbsoluteSelection();
    if (!absolute || !sourceId) return;
    try {
      const raw = await api.getWaveformRawRange(
        sourceId,
        snapshotId,
        absolute.startUs,
        absolute.endUs,
        100_000,
        detailSelection,
      );
      const csv = buildRawClipboardCsv(raw, detailSelection, widgetId);
      const ok = await writeTextToClipboard(csv);
      if (ok) {
        setCopyFeedback(true);
        setTimeout(() => setCopyFeedback(false), 1200);
      }
    } catch (error) {
      notify.warn(translate('waveformCopyTitle', lang), formatError(error));
    }
  }, [detailSelection, getAbsoluteSelection, lang, snapshotId, sourceId, setCopyFeedback, widgetId]);

  const clearSelection = useCallback(() => {
    setSelectedRange(null);
    plotRef.current?.setSelect({ left: 0, top: 0, width: 0, height: 0 }, false);
  }, [plotRef, setSelectedRange]);

  return { exportSelection, copySelection, clearSelection };
}
