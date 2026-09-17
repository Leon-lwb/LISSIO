//! 工具所需的应用状态切片 (全部为 `Arc` 共享句柄)。

use std::collections::HashMap;
use std::sync::Arc;
use std::sync::atomic::AtomicU64;

use app::AppState;

/// 后端控制工具所需的应用状态切片 (全部为 `Arc` 共享句柄)。
///
/// 各字段本就是 `AppState` 中的同一份 `Arc`, 因此从任一持有者 (Tauri 组合根 /
/// 无界面 host / CLI) 提取后都操作同一份运行状态。
#[derive(Clone)]
pub struct Toolbox {
    /// 传输注册表 (与 `AppState::transport` 同一实例)。
    pub transport: Arc<acquisition::AcquisitionRuntime>,
    /// 数据平面 (字节路由 / 缓冲 / 输出快照)。
    pub data_plane: pipeline::DataPlaneState,
    /// 控件输入值表。
    pub input_values: Arc<parking_lot::RwLock<HashMap<String, f32>>>,
    /// tab 图表 (节点图提交)。
    pub graphs: Arc<parking_lot::Mutex<HashMap<String, pipeline::CompiledGraph>>>,
    /// 图版本号 (节点图提交)。
    pub graphs_version: Arc<AtomicU64>,
    /// 源图存储 (连线拓扑权威 — connect_edge/disconnect_edge op 与 graph:source 事件)。
    pub source_graphs: app::SourceGraphs,
    /// 工作区存储 (widget 配置记录 / 画布位置 / tab 元数据 — 随图提交原子更新)。
    pub workspace: app::WorkspaceState,
    /// 流订阅组注册表 (运行控制切换时重置流序列)。
    pub stream_groups: pipeline::StreamGroups,
    /// CAN 帧缓冲区。
    pub can_buffer: Arc<parking_lot::Mutex<can::CanBuffer>>,
    /// CAN 负载统计器 (滑动窗口)。
    pub can_load_stats: Arc<parking_lot::Mutex<can::CanLoadStats>>,
    /// 逻辑采样缓冲区。
    pub logic_buffer: Arc<parking_lot::Mutex<logic::LogicBuffer>>,
    /// 解码事件缓冲区。
    pub decoded_buffer: Arc<parking_lot::Mutex<logic::DecodedBuffer>>,
    /// FrameDecoder 节点旁路原始字节收集器 (key = FrameDecoder widget id)。
    pub decoder_raw_collectors: Arc<
        parking_lot::Mutex<HashMap<String, Arc<parking_lot::Mutex<raw_data::RawDataCollector>>>>,
    >,
    /// 停止波形快照注册表 (快照拥有独立的原始环形缓存副本)。
    pub waveform_snapshots: Arc<parking_lot::Mutex<HashMap<String, app::WaveformSnapshot>>>,
    /// 快照 id 单调序号。
    pub next_waveform_snapshot_id: Arc<AtomicU64>,
    /// 流水线参数 (合批/内存预算等 — 快照创建受内存预算约束)。
    pub pipeline_config: Arc<parking_lot::RwLock<data_model::PipelineConfig>>,
    /// 串口发现服务 (端口注入 — L4 `serial` 实现由宿主装配)。
    pub serial_discovery: Arc<dyn app::SerialDiscovery>,
}

impl Toolbox {
    /// 从应用状态提取共享句柄。
    pub fn from_state(state: &AppState) -> Self {
        Self {
            transport: Arc::clone(&state.transport),
            data_plane: state.data_plane.clone(),
            input_values: Arc::clone(&state.input_values),
            graphs: Arc::clone(&state.graphs),
            graphs_version: Arc::clone(&state.graphs_version),
            source_graphs: Arc::clone(&state.source_graphs),
            workspace: Arc::clone(&state.workspace),
            stream_groups: Arc::clone(&state.stream_groups),
            can_buffer: Arc::clone(&state.can_buffer),
            can_load_stats: Arc::clone(&state.can_load_stats),
            logic_buffer: Arc::clone(&state.logic_buffer),
            decoded_buffer: Arc::clone(&state.decoded_buffer),
            decoder_raw_collectors: Arc::clone(&state.decoder_raw_collectors),
            waveform_snapshots: Arc::clone(&state.waveform_snapshots),
            next_waveform_snapshot_id: Arc::clone(&state.next_waveform_snapshot_id),
            pipeline_config: Arc::clone(&state.pipeline_config),
            serial_discovery: state.serial_discovery(),
        }
    }
}
