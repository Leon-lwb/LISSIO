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
fn legacy_shapes_migrate_to_current_model() {
    // Button: snake_case 旧字段
    let mut button = json!({"id": "b", "label": "B", "press_value": 2, "release_value": 5});
    normalize_params("Button", &mut button).unwrap();
    assert_eq!(button["pressValue"], 2.0);
    assert_eq!(button["releaseValue"], 5.0);
    assert!(button.get("press_value").is_none(), "legacy key removed");

    // Radio: 旧 default 索引 → selectedId
    let mut radio = json!({
        "id": "r", "label": "R",
        "options": [["A", 0], ["B", 1]],
        "default": 1,
    });
    normalize_params("Radio", &mut radio).unwrap();
    assert_eq!(radio["options"][1]["id"], "r-option-2");
    assert_eq!(radio["selectedId"], "r-option-2");

    // Checkbox: 旧 checked_value/default
    let mut checkbox = json!({
        "id": "c", "label": "C",
        "checked_value": 3, "unchecked_value": 7, "default": true,
    });
    normalize_params("Checkbox", &mut checkbox).unwrap();
    assert_eq!(checkbox["options"][0]["value"], 3.0);
    assert_eq!(checkbox["selectedIds"][0], "c-option-1");
    assert_eq!(checkbox["emptyValue"], 7.0);

    // Gauge: 顶层 min/max → range
    let mut gauge = json!({"id": "g", "label": "G", "min": 10, "max": 5, "unit": "V"});
    normalize_params("Gauge", &mut gauge).unwrap();
    assert_eq!(gauge["range"]["min"], 10.0);
    assert_eq!(gauge["range"]["max"], 110.0, "max <= min 时迁移为 min+100");
    assert!(gauge.get("min").is_none());

    // Command: 旧单帧 (顶层 blocks) → frames[0]
    let mut command = json!({
        "id": "cmd", "label": "C",
        "blocks": [{ "id": "x", "type": "const_hex", "hex": "AA" }],
        "appendNewline": true, "sendMode": "manual", "timerMs": 100,
        "loopbackEnabled": false, "loopbackHistory": [],
    });
    normalize_params("Command", &mut command).unwrap();
    assert_eq!(command["frames"][0]["id"], "cmd-frame-1");
    assert_eq!(command["frames"][0]["blocks"][0]["hex"], "AA");
    assert_eq!(command["frames"][0]["appendNewline"], true);
    assert!(
        command.get("blocks").is_none(),
        "legacy top-level blocks removed"
    );
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
