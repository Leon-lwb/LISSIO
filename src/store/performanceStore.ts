import { create } from 'zustand';
import type { BackendPerformanceSnapshot } from '../types/generated/BackendPerformanceSnapshot';
import type { FrontendPerformanceSnapshot } from '../types';

const HISTORY_LIMIT = 300;

export interface PerformanceStore {
  frontend: FrontendPerformanceSnapshot | null;
  backend: BackendPerformanceSnapshot | null;
  frontendHistory: FrontendPerformanceSnapshot[];
  backendHistory: BackendPerformanceSnapshot[];
  paused: boolean;
  error: string | null;
  setPaused: (paused: boolean) => void;
  pushFrontend: (sample: FrontendPerformanceSnapshot) => void;
  pushBackend: (sample: BackendPerformanceSnapshot) => void;
  setError: (error: string | null) => void;
  clearHistory: () => void;
}

function bounded<T>(items: T[], item: T): T[] {
  const next = [...items, item];
  return next.length > HISTORY_LIMIT ? next.slice(next.length - HISTORY_LIMIT) : next;
}

export const usePerformanceStore = create<PerformanceStore>((set) => ({
  frontend: null,
  backend: null,
  frontendHistory: [],
  backendHistory: [],
  paused: false,
  error: null,
  setPaused: (paused) => set({ paused }),
  pushFrontend: (sample) =>
    set((state) => ({
      frontend: sample,
      frontendHistory: bounded(state.frontendHistory, sample),
    })),
  pushBackend: (sample) =>
    set((state) => ({
      backend: sample,
      backendHistory: bounded(state.backendHistory, sample),
    })),
  setError: (error) => set({ error }),
  clearHistory: () => set({ frontendHistory: [], backendHistory: [] }),
}));
