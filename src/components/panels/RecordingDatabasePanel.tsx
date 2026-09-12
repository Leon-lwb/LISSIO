import { memo, useEffect, useRef, useState } from 'react';
import { CornerUpLeft, Database, Eraser, ExternalLink, FilePlus2, Pause, Play, RefreshCw, Square, Trash2 } from 'lucide-react';
import { confirm } from '@tauri-apps/plugin-dialog';
import clsx from 'clsx';
import { useAppStore } from '../../store/appStore';
import { useRecordingDatabaseStore } from '../../store/recordingDatabaseStore';
import { openDataPanelAndReveal } from '../../lib/utils/revealDataTab';
import { showContextMenu } from '../../lib/hooks/useContextMenu';
import { t } from '../../i18n';
import type { RecordingSessionSummary } from '../../lib/tauri/tauri';
import type { RunState } from '../../types';
import { formatBytes, formatDurationUs, formatTimestampUs } from '../displays/recording/recordingFormat';

/// 与 RunControls 一致的运行状态配色 + 标签
const RUN_BADGE: Record<RunState, { dot: string; label: string }> = {
  stopped: { dot: 'bg-text-muted', label: 'runStateStopped' },
  running: { dot: 'bg-green', label: 'runStateRunning' },
  paused: { dot: 'bg-yellow', label: 'runStatePaused' },
};

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
  const runState = useAppStore((s) => s.runState);
  const workspaceRun = useAppStore((s) => s.workspaceRun);
  const sessions = useRecordingDatabaseStore((s) => s.sessions);
  const databaseInfo = useRecordingDatabaseStore((s) => s.databaseInfo);
  const selectedSessionId = useRecordingDatabaseStore((s) => s.selectedSessionId);
  const loadOverview = useRecordingDatabaseStore((s) => s.loadOverview);
  const selectSession = useRecordingDatabaseStore((s) => s.selectSession);
  const cleanupSessions = useRecordingDatabaseStore((s) => s.cleanupSessions);
  const createSession = useRecordingDatabaseStore((s) => s.createSession);
  const setActiveSession = useRecordingDatabaseStore((s) => s.setActiveSession);
  const error = useRecordingDatabaseStore((s) => s.error);
  const clearError = useRecordingDatabaseStore((s) => s.clearError);
  const warning = useRecordingDatabaseStore((s) => s.warning);
  const clearWarning = useRecordingDatabaseStore((s) => s.clearWarning);
  // 新建/切换写入目标只在运行暂停时开放:暂停期间管道不喂数据,替换 recorder 无丢批风险
  const paused = runState === 'paused';

  const [keepLatest, setKeepLatest] = useState(10);
  const [busy, setBusy] = useState(false);
  const [hint, setHint] = useState<string | null>(null);
  const hintTimer = useRef<number | null>(null);

  useEffect(() => {
    void loadOverview();
  }, [loadOverview, runState]);

  useEffect(() => () => {
    if (hintTimer.current !== null) window.clearTimeout(hintTimer.current);
  }, []);

  /// 操作被拒时给出短暂提示 — 不能静默无反应
  function showHint(key: string): void {
    setHint(t(lang, key));
    if (hintTimer.current !== null) window.clearTimeout(hintTimer.current);
    hintTimer.current = window.setTimeout(() => setHint(null), 3200);
  }

  async function openSession(sessionId: string): Promise<void> {
    await selectSession(sessionId);
    openDataPanelAndReveal(() => addRecordingDatabaseTab());
  }

  async function handleCreateSession(): Promise<void> {
    setBusy(true);
    try {
      await createSession();
    } catch (createError) {
      console.error('recording session creation failed', createError);
    } finally {
      setBusy(false);
    }
  }

  async function handleSetActiveSession(sessionId: string): Promise<void> {
    setBusy(true);
    try {
      await setActiveSession(sessionId);
    } catch (switchError) {
      console.error('recording session switch failed', switchError);
    } finally {
      setBusy(false);
    }
  }

  /// 点击会话行 = 设为写入目标;不满足条件时用提示说明原因
  function attemptSelect(summary: RecordingSessionSummary): void {
    if (summary.active) {
      showHint('recordingDatabaseHintAlreadyActive');
      return;
    }
    if (!paused) {
      showHint('recordingDatabaseHintNeedsPause');
      return;
    }
    if (summary.session.state !== 'stopped') {
      showHint('recordingDatabaseHintNeedsStopped');
      return;
    }
    void handleSetActiveSession(summary.session.id);
  }

  function requestDelete(summary: RecordingSessionSummary): void {
    if (summary.active) {
      showHint('recordingDatabaseHintDeleteActive');
      return;
    }
    void deleteSession(summary.session.id);
  }

  function openRowMenu(event: React.MouseEvent, summary: RecordingSessionSummary): void {
    event.preventDefault();
    event.stopPropagation();
    showContextMenu(event.clientX, event.clientY, [
      {
        id: 'set-active',
        label: t(lang, 'recordingDatabaseSetActive'),
        icon: <CornerUpLeft size={14} />,
        onClick: () => attemptSelect(summary),
      },
      {
        id: 'open-view',
        label: t(lang, 'recordingDatabaseOpenSession'),
        icon: <ExternalLink size={14} />,
        onClick: () => { void openSession(summary.session.id); },
      },
      { kind: 'separator' },
      {
        id: 'delete',
        label: t(lang, 'recordingDatabaseDelete'),
        icon: <Trash2 size={14} />,
        onClick: () => requestDelete(summary),
      },
    ]);
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
    } catch (cleanupError) {
      console.error('recording cleanup failed', cleanupError);
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
    } catch (cleanupError) {
      console.error('recording cleanup failed', cleanupError);
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
    } catch (cleanupError) {
      console.error('recording cleanup failed', cleanupError);
    } finally {
      setBusy(false);
    }
  }

  const terminalCount = sessions.filter(
    (item) => item.session.state === 'stopped' || item.session.state === 'failed',
  ).length;
  const activeSession = sessions.find((item) => item.active) ?? null;

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
        <div className="mt-1.5 flex items-center gap-1.5">
          <span className={clsx('inline-block h-1.5 w-1.5 rounded-full', RUN_BADGE[runState].dot)} />
          <span className="text-[10px] text-text-secondary">{t(lang, RUN_BADGE[runState].label)}</span>
          <div className="ml-auto flex items-center gap-1">
            <button
              type="button"
              className={clsx(
                'flex h-5 w-5 items-center justify-center rounded transition-colors duration-150',
                runState === 'running'
                  ? 'text-green bg-green/10'
                  : 'text-text-secondary hover:bg-bg-hover hover:text-green',
              )}
              title={t(lang, 'runStartHint')}
              aria-label={t(lang, 'runStartHint')}
              onClick={() => { void workspaceRun('start'); }}
            >
              <Play size={11} />
            </button>
            <button
              type="button"
              className={clsx(
                'flex h-5 w-5 items-center justify-center rounded transition-colors duration-150',
                runState === 'paused'
                  ? 'text-yellow bg-yellow/10'
                  : 'text-text-secondary hover:bg-bg-hover hover:text-yellow',
                runState === 'stopped' && 'pointer-events-none opacity-40',
              )}
              title={t(lang, 'runPauseHint')}
              aria-label={t(lang, 'runPauseHint')}
              disabled={runState === 'stopped'}
              onClick={() => { void workspaceRun('pause'); }}
            >
              <Pause size={11} />
            </button>
            <button
              type="button"
              className={clsx(
                'flex h-5 w-5 items-center justify-center rounded transition-colors duration-150',
                runState === 'stopped'
                  ? 'text-text-secondary opacity-40'
                  : 'text-text-secondary hover:bg-bg-hover hover:text-red',
              )}
              title={t(lang, 'runStopHint')}
              aria-label={t(lang, 'runStopHint')}
              disabled={runState === 'stopped'}
              onClick={() => { void workspaceRun('stop'); }}
            >
              <Square size={10} />
            </button>
          </div>
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
        <div className="mt-1.5 flex items-center gap-1.5 border-t border-border-subtle/60 pt-1.5">
          <span className="shrink-0 text-[10px] text-text-secondary">
            {t(lang, 'recordingDatabaseCurrentTarget')}
          </span>
          <span
            className="min-w-0 flex-1 truncate text-right font-mono text-[10px] text-accent"
            title={activeSession?.session.id ?? undefined}
          >
            {activeSession !== null ? activeSession.session.id : t(lang, 'recordingDatabaseNoActiveTarget')}
          </span>
        </div>
      </div>

      <div className="flex flex-wrap gap-1">
        <button
          type="button"
          disabled={!paused || busy}
          onClick={() => void handleCreateSession()}
          className="inline-flex h-7 items-center gap-1 rounded border border-border-subtle bg-bg-input px-2 text-text-secondary hover:text-text-bright disabled:opacity-40"
          title={paused ? t(lang, 'recordingDatabaseNewSession') : t(lang, 'recordingDatabasePausedOnlyHint')}
        >
          <FilePlus2 size={12} />
          {t(lang, 'recordingDatabaseNewSession')}
        </button>
        <button
          type="button"
          disabled={busy || terminalCount === 0}
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
            disabled={busy || terminalCount === 0 || terminalCount <= Math.max(0, keepLatest)}
            onClick={() => void cleanupKept()}
            className="h-full border-l border-border-subtle px-2 text-text-secondary hover:text-text-bright disabled:opacity-40"
          >
            {t(lang, 'recordingDatabaseCleanupKeep')}
          </button>
        </div>
      </div>

      {warning !== null && (
        <div className="rounded border border-amber-500/30 bg-amber-500/10 px-2 py-1 text-[10px] text-amber-200">
          <div className="flex items-start gap-1">
            <span className="min-w-0 flex-1 break-words">{warning}</span>
            <button
              type="button"
              onClick={clearWarning}
              className="shrink-0 text-amber-100 hover:text-white"
            >
              {t(lang, 'recordingDatabaseDismiss')}
            </button>
          </div>
        </div>
      )}
      {error !== null && (
        <div className="rounded border border-red-500/30 bg-red-500/10 px-2 py-1 text-[10px] text-red-300">
          <div className="flex items-start gap-1">
            <span className="min-w-0 flex-1 break-words">{error}</span>
            <button
              type="button"
              onClick={clearError}
              className="shrink-0 text-red-200 hover:text-white"
            >
              {t(lang, 'recordingDatabaseDismiss')}
            </button>
          </div>
        </div>
      )}
      {hint !== null && (
        <div className="rounded border border-blue-500/30 bg-blue-500/10 px-2 py-1 text-[10px] text-blue-200">
          {hint}
        </div>
      )}
      <div className="min-h-0 flex-1 overflow-y-auto rounded border border-border-subtle">
        {sessions.map((summary) => {
          const active = summary.session.state === 'running' || summary.session.state === 'paused';
          const viewing = summary.session.id === selectedSessionId;
          const duration = summary.first_timestamp_us !== null && summary.last_timestamp_us !== null
            ? summary.last_timestamp_us - summary.first_timestamp_us
            : null;
          return (
            <div
              key={summary.session.id}
              onClick={() => attemptSelect(summary)}
              onContextMenu={(event) => openRowMenu(event, summary)}
              title={t(lang, 'recordingDatabaseRowSelectHint')}
              className={clsx(
                'group cursor-pointer border-b border-border-subtle/50 px-2 py-1.5 last:border-b-0',
                summary.active
                  ? 'border-l-2 border-l-accent bg-accent/10'
                  : viewing
                    ? 'bg-bg-hover'
                    : 'hover:bg-bg-hover/60',
              )}
            >
              <div className="flex items-center gap-1.5">
                <span className={clsx(
                  'rounded px-1 py-0.5 text-[9px] font-semibold uppercase',
                  active ? 'bg-emerald-500/15 text-emerald-300' : 'bg-bg-input text-text-secondary',
                )}>
                  {t(lang, stateLabelKey(summary.session.state))}
                </span>
                {summary.active && (
                  <span className="rounded bg-accent/15 px-1 py-0.5 text-[9px] font-semibold text-accent">
                    {t(lang, 'recordingDatabaseActiveBadge')}
                  </span>
                )}
                <span className="ml-auto font-mono text-[9px] text-text-secondary">
                  {formatBytes(summary.effective_bytes)}
                </span>
                <button
                  type="button"
                  onClick={(event) => {
                    event.stopPropagation();
                    void openSession(summary.session.id);
                  }}
                  className="rounded p-0.5 text-text-secondary hover:bg-bg-hover hover:text-accent"
                  title={t(lang, 'recordingDatabaseOpenSession')}
                >
                  <ExternalLink size={10} />
                </button>
              </div>
              <div className="mt-1 truncate font-mono text-[10px] text-text-primary" title={summary.session.id}>
                {summary.session.id}
              </div>
              <div className="mt-0.5 flex flex-wrap gap-x-2 text-[9px] text-text-secondary">
                <span>{summary.batch_count} {t(lang, 'recordingDatabaseBatches')}</span>
                <span>{summary.binding_count} {t(lang, 'recordingDatabaseChannels')}</span>
                <span>{formatDurationUs(duration)}</span>
              </div>
              <div className="mt-0.5 text-[9px] text-text-secondary">
                {formatTimestampUs(summary.session.started_at_us)}
              </div>
              <div className="mt-1 flex items-center gap-2">
                {!summary.active && summary.session.state === 'stopped' && (
                  <button
                    type="button"
                    disabled={!paused || busy}
                    onClick={(event) => {
                      event.stopPropagation();
                      attemptSelect(summary);
                    }}
                    className="inline-flex items-center gap-1 text-[9px] text-text-secondary hover:text-accent disabled:opacity-30"
                    title={paused ? t(lang, 'recordingDatabaseSetActive') : t(lang, 'recordingDatabasePausedOnlyHint')}
                  >
                    <CornerUpLeft size={10} />
                    {t(lang, 'recordingDatabaseSetActive')}
                  </button>
                )}
                <button
                  type="button"
                  disabled={busy || active}
                  onClick={(event) => {
                    event.stopPropagation();
                    requestDelete(summary);
                  }}
                  className="inline-flex items-center gap-1 text-[9px] text-red-300/80 hover:text-red-200 disabled:opacity-30"
                  title={t(lang, 'recordingDatabaseDelete')}
                >
                  <Trash2 size={10} />
                  {t(lang, 'recordingDatabaseDelete')}
                </button>
              </div>
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
