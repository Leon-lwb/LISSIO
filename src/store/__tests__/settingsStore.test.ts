import { beforeEach, describe, expect, it, vi } from 'vitest';
import { tauriMock } from '../../test/setup';
import { DEFAULT_SETTINGS, type AppSettings } from '../../settings/defaults';
import { toCleanupPolicy, useSettingsStore } from '../settingsStore';
import type { RecordingCleanupPolicy } from '../../lib/tauri/tauri';

const STORE_FILE = 'settings.json';
const STORE_KEY = 'app';

/// 提取 set_pipeline_config 的调用参数 (invoke mock 无参数签名, 需显式收窄)
function pipelineConfigCalls(): { config: Record<string, number | string> }[] {
  return (tauriMock.invoke.mock.calls as unknown as [string, ...unknown[]][])
    .filter(([cmd]) => cmd === 'set_pipeline_config')
    .map(([, args]) => args as { config: Record<string, number> });
}

/// 提取任意命令的调用参数
function invokeCalls(cmd: string): Record<string, unknown>[] {
  return (tauriMock.invoke.mock.calls as unknown as [string, ...unknown[]][])
    .filter(([c]) => c === cmd)
    .map(([, args]) => args as Record<string, unknown>);
}

describe('settingsStore', () => {
  beforeEach(() => {
    tauriMock.fileStore.clear();
    vi.clearAllMocks();
    useSettingsStore.setState({
      settings: DEFAULT_SETTINGS,
      isOpen: false,
      isAboutOpen: false,
      activeCategory: 'general',
      searchQuery: '',
      loaded: false,
      keychainPermissionPromptOpen: false,
      keychainPermissionRetrying: false,
      keychainPermissionRetryError: null,
    });
  });

  it('loads persisted settings from the LazyStore and merges them over defaults', async () => {
    tauriMock.seedFile(STORE_FILE, STORE_KEY, { general: { language: 'en' } });

    await useSettingsStore.getState().load();

    const { settings, loaded } = useSettingsStore.getState();
    expect(loaded).toBe(true);
    expect(settings.general.language).toBe('en');
    expect(settings.general.showOnboarding).toBe(DEFAULT_SETTINGS.general.showOnboarding);
  });

  it('falls back to defaults when the store holds no saved settings', async () => {
    await useSettingsStore.getState().load();

    const { settings, loaded } = useSettingsStore.getState();
    expect(loaded).toBe(true);
    expect(settings.general.language).toBe(DEFAULT_SETTINGS.general.language);
    expect(settings.appearance.uiFontSize).toBe(DEFAULT_SETTINGS.appearance.uiFontSize);
  });

  it('toggles modal state and category via open/close slice actions', () => {
    useSettingsStore.getState().open('serial');
    expect(useSettingsStore.getState().isOpen).toBe(true);
    expect(useSettingsStore.getState().activeCategory).toBe('serial');

    useSettingsStore.getState().setActiveCategory('appearance');
    expect(useSettingsStore.getState().activeCategory).toBe('appearance');

    useSettingsStore.getState().close();
    expect(useSettingsStore.getState().isOpen).toBe(false);
  });

  it('pushes pipeline config on load (backend does not persist it)', async () => {
    await useSettingsStore.getState().load();

    const calls = pipelineConfigCalls();
    expect(calls).toHaveLength(1);
    expect(calls[0]).toEqual({
      config: {
        mode: 'auto',
        max_workers: DEFAULT_SETTINGS.performance.maxWorkers,
        eval_workers: DEFAULT_SETTINGS.performance.evalWorkers,
        memory_budget_mb: DEFAULT_SETTINGS.performance.memoryBudgetMb,
        preview_fps_limit: DEFAULT_SETTINGS.performance.previewFpsLimit,
        preview_bandwidth_mb_per_sec: DEFAULT_SETTINGS.performance.previewBandwidthMbPerSec,
      },
    });
  });

  it('pushes pipeline config immediately when a performance setting is updated', () => {
    useSettingsStore.getState().update('performance', 'maxWorkers', 12);

    const calls = pipelineConfigCalls();
    expect(calls).toHaveLength(1);
    expect(calls[0].config.max_workers).toBe(12);
    expect(useSettingsStore.getState().settings.performance.maxWorkers).toBe(12);
  });

  it('migrates legacy manual pipeline knobs to automatic safety limits', async () => {
    tauriMock.seedFile(STORE_FILE, STORE_KEY, {
      performance: {
        maxFeedWorkers: 2,
        feedParallelUnit: 4,
        minWorkerBytesKb: 16,
        coalesceMaxMsgs: 8,
        coalesceMaxBytesKb: 32,
        maxStreamShards: 4,
        parseChannelCap: 64,
      },
    });

    await useSettingsStore.getState().load();

    expect(useSettingsStore.getState().settings.performance).toEqual(DEFAULT_SETTINGS.performance);
    const saved = tauriMock.fileStore.get(STORE_FILE)?.get(STORE_KEY) as {
      performance: Record<string, unknown>;
    };
    expect(saved.performance).toEqual(DEFAULT_SETTINGS.performance);
    expect(saved.performance).not.toHaveProperty('maxStreamShards');
  });

  it('does not push pipeline config when a non-performance setting is updated', () => {
    useSettingsStore.getState().update('notifications', 'duration', 3000);

    expect(pipelineConfigCalls()).toHaveLength(0);
  });

  it('replays recording storage settings and runs enabled cleanup rules on load', async () => {
    tauriMock.seedFile(STORE_FILE, STORE_KEY, {
      data: { recordingDatabaseDir: '/tmp/rec-storage', cleanupDeleteFailed: true },
    });

    await useSettingsStore.getState().load();

    await vi.waitFor(() => {
      expect(invokeCalls('apply_recording_settings')).toHaveLength(1);
    });
    expect(invokeCalls('apply_recording_settings')[0]).toEqual({
      databaseDir: '/tmp/rec-storage',
      continueEmptySession: true,
    });
    await vi.waitFor(() => {
      expect(invokeCalls('cleanup_recording_sessions')).toHaveLength(1);
    });
    const policy = (
      invokeCalls('cleanup_recording_sessions')[0] as { policy: RecordingCleanupPolicy }
    ).policy;
    expect(policy.delete_failed).toBe(true);
    expect(policy.delete_stopped).toBe(false);
    expect(policy.older_than_us).toBeNull();
    expect(policy.keep_latest).toBeNull();
  });

  it('skips the cleanup invocation when no rule is enabled', async () => {
    await useSettingsStore.getState().load();

    await vi.waitFor(() => {
      expect(invokeCalls('apply_recording_settings')).toHaveLength(1);
    });
    expect(invokeCalls('cleanup_recording_sessions')).toHaveLength(0);
  });

  it('debounces recording side effects while cleanup numbers are edited', async () => {
    vi.useFakeTimers();
    try {
      useSettingsStore.getState().update('data', 'cleanupDeleteFailed', true);
      useSettingsStore.getState().update('data', 'cleanupKeepLatest', 5);
      expect(invokeCalls('apply_recording_settings')).toHaveLength(0);

      await vi.advanceTimersByTimeAsync(800);

      expect(invokeCalls('apply_recording_settings')).toHaveLength(1);
      const policy = (
        invokeCalls('cleanup_recording_sessions')[0] as { policy: RecordingCleanupPolicy }
      ).policy;
      expect(policy.delete_failed).toBe(true);
      expect(policy.keep_latest).toBe(5);
    } finally {
      vi.useRealTimers();
    }
  });

  it('maps cleanup settings to a backend policy (days → us cutoff, 0 = off)', () => {
    const enabled = toCleanupPolicy({
      ...DEFAULT_SETTINGS.data,
      cleanupDeleteStopped: true,
      cleanupOlderThanDays: 7,
      cleanupKeepLatest: 10,
    });
    expect(enabled.delete_stopped).toBe(true);
    expect(enabled.keep_latest).toBe(10);
    const beforeUs = (Date.now() - 7 * 86_400_000) * 1000;
    expect(enabled.older_than_us).toBeGreaterThanOrEqual(beforeUs - 2000);
    expect(enabled.older_than_us).toBeLessThan(Date.now() * 1000 + 2000);

    const off = toCleanupPolicy(DEFAULT_SETTINGS.data);
    expect(off.delete_failed).toBe(false);
    expect(off.older_than_us).toBeNull();
    expect(off.keep_latest).toBeNull();
  });
});

describe('settingsStore API key 钥匙串集成', () => {
  beforeEach(() => {
    tauriMock.fileStore.clear();
    vi.clearAllMocks();
    useSettingsStore.setState({
      settings: DEFAULT_SETTINGS,
      loaded: false,
      keychainPermissionPromptOpen: false,
      keychainPermissionRetrying: false,
      keychainPermissionRetryError: null,
    });
  });

  function keychainCalls(cmd: string): [string, string][] {
    return (tauriMock.invoke.mock.calls as unknown as [string, ...unknown[]][])
      .filter(([c]) => c === cmd)
      .map(([, args]) => args as { adapter: string; key?: string })
      .map((a) => [a.adapter, a.key ?? '']);
  }

  it('load 时只读取密钥状态，不把明文水合到前端', async () => {
    tauriMock.seedFile(STORE_FILE, STORE_KEY, {});
    (tauriMock.invoke as unknown as { mockImplementation: (f: (cmd: string) => unknown) => void })
      .mockImplementation((cmd: string) => Promise.resolve(cmd === 'ai_secret_status'
        ? { configured: true, source: 'keyring', writable: true }
        : undefined));

    await useSettingsStore.getState().load();

    expect(useSettingsStore.getState().settings.ai.apiKey).toBe('');
    expect(keychainCalls('ai_secret_status')).toContainEqual(['orcarouter', '']);
  });

  it('旧版明文 key 自动迁入 SecretStore 后立即从设置中清除', async () => {
    tauriMock.seedFile(STORE_FILE, STORE_KEY, { ai: { apiKey: 'sk-legacy' } });
    await useSettingsStore.getState().load();

    expect(keychainCalls('ai_secret_set')).toContainEqual(['orcarouter', 'sk-legacy']);
    expect(useSettingsStore.getState().settings.ai.apiKey).toBe('');
    const saved = tauriMock.fileStore.get(STORE_FILE)?.get(STORE_KEY) as AppSettings;
    expect(saved.ai.apiKey).toBe('');
  });

  it('持久化剥离 API key — settings.json 恒为空串', async () => {
    useSettingsStore.setState({
      settings: {
        ...DEFAULT_SETTINGS,
        ai: { ...DEFAULT_SETTINGS.ai, adapter: 'orcarouter', apiKey: 'sk-secret', model: 'openai/gpt-4o-mini' },
      },
    });
    useSettingsStore.getState().update('general', 'language', 'en');
    await vi.waitFor(() => {
      const saved = tauriMock.fileStore.get(STORE_FILE)?.get(STORE_KEY) as { ai?: { apiKey?: string } } | undefined;
      expect(saved?.ai?.apiKey).toBe('');
    });
    // 编辑控件可暂存本次输入，但对话请求不会携带它。
    expect(useSettingsStore.getState().settings.ai.apiKey).toBe('sk-secret');
  });

  it('update apiKey 覆盖 SecretStore；切换适配器只读取状态并清空输入', () => {
    useSettingsStore.getState().update('ai', 'apiKey', 'sk-new');
    expect(keychainCalls('ai_secret_set')).toContainEqual(['orcarouter', 'sk-new']);

    (tauriMock.invoke as unknown as { mockImplementation: (f: (cmd: string) => unknown) => void })
      .mockImplementation((cmd: string) => Promise.resolve(cmd === 'ai_secret_status'
        ? { configured: true, source: 'environment', writable: true }
        : undefined));
    useSettingsStore.getState().update('ai', 'adapter', 'deepseek');
    return vi.waitFor(() => {
      expect(useSettingsStore.getState().settings.ai.apiKey).toBe('');
    });
  });

  it('启动读取被拒绝时打开授权提醒', async () => {
    (tauriMock.invoke as unknown as {
      mockImplementation: (f: (cmd: string) => unknown) => void;
    }).mockImplementation((cmd: string) => {
      if (cmd === 'ai_secret_status') {
        return Promise.reject(Object.assign(new Error('cancelled'), { kind: 'AiKeyringAccessDenied', data: {} }));
      }
      return Promise.resolve(undefined);
    });

    await useSettingsStore.getState().load();

    expect(useSettingsStore.getState().keychainPermissionPromptOpen).toBe(true);
    expect(useSettingsStore.getState().settings.ai.apiKey).toBe('');
  });

  it('普通钥匙串故障不打开授权提醒', async () => {
    (tauriMock.invoke as unknown as {
      mockImplementation: (f: (cmd: string) => unknown) => void;
    }).mockImplementation((cmd: string) => {
      if (cmd === 'ai_secret_status') {
        return Promise.reject(Object.assign(new Error('locked'), { kind: 'AiKeyring', data: {} }));
      }
      return Promise.resolve(undefined);
    });

    await useSettingsStore.getState().load();

    expect(useSettingsStore.getState().keychainPermissionPromptOpen).toBe(false);
  });

  it('已选择不再提醒时忽略启动授权拒绝', async () => {
    tauriMock.seedFile(STORE_FILE, STORE_KEY, {
      general: { suppressKeychainPermissionReminder: true },
    });
    (tauriMock.invoke as unknown as {
      mockImplementation: (f: (cmd: string) => unknown) => void;
    }).mockImplementation((cmd: string) => {
      if (cmd === 'ai_secret_status') {
        return Promise.reject(Object.assign(new Error('cancelled'), { kind: 'AiKeyringAccessDenied', data: {} }));
      }
      return Promise.resolve(undefined);
    });

    await useSettingsStore.getState().load();

    expect(useSettingsStore.getState().keychainPermissionPromptOpen).toBe(false);
  });

  it('再次请求成功后确认状态并关闭提醒，仍不读回密钥', async () => {
    useSettingsStore.setState({ keychainPermissionPromptOpen: true });
    (tauriMock.invoke as unknown as {
      mockImplementation: (f: (cmd: string) => unknown) => void;
    }).mockImplementation((cmd: string) =>
      Promise.resolve(cmd === 'ai_secret_status'
        ? { configured: true, source: 'keyring', writable: true }
        : undefined)
    );

    await useSettingsStore.getState().retryKeychainPermission();

    expect(useSettingsStore.getState().settings.ai.apiKey).toBe('');
    expect(useSettingsStore.getState().keychainPermissionPromptOpen).toBe(false);
    expect(useSettingsStore.getState().keychainPermissionRetryError).toBeNull();
  });

  it('再次拒绝时保留提醒并记录可本地化状态', async () => {
    useSettingsStore.setState({ keychainPermissionPromptOpen: true });
    (tauriMock.invoke as unknown as {
      mockImplementation: (f: (cmd: string) => unknown) => void;
    }).mockImplementation((cmd: string) => {
      if (cmd === 'ai_secret_status') {
        return Promise.reject(Object.assign(new Error('cancelled'), { kind: 'AiKeyringAccessDenied', data: {} }));
      }
      return Promise.resolve(undefined);
    });

    await useSettingsStore.getState().retryKeychainPermission();

    expect(useSettingsStore.getState().keychainPermissionPromptOpen).toBe(true);
    expect(useSettingsStore.getState().keychainPermissionRetrying).toBe(false);
    expect(useSettingsStore.getState().keychainPermissionRetryError).toBe('denied');
  });

  it('稍后处理只在勾选时持久化不再提醒', async () => {
    useSettingsStore.setState({ keychainPermissionPromptOpen: true });
    useSettingsStore.getState().dismissKeychainPermissionPrompt(false);
    expect(useSettingsStore.getState().keychainPermissionPromptOpen).toBe(false);
    expect(
      useSettingsStore.getState().settings.general.suppressKeychainPermissionReminder
    ).toBe(false);

    useSettingsStore.setState({ keychainPermissionPromptOpen: true });
    useSettingsStore.getState().dismissKeychainPermissionPrompt(true);
    expect(
      useSettingsStore.getState().settings.general.suppressKeychainPermissionReminder
    ).toBe(true);

    await vi.waitFor(() => {
      const saved = tauriMock.fileStore.get(STORE_FILE)?.get(STORE_KEY) as AppSettings;
      expect(saved.general.suppressKeychainPermissionReminder).toBe(true);
    });
  });
});
