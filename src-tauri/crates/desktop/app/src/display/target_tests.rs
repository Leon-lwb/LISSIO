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
