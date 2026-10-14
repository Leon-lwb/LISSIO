//! 应用设置 schema 与默认值
//!
//! 与 settingsStore.ts 中的 AppSettings 接口对应
//! Desktop/Web persist through the backend configuration directory settings.json.

import type { Lang } from '../i18n';
import type { CssStyleTheme, ThemeDefinition } from './theme';

/// 应用设置根 schema
export interface AppSettings {
  general: {
    language: Lang;
    autoConnectOnStart: boolean;
    confirmBeforeQuit: boolean;
    showOnboarding: boolean;
    /**
     * 启动时始终显示配置引导。
     *
     * 这是**预览用**开关: 打开后每次启动都弹, 与"仅在全新安装自动出现"的默认路径互不
     * 干扰 (升级用户默认看不到引导, 需要看效果时用这个开关)。
     */
    showConfigGuide: boolean;
    showContextualTips: boolean;
    debug: boolean;
    /** 启动时自动检查更新 */
    autoCheckUpdate: boolean;
    /** 更新通道 (null = 按当前版本推导: 含 '-' 视为预发布 → beta, 否则 stable) */
    updateChannel: 'stable' | 'beta' | null;
    /** 用户选择跳过的更新版本号 (内部字段, 不进设置 UI) */
    skippedUpdateVersion: string | null;
    /**
     * 最后确认过配置引导的应用版本。
     *
     * `null` = 从未确认过。它与"读取时设置文档是否存在"一起决定引导是否自动出现
     * (见 `lib/startup/configGuide`): 文档不存在 = 全新安装才自动弹; 确认时写入当前
     * 版本, 于是本次会话与后续启动都不再弹。**永远不得用来覆盖 `showOnboarding`
     * 引导偏好** (关掉使用引导的用户不该被重新弹引导)。
     */
    lastSeenVersion: string | null;
    /** 用户选择不再显示启动时钥匙串授权提醒 (内部字段, 不进设置 UI) */
    suppressKeychainPermissionReminder: boolean;
  };
  appearance: {
    theme: string;
    customThemes: ThemeDefinition[];
    /** 当前激活的CSS样式主题ID */
    cssTheme: string;
    /** 用户自定义CSS样式主题列表 */
    customCssThemes: CssStyleTheme[];
    /** 减少动画效果 */
    reducedMotion: boolean;
    /** 动画速度档位 */
    motionSpeed: 'fast' | 'standard' | 'relaxed';
    uiFontFamily: string;
    uiFontSize: number;
    monoFontFamily: string;
    monoFontSize: number;
    statusBarVisible: boolean;
    activityBarVisible: boolean;
    acrylicBackground: boolean;
    /// 毛玻璃面板透明度 0.1-1.0, 0.6 为基准观感
    acrylicOpacity: number;
    /// 二级卡片磨砂开关, 与亚克力背景相互独立
    floatingGlass: boolean;
    /// 二级卡片磨砂透明度 0.5-1.0, 0.72 为默认观感
    floatingGlassOpacity: number;
    /// 整窗透明度 0.1-1.0, 1.0 为不透明; 与亚克力开关无关的独立维度 (CSS 层生效)
    windowOpacity: number;
    /** 液态玻璃 (WebGPU/WebGL 折射) 开关。默认关闭 —— 关闭时全应用停留在
     *  高斯模糊档 (纯 backdrop-filter), 即本设置引入前的既有行为, 因此升级
     *  不改变任何默认观感。开启后浮层族才升级为折射玻璃。 */
    liquidGlass: boolean;
    /** 液态玻璃预设 id (定义见 lib/glass/glassPresets.ts)。仅在 liquidGlass
     *  开启时生效; 每个预设打包 refraction/bevel/frost/specular/tilt 等一整套
     *  参数, 避免把它们拆成一排互相制约的滑块。 */
    liquidGlassPreset: string;
    /** 液态玻璃强度 0.1-1.0, 缩放预设的折射与倒角强度。0.1 最通透, 1.0 最厚。 */
    liquidGlassIntensity: number;
  };
  editor: {
    waveformFps: number;
    scopeDefaultTimeBase: number;
    scopeDefaultVPerDiv: number;
    gridVisible: boolean;
    /// 光标读数悬浮框是否显示 (波形图鼠标跟随数值提示)
    cursorReadoutVisible: boolean;
    /// 光标吸附: Y 轴吸附到曲线在鼠标 X 处的插值 (X 轴仍跟随鼠标)
    cursorSnap: boolean;
    /// 十字线可见性 (鼠标跟随的横竖辅助线)
    crosshairVisible: boolean;
    /// 鼠标悬停采样点标记可见性 (曲线上跟随鼠标的数据点圆点)
    hoverPointsVisible: boolean;
    /// 交互时自动暂停: 缩放/拖动波形时自动停止实时刷新 (关闭后交互不打断刷新, 运行中也可拖动回看历史)
    pauseOnInteract: boolean;
  };
  data: {
    waveformBufferPoints: number;
    rawDataBufferBytes: number;
    canBufferFrames: number;
    logicBufferSamples: number;
    /// 录制数据库总开关 (默认关)。关闭时不建立任何 DuckDB 连接、不写盘:
    /// 录制是用户显式开启的能力, 且任意运行态都可热更新
    recordingEnabled: boolean;
    /// 录制数据库目录 (空 = 默认: 应用配置目录下 recordings/); 修改后旧文件保留
    recordingDatabaseDir: string;
    /// 启动时上次会话为空则继续写同一会话 (避免空会话堆积, 含崩溃遗留)
    continueEmptySession: boolean;
    /// 启动时自动删除 failed 会话 (含其中有数据的)
    cleanupDeleteFailed: boolean;
    /// 启动时自动删除 stopped 会话 (连带删除其已录数据)
    cleanupDeleteStopped: boolean;
    /// 启动时删除结束时间早于 N 天的会话 (0 = 关闭)
    cleanupOlderThanDays: number;
    /// 启动时只保留最近 N 个会话 (0 = 关闭; 当前活跃会话始终保留)
    cleanupKeepLatest: number;
  };
  serial: {
    defaultBaudRate: number;
    defaultDataBits: 7 | 8;
    defaultParity: 'none' | 'odd' | 'even';
    defaultStopBits: 'one' | 'two';
    defaultFlowControl: 'none' | 'software' | 'hardware';
  };
  notifications: {
    enabled: boolean;
    duration: number;
    showOnConnect: boolean;
    showOnDisconnect: boolean;
    showOnError: boolean;
  };
  /// 数据管道性能调优 — 更新即推送后端 set_pipeline_config (后端不持久化, 启动时重放)
  performance: {
    mode: 'auto';
    maxWorkers: number;
    /** 数值平面评估 worker 数 (1 = 串行; ≥2 启用图内路径并行评估) */
    evalWorkers: number;
    memoryBudgetMb: number;
    previewFpsLimit: number;
    previewBandwidthMbPerSec: number;
  };
  /// AI 对话与 MCP — api_key 写入后端 SecretStore，磁盘副本恒为空串且不可读回;
  /// 运行时随请求传给后端, 后端不持久化
  ai: {
    /** LLM 适配器标识 (见后端 ai_list_providers) */
    adapter: string;
    /** 自定义端点 (空 = provider 默认; openai_compatible 必填) */
    baseUrl: string;
    /** API key */
    apiKey: string;
    /** 模型名 */
    model: string;
    /** 采样温度 (null = provider 默认) */
    temperature: number | null;
    /** 最大生成 token (null = provider 默认) */
    maxTokens: number | null;
    /** 对话中是否启用内置原生工具 (软件自有能力 + 知识库) */
    builtinToolsEnabled: boolean;
    /** 对话中是否启用 fetch_webpage 网页抓取技能 */
    webToolsEnabled: boolean;
    /** 插件一级总开关 (关闭时禁用所有软件插件) */
    pluginsEnabled: boolean;
    /** 对话中是否启用 MCP 工具 */
    mcpToolsEnabled: boolean;
    /** 本地 MCP server 端口 (127.0.0.1, 供外部 AI 客户端连接) */
    mcpServerPort: number;
  };
}

/// 默认设置 — 与项目当前行为保持一致
export const DEFAULT_SETTINGS: AppSettings = {
  general: {
    language: 'zh',
    autoConnectOnStart: false,
    confirmBeforeQuit: true,
    showOnboarding: true,
    showConfigGuide: false,
    showContextualTips: true,
    debug: false,
    autoCheckUpdate: true,
    updateChannel: null,
    skippedUpdateVersion: null,
    lastSeenVersion: null,
    suppressKeychainPermissionReminder: false,
  },
  appearance: {
    theme: 'dark',
    customThemes: [],
    cssTheme: 'default',
    customCssThemes: [],
    reducedMotion: false,
    motionSpeed: 'standard',
    uiFontFamily: "'MiSans', -apple-system, BlinkMacSystemFont, 'Segoe UI', 'PingFang SC', 'Microsoft YaHei', 'WenQuanYi Micro Hei', sans-serif",
    uiFontSize: 13,
    monoFontFamily: "'JetBrains Mono', 'Maple Mono CN', 'Cascadia Code', monospace",
    monoFontSize: 12,
    statusBarVisible: true,
    activityBarVisible: true,
    /// 默认开启亚克力 + 半透明: 面板/Widget 走系统毛玻璃, 观感即默认行为。
    /// 帧率持续偏低时由 lib/performance/acrylicGuard 提醒用户关闭 (见该模块头注)。
    acrylicBackground: true,
    acrylicOpacity: 0.6,
    floatingGlass: true,
    floatingGlassOpacity: 0.72,
    windowOpacity: 1,
    /// 液态玻璃默认关闭: 默认观感 = 高斯模糊档 (backdrop-filter), 与本设置
    /// 引入前完全一致。折射档是纯 opt-in 的升级路径。
    liquidGlass: false,
    liquidGlassPreset: 'balanced',
    liquidGlassIntensity: 0.7,
  },
  editor: {
    waveformFps: 30,
    scopeDefaultTimeBase: 100e-3,
    scopeDefaultVPerDiv: 1,
    gridVisible: true,
    cursorReadoutVisible: true,
    cursorSnap: true,
    crosshairVisible: true,
    hoverPointsVisible: true,
    pauseOnInteract: false,
  },
  data: {
    waveformBufferPoints: 100_000,
    rawDataBufferBytes: 1_048_576,
    canBufferFrames: 100_000,
    logicBufferSamples: 20_000,
    recordingEnabled: false,
    recordingDatabaseDir: '',
    continueEmptySession: true,
    cleanupDeleteFailed: false,
    cleanupDeleteStopped: false,
    cleanupOlderThanDays: 0,
    cleanupKeepLatest: 0,
  },
  serial: {
    defaultBaudRate: 115200,
    defaultDataBits: 8,
    defaultParity: 'none',
    defaultStopBits: 'one',
    defaultFlowControl: 'none',
  },
  notifications: {
    enabled: true,
    duration: 5000,
    showOnConnect: true,
    showOnDisconnect: false,
    showOnError: true,
  },
  performance: {
    mode: 'auto',
    maxWorkers: 8,
    evalWorkers: 1,
    memoryBudgetMb: 256,
    previewFpsLimit: 60,
    previewBandwidthMbPerSec: 8,
  },
  ai: {
    adapter: 'orcarouter',
    baseUrl: '',
    apiKey: '',
    model: '',
    temperature: null,
    maxTokens: null,
    builtinToolsEnabled: true,
    webToolsEnabled: true,
    pluginsEnabled: true,
    mcpToolsEnabled: true,
    mcpServerPort: 8765,
  },
};

/// OrcaRouter 推广链接 (合作伙伴中心; 应用内"获取 API Key"与 README 共用)
export const ORCAROUTER_REFERRAL_URL = 'https://www.orcarouter.ai/ref/ref_1f7582998bdadbe7e0f3';

/// OrcaRouter 免费模型页面 (获取 API Key 即可访问, 设置 → AI 提示条内展示)
export const ORCAROUTER_OFFERS_URL = 'https://www.orcarouter.ai/zh-CN/offers';

/// 设置分类元数据 — 用于 SettingsModal 渲染左侧导航
export interface SettingCategoryMeta {
  key: keyof AppSettings;
  icon: string; // lucide-react icon name
}

export const SETTING_CATEGORIES: SettingCategoryMeta[] = [
  { key: 'general', icon: 'Settings' },
  { key: 'appearance', icon: 'Palette' },
  { key: 'editor', icon: 'Sliders' },
  { key: 'data', icon: 'Database' },
  { key: 'serial', icon: 'Usb' },
  { key: 'notifications', icon: 'Bell' },
  { key: 'performance', icon: 'Gauge' },
  { key: 'ai', icon: 'Sparkles' },
];

/// 浅合并: 用任意子路径更新设置 (path 例如 'appearance.uiFontSize')
export function deepMergeSettings(
  base: AppSettings,
  patch: Partial<AppSettings>
): AppSettings {
  const result = structuredClone(base);
  for (const k of Object.keys(patch) as (keyof AppSettings)[]) {
    const v = patch[k];
    if (v && typeof v === 'object') {
      // 浅合并子对象
      (result[k] as Record<string, unknown>) = { ...(result[k] as Record<string, unknown>), ...(v as Record<string, unknown>) };
    } else if (v !== undefined) {
      // 顶层标量
      (result[k] as unknown) = v;
    }
  }
  return result;
}
