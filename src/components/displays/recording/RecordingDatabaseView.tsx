import { memo, useEffect, useMemo, useState } from 'react';
import { Database, Download, FileText, RefreshCw } from 'lucide-react';
import clsx from 'clsx';
import { platform } from '../../../lib/platform';
import { useAppStore } from '../../../store/appStore';
import { useRecordingDatabaseStore } from '../../../store/recordingDatabaseStore';
import { api, type RecordingExportFormat } from '../../../lib/tauri/tauri';
import { t } from '../../../i18n';
import { formatBytes, formatDurationUs, formatTimestampUs, payloadPreview } from './recordingFormat';

const exportFormats: { value: RecordingExportFormat; label: string; extension: string }[] = [
  { value: 'csv', label: 'CSV', extension: 'csv' },
  { value: 'json', label: 'JSON', extension: 'json' },
  { value: 'parquet', label: 'Parquet', extension: 'parquet' },
];

function stateClass(state: string): string {
  switch (state) {
    case 'running':
      return 'text-emerald-400';
    case 'paused':
      return 'text-amber-400';
    case 'failed':
      return 'text-red-400';
    default:
      return 'text-text-secondary';
  }
}

export const RecordingDatabaseView = memo(function RecordingDatabaseView() {
  const lang = useAppStore((s) => s.lang);
  const sessions = useRecordingDatabaseStore((s) => s.sessions);
  const databaseInfo = useRecordingDatabaseStore((s) => s.databaseInfo);
  const selectedSessionId = useRecordingDatabaseStore((s) => s.selectedSessionId);
  const selectedBindingId = useRecordingDatabaseStore((s) => s.selectedBindingId);
  const bindings = useRecordingDatabaseStore((s) => s.bindings);
  const includePayload = useRecordingDatabaseStore((s) => s.includePayload);
  const history = useRecordingDatabaseStore((s) => s.history);
  const loading = useRecordingDatabaseStore((s) => s.loading);
  const error = useRecordingDatabaseStore((s) => s.error);
  const loadOverview = useRecordingDatabaseStore((s) => s.loadOverview);
  const selectSession = useRecordingDatabaseStore((s) => s.selectSession);
  const selectBinding = useRecordingDatabaseStore((s) => s.selectBinding);
  const setIncludePayload = useRecordingDatabaseStore((s) => s.setIncludePayload);
  const loadHistory = useRecordingDatabaseStore((s) => s.loadHistory);
  const clearError = useRecordingDatabaseStore((s) => s.clearError);

  const [exportFormat, setExportFormat] = useState<RecordingExportFormat>('csv');
  const [exporting, setExporting] = useState(false);

  useEffect(() => {
    if (sessions.length === 0 && databaseInfo == null) {
      void loadOverview();
    }
  }, [databaseInfo, loadOverview, sessions.length]);

  const selectedSession = useMemo(
    () => sessions.find((item) => item.session.id === selectedSessionId) ?? null,
    [selectedSessionId, sessions],
  );

  const currentKey = selectedSessionId == null
    ? null
    : `${selectedSessionId}|${selectedBindingId ?? '*'}${includePayload ? '|payload' : '|meta'}`;
  const currentCache = useMemo(
    () => history.find((entry) => entry.key === currentKey) ?? null,
    [currentKey, history],
  );

  async function handleExport(): Promise<void> {
    if (selectedSessionId == null) return;
    const format = exportFormats.find((item) => item.value === exportFormat) ?? exportFormats[0];
    const path = await platform.saveFile({
      defaultPath: `recording-${selectedSessionId}.${format.extension}`,
      filters: [{ name: format.label, extensions: [format.extension] }],
    });
    if (path == null) return;
    setExporting(true);
    clearError();
    try {
      await api.exportRecordingData({
        session_id: selectedSessionId,
        binding_id: selectedBindingId,
        from_us: null,
        to_us: null,
        format: exportFormat,
        path,
      });
    } catch (exportError) {
      console.error('recording export failed', exportError);
    } finally {
      setExporting(false);
    }
  }

  return (
    <div className="flex h-full w-full flex-col overflow-hidden bg-bg-panel">
      <div className="flex min-h-10 flex-wrap items-center gap-2 border-b border-border-subtle bg-bg-panel-header px-3 py-1.5">
        <Database size={14} className="shrink-0 text-accent" />
        <span className="text-[11px] font-semibold uppercase tracking-wider text-text-primary">
          {t(lang, 'recordingDatabaseTitle')}
        </span>
        {databaseInfo != null && (
          <span className="truncate font-mono text-[10px] text-text-secondary" title={databaseInfo.path}>
            {databaseInfo.path}
          </span>
        )}
        <div className="ml-auto flex items-center gap-2">
          <button
            type="button"
            onClick={() => void loadOverview()}
            className="inline-flex h-7 items-center gap-1 rounded border border-border-subtle bg-bg-input px-2 text-[11px] text-text-secondary hover:text-text-bright"
          >
            <RefreshCw size={12} />
            {t(lang, 'recordingDatabaseRefresh')}
          </button>
          <label className="inline-flex items-center gap-1 text-[11px] text-text-secondary">
            <input
              type="checkbox"
              checked={includePayload}
              onChange={(event) => setIncludePayload(event.target.checked)}
            />
            {t(lang, 'recordingDatabaseIncludePayload')}
          </label>
          <select
            value={exportFormat}
            onChange={(event) => setExportFormat(event.target.value as RecordingExportFormat)}
            className="h-7 rounded border border-border-subtle bg-bg-input px-1.5 text-[11px] text-text-secondary"
          >
            {exportFormats.map((item) => (
              <option key={item.value} value={item.value}>{item.label}</option>
            ))}
          </select>
          <button
            type="button"
            disabled={exporting || selectedSessionId == null}
            onClick={() => void handleExport()}
            className="inline-flex h-7 items-center gap-1 rounded border border-border-subtle bg-bg-input px-2 text-[11px] text-text-secondary hover:text-text-bright disabled:opacity-40"
          >
            <Download size={12} />
            {exporting ? t(lang, 'recordingDatabaseExporting') : t(lang, 'recordingDatabaseExport')}
          </button>
        </div>
      </div>

      {error != null && (
        <div className="flex items-center gap-2 border-b border-red-500/30 bg-red-500/10 px-3 py-1 text-[11px] text-red-300">
          <span className="truncate">{error}</span>
          <button type="button" onClick={clearError} className="ml-auto text-red-200 hover:text-white">
            {t(lang, 'recordingDatabaseDismiss')}
          </button>
        </div>
      )}

      <div className="flex min-h-0 flex-1">
        <div className="flex w-64 shrink-0 flex-col border-r border-border-subtle">
          <div className="flex h-8 items-center border-b border-border-subtle px-2 text-[10px] font-semibold uppercase tracking-wider text-text-secondary">
            {t(lang, 'recordingDatabaseSessions')}
            <span className="ml-auto font-mono">{sessions.length}</span>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto p-1">
            {sessions.map((summary) => {
              const selected = summary.session.id === selectedSessionId;
              return (
                <button
                  type="button"
                  key={summary.session.id}
                  onClick={() => void selectSession(summary.session.id)}
                  className={clsx(
                    'mb-1 w-full rounded border px-2 py-1.5 text-left transition-colors',
                    selected
                      ? 'border-accent/60 bg-accent/10'
                      : 'border-transparent hover:border-border-subtle hover:bg-bg-hover',
                  )}
                >
                  <div className="flex items-center gap-1.5">
                    <span className={clsx('text-[10px] font-semibold uppercase', stateClass(summary.session.state))}>
                      {summary.session.state}
                    </span>
                    <span className="ml-auto font-mono text-[9px] text-text-secondary">
                      {formatBytes(summary.effective_bytes)}
                    </span>
                  </div>
                  <div className="mt-0.5 truncate font-mono text-[10px] text-text-primary">
                    {summary.session.id}
                  </div>
                  <div className="mt-0.5 flex items-center gap-2 text-[9px] text-text-secondary">
                    <span>{summary.batch_count} {t(lang, 'recordingDatabaseBatches')}</span>
                    <span>{summary.binding_count} {t(lang, 'recordingDatabaseChannels')}</span>
                  </div>
                </button>
              );
            })}
            {sessions.length === 0 && (
              <div className="p-3 text-center text-[11px] text-text-secondary">
                {t(lang, 'recordingDatabaseNoSessions')}
              </div>
            )}
          </div>
        </div>

        <div className="flex min-w-0 flex-1 flex-col">
          {selectedSession != null && (
            <div className="flex min-h-9 flex-wrap items-center gap-2 border-b border-border-subtle px-2 py-1">
              <span className="text-[10px] uppercase tracking-wider text-text-secondary">
                {t(lang, 'recordingDatabaseBindings')}
              </span>
              <select
                value={selectedBindingId ?? ''}
                onChange={(event) => selectBinding(event.target.value || null)}
                className="h-7 min-w-[180px] max-w-[340px] rounded border border-border-subtle bg-bg-input px-1.5 text-[11px] text-text-primary"
              >
                <option value="">{t(lang, 'recordingDatabaseAllBindings')}</option>
                {bindings.map((binding) => (
                  <option key={binding.id} value={binding.id}>
                    {binding.component_id} · {binding.domain}
                  </option>
                ))}
              </select>
              <span className="text-[10px] text-text-secondary">
                {selectedSession.item_count} {t(lang, 'recordingDatabaseSamples')} ·{' '}
                {formatDurationUs(
                  selectedSession.first_timestamp_us != null && selectedSession.last_timestamp_us != null
                    ? selectedSession.last_timestamp_us - selectedSession.first_timestamp_us
                    : null,
                )}
              </span>
            </div>
          )}

          <div className="min-h-0 flex-1 overflow-auto">
            <table className="w-full border-collapse text-left text-[11px]">
              <thead className="sticky top-0 z-10 bg-bg-panel-header text-[10px] uppercase tracking-wider text-text-secondary">
                <tr>
                  <th className="border-b border-border-subtle px-2 py-1.5">{t(lang, 'recordingDatabaseColumnTime')}</th>
                  <th className="border-b border-border-subtle px-2 py-1.5">{t(lang, 'recordingDatabaseColumnBinding')}</th>
                  <th className="border-b border-border-subtle px-2 py-1.5">{t(lang, 'recordingDatabaseColumnDomain')}</th>
                  <th className="border-b border-border-subtle px-2 py-1.5">{t(lang, 'recordingDatabaseColumnSequence')}</th>
                  <th className="border-b border-border-subtle px-2 py-1.5">{t(lang, 'recordingDatabaseColumnItems')}</th>
                  <th className="border-b border-border-subtle px-2 py-1.5">{t(lang, 'recordingDatabaseColumnPayload')}</th>
                </tr>
              </thead>
              <tbody>
                {(currentCache?.rows ?? []).map((row) => (
                  <tr key={row.row_id} className="border-b border-border-subtle/50 hover:bg-bg-hover/50">
                    <td className="whitespace-nowrap px-2 py-1 font-mono text-[10px] text-text-secondary">
                      {formatTimestampUs(row.first_timestamp_us)}
                    </td>
                    <td className="max-w-[180px] truncate px-2 py-1 font-mono text-[10px]" title={row.binding_id}>
                      {row.binding_id}
                    </td>
                    <td className="px-2 py-1">
                      <span className="rounded bg-bg-input px-1.5 py-0.5 text-[10px] text-text-secondary">
                        {row.domain}
                      </span>
                    </td>
                    <td className="px-2 py-1 font-mono text-[10px] text-text-secondary">
                      {row.sequence_start}
                    </td>
                    <td className="px-2 py-1 text-right font-mono text-[10px] text-text-secondary">
                      {row.item_count}
                    </td>
                    <td className="px-2 py-1 font-mono text-[10px] text-text-primary">
                      <span className="line-clamp-1" title={payloadPreview(row, 12)}>
                        {payloadPreview(row)}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {currentCache?.rows.length === 0 && (
              <div className="flex flex-col items-center gap-2 py-10 text-[11px] text-text-secondary">
                <FileText size={18} />
                {t(lang, 'recordingDatabaseNoData')}
              </div>
            )}
            {currentCache == null && selectedSessionId == null && (
              <div className="flex flex-col items-center gap-2 py-10 text-[11px] text-text-secondary">
                <Database size={18} />
                {t(lang, 'recordingDatabaseSelectSession')}
              </div>
            )}
          </div>

          <div className="flex h-9 shrink-0 items-center justify-between border-t border-border-subtle px-2 text-[10px] text-text-secondary">
            <span>
              {currentCache?.rows.length ?? 0} {t(lang, 'recordingDatabaseRows')}
            </span>
            <button
              type="button"
              disabled={loading || currentCache?.nextRowId == null}
              onClick={() => void loadHistory(false)}
              className="inline-flex h-6 items-center rounded border border-border-subtle bg-bg-input px-2 text-[10px] text-text-secondary hover:text-text-bright disabled:opacity-40"
            >
              {loading ? t(lang, 'recordingDatabaseLoading') : t(lang, 'recordingDatabaseLoadMore')}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
});
