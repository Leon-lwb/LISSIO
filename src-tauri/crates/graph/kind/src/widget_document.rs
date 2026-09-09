//! Widget business configuration → graph semantics. UI-only properties do not enter the graph.
use crate::{document::CustomPorts, NodeKind};
use serde_json::{json, Value};

pub fn lower(kind: &str, p: &Value, ports: Option<&CustomPorts>) -> Result<NodeKind, String> {
    let (kind, params) = match kind {
        "Knob" | "Slider" | "Button" | "Radio" | "Checkbox" => ("Input", Value::Null),
        "TextInput" => ("TextInput", json!({ "text": p["text"] })),
        "TextDisplay" => ("TextDisplay", Value::Null),
        "Math" => {
            let unary = matches!(
                p["op"].as_str(),
                Some("abs" | "neg" | "square" | "sqrt" | "sin" | "cos" | "tan" | "log")
            );
            (
                "Math",
                json!({ "op": p["op"], "input_count": if unary { json!(1) } else { p["inputCount"].clone() } }),
            )
        }
        "Str" => (
            "Str",
            json!({ "op": p["op"], "num": {"pos": p["pos"], "len": p["len"], "size": p["size"]}, "tmpl": p["tmpl"] }),
        ),
        "TextOut" => (
            "TextOut",
            json!({ "target_transport": p["targetTransport"], "newline": p["newline"], "min_interval_ms": p["minIntervalMs"] }),
        ),
        "Filter" => {
            let preset = p["preset"]
                .as_str()
                .ok_or("filter preset required")?
                .to_lowercase();
            (
                "Filter",
                json!({ "config": { "preset": preset, "sample_rate": p["sampleRate"], "cutoff": p["cutoff"], "low": p["low"], "high": p["high"] } }),
            )
        }
        "FFT" => (
            "Fft",
            json!({ "window_size": p["windowSize"], "hop_size": p["hopSize"], "window_type": p["windowType"], "output": p["output"], "sample_rate": p["sampleRate"] }),
        ),
        "IFFT" => ("Ifft", Value::Null),
        "FrameDecoder" => (
            "FrameDecoder",
            json!({ "blocks": p["blocks"], "enable_valid": p["enableValid"], "enable_frame_count": p["enableFrameCount"], "enable_last_timestamp": p["enableLastTimestamp"], "enable_fps": p["enableFps"] }),
        ),
        "Trigger" => {
            let rules = p["rules"].as_array().ok_or("trigger rules required")?.iter().map(|r| json!({
                "id": r["id"], "pattern": r["pattern"], "match_type": r["matchType"], "flags": r["flags"],
                "output_type": r["outputType"], "output_value": r["outputValue"], "output_text": r["outputText"], "enabled": r["enabled"],
            })).collect::<Vec<_>>();
            (
                "Trigger",
                json!({ "mode": p["mode"], "edge": p["edge"], "default_miss": p["defaultMiss"], "default_miss_text": p["defaultMissText"], "command": p["command"], "rules": rules }),
            )
        }
        "Custom" => {
            let ports = ports.ok_or("custom widget port contract required")?;
            (
                "Custom",
                json!({ "inputs": ports.inputs, "outputs": ports.outputs }),
            )
        }
        "Waveform" | "Spectrum" | "PieChart" | "Image" | "Gauge" | "Progress" | "LED"
        | "NumberDisplay" | "Label" | "Model3D" | "Command" | "TableView" | "RawData" => {
            ("Sink", Value::Null)
        }
        _ => return Err(format!("unknown widget kind: {kind}")),
    };
    let value = if params.is_null() {
        json!({ "kind": kind })
    } else {
        json!({ "kind": kind, "params": params })
    };
    serde_json::from_value(value).map_err(|e| e.to_string())
}
