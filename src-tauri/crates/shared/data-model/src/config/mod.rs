//! 配置模块 — 传输层 / 控件 / 流水线三组可调参数
//!
//! - [`transport_config`]: `TransportConfig` enum + 7 种 backend 配置 + `TestSignal`
//! - [`widget_binding`]: `WidgetBinding` 控件数据绑定 (None/Auto/Manual)
//! - [`pipeline_config`]: `PipelineConfig` 流水线合批/并行参数

pub mod pipeline_config;
pub mod transport_config;
pub mod widget_binding;

pub use pipeline_config::{PipelineConfig, PipelineMode};
pub use transport_config::{
    CandleConfig, SerialConfig, SlcanConfig, TcpClientConfig, TcpServerConfig, TestDataConfig,
    TestSignal, TransportConfig, UdpConfig,
};
pub use widget_binding::WidgetBinding;
