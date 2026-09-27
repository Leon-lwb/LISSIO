use super::*;
use serde_json::json;

#[test]
fn registry_is_complete_and_unique() {
    ensure_valid().expect("registry must be valid");
    // 29 类控件全部注册
    assert_eq!(
        definitions().count(),
        29,
        "29 widget kinds must be registered"
    );
    for expected in [
        "Knob",
        "Slider",
        "Button",
        "Radio",
        "Checkbox",
        "Label",
        "TextInput",
        "Gauge",
        "Progress",
        "LED",
        "NumberDisplay",
        "PieChart",
        "Image",
        "Waveform",
        "Spectrum",
        "Model3D",
        "Custom",
        "Math",
        "Filter",
        "FFT",
        "IFFT",
        "Command",
        "FrameDecoder",
        "RawData",
        "Trigger",
        "TableView",
        "TextDisplay",
        "Str",
        "TextOut",
    ] {
        assert!(definition(expected).is_some(), "missing widget: {expected}");
    }
    assert!(definition("Nope").is_none());
}

#[test]
fn defaults_are_deterministic_per_node_id() {
    for def in definitions() {
        let first = def.default_params("node-1");
        let second = def.default_params("node-1");
        assert_eq!(first, second, "{}: default must be deterministic", def.kind);
        assert_eq!(first["id"], "node-1", "{}: id is node id", def.kind);
        // 子 ID 由 node_id 派生 (options / frames / rules)
        let text = first.to_string();
        if def.kind == "Radio" || def.kind == "Checkbox" {
            assert!(
                text.contains("node-1-option-"),
                "{}: option ids derive",
                def.kind
            );
        }
        if def.kind == "Command" {
            assert!(
                text.contains("node-1-frame-1"),
                "{}: frame ids derive",
                def.kind
            );
        }
        if def.kind == "Trigger" {
            assert!(
                text.contains("node-1-rule-1"),
                "{}: rule ids derive",
                def.kind
            );
        }
    }
}

#[test]
fn defaults_survive_normalize_idempotently() {
    for def in definitions() {
        let mut once = def.default_params("n1");
        normalize_params(def.kind, &mut once).expect("defaults normalize");
        let mut twice = once.clone();
        normalize_params(def.kind, &mut twice).expect("normalize idempotent");
        assert_eq!(once, twice, "{}: normalize is idempotent", def.kind);
        assert_eq!(once["id"], "n1");
        assert!(!once["label"].as_str().expect("label").is_empty());
    }
}

#[test]
fn normalize_keeps_unknown_forward_compatible_fields() {
    // 未知字段 (更新版本后端写入) 必须保留, 不能静默丢弃
    let mut label = json!({"id": "l", "label": "L", "text": "hi", "futureField": {"a": 1}});
    normalize_params("Label", &mut label).unwrap();
    assert_eq!(label["futureField"]["a"], 1);

    let mut waveform = json!({"id": "w", "label": "W", "channels": 2, "max_points": 500,
        "visible_channels": [true, true], "futureFlag": true});
    normalize_params("Waveform", &mut waveform).unwrap();
    assert_eq!(waveform["futureFlag"], true);
    assert_eq!(waveform["channels"], 2);
}

#[test]
fn ports_match_historical_widget_ports() {
    let table = |kind: &str, params: Value| ports_for(kind, &params).expect("ports");
    let f32 = crate::ports::PortDomain::F32;
    let string = crate::ports::PortDomain::String;
    let bytes = crate::ports::PortDomain::Bytes;
    let spectrum = crate::ports::PortDomain::Spectrum;

    let knob = table("Knob", json!({}));
    assert!(knob.inputs.is_empty());
    assert_eq!(knob.outputs[0].handle, "value");

    let gauge = table("Gauge", json!({}));
    assert_eq!(gauge.inputs[0].handle, "value");
    assert!(gauge.outputs.is_empty());

    let math = table("Math", json!({ "op": "add", "inputCount": 3 }));
    assert_eq!(
        math.inputs
            .iter()
            .map(|p| p.handle.as_str())
            .collect::<Vec<_>>(),
        ["in0", "in1", "in2"]
    );
    assert_eq!(math.outputs[0].handle, "result");

    let math_unary = table("Math", json!({ "op": "sqrt", "inputCount": 4 }));
    assert_eq!(math_unary.inputs.len(), 1, "一元运算强制单输入");

    let fft = table("FFT", json!({}));
    assert_eq!(fft.outputs[0].handle, "spectrum");
    assert_eq!(fft.outputs[0].domain, spectrum);

    let ifft = table("IFFT", json!({}));
    assert_eq!(ifft.inputs[0].domain, spectrum);
    assert_eq!(ifft.outputs[0].handle, "out0");

    let text_in = table("TextInput", json!({}));
    assert_eq!(text_in.outputs[0], WidgetPort::new("str", string));

    let str_fmt = table("Str", json!({ "op": "format" }));
    assert!(str_fmt.inputs.iter().any(|p| p.handle == "fmt"));

    let trigger = table("Trigger", json!({}));
    assert_eq!(trigger.inputs[0].handle, "trigger");
    assert_eq!(trigger.outputs[2].domain, string);

    let pie = table("PieChart", json!({ "segments": ["A", "B", "C"] }));
    assert_eq!(
        pie.inputs
            .iter()
            .map(|p| p.handle.as_str())
            .collect::<Vec<_>>(),
        ["seg0", "seg1", "seg2"]
    );
    assert_eq!(pie.inputs[0].label, "A", "扇区名是 label");

    let waveform = table("Waveform", json!({ "channels": 2 }));
    assert_eq!(
        waveform
            .inputs
            .iter()
            .map(|p| p.handle.as_str())
            .collect::<Vec<_>>(),
        ["CH0", "CH1"]
    );

    let frame_decoder = table(
        "FrameDecoder",
        json!({
            "blocks": [
                { "id": "f", "type": "field", "fieldType": "uint8", "portName": "temp" },
            ],
            "enableValid": true,
        }),
    );
    assert_eq!(frame_decoder.inputs[0], WidgetPort::new("in", bytes));
    assert_eq!(frame_decoder.outputs[0].handle, "temp");
    assert!(frame_decoder.outputs.iter().any(|p| p.handle == "valid"));
    assert!(frame_decoder.outputs.iter().any(|p| p.handle == "raw"));

    let command = table(
        "Command",
        json!({
            "frames": [{ "blocks": [
                { "id": "a", "type": "var_ref", "portName": "speed" },
                { "id": "b", "type": "var_ref", "portName": "speed" },
                { "id": "c", "type": "var_ref", "portName": "rpm" },
            ]}],
        }),
    );
    assert_eq!(
        command
            .inputs
            .iter()
            .map(|p| p.handle.as_str())
            .collect::<Vec<_>>(),
        ["speed", "rpm"],
        "去重保序"
    );
    assert_eq!(command.outputs[0].handle, "loopbackOut");
    assert_eq!(command.outputs[0].domain, bytes);

    let raw = table("RawData", json!({}));
    assert_eq!(raw.inputs[0].handle, "data");

    let model3d = table("Model3D", json!({ "attitudeInputMode": "quaternion" }));
    assert_eq!(
        model3d
            .inputs
            .iter()
            .map(|p| p.handle.as_str())
            .collect::<Vec<_>>(),
        ["x", "y", "z", "q0", "q1", "q2", "q3"]
    );

    // 未知 kind 不是权威空表
    assert!(ports_for("Nope", &json!({})).is_none());
    let _ = f32;
}

#[test]
fn lowering_delegates_with_registry_semantics() {
    let math = lower("Math", &json!({ "op": "add", "inputCount": 3 }), None).unwrap();
    match math {
        crate::kind::NodeKind::Math { op, input_count } => {
            assert_eq!(op, crate::math_op::MathOp::Add);
            assert_eq!(input_count, 3);
        }
        other => panic!("unexpected: {other:?}"),
    }
    // Custom 必须带 customPorts 合同
    assert!(lower("Custom", &json!({ "code": "..." }), None).is_err());
    assert!(lower("Nope", &json!({}), None).is_err());
}

/// 面板契约的完整形状 — 只有数据驱动控件声明 `panel`, 且每条的
/// tab / i18n 键 / 数据面 / 绑定都必须精确匹配前端既有入口。
#[test]
fn data_panels_are_declared_on_exactly_ten_host_widgets() {
    use data_model::panel_descriptor::{PanelDelivery, PanelKind, panel_ops};

    /// 一行「宿主控件 → 面板契约」的期望值 (避免裸元组触发 type_complexity)。
    struct ExpectedPanel {
        host: &'static str,
        panel: PanelKind,
        tab_type: &'static str,
        label_key: &'static str,
        push: &'static str,
        fetch: Option<&'static str>,
    }

    let expected = [
        ExpectedPanel {
            host: "Waveform",
            panel: PanelKind::Waveform,
            tab_type: "waveform-extra",
            label_key: "dataTabWaveform",
            push: panel_ops::PUSH_WAVEFORM,
            fetch: Some(panel_ops::FETCH_WAVEFORM_WINDOW),
        },
        ExpectedPanel {
            host: "Spectrum",
            panel: PanelKind::Spectrum,
            tab_type: "spectrum",
            label_key: "dataTabSpectrum",
            push: panel_ops::PUSH_SPECTRUM,
            fetch: Some(panel_ops::FETCH_SPECTRUM),
        },
        ExpectedPanel {
            host: "RawData",
            panel: PanelKind::Raw,
            tab_type: "raw",
            label_key: "dataTabRawData",
            push: panel_ops::PUSH_RAW_DATA,
            fetch: Some(panel_ops::FETCH_RAW_DATA),
        },
        ExpectedPanel {
            host: "PieChart",
            panel: PanelKind::Pie,
            tab_type: "pie",
            label_key: "dataTabPie",
            push: panel_ops::PUSH_PORT_SAMPLES,
            fetch: Some(panel_ops::FETCH_GRAPH_OUTPUTS),
        },
        ExpectedPanel {
            host: "Model3D",
            panel: PanelKind::Model3d,
            tab_type: "model3d",
            label_key: "dataTabModel3d",
            push: panel_ops::PUSH_PORT_SAMPLES,
            fetch: Some(panel_ops::FETCH_GRAPH_OUTPUTS),
        },
        ExpectedPanel {
            host: "TableView",
            panel: PanelKind::TableView,
            tab_type: "table-view",
            label_key: "tableViewLabel",
            push: panel_ops::PUSH_PORT_SAMPLES,
            fetch: Some(panel_ops::FETCH_GRAPH_OUTPUTS),
        },
        ExpectedPanel {
            host: "Command",
            panel: PanelKind::Command,
            tab_type: "command",
            label_key: "dataTabCommand",
            push: panel_ops::PUSH_PORT_SAMPLES,
            fetch: Some(panel_ops::FETCH_GRAPH_OUTPUTS),
        },
        ExpectedPanel {
            host: "Trigger",
            panel: PanelKind::Trigger,
            tab_type: "trigger",
            label_key: "dataTabTrigger",
            push: panel_ops::PUSH_PORT_SAMPLES,
            fetch: Some(panel_ops::FETCH_GRAPH_OUTPUTS),
        },
    ];

    let mut hosts = definitions()
        .filter(|def| def.panel.is_some())
        .map(|def| def.kind)
        .collect::<Vec<_>>();

    // 10 个宿主: 上表 8 个 + 仅拉取的 Image + 事件平面的 FrameDecoder
    let mut expected_hosts = expected.iter().map(|row| row.host).collect::<Vec<_>>();
    expected_hosts.push("Image");
    expected_hosts.push("FrameDecoder");
    expected_hosts.sort_unstable();
    hosts.sort_unstable();
    assert_eq!(hosts, expected_hosts, "面板宿主集合必须精确");

    for row in &expected {
        let spec = definition(row.host)
            .unwrap_or_else(|| panic!("missing widget: {}", row.host))
            .panel
            .unwrap_or_else(|| panic!("{} must declare a panel", row.host));
        assert_eq!(spec.panel, row.panel, "{}: stable panel identity", row.host);
        assert_eq!(spec.tab_type, row.tab_type, "{}: tab type", row.host);
        assert_eq!(spec.label_key, row.label_key, "{}: i18n key", row.host);
        assert_eq!(
            spec.delivery,
            PanelDelivery::Both,
            "{}: 数值/事件平面面板支持订阅 + 拉取",
            row.host
        );
        assert_eq!(
            spec.push_request,
            Some(row.push),
            "{}: push request",
            row.host
        );
        assert_eq!(spec.fetch_op, row.fetch, "{}: fetch operation", row.host);
    }

    // Image 已声明面板 (有独立 tab) 但数据面尚未实现 — 不预支获取能力名
    let image = definition("Image")
        .expect("Image")
        .panel
        .expect("Image panel");
    assert_eq!(image.panel, PanelKind::Image);
    assert_eq!(image.tab_type, "image");
    assert_eq!(image.label_key, "dataTabImage");
    assert_eq!(image.delivery, PanelDelivery::Unavailable);
    assert!(!image.delivery.is_available());
    assert_eq!(image.push_request, None, "Image 无推送流");
    assert_eq!(image.fetch_op, None, "Image 无拉取面");

    // FrameDecoder 走解码事件平面 (与逻辑分析仪同一事件总线)
    let decoder = definition("FrameDecoder")
        .expect("FrameDecoder")
        .panel
        .expect("FrameDecoder panel");
    assert_eq!(decoder.panel, PanelKind::FrameDecoder);
    assert_eq!(decoder.tab_type, "frame-decoder");
    assert_eq!(decoder.label_key, "dataTabFrameDecoder");
    assert_eq!(decoder.push_request, Some(panel_ops::PUSH_DECODED_EVENTS));
    assert_eq!(decoder.fetch_op, Some(panel_ops::FETCH_DECODED_EVENTS));

    // 绑定: RawData 由参数持有端口引用, 其余宿主跟随画布边
    let raw = definition("RawData")
        .expect("RawData")
        .panel
        .expect("RawData panel");
    assert_eq!(
        raw.binding,
        PanelBindingSpec::ConfigBound {
            config_key: "selectedInput",
            port_template: "src:{source}:{handle}",
        }
    );
    for kind in [
        "Waveform",
        "Spectrum",
        "PieChart",
        "Model3D",
        "TableView",
        "Command",
        "Trigger",
    ] {
        let spec = definition(kind).expect("host").panel.expect("panel");
        assert_eq!(
            spec.binding,
            PanelBindingSpec::EdgeBound,
            "{kind}: 跟随画布边"
        );
    }

    // 非数据驱动控件不得声明面板
    for def in definitions() {
        if !hosts.contains(&def.kind) {
            assert!(
                def.panel.is_none(),
                "{} must not declare a data panel",
                def.kind
            );
        }
    }
}

/// tab 类型与 i18n 键一一对应, 且不得撞上纯应用外壳的 tab。
#[test]
fn panel_tab_types_and_labels_are_unique_and_not_shell_tabs() {
    let mut tabs = Vec::new();
    for def in definitions() {
        let Some(spec) = def.panel else { continue };
        assert!(
            !SHELL_TAB_TYPES.contains(&spec.tab_type),
            "{}: {} is an application shell tab, not a data panel",
            def.kind,
            spec.tab_type
        );
        tabs.push((spec.tab_type, spec.label_key, def.kind));
    }
    let mut sorted = tabs.clone();
    sorted.sort_unstable();
    sorted.dedup_by_key(|(tab, _, _)| *tab);
    assert_eq!(
        sorted.len(),
        tabs.len(),
        "panel tab types must be unique across hosts"
    );

    let mut labels = tabs.iter().map(|(_, label, _)| *label).collect::<Vec<_>>();
    let total = labels.len();
    labels.sort_unstable();
    labels.dedup();
    assert_eq!(labels.len(), total, "panel i18n keys must be unique");
}
