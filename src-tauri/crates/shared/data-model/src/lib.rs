//! # core
//!
//! Lissio 基础类型 crate — 跨所有下游 crate 的共同类型基础。
//!
//! 模块:
// - [`frame`]: 数据帧 `DataFrame`、原始字节 `RawData`、连接状态、端口信息、传输统计。
// - [`serial_params`]: 串口基础参数 `Parity` / `StopBits` / `FlowControl`。
// - [`config`]: 传输层 (`TransportConfig` + 7 种 backend)、控件 (`WidgetConfig` + 9 种控件)
//!   与流水线 (`PipelineConfig`) 三组可调配置。
//!
//!
//! ## 设计原则
//!
//! 1. **单职责**:本 crate 仅承载跨域基础类型,**不依赖**任何 `protocol`/`buffer`/`nodes`/`automotive` 等。
//!    仅依赖 [`can`] 用于 `SlcanConfig`/`CandleConfig` 的 `CanBitrate`,以及
//!    [`error`] crate 提供的统一错误抽象。
//! 2. **serde 优先**:几乎所有类型派生 `Serialize`/`Deserialize`,便于与前端 IPC。
//! 3. **零业务**:仅数据载体,不包含协议解析/缓冲管理/调度逻辑。

pub mod config;
pub mod device;
pub mod device_tree;
pub mod frame;
pub mod model_descriptor;
pub mod panel_descriptor;
pub mod serial_params;
pub mod simulation;

/// Transport → 数据平面 ingest 广播通道容量。
///
/// 生成侧按 [`simulation::MESSAGE_SAMPLE_SECONDS`] 的固定节拍发布: 速率不低于
/// 200 采样/秒时消息条率约为 200 条/s **与速率无关**, 只有消息**大小**随速率
/// 增长 (`simulation::samples_per_message`)。读任务单次服务 (合批 + 解析) 可达
/// 数十毫秒, 容量必须吸收数倍于服务时间的抖动, 否则广播环被覆盖 →
/// `RecvError::Lagged` 直接丢数据 (波形出现永久空洞)。
///
/// 4096 条 ≈ 20s @ 200 条/s 的抖动余量; 内存上界 = 容量 × 单条字节数 (单条随
/// 速率线性增长), 故高采样率下的实际驻留量由消息大小而非条数决定。
pub const INGEST_CHANNEL_CAPACITY: usize = 4096;

pub use config::{
    ButtonConfig, CandleConfig, CheckboxConfig, ChoiceOption, ImageConfig, ImageFormat, KnobConfig,
    LabelConfig, PieChartConfig, PipelineConfig, PipelineMode, RadioConfig, SerialConfig,
    SlcanConfig, SliderConfig, TcpClientConfig, TcpServerConfig, TestDataConfig, TestSignal,
    TransportConfig, UdpConfig, WaveformConfig, WidgetBinding, WidgetConfig,
};
pub use frame::{
    CanBitrate, ConnectionState, DataFrame, PortInfo, RawData, TransportStats, now_us,
};
pub use model_descriptor::ConfigurationSchema;
pub use serial_params::{FlowControl, Parity, StopBits};
