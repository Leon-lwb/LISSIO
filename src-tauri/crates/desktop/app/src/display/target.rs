//! 面板寻址 — 面板身份 + 目标解析为具体显示请求的**唯一**权威。
//!
//! 数据面板在前后端被视作同一类节点: 前端按「面板身份 + 寻址」订阅, 后端把它
//! 展开成既有的 [`DisplayRequest`] 变体再走同一条订阅编排 (见
//! [`super::subscribe_data`] 的面板分支)。因此前端不再需要知道某个面板背后走
//! 的是 `port_samples` 还是 `can_frames` — 那是投递细节。
//!
//! 映射的来源是控件注册表 (`kind::widgets` 的 `PanelSpec.push_request`) 与目录
//! 投影 (`app::models::catalog` 的 `PanelDescriptor.data_plane`), 二者同源于
//! `data_model::panel_descriptor::panel_ops`。本模块只负责「把词表拼写落到具体
//! 变体并填齐缺省字段」。
//!
//! 失败原因复用 `error::PanelResolveReason` (与其余跨 IPC 错误同源), 不在这里
//! 再造第二套错误词表。
//!
//! 寻址语义:
//! - [`NodePortTarget::port`] 为空串 = **节点级** (整库 / 事件平面面板);
//! - 非空 = 该面板读取的端口 handle (数值平面按端口寻址)。

use data_model::panel_descriptor::PanelKind;
use error::{ConfigError, PanelResolveReason, Result};
use waveform::WaveformSeriesSelection;

use super::protocol::{DisplayRequest, RawDataOrigin};

/// 面板数据源目标 — 节点 id + 端口 handle (空串 = 节点级)。
///
/// 纯值类型: 字段公开, 由调用方按需读取 (映射本身只关心端口是否为空)。
#[derive(Clone, Debug, Eq, Default, PartialEq)]
pub struct NodePortTarget {
    /// 数据源节点 id; 整库面板忽略该字段。
    pub node_id: String,
    /// 端口 handle; 空串 (或全空白) 表示节点级寻址。
    pub port: String,
}

impl NodePortTarget {
    /// 由「节点 + 端口」直译 (空端口 = 节点级) — `DisplayRequest::Panel` 的逆。
    pub fn new(node_id: impl Into<String>, port: impl Into<String>) -> Self {
        Self {
            node_id: node_id.into(),
            port: port.into(),
        }
    }

    /// 节点级目标 (整库 / 事件平面面板使用)。
    pub fn node(node_id: impl Into<String>) -> Self {
        Self::new(node_id, String::new())
    }

    /// 端口级目标 (数值平面面板使用)。
    pub fn at_port(node_id: impl Into<String>, port: impl Into<String>) -> Self {
        Self::new(node_id, port)
    }

    /// 是否只做节点级寻址 (端口为空或全空白)。
    pub fn is_node_level(&self) -> bool {
        self.port.trim().is_empty()
    }
}

/// 面板身份的推送请求 — 把面板 + 目标展开为具体 [`DisplayRequest`]。
///
/// 缺省字段 (CAN/逻辑/解码过滤器、波形视图窗口、原始数据方向与检索) 一律取
/// 「不过滤 / 全窗口」: 面板与显示请求一一对应, 过滤是调用方的附加维度, 不在
/// 面板身份的语义里。
///
/// # Errors
///
/// 返回 `error::ConfigError::PanelRequestUnresolved` (kind `Config`,
/// `data.panel` 携带面板拼写):
///
/// - `PanelResolveReason::Unavailable` — 面板数据面尚未实现 (`Image`);
/// - `PanelResolveReason::MissingPort` — 数值平面面板缺少端口寻址。
pub fn push_request(panel: PanelKind, target: &NodePortTarget) -> Result<DisplayRequest> {
    match panel {
        // ---- 数值平面: 按端口寻址 ----
        PanelKind::Pie
        | PanelKind::Model3d
        | PanelKind::TableView
        | PanelKind::Command
        | PanelKind::Trigger => {
            let port = require_port(panel, target)?;
            Ok(DisplayRequest::PortSamples {
                source_node_id: target.node_id.clone(),
                source_handle: port,
            })
        }

        // ---- 端口级专用流 ----
        PanelKind::Waveform => Ok(DisplayRequest::Waveform {
            source: target.node_id.clone(),
            start_ms: None,
            end_ms: None,
            selection: WaveformSeriesSelection::default(),
        }),
        PanelKind::Raw => Ok(DisplayRequest::RawData {
            origin: RawDataOrigin::Transport(target.node_id.clone()),
            direction: String::new(),
            search: String::new(),
        }),

        // ---- 整库 / 事件平面: 忽略寻址, 后端广播 ----
        PanelKind::Spectrum => Ok(DisplayRequest::Spectrum),
        PanelKind::Can => Ok(DisplayRequest::CanFrames { filter: None }),
        PanelKind::Logic => Ok(DisplayRequest::LogicSamples { filter: None }),
        PanelKind::FrameDecoder => Ok(DisplayRequest::DecodedEvents { filter: None }),

        // ---- 数据面尚未实现 (目录声明 PanelDelivery::Unavailable) ----
        PanelKind::Image => Err(unresolved(panel, PanelResolveReason::Unavailable)),
    }
}

fn require_port(panel: PanelKind, target: &NodePortTarget) -> Result<String> {
    let port = target.port.trim();
    if port.is_empty() {
        return Err(unresolved(panel, PanelResolveReason::MissingPort));
    }
    Ok(port.to_owned())
}

/// 统一构造面板解析失败 — 面板拼写作为结构化字段透传到 IPC。
fn unresolved(panel: PanelKind, reason: PanelResolveReason) -> error::AppError {
    ConfigError::PanelRequestUnresolved {
        panel: panel.as_str().to_owned(),
        reason,
    }
    .into()
}

#[cfg(test)]
mod tests {
    use super::*;
    use data_model::panel_descriptor::PanelKind::{
        Can, Command, FrameDecoder, Image, Logic, Model3d, Pie, Raw, Spectrum, TableView, Trigger,
        Waveform,
    };

    const ALL_PANELS: &[PanelKind] = &[
        Waveform,
        Raw,
        Spectrum,
        Can,
        Logic,
        TableView,
        Model3d,
        Pie,
        Image,
        Command,
        FrameDecoder,
        Trigger,
    ];

    /// `PortSamples{source, handle}` 断言 — `DisplayRequest` 不带 `PartialEq`
    /// (它是内部投递类型, 不在 ts-rs 契约面上), 因此逐字段匹配。
    fn assert_port_samples(request: DisplayRequest, source: &str, handle: &str) {
        match request {
            DisplayRequest::PortSamples {
                source_node_id,
                source_handle,
            } => {
                assert_eq!(source_node_id, source);
                assert_eq!(source_handle, handle);
            }
            other => panic!("expected port_samples, got {other:?}"),
        }
    }

    /// 解析失败时 IPC 错误必须带面板结构化字段与可本地化的信息。
    fn assert_unresolved(error: &error::AppError, panel: &str, message: &str) {
        use error::Error as _;
        assert_eq!(error.kind(), "Config");
        assert_eq!(
            error.data_fields().get("panel").map(String::as_str),
            Some(panel)
        );
        assert!(error.to_string().contains(message), "{error}");
    }

    #[test]
    fn target_shape_distinguishes_node_and_port_addressing() {
        let node = NodePortTarget::node("n1");
        assert_eq!(node.node_id, "n1");
        assert!(node.is_node_level());
        let port = NodePortTarget::at_port("n1", "CH0");
        assert!(!port.is_node_level());
        assert_eq!(port.node_id, "n1");
        assert_eq!(port.port, "CH0");
        // 空白端口等同于节点级 (前端可能下发空串或空格)
        assert!(NodePortTarget::at_port("n1", "   ").is_node_level());
        // `new` 是 `DisplayRequest::Panel` 字段的直译
        assert_eq!(NodePortTarget::new("n1", ""), NodePortTarget::node("n1"));
    }

    #[test]
    fn port_addressed_panels_expand_to_port_samples() {
        for panel in [Pie, Model3d, TableView, Command, Trigger] {
            let request =
                push_request(panel, &NodePortTarget::at_port("src", "value")).expect("resolves");
            assert_port_samples(request, "src", "value");
        }
    }

    #[test]
    fn port_addressed_panel_without_port_is_rejected() {
        let error = push_request(TableView, &NodePortTarget::node("src")).expect_err("no port");
        assert_unresolved(&error, "table-view", "需要端口寻址");
    }

    #[test]
    fn image_panel_has_no_data_plane_yet() {
        let error = push_request(Image, &NodePortTarget::node("src")).expect_err("no data plane");
        assert_unresolved(&error, "image", "数据面尚未实现");
        // 带端口也一样 — 不是寻址问题, 是数据面缺失
        let error = push_request(Image, &NodePortTarget::at_port("src", "p")).expect_err("same");
        assert_unresolved(&error, "image", "数据面尚未实现");
    }

    #[test]
    fn singleton_panels_ignore_addressing() {
        let target = NodePortTarget::node("ignored");
        assert!(matches!(
            push_request(Spectrum, &target),
            Ok(DisplayRequest::Spectrum)
        ));
        assert!(matches!(
            push_request(Can, &target),
            Ok(DisplayRequest::CanFrames { filter: None })
        ));
        assert!(matches!(
            push_request(Logic, &target),
            Ok(DisplayRequest::LogicSamples { filter: None })
        ));
        assert!(matches!(
            push_request(FrameDecoder, &target),
            Ok(DisplayRequest::DecodedEvents { filter: None })
        ));
        // 整库面板即使带端口也走广播 (寻址被忽略, 不报错)
        assert!(matches!(
            push_request(Can, &NodePortTarget::at_port("x", "CH0")),
            Ok(DisplayRequest::CanFrames { filter: None })
        ));
    }

    #[test]
    fn waveform_and_raw_data_address_their_source_node() {
        let target = NodePortTarget::at_port("proto", "CH1");
        match push_request(Waveform, &target).expect("waveform") {
            DisplayRequest::Waveform {
                source,
                start_ms,
                end_ms,
                ..
            } => {
                assert_eq!(source, "proto");
                assert!(start_ms.is_none(), "默认无视图窗口");
                assert!(end_ms.is_none());
            }
            other => panic!("unexpected: {other:?}"),
        }
        match push_request(Raw, &target).expect("raw") {
            DisplayRequest::RawData {
                origin,
                direction,
                search,
            } => {
                assert!(
                    matches!(origin, RawDataOrigin::Transport(ref id) if id == "proto"),
                    "传输节点来源"
                );
                assert!(direction.is_empty(), "不过滤方向");
                assert!(search.is_empty(), "不检索");
            }
            other => panic!("unexpected: {other:?}"),
        }
    }

    /// 每个面板都必须在映射里出现 — 新增 `PanelKind` 时此测试逼着补分支。
    #[test]
    fn every_panel_kind_is_covered() {
        assert_eq!(ALL_PANELS.len(), 12, "PanelKind 变体数");
        for panel in ALL_PANELS {
            let port_result = push_request(*panel, &NodePortTarget::at_port("n", "p"));
            let node_result = push_request(*panel, &NodePortTarget::node("n"));
            match panel {
                Image => {
                    let error = port_result.expect_err("image: no data plane");
                    assert_unresolved(&error, "image", "数据面尚未实现");
                }
                Pie | Model3d | TableView | Command | Trigger => {
                    assert!(port_result.is_ok(), "{panel:?} with port");
                    let error = node_result.expect_err("needs a port");
                    assert_unresolved(&error, panel.as_str(), "需要端口寻址");
                }
                _ => {
                    assert!(port_result.is_ok(), "{panel:?}");
                    assert!(node_result.is_ok(), "{panel:?} node level");
                }
            }
        }
    }
}
