//! AI/MCP RPC adapters. Business state and behavior live in `ai-host`.

use backend_host::BackendHost;
use chat_session::AttachmentDto;
use llm::AiProviderConfig;
use mcp_client::McpServerConfig;
use serde_json::Value;

use crate::RpcContext;
use crate::args::{RpcError, domain, encode, ok, optional, required};

pub fn list_providers() -> Result<Value, RpcError> {
    encode(&ai_host::ai_list_providers())
}

pub async fn chat_send(
    host: &BackendHost,
    cmd: &str,
    args: &Value,
    context: &RpcContext,
) -> Result<Value, RpcError> {
    let events = context
        .chat_events
        .clone()
        .ok_or_else(|| RpcError::invalid_args(cmd, "onEvent 必须通过 WebSocket 事件通道传入"))?;
    domain(
        ai_host::ai_chat_send(
            &host.ai,
            required(args, cmd, "session_id")?,
            optional(args, cmd, "text")?,
            optional::<Vec<AttachmentDto>>(args, cmd, "attachments")?,
            required(args, cmd, "regenerate")?,
            required::<AiProviderConfig>(args, cmd, "config")?,
            required(args, cmd, "use_mcp_tools")?,
            required(args, cmd, "use_builtin_tools")?,
            optional(args, cmd, "ui_lang")?,
            events,
            context.frontend_sink.clone(),
        )
        .await,
    )
}

pub fn chat_cancel(host: &BackendHost, cmd: &str, args: &Value) -> Result<Value, RpcError> {
    encode(&ai_host::ai_chat_cancel(
        &host.ai,
        required(args, cmd, "task_id")?,
    ))
}

pub fn tool_resolve(host: &BackendHost, cmd: &str, args: &Value) -> Result<Value, RpcError> {
    encode(&ai_host::ai_tool_resolve(
        &host.ai,
        required(args, cmd, "call_id")?,
        required(args, cmd, "ok")?,
        required(args, cmd, "result")?,
    ))
}

pub fn secret_status(host: &BackendHost, cmd: &str, args: &Value) -> Result<Value, RpcError> {
    domain(ai_host::ai_secret_status(
        &host.ai,
        required(args, cmd, "adapter")?,
    ))
}
pub fn secret_set(host: &BackendHost, cmd: &str, args: &Value) -> Result<Value, RpcError> {
    domain(ai_host::ai_secret_set(
        &host.ai,
        required(args, cmd, "adapter")?,
        required(args, cmd, "key")?,
    ))
}
pub fn secret_delete(host: &BackendHost, cmd: &str, args: &Value) -> Result<Value, RpcError> {
    domain(ai_host::ai_secret_delete(
        &host.ai,
        required(args, cmd, "adapter")?,
    ))
}

pub fn list_sessions(host: &BackendHost) -> Result<Value, RpcError> {
    encode(&ai_host::chat_list_sessions(&host.ai))
}
pub fn create_session(host: &BackendHost, cmd: &str, args: &Value) -> Result<Value, RpcError> {
    domain(ai_host::chat_create_session(
        &host.ai,
        required(args, cmd, "title")?,
    ))
}
pub fn get_session(host: &BackendHost, cmd: &str, args: &Value) -> Result<Value, RpcError> {
    encode(&ai_host::chat_get_session(
        &host.ai,
        required(args, cmd, "session_id")?,
    ))
}
pub fn rename_session(host: &BackendHost, cmd: &str, args: &Value) -> Result<Value, RpcError> {
    ai_host::chat_rename_session(
        &host.ai,
        required(args, cmd, "session_id")?,
        required(args, cmd, "title")?,
    )
    .map_err(|error| RpcError::domain(&error))?;
    ok()
}
pub fn delete_session(host: &BackendHost, cmd: &str, args: &Value) -> Result<Value, RpcError> {
    ai_host::chat_delete_session(&host.ai, required(args, cmd, "session_id")?)
        .map_err(|error| RpcError::domain(&error))?;
    ok()
}
pub fn clear_session(host: &BackendHost, cmd: &str, args: &Value) -> Result<Value, RpcError> {
    ai_host::chat_clear_session(&host.ai, required(args, cmd, "session_id")?)
        .map_err(|error| RpcError::domain(&error))?;
    ok()
}

pub fn list_servers(host: &BackendHost) -> Result<Value, RpcError> {
    encode(&ai_host::mcp_list_servers(&host.ai))
}
pub fn add_server(host: &BackendHost, cmd: &str, args: &Value) -> Result<Value, RpcError> {
    ai_host::mcp_add_server(&host.ai, required::<McpServerConfig>(args, cmd, "config")?)
        .map_err(|error| RpcError::domain(&error))?;
    ok()
}
pub fn remove_server(host: &BackendHost, cmd: &str, args: &Value) -> Result<Value, RpcError> {
    ai_host::mcp_remove_server(&host.ai, required(args, cmd, "id")?);
    ok()
}
pub fn set_server_enabled(host: &BackendHost, cmd: &str, args: &Value) -> Result<Value, RpcError> {
    ai_host::mcp_set_server_enabled(
        &host.ai,
        required(args, cmd, "id")?,
        required(args, cmd, "enabled")?,
    )
    .map_err(|error| RpcError::domain(&error))?;
    ok()
}
pub async fn list_tools(host: &BackendHost) -> Result<Value, RpcError> {
    domain(ai_host::mcp_list_tools(&host.ai).await)
}
pub fn connection_states(host: &BackendHost) -> Result<Value, RpcError> {
    encode(&ai_host::mcp_connection_states(&host.ai))
}
pub async fn call_tool(host: &BackendHost, cmd: &str, args: &Value) -> Result<Value, RpcError> {
    domain(
        ai_host::mcp_call_tool(
            &host.ai,
            required(args, cmd, "name")?,
            required(args, cmd, "arguments")?,
        )
        .await,
    )
}
pub fn server_status(host: &BackendHost) -> Result<Value, RpcError> {
    encode(&ai_host::mcp_server_status(&host.ai))
}
pub async fn server_start(host: &BackendHost, cmd: &str, args: &Value) -> Result<Value, RpcError> {
    domain(ai_host::mcp_server_start(&host.ai, optional(args, cmd, "port")?).await)
}
pub fn server_stop(host: &BackendHost) -> Result<Value, RpcError> {
    ai_host::mcp_server_stop(&host.ai);
    ok()
}
