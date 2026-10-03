import { transport } from '../../rpc';

import type {
  CommandFrame,
  CommandSendOutcome,
  LoopbackResult,
  PortInfo,
  ProtocolConfig,
  ProtocolSchema,
  RunAction,
  RunSnapshot,
  SendTaskRegistration,
  TransportConfig,
  WidgetBinding,
} from '../../../types';

export const transportApi = {
  listPorts: () => transport.call<PortInfo[]>('list_ports'),

  /// 打开传输连接; protocol 仅被 TestData 用作生成数据的线缆格式参考
  /// schema: 可选帧 schema (custom 且带 encode 块时 TestData 按 schema 编码)
  closeTransport: (nodeId: string) =>
    transport.call<void>('close_transport', { nodeId }),

  sendRaw: (nodeId: string, data: number[]) =>
    transport.call<void>('send_raw', { nodeId, data }),

  sendString: (nodeId: string, text: string) =>
    transport.call<void>('send_string', { nodeId, text }),

  /// TextOut 手动发送: 立即把图内当前文本发往该 TextOut 节点的目标 Transport
  sendTextOutNow: (nodeId: string) =>
    transport.call<void>('send_text_out_now', { nodeId }),

  /// protocolNode: Auto 编码所用的 Protocol 节点 id (Manual 模式可传 null)
  sendWidgetValue: (
    nodeId: string,
    protocolNode: string | null,
    binding: WidgetBinding,
    value: number,
  ) =>
    transport.call<void>('send_widget_value', { nodeId, protocolNode, binding, value }),

  /// 运行时热更新传输节点的链路协议 (图/协议变化后推送, 无需重连)
  /// schema: 可选帧 schema (与 openTransport 语义一致)
  updateTransportProtocol: (
    nodeId: string,
    protocol: ProtocolConfig,
    schema?: ProtocolSchema | null,
    testDataConfig?:
      Extract<TransportConfig, { kind: 'TestData' }>['params'] | null,
  ) =>
    transport.call<void>('update_transport_protocol', {
      nodeId,
      protocol,
      schema: schema ?? null,
      testDataConfig: testDataConfig ?? null,
    }),

  /// 协议回环: 发送字节并立即捕获指定 Protocol 节点的解析结果
  sendAndCapture: (nodeId: string, protocolNode: string, data: number[]) =>
    transport.call<LoopbackResult>('send_and_capture', {
      nodeId,
      protocolNode,
      data,
    }),

  /// 命令发送帧字节打包 — 后端 `compute_command_frame_bytes` IPC 单一权威
  /// (预览专用入口; 发送走 sendCommandFrame 统一内核)
  computeFrameBytes: (
    frame: CommandFrame,
    inputs: Record<string, number>,
  ) =>
    transport.call<{
      bytes: number[] | null;
      error: string | null;
      per_block: number[][];
    }>('compute_command_frame_bytes', { frame, inputs }),

  /// 命令帧手动发送 — 统一发送内核 (与预览同一编码、与后台自动发送同一路由):
  /// 运行态门控 → compute_frame_bytes 编码 → 全局 BytePlan 字节边下发
  sendCommandFrame: (
    widgetId: string,
    frame: CommandFrame,
    inputs: Record<string, number>,
  ) =>
    transport.call<CommandSendOutcome>('send_command_frame', { widgetId, frame, inputs }),

  /// 注册/替换 Command widget 的后台自动发送任务 (空数组 = 注销该 widget)。
  /// 发送触发完全在 Rust 侧 — 前端不持有任何发送定时器
  setWidgetSendTasks: (widgetId: string, tasks: SendTaskRegistration[]) =>
    transport.call<number>('set_widget_send_tasks', { widgetId, tasks }),

  /// 工作区运行控制 — start (启动/恢复) / pause / stop; 返回切换后快照
  workspaceRun: (action: RunAction) =>
    transport.call<RunSnapshot>('workspace_run', { action }),

  /// 读取当前运行快照 (水合用, 无事件)
  getWorkspaceRunState: () => transport.call<RunSnapshot>('get_workspace_run_state'),

  // ===== 协议 (nodeId = 图中 Protocol 节点 id) =====
};
