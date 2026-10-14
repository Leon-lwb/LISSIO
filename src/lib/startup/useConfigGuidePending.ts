//! 配置引导闸门的唯一计算点。
//!
//! `App` (启动弹窗串行) 与 `useStartupDialogs` (触发时机) 必须看到同一个"引导是否待
//! 确认", 否则两处会各自维护一份订阅并漂移 —— 这里把全部输入收敛到一处。

import { useConfigGuideStore } from '../../store/configGuideStore';
import { useSettingsStore } from '../../store/settingsStore';
import { useUpdateStore } from '../../store/updateStore';
import { needsConfigGuide } from './configGuide';

/// 引导是否还挡在后续启动弹窗前面。
export function useConfigGuidePending(): boolean {
  const settingsLoaded = useSettingsStore((s) => s.loaded && s.loadError === null);
  const sources = useSettingsStore((s) => s.configGuideSources);
  const lastSeenVersion = useSettingsStore((s) => s.settings.general.lastSeenVersion);
  const showConfigGuide = useSettingsStore((s) => s.settings.general.showConfigGuide);
  const remoteConfigGuide = useUpdateStore((s) => s.remoteConfigGuide);
  const completedThisSession = useConfigGuideStore((s) => s.completedThisSession);
  return (
    !completedThisSession &&
    needsConfigGuide({
      settingsLoaded,
      sources,
      lastSeenVersion,
      showConfigGuide,
      remoteConfigGuide,
    })
  );
}
