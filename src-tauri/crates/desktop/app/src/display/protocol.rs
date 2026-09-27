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
mod tests {
    use super::*;

    #[test]
    fn can_frames_request_accepts_frontend_filter_contract() {
        let request: DisplayRequest = serde_json::from_str(
            r#"{"kind":"can_frames","filter":{"id":291,"direction":"Rx","rtr":false}}"#,
        )
        .unwrap();
        let DisplayRequest::CanFrames { filter } = request else {
            panic!("expected can_frames request");
        };
        let filter = filter.unwrap();
        filter.validate().unwrap();
        assert_eq!(filter.id, Some(0x123));
    }

    #[test]
    fn can_frames_request_preserves_unfiltered_shape() {
        let request: DisplayRequest = serde_json::from_str(r#"{"kind":"can_frames"}"#).unwrap();
        assert!(matches!(
            request,
            DisplayRequest::CanFrames { filter: None }
        ));
    }

    #[test]
    fn panel_request_accepts_port_addressing() {
        let request: DisplayRequest = serde_json::from_str(
            r#"{"kind":"panel","node_id":"src","port":"CH0","panel_kind":"waveform"}"#,
        )
        .unwrap();
        let DisplayRequest::Panel {
            node_id,
            port,
            panel_kind,
        } = request
        else {
            panic!("expected panel request");
        };
        assert_eq!(node_id, "src");
        assert_eq!(port, "CH0");
        assert_eq!(panel_kind, PanelKind::Waveform);
    }

    #[test]
    fn panel_request_defaults_to_node_level_addressing() {
        let request: DisplayRequest =
            serde_json::from_str(r#"{"kind":"panel","node_id":"bus","panel_kind":"can"}"#).unwrap();
        let DisplayRequest::Panel {
            node_id,
            port,
            panel_kind,
        } = request
        else {
            panic!("expected panel request");
        };
        assert_eq!(node_id, "bus");
        assert!(port.is_empty(), "缺省 port = 节点级寻址");
        assert_eq!(panel_kind, PanelKind::Can);
    }

    #[test]
    fn panel_request_requires_a_known_panel_kind() {
        // 面板身份是 kebab-case wire 拼写; 未知身份是契约破坏, 直接反序列化失败
        assert!(
            serde_json::from_str::<DisplayRequest>(
                r#"{"kind":"panel","node_id":"n","panel_kind":"hologram"}"#
            )
            .is_err()
        );
    }
}
