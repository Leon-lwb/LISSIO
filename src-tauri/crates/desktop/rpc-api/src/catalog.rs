//! 命令面清单 — Web 出口的能力边界 (人工维护, 由契约对齐测试守护)。
//!
//! 四个集合描述前端公共命令面。`SUPPORTED` 与 `CHANNEL` 由独立后端承载，
//! `DESKTOP_ONLY` 是 Tauri 壳唯一允许注册的 IPC。新增前端调用而忘了接出口时，
//! 契约测试会失败。
//!
//! 契约测试入口: `pnpm check:web-contract` (`scripts/check-web-contract.mjs`)。

/// 桌面壳专有命令 — 语义绑死 Tauri 窗口 / 启动页 / 更新器 / 调试端口, Web 出口
/// 没有等价物 (浏览器不提供这些能力, 也不应伪造成功)。
pub const DESKTOP_ONLY: &[&str] = &[
    "inspect_element",
    "set_window_acrylic",
    "show_main_window",
    "close_splashscreen",
    "check_update",
    "download_and_install_update",
    "backend_sidecar_info",
    "backend_sidecar_restart",
    "backend_sidecar_open_logs",
];

/// 已接入本出口的命令 (与 `dispatch` 分支一一对应)。
pub const SUPPORTED: &[&str] = &[
    // 设备与采集
    "list_ports",
    "list_candle_devices",
    "list_adapter_capabilities",
    "describe_acquisition_points",
    "discover_acquisition_endpoints",
    "validate_adapter_configuration",
    "list_acquisition_endpoints",
    "list_device_tree_nodes",
    "list_driver_manifests",
    "get_model_catalog",
    "prepare_node_documents",
    "describe_node_documents",
    "latest_acquisition_samples",
    "open_acquisition_endpoint",
    "close_acquisition_endpoint",
    "read_acquisition_points",
    "subscribe_acquisition_points",
    "write_acquisition_points",
    // 传输与协议
    "close_transport",
    "send_raw",
    "send_string",
    "send_text_out_now",
    "send_widget_value",
    "send_and_capture",
    "update_transport_protocol",
    "set_protocol",
    "get_protocol",
    "get_detected_channels",
    "send_can_frame",
    "get_recent_can_frames",
    "clear_can_buffer",
    "get_can_buffer_info",
    // 节点图与工作区
    "update_tab_graph",
    "remove_tab_graph",
    "get_source_graph",
    "set_node_positions",
    "set_input_value",
    "submit_custom_output",
    "submit_custom_text_output",
    "inject_bytes",
    "connect_edge",
    "disconnect_edge",
    "workspace_get",
    "workspace_set_tabs",
    "get_graph_hir",
    // 流水线与运行控制
    "set_pipeline_config",
    "get_pipeline_config",
    "workspace_run",
    "get_workspace_run_state",
    "set_widget_send_tasks",
    "get_send_task_status",
    // 缓冲与停止快照
    "clear_buffer",
    "set_buffer_channels",
    "get_buffer_info",
    "set_waveform_buffer_capacity",
    "set_rawdata_buffer_capacity",
    "set_can_buffer_capacity",
    "set_logic_buffer_capacity",
    "compute_waveform_autoset",
    "create_waveform_snapshot",
    "query_waveform_snapshot",
    "release_waveform_snapshot",
    "get_waveform_raw_range",
    "compute_command_frame_bytes",
    "send_command_frame",
    // 显示订阅控制 (推送本身走出口通道)
    "ack_data",
    "get_data_health",
    // 逻辑 / 原始数据 / CAN 负载 / 触发器
    "get_recent_logic_samples",
    "clear_logic_buffer",
    "get_logic_buffer_info",
    "get_recent_decoded_events",
    "clear_decoded_buffer",
    "get_decoded_buffer_info",
    "clear_raw_data_collector",
    "get_can_load_stats",
    "set_can_load_window",
    "clear_can_load_stats",
    "get_current_can_bitrate",
    "match_trigger_command",
    // 帧解码器手动测试 (纯预览计算, 无状态)
    "parse_frame_decoder_input",
    // 录制
    "get_recording_health",
    "list_recording_sessions",
    "list_recording_session_summaries",
    "list_recording_bindings",
    "get_recording_database_info",
    "query_recording_history",
    "query_recording_sql",
    "cancel_recording_query",
    "flush_recording",
    "delete_recording_session",
    "cleanup_recording_sessions",
    "export_recording_data",
    "create_recording_session",
    "set_active_recording_session",
    "apply_recording_settings",
    // 文件产物 (Web 出口写受管暂存区, 经 /api/v1/download/{token} 交付)
    "export_waveform_csv",
    "export_can_load_csv",
    // AI / sessions / MCP
    "ai_list_providers",
    "ai_chat_send",
    "ai_chat_cancel",
    "ai_tool_resolve",
    "ai_secret_status",
    "ai_secret_set",
    "ai_secret_delete",
    "chat_list_sessions",
    "chat_create_session",
    "chat_get_session",
    "chat_rename_session",
    "chat_delete_session",
    "chat_clear_session",
    "mcp_list_servers",
    "mcp_add_server",
    "mcp_remove_server",
    "mcp_set_server_enabled",
    "mcp_list_tools",
    "mcp_connection_states",
    "mcp_call_tool",
    "mcp_server_status",
    "mcp_server_start",
    "mcp_server_stop",
];

/// 尚未接入网络出口的命令。
///
/// v2 已完成 AI/MCP 与 SecretStore 迁移；新业务命令若暂不能由独立后端承载，
/// 必须显式列入此表并由 Web 契约检查阻止遗漏。当前没有 pending 命令。
pub const PENDING: &[&str] = &[];

/// 由出口通道 (而非 `dispatch`) 承载的命令。
///
/// `subscribe_data` / `unsubscribe_data` 在 Web 出口对应 WebSocket 的
/// `subscribe` / `unsubscribe` 帧: 桌面 IPC 用 `Channel` 传推送目标, Web 用连接
/// 本身就是推送目标, 因此没有可派发的参数形状。
pub const CHANNEL: &[&str] = &["subscribe_data", "unsubscribe_data"];

/// 判断命令是否由本出口的 RPC 派发表实现 (供 HTTP 层在写响应前给出稳定的
/// 不支持语义, 避免为必然失败的调用做参数解包)。
pub fn is_supported(cmd: &str) -> bool {
    SUPPORTED.contains(&cmd)
}

#[cfg(test)]
mod tests {
    use super::{CHANNEL, DESKTOP_ONLY, PENDING, SUPPORTED};
    use std::collections::HashSet;

    /// 四个集合必须互不相交 — 否则能力矩阵自相矛盾。
    #[test]
    fn catalog_sets_are_disjoint() {
        let sets = [
            ("SUPPORTED", SUPPORTED),
            ("PENDING", PENDING),
            ("DESKTOP_ONLY", DESKTOP_ONLY),
            ("CHANNEL", CHANNEL),
        ];
        let mut seen: HashSet<&str> = HashSet::new();
        for (name, list) in sets {
            let unique: HashSet<&str> = list.iter().copied().collect();
            assert_eq!(unique.len(), list.len(), "{name} 含重复项");
            for cmd in list {
                assert!(seen.insert(cmd), "{name} 与其它集合重叠: {cmd}");
            }
        }
    }

    /// 通道类命令不得同时出现在可派发集合中。
    #[test]
    fn channel_commands_are_not_dispatchable() {
        for cmd in CHANNEL {
            assert!(!is_supported(cmd), "{cmd} 不应由 dispatch 承载");
            assert!(!PENDING.contains(cmd));
            assert!(!DESKTOP_ONLY.contains(cmd));
        }
    }

    use super::is_supported;
}
