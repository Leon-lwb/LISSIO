//! 玻璃外观设置 → 档位输入的绑定。
//!
//! 效果层 (`lib/glass`) 按参数判定档位, 但**不订阅 store** —— 它要能在非应用环境
//! (测试、文档生成) 里被按参数调用。订阅这一步住在交互层: 输入 → 意图, 这里把
//! 全局外观设置翻译成 `GlassAppearance`。
//!
//! 订阅面刻意收窄到五个字段: appearance 里其余任何字段变化 (字号、字体、动效档位)
//! 都不该让所有玻璃表面重算档位 —— 那会让改一次字号变成一次全应用的透镜重挂。
//! `useShallow` 按字段逐一比较, 外观对象每次更新都会换引用, 不用它就会全量重渲染。

import { useShallow } from 'zustand/react/shallow';
import { useSettingsStore } from '../../store/settingsStore';
import type { GlassAppearance } from '../../types';

export function useGlassAppearance(): GlassAppearance {
  return useSettingsStore(
    useShallow((s) => {
      const { appearance } = s.settings;
      return {
        liquidGlass: appearance.liquidGlass,
        liquidGlassPreset: appearance.liquidGlassPreset,
        liquidGlassIntensity: appearance.liquidGlassIntensity,
        acrylicBackground: appearance.acrylicBackground,
        floatingGlass: appearance.floatingGlass,
      };
    }),
  );
}
