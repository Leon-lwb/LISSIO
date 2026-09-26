//! 传输连接操作 — 打开/关闭/发送的编排逻辑 (原 cmd/can_transport 命令体下沉)
//!
//! 层级: L3 app (app_state)。open+attach 配对、断连事件、TX 旁路收集等
//! 编排不变量属于应用核心; L4 cmd/can_transport 只保留 IPC 薄壳。
//!
//! L1 类型 (AcquisitionRuntime) 经 [`runtime`] 门面引用, 不直连 transport crate。

use can::CanFrame;
use data_model::{ConnectionState, Error, Result, WidgetBinding};
use error::ConfigError;
use events::{BackendEventSink, EventSinkHandle, NotifyLevel, emit_transport_state};
use schema_types::{ProtocolConfig, ProtocolSchema, TestDataLink};
use serde::Serialize;

use crate::app_state::AppState;

/// 打开设备会话并在可用时挂载字节流读任务。
///
/// 无 Tauri 版本 — [`AppState::open_device`]、MCP `open_endpoint` 工具与 CLI 共用
/// 同一条打开路径 (open + attach 配对、断连事件、订阅编排的不变量只此一份)。
///
/// `protocol` 与 `schema` 仅被 TestData 用作生成数据的线缆格式参考, 其他传输类型忽略。
pub async fn open_device_session(
    transport: &acquisition::AcquisitionRuntime,
    data_plane: &pipeline::DataPlaneState,
    sink: &EventSinkHandle,
    node: data_model::device_tree::NodeDecl,
) -> std::result::Result<data_model::device_tree::NodeSnapshot, String> {
    let id = node.id.clone();
    let payload = data_model::device::DriverPayload {
        driver_id: data_model::device_tree::DriverId::new(node.driver.as_str()),
        schema_version: node.schema_version,
        payload: node.config.clone(),
    };
    let snapshot = transport.open_node(node).await.map_err(|e| e.to_string())?;
    if snapshot.capabilities.byte_source {
        data_plane.attach(sink.clone(), id.as_str()).await;
    }
    if snapshot.capabilities.subscribe {
        let points = transport
            .descriptors(&payload)
            .unwrap_or_default()
            .into_iter()
            .filter(|p| p.access != points::AccessLevel::WriteOnly)
            .map(|p| p.id)
            .collect::<Vec<_>>();
        if !points.is_empty() {
            let intent = acquisition::SubscriptionIntent {
                points,
                acquisition: points::AcquisitionIntent {
                    mode: points::AcquisitionMode::Auto,
                    requested_period_ms: None,
                    deadband: None,
                    priority: points::Priority::Normal,
                    delivery: points::DeliveryClass::State,
                },
            };
            if let Err(error) = transport.subscribe(&id, intent).await {
                data_plane.detach(id.as_str());
                transport.close(&id).await;
                return Err(error.to_string());
            }
        }
    }
    emit_transport_state(sink.as_ref(), id.as_str(), ConnectionState::Connected);
    Ok(snapshot)
}

/// 关闭设备连接 (node_id = 图中设备节点 id) — 无 Tauri 版本。
pub async fn close_device_session(
    transport: &acquisition::AcquisitionRuntime,
    data_plane: &pipeline::DataPlaneState,
    sink: &dyn BackendEventSink,
    node_id: &data_model::device_tree::NodeId,
) -> Result<()> {
    data_plane.mark_source_disconnected(node_id.as_str());
    data_plane.detach(node_id.as_str());
    transport.close(node_id).await;
    emit_transport_state(sink, node_id.as_str(), ConnectionState::Disconnected);
    log::info!("连接已关闭: {node_id}");
    sink.notify(NotifyLevel::Info, "连接已断开");
    Ok(())
}

impl AppState {
    /// Open a device session and attach its byte stream when available.
    ///
    /// 成功后挂载数据平面读任务 (subscribe → 字节路由 → 数值平面)。
    pub async fn open_device(
        &self,
        sink: &EventSinkHandle,
        node: data_model::device_tree::NodeDecl,
    ) -> std::result::Result<data_model::device_tree::NodeSnapshot, String> {
        open_device_session(&self.transport, &self.data_plane, sink, node).await
    }

    /// 关闭设备连接 (node_id = 图中设备节点 id)
    pub async fn close_transport(
        &self,
        sink: &dyn BackendEventSink,
        node_id: &data_model::device_tree::NodeId,
    ) -> Result<()> {
        close_device_session(&self.transport, &self.data_plane, sink, node_id).await
    }

    /// 发送原始字节 (node_id = 目标设备节点 id)
    ///
    /// TX 字节经 `TransportHandle::send` 统一回环到本节点接收广播, 由数据平面
    /// 读任务按信封方向以 Tx 收集一次 — 此处不再旁路重复推入 raw 收集器。
    pub async fn send_raw(
        &self,
        node_id: &data_model::device_tree::NodeId,
        data: Vec<u8>,
    ) -> Result<()> {
        self.transport.send(node_id, &data)
    }

    /// TextOut 手动发送 — 立即把 textout 节点当前图内文本发往其目标 Transport
    ///
    /// 与自动 ticker 共用数据源 (`graph_string_outputs[node]["text"]`) 与换行后缀;
    /// 典型场景: 前端 Send 按钮在值未变化时也强制发送一次。
    pub async fn send_text_out_now(&self, node_id: &str) -> Result<()> {
        // 统一发送门控: 手动发送要求工作区运行中 (与命令帧/自动发送同一纪律)
        if self.data_plane.eval.execution.ticket().is_none() {
            return Err(Error::Config(ConfigError::WorkspaceNotRunning));
        }
        // 找到该 TextOut 的编译规格 (target_transport + newline 后缀; 图重编译间隙容错跳过)
        let spec = {
            let graphs = self.data_plane.eval.graphs.lock();
            graphs
                .values()
                .find_map(|g| {
                    g.compiled()
                        .textouts()
                        .iter()
                        .find(|s| &*s.node_id == node_id)
                        .cloned()
                })
                .ok_or_else(|| {
                    Error::Config(ConfigError::ProtocolNodeNotFound {
                        node_id: node_id.to_string(),
                    })
                })?
        };
        let text = self
            .data_plane
            .eval
            .graph_string_outputs
            .lock()
            .get(node_id)
            .and_then(|p| p.get("text"))
            .cloned()
            .unwrap_or_default();
        let mut payload = text;
        payload.push_str(spec.newline_suffix);
        let target = spec.target_transport.to_string();
        let target_text = target.clone();
        let target = data_model::device_tree::NodeId::new(target).map_err(|_| {
            Error::Config(ConfigError::NodeNotFound {
                node_id: target_text,
            })
        })?;
        self.transport.send(&target, payload.as_bytes())?;
        Ok(())
    }

    /// 发送控件值 (根据绑定模式自动编码)
    ///
    /// - `node_id`: 目标设备节点 id
    /// - `protocol_node`: Auto 编码所用的 Protocol 节点 id (Manual 模式可传 None)
    pub async fn send_widget_value(
        &self,
        node_id: &str,
        protocol_node: Option<String>,
        binding: WidgetBinding,
        value: f32,
    ) -> Result<()> {
        // 统一发送门控: 控件值发送属于手动/值变化发送, 要求工作区运行中
        if self.data_plane.eval.execution.ticket().is_none() {
            return Err(Error::Config(ConfigError::WorkspaceNotRunning));
        }
        let data = match binding {
            WidgetBinding::None => return Ok(()),
            WidgetBinding::Auto { channel, .. } => {
                let pn = protocol_node
                    .ok_or_else(|| Error::Config(ConfigError::AutoBindingMissingProtocolNode))?;
                let st = self
                    .data_plane
                    .protocol_states
                    .lock()
                    .get(&pn)
                    .cloned()
                    .ok_or_else(|| {
                        Error::Config(ConfigError::ProtocolNodeNotFound { node_id: pn })
                    })?;
                let engine = st.lock().engine.clone();
                engine.lock().encode_channel(channel, value)
            }
            WidgetBinding::Manual { template, .. } => template
                .replace(concat!("{", "value", "}"), &value.to_string())
                .into_bytes(),
        };
        let node = data_model::device_tree::NodeId::new(node_id).map_err(|_| {
            Error::Config(ConfigError::NodeNotFound {
                node_id: node_id.to_string(),
            })
        })?;
        self.send_raw(&node, data).await
    }

    /// 发送 CAN 帧
    ///
    /// 通过指定 Protocol 节点引擎的 encode_can 编码为字节, 再经传输注册表发送。
    /// 若该协议不是 CAN 协议 (encode_can 返回空), 直接返回 Ok。
    ///
    /// - `node_id`: 目标设备节点 id
    /// - `protocol_node`: 编码用 Protocol 节点 id; None 时沿全局 BytePlan
    ///   查找该 Transport 下游的第一个 Protocol 节点
    pub async fn send_can_frame(
        &self,
        node_id: &str,
        protocol_node: Option<String>,
        frame: CanFrame,
    ) -> Result<()> {
        let plane = self.data_plane.clone();
        let proto_id = match protocol_node {
            Some(p) => Some(p),
            None => {
                // 沿字节平面找该 transport 下游第一个 Protocol 节点
                let routes = plane.byte_plan.lock().routes_for(node_id).to_vec();
                let nodes = plane.global_nodes.lock();
                routes.iter().find_map(|r| {
                    matches!(
                        nodes.get(&r.target).map(|n| &n.kind),
                        Some(pipeline::NodeKind::Protocol { .. })
                    )
                    .then(|| r.target.clone())
                })
            }
        };
        let Some(proto_id) = proto_id else {
            return Ok(()); // 无可用协议节点, 忽略
        };
        let data = {
            let st = plane
                .protocol_states
                .lock()
                .get(&proto_id)
                .cloned()
                .ok_or_else(|| {
                    Error::Config(ConfigError::ProtocolNodeNotFound {
                        node_id: proto_id.clone(),
                    })
                })?;
            let engine = st.lock().engine.clone();
            engine.lock().encode_can(&frame)
        };
        if data.is_empty() {
            return Ok(()); // 非 CAN 协议, 忽略
        }
        self.transport.send(
            &data_model::device_tree::NodeId::new(node_id).map_err(|_| {
                Error::Config(ConfigError::NodeNotFound {
                    node_id: node_id.to_string(),
                })
            })?,
            &data,
        )
    }

    /// 运行时热更新传输节点的链路配置 (图连接/协议配置变化后由前端推送)
    ///
    /// 当前仅 TestData 生成器消费链路配置 (protocol + 可选 schema); 其他传输类型的
    /// 字节收发与协议无关, 静默接受。节点未打开时返回 PortNotFound, 前端据此 toast 提示用户重连。
    pub async fn update_transport_protocol(
        &self,
        node_id: &str,
        protocol: ProtocolConfig,
        schema: Option<ProtocolSchema>,
        test_data_config: Option<data_model::TestDataConfig>,
    ) -> Result<()> {
        let node_id = data_model::device_tree::NodeId::new(node_id).map_err(|_| {
            Error::Config(ConfigError::NodeNotFound {
                node_id: node_id.to_string(),
            })
        })?;
        self.transport.update_link(
            &node_id,
            TestDataLink { protocol, schema },
            test_data_config,
        )
    }
}

/// 协议回环对照结果 (`send_and_capture` 返回值)
#[derive(Debug, Clone, Serialize)]
pub struct LoopbackResult {
    pub sent_hex: String,
    pub rx_bytes: Vec<u8>,
    pub frame_count: usize,
    pub channels: Vec<f32>,
    pub can_count: usize,
}

impl AppState {
    /// 协议回环：发送字节并立即捕获协议引擎解析结果
    ///
    /// 用于协议调试场景 — 将用户构造的字节发送到 transport (node_id),
    /// 同时直接调用指定 Protocol 节点 (protocol_node) 的引擎解析,
    /// 返回发送字节与解析结果对照。
    ///
    /// 所有 Transport 发送的字节都会经 TransportHandle::send 统一回环到
    /// 本节点接收广播, 读任务也会再次解析; 本方法返回的是**即时同步**
    /// 解析结果, 不等读任务管道。
    pub async fn send_and_capture(
        &self,
        node_id: &str,
        protocol_node: &str,
        data: Vec<u8>,
    ) -> Result<LoopbackResult> {
        // 1. 发送到 transport (TestData 模式下回环)
        //    回环与串口开关无关: 未连接时跳过发送, 仅做本地解析对照
        {
            let manager = &self.transport;
            let node = data_model::device_tree::NodeId::new(node_id).map_err(|_| {
                Error::Config(ConfigError::NodeNotFound {
                    node_id: node_id.to_string(),
                })
            })?;
            if manager.state(&node) == Some(ConnectionState::Connected) {
                manager.send(&node, &data)?;
            }
        }

        // 2. 即时调用协议引擎解析 (同步, 不依赖读任务管道)
        let st = self
            .data_plane
            .protocol_states
            .lock()
            .get(protocol_node)
            .cloned()
            .ok_or_else(|| {
                Error::Config(ConfigError::ProtocolNodeNotFound {
                    node_id: protocol_node.to_string(),
                })
            })?;
        let mut out = st.lock().engine.lock().feed(&data);
        for frame in &mut out.can_frames {
            frame.direction = can::CanDirection::Tx;
        }
        let frames = out.frames;
        let can_count = out.can_frames.len();

        Ok(LoopbackResult {
            sent_hex: data
                .iter()
                .map(|b| format!("{b:02X}"))
                .collect::<Vec<_>>()
                .join(" "),
            rx_bytes: data.clone(),
            frame_count: frames.len(),
            channels: frames
                .first()
                .map(|f| f.channels.clone())
                .unwrap_or_default(),
            can_count,
        })
    }
}

/// CAN 波特率决策 (纯函数) — 优先级: 显式覆盖 (>0) > 传输配置 > 500k 默认。
///
/// 默认值不可省略: 前端可能提交 0, 直接用于负载率换算会除零。
pub const fn can_bitrate_choice(override_bps: Option<u32>, transport_bps: Option<u32>) -> u32 {
    if let Some(bps) = override_bps
        && bps > 0
    {
        return bps;
    }
    match transport_bps {
        Some(bps) => bps,
        None => 500_000,
    }
}

/// 读取指定设备节点的 CAN 波特率与来源标签 (`slcan` / `candle` / `default`)。
///
/// 前端设置面板据此展示默认值; 与 [`can_bitrate_bps`] 共用同一份配置匹配。
pub fn can_bitrate_with_source(state: &AppState, node_id: &str) -> (u32, &'static str) {
    let node = data_model::device_tree::NodeId::new(node_id).ok();
    match node.and_then(|node| state.transport.config(&node)) {
        Some(data_model::TransportConfig::Slcan(config)) => (config.can_bitrate.bps(), "slcan"),
        Some(data_model::TransportConfig::CandleLight(config)) => {
            (config.can_bitrate.bps(), "candle")
        }
        _ => (can_bitrate_choice(None, None), "default"),
    }
}

/// 解析有效 CAN 波特率 (bps) — 取传输配置后按 [`can_bitrate_choice`] 决策。
///
/// 传输配置仅 Slcan / CandleLight 携带 CAN 波特率, 其他连接方式回落默认值。
/// 桌面 IPC 与 HTTP-RPC 的 CAN 负载统计共用此判定。
pub fn can_bitrate_bps(state: &AppState, node_id: &str, override_bps: Option<u32>) -> u32 {
    let node = data_model::device_tree::NodeId::new(node_id).ok();
    let transport_bps = match node.and_then(|node| state.transport.config(&node)) {
        Some(data_model::TransportConfig::Slcan(config)) => Some(config.can_bitrate.bps()),
        Some(data_model::TransportConfig::CandleLight(config)) => Some(config.can_bitrate.bps()),
        _ => None,
    };
    can_bitrate_choice(override_bps, transport_bps)
}

#[cfg(test)]
mod bitrate_tests {
    use super::can_bitrate_choice;

    #[test]
    fn override_bitrate_wins_over_transport() {
        assert_eq!(
            can_bitrate_choice(Some(1_000_000), Some(500_000)),
            1_000_000
        );
    }

    #[test]
    fn zero_override_falls_through_to_transport() {
        assert_eq!(can_bitrate_choice(Some(0), Some(250_000)), 250_000);
    }

    #[test]
    fn transport_config_used_when_no_override() {
        assert_eq!(can_bitrate_choice(None, Some(250_000)), 250_000);
    }

    #[test]
    fn default_500k_prevents_division_by_zero() {
        assert_eq!(can_bitrate_choice(None, None), 500_000);
        assert_eq!(can_bitrate_choice(Some(0), None), 500_000);
    }
}
