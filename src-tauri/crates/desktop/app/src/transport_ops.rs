//! 传输连接操作 — 打开/关闭/发送的编排逻辑 (原 cmd/can_transport 命令体下沉)
//!
//! 层级: L3 app (app_state)。open+attach 配对、断连事件、TX 旁路收集等
//! 编排不变量属于应用核心; L4 cmd/can_transport 只保留 IPC 薄壳。
//!
//! L1 类型 (TransportManager) 经 [`runtime`] 门面引用, 不直连 transport crate。

use can::CanFrame;
use data_model::{ConnectionState, Error, Result, TransportConfig, WidgetBinding};
use error::ConfigError;
use events::{emit_transport_state, notify};
use schema_types::{ProtocolConfig, ProtocolSchema, TestDataLink};
use serde::Serialize;
use tauri::AppHandle;

use crate::app_state::AppState;

impl AppState {
    /// 打开传输连接 (node_id = 图中 Transport 节点 id)
    ///
    /// `protocol` 与 `schema` 仅被 TestData 用作生成数据的线缆格式参考, 其他传输类型忽略。
    /// 成功后挂载数据平面读任务 (subscribe → 字节路由 → 数值平面)。
    pub async fn open_transport(
        &self,
        app: &AppHandle,
        node_id: &str,
        config: TransportConfig,
        protocol: ProtocolConfig,
        schema: Option<ProtocolSchema>,
    ) -> Result<()> {
        let kind = notify::transport_kind_str(&config);
        {
            let mut manager = self.transport.lock().await;
            let link = TestDataLink { protocol, schema };
            if let Err(e) = manager.open(node_id, config, link).await {
                log::error!("连接失败 ({node_id}): {e}");
                notify::error(app, format!("连接失败: {e}"));
                return Err(e);
            }
        }

        emit_transport_state(app, node_id, ConnectionState::Connected);
        log::info!("连接已建立: {kind} ({node_id})");
        notify::connected(app, kind);

        // 挂载数据平面读任务 (每 Transport 节点一个)
        self.data_plane.attach(app.clone(), node_id).await;
        Ok(())
    }

    /// 关闭传输连接 (node_id = 图中 Transport 节点 id)
    pub async fn close_transport(&self, app: &AppHandle, node_id: &str) -> Result<()> {
        self.data_plane.mark_source_disconnected(node_id);
        self.data_plane.detach(node_id);
        self.transport.lock().await.close(node_id);
        emit_transport_state(app, node_id, ConnectionState::Disconnected);
        log::info!("连接已关闭: {node_id}");
        notify::disconnected(app);
        Ok(())
    }

    /// 发送原始字节 (node_id = 目标 Transport 节点 id)
    pub async fn send_raw(&self, node_id: &str, data: Vec<u8>) -> Result<()> {
        self.transport.lock().await.send(node_id, &data)?;
        // TX 方向字节进该源的 raw 收集器 (收集器在 attach 时已建; 未打开时上面的 send 已报错)
        self.data_plane
            .raw_collector_for(node_id)
            .lock()
            .push_chunk(data_model::now_us(), raw_data::RawDataDirection::Tx, &data);
        Ok(())
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
        self.transport
            .lock()
            .await
            .send(&target, payload.as_bytes())?;
        Ok(())
    }

    /// 发送控件值 (根据绑定模式自动编码)
    ///
    /// - `node_id`: 目标 Transport 节点 id
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
                let bytes = engine.lock().encode_channel(channel, value);
                bytes
            }
            WidgetBinding::Manual { template, .. } => template
                .replace(concat!("{", "value", "}"), &value.to_string())
                .into_bytes(),
        };
        self.send_raw(node_id, data).await
    }

    /// 发送 CAN 帧
    ///
    /// 通过指定 Protocol 节点引擎的 encode_can 编码为字节, 再经传输注册表发送。
    /// 若该协议不是 CAN 协议 (encode_can 返回空), 直接返回 Ok。
    ///
    /// - `node_id`: 目标 Transport 节点 id
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
            let bytes = engine.lock().encode_can(&frame);
            bytes
        };
        if data.is_empty() {
            return Ok(()); // 非 CAN 协议, 忽略
        }
        self.transport.lock().await.send(node_id, &data)
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
        self.transport.lock().await.update_link(
            node_id,
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
            let manager = self.transport.lock().await;
            if manager.state(node_id) == Some(ConnectionState::Connected) {
                manager.send(node_id, &data)?;
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
        let out = st.lock().engine.lock().feed(&data);
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
