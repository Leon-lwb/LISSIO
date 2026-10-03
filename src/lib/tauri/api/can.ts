import { transport } from '../../rpc';
import { subscribeDisplay } from '../../buffers/displaySubscription';
import type { CanLoadSnapshot } from '../../../types';

export const canApi = {
  getCanLoadStats: (nodeId: string, bitrateBps?: number | null) =>
    transport.call<CanLoadSnapshot>('get_can_load_stats', {
      nodeId,
      bitrateBps: bitrateBps ?? null,
    }),

  /// 设置 CAN 负载统计滑动窗口大小 (微秒)
  setCanLoadWindow: (windowUs: number) =>
    transport.call<void>('set_can_load_window', { windowUs }),

  /// 清空 CAN 负载统计
  clearCanLoadStats: () => transport.call<void>('clear_can_load_stats'),

  /// 获取当前 CAN 波特率 (从 TransportConfig 提取)
  /// 返回 [bps, source] — source = "slcan" / "candle" / "default"
  getCurrentCanBitrate: (nodeId: string) =>
    transport.call<[number, string]>('get_current_can_bitrate', { nodeId }),

  /// 订阅 CAN 负载统计推送 — 周期性推送 CanLoadSnapshot
  /// nodeId: 用于自动解析波特率的设备节点 id
  /// intervalMs: 推送间隔 (默认 500ms)
  /// bitrateBps: 可选手动覆盖波特率; null/0 = 自动从 TransportConfig 读取
  subscribeCanLoad: (
    nodeId: string,
    onEvent: (snap: CanLoadSnapshot) => void,
    options?: { intervalMs?: number; bitrateBps?: number | null },
  ) => {
    const subscription = subscribeDisplay<CanLoadSnapshot>(
      {
        kind: 'can_load',
        node_id: nodeId,
        bitrate_bps: options?.bitrateBps ?? null,
      },
      'can_load',
      onEvent,
      { intervalMs: options?.intervalMs ?? 500 },
    );
    return {
      promise: Promise.resolve(),
      cancel: subscription.cancel,
    };
  },

  /// 导出 CAN 负载统计为 CSV (自动保存到下载目录, 返回完整文件路径)
  /// nodeId: 用于自动解析波特率的设备节点 id
  /// bitrateBps: 可选手动覆盖波特率; null/0 = 自动从 TransportConfig 读取
  exportCanLoadCsv: (nodeId: string, bitrateBps?: number | null) =>
    transport.call<string>('export_can_load_csv', {
      nodeId,
      bitrateBps: bitrateBps ?? null,
    }),

  // ===== 帧解码器手动测试 =====
  /// 解析用户输入字符串为帧 (使用 blocks 配置创建临时 FrameParser, 调用 parse_once)
  /// 返回 outputs (端口→值) + valid + consumedBytes + 可选 error
};
