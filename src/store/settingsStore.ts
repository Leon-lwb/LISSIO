//! Settings load and acknowledged persistence through the shared backend.
//! Failed reads never authorize writing defaults; critical onboarding choices save immediately.

import { create } from 'zustand';
import { platform, type PlatformStore } from '../lib/platform';
import type { AppSettings } from '../settings/defaults';
import {
  DEFAULT_SETTINGS,
  deepMergeSettings,
} from '../settings/defaults';
import { migrateLegacyFontDefaults } from '../settings/fontDefaults';
import {
  DEFAULT_CONFIG_GUIDE_SOURCES,
  readConfigGuideSources,
  type ConfigGuideSources,
} from '../settings/configGuideSources';
import { applyAppearance } from '../settings/applyTheme';
import { api, type PipelineConfig, type RecordingCleanupPolicy } from '../lib/tauri/tauri';
import { setRawDataPreviewCapacity } from '../lib/buffers/rawDataPreviewRegistry';
import { canFrameBuffer } from '../lib/buffers/canBuffer';
import { logicSampleBuffer } from '../lib/buffers/logicBuffer';
import { transitionStore } from '../lib/utils/transitionStore';
import { useAppStore } from './appStore';
import { translate, type Lang } from '../i18n';
import { notify, formatError } from '../lib/tauri/notifications';

export { migrateLegacyFontDefaults } from '../settings/fontDefaults';

const STORE_FILE = 'settings.json';
const STORE_KEY = 'app';

/// The client resolves the currently authenticated connection on every access.
let storeInstance: PlatformStore | null = null;
function getStore(): PlatformStore {
  storeInstance ??= platform.createStore(STORE_FILE);
  return storeInstance;
}

/// 防抖保存计时器
let saveTimer: ReturnType<typeof setTimeout> | null = null;
let loadSequence = 0;
let changeRevision = 0;
let nextSaveId = 0;
let pendingSave: { id: number; revision: number; promise: Promise<boolean> } | null = null;
let loadNotice: string | null = null;
let saveNotice: string | null = null;

function scheduleSave(immediate = false): void {
  changeRevision += 1;
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = null;
  const state = useSettingsStore.getState();
  if (!state.loaded || state.loadError !== null) return;
  if (immediate) void state.save();
  else saveTimer = setTimeout(() => { void useSettingsStore.getState().save(); }, 300);
}

/// API key 不入 settings.json，也不从后端读回。该字段仅作为覆盖写入控件的
/// 临时输入；对话请求由后端 SecretStore 注入有效密钥。
function sanitizeForPersist(settings: AppSettings): AppSettings {
  const ai = { ...settings.ai } as AppSettings['ai'] & { systemPrompt?: string };
  delete ai.systemPrompt;
  return { ...settings, ai: { ...ai, apiKey: '' } };
}

type KeychainPermissionRetryError = 'denied' | 'failed' | null;

function isKeychainAccessDenied(error: unknown): boolean {
  return Boolean(
    error &&
      typeof error === 'object' &&
      'kind' in error &&
      (error as { kind?: unknown }).kind === 'AiKeyringAccessDenied'
  );
}

interface HydrateApiKeyResult {
  settings: AppSettings;
  accessDenied: boolean;
}

/// 启动水合: 只读取密钥状态。
/// 保留结构化的授权拒绝信号,供主窗口按启动顺序显示说明。
async function hydrateApiKey(settings: AppSettings): Promise<HydrateApiKeyResult> {
  try {
    await api.aiSecretStatus(settings.ai.adapter);
    return {
      settings: { ...settings, ai: { ...settings.ai, apiKey: '' } },
      accessDenied: false,
    };
  } catch (error) {
    console.warn('[settings] 钥匙串读取失败, API key 不可用:', error);
    return {
      settings: { ...settings, ai: { ...settings.ai, apiKey: '' } },
      accessDenied: isKeychainAccessDenied(error),
    };
  }
}

interface SettingsStore {
  settings: AppSettings;
  isOpen: boolean;
  isAboutOpen: boolean;
  activeCategory: keyof AppSettings;
  searchQuery: string;
  /// 配置引导的取值来源与文档存在性 (基于最近一次读取的持久化文档判定,
  /// 见 settings/configGuideSources)。
  configGuideSources: ConfigGuideSources;
  /// Initialization has settled, including failure, so the main window can open.
  loaded: boolean;
  loadError: string | null;
  saveError: string | null;
  saving: boolean;
  keychainPermissionPromptOpen: boolean;
  keychainPermissionRetrying: boolean;
  keychainPermissionRetryError: KeychainPermissionRetryError;

  open: (category?: keyof AppSettings) => void;
  close: () => void;
  openAbout: () => void;
  closeAbout: () => void;
  dismissKeychainPermissionPrompt: (dontRemind: boolean) => void;
  retryKeychainPermission: () => Promise<void>;
  setActiveCategory: (c: keyof AppSettings) => void;
  setSearchQuery: (q: string) => void;

  load: () => Promise<void>;
  save: () => Promise<boolean>;
  update: <K extends keyof AppSettings>(
    category: K,
    field: keyof AppSettings[K],
    value: AppSettings[K][keyof AppSettings[K]]
  ) => void;
  reset: () => void;
  resetCategory: (category: keyof AppSettings) => void;
}

/// 将 data 分类的缓存容量设置同步到后端与前端 buffer 实例
/// v3: 波形/原始数据容量按源 (节点) 生效 — 对当前图中全部 Protocol/设备节点应用;
/// 新建节点时由 capacitySync.applyCapacitiesForNode 单独补齐
function applyDataCapacity(settings: AppSettings) {
  const data = settings.data;
  const nodes = useAppStore.getState().rfNodes;
  for (const n of nodes) {
    if (n.type === 'protocol') {
      api.setWaveformBufferCapacity(n.id, data.waveformBufferPoints).catch((e: unknown) =>
        console.warn('[settings] 设置波形缓冲区容量失败:', e)
      );
    } else if (n.type === 'acquisition') {
      api.setRawDataBufferCapacity(n.id, data.rawDataBufferBytes).catch((e: unknown) =>
        console.warn('[settings] 设置原始数据缓冲区容量失败:', e)
      );
    }
  }
  api.setCanBufferCapacity(data.canBufferFrames).catch((e: unknown) =>
    console.warn('[settings] 设置 CAN 缓冲区容量失败:', e)
  );
  api.setLogicBufferCapacity(data.logicBufferSamples).catch((e: unknown) =>
    console.warn('[settings] 设置逻辑缓冲区容量失败:', e)
  );

  // 前端 buffer 实例同步容量 (后端容量调整不自动影响前端缓存)
  setRawDataPreviewCapacity(data.rawDataBufferBytes);
  canFrameBuffer.setCapacity(data.canBufferFrames);
  logicSampleBuffer.setCapacity(data.logicBufferSamples);
}

/// 将 performance 分类映射为后端 PipelineConfig (camelCase -> snake_case)
export function toPipelineConfig(p: AppSettings['performance']): PipelineConfig {
  return {
    mode: p.mode,
    max_workers: p.maxWorkers,
    eval_workers: p.evalWorkers,
    memory_budget_mb: p.memoryBudgetMb,
    preview_fps_limit: p.previewFpsLimit,
    preview_bandwidth_mb_per_sec: p.previewBandwidthMbPerSec,
  };
}

/// 推送管道性能配置到后端 — 后端不持久化, 失败静默 log (后端未就绪场景)
function applyPipelineConfig(settings: AppSettings) {
  api.setPipelineConfig(toPipelineConfig(settings.performance)).catch((e: unknown) =>
    console.warn('[settings] 推送管道性能配置失败:', e)
  );
}

/// data 分类的录制清理设置 → 后端 RecordingCleanupPolicy;
/// 天数转为 "结束时间早于 now-N 天" 的微秒截止线, 0 = 规则关闭
export function toCleanupPolicy(d: AppSettings['data']): RecordingCleanupPolicy {
  const days = Math.max(0, Math.floor(d.cleanupOlderThanDays));
  const keep = Math.max(0, Math.floor(d.cleanupKeepLatest));
  return {
    session_ids: [],
    delete_stopped: d.cleanupDeleteStopped,
    delete_failed: d.cleanupDeleteFailed,
    older_than_us: days > 0 ? (Date.now() - days * 86_400_000) * 1000 : null,
    keep_latest: keep > 0 ? keep : null,
  };
}

/// 推送录制存储设置到后端并执行一次自动清理 — 启动回放与设置变更共用。
/// 总开关 (`recordingEnabled`) 任意运行态都可热更新; 改数据库目录在运行中被
/// 后端拒绝 (下次暂停/启动生效); 清理只作用于终态会话 (当前活跃会话始终保留)。
async function runRecordingApply(settings: AppSettings) {
  const data = settings.data;
  try {
    await api.applyRecordingSettings(
      data.recordingDatabaseDir,
      data.continueEmptySession,
      data.recordingEnabled
    );
  } catch (e: unknown) {
    console.warn('[settings] 应用录制存储设置失败:', e);
  }
  // 总开关关闭时没有连接可用, 清理必然失败且没有意义
  if (!data.recordingEnabled) return;
  const policy = toCleanupPolicy(data);
  const enabled =
    policy.delete_stopped ||
    policy.delete_failed ||
    policy.older_than_us !== null ||
    policy.keep_latest !== null;
  if (!enabled) return;
  try {
    await api.cleanupRecordingSessions(policy);
  } catch (e: unknown) {
    console.warn('[settings] 录制会话自动清理失败:', e);
  }
}

/// 录制设置副作用防抖 — 数字输入连发编辑 (天数 3 → 30) 只触发一次清理
let recordingApplyTimer: ReturnType<typeof setTimeout> | null = null;
function scheduleRecordingApply(settings: AppSettings) {
  if (recordingApplyTimer) clearTimeout(recordingApplyTimer);
  recordingApplyTimer = setTimeout(() => {
    recordingApplyTimer = null;
    void runRecordingApply(settings);
  }, 800);
}

export const useSettingsStore = create<SettingsStore>((set, get) => ({
  settings: DEFAULT_SETTINGS,
  isOpen: false,
  isAboutOpen: false,
  activeCategory: 'general',
  searchQuery: '',
  configGuideSources: DEFAULT_CONFIG_GUIDE_SOURCES,
  loaded: false,
  loadError: null,
  saveError: null,
  saving: false,
  keychainPermissionPromptOpen: false,
  keychainPermissionRetrying: false,
  keychainPermissionRetryError: null,

  open: (category) =>
    set({
      isOpen: true,
      activeCategory: category ?? get().activeCategory,
      searchQuery: '',
    }),
  close: () => set({ isOpen: false }),
  openAbout: () => set({ isAboutOpen: true }),
  closeAbout: () => set({ isAboutOpen: false }),
  dismissKeychainPermissionPrompt: (dontRemind) => {
    if (dontRemind) {
      get().update('general', 'suppressKeychainPermissionReminder', true);
    }
    set({
      keychainPermissionPromptOpen: false,
      keychainPermissionRetrying: false,
      keychainPermissionRetryError: null,
    });
  },
  retryKeychainPermission: async () => {
    if (get().keychainPermissionRetrying) return;
    set({ keychainPermissionRetrying: true, keychainPermissionRetryError: null });
    try {
      const adapter = get().settings.ai.adapter;
      await api.aiSecretStatus(adapter);
      set((state) => ({
        settings: {
          ...state.settings,
          ai: { ...state.settings.ai, apiKey: '' },
        },
        keychainPermissionPromptOpen: false,
        keychainPermissionRetrying: false,
        keychainPermissionRetryError: null,
      }));
    } catch (error) {
      console.warn('[settings] 再次请求钥匙串访问失败:', error);
      set({
        keychainPermissionRetrying: false,
        keychainPermissionRetryError: isKeychainAccessDenied(error) ? 'denied' : 'failed',
      });
    }
  },
  setActiveCategory: (c) => set({ activeCategory: c }),
  setSearchQuery: (q) => set({ searchQuery: q }),

  load: async () => {
    const sequence = ++loadSequence;
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = null;
    pendingSave = null;
    set({ loaded: false, loadError: null, saveError: null, saving: false });
    try {
      const raw = await getStore().get<AppSettings>(STORE_KEY);
      if (sequence !== loadSequence) return;
      const configGuideSources = readConfigGuideSources(raw);
      const base = raw ? deepMergeSettings(DEFAULT_SETTINGS, raw) : structuredClone(DEFAULT_SETTINGS);
      delete (base.ai as AppSettings['ai'] & { systemPrompt?: string }).systemPrompt;
      const hydrated = await hydrateApiKey(base);
      if (sequence !== loadSequence) return;
      const migrated = migrateLegacyFontDefaults(hydrated.settings);
      const merged = migrated.settings;
      set({
        settings: merged,
        configGuideSources,
        loaded: true,
        loadError: null,
        keychainPermissionPromptOpen:
          hydrated.accessDenied && !base.general.suppressKeychainPermissionReminder,
        keychainPermissionRetrying: false,
        keychainPermissionRetryError: null,
      });
      if (loadNotice) notify.dismiss(loadNotice);
      if (saveNotice) notify.dismiss(saveNotice);
      loadNotice = saveNotice = null;
      applyAppearance(merged.appearance);
      applyDataCapacity(merged);
      applyPipelineConfig(merged);
      useAppStore.getState().setLang(merged.general.language);
      void runRecordingApply(merged);
      if (migrated.changed) scheduleSave();
    } catch (error) {
      if (sequence !== loadSequence) return;
      const message = formatError(error);
      set({
        loaded: true,
        loadError: message,
        keychainPermissionPromptOpen: false,
        keychainPermissionRetrying: false,
        keychainPermissionRetryError: null,
      });
      // Keep the last known in-memory settings; do not push default backend settings.
      const lang = get().settings.general.language;
      loadNotice = notify.error(translate('settingsLoadFailed', lang), message, {
        source: 'settings-load',
        actions: [{ label: translate('settingsRetry', lang), run: () => { void get().load(); } }],
      });
    }
  },

  save: () => {
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = null;
    if (!get().loaded || get().loadError !== null) return Promise.resolve(false);
    const revision = changeRevision;
    if (pendingSave?.revision === revision) return pendingSave.promise;
    const sequence = loadSequence;
    const snapshot = structuredClone(sanitizeForPersist(get().settings));
    set({ saving: true });
    const id = ++nextSaveId;
    let write: Promise<void>;
    try { write = getStore().set(STORE_KEY, snapshot); }
    catch (error) { write = Promise.reject(error instanceof Error ? error : new Error(formatError(error))); }
    const promise = (async () => {
      if (sequence !== loadSequence) return false;
      try {
        await write;
        if (sequence !== loadSequence) return false;
        set({ saveError: null });
        if (saveNotice) notify.dismiss(saveNotice);
        saveNotice = null;
        return true;
      } catch (error) {
        if (sequence !== loadSequence) return false;
        const message = formatError(error);
        set({ saveError: message });
        const lang = get().settings.general.language;
        saveNotice = notify.error(translate('settingsSaveFailed', lang), message, {
          source: 'settings-save',
          actions: [{ label: translate('settingsRetry', lang), run: () => { void get().save(); } }],
        });
        return false;
      } finally {
        if (sequence === loadSequence && pendingSave?.id === id) {
          pendingSave = null;
          set({ saving: false });
        }
      }
    })();
    pendingSave = { id, revision, promise };
    return promise;
  },

  update: (category, field, value) => {
    if (category === 'general' && field === 'language') {
      useAppStore.getState().setLang(value as Lang);
    }
    // 外观/主题应用 (CSS 变量 + 全量重绘) 为非紧急更新 — 延迟到 transition 渲染。
    // 调用点 SettingsModal 不在本次变更范围, 故在 store 动作内包装。
    const commit = () => {
      set((s) => {
        const newSettings: AppSettings = {
          ...s.settings,
          [category]: {
            ...s.settings[category],
            [field]: value,
          },
        };
        // 立即应用 appearance 变更
        if (category === 'appearance') {
          applyAppearance(newSettings.appearance);
        }
        // 立即应用 data 缓存容量变更; 录制存储/清理设置防抖推送
        if (category === 'data') {
          applyDataCapacity(newSettings);
          scheduleRecordingApply(newSettings);
        }
        // 立即推送 performance 管道配置变更
        if (category === 'performance') {
          applyPipelineConfig(newSettings);
        }
        return { settings: newSettings };
      });
      scheduleSave(category === 'general' && field === 'showOnboarding');
    };
    if (category === 'appearance') {
      transitionStore(commit);
    } else {
      commit();
    }
    // AI 分类副作用: 覆盖写入后端 SecretStore；密钥永不读回。
    if (category === 'ai' && field === 'apiKey') {
      api.aiSecretSet(get().settings.ai.adapter, String(value)).catch((e: unknown) =>
        console.warn('[settings] 钥匙串写入失败:', e)
      );
    } else if (category === 'ai' && field === 'adapter') {
      api.aiSecretStatus(String(value))
        .then(() =>
          set((s) => ({ settings: { ...s.settings, ai: { ...s.settings.ai, apiKey: '' } } }))
        )
        .catch((e: unknown) => console.warn('[settings] 钥匙串读取失败:', e));
    }
  },

  reset: () => {
    set({
      settings: DEFAULT_SETTINGS,
      keychainPermissionPromptOpen: false,
      keychainPermissionRetrying: false,
      keychainPermissionRetryError: null,
    });
    applyAppearance(DEFAULT_SETTINGS.appearance);
    applyDataCapacity(DEFAULT_SETTINGS);
    applyPipelineConfig(DEFAULT_SETTINGS);
    scheduleRecordingApply(DEFAULT_SETTINGS);
    // 全量重置: 清掉当前适配器的钥匙串密钥
    api.aiSecretDelete(get().settings.ai.adapter).catch((e: unknown) =>
      console.warn('[settings] 钥匙串删除失败:', e)
    );
    scheduleSave();
  },

  resetCategory: (category) => {
    set((s) => ({
      settings: {
        ...s.settings,
        [category]: structuredClone(DEFAULT_SETTINGS[category]),
      },
    }));
    const { settings } = get();
    if (category === 'appearance') applyAppearance(settings.appearance);
    if (category === 'data') {
      applyDataCapacity(settings);
      scheduleRecordingApply(settings);
    }
    if (category === 'performance') applyPipelineConfig(settings);
    // AI 分类重置: 同步清掉当前适配器的钥匙串密钥
    if (category === 'ai') {
      api.aiSecretDelete(get().settings.ai.adapter).catch((e: unknown) =>
        console.warn('[settings] 钥匙串删除失败:', e)
      );
    }
    scheduleSave();
  },
}));
