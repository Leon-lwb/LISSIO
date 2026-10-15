import { transport } from '../../rpc';
import type { EventChannel } from '../../rpc/types';

import type {
  AiAttachment,
  AiChatEvent,
  AiChatSession,
  AiProviderConfig,
  AiSecretStatus,
  AiSessionMeta,
  AiWebFetchPage,
  McpPortCheck,
  McpServerConfig,
  McpServerStatus,
  McpToolInfo,
} from '../../../types';

export const aiApi = {
  aiChatSend: (
    sessionId: string,
    text: string | null,
    attachments: AiAttachment[] | null,
    regenerate: boolean,
    config: AiProviderConfig,
    useMcpTools: boolean,
    useBuiltinTools: boolean,
    useWebTools: boolean,
    uiLang: string,
    onEvent: EventChannel<AiChatEvent>,
  ) =>
    transport.call<string>('ai_chat_send', {
      sessionId,
      text,
      attachments: attachments ?? null,
      regenerate,
      config,
      useMcpTools,
      useBuiltinTools,
      useWebTools,
      uiLang,
      onEvent,
    }),

  /// Raw HTML for the frontend Readability/Turndown pipeline.
  aiFetchWebpageHtml: (url: string) =>
    transport.call<AiWebFetchPage>('ai_fetch_webpage_html', { url }),

  /// 取消进行中的对话任务, 返回任务是否存在
  aiChatCancel: (taskId: string) =>
    transport.call<boolean>('ai_chat_cancel', { taskId }),

  /// 全部对话会话摘要
  chatListSessions: () => transport.call<AiSessionMeta[]>('chat_list_sessions'),

  /// 新建会话
  chatCreateSession: (title: string) =>
    transport.call<AiChatSession>('chat_create_session', { title }),

  /// 读取单个会话 (含全部条目); 不存在返回 null
  chatGetSession: (sessionId: string) =>
    transport.call<AiChatSession | null>('chat_get_session', { sessionId }),

  /// 重命名会话
  chatRenameSession: (sessionId: string, title: string) =>
    transport.call<void>('chat_rename_session', { sessionId, title }),

  /// 删除会话
  chatDeleteSession: (sessionId: string) =>
    transport.call<void>('chat_delete_session', { sessionId }),

  /// 清空会话条目 (保留会话本身)
  chatClearSession: (sessionId: string) =>
    transport.call<void>('chat_clear_session', { sessionId }),

  /// 读取适配器的密钥状态；不返回明文。
  aiSecretStatus: (adapter: string) =>
    transport.call<AiSecretStatus>('ai_secret_status', { adapter }),

  /// 写入后端 SecretStore；响应只含状态，不回传明文。
  aiSecretSet: (adapter: string, key: string) =>
    transport.call<AiSecretStatus>('ai_secret_set', { adapter, key }),

  aiSecretDelete: (adapter: string) =>
    transport.call<AiSecretStatus>('ai_secret_delete', { adapter }),

  /// 全部外部 MCP server 配置
  mcpListServers: () => transport.call<McpServerConfig[]>('mcp_list_servers'),

  /// 新增外部 MCP server 配置
  mcpAddServer: (config: McpServerConfig) =>
    transport.call<void>('mcp_add_server', { config }),

  /// 删除外部 MCP server 配置 (同时断连)
  mcpRemoveServer: (id: string) => transport.call<void>('mcp_remove_server', { id }),

  /// 启用 / 禁用外部 MCP server
  mcpSetServerEnabled: (id: string, enabled: boolean) =>
    transport.call<void>('mcp_set_server_enabled', { id, enabled }),

  /// 刷新聚合工具列表 (自动连接已启用未连接的 server) 并更新对话工具缓存
  mcpListTools: () => transport.call<McpToolInfo[]>('mcp_list_tools'),

  /// 本地 MCP server 状态
  mcpServerStatus: () => transport.call<McpServerStatus>('mcp_server_status'),

  /// 启动本地 MCP server (返回实际端口; 已运行则直接返回)
  mcpServerStart: (port: number) =>
    transport.call<number>('mcp_server_start', { port }),

  /// 检查候选 MCP 端口 (可用性 / 占用者 / 替代端口)
  mcpPortCheck: (port: number) => transport.call<McpPortCheck>('mcp_port_check', { port }),

  /// 停止本地 MCP server (未运行时静默)
  mcpServerStop: () => transport.call<void>('mcp_server_stop'),
};
