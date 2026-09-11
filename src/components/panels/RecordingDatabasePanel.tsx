import { memo, useEffect, useState } from 'react';
import { Database, Eraser, ExternalLink, RefreshCw, Trash2 } from 'lucide-react';
import { confirm } from '@tauri-apps/plugin-dialog';
import clsx from 'clsx';
import { useAppStore } from '../../store/appStore';
import { useRecordingDatabaseStore } from '../../store/recordingDatabaseStore';
import { openDataPanelAndReveal } from '../../lib/utils/revealDataTab';
import { t } from '../../i18n';
import { formatBytes, formatDurationUs, formatTimestampUs } from '../displays/recording/recordingFormat';

function stateLabelKey(state: string): string {
  switch (state) {
    case 'running':
      return 'recordingDatabaseStateRunning';
    case 'paused':
      return 'recordingDatabaseStatePaused';
    case 'failed':
      return 'recordingDatabaseStateFailed';
    default:
      return 'recordingDatabaseStateStopped';
  }
}

export const RecordingDatabasePanel = memo(function RecordingDatabasePanel() {
  const lang = useAppStore((s) => s.lang);
  const addRecordingDatabaseTab = useAppStore((s) => s.addRecordingDatabaseTab);
  const sessions = useRecordingDatabaseStore((s) => s.sessions);
  const databaseInfo = useRecordingDatabaseStore((s) => s.databaseInfo);
  const selectedSessionId = useRecordingDatabaseStore((s) => s.selectedSessionId);
  const loadOverview = useRecordingDatabaseStore((s) => s.loadOverview);
  const selectSession = useRecordingDatabaseStore((s) => s.selectSession);
  const cleanupSessions = useRecordingDatabaseStore((s) => s.cleanupSessions);

  const [keepLatest, setKeepLatest] = useState(10);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    void loadOverview();
  }, [loadOverview]);

  async function openSession(sessionId: string): Promise<void> {
    await selectSession(sessionId);
    openDataPanelAndReveal(() => addRecordingDatabaseTab());
  }

  async function cleanupStopped(): Promise<void> {
    const confirmed = await confirm(t(lang, 'recordingDatabaseCleanupStoppedConfirm'), { kind: 'warning' });
    if (confirmed === false) return;
    setBusy(true);
    try {
      await cleanupSessions({
        session_ids: [],
        delete_stopped: true,
        delete_failed: true,
        older_than_us: null,
        keep_latest: null,
      });
    } finally {
      setBusy(false);
    }
  }

  async function cleanupKept(): Promise<void> {
    const confirmed = await confirm(
      t(lang, 'recordingDatabaseCleanupKeepConfirm').replace('{count}', String(keepLatest)),
      { kind: 'warning' },
    );
    if (confirmed === false) return;
    setBusy(true);
    try {
      await cleanupSessions({
        session_ids: [],
        delete_stopped: false,
        delete_failed: false,
        older_than_us: null,
        keep_latest: keepLatest,
      });
    } finally {
      setBusy(false);
    }
  }

  async function deleteSession(sessionId: string): Promise<void> {
    const confirmed = await confirm(t(lang, 'recordingDatabaseDeleteConfirm'), { kind: 'warning' });
    if (confirmed === false) return;
    setBusy(true);
    try {
      await cleanupSessions({
        session_ids: [sessionId],
        delete_stopped: false,
        delete_failed: false,
        older_than_us: null,
        keep_latest: null,
      });
    } finally {
      setBusy(false);
    }
  }

  const runningCount = sessions.filter((item) => item.session.state === 'running' || item.session.state === 'paused').length;

  return (
    <div className="flex h-full flex-col gap-2 overflow-hidden text-[11px]" data-tour="recording-database">
      <div className="rounded border border-border-subtle bg-bg-input p-2">
        <div className="flex items-center gap-1.5 text-text-primary">
          <Database size={13} className="text-accent" />
          <span className="font-semibold">{t(lang, 'recordingDatabaseTitle')}</span>
          <button
            type="button"
            onClick={() => void loadOverview()}
            className="ml-auto rounded p-1 text-text-secondary hover:bg-bg-hover hover:text-text-bright"
            title={t(lang, 'recordingDatabaseRefresh')}
          >
            <RefreshCw size={12} />
          </button>
        </div>
        {databaseInfo !== null && databaseInfo !== undefined && (
          <div className="mt-1.5 grid grid-cols-2 gap-x-2 gap-y-1 font-mono text-[10px] text-text-secondary">
            <span>{t(lang, 'recordingDatabaseSessionCount')}</span>
            <span className="text-right text-text-primary">{databaseInfo.session_count}</span>
            <span>{t(lang, 'recordingDatabaseBatchCount')}</span>
            <span className="text-right text-text-primary">{databaseInfo.batch_count}</span>
            <span>{t(lang, 'recordingDatabaseItemCount')}</span>
            <span className="text-right text-text-primary">{databaseInfo.item_count}</span>
            <span>{t(lang, 'recordingDatabaseFileSize')}</span>
            <span className="text-right text-text-primary">{formatBytes(databaseInfo.file_size_bytes)}</span>
          </div>
        )}
      </div>

      <div className="flex flex-wrap gap-1">
        <button
          type="button"
          disabled={busy || runningCount === sessions.length}
          onClick={() => void cleanupStopped()}
          className="inline-flex h-7 items-center gap-1 rounded border border-border-subtle bg-bg-input px-2 text-text-secondary hover:text-text-bright disabled:opacity-40"
        >
          <Eraser size={12} />
          {t(lang, 'recordingDatabaseCleanupStopped')}
        </button>
        <div className="inline-flex h-7 items-center overflow-hidden rounded border border-border-subtle bg-bg-input">
          <input
            type="number"
            min={0}
            max={10_000}
            value={keepLatest}
            onChange={(event) => setKeepLatest(Number(event.target.value))}
            className="h-full w-14 bg-transparent px-1.5 text-text-primary outline-none"
            title={t(lang, 'recordingDatabaseKeepLatest')}
          />
          <button
            type="button"
            disabled={busy || runningCount === sessions.length}
            onClick={() => void cleanupKept()}
            className="h-full border-l border-border-subtle px-2 text-text-secondary hover:text-text-bright disabled:opacity-40"
          >
            {t(lang, 'recordingDatabaseCleanupKeep')}
          </button>
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto rounded border border-border-subtle">
        {sessions.map((summary) => {
          const active = summary.session.state === 'running' || summary.session.state === 'paused';
          const selected = summary.session.id === selectedSessionId;
          const duration = summary.first_timestamp_us !== null && summary.last_timestamp_us !== null
            ? summary.last_timestamp_us - summary.first_timestamp_us
            : null;
          return (
            <div
              key={summary.session.id}
              className={clsx(
                'group border-b border-border-subtle/50 px-2 py-1.5 last:border-b-0',
                selected ? 'bg-accent/10' : 'hover:bg-bg-hover/60',
              )}
            >
              <div className="flex items-center gap-1.5">
                <span className={clsx(
                  'rounded px-1 py-0.5 text-[9px] font-semibold uppercase',
                  active ? 'bg-emerald-500/15 text-emerald-300' : 'bg-bg-input text-text-secondary',
                )}>
                  {t(lang, stateLabelKey(summary.session.state))}
                </span>
                <span className="ml-auto font-mono text-[9px] text-text-secondary">
                  {formatBytes(summary.effective_bytes)}
                </span>
              </div>
              <button
                type="button"
                onClick={() => void openSession(summary.session.id)}
                className="mt-1 flex w-full items-center gap-1 text-left text-[10px] text-text-primary hover:text-accent"
                title={summary.session.id}
              >
                <ExternalLink size={10} className="shrink-0" />
                <span className="truncate font-mono">{summary.session.id}</span>
              </button>
              <div className="mt-0.5 flex flex-wrap gap-x-2 text-[9px] text-text-secondary">
                <span>{summary.batch_count} {t(lang, 'recordingDatabaseBatches')}</span>
                <span>{summary.binding_count} {t(lang, 'recordingDatabaseChannels')}</span>
                <span>{formatDurationUs(duration)}</span>
              </div>
              <div className="mt-0.5 text-[9px] text-text-secondary">
                {formatTimestampUs(summary.session.started_at_us)}
              </div>
              <button
                type="button"
                disabled={busy || active}
                onClick={() => void deleteSession(summary.session.id)}
                className="mt-1 inline-flex items-center gap-1 text-[9px] text-red-300/80 hover:text-red-200 disabled:opacity-30"
                title={t(lang, 'recordingDatabaseDelete')}
              >
                <Trash2 size={10} />
                {t(lang, 'recordingDatabaseDelete')}
              </button>
            </div>
          );
        })}
        {sessions.length === 0 && (
          <div className="p-4 text-center text-[11px] text-text-secondary">
            {t(lang, 'recordingDatabaseNoSessions')}
          </div>
        )}
      </div>
    </div>
  );
});
