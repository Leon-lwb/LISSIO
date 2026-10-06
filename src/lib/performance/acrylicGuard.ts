/// 亚克力性能守护 — 帧率持续偏低时提醒用户关闭亚克力/透明效果。
///
/// 复用 FrontendPerformanceCollector 已经采集的 rAF 帧率 (每秒经 performanceStore 落地),
/// 不额外起帧循环, 判定本身零渲染开销。判据:
///   - 启动预热: 前 WARMUP_SAMPLES 个采样点不参与判定 (启动加载本身偏慢, 会误报)
///   - fps <= 0 的采样点跳过: 窗口最小化/后台时 rAF 暂停, 采样器无帧可算,
///     这代表"没有渲染"而不是"渲染卡", 不能作为卡顿判据
///   - 连续 LOW_FPS_SAMPLES 个采样点 (每点约 1s) 低于 LOW_FPS_THRESHOLD 才提醒
/// 仅在 appearance.acrylicBackground 开启时提醒, 且每个应用会话至多一次:
/// 用户点「关闭亚克力」后功能已关闭, 忽略提醒也不再打扰。

import { notify } from '../tauri/notifications';
import { translate } from '../../i18n';
import { useAppStore } from '../../store/appStore';
import { usePerformanceStore } from '../../store/performanceStore';
import { useSettingsStore } from '../../store/settingsStore';
import type { FrontendPerformanceSnapshot } from '../../types';

/// 低于该帧率视为卡顿
export const LOW_FPS_THRESHOLD = 45;
/// 连续多少个采样点 (每点约 1s) 低于阈值才提醒
export const LOW_FPS_SAMPLES = 2;
/// 启动预热采样点数
export const WARMUP_SAMPLES = 3;

/// 判定状态机 — 与 store/通知解耦, 便于单测。
export class AcrylicGuardState {
  private samples = 0;
  private lowStreak = 0;
  private notified = false;

  /// 消费一个采样点; 返回 true 表示此刻应当提醒 (并标记本会话已提醒)
  observe(fps: number | null, acrylicEnabled: boolean): boolean {
    this.samples += 1;
    if (this.samples <= WARMUP_SAMPLES) return false;
    // 无有效帧率: 窗口不可见/暂停采样 (fps = 0) 或采样器未启动 (null)
    if (fps === null || fps <= 0) {
      this.lowStreak = 0;
      return false;
    }
    if (fps >= LOW_FPS_THRESHOLD) {
      this.lowStreak = 0;
      return false;
    }
    this.lowStreak += 1;
    if (this.lowStreak < LOW_FPS_SAMPLES || this.notified) return false;
    // 亚克力没开就无从关闭, 不提醒; 下次采样若已开启且仍卡顿会再次判定
    if (!acrylicEnabled) return false;
    this.notified = true;
    return true;
  }

  /// 是否已判定效果过重。液态玻璃档据此降级到高斯模糊档。
  hasTriggered(): boolean {
    return this.notified;
  }
}

function disableAcrylic(): void {
  useSettingsStore.getState().update('appearance', 'acrylicBackground', false);
}

const guard = new AcrylicGuardState();
const subscribers = new Set<() => void>();
let unsubscribe: (() => void) | null = null;
let lastSample: FrontendPerformanceSnapshot | null = null;

function evaluate(): void {
  const sample = usePerformanceStore.getState().frontend;
  // performanceStore 每秒推送新采样点; 引用未变说明是其它字段更新
  if (!sample || sample === lastSample) return;
  lastSample = sample;
  const acrylicEnabled =
    useSettingsStore.getState().settings.appearance.acrylicBackground === true;
  if (!guard.observe(sample.fps, acrylicEnabled)) return;

  // 通知前端: 折射档需要在本帧之后降级, 否则用户会先看到一次卡顿再看到提示
  for (const onChange of subscribers) onChange();

  const lang = useAppStore.getState().lang;
  notify.warn(
    translate('performanceAcrylicHeavyTitle', lang),
    translate('performanceAcrylicHeavyMessage', lang),
    {
      source: 'performance-acrylic',
      // 常驻直到用户处理: 带操作按钮的提示若自动消失, 用户错过就再也不会看到
      durationMs: 0,
      actions: [{ label: translate('performanceAcrylicDisable', lang), run: disableAcrylic }],
    }
  );
}

/// 启动守护 — 返回取消订阅函数, 供 React effect 清理。
export function startAcrylicPerformanceGuard(): () => void {
  if (unsubscribe) return unsubscribe;
  unsubscribe = usePerformanceStore.subscribe(evaluate);
  return () => {
    unsubscribe?.();
    unsubscribe = null;
    lastSample = null;
  };
}

/// 守护是否已判定"效果过重"。液态玻璃档据此降级到高斯模糊档, 于是同一次
/// 帧率告警同时约束两个档位, 而不必为折射单独再写一套阈值。
///
/// 与既有行为保持一致: 只在亚克力开启时可能为 true。
export function acrylicGuardActive(): boolean {
  return (
    useSettingsStore.getState().settings.appearance.acrylicBackground === true &&
    guard.hasTriggered()
  );
}

/// 订阅守护状态变化 — 供玻璃档位在用户点「关闭」后重新判定。
export const acrylicGuard = {
  subscribe(onChange: () => void): () => void {
    subscribers.add(onChange);
    return () => {
      subscribers.delete(onChange);
    };
  },
};
