//! 设置 store — 基于 zustand + 平台存储 shim
//!
//! 启动时调用 load() 加载, 每次 update 后 save() (防抖 300ms)
//! 通过 subscribeAppearance() 自动应用 appearance 到 CSS 变量
//!
//! 存储经 `src/lib/platform/` 选择: 桌面 = Tauri `plugin-store` 的 settings.json,
//! Web 出口 = 服务端 `/api/v1/settings`。接口一致, 因此这里不再感知出口。

import { create } from 'zustand';
import { platform, type PlatformStore } from '../lib/platform';
import type {
  AppSettings} from '../settings/defaults';
import {
  DEFAULT_SETTINGS,
  deepMergeSettings,
} from '../settings/defaults';
import { applyAppearance } from '../settings/applyTheme';
import { api, type PipelineConfig, type RecordingCleanupPolicy } from '../lib/tauri/tauri';
import { setRawDataPreviewCapacity } from '../lib/buffers/rawDataPreviewRegistry';
import { canFrameBuffer } from '../lib/buffers/canBuffer';
import { logicSampleBuffer } from '../lib/buffers/logicBuffer';
import { transitionStore } from '../lib/utils/transitionStore';
import { useAppStore } from './appStore';

const STORE_FILE = 'settings.json';
const STORE_KEY = 'app';

/// 单例存储 — 多次调用共享底层连接 (桌面) / 服务端文档缓存 (Web)
let storeInstance: PlatformStore | null = null;
function getStore(): PlatformStore {
  storeInstance ??= platform.createStore(STORE_FILE);
  return storeInstance;
}

/// 防抖保存计时器
let saveTimer: ReturnType<typeof setTimeout> | null = null;

/// API key 不入 settings.json，也不从后端读回。该字段仅作为覆盖写入控件的
/// 临时输入；对话请求由后端 SecretStore 注入有效密钥。
function sanitizeForPersist(settings: AppSettings): AppSettings {
  const ai = { ...settings.ai } as AppSettings['ai'] & { systemPrompt?: string };
  delete ai.systemPrompt;
  return { ...settings, ai: { ...ai, apiKey: '' } };
}

/// 历史版本默认字体栈 — 存档仍是其中某个值, 说明用户没自定义过字体, 升级到当前默认。
/// 只在精确匹配时替换: 用户改过的字体栈原样保留。
/// 每次改动 DEFAULT_SETTINGS 的字体栈, 都要把被替换掉的旧值追加进来, 否则存量存档会停在
/// 已删除的字体族上 (如 FiraCode / GoMono Nerd Font Mono)。
const LEGACY_DEFAULT_UI_FONTS: readonly string[] = [
  "-apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
  "'JetBrains Mono', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
  "'JetBrains Mono', 'Maple Mono CN', -apple-system, BlinkMacSystemFont, 'Segoe UI', 'PingFang SC', 'Microsoft YaHei', sans-serif",
  "'GoMono Nerd Font Mono', 'Clear Han Serif', 'Maple Mono CN', 'JetBrains Mono', -apple-system, BlinkMacSystemFont, 'Segoe UI', 'PingFang SC', 'Microsoft YaHei', sans-serif",
  "'JetBrainsMono Nerd Font Mono', 'GoMono Nerd Font Mono', 'Clear Han Serif', 'Maple Mono CN', 'JetBrains Mono', -apple-system, BlinkMacSystemFont, 'Segoe UI', 'PingFang SC', 'Microsoft YaHei', sans-serif",
  "'FiraCode Nerd Font Mono', 'GoMono Nerd Font Mono', 'Clear Han Serif', 'Maple Mono CN', 'JetBrains Mono', -apple-system, BlinkMacSystemFont, 'Segoe UI', 'PingFang SC', 'Microsoft YaHei', sans-serif",
  "'FiraCode Nerd Font Mono', 'GoMono Nerd Font Mono', -apple-system, BlinkMacSystemFont, 'Segoe UI', 'PingFang SC', 'Hiragino Sans GB', 'Microsoft YaHei', 'Noto Sans CJK SC', 'Source Han Sans SC', 'WenQuanYi Micro Hei', sans-serif",
  "'FiraCode Nerd Font Mono', 'GoMono Nerd Font Mono', -apple-system, BlinkMacSystemFont, 'Segoe UI', 'MiSans', 'PingFang SC', 'Hiragino Sans GB', 'Microsoft YaHei', 'Noto Sans CJK SC', 'Source Han Sans SC', 'WenQuanYi Micro Hei', sans-serif",
];
const LEGACY_DEFAULT_MONO_FONTS: readonly string[] = [
  "'Cascadia Code', 'Fira Code', 'SF Mono', Menlo, monospace",
  "'JetBrains Mono', 'Cascadia Code', 'Fira Code', 'SF Mono', Menlo, monospace",
  "'JetBrains Mono', 'Maple Mono CN', 'Cascadia Code', 'Fira Code', 'SF Mono', Menlo, 'PingFang SC', 'Microsoft YaHei', monospace",
  "'GoMono Nerd Font Mono', 'Maple Mono CN', 'Clear Han Serif', 'JetBrains Mono', 'Cascadia Code', 'Fira Code', 'SF Mono', Menlo, 'PingFang SC', 'Microsoft YaHei', monospace",
  "'JetBrainsMono Nerd Font Mono', 'GoMono Nerd Font Mono', 'Maple Mono CN', 'Clear Han Serif', 'JetBrains Mono', 'Cascadia Code', 'Fira Code', 'SF Mono', Menlo, 'PingFang SC', 'Microsoft YaHei', monospace",
  "'FiraCode Nerd Font Mono', 'GoMono Nerd Font Mono', 'Maple Mono CN', 'Clear Han Serif', 'JetBrains Mono', 'Cascadia Code', 'SF Mono', Menlo, 'PingFang SC', 'Microsoft YaHei', monospace",
  "'FiraCode Nerd Font Mono', 'GoMono Nerd Font Mono', 'Maple Mono CN', 'JetBrains Mono', 'Cascadia Code', 'SF Mono', Menlo, 'PingFang SC', 'Hiragino Sans GB', 'Microsoft YaHei', 'Noto Sans CJK SC', 'Source Han Sans SC', 'WenQuanYi Micro Hei', monospace",
];

/// 把"仍是历史默认"的字体栈升级为当前默认; `changed` 表示发生了改写。
/// 已删除的字体族 (Clear Han Serif 等) 留在旧栈里会导致中文落到 Maple Mono (等宽),
/// 因此存量存档必须显式升级一次。
export function migrateLegacyFontDefaults(settings: AppSettings): {
  settings: AppSettings;
  changed: boolean;
} {
  const { appearance } = settings;
  const uiLegacy = LEGACY_DEFAULT_UI_FONTS.includes(appearance.uiFontFamily);
  const monoLegacy = LEGACY_DEFAULT_MONO_FONTS.includes(appearance.monoFontFamily);
  if (!uiLegacy && !monoLegacy) return { settings, changed: false };
  return {
    settings: {
      ...settings,
      appearance: {
        ...appearance,
        uiFontFamily: uiLegacy ? DEFAULT_SETTINGS.appearance.uiFontFamily : appearance.uiFontFamily,
        monoFontFamily: monoLegacy
          ? DEFAULT_SETTINGS.appearance.monoFontFamily
          : appearance.monoFontFamily,
      },
    },
    changed: true,
  };
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
  loaded: boolean;
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
/// 位置/续写开关在运行中被后端拒绝 (下次启动回放时生效); 清理只作用于
/// 终态会话 (当前活跃会话始终保留), 与运行状态无冲突。
async function runRecordingApply(settings: AppSettings) {
  const data = settings.data;
  try {
    await api.applyRecordingSettings(data.recordingDatabaseDir, data.continueEmptySession);
  } catch (e: unknown) {
    console.warn('[settings] 应用录制存储设置失败:', e);
  }
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
  loaded: false,
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
    try {
      const raw = await getStore().get<AppSettings>(STORE_KEY);
      if (raw) {
        // 与默认值合并, 补齐缺失字段
        const base = deepMergeSettings(DEFAULT_SETTINGS, raw);
        delete (base.ai as AppSettings['ai'] & { systemPrompt?: string }).systemPrompt;
        const hydrated = await hydrateApiKey(base);
        const migrated = migrateLegacyFontDefaults(hydrated.settings);
        const merged = migrated.settings;
        set({
          settings: merged,
          loaded: true,
          keychainPermissionPromptOpen:
            hydrated.accessDenied && !base.general.suppressKeychainPermissionReminder,
          keychainPermissionRetrying: false,
          keychainPermissionRetryError: null,
        });
        applyAppearance(merged.appearance);
        applyDataCapacity(merged);
        applyPipelineConfig(merged);
        void runRecordingApply(merged);
        // 迁移结果落盘, 避免每次启动重复改写
        if (migrated.changed) {
          void getStore()
            .set(STORE_KEY, sanitizeForPersist(merged))
            .catch((e: unknown) => console.warn('[settings] 迁移结果保存失败:', e));
        }
      } else {
        const hydrated = await hydrateApiKey(DEFAULT_SETTINGS);
        const merged = hydrated.settings;
        set({
          settings: merged,
          loaded: true,
          keychainPermissionPromptOpen:
            hydrated.accessDenied &&
            !DEFAULT_SETTINGS.general.suppressKeychainPermissionReminder,
          keychainPermissionRetrying: false,
          keychainPermissionRetryError: null,
        });
        applyAppearance(merged.appearance);
        applyDataCapacity(merged);
        applyPipelineConfig(merged);
        void runRecordingApply(merged);
      }
    } catch (e) {
      console.warn('[settings] 加载失败, 使用默认值:', e);
      set({
        loaded: true,
        keychainPermissionPromptOpen: false,
        keychainPermissionRetrying: false,
        keychainPermissionRetryError: null,
      });
      applyAppearance(DEFAULT_SETTINGS.appearance);
      applyDataCapacity(DEFAULT_SETTINGS);
      applyPipelineConfig(DEFAULT_SETTINGS);
    }
  },

  update: (category, field, value) => {
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
        // 异步保存 (防抖 300ms)
        if (saveTimer) clearTimeout(saveTimer);
        saveTimer = setTimeout(() => {
          getStore()
            .set(STORE_KEY, sanitizeForPersist(get().settings))
            .catch((e: unknown) => console.warn('[settings] 保存失败:', e));
        }, 300);
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
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      getStore()
        .set(STORE_KEY, sanitizeForPersist(DEFAULT_SETTINGS))
        .catch((e: unknown) => console.warn('[settings] 保存失败:', e));
    }, 300);
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
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      getStore()
        .set(STORE_KEY, sanitizeForPersist(get().settings))
        .catch((e: unknown) => console.warn('[settings] 保存失败:', e));
    }, 300);
  },
}));
