import { memo, useEffect, useState } from 'react';
import { Pause, Play, Square } from 'lucide-react';
import clsx from 'clsx';
import { useAppStore } from '../../store/appStore';
import { api } from '../../lib/tauri/tauri';
import { t } from '../../i18n';
import type { RunState } from '../../types';

/// 运行状态徽标配色 + 标签
const STATE_BADGE: Record<RunState, { dot: string; label: string; title: string }> = {
  stopped: { dot: 'bg-text-muted', label: 'runStateStopped', title: 'runStartHint' },
  running: { dot: 'bg-green', label: 'runStateRunning', title: 'runPauseHint' },
  paused: { dot: 'bg-yellow', label: 'runStatePaused', title: 'runStartHint' },
};

/// 工作区运行控制 — 启动/暂停/停止 (状态权威在 Rust, 本组件仅触发与镜像)
///
/// 数据链在运行与暂停态都工作: 暂停保持设备连接, 数据继续写入缓存与录制,
/// 只停自动发送与设备写; 停止则丢弃在途数据并冻结现有缓存。
/// 暂停期间录制仍在落库, 因此在按钮旁给出「录制中」指示 (数据库不可用时不显示)。
export const RunControls = memo(function RunControls() {
  const lang = useAppStore((s) => s.lang);
  const runState = useAppStore((s) => s.runState);
  const workspaceRun = useAppStore((s) => s.workspaceRun);
  // 暂停期间是否真的在落库 — 只有 recorder 健康时才指示「录制中」
  const [recordingActive, setRecordingActive] = useState(false);

  useEffect(() => {
    if (runState !== 'paused') {
      setRecordingActive(false);
      return;
    }
    let cancelled = false;
    void api
      .getRecordingHealth()
      .then((health) => {
        if (!cancelled) setRecordingActive(health.failed === null);
      })
      .catch(() => {
        if (!cancelled) setRecordingActive(false);
      });
    return () => {
      cancelled = true;
    };
  }, [runState]);

  const badge = STATE_BADGE[runState];

  return (
    <div className="flex items-center gap-1 h-full shrink-0" data-testid="run-controls">
      <span className={clsx('w-2 h-2 rounded-full inline-block', badge.dot)} />
      <span className="whitespace-nowrap mr-0.5">{t(lang, badge.label)}</span>
      <button
        className={clsx(
          'w-5 h-5 flex items-center justify-center rounded transition-colors duration-150',
          runState === 'running'
            ? 'text-green bg-green/10'
            : 'text-text-secondary hover:bg-bg-hover hover:text-green'
        )}
        title={t(lang, 'runStartHint')}
        aria-label={t(lang, 'runStartHint')}
        onClick={() => { void workspaceRun('start'); }}
      >
        <Play size={11} />
      </button>
      <button
        className={clsx(
          'w-5 h-5 flex items-center justify-center rounded transition-colors duration-150',
          runState === 'paused'
            ? 'text-yellow bg-yellow/10'
            : 'text-text-secondary hover:bg-bg-hover hover:text-yellow',
          runState === 'stopped' && 'opacity-40 hover:opacity-40 hover:text-text-secondary'
        )}
        title={t(lang, 'runPauseHint')}
        aria-label={t(lang, 'runPauseHint')}
        disabled={runState === 'stopped'}
        onClick={() => { void workspaceRun('pause'); }}
      >
        <Pause size={11} />
      </button>
      <button
        className={clsx(
          'w-5 h-5 flex items-center justify-center rounded transition-colors duration-150',
          runState === 'stopped'
            ? 'text-text-secondary opacity-40 hover:opacity-40 hover:text-text-secondary'
            : 'text-text-secondary hover:bg-bg-hover hover:text-red'
        )}
        title={t(lang, 'runStopHint')}
        aria-label={t(lang, 'runStopHint')}
        disabled={runState === 'stopped'}
        onClick={() => { void workspaceRun('stop'); }}
      >
        <Square size={10} />
      </button>
      {recordingActive && (
        <span
          className="flex items-center gap-1 ml-1 whitespace-nowrap text-[10px] text-red"
          data-testid="run-recording-active"
          title={t(lang, 'runRecordingActiveHint')}
        >
          <span className="w-1.5 h-1.5 rounded-full bg-red inline-block" />
          {t(lang, 'runRecordingActive')}
        </span>
      )}
    </div>
  );
});
