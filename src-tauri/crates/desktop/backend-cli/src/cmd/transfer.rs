//! 传输与命令帧 — devices / ports / send / inject / input / frame。

use control_api::Toolbox;
use control_api::tools;
use schema::command_frame::ComputedFrameDto;
use serde_json::Value;

use super::ok;
use crate::{Host, parse_hex, parse_inputs, read_json_file};

/// 列出已打开设备会话。
pub async fn devices(tb: &Toolbox) -> Value {
    tools::list_devices(tb).await
}

/// 列出系统可用串口。
pub fn ports(tb: &Toolbox) -> Result<Value, String> {
    tools::list_serial_ports(tb)
}

/// 发送字节 / 文本 / CAN 帧。
pub async fn send(tb: &Toolbox, action: &super::SendAction) -> Result<Value, String> {
    match action {
        super::SendAction::Bytes { node_id, data } => {
            let bytes = parse_hex(data)?;
            tools::send_bytes(tb, node_id, &bytes).await
        }
        super::SendAction::Text { node_id, text } => tools::send_string(tb, node_id, text).await,
        super::SendAction::Can {
            node_id,
            id,
            data,
            extended,
            protocol_node,
        } => {
            let bytes = parse_hex(data)?;
            let frame = tools::build_can_frame(*id, bytes, *extended);
            tools::send_can_frame(tb, node_id, protocol_node.clone(), frame).await
        }
    }
}

/// 字节注入 — 需要事件端口 (派生事件推给 stderr)。
pub async fn inject(host: &Host, source_node_id: &str, data: &str) -> Result<Value, String> {
    let bytes = parse_hex(data)?;
    tools::inject_bytes(&host.state, host.sink.as_ref(), source_node_id, &bytes).await
}

/// 设置控件输入值。
pub fn input(tb: &Toolbox, widget_id: &str, value: f32) -> Value {
    tools::set_input_value(tb, widget_id, value);
    ok()
}

/// 命令帧编码与发送。
pub async fn frame(tb: &Toolbox, action: &super::FrameAction) -> Result<Value, String> {
    match action {
        super::FrameAction::Compute { frame_file, input } => {
            let (frame, inputs) = load_frame(frame_file, input)?;
            let computed: ComputedFrameDto =
                control_api::data::compute_command_frame_bytes(&frame, &inputs);
            serde_json::to_value(computed).map_err(|e| e.to_string())
        }
        super::FrameAction::Send {
            widget_id,
            frame_file,
            input,
        } => {
            let (frame, inputs) = load_frame(frame_file, input)?;
            control_api::data::send_command_frame(tb, widget_id, &frame, &inputs)
                .await
                .and_then(|outcome| serde_json::to_value(outcome).map_err(|e| e.to_string()))
        }
    }
}

/// 读取并反序列化命令帧定义与输入。
fn load_frame(
    frame_file: &str,
    input: &[String],
) -> Result<
    (
        schema::command_frame::CommandFrameDto,
        std::collections::HashMap<String, f64>,
    ),
    String,
> {
    let value = read_json_file(frame_file)?;
    let frame: schema::command_frame::CommandFrameDto = serde_json::from_value(value)
        .map_err(|error| format!("命令帧定义与 CommandFrameDto 不符: {error}"))?;
    let inputs = parse_inputs(input)?;
    Ok((frame, inputs))
}
