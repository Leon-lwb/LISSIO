import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import {
  api,
  type RecordingBinding,
  type RecordingCleanupPolicy,
  type RecordingCleanupResult,
  type RecordingDatabaseInfo,
  type RecordingHistoryPage,
  type RecordingSessionSummary,
} from '../lib/tauri/tauri';

export const RECORDING_HISTORY_PAGE_SIZE = 200;
const MAX_CACHE_ENTRIES = 24;
const MAX_CACHE_ROWS = 20_000;

export type RecordingHistoryRow = RecordingHistoryPage['rows'][number];

export interface RecordingHistoryCacheEntry {
  key: string;
  sessionId: string;
  bindingId: string | null;
  includePayload: boolean;
  rows: RecordingHistoryRow[];
  nextRowId: number | null;
  lastAccess: number;
}

export function recordingHistoryKey(
  sessionId: string,
  bindingId: string | null,
  includePayload: boolean,
): string {
  return `${sessionId}|${bindingId ?? '*'}${includePayload ? '|payload' : '|meta'}`;
}

function totalCachedRows(entries: RecordingHistoryCacheEntry[]): number {
  return entries.reduce((sum, entry) => sum + entry.rows.length, 0);
}

export function upsertRecordingHistoryCache(
  entries: RecordingHistoryCacheEntry[],
  entry: RecordingHistoryCacheEntry,
): RecordingHistoryCacheEntry[] {
  const next = entries.filter((item) => item.key !== entry.key);
  next.push(entry);
  next.sort((left, right) => left.lastAccess - right.lastAccess);
  while (next.length > MAX_CACHE_ENTRIES || totalCachedRows(next) > MAX_CACHE_ROWS) {
    next.shift();
  }
  return next;
}

export function removeRecordingSessionCache(
  entries: RecordingHistoryCacheEntry[],
  sessionIds: string[],
): RecordingHistoryCacheEntry[] {
  if (sessionIds.length === 0) return entries;
  const removed = new Set(sessionIds);
  return entries.filter((entry) => !removed.has(entry.sessionId));
}

interface RecordingDatabaseState {
  sessions: RecordingSessionSummary[];
  databaseInfo: RecordingDatabaseInfo | null;
  selectedSessionId: string | null;
  selectedBindingId: string | null;
  bindings: RecordingBinding[];
  includePayload: boolean;
  history: RecordingHistoryCacheEntry[];
  loading: boolean;
  error: string | null;
  loadOverview: () => Promise<void>;
  selectSession: (sessionId: string, bindingId?: string | null) => Promise<void>;
  selectBinding: (bindingId: string | null) => void;
  setIncludePayload: (includePayload: boolean) => void;
  loadHistory: (reset?: boolean) => Promise<void>;
  cleanupSessions: (policy: RecordingCleanupPolicy) => Promise<RecordingCleanupResult>;
  clearError: () => void;
}

export const useRecordingDatabaseStore = create<RecordingDatabaseState>()(
  persist(
    (set, get) => ({
      sessions: [],
      databaseInfo: null,
      selectedSessionId: null,
      selectedBindingId: null,
      bindings: [],
      includePayload: true,
      history: [],
      loading: false,
      error: null,

      loadOverview: async () => {
        try {
          const [sessions, databaseInfo] = await Promise.all([
            api.listRecordingSessionSummaries(),
            api.getRecordingDatabaseInfo(),
          ]);
          set({ sessions, databaseInfo, error: null });
          const current = get().selectedSessionId;
          const selected = current && sessions.some((item) => item.session.id === current)
            ? current
            : sessions[0]?.session.id ?? null;
          if (selected) {
            await get().selectSession(selected, get().selectedBindingId);
          } else {
            set({ selectedSessionId: null, selectedBindingId: null, bindings: [], history: [] });
          }
        } catch (error) {
          set({ error: String(error) });
        }
      },

      selectSession: async (sessionId, bindingId = null) => {
        try {
          set({
            selectedSessionId: sessionId,
            selectedBindingId: bindingId,
            bindings: [],
            loading: true,
            error: null,
          });
          const bindings = await api.listRecordingBindings(sessionId);
          const nextBinding = bindingId && bindings.some((binding) => binding.id === bindingId)
            ? bindingId
            : bindings[0]?.id ?? null;
          set({ bindings, selectedBindingId: nextBinding, loading: false });
          await get().loadHistory(true);
        } catch (error) {
          set({ error: String(error), loading: false });
        }
      },

      selectBinding: (bindingId) => {
        set({ selectedBindingId: bindingId });
        void get().loadHistory(true);
      },

      setIncludePayload: (includePayload) => {
        set({ includePayload });
        void get().loadHistory(true);
      },

      loadHistory: async (reset = false) => {
        const { selectedSessionId, selectedBindingId, includePayload } = get();
        if (!selectedSessionId) return;
        const key = recordingHistoryKey(selectedSessionId, selectedBindingId, includePayload);
        const cached = get().history.find((entry) => entry.key === key);
        if (!reset && !cached) return;
        if (!reset && cached?.nextRowId === null) return;
        const afterRowId = reset ? 0 : cached?.nextRowId ?? 0;
        set({ loading: true });
        try {
          const page = await api.queryRecordingHistory(
            selectedSessionId,
            selectedBindingId,
            afterRowId,
            RECORDING_HISTORY_PAGE_SIZE,
            includePayload,
          );
          const rows = reset || !cached ? page.rows : [...cached.rows, ...page.rows];
          const entry: RecordingHistoryCacheEntry = {
            key,
            sessionId: selectedSessionId,
            bindingId: selectedBindingId,
            includePayload,
            rows,
            nextRowId: page.next_row_id,
            lastAccess: Date.now(),
          };
          set((state) => ({
            history: upsertRecordingHistoryCache(state.history, entry),
            loading: false,
            error: null,
          }));
        } catch (error) {
          set({ error: String(error), loading: false });
        }
      },

      cleanupSessions: async (policy) => {
        try {
          const result = await api.cleanupRecordingSessions(policy);
          set({
            history: [],
            selectedSessionId: null,
            selectedBindingId: null,
            bindings: [],
            error: null,
          });
          await get().loadOverview();
          return result;
        } catch (error) {
          set({ error: String(error) });
          throw error;
        }
      },

      clearError: () => set({ error: null }),
    }),
    {
      name: 'lissio-recording-database',
      storage: createJSONStorage(() => localStorage),
      partialize: (state) => ({
        selectedSessionId: state.selectedSessionId,
        selectedBindingId: state.selectedBindingId,
        includePayload: state.includePayload,
      }),
    },
  ),
);
