//! Exit-independent AI/MCP host.

mod local_server;
mod native_executor;
mod prompt;
#[cfg(test)]
mod prompt_integration_tests;
mod secret;
#[cfg(test)]
mod session_store_tests;
#[cfg(test)]
mod test_support;
mod turn;
mod web_fetch;

use std::path::PathBuf;
use std::sync::Arc;

use crate::native_executor::{
    CompositeExecutor, ConversationTitleExecutor, McpToolExecutor, NativeToolExecutor,
    NativeToolOptions, PendingCalls, ToolOutcome,
};
use crate::turn::{TurnPersistence, TurnPipeline};
use chat::{AiChatEvent, ChatPayload, ChatTaskRegistry, GenaiTurnProvider, run_chat};
use chat_session::{
    AttachmentDto, ChatSession, SessionMeta, SessionStore, ViewItemDto, ViewRoleDto, derive_history,
};
use control_api::Toolbox;
use control_api::capabilities::registry::CapabilityRegistry;
use control_api::capabilities::skill::Lang;
use error::Result;
use events::EventSinkHandle;
use llm::{AdapterInfo, AiProviderConfig, validate_config};
use mcp_client::{McpManager, McpServerConfig, McpToolInfo};
use mcp_server::McpServerHandle;
use parking_lot::Mutex;
use serde_json::Value;

pub use local_server::{
    McpPortConflict, McpServerStatus, mcp_port_check, mcp_server_start, mcp_server_status,
    mcp_server_stop,
};
#[cfg(debug_assertions)]
use secret::DevEnvSecretStore;
pub use secret::{SecretSource, SecretStatus, SecretStore, SystemSecretStore};
pub use web_fetch::{WebFetchPage, ai_fetch_webpage_html};

/// 流式事件出口。WebSocket 使用连接级实现，旧 Tauri wrapper 可注入 Channel 适配器。
pub type ChatEventSink = Arc<dyn Fn(AiChatEvent) + Send + Sync>;

/// Independent tool sources enabled for one chat turn.
#[derive(Debug, Clone, Copy, Default)]
pub struct AiToolToggles {
    /// External MCP tools.
    pub mcp: bool,
    /// Software capabilities and built-in frontend tools.
    pub builtin: bool,
    /// Web fetching skill.
    pub web: bool,
}

/// AI 功能全局状态 (Tauri managed)。
pub struct AiHost {
    /// 设置目录 — 每轮从其中的 Markdown 文件读取系统提示词。
    config_dir: PathBuf,
    /// 软件能力注册表 — 内置工具与技能文档的单一事实来源。
    registry: Arc<CapabilityRegistry>,
    toolbox: Toolbox,
    sink: EventSinkHandle,
    /// 对话任务取消注册表。
    registry_tasks: Arc<ChatTaskRegistry>,
    /// 对话会话存储 (多会话 + 历史持久化, 所有权在后端)。
    sessions: Arc<SessionStore>,
    /// 外部 MCP server 连接管理器。
    mcp: Arc<McpManager>,
    /// 聚合工具缓存 — 由 `mcp_list_tools` 刷新, 对话发送时取快照。
    tool_cache: Mutex<Vec<McpToolInfo>>,
    /// 本地 MCP server 句柄。
    server: Mutex<Option<McpServerHandle>>,
    /// 最近一次本地 MCP server 启动失败的端口冲突 (成功后清空)。
    mcp_conflict: Mutex<Option<McpPortConflict>>,
    /// 前端托管工具调用注册表 (call_id → 回执发送端)。
    pending_frontend: PendingCalls,
    secrets: Arc<dyn SecretStore>,
}

impl AiHost {
    /// 从 app config dir 构造 (加载已配置的外部 MCP server 列表与会话历史;
    /// 配置文件损坏时按空配置启动, 不阻塞应用)。
    pub fn new(config_dir: PathBuf, toolbox: Toolbox, sink: EventSinkHandle) -> Self {
        #[cfg(debug_assertions)]
        let secrets: Arc<dyn SecretStore> = Arc::new(DevEnvSecretStore::new());
        #[cfg(not(debug_assertions))]
        let secrets: Arc<dyn SecretStore> = Arc::new(SystemSecretStore);
        Self::with_secret_store(config_dir, toolbox, sink, secrets)
    }

    /// Construct with an injected secret port (used by deterministic backend tests and alternate
    /// deployments).
    pub fn with_secret_store(
        config_dir: PathBuf,
        toolbox: Toolbox,
        sink: EventSinkHandle,
        secrets: Arc<dyn SecretStore>,
    ) -> Self {
        if let Err(error) = prompt::ensure_prompt_file(&config_dir) {
            log::warn!("AI 系统提示词文件初始化失败: {error}");
        }
        let mcp = McpManager::load(&config_dir).unwrap_or_else(|e| {
            log::warn!("MCP 配置加载失败, 按空配置启动: {e}");
            McpManager::empty(&config_dir)
        });
        // 会话文件的损坏路径由 chat-session 决定: 隔离原件后按空会话启动,
        // 后续落盘不会覆盖唯一副本
        let sessions = SessionStore::load_or_quarantine(&config_dir);
        Self {
            config_dir,
            registry: Arc::new(CapabilityRegistry::builtin()),
            toolbox,
            sink,
            registry_tasks: Arc::new(ChatTaskRegistry::default()),
            sessions: Arc::new(sessions),
            mcp: Arc::new(mcp),
            tool_cache: Mutex::new(Vec::new()),
            server: Mutex::new(None),
            mcp_conflict: Mutex::new(None),
            pending_frontend: Arc::new(Mutex::new(std::collections::HashMap::new())),
            secrets,
        }
    }
}

// ============ AI 对话 ============

/// 支持的 LLM provider 适配器清单 (设置 UI 下拉)。
pub fn ai_list_providers() -> Vec<AdapterInfo> {
    llm::list_adapters().to_vec()
}

/// 发起一次对话 (可含多轮工具调用), 增量事件经 Channel 推送。
///
/// 会话所有权在后端:`text` 非空或携带 `attachments` 时先追加用户条目,
/// `regenerate` 时截掉最后一条用户条目之后的待重试回合;LLM 历史由会话条目
/// 派生, 回合终态后产物落盘。返回 task_id 供 `ai_chat_cancel` 取消。
/// 错误事件同样走 Channel, 命令本身只在配置/参数非法时失败。
///
/// [`AiToolToggles`] 的三个来源互相独立:软件能力与内置前端工具、
/// `fetch_webpage` Web 技能、外部 MCP 工具。
///
/// # Errors
/// 配置校验失败、系统提示词文件不可用或会话落盘失败。
pub async fn ai_chat_send(
    state: &AiHost,
    session_id: String,
    text: Option<String>,
    attachments: Option<Vec<AttachmentDto>>,
    regenerate: bool,
    mut config: AiProviderConfig,
    tools: AiToolToggles,
    ui_lang: Option<String>,
    on_event: ChatEventSink,
    frontend_sink: EventSinkHandle,
) -> Result<String> {
    if config.api_key.trim().is_empty() {
        config.api_key = state.secrets.resolve(&config.adapter)?.unwrap_or_default();
    }
    validate_config(&config)?;

    // 提示词在每轮开始时读取。失败不能追加用户消息或截断待重试会话。
    let lang = ui_lang.as_deref().map_or(Lang::Zh, Lang::parse);
    let prompt_text = prompt::load_prompt(&state.config_dir)?;

    // 回合前置: 先落盘用户输入 / 截断待重试回合, 派生的历史才是权威上下文
    if regenerate {
        state.sessions.truncate_after_last_user(&session_id)?;
    } else {
        let body = text.as_deref().map(str::trim).unwrap_or_default();
        let attachments = attachments.filter(|list| !list.is_empty());
        // 文本与附件至少其一非空才构成用户条目 (允许仅附件无文本)
        if !body.is_empty() || attachments.is_some() {
            state.sessions.append_items(
                &session_id,
                vec![ViewItemDto {
                    role: ViewRoleDto::User,
                    text: body.to_string(),
                    attachments,
                    tools: None,
                    timeline: None,
                    reasoning: None,
                    duration_ms: None,
                    error: None,
                    error_kind: None,
                    error_data: None,
                }],
            )?;
        }
    }
    let session = state.sessions.get(&session_id);
    // 中途落盘锚点: 没有用户条目的会话只能终态追加一次, 不允许周期性写入
    let has_user_anchor = session.as_ref().is_some_and(|session| {
        session
            .items
            .iter()
            .any(|item| item.role == ViewRoleDto::User)
    });
    let first_turn_title = session.as_ref().is_some_and(|session| {
        matches!(session.title.as_str(), "新会话" | "New chat")
            && session
                .items
                .iter()
                .filter(|item| item.role == ViewRoleDto::User)
                .count()
                == 1
            && !session
                .items
                .iter()
                .any(|item| item.role == ViewRoleDto::Assistant)
    });
    let expected_title = session
        .as_ref()
        .map_or_else(String::new, |session| session.title.clone());
    let history = derive_history(&session.map(|session| session.items).unwrap_or_default());
    let system_prompt = prompt::compose_system_prompt(
        &state.registry,
        lang,
        &prompt_text,
        tools.builtin,
        tools.web,
        first_turn_title,
    );

    let (task_id, cancel_rx) = state.registry_tasks.register();
    let registry_tasks = Arc::clone(&state.registry_tasks);
    let sessions = Arc::clone(&state.sessions);
    let mcp = Arc::clone(&state.mcp);
    let pending_frontend = Arc::clone(&state.pending_frontend);
    let mcp_tools = if tools.mcp {
        state.tool_cache.lock().clone()
    } else {
        Vec::new()
    };

    let spawned_task_id = task_id.clone();
    let registry = Arc::clone(&state.registry);
    let toolbox = state.toolbox.clone();
    let backend_sink = state.sink.clone();
    tokio::spawn(async move {
        // 回合汇聚: 前端推送按窗口合并增量, 记录器快照周期性落盘 (中断也留部分回答)
        let pipeline = TurnPipeline::spawn(
            on_event,
            TurnPersistence {
                sessions: Arc::clone(&sessions),
                session_id: session_id.clone(),
                periodic_drafts: has_user_anchor,
            },
        );
        let sink = pipeline.sink();
        let provider = GenaiTurnProvider;

        // 软件工具走注册表，内置 UI/Web 技能走前端事件桥；三组开关互相独立。
        let native = (tools.builtin || tools.web).then(|| {
            NativeToolExecutor::new(
                registry,
                toolbox,
                backend_sink,
                frontend_sink,
                pending_frontend,
                lang,
                NativeToolOptions {
                    builtin: tools.builtin,
                    web: tools.web,
                },
            )
        });
        let mcp_executor = (!mcp_tools.is_empty()).then(|| McpToolExecutor::new(mcp_tools, mcp));
        let executor = ConversationTitleExecutor::new(
            CompositeExecutor::new(native, mcp_executor),
            Arc::clone(&sessions),
            session_id.clone(),
            expected_title,
            first_turn_title,
        );

        let payload = ChatPayload {
            config,
            system: Some(system_prompt),
            messages: history,
        };
        if let Err(e) = run_chat(payload, &provider, &executor, cancel_rx, sink).await {
            // 取消/超轮次的专用事件已在循环内发出, 这里只记日志
            log::warn!("AI 对话任务结束 (含错误): {e}");
        }
        // 回合收束: 取消 / 错误路径同样沉淀部分结果, 并等落盘真正完成
        pipeline.finish().await;
        registry_tasks.remove(&spawned_task_id);
    });
    Ok(task_id)
}

/// 前端托管工具回执 — `toolHost` 执行完 `ai_tool_invoke` 事件后调用。
/// 返回是否存在该 pending 调用 (已超时清理时为 false, 回执被丢弃)。
pub fn ai_tool_resolve(state: &AiHost, call_id: String, ok: bool, result: Value) -> bool {
    // 语句内取走 sender, MutexGuard 不跨后续处理存活
    let tx = state.pending_frontend.lock().remove(&call_id);
    tx.is_some_and(|tx| {
        let content = match result {
            Value::String(s) => s,
            other => other.to_string(),
        };
        let _ = tx.send(if ok {
            ToolOutcome::Ok(content)
        } else {
            ToolOutcome::Err(content)
        });
        true
    })
}

/// 取消进行中的对话任务;返回是否存在该任务。
pub fn ai_chat_cancel(state: &AiHost, task_id: String) -> bool {
    state.registry_tasks.cancel(&task_id)
}

// ============ API key 钥匙串 (密钥不落 settings.json) ============

/// 读取适配器的 API key;未设置返回 None。
///
/// # Errors
/// 钥匙串访问失败。
pub fn ai_secret_status(state: &AiHost, adapter: String) -> Result<SecretStatus> {
    state.secrets.status(&adapter)
}

/// 写入适配器的 API key (已存在则覆盖)。
///
/// # Errors
/// 钥匙串访问失败。
pub fn ai_secret_set(state: &AiHost, adapter: String, key: String) -> Result<SecretStatus> {
    state.secrets.set(&adapter, &key)
}

/// 删除适配器的 API key (不存在时静默)。
///
/// # Errors
/// 钥匙串访问失败。
pub fn ai_secret_delete(state: &AiHost, adapter: String) -> Result<SecretStatus> {
    state.secrets.delete(&adapter)
}

// ============ 对话会话 (后端持有, 前端薄视图) ============

/// 全部会话摘要。
pub fn chat_list_sessions(state: &AiHost) -> Vec<SessionMeta> {
    state.sessions.list_metas()
}

/// 新建会话。
///
/// # Errors
/// 落盘失败。
pub fn chat_create_session(state: &AiHost, title: String) -> Result<ChatSession> {
    state.sessions.create(&title)
}

/// 读取单个会话 (含全部条目);不存在返回 None。
pub fn chat_get_session(state: &AiHost, session_id: String) -> Option<ChatSession> {
    state.sessions.get(&session_id)
}

/// 重命名会话。
///
/// # Errors
/// 会话不存在或落盘失败。
pub fn chat_rename_session(state: &AiHost, session_id: String, title: String) -> Result<()> {
    state.sessions.rename(&session_id, &title)
}

/// 删除会话 (不存在时静默)。
///
/// # Errors
/// 落盘失败。
pub fn chat_delete_session(state: &AiHost, session_id: String) -> Result<()> {
    state.sessions.remove(&session_id)
}

/// 清空会话条目 (保留会话本身)。
///
/// # Errors
/// 落盘失败。
pub fn chat_clear_session(state: &AiHost, session_id: String) -> Result<()> {
    state.sessions.clear_items(&session_id)
}

// ============ MCP client (外部 server) ============

/// 全部外部 MCP server 配置。
pub fn mcp_list_servers(state: &AiHost) -> Vec<McpServerConfig> {
    state.mcp.list_servers()
}

/// 新增外部 MCP server 配置。
///
/// # Errors
/// id 重复 / 配置非法 / 写盘失败。
pub fn mcp_add_server(state: &AiHost, config: McpServerConfig) -> Result<()> {
    state.mcp.add_server(config)
}

/// 删除外部 MCP server 配置 (同时断连)。
pub fn mcp_remove_server(state: &AiHost, id: String) {
    state.mcp.remove_server(&id);
}

/// 启用 / 禁用外部 MCP server。
///
/// # Errors
/// id 不存在或写盘失败。
pub fn mcp_set_server_enabled(state: &AiHost, id: String, enabled: bool) -> Result<()> {
    state.mcp.set_enabled(&id, enabled)
}

/// 刷新聚合工具列表 (自动连接已启用但未连接的 server) 并更新缓存。
pub async fn mcp_list_tools(state: &AiHost) -> Result<Vec<McpToolInfo>> {
    let tools = state.mcp.list_tools().await;
    state.tool_cache.lock().clone_from(&tools);
    Ok(tools)
}

/// 当前各 server 的连接状态 [(server_id, connected)]。
pub fn mcp_connection_states(state: &AiHost) -> Vec<(String, bool)> {
    state.mcp.connection_states()
}

/// 手动调用一个聚合工具 (前缀名)。
///
/// # Errors
/// 工具未注册或远端调用失败。
pub async fn mcp_call_tool(state: &AiHost, name: String, arguments: Value) -> Result<String> {
    state.mcp.call_by_prefixed(&name, arguments).await
}
