//! 配置引导的步骤词汇 —— 左侧选项、步骤指示与右侧预览共用同一份定义。
//!
//! 单独成文件是为了让"步骤"只有一处来源: 主组件与预览组件都要用它, 而两者互相 import
//! 会形成环。

export const CONFIG_GUIDE_STEPS = ['language', 'theme', 'motion'] as const;

export type ConfigGuideStep = (typeof CONFIG_GUIDE_STEPS)[number];

export const CONFIG_GUIDE_STEP_LABEL_KEYS: Record<ConfigGuideStep, string> = {
  language: 'configGuideStepLanguage',
  theme: 'configGuideStepTheme',
  motion: 'configGuideStepMotion',
};

/// 步骤切换时右侧预览的进场位移, px (方向感: 前进从右来, 后退从左来)。
export const CONFIG_GUIDE_PREVIEW_TRAVEL_PX = 56;
