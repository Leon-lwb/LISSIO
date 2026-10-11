use std::collections::HashMap;

use can::{CanFrameBatch, CanFrameFilter, CanLoadSnapshot};
use data_model::panel_descriptor::PanelKind;
use logic::{DecodedEventBatch, DecodedEventFilter, LogicSampleBatch, LogicSampleFilter};
use pipeline::{CustomInputBatch, GraphOutputSnapshot, StringOutputSnapshot};
use raw_data::RawDataBatch;
use serde::{Deserialize, Serialize};
use spectrum::SpectrumResult;
use waveform::{DerivedSeriesSelector, WaveformSeriesSelection};

/// RawData 可以来自传输节点或 FrameDecoder 节点旁路。
#[derive(Debug, Clone, Deserialize)]
#[serde(tag = "kind", content = "id", rename_all = "snake_case")]
pub enum RawDataOrigin {
    Transport(String),
    Decoder(String),
}

/// 显示订阅请求。过滤条件是数据源的一部分，由后端执行。
///
/// [`DisplayRequest::Panel`] 是**未展开**的面板形态: 调用方只声明「哪个面板,
/// 寻址到哪」, 由 [`super::target::push_request`] 展开为下面的具体变体后再走
/// 同一条订阅编排。其余变体是展开后的投递细节。
#[derive(Debug, Clone, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum DisplayRequest {
    GraphOutputs,
    CustomInputs,
    StringOutputs,
    Spectrum,
    PortSamples {
        source_node_id: String,
        source_handle: String,
    },
    Waveform {
        source: String,
        #[serde(default)]
        start_ms: Option<f64>,
        #[serde(default)]
        end_ms: Option<f64>,
        #[serde(default)]
        selection: WaveformSeriesSelection,
    },
    /// 后端测量流 (统计 + 周期/频率, 权威缓冲金字塔快照上计算) — JSON 推送
    Measurements {
        source: String,
        /// 测量窗口 (相对最新时间戳, 毫秒) — 随前端时基变化重订阅
        window_ms: f64,
        /// 参与测量的派生序列 (MATH/Filter 接入波形 sink 的输出)
        #[serde(default)]
        derived: Vec<DerivedSeriesSelector>,
    },
    /// 波形包络 (wgpu/CPU 逐列 min/max 降采样) — 二进制推送, 前端缎带绘制
    WaveformEnvelope {
        source: String,
        /// 输出列数 (画布像素列), 后端 clamp 到 16..=4096
        columns: u32,
    },
    RawData {
        origin: RawDataOrigin,
        #[serde(default)]
        direction: String,
        #[serde(default)]
        search: String,
    },
    CanFrames {
        #[serde(default)]
        filter: Option<CanFrameFilter>,
    },
    LogicSamples {
        #[serde(default)]
        filter: Option<LogicSampleFilter>,
    },
    DecodedEvents {
        #[serde(default)]
        filter: Option<DecodedEventFilter>,
    },
    CanLoad {
        node_id: String,
        #[serde(default)]
        bitrate_bps: Option<u32>,
    },
    /// 数据面板推送订阅 — 面板身份 + 寻址, 由后端展开为投递细节。
    ///
    /// `port` 为空串表示节点级寻址 (整库 / 事件平面面板)。展开规则见
    /// [`super::target::push_request`]; 面板目录 (`ModelCatalog.panels`) 是
    /// 可用面板身份与投递形态的权威。
    Panel {
        node_id: String,
        #[serde(default)]
        port: String,
        panel_kind: PanelKind,
    },
}

/// 订阅建立结果。连续数值使用 binary，其余事件仍使用 json。
#[derive(Debug, Clone, Serialize)]
pub struct SubscriptionInfo {
    pub subscription_id: u32,
    pub schema_version: u16,
    pub mode: &'static str,
}

/// 单一 IPC 事件联合。serde 标签让 TypeScript 可穷尽分派。
#[derive(Debug, Clone, Serialize)]
#[serde(tag = "kind", content = "payload", rename_all = "snake_case")]
pub enum DisplayEvent {
    GraphOutputs(GraphOutputSnapshot),
    CustomInputs(CustomInputBatch),
    StringOutputs(StringOutputSnapshot),
    Spectrum(HashMap<String, SpectrumResult>),
    Measurements(crate::SourceMeasurements),
    RawData(RawDataBatch),
    CanFrames(CanFrameBatch),
    LogicSamples(LogicSampleBatch),
    DecodedEvents(DecodedEventBatch),
    CanLoad(CanLoadSnapshot),
}

#[cfg(test)]
#[path = "protocol_tests.rs"]
mod tests;
