//! 配置引导 —— 全新安装的第一屏: 语言 → 主题 → 动画与磨砂。
//!
//! 它是**页面而不是弹窗**: 未确认前 `App` 只渲染它 (工作台不挂载), 桌面原生窗口在设置
//! 读取完成时由 `useFirstFrameReveal` 放行, 于是用户先看到这张卡片, 再看到主窗口。
//!
//! - **左侧**: 当前步标题 → 选项 → 继承来源 → 步骤指示 → 上一步/下一步
//! - **右侧**: 该步的效果预览 (见 `ConfigGuidePreview`)
//! - **选中即生效**: 每个选项写回 settings store, 整页就是预览
//! - 没有关闭按钮: Escape 等同"保留当前选择并开始使用", 不让键盘用户没有出口
//!
//! 自动出现与串行顺序由 `lib/startup/configGuide` + `lib/startup/phases` 裁决:
//! 只在全新安装自动出现, 升级安装默认不受打扰 (设置里的「配置引导」开关用于预览)。

import { useEffect, useRef, useState } from 'react';
import { Check, ChevronLeft, ChevronRight, Languages } from 'lucide-react';
import { useContentSwitch } from '../../lib/motion';
import { translate, type Lang } from '../../i18n';
import type { AppSettings } from '../../settings/defaults';
import { BUILT_IN_THEMES, getBuiltInTheme, resolveActiveTheme } from '../../settings/theme';
import type { ConfigGuideValueSource } from '../../settings/configGuideSources';
import type { SettingFieldDef } from '../settingFields';
import { SettingsControl } from '../SettingsControl';
import { useAppStore } from '../../store/appStore';
import { useConfigGuideStore } from '../../store/configGuideStore';
import { useSettingsStore } from '../../store/settingsStore';
import { ConfigGuidePreview } from './ConfigGuidePreview';
import {
  CONFIG_GUIDE_PREVIEW_TRAVEL_PX,
  CONFIG_GUIDE_STEPS,
  CONFIG_GUIDE_STEP_LABEL_KEYS,
  type ConfigGuideStep,
} from './configGuideSteps';

/// 语言选项用各自语言的自称, 不做翻译 (与设置里的语言下拉一致): 用户必须在看不懂
/// 当前语言时也能找到自己的语言。
const LANGUAGE_OPTIONS: readonly { value: Lang; label: string }[] = [
  { value: 'zh', label: '中文' },
  { value: 'en', label: 'English' },
];

/// 内置主题的文案键; 未来新增内置主题时回落到主题自带的名字, 不会翻译成空串。
const THEME_LABEL_KEYS: Record<string, string> = {
  dark: 'configGuideThemeDark',
  light: 'configGuideThemeLight',
  monet: 'configGuideThemeMonet',
};

const SOURCE_LABEL_KEYS: Record<ConfigGuideValueSource, string> = {
  stored: 'configGuideSourceStored',
  system: 'configGuideSourceSystem',
  default: 'configGuideSourceDefault',
  manual: 'configGuideSourceManual',
};

/// 动画与磨砂步复用设置页的控件与文案: 引导里改的就是同一批字段, 不另造一套说法。
const MOTION_FIELDS: readonly SettingFieldDef[] = [
  {
    category: 'appearance',
    field: 'motionSpeed',
    labelKey: 'settingMotionSpeed',
    descKey: 'settingMotionSpeedDesc',
    control: {
      kind: 'select',
      options: [
        { value: 'fast', label: 'Fast' },
        { value: 'standard', label: 'Standard' },
        { value: 'relaxed', label: 'Relaxed' },
      ],
    },
  },
  {
    category: 'appearance',
    field: 'reducedMotion',
    labelKey: 'settingReducedMotion',
    descKey: 'settingReducedMotionDesc',
    control: { kind: 'toggle' },
  },
  {
    category: 'appearance',
    field: 'acrylicBackground',
    labelKey: 'settingAcrylicBackground',
    descKey: 'settingAcrylicBackgroundDesc',
    control: { kind: 'toggle' },
  },
  {
    category: 'appearance',
    field: 'floatingGlass',
    labelKey: 'settingFloatingGlass',
    descKey: 'settingFloatingGlassDesc',
    control: { kind: 'toggle' },
  },
];

/// 预览里迷你面板的进场/退场节拍。
///
/// 动画本身**不走 CSS 过渡**: 面板由 `MotionPresence` 驱动 (见 `ConfigGuidePreview`),
/// 与浮层/面板同一条 `usePresence` → `springTween` 弹簧路径 (按家族与实测位移解算,
/// 低动画偏好走压缩分支)。这里只是"多久换一次方向", 不是时长来源。
const PREVIEW_TICK_MS = 1500;

export function ConfigGuide() {
  const isOpen = useConfigGuideStore((state) => state.isOpen);
  const sources = useConfigGuideStore((state) => state.sources);
  const markManual = useConfigGuideStore((state) => state.markManual);
  const confirm = useConfigGuideStore((state) => state.confirm);
  const lang = useAppStore((state) => state.lang);
  const settings = useSettingsStore((state) => state.settings);
  const update = useSettingsStore((state) => state.update);
  const setLang = useAppStore((state) => state.setLang);
  const [stepIndex, setStepIndex] = useState(0);
  const [previewVisible, setPreviewVisible] = useState(true);
  const previewRef = useRef<HTMLDivElement>(null);

  const step: ConfigGuideStep = CONFIG_GUIDE_STEPS[stepIndex] ?? 'language';
  const language = settings.general.language;
  const theme = settings.appearance.theme;

  // 迷你面板循环进场/退场 — 弹簧由 MotionPresence 播, 这里只负责换向。
  useEffect(() => {
    if (step !== 'motion') return undefined;
    setPreviewVisible(true);
    const timer = setInterval(() => setPreviewVisible((visible) => !visible), PREVIEW_TICK_MS);
    return () => clearInterval(timer);
  }, [step]);

  // 步骤切换走仓库自己的内容切换路径 (方向感 + 低动画分支), 而不是另写一套过渡。
  useContentSwitch(previewRef, step, (previous) => ({
    x:
      CONFIG_GUIDE_STEPS.indexOf(step) >= CONFIG_GUIDE_STEPS.indexOf(previous as ConfigGuideStep)
        ? CONFIG_GUIDE_PREVIEW_TRAVEL_PX
        : -CONFIG_GUIDE_PREVIEW_TRAVEL_PX,
    y: 0,
  }));

  const apply = (category: keyof AppSettings, field: string, value: unknown) => {
    (update as (c: keyof AppSettings, f: string, v: unknown) => void)(category, field, value);
  };

  const customTheme = getBuiltInTheme(theme) === undefined;
  const themeOptions = [
    ...BUILT_IN_THEMES.map((definition) => ({
      id: definition.id,
      label: translate(THEME_LABEL_KEYS[definition.id] ?? definition.name, lang),
      tokens: definition.tokens,
    })),
    ...(customTheme
      ? [
          {
            id: theme,
            label: translate('configGuideThemeCustom', lang),
            tokens: resolveActiveTheme(settings.appearance).tokens,
          },
        ]
      : []),
  ];
  const previewTokens = resolveActiveTheme(settings.appearance).tokens;
  const lastStep = stepIndex === CONFIG_GUIDE_STEPS.length - 1;

  return (
    <div className="fixed inset-0 bg-bg-window flex items-center justify-center">
      {/* 卡片外壳只负责浮层 chrome; 左右分栏放在**内层**。
          `.dialog-surface` 是无 layer 的组件 CSS (自带 `display:flex; flex-direction:column`
          —— 设置弹窗靠它纵向堆头部/主体/底部), 无 layer 样式优先于 Tailwind utilities,
          所以 `flex-row` 覆盖不动它, 只能另起一层 flex 容器。 */}
      <div
        className="dialog-surface w-[980px] max-w-[94vw] h-[620px] max-h-[90vh]"
        role="dialog"
        aria-modal="true"
        aria-labelledby="config-guide-title"
      >
        <div className="flex flex-1 flex-row min-h-0">
          {/* 左侧: 标题 → 选项 → 继承来源 → 步骤指示 → 按钮 */}
          <div className="w-[420px] shrink-0 border-r border-border flex flex-col">
            <div className="px-6 pt-6 pb-4">
              <div className="flex items-center gap-2 text-text-bright text-base font-semibold">
                <Languages size={16} aria-hidden="true" />
                <span id="config-guide-title">{translate('configGuideTitle', lang)}</span>
              </div>
              <p className="text-xs text-text-secondary leading-relaxed m-0 mt-1">
                {translate('configGuideIntro', lang)}
              </p>
              <div className="section-heading mt-4">
                {translate(CONFIG_GUIDE_STEP_LABEL_KEYS[step], lang)}
              </div>
            </div>

            <div className="flex-1 min-h-0 overflow-y-auto px-6 pb-4 flex flex-col gap-2">
              {step === 'language' && (
                <div className="flex flex-col gap-2">
                  {LANGUAGE_OPTIONS.map((option) => {
                    const active = option.value === language;
                    return (
                      <button
                        key={option.value}
                        type="button"
                        aria-pressed={active}
                        className={`px-3 py-2 rounded border text-sm cursor-pointer motion-transition flex items-center justify-between gap-2 ${
                          active
                            ? 'border-accent text-text-bright bg-bg-hover'
                            : 'border-border text-text-secondary hover:bg-bg-hover hover:text-text-primary'
                        }`}
                        onClick={() => {
                          if (option.value === language) return;
                          apply('general', 'language', option.value);
                          markManual('language');
                        }}
                      >
                        <span>{option.label}</span>
                        {active && <Check size={14} aria-hidden="true" />}
                      </button>
                    );
                  })}
                  <InheritanceRow lang={lang} field="general.language" source={sources.language} />
                </div>
              )}

              {step === 'theme' && (
                <div className="flex flex-col gap-2">
                  {themeOptions.map((option) => {
                    const active = option.id === theme;
                    return (
                      <button
                        key={option.id}
                        type="button"
                        aria-pressed={active}
                        className={`px-3 py-2 rounded border cursor-pointer motion-transition flex items-center gap-2 ${
                          active ? 'border-accent bg-bg-hover' : 'border-border hover:bg-bg-hover'
                        }`}
                        onClick={() => {
                          if (option.id === theme) return;
                          apply('appearance', 'theme', option.id);
                          markManual('theme');
                        }}
                      >
                        {/* 色板与主题编辑器预览同一套 token 键 (bgEditor / bgSidebar), 且直接取自
                            主题定义 —— 非当前主题的 CSS 变量此刻并不存在于 :root。 */}
                        <span className="flex h-4 w-8 shrink-0 overflow-hidden rounded-sm border border-border">
                          <span
                            className="flex-1"
                            style={{ backgroundColor: option.tokens.bgEditor }}
                          />
                          <span
                            className="flex-1"
                            style={{ backgroundColor: option.tokens.bgSidebar }}
                          />
                        </span>
                        <span
                          className={`text-sm truncate ${active ? 'text-text-bright' : 'text-text-secondary'}`}
                        >
                          {option.label}
                        </span>
                        {active && <Check size={14} aria-hidden="true" className="ml-auto" />}
                      </button>
                    );
                  })}
                  <InheritanceRow lang={lang} field="appearance.theme" source={sources.theme} />
                </div>
              )}

              {step === 'motion' && (
                <div className="flex flex-col gap-3">
                  {MOTION_FIELDS.map((def) => (
                    <div key={def.field} className="flex items-start justify-between gap-4">
                      <div className="flex-1 min-w-0">
                        <div className="text-sm text-text-primary">{translate(def.labelKey, lang)}</div>
                        <div className="text-xs text-text-secondary leading-relaxed">
                          {translate(def.descKey, lang)}
                        </div>
                      </div>
                      <div className="shrink-0">
                        <SettingsControl
                          def={def}
                          settings={settings}
                          update={(category, field, value) => apply(category, field, value)}
                          setLang={setLang}
                          onEditTheme={() => undefined}
                        />
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className="px-6 pb-6 flex flex-col gap-3">
              <div className="flex items-center gap-2">
                {CONFIG_GUIDE_STEPS.map((entry, index) => {
                  const active = entry === step;
                  return (
                    <button
                      key={entry}
                      type="button"
                      aria-current={active ? 'step' : undefined}
                      className={`px-2 py-1 rounded text-xs cursor-pointer motion-transition ${
                        active
                          ? 'bg-bg-hover text-text-bright'
                          : 'text-text-secondary hover:text-text-primary'
                      }`}
                      onClick={() => setStepIndex(index)}
                    >
                      {index + 1}. {translate(CONFIG_GUIDE_STEP_LABEL_KEYS[entry], lang)}
                    </button>
                  );
                })}
              </div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  className="px-3 py-2 text-sm rounded border border-border text-text-secondary cursor-pointer motion-transition hover:bg-bg-hover hover:text-text-primary disabled:opacity-disabled disabled:cursor-default"
                  disabled={stepIndex === 0}
                  onClick={() => setStepIndex((index) => Math.max(0, index - 1))}
                >
                  <ChevronLeft size={14} aria-hidden="true" className="inline" />
                  <span>{translate('configGuideBack', lang)}</span>
                </button>
                {lastStep ? (
                  <button
                    type="button"
                    className="flex-1 bg-bg-button text-text-inverse border-none py-2 px-4 text-sm font-ui cursor-pointer rounded inline-flex items-center justify-center gap-1.5 transition-colors hover:bg-bg-button-hover"
                    onClick={() => {
                      void confirm();
                    }}
                  >
                    <Check size={14} aria-hidden="true" />
                    <span>{translate('configGuideContinue', lang)}</span>
                  </button>
                ) : (
                  <button
                    type="button"
                    className="flex-1 bg-bg-button text-text-inverse border-none py-2 px-4 text-sm font-ui cursor-pointer rounded inline-flex items-center justify-center gap-1.5 transition-colors hover:bg-bg-button-hover"
                    onClick={() =>
                      setStepIndex((index) => Math.min(CONFIG_GUIDE_STEPS.length - 1, index + 1))
                    }
                  >
                    <span>{translate('configGuideNext', lang)}</span>
                    <ChevronRight size={14} aria-hidden="true" />
                  </button>
                )}
              </div>
            </div>
          </div>

          {/* 右侧: 每步的效果预览。步骤切换的位移作用在内层, 外层负责居中。 */}
          <div className="flex-1 min-w-0 flex flex-col items-center justify-center px-8">
            <div ref={previewRef} className="w-full flex flex-col items-center gap-6">
              <ConfigGuidePreview
                step={step}
                lang={lang}
                tokens={previewTokens}
                brandAnimated={isOpen}
                panelVisible={previewVisible}
              />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

/// 继承来源只读行 —— 语言步与主题步各自显示自己那一条。
function InheritanceRow({
  lang,
  field,
  source,
}: {
  lang: Lang;
  field: string;
  source: ConfigGuideValueSource;
}) {
  return (
    <p className="m-0 mt-1 text-xs text-text-secondary leading-relaxed">
      {translate('configGuideInheritanceTitle', lang)}
      {': '}
      <code>{field}</code>
      {' — '}
      <span>{translate(SOURCE_LABEL_KEYS[source], lang)}</span>
    </p>
  );
}
