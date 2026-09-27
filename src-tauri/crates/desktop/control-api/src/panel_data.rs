//! 数据面板拉取侧 — 与推送侧 (`app::display::push_request`) 对称的一次性读取入口。
//!
//! 面板在前后端被视作同一类节点 (词表见 `data_model::panel_descriptor`): 推送侧把
//! 「面板 + 寻址」展开为 `DisplayRequest` 后汇入订阅编排, 拉取侧把同一份寻址落到
//! 既有缓冲读取函数上。两侧共用 `app::NodePortTarget` 与 `error::PanelResolveReason`,
//! 不另造寻址或错误词表。
//!
//! 本模块**不新增数据平面**: 每个面板都委派到既有能力函数 (波形缓冲 / 原始字节
//! 收集器 / CAN 帧缓冲 / 逻辑与解码缓冲 / 数值输出快照 / 频谱快照), 因此「拉取一次」
//! 与「订阅一路」看到的是同一份数据。拉取面的用途是面板初次打开、重连补齐, 以及
//! 无界面出口 (MCP / CLI) 与内嵌 AI 的一次性读取。
//!
//! 操作名与面板的对应关系由 `data_model::panel_descriptor::panel_ops` 单点定义,
//! 随面板目录 (`PanelDescriptor::data_plane::fetch_op`) 下发到前端; 本模块只负责把
//! 该操作名落到具体读取函数上 — 见 [`fetch_panel_data`] 的分派表。
//!
//! ## 寻址
//!
//! [`NodePortTarget`] 的语义与推送侧一致:
//!
//! - 端口为空串 (或全空白) = **节点级** — 整库 / 事件平面面板忽略节点, 按库读取;
//! - 端口非空 = 该面板读取的端口 handle — 数值平面按端口收窄。
//!
//! 推送侧对整库面板 (频谱 / CAN / 逻辑 / 解码事件) 一律广播全量; 拉取侧是**实例
//! 作用域**的, 因此允许按节点收窄 (频谱按 sink 节点, 数值平面按 widget 节点),
//! 空节点仍返回全量。收窄只改变返回广度, 不改变载荷形状。

use app::display::NodePortTarget;
use data_model::panel_descriptor::PanelKind;
use error::{ConfigError, PanelResolveReason};
use serde::Deserialize;
use serde_json::{Map, Value, json};

use crate::data;
use crate::toolbox::Toolbox;
use crate::tools;

/// 波形一次拉取的点数缺省值 — 与波形面板声明的 `default_max_items` 同量级。
const DEFAULT_WAVEFORM_POINTS: u32 = 4_096;
/// CAN 一次拉取的帧数缺省值。
const DEFAULT_CAN_FRAMES: u32 = 200;
/// 逻辑采样 / 解码事件一次拉取的条数缺省值。
const DEFAULT_LOGIC_ITEMS: u32 = 500;
/// 原始字节一次拉取的字节数缺省值 — 与原始数据面板声明的 `default_max_items` 一致。
const DEFAULT_RAW_BYTES: u32 = 65_536;

/// 面板拉取的可选参数 — 推送侧同一批含义是 `DisplayRequest` 的字段, 这里按面板
/// 语义表达为可选字段, 缺省值取面板目录声明的建议值。
///
/// 未识别的键被忽略: 这是「每面板参数袋」, 不同面板的形状本就不同, 严格拒绝会让
/// 目录新增参数时旧调用方整体失败。
#[derive(Clone, Debug, Default, Deserialize)]
#[serde(default, rename_all = "camelCase")]
pub struct PanelFetchParams {
    /// 数据源键 (波形缓冲 / 原始字节收集器); 缺省回落到寻址给出的节点 id。
    pub source: Option<String>,
    /// 读取条数 (波形点数 / CAN 帧数 / 逻辑采样数 / 解码事件数)。
    pub count: Option<u32>,
    /// 原始字节读取量上限 (字节)。
    pub max_bytes: Option<u32>,
    /// CAN 负载百分比估算所依据的波特率 (bps); 缺省由统计器取默认值。
    pub bitrate: Option<u32>,
}

/// 拉取一个数据面板此刻的数据 — 面板**拉取面**的唯一入口。
///
/// 分派表 (每个面板恰好落到一个既有读取函数, 不复制裁剪与上限逻辑):
///
/// | 面板 | 读取函数 | 载荷 |
/// | --- | --- | --- |
/// | `Waveform` | [`data::get_recent_waveform_window`] | 波形窗口 |
/// | `Spectrum` | 频谱快照 (`eval.spectrum_snapshot`) | `results` (按 sink 节点) |
/// | `Raw` | [`tools::get_raw_data`] | 原始字节块 + 统计 |
/// | `Can` | [`tools::get_can_frames`] | 帧 + 负载统计 |
/// | `Logic` | [`tools::get_logic_samples`] | 逻辑采样 |
/// | `FrameDecoder` | [`tools::get_decoded_events`] | 解码事件 |
/// | `Pie` / `Model3d` / `TableView` / `Command` / `Trigger` | 输出快照 (`eval.output_snapshot`) | `tick` + `outputs` |
/// | `Image` | — | 失败 (`Unavailable`) |
///
/// # Errors
///
/// 返回由 `error::ConfigError::PanelRequestUnresolved` 渲染的文案 (与推送侧
/// `app::display::push_request` 逐字同源, 两侧措辞不会漂移):
///
/// - `PanelResolveReason::MissingNode` — 面板按节点寻址的数据源 (波形缓冲 /
///   原始字节收集器), 但请求未给出节点;
/// - `PanelResolveReason::Unavailable` — 面板数据面尚未实现 (`Image`)。
pub fn fetch_panel_data(
    tb: &Toolbox,
    panel_kind: PanelKind,
    target: &NodePortTarget,
    params: &PanelFetchParams,
) -> Result<Value, String> {
    match panel_kind {
        // ---- 端口级专用平面: 按数据源节点读取 ----
        PanelKind::Waveform => {
            let source = resolve_source(panel_kind, target, params)?;
            let count = params.count.unwrap_or(DEFAULT_WAVEFORM_POINTS) as usize;
            let window = data::get_recent_waveform_window(tb, source, count)?;
            serde_json::to_value(&window).map_err(|error| format!("波形窗口序列化失败: {error}"))
        }
        PanelKind::Raw => {
            let source = resolve_source(panel_kind, target, params)?;
            let max_bytes = params.max_bytes.unwrap_or(DEFAULT_RAW_BYTES);
            Ok(tools::get_raw_data(tb, source, max_bytes))
        }

        // ---- 事件平面: 进程级缓冲, 节点仅用于收窄 ----
        PanelKind::Spectrum => Ok(fetch_spectrum(tb, &target.node_id)),
        PanelKind::Can => Ok(tools::get_can_frames(
            tb,
            params.count.unwrap_or(DEFAULT_CAN_FRAMES),
            params.bitrate,
        )),
        PanelKind::Logic => Ok(tools::get_logic_samples(
            tb,
            params.count.unwrap_or(DEFAULT_LOGIC_ITEMS),
        )),
        PanelKind::FrameDecoder => Ok(tools::get_decoded_events(
            tb,
            params.count.unwrap_or(DEFAULT_LOGIC_ITEMS),
        )),

        // ---- 数值平面: 按节点 (再按端口) 收窄输出快照 ----
        PanelKind::Pie
        | PanelKind::Model3d
        | PanelKind::TableView
        | PanelKind::Command
        | PanelKind::Trigger => Ok(fetch_graph_outputs(tb, target)),

        // ---- 数据面尚未实现 (目录声明 `PanelDelivery::Unavailable`) ----
        // 显式失败而不是伪造空载荷: 调用方据此得知「不是没数据, 是这条路还没通」。
        PanelKind::Image => Err(unresolved(panel_kind, PanelResolveReason::Unavailable)),
    }
}

/// 面板的数据源键 — `params.source` 显式覆盖, 缺省取寻址给出的节点 id。
///
/// 两者都为空时定位不到任何缓冲, 属调用方契约错误 (面板按节点寻址)。空白串按
/// 空处理, 与 [`NodePortTarget::is_node_level`] 的判定口径一致。
fn resolve_source<'a>(
    panel: PanelKind,
    target: &'a NodePortTarget,
    params: &'a PanelFetchParams,
) -> Result<&'a str, String> {
    let override_key = params.source.as_deref().map(str::trim).unwrap_or_default();
    if !override_key.is_empty() {
        return Ok(override_key);
    }
    let node = target.node_id.trim();
    if node.is_empty() {
        return Err(unresolved(panel, PanelResolveReason::MissingNode));
    }
    Ok(node)
}

/// 数值平面输出快照 — 形状与全量读取 (`tools::get_graph_outputs`) 完全一致,
/// 只有广度不同, 调用方无需按寻址粒度分支解析:
///
/// - 空节点 = 全部 widget;
/// - 空端口 = 该 widget 的全部端口;
/// - 节点不存在 (或端口未产出) = 该条为空对象, 不是错误。
///
/// 与 `GraphOutputSnapshot` 的序列化结果同形 (`graphs_version` 不下发)。
fn fetch_graph_outputs(tb: &Toolbox, target: &NodePortTarget) -> Value {
    let node = target.node_id.trim();
    let port = target.port.trim();
    let snapshot = tb.data_plane.eval.output_snapshot.lock();

    let mut outputs = Map::new();
    for (widget, ports) in &snapshot.values {
        if !node.is_empty() && widget.as_str() != node {
            continue;
        }
        let mut entry = Map::new();
        for (handle, value) in ports {
            if !port.is_empty() && handle.as_str() != port {
                continue;
            }
            entry.insert(handle.clone(), Value::from(*value));
        }
        outputs.insert(widget.clone(), Value::Object(entry));
    }

    json!({ "tick": snapshot.tick, "outputs": Value::Object(outputs) })
}

/// 频谱快照 — 按 sink 节点 (FFT 节点 id) 收窄, 空节点返回全部 sink。
///
/// 与推送侧 `DisplayRequest::Spectrum` 读的是同一个
/// `eval.spectrum_snapshot`, 因此结果一致。
fn fetch_spectrum(tb: &Toolbox, node_id: &str) -> Value {
    let node = node_id.trim();
    let snapshot = tb.data_plane.eval.spectrum_snapshot.lock();

    let mut results = Map::new();
    for (sink, result) in snapshot.iter() {
        if !node.is_empty() && sink.as_str() != node {
            continue;
        }
        results.insert(sink.clone(), json!(result));
    }

    json!({ "results": Value::Object(results) })
}

/// 统一构造面板拉取失败文案。
///
/// 本 crate 的能力函数按约定返回 `String` 错误 (出口层各按自己的形状映射), 因此
/// 这里复用推送侧同一条 `ConfigError` 的 `Display`, 而不是再写一份措辞 — 面板拼写
/// 与原因描述在推送 / 拉取两面永远一致。
fn unresolved(panel: PanelKind, reason: PanelResolveReason) -> String {
    ConfigError::PanelRequestUnresolved {
        panel: panel.as_str().to_owned(),
        reason,
    }
    .to_string()
}

#[cfg(test)]
mod tests {
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
            tb.data_plane.raw_collector_for("dev").lock().push_chunk(
                1,
                RawDataDirection::Rx,
                &[byte],
            );
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
}
