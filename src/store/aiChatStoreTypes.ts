import type {
  AiAttachment,
  AiSessionMeta,
  AiToolRun,
  AiTurnEvent,
  AiViewItem,
  McpPortCheck,
  McpPortConflict,
  McpServerConfig,
  McpToolInfo,
} from '../types';

export interface AiChatState {
  /** 会话摘要列表 (后端持有) */
  sessions: AiSessionMeta[];
  /** 当前会话 id */
  activeSessionId: string | null;
  /** 当前会话的视图条目 — 由后端会话水合 */
  viewItems: AiViewItem[];
  /** 正在流式生成 (全局同一时刻至多一个任务) */
  streaming: boolean;
  /** 流式回合所属会话 — 切换会话时气泡只在所属会话内显示 */
  streamingSessionId: string | null;
  /** 当前流式文本聚合 */
  streamingText: string;
  /** 当前推理文本聚合 */
  reasoningText: string;
  /** 当前流式回合的原始事件顺序。 */
  timeline: AiTurnEvent[];
  /** 当前回合的工具调用记录 */
  toolRuns: AiToolRun[];
  /** 进行中的 task_id (可取消) */
  taskId: string | null;
  /** 聚合工具列表缓存 */
  tools: McpToolInfo[];
  /** 外部 server 配置缓存 */
  servers: McpServerConfig[];
  /** 本地 MCP server 状态 */
  serverRunning: boolean;
  serverPort: number | null;
  /** 最近一次启动失败的端口冲突 (成功后为 null) */
  serverConflict: McpPortConflict | null;

  refreshSessions: () => Promise<void>;
  createSession: (title: string) => Promise<void>;
  switchSession: (id: string) => Promise<void>;
  renameSession: (id: string, title: string) => Promise<void>;
  deleteSession: (id: string) => Promise<void>;
  send: (text: string, attachments?: AiAttachment[]) => Promise<void>;
  /** 重新生成 — 截掉最后一条用户条目之后的回合并重跑 */
  regenerate: () => Promise<void>;
  cancel: () => Promise<void>;
  clearSession: () => Promise<void>;
  refreshTools: () => Promise<void>;
  refreshServers: () => Promise<void>;
  refreshServerStatus: () => Promise<void>;
  /** 启动本地 MCP server; 省略 port 时用设置里的端口 */
  startLocalServer: (port?: number) => Promise<void>;
  stopLocalServer: () => Promise<void>;
  /** 设置页改端口: 写入设置; 已在监听时立即切到新端口 */
  changeServerPort: (port: number) => Promise<void>;
  /** 检查候选端口能否用于监听 (后端不可达时返回 null) */
  probePort: (port: number) => Promise<McpPortCheck | null>;
  /** 改用建议端口: 写入设置并按新端口启动 */
  applyPortSuggestion: (port: number) => Promise<void>;
  addServer: (config: McpServerConfig) => Promise<void>;
  removeServer: (id: string) => Promise<void>;
  setServerEnabled: (id: string, enabled: boolean) => Promise<void>;
}
