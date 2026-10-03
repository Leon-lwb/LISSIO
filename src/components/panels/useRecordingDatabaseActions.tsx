import { useEffect, useRef, useState } from 'react';
import { CornerUpLeft, ExternalLink, Trash2 } from 'lucide-react';
import { platform } from '../../lib/platform';
import { useAppStore } from '../../store/appStore';
import { useRecordingDatabaseStore } from '../../store/recordingDatabaseStore';
import { openDataPanelAndReveal } from '../../lib/utils/revealDataTab';
import { showContextMenu } from '../../lib/hooks/useContextMenu';
import { translate } from '../../i18n';
import type { RecordingSessionSummary } from '../../lib/tauri/tauri';

interface RecordingDatabaseActionsOptions {
  paused: boolean;
}

export function useRecordingDatabaseActions({ paused }: RecordingDatabaseActionsOptions) {
  const lang = useAppStore((s) => s.lang);
  const addRecordingDatabaseTab = useAppStore((s) => s.addRecordingDatabaseTab);
  const selectSession = useRecordingDatabaseStore((s) => s.selectSession);
  const createSession = useRecordingDatabaseStore((s) => s.createSession);
  const setActiveSession = useRecordingDatabaseStore((s) => s.setActiveSession);
  const cleanupSessions = useRecordingDatabaseStore((s) => s.cleanupSessions);

  const [keepLatest, setKeepLatest] = useState(10);
  const [busy, setBusy] = useState(false);
  const [hint, setHint] = useState<string | null>(null);
  const hintTimer = useRef<number | null>(null);

  useEffect(() => () => {
    if (hintTimer.current !== null) window.clearTimeout(hintTimer.current);
  }, []);

  function showHint(key: string): void {
    setHint(translate(key, lang));
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
    } catch (error) {
      console.error('recording session creation failed', error);
    } finally {
      setBusy(false);
    }
  }

  async function handleSetActiveSession(sessionId: string): Promise<void> {
    setBusy(true);
    try {
      await setActiveSession(sessionId);
    } catch (error) {
      console.error('recording session switch failed', error);
    } finally {
      setBusy(false);
    }
  }

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

  async function deleteSession(sessionId: string): Promise<void> {
    const confirmed = await platform.confirm(translate('recordingDatabaseDeleteConfirm', lang), { kind: 'warning' });
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
    } catch (error) {
      console.error('recording cleanup failed', error);
    } finally {
      setBusy(false);
    }
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
        label: translate('recordingDatabaseSetActive', lang),
        icon: <CornerUpLeft size={14} />,
        onClick: () => attemptSelect(summary),
      },
      {
        id: 'open-view',
        label: translate('recordingDatabaseOpenSession', lang),
        icon: <ExternalLink size={14} />,
        onClick: () => void openSession(summary.session.id),
      },
      { kind: 'separator' },
      {
        id: 'delete',
        label: translate('recordingDatabaseDelete', lang),
        icon: <Trash2 size={14} />,
        onClick: () => requestDelete(summary),
      },
    ]);
  }

  async function cleanupStopped(): Promise<void> {
    const confirmed = await platform.confirm(translate('recordingDatabaseCleanupStoppedConfirm', lang), { kind: 'warning' });
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
    } catch (error) {
      console.error('recording cleanup failed', error);
    } finally {
      setBusy(false);
    }
  }

  async function cleanupKept(): Promise<void> {
    const confirmed = await platform.confirm(
      translate('recordingDatabaseCleanupKeepConfirm', lang).replace('{count}', String(keepLatest)),
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
    } catch (error) {
      console.error('recording cleanup failed', error);
    } finally {
      setBusy(false);
    }
  }

  return {
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
  };
}
