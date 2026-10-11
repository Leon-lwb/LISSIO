import { memo, useEffect } from 'react';
import { CornerUpLeft, Database, Eraser, ExternalLink, FilePlus2, Pause, Play, RefreshCw, Square, Trash2 } from 'lucide-react';
import clsx from 'clsx';
import { useAppStore } from '../../store/appStore';
import { useSettingsStore } from '../../store/settingsStore';
import { useRecordingDatabaseStore } from '../../store/recordingDatabaseStore';
import { translate } from '../../i18n';
import type { RunState } from '../../types';
import { RecordingDisabledNotice } from '../displays/recording/RecordingDisabledNotice';
import { formatDurationUs, formatTimestampUs } from '../displays/recording/recordingFormat';
import { formatBytes } from '../../lib/utils/format';
import { useRecordingDatabaseActions } from './useRecordingDatabaseActions';

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
  const runState = useAppStore((s) => s.runState);
  const workspaceRun = useAppStore((s) => s.workspaceRun);
  // 数据库总开关 (设置项): 关闭时入口保留但写操作禁用, 并说明原因
  const recordingEnabled = useSettingsStore((s) => s.settings.data.recordingEnabled);
  const healthWarning = useRecordingDatabaseStore((s) => s.healthWarning);
  const clearHealthWarning = useRecordingDatabaseStore((s) => s.clearHealthWarning);
  const sessions = useRecordingDatabaseStore((s) => s.sessions);
  const databaseInfo = useRecordingDatabaseStore((s) => s.databaseInfo);
  const selectedSessionId = useRecordingDatabaseStore((s) => s.selectedSessionId);
  const loadOverview = useRecordingDatabaseStore((s) => s.loadOverview);
  const error = useRecordingDatabaseStore((s) => s.error);
  const clearError = useRecordingDatabaseStore((s) => s.clearError);
  const warning = useRecordingDatabaseStore((s) => s.warning);
  const clearWarning = useRecordingDatabaseStore((s) => s.clearWarning);
  // 新建/切换写入目标只在运行暂停时开放:暂停期间管道不喂数据,替换 recorder 无丢批风险
  const paused = runState === 'paused';

  const {
    keepLatest,
    setKeepLatest,
    busy,
    hint,
    handleCreateSession,
    openSession,
    attemptSelect,
    requestDelete,
    openRowMenu,
    cleanupStopped,
    cleanupKept,
  } = useRecordingDatabaseActions({ paused });

  useEffect(() => {
    // 总开关关闭时后端不建任何连接, 查询必然失败 — 这里只显示「已关闭」说明,
    // 不再去撞一条读不出来的错误。
    if (!recordingEnabled) return;
    void loadOverview();
  }, [loadOverview, recordingEnabled, runState]);


  const terminalCount = sessions.filter(
    (item) => item.session.state === 'stopped' || item.session.state === 'failed',
  ).length;
  const activeSession = sessions.find((item) => item.active) ?? null;

  return (
    <div className="flex h-full flex-col gap-2 overflow-hidden text-[11px]" data-tour="recording-database">
      <div className="rounded border border-border-subtle bg-bg-input p-2">
        <div className="flex items-center gap-1.5 text-text-primary">
          <Database size={13} className="text-accent" />
          <span className="font-semibold">{translate('recordingDatabaseTitle', lang)}</span>
          <button
            type="button"
            onClick={() => void loadOverview()}
            className="ml-auto rounded p-1 text-text-secondary hover:bg-bg-hover hover:text-text-bright"
            title={translate('recordingDatabaseRefresh', lang)}
          >
            <RefreshCw size={12} />
          </button>
        </div>
        <div className="mt-1.5 flex items-center gap-1.5">
          <span className={clsx('inline-block h-1.5 w-1.5 rounded-full', RUN_BADGE[runState].dot)} />
          <span className="text-[10px] text-text-secondary">{translate(RUN_BADGE[runState].label, lang)}</span>
          <div className="ml-auto flex items-center gap-1">
            <button
              type="button"
              className={clsx(
                'flex h-5 w-5 items-center justify-center rounded transition-colors',
                runState === 'running'
                  ? 'text-green bg-green/10'
                  : 'text-text-secondary hover:bg-bg-hover hover:text-green',
              )}
              title={translate('runStartHint', lang)}
              aria-label={translate('runStartHint', lang)}
              onClick={() => { void workspaceRun('start'); }}
            >
              <Play size={11} />
            </button>
            <button
              type="button"
              className={clsx(
                'flex h-5 w-5 items-center justify-center rounded transition-colors',
                runState === 'paused'
                  ? 'text-yellow bg-yellow/10'
                  : 'text-text-secondary hover:bg-bg-hover hover:text-yellow',
                runState === 'stopped' && 'pointer-events-none opacity-subtle',
              )}
              title={translate('runPauseHint', lang)}
              aria-label={translate('runPauseHint', lang)}
              disabled={runState === 'stopped'}
              onClick={() => { void workspaceRun('pause'); }}
            >
              <Pause size={11} />
            </button>
            <button
              type="button"
              className={clsx(
                'flex h-5 w-5 items-center justify-center rounded transition-colors',
                runState === 'stopped'
                  ? 'text-text-secondary opacity-subtle'
                  : 'text-text-secondary hover:bg-bg-hover hover:text-red',
              )}
              title={translate('runStopHint', lang)}
              aria-label={translate('runStopHint', lang)}
              disabled={runState === 'stopped'}
              onClick={() => { void workspaceRun('stop'); }}
            >
              <Square size={10} />
            </button>
          </div>
        </div>
        {databaseInfo !== null && databaseInfo !== undefined && (
          <div className="mt-1.5 grid grid-cols-2 gap-x-2 gap-y-1 font-mono text-[10px] text-text-secondary">
            <span>{translate('recordingDatabaseSessionCount', lang)}</span>
            <span className="text-right text-text-primary">{databaseInfo.session_count}</span>
            <span>{translate('recordingDatabaseBatchCount', lang)}</span>
            <span className="text-right text-text-primary">{databaseInfo.batch_count}</span>
            <span>{translate('recordingDatabaseItemCount', lang)}</span>
            <span className="text-right text-text-primary">{databaseInfo.item_count}</span>
            <span>{translate('recordingDatabaseFileSize', lang)}</span>
            <span className="text-right text-text-primary">{formatBytes(databaseInfo.file_size_bytes)}</span>
          </div>
        )}
        <div className="mt-1.5 flex items-center gap-1.5 border-t border-border-subtle/60 pt-1.5">
          <span className="shrink-0 text-[10px] text-text-secondary">
            {translate('recordingDatabaseCurrentTarget', lang)}
          </span>
          <span
            className="min-w-0 flex-1 truncate text-right font-mono text-[10px] text-accent"
            title={activeSession?.session.id ?? undefined}
          >
            {activeSession !== null ? activeSession.session.id : translate('recordingDatabaseNoActiveTarget', lang)}
          </span>
        </div>
      </div>

      <div className="flex flex-wrap gap-1">
        <button
          type="button"
          disabled={!recordingEnabled || !paused || busy}
          onClick={() => void handleCreateSession()}
          className="inline-flex h-7 items-center gap-1 rounded border border-border-subtle bg-bg-input px-2 text-text-secondary hover:text-text-bright disabled:opacity-disabled"
          title={paused ? translate('recordingDatabaseNewSession', lang) : translate('recordingDatabasePausedOnlyHint', lang)}
        >
          <FilePlus2 size={12} />
          {translate('recordingDatabaseNewSession', lang)}
        </button>
        <button
          type="button"
          disabled={!recordingEnabled || busy || terminalCount === 0}
          onClick={() => void cleanupStopped()}
          className="inline-flex h-7 items-center gap-1 rounded border border-border-subtle bg-bg-input px-2 text-text-secondary hover:text-text-bright disabled:opacity-disabled"
        >
          <Eraser size={12} />
          {translate('recordingDatabaseCleanupStopped', lang)}
        </button>
        <div className="inline-flex h-7 items-center overflow-hidden rounded border border-border-subtle bg-bg-input">
          <input
            type="number"
            min={0}
            max={10_000}
            value={keepLatest}
            onChange={(event) => setKeepLatest(Number(event.target.value))}
            className="h-full w-14 bg-transparent px-1.5 text-text-primary outline-none"
            title={translate('recordingDatabaseKeepLatest', lang)}
          />
          <button
            type="button"
            disabled={
              !recordingEnabled ||
              busy ||
              terminalCount === 0 ||
              terminalCount <= Math.max(0, keepLatest)
            }
            onClick={() => void cleanupKept()}
            className="h-full border-l border-border-subtle px-2 text-text-secondary hover:text-text-bright disabled:opacity-disabled"
          >
            {translate('recordingDatabaseCleanupKeep', lang)}
          </button>
        </div>
      </div>

      {!recordingEnabled && <RecordingDisabledNotice />}

      {warning === null && healthWarning !== null && (
        <div
          className="state-warning px-2 py-1 text-[10px]"
          data-testid="recording-recovered-notice"
          title={healthWarning}
        >
          <div className="flex items-start gap-1">
            <span className="min-w-0 flex-1 break-words">
              {translate('recordingDatabaseRecovered', lang)}
            </span>
            <button
              type="button"
              onClick={clearHealthWarning}
              className="shrink-0 text-text-warning-strong hover:text-text-inverse"
            >
              {translate('recordingDatabaseDismiss', lang)}
            </button>
          </div>
        </div>
      )}

      {warning !== null && (
        <div className="state-warning px-2 py-1 text-[10px]">
          <div className="flex items-start gap-1">
            <span className="min-w-0 flex-1 break-words">{warning}</span>
            <button
              type="button"
              onClick={clearWarning}
              className="shrink-0 text-text-warning-strong hover:text-text-inverse"
            >
              {translate('recordingDatabaseDismiss', lang)}
            </button>
          </div>
        </div>
      )}
      {error !== null && (
        <div className="state-danger px-2 py-1 text-[10px]">
          <div className="flex items-start gap-1">
            <span className="min-w-0 flex-1 break-words">{error}</span>
            <button
              type="button"
              onClick={clearError}
              className="shrink-0 text-text-danger-strong hover:text-text-inverse"
            >
              {translate('recordingDatabaseDismiss', lang)}
            </button>
          </div>
        </div>
      )}
      {hint !== null && (
        <div className="state-info px-2 py-1 text-[10px]">
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
              role="button"
              tabIndex={0}
              onClick={() => attemptSelect(summary)}
              onKeyDown={(event) => {
                if (event.key !== 'Enter' && event.key !== ' ') return;
                event.preventDefault();
                attemptSelect(summary);
              }}
              onContextMenu={(event) => openRowMenu(event, summary)}
              title={translate('recordingDatabaseRowSelectHint', lang)}
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
                  active ? 'bg-success/15 text-text-success' : 'bg-bg-input text-text-secondary',
                )}>
                  {translate(stateLabelKey(summary.session.state), lang)}
                </span>
                {summary.active && (
                  <span className="rounded bg-accent/15 px-1 py-0.5 text-[9px] font-semibold text-accent">
                    {translate('recordingDatabaseActiveBadge', lang)}
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
                  title={translate('recordingDatabaseOpenSession', lang)}
                >
                  <ExternalLink size={10} />
                </button>
              </div>
              <div className="mt-1 truncate font-mono text-[10px] text-text-primary" title={summary.session.id}>
                {summary.session.id}
              </div>
              <div className="mt-0.5 flex flex-wrap gap-x-2 text-[9px] text-text-secondary">
                <span>{summary.batch_count} {translate('recordingDatabaseBatches', lang)}</span>
                <span>{summary.binding_count} {translate('recordingDatabaseChannels', lang)}</span>
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
                    className="inline-flex items-center gap-1 text-[9px] text-text-secondary hover:text-accent disabled:opacity-disabled"
                    title={paused ? translate('recordingDatabaseSetActive', lang) : translate('recordingDatabasePausedOnlyHint', lang)}
                  >
                    <CornerUpLeft size={10} />
                    {translate('recordingDatabaseSetActive', lang)}
                  </button>
                )}
                <button
                  type="button"
                  disabled={busy || active}
                  onClick={(event) => {
                    event.stopPropagation();
                    requestDelete(summary);
                  }}
                  className="inline-flex items-center gap-1 text-[9px] text-text-danger hover:text-text-danger-strong disabled:opacity-disabled"
                  title={translate('recordingDatabaseDelete', lang)}
                >
                  <Trash2 size={10} />
                  {translate('recordingDatabaseDelete', lang)}
                </button>
              </div>
            </div>
          );
        })}
        {sessions.length === 0 && (
          <div className="p-4 text-center text-[11px] text-text-secondary">
            {translate('recordingDatabaseNoSessions', lang)}
          </div>
        )}
      </div>
    </div>
  );
});
