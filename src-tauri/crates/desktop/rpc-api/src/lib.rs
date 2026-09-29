//! # rpc-api
//!
//! 出口无关的命令派发表 — 把前端 `invoke(cmd, args)` 的语义映射到
//! [`control_api`] / [`app`] 的能力函数, 与宿主无关 (不依赖 Tauri / axum / rmcp)。
//!
//! 为什么存在: 桌面 IPC (`src-tauri/src/commands`) 与 HTTP-RPC 出口需要**同一套
//! 命令名、参数名与错误契约**。把"命令名 → 能力调用"集中在这里, 新出口不必
//! 复制 123 个命令壳, 契约对齐测试也有唯一的比对对象。
//!
//! 分工:
//! - 参数: 本 crate 拥有 `cmd` 名称与参数形状 (顶层 camelCase, 见 [`args`]);
//! - 能力: 全部实现在 `control-api` / `app`, 本 crate 不做业务判断;
//! - 推送: 订阅通道 (`subscribe_data` / `unsubscribe_data`) 由出口层实现
//!   [`app::display::StreamSink`] 端口, 不走 `dispatch`;
//! - 清单: [`catalog`] 声明已实现 / 待实现 / 桌面专有, 与 `dispatch` 分支互补。

pub mod args;
pub mod catalog;

mod acquisition;
mod ai;
mod buffer;
mod data;
mod devices;
mod export;
mod frame_decoder;
mod graph;
pub mod models;
mod panel;
mod pipeline;
mod recording;
mod transport;

use backend_host::BackendHost;
use events::{EventSinkHandle, NullEventSink};
use serde_json::Value;
use std::sync::Arc;

pub use args::{RpcError, normalize_args};

/// Per-request output ports. HTTP calls use the defaults; WebSocket calls can
/// inject a connection-scoped chat channel and frontend-tool event sink.
#[derive(Clone)]
pub struct RpcContext {
    pub chat_events: Option<ai_host::ChatEventSink>,
    pub frontend_sink: EventSinkHandle,
}

impl Default for RpcContext {
    fn default() -> Self {
        Self {
            chat_events: None,
            frontend_sink: Arc::new(NullEventSink),
        }
    }
}

/// 派发一条命令。
///
/// `args` 是前端 `invoke` 的原样 JSON 对象 (顶层 camelCase); 返回可直接写入
/// HTTP 响应 `result` 字段的 JSON。未知或未接入的命令返回
/// [`RpcError::unsupported`], 出口层据此回 501 而不是 500。
pub async fn dispatch(host: &BackendHost, cmd: &str, args: Value) -> Result<Value, RpcError> {
    dispatch_with_context(host, cmd, args, &RpcContext::default()).await
}

/// Dispatch with request-scoped streaming/event ports.
pub async fn dispatch_with_context(
    host: &BackendHost,
    cmd: &str,
    args: Value,
    context: &RpcContext,
) -> Result<Value, RpcError> {
    // 载荷型命令 ([`catalog::PAYLOAD_ARGS`]) 的参数对象本身就是请求 DTO,
    // 顶层键已是其 ts-rs 契约形状, 不得做参数名归一。
    let args = if catalog::args_are_a_payload(cmd) {
        args
    } else {
        normalize_args(args)
    };
    match cmd {
        // ===== AI / sessions / MCP =====
        "ai_list_providers" => ai::list_providers(),
        "ai_chat_send" => ai::chat_send(host, cmd, &args, context).await,
        "ai_chat_cancel" => ai::chat_cancel(host, cmd, &args),
        "ai_tool_resolve" => ai::tool_resolve(host, cmd, &args),
        "ai_secret_status" => ai::secret_status(host, cmd, &args),
        "ai_secret_set" => ai::secret_set(host, cmd, &args),
        "ai_secret_delete" => ai::secret_delete(host, cmd, &args),
        "chat_list_sessions" => ai::list_sessions(host),
        "chat_create_session" => ai::create_session(host, cmd, &args),
        "chat_get_session" => ai::get_session(host, cmd, &args),
        "chat_rename_session" => ai::rename_session(host, cmd, &args),
        "chat_delete_session" => ai::delete_session(host, cmd, &args),
        "chat_clear_session" => ai::clear_session(host, cmd, &args),
        "mcp_list_servers" => ai::list_servers(host),
        "mcp_add_server" => ai::add_server(host, cmd, &args),
        "mcp_remove_server" => ai::remove_server(host, cmd, &args),
        "mcp_set_server_enabled" => ai::set_server_enabled(host, cmd, &args),
        "mcp_list_tools" => ai::list_tools(host).await,
        "mcp_connection_states" => ai::connection_states(host),
        "mcp_call_tool" => ai::call_tool(host, cmd, &args).await,
        "mcp_server_status" => ai::server_status(host),
        "mcp_server_start" => ai::server_start(host, cmd, &args).await,
        "mcp_server_stop" => ai::server_stop(host),
        // ===== 设备与采集 =====
        "list_ports" => devices::list_ports(host),
        "list_candle_devices" => devices::list_candle_devices(),
        "list_adapter_capabilities" => acquisition::list_adapter_capabilities(host),
        "list_acquisition_endpoints" => acquisition::list_acquisition_endpoints(host),
        "list_device_tree_nodes" => Ok(acquisition::list_device_tree_nodes(host)),
        "list_driver_manifests" => Ok(acquisition::list_driver_manifests(host)),
        "get_model_catalog" => models::get_model_catalog(host, cmd, &args).await,
        "prepare_node_documents" => models::prepare_node_documents(host, cmd, &args).await,
        "describe_node_documents" => models::describe_node_documents(host, cmd, &args).await,
        "describe_acquisition_points" => acquisition::describe_acquisition_points(host, cmd, &args),
        "discover_acquisition_endpoints" => {
            acquisition::discover_acquisition_endpoints(host, cmd, &args)
        }
        "validate_adapter_configuration" => {
            acquisition::validate_adapter_configuration(host, cmd, &args)
        }
        "latest_acquisition_samples" => acquisition::latest_acquisition_samples(host, cmd, &args),
        "open_acquisition_endpoint" => {
            acquisition::open_acquisition_endpoint(host, cmd, &args).await
        }
        "close_acquisition_endpoint" => {
            acquisition::close_acquisition_endpoint(host, cmd, &args).await
        }
        "read_acquisition_points" => acquisition::read_acquisition_points(host, cmd, &args).await,
        "subscribe_acquisition_points" => {
            acquisition::subscribe_acquisition_points(host, cmd, &args).await
        }
        "write_acquisition_points" => acquisition::write_acquisition_points(host, cmd, &args).await,

        // ===== 传输与协议 =====
        "close_transport" => transport::close_transport(host, cmd, &args).await,
        "send_raw" => transport::send_raw(host, cmd, &args).await,
        "send_string" => transport::send_string(host, cmd, &args).await,
        "send_text_out_now" => transport::send_text_out_now(host, cmd, &args).await,
        "send_widget_value" => transport::send_widget_value(host, cmd, &args).await,
        "send_and_capture" => transport::send_and_capture(host, cmd, &args).await,
        "update_transport_protocol" => transport::update_transport_protocol(host, cmd, &args).await,
        "set_protocol" => transport::set_protocol(host, cmd, &args).await,
        "get_protocol" => transport::get_protocol(host, cmd, &args).await,
        "get_detected_channels" => transport::get_detected_channels(host, cmd, &args).await,
        "send_can_frame" => transport::send_can_frame(host, cmd, &args).await,
        "get_recent_can_frames" => transport::get_recent_can_frames(host, cmd, &args),
        "clear_can_buffer" => transport::clear_can_buffer(host),
        "get_can_buffer_info" => transport::get_can_buffer_info(host),

        // ===== 节点图与工作区 =====
        "update_tab_graph" => graph::update_tab_graph(host, cmd, &args).await,
        "remove_tab_graph" => graph::remove_tab_graph(host, cmd, &args).await,
        "get_source_graph" => graph::get_source_graph(host, cmd, &args),
        "set_node_positions" => graph::set_node_positions(host, cmd, &args),
        "set_input_value" => graph::set_input_value(host, cmd, &args),
        "submit_custom_output" => graph::submit_custom_output(host, cmd, &args),
        "submit_custom_text_output" => graph::submit_custom_text_output(host, cmd, &args),
        "inject_bytes" => graph::inject_bytes(host, cmd, &args).await,
        "connect_edge" => graph::connect_edge(host, cmd, &args).await,
        "disconnect_edge" => graph::disconnect_edge(host, cmd, &args).await,
        "workspace_get" => graph::workspace_get(host).await,
        "workspace_set_tabs" => graph::workspace_set_tabs(host, cmd, &args),
        "get_graph_hir" => graph::get_graph_hir(host, cmd, &args),

        // ===== 流水线与运行控制 =====
        "set_pipeline_config" => pipeline::set_pipeline_config(host, cmd, &args),
        "get_pipeline_config" => pipeline::get_pipeline_config(host),
        "workspace_run" => pipeline::workspace_run(host, cmd, &args).await,
        "get_workspace_run_state" => pipeline::get_workspace_run_state(host),
        "set_widget_send_tasks" => pipeline::set_widget_send_tasks(host, cmd, &args),
        "get_send_task_status" => pipeline::get_send_task_status(host),

        // ===== 缓冲与停止快照 =====
        "clear_buffer" => buffer::clear_buffer(host, cmd, &args),
        "set_buffer_channels" => buffer::set_buffer_channels(host, cmd, &args),
        "get_buffer_info" => buffer::get_buffer_info(host, cmd, &args),
        "set_waveform_buffer_capacity" => buffer::set_waveform_buffer_capacity(host, cmd, &args),
        "set_rawdata_buffer_capacity" => buffer::set_rawdata_buffer_capacity(host, cmd, &args),
        "set_can_buffer_capacity" => buffer::set_can_buffer_capacity(host, cmd, &args),
        "set_logic_buffer_capacity" => buffer::set_logic_buffer_capacity(host, cmd, &args),
        "compute_waveform_autoset" => buffer::compute_waveform_autoset(host, cmd, &args).await,
        "create_waveform_snapshot" => buffer::create_waveform_snapshot(host, cmd, &args).await,
        "query_waveform_snapshot" => buffer::query_waveform_snapshot(host, cmd, &args).await,
        "release_waveform_snapshot" => buffer::release_waveform_snapshot(host, cmd, &args),
        "get_waveform_raw_range" => buffer::get_waveform_raw_range(host, cmd, &args).await,
        "compute_command_frame_bytes" => buffer::compute_command_frame_bytes(cmd, &args),
        "send_command_frame" => buffer::send_command_frame(host, cmd, &args).await,

        // ===== 显示订阅控制 / 四域读取 =====
        "ack_data" => data::ack_data(host, cmd, &args),
        "get_data_health" => data::get_data_health(host),
        // 数据面板拉取面 (面板身份的推送面走出口通道, 见 `app::display::subscribe_data`)
        "fetch_panel_data" => panel::fetch_panel_data(host, cmd, &args),
        "get_recent_logic_samples" => data::get_recent_logic_samples(host, cmd, &args),
        "clear_logic_buffer" => data::clear_logic_buffer(host),
        "get_logic_buffer_info" => data::get_logic_buffer_info(host),
        "get_recent_decoded_events" => data::get_recent_decoded_events(host, cmd, &args),
        "clear_decoded_buffer" => data::clear_decoded_buffer(host),
        "get_decoded_buffer_info" => data::get_decoded_buffer_info(host),
        "clear_raw_data_collector" => data::clear_raw_data_collector(host, cmd, &args),
        "get_can_load_stats" => data::get_can_load_stats(host, cmd, &args),
        "set_can_load_window" => data::set_can_load_window(host, cmd, &args),
        "clear_can_load_stats" => data::clear_can_load_stats(host),
        "get_current_can_bitrate" => data::get_current_can_bitrate(host, cmd, &args),
        "match_trigger_command" => data::match_trigger_command(cmd, &args),

        // ===== 帧解码器手动测试 (纯预览计算) =====
        "parse_frame_decoder_input" => frame_decoder::parse_frame_decoder_input(cmd, &args),

        // ===== 录制 =====
        "get_recording_health" => recording::health(host),
        "list_recording_sessions" => recording::list_sessions(host).await,
        "list_recording_session_summaries" => recording::list_session_summaries(host).await,
        "list_recording_bindings" => recording::list_bindings(host, cmd, &args).await,
        "get_recording_database_info" => recording::database_info(host).await,
        "query_recording_history" => recording::query_history(host, cmd, &args).await,
        "query_recording_sql" => recording::query_sql(host, cmd, &args).await,
        "cancel_recording_query" => recording::cancel_query(host, cmd, &args),
        "flush_recording" => recording::flush(host).await,
        "delete_recording_session" => recording::delete_session(host, cmd, &args).await,
        "cleanup_recording_sessions" => recording::cleanup_sessions(host, cmd, &args).await,
        "export_recording_data" => recording::export_data(host, cmd, &args).await,
        "create_recording_session" => recording::create_session(host).await,
        "set_active_recording_session" => recording::switch_session(host, cmd, &args).await,
        "apply_recording_settings" => recording::apply_settings(host, cmd, &args).await,

        // ===== 文件产物导出 (Web 出口走受管暂存区 + 下载端点) =====
        "export_waveform_csv" => export::export_waveform_csv(host, cmd, &args).await,
        "export_can_load_csv" => export::export_can_load_csv(host, cmd, &args).await,

        other => Err(RpcError::unsupported(other)),
    }
}
