//! 配置引导右侧的效果预览 —— 每步一份, 全部用当前选中主题的 token 上色。
//!
//! 与左侧选项分开成文件: 主组件已经接近前端 500 行预算, 而预览这一半只依赖
//! "当前步 + 语言 + 主题 token + 品牌是否动画", 没有自己的状态。
//!
//! - 语言步: 品牌标志 (循环动画) + 真实界面文案样例
//! - 主题步: 用主题 token 上色的迷你界面 + 语义色板
//! - 动画与磨砂步: `MotionPresence` 驱动的迷你面板压在主题色底纹上 —— 底纹是必需的,
//!   磨砂压在纯色上几乎看不出来

import { MotionPresence } from '../../lib/motion';
import { translate, type Lang } from '../../i18n';
import type { ThemeToken } from '../../settings/theme';
import { LissajousMark } from '../brand/LissajousMark';
import type { ConfigGuideStep } from './configGuideSteps';

/// 右侧"文字样例"用真实界面文案, 而不是为预览另造句子。
const LANGUAGE_SAMPLE_KEYS = [
  'settingsTitle',
  'helpCenterTitle',
  'settingLanguage',
  'settingLanguageDesc',
  'tourNext',
  'tourFinish',
] as const;

/// 迷你面板列表行的键 (只是 React key, 不参与文案)。
const PANEL_ROW_KEYS = ['waveform', 'can', 'logic'] as const;

/// 色板展示的语义色, 顺序即视觉顺序。
const SWATCH_TOKENS = ['accent', 'green', 'yellow', 'blue', 'purple'] as const;

export interface ConfigGuidePreviewProps {
  step: ConfigGuideStep;
  lang: Lang;
  /// 选中主题的完整 token 表 (含自定义主题)。
  tokens: Record<ThemeToken, string>;
  /// 品牌标志是否播放循环动画。
  brandAnimated: boolean;
  /// 动画步迷你面板的进场目标。
  panelVisible: boolean;
}

export function ConfigGuidePreview({
  step,
  lang,
  tokens,
  brandAnimated,
  panelVisible,
}: ConfigGuidePreviewProps) {
  if (step === 'language') {
    return (
      <>
        <LissajousMark size={220} animated={brandAnimated} />
        <div className="w-full max-w-[320px] flex flex-col gap-1.5">
          <div className="section-heading">{translate('configGuidePreviewLanguage', lang)}</div>
          {LANGUAGE_SAMPLE_KEYS.map((key) => (
            <div key={key} className="text-sm text-text-secondary truncate">
              {translate(key, lang)}
            </div>
          ))}
        </div>
      </>
    );
  }

  if (step === 'theme') {
    return (
      <div className="w-full max-w-[380px] flex flex-col gap-3">
        <div className="section-heading">{translate('configGuidePreviewTheme', lang)}</div>
        {/* 迷你界面样例直接用选中主题的 token 上色 —— 主题定义是颜色单一来源,
            非当前主题的 CSS 变量此刻并不存在。 */}
        <div
          className="rounded-lg border overflow-hidden"
          style={{ backgroundColor: tokens.bgWindow, borderColor: tokens.border }}
        >
          <div
            className="px-3 py-1.5 text-xs"
            style={{ backgroundColor: tokens.bgPanelHeader, color: tokens.textSecondary }}
          >
            {translate('configGuidePreviewTitleBar', lang)}
          </div>
          <div className="flex h-32">
            <div
              className="w-1/4 px-2 py-2 text-xs"
              style={{ backgroundColor: tokens.bgSidebar, color: tokens.textSecondary }}
            >
              {translate('configGuidePreviewSidebar', lang)}
            </div>
            <div
              className="flex-1 px-3 py-2 flex flex-col justify-between"
              style={{ backgroundColor: tokens.bgEditor, color: tokens.textPrimary }}
            >
              <span className="text-xs">{translate('configGuidePreviewCanvas', lang)}</span>
              <span
                className="self-start rounded px-2 py-1 text-xs"
                style={{ backgroundColor: tokens.bgButton, color: tokens.textInverse }}
              >
                {translate('configGuidePreviewAction', lang)}
              </span>
            </div>
          </div>
          <div
            className="px-3 py-1 text-xs"
            style={{ backgroundColor: tokens.bgStatusbar, color: tokens.textSecondary }}
          >
            {translate('configGuidePreviewStatusBar', lang)}
          </div>
        </div>
        <div className="flex gap-1.5">
          {SWATCH_TOKENS.map((token) => (
            <span
              key={token}
              className="h-5 flex-1 rounded-sm border border-border"
              style={{ backgroundColor: tokens[token] }}
            />
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="w-full max-w-[380px] flex flex-col gap-3">
      <div className="section-heading">{translate('configGuidePreviewMotion', lang)}</div>
      {/* 磨砂压在纯色上几乎看不出来, 所以先铺一层主题色底纹, 浮层压上去才看得见
          二级卡片磨砂开关的差异。 */}
      <div
        className="relative h-[236px] rounded-lg border overflow-hidden"
        style={{ borderColor: tokens.border, backgroundColor: tokens.bgWindow }}
      >
        <div
          className="absolute inset-0"
          style={{
            backgroundImage: `linear-gradient(135deg, ${tokens.bgButton}, ${tokens.accent} 45%, ${tokens.purple})`,
          }}
        />
        <div className="absolute inset-3 flex items-center">
          <MotionPresence
            visible={panelVisible}
            variant="window"
            origin="bottom center"
            // 只放大几何 (位移/缩放), 时序仍由 `window` 家族的弹簧按实测位移解算 ——
            // 预览要看得见, 但不自造时长。
            travel={{ x: 0, y: 36 }}
            scale={0.94}
            className="dialog-surface w-full p-3 flex flex-col gap-2"
          >
            {/* 迷你面板: 标题栏 + 三条列表行 + 一个强调按钮, 全部用当前主题 token. */}
            <div className="flex items-center gap-1.5">
              <span className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: tokens.red }} />
              <span
                className="h-1.5 w-1.5 rounded-full"
                style={{ backgroundColor: tokens.yellow }}
              />
              <span className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: tokens.green }} />
              <span className="ml-auto text-[10px]" style={{ color: tokens.textSecondary }}>
                Lissio
              </span>
            </div>
            {PANEL_ROW_KEYS.map((row) => (
              <div key={row} className="flex items-center gap-2">
                <span
                  className="h-4 w-4 shrink-0 rounded-sm"
                  style={{ backgroundColor: tokens.accent }}
                />
                <span
                  className="h-2 flex-1 rounded-full"
                  style={{ backgroundColor: tokens.bgHover }}
                />
              </div>
            ))}
            <span
              className="self-start rounded px-2 py-0.5 text-[10px]"
              style={{ backgroundColor: tokens.bgButton, color: tokens.textInverse }}
            >
              {translate('configGuidePreviewAction', lang)}
            </span>
          </MotionPresence>
        </div>
      </div>
      <p className="m-0 text-xs text-text-secondary leading-relaxed">
        {translate('configGuidePreviewMotionDesc', lang)}
      </p>
    </div>
  );
}
