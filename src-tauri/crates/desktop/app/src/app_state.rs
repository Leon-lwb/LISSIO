//! 应用全局状态 — AppState (Tauri-managed) + GraphEvalState 由
//! [`data_plane`] 提供 (本文件 re-use 即可)。

use acquisition::AcquisitionRuntime;
use bus::DataBus;
use can::{CanBuffer, CanLoadStats};
use data_model::PipelineConfig;
use logic::{DecodedBuffer, LogicBuffer};
use parking_lot::{Mutex, RwLock};
use pipeline::NodeKind;
use pipeline::{CompiledGraph, SourceFramesMap, SourceTextsMap};
use pipeline::{
    DEFAULT_CAN_BUFFER_CAPACITY, DEFAULT_CAN_LOAD_STATS_WINDOW, DEFAULT_DECODED_BUFFER_CAPACITY,
    DEFAULT_LOGIC_BUFFER_CAPACITY, GraphEvalState, StreamGroupState, build_graph_eval_state,
};
use raw_data::RawDataCollector;
use std::collections::HashMap;
use std::sync::Arc;
use std::sync::atomic::AtomicU64;
use waveform::DataBuffer;

/// Stop 模式下冻结的原始波形缓存。
pub struct WaveformSnapshot {
    pub source: String,
    pub buffer: Arc<DataBuffer>,
    pub estimated_bytes: usize,
}

/// 应用全局状态
pub struct AppState {
    /// 传输注册表 (node_id → 连接实例; open 是异步的, 用 tokio mutex)
    pub transport: Arc<AcquisitionRuntime>,
    /// 模型目录快照 (组合根装配后注入; 只读 — 目录来自实际注册对象)
    pub model_catalog: RwLock<Option<Arc<data_model::model_descriptor::ModelCatalog>>>,
    /// 设备树驱动注册表 (描述/校验/目录用; 装配后注入)
    pub drivers: RwLock<Option<Arc<device_tree::DriverRegistry>>>,
    /// 数据平面状态 (字节平面 BytePlan / protocol_states / source_frames /
    /// 按源 buffers 与 raw_collectors / 读任务句柄) — 取代旧 protocol/protocol_config/
    /// buffer/raw_data_collector 单例字段
    pub data_plane: pipeline::DataPlaneState,
    /// 节点图 — 按 tab_id 索引 (每个 tab 独立编译图)
    pub graphs: Arc<Mutex<HashMap<String, CompiledGraph>>>,
    /// 图版本号 (见 GraphEvalState::graphs_version)
    pub graphs_version: Arc<AtomicU64>,
    /// 源图存储 — 连线拓扑的后端权威 (最近一次成功编译的 NodeDef/Edge/端口提示;
    /// 拓扑 op 与 `graph:source` 事件的数据源, 见 `graph::source_graph`)
    pub source_graphs: crate::SourceGraphs,
    /// 工作区存储 — widget 配置记录 / 画布位置 / tab 元数据的后端权威,
    /// 随图提交原子更新并落盘 `workspace.json` (见 `workspace` 模块)
    pub workspace: crate::WorkspaceState,
    /// 输入控件当前值 (Knob/Slider/Button/Radio/Checkbox)
    /// key: widget_id, value: 当前值
    /// 由前端 invoke('set_input_value') 更新
    pub input_values: Arc<RwLock<HashMap<String, f32>>>,
    /// Custom widget 回传输出
    /// key: widget_id, value: portId -> value
    /// 由前端 invoke('submit_custom_output') 更新
    pub custom_outputs: Arc<RwLock<HashMap<String, HashMap<String, f32>>>>,
    /// 字符串输出 (Custom JS widget 字符串输出回传通道;
    /// Trigger 的字符串规则输出已由后端图求值直接产出)
    /// key: widget_id, value: portId -> string
    /// 由前端 invoke('submit_custom_text_output') 更新
    pub custom_text_outputs: Arc<Mutex<HashMap<String, HashMap<String, String>>>>,
    /// 字符串输出快照 (TextOutputSnapshot, 供 ticker 推送)
    pub text_output_snapshot: Arc<Mutex<pipeline::StringOutputSnapshot>>,
    /// FrameDecoder 节点旁路原始字节收集器 (供前端 RawData 显示"每帧消费的原始字节")
    /// key: FrameDecoder widget id, value: Arc<Mutex<RawDataCollector>> (共享实例)
    /// 与 decoder_states 生命周期同步, 独立于按 Transport 源的 raw_collectors
    pub decoder_raw_collectors: Arc<Mutex<HashMap<String, Arc<Mutex<RawDataCollector>>>>>,
    /// 所有显示数据流共享的订阅生命周期管理器。
    pub subscriptions: subscription::SubscriptionManager,
    /// 流订阅组注册表 — key: 组 id (首个分片的 channel_id 字符串)
    /// 统一分片框架 (pipeline::stream): RAWDATA/波形/CAN/逻辑/解码共用;
    /// 分片任务退出时 shards-1, 空组移除
    pub stream_groups: Arc<Mutex<HashMap<String, StreamGroupState>>>,
    /// CAN 帧缓冲区
    pub can_buffer: Arc<Mutex<CanBuffer>>,
    /// CAN 负载统计器 (滑动窗口)
    pub can_load_stats: Arc<Mutex<CanLoadStats>>,
    /// 逻辑采样缓冲区
    pub logic_buffer: Arc<Mutex<LogicBuffer>>,
    /// 解码事件缓冲区
    pub decoded_buffer: Arc<Mutex<DecodedBuffer>>,
    /// 流水线参数 (合批/并行解析/流分片/通道容量) — 由 set_pipeline_config 更新,
    /// 数据平面读任务 / 流订阅命令读取
    pub pipeline_config: Arc<RwLock<PipelineConfig>>,
    /// Stop 波形快照注册表；快照拥有独立的原始环形缓存副本。
    pub waveform_snapshots: Arc<Mutex<HashMap<String, WaveformSnapshot>>>,
    /// 快照 id 单调序号 (Arc 共享 — Toolbox/命令层与状态本体同源)。
    pub next_waveform_snapshot_id: Arc<AtomicU64>,
    /// 启动工作区恢复完成门 — setup 阶段恢复在后台任务执行 (不阻塞主线程,
    /// 事件循环可立即绘制启动页); `workspace_get` / 落盘任务 await 此门,
    /// 保持"恢复先于前端水合"的时序语义
    restore_done_tx: tokio::sync::watch::Sender<bool>,
    /// 包络计算引擎 — 端口注入点 (默认纯 CPU; GPU 加速实现由组合根经
    /// `set_envelope_engine` 注入, 见 `waveform::EnvelopeEngine`)
    envelope_engine: std::sync::OnceLock<std::sync::Arc<dyn waveform::EnvelopeEngine>>,
    /// 串口发现服务 — 端口注入点 (L4 `serial` crate 的实现由组合根注入,
    /// 见 [`SerialDiscovery`]); 未注入时能力调用返回明确错误
    serial_discovery: std::sync::OnceLock<std::sync::Arc<dyn SerialDiscovery>>,
}

/// 串口发现端口 — 列举系统串口 (依赖倒置: L3 以下不依赖 `serialport` 等
/// adapter SDK; L4 实现由组合根注入)。
pub trait SerialDiscovery: Send + Sync + 'static {
    /// 列举系统可用串口 (经平台信息富化与去重, 见 `serial` crate)。
    fn list_ports(&self) -> Result<Vec<data_model::PortInfo>, String>;
}

/// 未装配时的占位实现 — 返回明确错误 (不静默空列表, 便于诊断装配遗漏)。
#[derive(Debug, Clone, Copy, Default)]
pub struct SerialDiscoveryUnavailable;

impl SerialDiscovery for SerialDiscoveryUnavailable {
    fn list_ports(&self) -> Result<Vec<data_model::PortInfo>, String> {
        Err("串口发现服务未装配 (组合根未调用 install_serial_discovery)".into())
    }
}

impl AppState {
    pub fn new() -> Self {
        Self::with_acquisition(AcquisitionRuntime::default())
    }

    /// 注入模型目录快照 (组合根装配时调用一次; 只读)。
    pub fn install_model_catalog(&self, catalog: Arc<data_model::model_descriptor::ModelCatalog>) {
        *self.model_catalog.write() = Some(catalog);
    }

    /// 注入设备树驱动注册表 (组合根装配时调用一次)。
    pub fn install_drivers(&self, registry: Arc<device_tree::DriverRegistry>) {
        *self.drivers.write() = Some(registry);
    }

    /// 读取模型目录快照。
    pub fn model_catalog(&self) -> Option<Arc<data_model::model_descriptor::ModelCatalog>> {
        self.model_catalog.read().clone()
    }

    /// Construct application state with adapters assembled by the composition root.
    pub fn with_acquisition(transport_manager: AcquisitionRuntime) -> Self {
        let transport = Arc::new(transport_manager);
        let model_catalog = RwLock::new(None);
        let drivers = RwLock::new(None);
        let graphs = Arc::new(Mutex::new(HashMap::new()));
        let graphs_version = Arc::new(AtomicU64::new(0));
        let source_graphs: crate::SourceGraphs = Arc::new(Mutex::new(HashMap::new()));
        let workspace: crate::WorkspaceState =
            Arc::new(Mutex::new(crate::WorkspaceInner::default()));
        let input_values = Arc::new(RwLock::new(HashMap::new()));
        let custom_outputs = Arc::new(RwLock::new(HashMap::new()));
        let custom_text_outputs = Arc::new(Mutex::new(HashMap::new()));
        let text_output_snapshot = Arc::new(Mutex::new(pipeline::StringOutputSnapshot::default()));
        let source_frames = Arc::new(Mutex::new(SourceFramesMap::default()));
        let source_texts = Arc::new(Mutex::new(SourceTextsMap::default()));
        let output_snapshot = Arc::new(Mutex::new(pipeline::GraphOutputSnapshot {
            tick: 0,
            graphs_version: 0,
            values: pipeline::ValuesMap::default(),
        }));
        let filter_states = Arc::new(Mutex::new(HashMap::new()));
        let decoder_states = Arc::new(Mutex::new(HashMap::new()));
        let decoder_raw_collectors = Arc::new(Mutex::new(HashMap::new()));
        let spectrum_analyzers = Arc::new(Mutex::new(HashMap::new()));
        let spectrum_snapshot = Arc::new(Mutex::new(HashMap::new()));
        let ifft_states = Arc::new(Mutex::new(HashMap::new()));
        let can_buffer = Arc::new(Mutex::new(CanBuffer::new(DEFAULT_CAN_BUFFER_CAPACITY)));
        // DEFAULT_CAN_LOAD_STATS_WINDOW = (window_us, history_capacity)
        let (window_us, history_capacity) = DEFAULT_CAN_LOAD_STATS_WINDOW;
        let can_load_stats = Arc::new(Mutex::new(CanLoadStats::new(window_us, history_capacity)));
        let logic_buffer = Arc::new(Mutex::new(LogicBuffer::new(DEFAULT_LOGIC_BUFFER_CAPACITY)));
        let decoded_buffer = Arc::new(Mutex::new(DecodedBuffer::new(
            DEFAULT_DECODED_BUFFER_CAPACITY,
        )));
        let pipeline_config = Arc::new(RwLock::new(PipelineConfig::default()));
        let bus = DataBus::default();
        let recording = recording::RecordingHub::default();
        let (restore_done_tx, _restore_done_rx) = tokio::sync::watch::channel(false);

        let eval: GraphEvalState = build_graph_eval_state(
            bus,
            recording,
            graphs.clone(),
            graphs_version.clone(),
            input_values.clone(),
            custom_outputs.clone(),
            text_output_snapshot.clone(),
            custom_text_outputs.clone(),
            source_frames.clone(),
            source_texts.clone(),
            output_snapshot,
            filter_states,
            decoder_states,
            decoder_raw_collectors.clone(),
            spectrum_analyzers,
            spectrum_snapshot,
            ifft_states,
        );
        let data_plane = pipeline::DataPlaneState::new(
            transport.clone(),
            eval,
            source_frames,
            source_texts,
            can_buffer.clone(),
            can_load_stats.clone(),
            logic_buffer.clone(),
            decoded_buffer.clone(),
            pipeline_config.clone(),
        );

        Self {
            transport,
            model_catalog,
            drivers,
            data_plane,
            graphs,
            graphs_version,
            source_graphs,
            workspace,
            input_values,
            custom_outputs,
            custom_text_outputs,
            text_output_snapshot,
            decoder_raw_collectors,
            subscriptions: subscription::SubscriptionManager::new(),
            stream_groups: Arc::new(Mutex::new(HashMap::new())),
            can_buffer,
            can_load_stats,
            logic_buffer,
            decoded_buffer,
            pipeline_config,
            waveform_snapshots: Arc::new(Mutex::new(HashMap::new())),
            next_waveform_snapshot_id: Arc::new(AtomicU64::new(1)),
            restore_done_tx,
            envelope_engine: std::sync::OnceLock::new(),
            serial_discovery: std::sync::OnceLock::new(),
        }
    }

    /// 订阅启动恢复完成门 (workspace_get / 落盘任务 await 用)
    pub fn subscribe_restore_done(&self) -> tokio::sync::watch::Receiver<bool> {
        self.restore_done_tx.subscribe()
    }

    /// 标记启动恢复已完成 (无论成败) — 放行所有 await 方
    pub fn signal_restore_done(&self) {
        // 必须用 `send_replace` 而非 `send`: `AppState` 构造时丢弃了初始 receiver,
        // 而无界面出口 (`backend-host::assemble`) 在装配期同步发信号 — 此刻订阅方
        // 往往还没创建。`watch::Sender::send` 在零接收者时直接返回错误且**不写入值**,
        // 迟到的订阅者会永远等不到 `changed()`, 于是 `workspace_get` 挂起、工作区
        // 防抖落盘循环空转。`send_replace` 无条件写入, 与订阅时序无关。
        self.restore_done_tx.send_replace(true);
    }

    /// 注入包络计算引擎 (GPU 加速实现由组合根在装配期调用一次)。
    pub fn set_envelope_engine(&self, engine: std::sync::Arc<dyn waveform::EnvelopeEngine>) {
        let _ = self.envelope_engine.set(engine);
    }

    /// 当前包络引擎 — 未注入时回落纯 CPU 实现 (测试 / 无界面兜底)。
    pub fn envelope_engine(&self) -> std::sync::Arc<dyn waveform::EnvelopeEngine> {
        self.envelope_engine
            .get()
            .cloned()
            .unwrap_or_else(|| std::sync::Arc::new(waveform::CpuEnvelopeEngine))
    }

    /// 注入串口发现服务 (L4 实现由组合根在装配期调用一次)。
    pub fn set_serial_discovery(&self, discovery: std::sync::Arc<dyn SerialDiscovery>) {
        let _ = self.serial_discovery.set(discovery);
    }

    /// 当前串口发现服务 — 未注入时返回占位实现 (调用报明确错误)。
    pub fn serial_discovery(&self) -> std::sync::Arc<dyn SerialDiscovery> {
        self.serial_discovery
            .get()
            .cloned()
            .unwrap_or_else(|| std::sync::Arc::new(SerialDiscoveryUnavailable))
    }

    /// 抽取图评估所需的 Arc 字段 (供 ticker / 数据平面持有)
    pub fn eval_state(&self) -> GraphEvalState {
        self.data_plane.eval.clone()
    }

    /// 图提交后清理已不存在 Protocol 源的停止快照。
    ///
    /// 正常前端卸载会显式 release；此处覆盖崩溃、HMR 或 IPC 清理失败等异常路径。
    pub fn prune_waveform_snapshots(&self) {
        let live_sources = self
            .data_plane
            .global_nodes
            .lock()
            .values()
            .filter_map(|node| matches!(&node.kind, NodeKind::Protocol { .. }).then_some(&node.id))
            .cloned()
            .collect::<std::collections::HashSet<_>>();
        self.waveform_snapshots
            .lock()
            .retain(|_, snapshot| live_sources.contains(&snapshot.source));
    }
}

impl Default for AppState {
    fn default() -> Self {
        Self::new()
    }
}

#[cfg(test)]
mod tests {
    use super::{AppState, WaveformSnapshot};
    use pipeline::{NodeDef, NodeKind};
    use schema_types::ProtocolConfig;
    use std::sync::Arc;
    use waveform::DataBuffer;

    #[test]
    fn prune_waveform_snapshots_releases_orphaned_sources() {
        let state = AppState::new();
        state.data_plane.global_nodes.lock().insert(
            "live".into(),
            NodeDef::new(
                "live".into(),
                "tab".into(),
                NodeKind::Protocol {
                    schema: schema_types::schema_from_protocol_config(&ProtocolConfig::FireWater {
                        channels: Some(1),
                    }),
                    config: ProtocolConfig::FireWater { channels: Some(1) },
                    convert_to: None,
                },
            ),
        );
        for (id, source) in [("keep", "live"), ("release", "gone")] {
            state.waveform_snapshots.lock().insert(
                id.into(),
                WaveformSnapshot {
                    source: source.into(),
                    buffer: Arc::new(DataBuffer::new(4, 1)),
                    estimated_bytes: 48,
                },
            );
        }

        state.prune_waveform_snapshots();

        let snapshots = state.waveform_snapshots.lock();
        assert!(snapshots.contains_key("keep"));
        assert!(!snapshots.contains_key("release"));
    }

    /// 恢复完成门必须在"发信号时还没有订阅者"的时序下也放行迟到订阅者。
    ///
    /// 无界面出口在装配期同步发信号 (此时服务端还没人订阅), 而 `AppState` 构造时
    /// 丢弃了初始 receiver — `watch::Sender::send` 在零接收者时不写入值, 因此
    /// 迟到订阅者会永远等不到 `changed()` (表现为 `workspace_get` 挂起)。
    #[tokio::test]
    async fn restore_done_signal_reaches_late_subscribers() {
        let state = AppState::new();
        state.signal_restore_done();

        let mut late = state.subscribe_restore_done();
        assert!(*late.borrow_and_update(), "迟到订阅者必须直接看到已完成");

        tokio::time::timeout(
            std::time::Duration::from_secs(1),
            crate::workspace::await_restore_done(&state),
        )
        .await
        .expect("已完成的门不得再挂起等待");
    }

    /// 先订阅再发信号同样放行, 且不会漏掉变更。
    #[tokio::test]
    async fn restore_done_signal_wakes_existing_subscribers() {
        let state = AppState::new();
        let mut waiting = state.subscribe_restore_done();
        assert!(!*waiting.borrow_and_update());

        state.signal_restore_done();
        tokio::time::timeout(std::time::Duration::from_secs(1), waiting.changed())
            .await
            .expect("发信号必须唤醒等待方")
            .expect("发送端常驻, 不应关闭");
        assert!(*waiting.borrow_and_update());
    }
}
