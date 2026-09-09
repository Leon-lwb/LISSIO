//! 端口 handle 常量 + 强类型端口表（`PortSpec`/`PortTable`）+ `port_domain` 查询.
//!
//! 端口命名与域分类是图编译期边分类（`graph::EdgeClass`）的依据。
//! 域知识以类型化端口表声明（每个 `NodeKind` 一份静态表，单一事实源），
//! `port_domain` 只是表查找 + 动态端口回落，不再按 handle 字面量逐个匹配。

use crate::kind::NodeKind;
use data_model::device::{DevicePortDirection, DevicePortDomain};

// ============ 端口 handle 命名约定 ============

/// 字节设备节点的输出口（RX 字节流出口）
pub const TRANSPORT_RX_HANDLE: &str = "rx";
/// 字节设备节点的输入口（TX 字节流入口）
pub const TRANSPORT_TX_HANDLE: &str = "tx";
/// Protocol 节点的字节输入口
pub const PROTOCOL_IN_HANDLE: &str = "in";
/// Protocol 节点的字节输出口（解析后帧字节 / 透传字节出口）
pub const PROTOCOL_OUT_HANDLE: &str = "out";
/// FrameDecoder 节点的字节输入口（新语义：字节来源完全由输入字节边决定）
pub const FRAME_DECODER_IN_HANDLE: &str = "in";
/// widget 节点（CommandSender 等）的命令字节出口
pub const LOOPBACK_OUT_HANDLE: &str = "loopbackOut";
/// RawData 控件动态输入端口 id 前缀（`src:<sourceId>:<sourceHandle>`）
///
/// 约定来源：前端 `rawDataPortId()`（`src/lib/utils/nodeDef.ts`）— RawData 每个已连接的
/// (source, sourceHandle) 组合派生一个通道端口；边只是用户意图标记，字节不流入 f32 图
pub const RAW_DATA_PORT_PREFIX: &str = "src:";

// ============ 端口域（PortDomain）============

/// 端口域 — 边两端端口域必须一致，否则编译报 DomainMismatch
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum PortDomain {
    Points,
    /// 数值平面（f32 槽位模型）
    F32,
    /// 字节平面（`Vec<u8>`，事件驱动）
    Bytes,
    /// 字符串平面（`String`，事件驱动；与 graphOutputs 平行存在）
    String,
    Spectrum,
}

// ============ 强类型端口表 ============

/// 端口描述 — handle 名 + 域（端口表的条目）
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct PortSpec {
    pub handle: &'static str,
    pub domain: PortDomain,
}

impl PortSpec {
    pub const fn new(handle: &'static str, domain: PortDomain) -> Self {
        Self { handle, domain }
    }
}

/// 节点固定端口表 — 输入/输出口的强类型声明（单一事实源）
///
/// 动态端口不入表，由 [`port_domain`] 统一回落 F32：
/// - Math "in0..N"（input_count）、ProtocolSource "ch0..N"（channels/port_names）
/// - Command var_ref、Custom 用户代码定义端口、FrameDecoder blocks 派生输出口
/// - RawData "src:…" 关联通道（编译期按 [`RAW_DATA_PORT_PREFIX`] 特判放行）
#[derive(Debug, Clone, Copy)]
pub struct PortTable {
    pub inputs: &'static [PortSpec],
    pub outputs: &'static [PortSpec],
}

const NO_PORTS: &[PortSpec] = &[];
const POINT_PORTS: &[PortSpec] = &[PortSpec::new("points", PortDomain::Points)];
const RESULT_F32: &[PortSpec] = &[PortSpec::new("result", PortDomain::F32)];
const RESULT_STRING: &[PortSpec] = &[PortSpec::new("result", PortDomain::String)];

const PROTOCOL_PORTS: PortTable = PortTable {
    inputs: &[PortSpec::new(PROTOCOL_IN_HANDLE, PortDomain::Bytes)],
    outputs: &[PortSpec::new(PROTOCOL_OUT_HANDLE, PortDomain::Bytes)],
};
/// ProtocolSource 数值帧口 "ch0..N" 动态派生不入表（回落 F32）；"str"（RawData
/// 原始字节 UTF-8 文本）属字符串平面
const PROTOCOL_SOURCE_PORTS: PortTable = PortTable {
    inputs: NO_PORTS,
    outputs: &[PortSpec::new("str", PortDomain::String)],
};
const INPUT_PORTS: PortTable = PortTable {
    inputs: NO_PORTS,
    outputs: &[PortSpec::new("value", PortDomain::F32)],
};
const MATH_PORTS: PortTable = PortTable {
    inputs: NO_PORTS, // "in0..N" 动态（input_count），回落 F32
    outputs: RESULT_F32,
};
const FILTER_PORTS: PortTable = PortTable {
    inputs: &[PortSpec::new("in0", PortDomain::F32)],
    outputs: RESULT_F32,
};
const FFT_PORTS: PortTable = PortTable {
    inputs: &[PortSpec::new("in0", PortDomain::F32)],
    outputs: &[PortSpec::new("spectrum", PortDomain::Spectrum)],
};
const IFFT_PORTS: PortTable = PortTable {
    inputs: &[PortSpec::new("spectrum", PortDomain::Spectrum)],
    outputs: &[PortSpec::new("out0", PortDomain::F32)],
};
/// FrameDecoder 输出口由 blocks 派生（回落 F32）；字节输入口固定
const FRAME_DECODER_PORTS: PortTable = PortTable {
    inputs: &[PortSpec::new(FRAME_DECODER_IN_HANDLE, PortDomain::Bytes)],
    outputs: NO_PORTS,
};
/// Sink 展示控件：Spectrum 控件经 "spectrum" 口消费频谱平面；Command 另有
/// "loopbackOut" 字节命令出口；其余数值口（value/CH0../seg0../var_ref）回落 F32
const SINK_PORTS: PortTable = PortTable {
    inputs: &[PortSpec::new("spectrum", PortDomain::Spectrum)],
    outputs: &[PortSpec::new(LOOPBACK_OUT_HANDLE, PortDomain::Bytes)],
};
/// Custom 用户代码端口不入表（回落 F32），仅 Command 语义的 loopbackOut 字节出口
const CUSTOM_PORTS: PortTable = PortTable {
    inputs: NO_PORTS,
    outputs: &[PortSpec::new(LOOPBACK_OUT_HANDLE, PortDomain::Bytes)],
};
const TRIGGER_PORTS: PortTable = PortTable {
    inputs: NO_PORTS, // "trigger" 输入口回落 F32
    outputs: &[
        PortSpec::new("value", PortDomain::F32),
        PortSpec::new("matched", PortDomain::F32),
        PortSpec::new("text", PortDomain::String),
    ],
};
const TEXT_INPUT_PORTS: PortTable = PortTable {
    inputs: NO_PORTS,
    outputs: &[PortSpec::new("str", PortDomain::String)],
};
/// TextOut 输入口（动态发送回传的字符串消费端）
const TEXT_OUT_PORTS: PortTable = PortTable {
    inputs: &[PortSpec::new("text", PortDomain::String)],
    outputs: NO_PORTS,
};
/// TextDisplay 输入口 — 字符串平面展示消费端（纯展示，无输出口）
const TEXT_DISPLAY_PORTS: PortTable = PortTable {
    inputs: &[PortSpec::new("text", PortDomain::String)],
    outputs: NO_PORTS,
};

/// 节点固定端口表 — 域分类与端口枚举（`graph_ops::derived`）共用本表
pub const fn port_table(kind: &NodeKind) -> PortTable {
    match kind {
        // Device ports are capability-derived and therefore never represented
        // by a static fallback table. `port_domain` handles them explicitly.
        NodeKind::Acquisition { .. } => PortTable {
            inputs: NO_PORTS,
            outputs: NO_PORTS,
        },
        NodeKind::PointSelector { .. } => PortTable {
            inputs: POINT_PORTS,
            outputs: NO_PORTS,
        },
        NodeKind::Protocol { .. } => PROTOCOL_PORTS,
        NodeKind::ProtocolSource { .. } => PROTOCOL_SOURCE_PORTS,
        NodeKind::Input => INPUT_PORTS,
        NodeKind::Math { .. } => MATH_PORTS,
        NodeKind::Str { op, .. } => PortTable {
            inputs: op.input_ports(),
            outputs: match op.output_domain() {
                PortDomain::F32 => RESULT_F32,
                PortDomain::String => RESULT_STRING,
                // StrOp 输出域仅 F32/String（见 output_domain_for）
                PortDomain::Bytes | PortDomain::Spectrum | PortDomain::Points => RESULT_F32,
            },
        },
        NodeKind::Custom { .. } => CUSTOM_PORTS,
        NodeKind::Filter { .. } => FILTER_PORTS,
        NodeKind::Fft { .. } => FFT_PORTS,
        NodeKind::Ifft => IFFT_PORTS,
        NodeKind::FrameDecoder { .. } => FRAME_DECODER_PORTS,
        NodeKind::Sink => SINK_PORTS,
        NodeKind::Trigger { .. } => TRIGGER_PORTS,
        NodeKind::TextInput { .. } => TEXT_INPUT_PORTS,
        NodeKind::TextOut { .. } => TEXT_OUT_PORTS,
        NodeKind::TextDisplay => TEXT_DISPLAY_PORTS,
    }
}

/// 查询节点某个端口的域 — 端口表查找；表外动态端口回落 F32
/// （方向仅用于区分输入/输出子表；动态端口清单见 [`PortTable`] 文档）
pub fn port_domain(kind: &NodeKind, handle: &str, is_output: bool) -> PortDomain {
    if let NodeKind::Acquisition { ports, .. } = kind {
        return ports
            .iter()
            .find(|port| {
                port.id == handle
                    && (port.direction == DevicePortDirection::Bidirectional
                        || port.direction
                            == if is_output {
                                DevicePortDirection::Output
                            } else {
                                DevicePortDirection::Input
                            })
            })
            .map_or(PortDomain::Points, |port| match port.domain {
                DevicePortDomain::Bytes => PortDomain::Bytes,
                DevicePortDomain::Points => PortDomain::Points,
                DevicePortDomain::Events | DevicePortDomain::Numeric => PortDomain::F32,
            });
    }
    let table = port_table(kind);
    let ports = if is_output {
        table.outputs
    } else {
        table.inputs
    };
    ports
        .iter()
        .find(|p| p.handle == handle)
        .map_or(PortDomain::F32, |p| p.domain)
}

#[cfg(test)]
mod tests {
    use super::*;
    use data_model::device::{
        DevicePort, DevicePortDirection, DevicePortDomain, DriverId, DriverPayload, EndpointId,
        EndpointSpec,
    };
    use serde_json::json;

    use crate::kind::NodeKind;
    use crate::math_op::MathOp;
    use crate::str_op::{StrNumParams, StrOp};

    fn device() -> NodeKind {
        NodeKind::Acquisition {
            spec: EndpointSpec {
                id: EndpointId("device".into()),
                label: "device".into(),
                enabled: true,
                capability_endpoint_id: None,
                driver: DriverPayload {
                    driver_id: DriverId("serial".into()),
                    schema_version: 1,
                    payload: json!({}),
                },
                simulation: None,
            },
            ports: vec![
                DevicePort {
                    id: "rx".into(),
                    direction: DevicePortDirection::Output,
                    domain: DevicePortDomain::Bytes,
                },
                DevicePort {
                    id: "tx".into(),
                    direction: DevicePortDirection::Input,
                    domain: DevicePortDomain::Bytes,
                },
            ],
        }
    }

    fn protocol_default() -> NodeKind {
        NodeKind::Protocol {
            config: schema_types::ProtocolConfig::default(),
            convert_to: None,
            schema: None,
        }
    }

    fn decoder() -> NodeKind {
        NodeKind::FrameDecoder {
            blocks: vec![],
            enable_valid: false,
            enable_frame_count: false,
            enable_last_timestamp: false,
            enable_fps: false,
        }
    }

    fn sink() -> NodeKind {
        NodeKind::Sink
    }

    fn source() -> NodeKind {
        NodeKind::ProtocolSource {
            node_id: "p1".into(),
            channels: 2,
            port_names: None,
        }
    }

    fn math() -> NodeKind {
        NodeKind::Math {
            op: MathOp::Add,
            input_count: 2,
        }
    }

    fn str_op(op: StrOp) -> NodeKind {
        NodeKind::Str {
            op,
            num: StrNumParams::default(),
            tmpl: String::new(),
        }
    }

    fn text_input() -> NodeKind {
        NodeKind::TextInput {
            text: "hello".to_string(),
        }
    }

    #[test]
    fn device_handles() {
        let k = device();
        assert_eq!(
            port_domain(&k, TRANSPORT_RX_HANDLE, true),
            PortDomain::Bytes
        );
        assert_eq!(
            port_domain(&k, TRANSPORT_TX_HANDLE, false),
            PortDomain::Bytes
        );
    }

    #[test]
    fn protocol_handles() {
        let k = protocol_default();
        assert_eq!(
            port_domain(&k, PROTOCOL_IN_HANDLE, false),
            PortDomain::Bytes
        );
        assert_eq!(
            port_domain(&k, PROTOCOL_OUT_HANDLE, true),
            PortDomain::Bytes
        );
    }

    #[test]
    fn decoder_handles() {
        let k = decoder();
        assert_eq!(
            port_domain(&k, FRAME_DECODER_IN_HANDLE, false),
            PortDomain::Bytes
        );
        assert_eq!(port_domain(&k, "value", true), PortDomain::F32);
    }

    #[test]
    fn sink_and_command_loopback_out() {
        let k = sink();
        assert_eq!(
            port_domain(&k, LOOPBACK_OUT_HANDLE, true),
            PortDomain::Bytes
        );
        assert_eq!(port_domain(&k, "value", false), PortDomain::F32);
    }

    #[test]
    fn sink_spectrum_input_is_spectrum_domain() {
        // Spectrum 控件 (编译为 Sink) 经 "spectrum" 口消费频谱平面
        let k = sink();
        assert_eq!(port_domain(&k, "spectrum", false), PortDomain::Spectrum);
        assert_eq!(port_domain(&k, "spectrum", true), PortDomain::F32);
    }

    #[test]
    fn protocol_source_str_handle_is_string_domain() {
        let k = source();
        assert_eq!(port_domain(&k, "ch0", true), PortDomain::F32);
        assert_eq!(port_domain(&k, "str", true), PortDomain::String);
        assert_eq!(port_domain(&k, "str", false), PortDomain::F32);
    }

    #[test]
    fn math_input_output_is_f32() {
        let k = math();
        assert_eq!(port_domain(&k, "in0", false), PortDomain::F32);
        assert_eq!(port_domain(&k, "result", true), PortDomain::F32);
    }

    #[test]
    fn str_op_port_table_is_source_of_truth() {
        let len = str_op(StrOp::Len);
        assert_eq!(port_domain(&len, "str", false), PortDomain::String);
        assert_eq!(port_domain(&len, "result", true), PortDomain::F32);

        let mid = str_op(StrOp::Mid);
        assert_eq!(port_domain(&mid, "str", false), PortDomain::String);
        assert_eq!(port_domain(&mid, "pos", false), PortDomain::F32);
        assert_eq!(port_domain(&mid, "len", false), PortDomain::F32);
        assert_eq!(port_domain(&mid, "result", true), PortDomain::String);

        let replace = str_op(StrOp::Replace);
        assert_eq!(port_domain(&replace, "str1", false), PortDomain::String);
        assert_eq!(port_domain(&replace, "str2", false), PortDomain::String);
        assert_eq!(port_domain(&replace, "pos", false), PortDomain::F32);
        assert_eq!(port_domain(&replace, "result", true), PortDomain::String);
    }

    #[test]
    fn text_input_str_handle_is_string_output_only() {
        let k = text_input();
        assert_eq!(port_domain(&k, "str", true), PortDomain::String);
        assert_eq!(port_domain(&k, "str", false), PortDomain::F32);
        assert_eq!(port_domain(&k, "value", true), PortDomain::F32);
    }

    #[test]
    fn text_display_text_input_is_string_domain() {
        // 回归: TextDisplay 的 "text" 输入口属字符串平面 —
        // TextInput.str / Trigger.text / ProtocolSource.str 可连
        let k = NodeKind::TextDisplay;
        assert_eq!(port_domain(&k, "text", false), PortDomain::String);
        assert_eq!(port_domain(&k, "text", true), PortDomain::F32);
        assert_eq!(port_domain(&k, "value", false), PortDomain::F32);
    }

    #[test]
    fn port_tables_expose_typed_specs() {
        // 端口表即单一事实源 — 抽查静态表形状与 port_domain 一致
        let trigger = NodeKind::Trigger {
            mode: "manual".into(),
            edge: "level".into(),
            default_miss: 0.0,
            default_miss_text: String::new(),
            command: String::new(),
            rules: vec![],
        };
        assert_eq!(
            port_table(&trigger).outputs,
            &[
                PortSpec::new("value", PortDomain::F32),
                PortSpec::new("matched", PortDomain::F32),
                PortSpec::new("text", PortDomain::String),
            ]
        );
        assert_eq!(
            port_table(&NodeKind::TextDisplay).inputs,
            &[PortSpec::new("text", PortDomain::String)]
        );
        assert_eq!(port_table(&NodeKind::TextDisplay).outputs, &[],);
        assert_eq!(
            port_table(&NodeKind::Str {
                op: StrOp::Mid,
                num: StrNumParams::default(),
                tmpl: String::new(),
            })
            .inputs,
            &[
                PortSpec::new("str", PortDomain::String),
                PortSpec::new("pos", PortDomain::F32),
                PortSpec::new("len", PortDomain::F32),
            ]
        );
    }
}
