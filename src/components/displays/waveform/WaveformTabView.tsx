// ============ 波形面板视图 ============
//
// 波形是唯一需要停靠级缓冲状态的视图 (源缓冲 + 后端测量流 + 每控件示波配置),
// 因此它的编排与视图一并自持, 而不是由 DataTabContent 组装后下发:
//
//   - 源 (sourceId) 由输入边向上溯源到 Protocol 节点; 固定 tab 用主 Protocol 节点
//   - 时基 / 通道配置按 widgetId 存于 waveformScopeStore, tab 在卡片间移动或
//     拆分为独立面板时配置不丢失
//   - 测量 (统计 / 周期) 在后端权威缓冲上计算, 随时基窗口重订阅, 与测试数据源
//     彻底解耦
//
// 画布控件回收 (waveformScopeStore.pruneWidgets) 是 store 级卫生, 不随本视图
// 挂载 —— 留在 DataTabContent。

import { memo, useCallback, useEffect, useMemo } from 'react';
import { useAppStore } from '../../../store/appStore';
import { translate } from '../../../i18n';
import { WaveformChart } from './WaveformChart';
import { AxisSettings } from './AxisSettings';
import { api } from '../../../lib/tauri/tauri';
import { formatTimeBase, timeBaseToWindowMs } from '../../../types';
import { waveformWindow, type WaveformWindowCache } from '../../../lib/buffers/dataBuffer';
import { computeConnectedInputs, type ConnectedInput } from './waveformSeries';
import {
  useWaveformScopeStore,
  createPerWidgetState,
  type MeasurementsBundle,
} from '../../../store/waveformScopeStore';
import { useWaveformSourceBuffer } from '../../../lib/hooks/useWaveformSourceBuffer';
import { useWaveformMeasurements } from '../../../lib/hooks/useWaveformMeasurements';
import { setWaveformOverviewActive } from '../../../lib/buffers/sourceManagers';
import { usePanelFollowing, usePanelGoLive } from '../common/PanelLiveness';
import { traceProtocolSource } from '../../../store/appStoreHelpers';
import type { ProtocolConfig, ScopeAxisConfig, WidgetConfig } from '../../../types';
import type { PanelTabViewProps } from '../../panels/registry/panelTypes';

interface WaveformScopeViewProps {
  widget: Extract<WidgetConfig, { kind: 'Waveform' }>;
  axisConfig: ScopeAxisConfig;
  measurementBundle: MeasurementsBundle | null;
  measureChannel: number | null;
  autosetWarning: string | null;
  channelCount: number;
  buffer: WaveformWindowCache;
  sourceId: string | null;
  onConfigChange: (next: ScopeAxisConfig) => void;
  onAutoSet: () => void;
  onMeasureChannel: (channel: number | null) => void;
}

/// 波形绘制 + AxisSettings 侧栏, 每个数据 Tab 一个实例。
const WaveformScopeView = memo(function WaveformScopeView({
  widget,
  axisConfig,
  measurementBundle,
  measureChannel,
  autosetWarning,
  channelCount,
  buffer,
  sourceId,
  onConfigChange,
  onAutoSet,
  onMeasureChannel,
}: WaveformScopeViewProps) {
  return (
    <div className="flex h-full w-full">
      <div className="flex-1 min-w-0 relative">
        <WaveformChart
          widget={widget}
          axisConfig={axisConfig}
          onConfigChange={onConfigChange}
          buffer={buffer}
          sourceId={sourceId}
        />
      </div>
      <div className="w-[256px] shrink-0 border-l border-border bg-bg-sidebar overflow-y-auto overflow-x-hidden">
        <AxisSettings
          config={axisConfig}
          onChange={onConfigChange}
          channelCount={channelCount}
          measurementBundle={measurementBundle}
          measureChannel={measureChannel}
          autosetWarning={autosetWarning}
          onAutoSet={onAutoSet}
          onMeasureChannel={onMeasureChannel}
        />
      </div>
    </div>
  );
});

/// 波形数据面板视图 — 面板注册表 `waveform` 项的实现。
export const WaveformTabView = memo(function WaveformTabView({ widget }: PanelTabViewProps) {
  const lang = useAppStore((s) => s.lang);
  const rfEdges = useAppStore((s) => s.rfEdges);
  const rfNodes = useAppStore((s) => s.rfNodes);
  // 主 Protocol 节点 (第一个) 的配置与检测通道数 — 固定波形 Tab 的通道数依据
  const primaryProtocolId = useMemo(
    () => rfNodes.find((n) => n.type === 'protocol' && n.data?.global === true)?.id ?? null,
    [rfNodes]
  );
  const primaryProtocolConfig = useMemo(() => {
    const n = rfNodes.find((x) => x.id === primaryProtocolId);
    return n ? ((n.data as { config?: ProtocolConfig }).config ?? null) : null;
  }, [rfNodes, primaryProtocolId]);
  const detectedChannels = useAppStore((s) =>
    primaryProtocolId ? (s.detectedChannels[primaryProtocolId] ?? null) : null
  );
  // channel_count 仅在协议/检测变化时改变, 窗口缓存直读即可
  const winChannelCount = waveformWindow.get().channel_count;

  // 计算默认波形的通道数: 自动模式优先用检测到的通道数, 其次用窗口缓存, 最后兜底 4
  const defaultChannelCount = useMemo(() => {
    if (!primaryProtocolConfig) return winChannelCount || 4;
    if (
      primaryProtocolConfig.kind === 'RawData' ||
      primaryProtocolConfig.kind === 'Slcan' ||
      primaryProtocolConfig.kind === 'CandleLight' ||
      primaryProtocolConfig.kind === 'LogicDecode'
    ) {
      return 4;
    }
    if (primaryProtocolConfig.kind === 'Diagnostic') {
      // 诊断协议走独立管线, 不产数值通道; 波形默认占位与其他无通道协议一致
      return 4;
    }
    return primaryProtocolConfig.channels ?? detectedChannels ?? (winChannelCount || 4);
  }, [primaryProtocolConfig, detectedChannels, winChannelCount]);

  // 默认波形控件 (固定 Tab 使用)
  const defaultWaveformWidget: Extract<WidgetConfig, { kind: 'Waveform' }> = useMemo(
    () => ({
      kind: 'Waveform',
      params: {
        id: 'default-waveform',
        label: 'Waveform',
        channels: defaultChannelCount,
        max_points: 10000,
        visible_channels: Array.from({ length: defaultChannelCount }, () => true),
      },
    }),
    [defaultChannelCount]
  );

  const hostWidget = widget?.kind === 'Waveform' ? widget : undefined;
  const waveWidget = hostWidget ?? defaultWaveformWidget;
  const wid = waveWidget.params.id;
  const channelCount = waveWidget.params.channels;

  // 波形数据源: 固定 Tab = 主 Protocol 节点; 控件波形 = 输入边向上溯源到的 Protocol 节点
  // (无连接时 sourceId 为 null → 空缓冲, 不订阅)
  const waveSourceId = useMemo(() => {
    if (wid === 'default-waveform') return primaryProtocolId;
    return traceProtocolSource(wid, rfEdges, rfNodes);
  }, [wid, primaryProtocolId, rfEdges, rfNodes]);
  const waveBuffer = useWaveformSourceBuffer(waveSourceId);

  const ensureWidget = useWaveformScopeStore((s) => s.ensureWidget);
  const setConfig = useWaveformScopeStore((s) => s.setConfig);
  const setMeasureChannel = useWaveformScopeStore((s) => s.setMeasureChannel);
  const setAutosetWarning = useWaveformScopeStore((s) => s.setAutosetWarning);
  const widgetState = useWaveformScopeStore((s) => s.states[wid]);

  // 波形 state 兜底 — memo 保持引用稳定, 避免每次渲染新建对象击穿 WaveformScopeView memo
  const fallbackState = useMemo(() => createPerWidgetState(channelCount), [channelCount]);
  const widgetScopeState = widgetState ?? fallbackState;

  // 波形图的派生序列 (MATH/Filter 接入) — 与图上 series 同一语义, 参与
  // 后端测量与 AutoSet 周期检测 (慢派生波形必须驱动时基)
  const derivedSelectors = useMemo(() => {
    if (wid === 'default-waveform') return [];
    return computeConnectedInputs(wid, channelCount, rfEdges)
      .filter((i): i is Extract<ConnectedInput, { kind: 'derived' }> => i.kind === 'derived')
      .map((i) => ({
        sink_id: wid,
        source_id: i.sourceId,
        source_handle: i.sourceHandle,
      }));
  }, [wid, channelCount, rfEdges]);
  const derivedSelectorsKey = JSON.stringify(derivedSelectors);

  // 后端测量流 — 统计/周期在权威缓冲上计算, 随时基窗口重订阅。
  // 测量与测试数据源彻底解耦: 只依赖 (sourceId, 当前时基窗口)。
  useWaveformMeasurements({
    sourceId: waveSourceId,
    windowMs: timeBaseToWindowMs(widgetScopeState.config.timeBase),
    derivedSelectors,
    widgetId: wid,
    channelCount,
  });

  // 波形停止时暂停概览推送 (后端不再空转全缓冲 min-max), 恢复运行时重订阅
  const waveRunning = widgetScopeState.config.running;
  useEffect(() => {
    if (waveSourceId) setWaveformOverviewActive(waveSourceId, waveRunning);
  }, [waveSourceId, waveRunning]);

  // 显示时效: 跟随最新 = 实时跟随开启且水平延迟为 0 (hPosition > 0 = 回看历史)
  const reportFollowing = usePanelFollowing();
  const waveFollowing = waveRunning && widgetScopeState.config.hPosition === 0;
  useEffect(() => {
    reportFollowing(waveFollowing);
  }, [reportFollowing, waveFollowing]);

  // 从暂停恢复 → 统一跳最新: 复位水平延迟并恢复实时跟随 (详情/测量流随之重订阅)
  const handleGoLive = useCallback(() => {
    const current = useWaveformScopeStore.getState().states[wid]?.config;
    if (!current || (current.running && current.hPosition === 0)) return;
    setConfig(wid, channelCount, { ...current, hPosition: 0, running: true });
  }, [wid, channelCount, setConfig]);
  usePanelGoLive(handleGoLive);

  // 懒初始化 + 通道数扩展
  useEffect(() => {
    ensureWidget(wid, channelCount);
  }, [wid, channelCount, ensureWidget]);

  /// 稳定回调 — 仅在 widget 身份 / 连线变化时重建, 保证 memo 分支在无关重渲染时跳过
  const handleConfigChange = useCallback(
    (next: ScopeAxisConfig) => setConfig(wid, channelCount, next),
    [wid, channelCount, setConfig]
  );

  const handleMeasureChannel = useCallback(
    (channel: number | null) => setMeasureChannel(wid, channelCount, channel),
    [wid, channelCount, setMeasureChannel]
  );

  /// AutoSet — 后端周期检测 + 1-2-5 拟合 (原始层/金字塔快照), 前端仅合并建议。
  /// 时间轴: 检测周期 × 4 个周期; 不可测时回退最近数据窗口拟合。
  const handleAutoSet = useCallback(() => {
    if (!waveSourceId) return;
    // 读最新 config (不经 selector 依赖), 避免测量更新导致回调重建
    const curConfig =
      useWaveformScopeStore.getState().states[wid]?.config ??
      createPerWidgetState(channelCount).config;
    const currentVPerDiv = curConfig.channels.map((c) => c.vPerDiv);
    const derived = JSON.parse(derivedSelectorsKey) as typeof derivedSelectors;
    void api
      .computeWaveformAutoset(waveSourceId, [], derived, curConfig.sharedY, currentVPerDiv)
      .then((suggestion) => {
        const nextChannels = curConfig.channels.slice();
        suggestion.channels.forEach((fit, idx) => {
          while (nextChannels.length <= idx) {
            nextChannels.push({ vPerDiv: 1, position: 0, show: true, coupling: 'DC' });
          }
          nextChannels[idx] = {
            ...nextChannels[idx],
            vPerDiv: fit.v_per_div,
            position: fit.position,
          };
        });
        setConfig(wid, channelCount, {
          ...curConfig,
          timeBase: suggestion.time_base_sec,
          channels: nextChannels,
          hPosition: suggestion.h_position,
          running: suggestion.running,
        });
        // 钳位/压扁风险提示 (一次性, 显示在面板顶部)
        let warning: string | null = null;
        if (suggestion.clamped) {
          warning = translate('autosetClampedWarning', lang)
            .replace('{actual}', formatTimeBase(suggestion.time_base_sec))
            .replace('{requested}', formatTimeBase(suggestion.requested_window_sec / 10));
        } else if (suggestion.shared_y_span_risk) {
          warning = translate('autosetSpanRiskWarning', lang);
        }
        setAutosetWarning(wid, channelCount, warning);
      })
      .catch((e: unknown) => console.error('自动设置失败:', e));
  }, [wid, channelCount, waveSourceId, derivedSelectorsKey, setConfig, setAutosetWarning, lang]);

  return (
    <WaveformScopeView
      widget={waveWidget}
      axisConfig={widgetScopeState.config}
      measurementBundle={widgetScopeState.measurements}
      measureChannel={widgetScopeState.measureChannel}
      autosetWarning={widgetScopeState.autosetWarning}
      channelCount={channelCount}
      buffer={waveBuffer}
      sourceId={waveSourceId}
      onConfigChange={handleConfigChange}
      onAutoSet={handleAutoSet}
      onMeasureChannel={handleMeasureChannel}
    />
  );
});
