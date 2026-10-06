use super::*;
use crate::toolbox::Toolbox;
use data_model::panel_descriptor::PanelKind::{
    Can, Command, FrameDecoder, Image, Logic, Model3d, Pie, Raw, Spectrum, TableView, Trigger,
    Waveform,
};
use logic::{DecodedEvent, LogicSample};
use raw_data::RawDataDirection;

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

fn toolbox() -> Toolbox {
    Toolbox::from_state(&app::AppState::new())
}

/// 端口级面板在空数据平面上也必须成功 — 空快照是合法结果, 不是错误。
#[test]
fn graph_plane_panels_succeed_on_empty_snapshot() {
    let tb = toolbox();
    for panel in [Pie, Model3d, TableView, Command, Trigger] {
        let value = fetch_panel_data(
            &tb,
            panel,
            &NodePortTarget::at_port("missing", "value"),
            &PanelFetchParams::default(),
        )
        .unwrap_or_else(|error| panic!("{panel:?} 应成功: {error}"));
        assert_eq!(value["outputs"], json!({}), "{panel:?} 空快照");
        assert!(value["tick"].is_u64(), "{panel:?} 带 tick");
    }
}

/// 数值平面按节点收窄, 端口再收窄; 形状不随寻址粒度改变。
#[test]
fn graph_outputs_narrow_by_node_then_port() {
    let tb = toolbox();
    tb.data_plane.eval.output_snapshot.lock().values = [
        (
            "n1".to_string(),
            [
                ("value".to_string(), 1.5_f32),
                ("other".to_string(), 2.5_f32),
            ]
            .into_iter()
            .collect(),
        ),
        (
            "n2".to_string(),
            std::iter::once(("value".to_string(), 9.0_f32)).collect(),
        ),
    ]
    .into_iter()
    .collect();

    let open = fetch_graph_outputs(&tb, &NodePortTarget::new("", ""));
    assert_eq!(open["outputs"]["n1"]["other"], json!(2.5), "空节点 = 全量");

    let by_node = fetch_graph_outputs(&tb, &NodePortTarget::node("  n1  "));
    assert_eq!(by_node["outputs"]["n1"]["other"], json!(2.5));
    assert!(by_node["outputs"].get("n2").is_none(), "其它节点被排除");

    let by_port = fetch_graph_outputs(&tb, &NodePortTarget::at_port("n1", "other"));
    assert_eq!(by_port["outputs"]["n1"]["other"], json!(2.5));
    assert!(
        by_port["outputs"]["n1"].get("value").is_none(),
        "其它端口被排除"
    );
}

/// 频谱按 sink 节点收窄, 空节点返回全部 sink。
#[test]
fn spectrum_narrows_by_sink_node() {
    let tb = toolbox();
    seed_spectrum(&tb, "sink-a");
    seed_spectrum(&tb, "sink-b");

    let open = fetch_spectrum(&tb, "");
    assert!(open["results"].get("sink-a").is_some());
    assert!(open["results"].get("sink-b").is_some());

    let narrowed = fetch_spectrum(&tb, "  sink-b  ");
    assert!(narrowed["results"].get("sink-a").is_none(), "空白也收窄");
    assert_eq!(narrowed["results"]["sink-b"]["values"], json!([3.0, 4.0]));
}

/// 波形与原始字节必须给出数据源节点, 否则定位不到任何缓冲。
#[test]
fn source_scoped_panels_require_a_node() {
    let tb = toolbox();
    for panel in [Waveform, Raw] {
        let error = fetch_panel_data(
            &tb,
            panel,
            &NodePortTarget::node("   "),
            &PanelFetchParams::default(),
        )
        .expect_err("空节点无法寻址");
        assert!(error.contains(panel.as_str()), "{error}");
        assert!(error.contains("未提供节点"), "{error}");
    }
}

/// 波形按数据源节点读取其实时缓冲; `source` 参数可覆盖节点。
#[test]
fn waveform_reads_the_addressed_buffer() {
    let tb = toolbox();
    for value in [1.0_f32, 2.0, 3.0] {
        tb.data_plane
            .buffer_for("proto")
            .lock()
            .push_frame_at(0, &[value]);
    }

    let by_node = fetch_panel_data(
        &tb,
        Waveform,
        &NodePortTarget::node("proto"),
        &PanelFetchParams::default(),
    )
    .expect("按节点寻址");
    assert_eq!(by_node["channels"][0], json!([1.0, 2.0, 3.0]));
    assert_eq!(by_node["timestamps"].as_array().map(Vec::len), Some(3));

    // source 覆盖: 指向另一条空缓冲 → 空窗口而不是借用 proto 的数据
    let by_source = fetch_panel_data(
        &tb,
        Waveform,
        &NodePortTarget::node("proto"),
        &PanelFetchParams {
            source: Some("elsewhere".to_string()),
            ..PanelFetchParams::default()
        },
    )
    .expect("按 source 寻址");
    assert_eq!(by_source["timestamps"], json!([]), "不串源");
}

/// 事件平面面板读取进程级缓冲, 不需要节点寻址。
#[test]
fn event_plane_panels_read_process_buffers() {
    let tb = toolbox();
    tb.logic_buffer.lock().push(LogicSample::new(7, 0b01, 2));
    tb.decoded_buffer.lock().push(DecodedEvent::Uart {
        timestamp: 8,
        byte: 0x41,
        parity_ok: true,
    });

    let samples = fetch_panel_data(
        &tb,
        Logic,
        &NodePortTarget::default(),
        &PanelFetchParams::default(),
    )
    .expect("逻辑平面");
    assert_eq!(samples["sample_count"], json!(1));
    assert_eq!(samples["samples"][0]["timestamp"], json!(7));

    let events = fetch_panel_data(
        &tb,
        FrameDecoder,
        &NodePortTarget::default(),
        &PanelFetchParams::default(),
    )
    .expect("解码平面");
    assert_eq!(events["event_count"], json!(1));
    assert_eq!(events["decoded_events"][0]["Uart"]["byte"], json!(0x41));

    let frames = fetch_panel_data(
        &tb,
        Can,
        &NodePortTarget::default(),
        &PanelFetchParams::default(),
    )
    .expect("CAN 平面");
    assert_eq!(frames["count"], json!(0));
}

/// `count` / `maxBytes` 参数贯穿到读取函数。
#[test]
fn fetch_params_reach_the_readers() {
    let tb = toolbox();
    for timestamp in 0..5_u64 {
        tb.logic_buffer
            .lock()
            .push(LogicSample::new(timestamp, 0, 1));
    }
    let value = fetch_panel_data(
        &tb,
        Logic,
        &NodePortTarget::default(),
        &PanelFetchParams {
            count: Some(2),
            ..PanelFetchParams::default()
        },
    )
    .expect("逻辑平面");
    assert_eq!(value["sample_count"], json!(2), "count 生效");
    assert_eq!(value["samples"][0]["timestamp"], json!(3), "取最近 2 条");

    // 逐字节分块: maxBytes 决定返回多少块 (单块超限时仍至少返回一块)
    let tb = toolbox();
    for byte in [0xAA_u8, 0xBB, 0xCC] {
        tb.data_plane
            .raw_collector_for("dev")
            .lock()
            .push_chunk(1, RawDataDirection::Rx, &[byte]);
    }
    let value = fetch_panel_data(
        &tb,
        Raw,
        &NodePortTarget::node("dev"),
        &PanelFetchParams {
            max_bytes: Some(2),
            ..PanelFetchParams::default()
        },
    )
    .expect("原始数据平面");
    let chunks = value["chunks"].as_array().map(Vec::len);
    assert_eq!(chunks, Some(2), "maxBytes 生效");
    assert_eq!(value["chunks"][0]["hex"], json!("AA"), "按方向与 hex 编码");
}

/// 数据面未实现的面板显式失败, 不伪造空载荷 — 与推送侧同一句文案。
#[test]
fn unavailable_panel_reports_the_missing_data_plane() {
    let tb = toolbox();
    let error = fetch_panel_data(
        &tb,
        Image,
        &NodePortTarget::at_port("w1", "value"),
        &PanelFetchParams::default(),
    )
    .expect_err("image 无数据面");
    assert!(error.contains("image"), "{error}");
    assert!(error.contains("数据面尚未实现"), "{error}");
    // 与推送侧同源: 两端渲染的是同一个 ConfigError, 措辞不会漂移
    assert_eq!(
        error,
        app::display::push_request(Image, &NodePortTarget::node("w1"))
            .expect_err("push 也失败")
            .to_string()
    );
}

/// 参数袋忽略未识别的键 (目录新增参数不应让旧调用方整体失败)。
#[test]
fn params_tolerate_unknown_keys() {
    let params: PanelFetchParams = serde_json::from_value(json!({
        "count": 10,
        "futureKnob": true,
    }))
    .expect("忽略未识别键");
    assert_eq!(params.count, Some(10));
    assert_eq!(params.max_bytes, None);
}

/// 每个面板都必须在分派表里出现 — 新增 `PanelKind` 时此测试逼着补分支。
#[test]
fn every_panel_kind_is_covered() {
    let tb = toolbox();
    assert_eq!(ALL_PANELS.len(), 12, "PanelKind 变体数");
    for panel in ALL_PANELS {
        let target = NodePortTarget::at_port("n1", "value");
        let result = fetch_panel_data(&tb, *panel, &target, &PanelFetchParams::default());
        if *panel == Image {
            assert!(result.is_err(), "image 无数据面");
        } else {
            assert!(result.is_ok(), "{panel:?} 应可拉取: {result:?}");
        }
    }
}

/// 写入一个频谱 sink 的最新结果 —— 不引入 `spectrum` 依赖, 直接用其 wire 形状
/// 反序列化 (契约形状由 `SpectrumResult` 的 `Serialize`/`Deserialize` 保证)。
fn seed_spectrum(tb: &Toolbox, sink: &str) {
    let mut snapshot = tb.data_plane.eval.spectrum_snapshot.lock();
    snapshot.entry(sink.to_string()).or_insert_with(|| {
        serde_json::from_value(json!({ "frequencies": [1.0, 2.0], "values": [3.0, 4.0] }))
            .expect("SpectrumResult 的 wire 形状")
    });
}
