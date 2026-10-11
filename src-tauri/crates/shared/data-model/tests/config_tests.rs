//! `core::config` 集成测试
//!
//! 覆盖:
//! - `TransportConfig` tagged enum 7 变体 serde round-trip
//! - 7 种 backend 子 config 的 Default / 字段透传 / serde
//! - `WidgetBinding` 3 种绑定模式 serde round-trip
//! - `PipelineConfig` Default / `#[serde(default)]` 字段省略 / serde round-trip

use can::CanBitrate;
use data_model::config::{
    CandleConfig, PipelineConfig, SerialConfig, SlcanConfig, TcpClientConfig, TcpServerConfig,
    TestDataConfig, TestSignal, TransportConfig, UdpConfig, WidgetBinding,
};
use data_model::{FlowControl, Parity, StopBits};

// ============================================================
// TransportConfig enum + 7 个 backend 子 config
// ============================================================

/// 浮点断言统一入口 — 配置值均为 serde 往返的精确字面量, 单点放宽浮点严格相等
#[allow(clippy::float_cmp)]
fn assert_f32(actual: f32, expected: f32) {
    assert_eq!(actual, expected);
}

#[test]
fn transport_config_serial_default_roundtrip() {
    let cfg = TransportConfig::Serial(SerialConfig {
        port_name: "COM3".into(),
        baud_rate: 921_600,
        data_bits: 8,
        parity: Parity::Even,
        stop_bits: StopBits::Two,
        flow_control: FlowControl::Hardware,
    });
    let json = serde_json::to_string(&cfg).unwrap();
    assert!(json.contains("\"kind\":\"Serial\""));
    let restored: TransportConfig = serde_json::from_str(&json).unwrap();
    match &restored {
        TransportConfig::Serial(s) => {
            assert_eq!(s.port_name, "COM3");
            assert_eq!(s.baud_rate, 921_600);
            assert_eq!(s.parity, Parity::Even);
            assert_eq!(s.stop_bits, StopBits::Two);
            assert_eq!(s.flow_control, FlowControl::Hardware);
        }
        _ => panic!("expected Serial variant"),
    }
}

#[test]
fn serial_config_default_matches_documented_values() {
    let s = SerialConfig::default();
    assert_eq!(s.port_name, "");
    assert_eq!(s.baud_rate, 115_200);
    assert_eq!(s.data_bits, 8);
    assert_eq!(s.parity, Parity::None);
    assert_eq!(s.stop_bits, StopBits::One);
    assert_eq!(s.flow_control, FlowControl::None);
}

#[test]
fn udp_config_default_and_roundtrip() {
    let u = UdpConfig::default();
    assert_eq!(u.local_addr, "0.0.0.0");
    assert_eq!(u.remote_addr, "127.0.0.1");
    assert_eq!(u.local_port, 0);
    assert_eq!(u.remote_port, 8888);

    let modified = UdpConfig {
        local_addr: "192.168.1.10".into(),
        remote_addr: "192.168.1.20".into(),
        local_port: 7777,
        remote_port: 9000,
    };
    let cfg = TransportConfig::Udp(modified);
    let json = serde_json::to_string(&cfg).unwrap();
    assert!(json.contains("\"kind\":\"Udp\""));
    let restored: TransportConfig = serde_json::from_str(&json).unwrap();
    match restored {
        TransportConfig::Udp(u) => {
            assert_eq!(u.local_port, 7777);
            assert_eq!(u.remote_port, 9000);
        }
        _ => panic!("expected Udp variant"),
    }
}

#[test]
fn tcp_client_default_and_roundtrip() {
    let c = TcpClientConfig::default();
    assert_eq!(c.host, "127.0.0.1");
    assert_eq!(c.port, 8888);

    let cfg = TransportConfig::TcpClient(TcpClientConfig {
        host: "10.0.0.1".into(),
        port: 502,
    });
    let restored: TransportConfig =
        serde_json::from_str(&serde_json::to_string(&cfg).unwrap()).unwrap();
    match restored {
        TransportConfig::TcpClient(c) => {
            assert_eq!(c.host, "10.0.0.1");
            assert_eq!(c.port, 502);
        }
        _ => panic!("expected TcpClient variant"),
    }
}

#[test]
fn tcp_server_default_and_roundtrip() {
    let s = TcpServerConfig::default();
    assert_eq!(s.listen_addr, "0.0.0.0");
    assert_eq!(s.listen_port, 8888);

    let cfg = TransportConfig::TcpServer(TcpServerConfig {
        listen_addr: "::".into(),
        listen_port: 7777,
    });
    let restored: TransportConfig =
        serde_json::from_str(&serde_json::to_string(&cfg).unwrap()).unwrap();
    match restored {
        TransportConfig::TcpServer(s) => {
            assert_eq!(s.listen_addr, "::");
            assert_eq!(s.listen_port, 7777);
        }
        _ => panic!("expected TcpServer variant"),
    }
}

#[test]
fn test_data_config_default_and_signal_serde() {
    let td = TestDataConfig::default();
    assert_eq!(td.channels, 4);
    assert_f32(td.sample_rate, 1000.0);
    assert_eq!(td.signal, TestSignal::Sine);

    // 所有 10 个 TestSignal 变体 round-trip
    for sig in [
        TestSignal::Sine,
        TestSignal::Square,
        TestSignal::Triangle,
        TestSignal::Sawtooth,
        TestSignal::Random,
        TestSignal::Dc,
        TestSignal::Chirp,
        TestSignal::Steps,
        TestSignal::Noise,
        TestSignal::MultiTone,
    ] {
        let json = serde_json::to_string(&sig).unwrap();
        let restored: TestSignal = serde_json::from_str(&json).unwrap();
        assert_eq!(restored, sig);
    }
}

#[test]
fn slcan_config_default_and_roundtrip() {
    let s = SlcanConfig::default();
    assert_eq!(s.port_name, "");
    assert_eq!(s.baud_rate, 115_200);
    assert_eq!(s.can_bitrate, CanBitrate::Bps500k);

    let cfg = TransportConfig::Slcan(SlcanConfig {
        port_name: "/dev/cu.usbserial-1410".into(),
        baud_rate: 1_000_000,
        can_bitrate: CanBitrate::Bps1m,
    });
    let restored: TransportConfig =
        serde_json::from_str(&serde_json::to_string(&cfg).unwrap()).unwrap();
    match restored {
        TransportConfig::Slcan(s) => {
            assert_eq!(s.port_name, "/dev/cu.usbserial-1410");
            assert_eq!(s.baud_rate, 1_000_000);
            assert_eq!(s.can_bitrate, CanBitrate::Bps1m);
        }
        _ => panic!("expected Slcan variant"),
    }
}

#[test]
fn candle_config_default_and_roundtrip() {
    let c = CandleConfig::default();
    assert_eq!(c.bus, 0);
    assert_eq!(c.address, 0);
    assert_eq!(c.can_bitrate, CanBitrate::Bps500k);
    assert_eq!(c.channel, 0);

    #[allow(clippy::cast_possible_truncation)] // 测试只取地址低 8 位
    let cfg = TransportConfig::CandleLight(CandleConfig {
        bus: 1,
        address: 0xDEAD_BEEF_u32 as u8,
        can_bitrate: CanBitrate::Bps250k,
        channel: 1,
    });
    let restored: TransportConfig =
        serde_json::from_str(&serde_json::to_string(&cfg).unwrap()).unwrap();
    match restored {
        TransportConfig::CandleLight(c) => {
            assert_eq!(c.bus, 1);
            assert_eq!(c.can_bitrate, CanBitrate::Bps250k);
            assert_eq!(c.channel, 1);
        }
        _ => panic!("expected CandleLight variant"),
    }
}

/// 非 contract 拼写 (如 `Bps1M`) 反序列化失败 — 只接受精确契约名。
#[test]
fn slcan_config_rejects_mistyped_bitrate() {
    let restored: Result<TransportConfig, _> = serde_json::from_str(
        r#"{"kind":"Slcan","params":{"port_name":"COM3","baud_rate":115200,"can_bitrate":"Bps1M"}}"#,
    );
    assert!(restored.is_err(), "mistyped bitrate must be rejected");
}

/// Slcan/CandleLight payload 缺可选字段时按 Default 补齐。
#[test]
fn slcan_and_candle_configs_fill_missing_fields() {
    let slcan: TransportConfig = serde_json::from_str(r#"{"kind":"Slcan","params":{}}"#)
        .expect("Slcan payload fills defaults per-field");
    match slcan {
        TransportConfig::Slcan(s) => {
            let d = SlcanConfig::default();
            assert_eq!(s.port_name, d.port_name);
            assert_eq!(s.baud_rate, d.baud_rate);
            assert_eq!(s.can_bitrate, d.can_bitrate);
        }
        _ => panic!("expected Slcan variant"),
    }

    let candle: TransportConfig =
        serde_json::from_str(r#"{"kind":"CandleLight","params":{"channel":1}}"#).unwrap();
    match candle {
        TransportConfig::CandleLight(c) => {
            let d = CandleConfig::default();
            assert_eq!(c.bus, d.bus);
            assert_eq!(c.address, d.address);
            assert_eq!(c.can_bitrate, d.can_bitrate);
            assert_eq!(c.channel, 1);
        }
        _ => panic!("expected CandleLight variant"),
    }
}

// ============================================================
// WidgetBinding — 3 种绑定模式
// ============================================================

#[test]
fn widget_binding_roundtrip_covers_all_modes() {
    let cases = [
        WidgetBinding::None,
        WidgetBinding::Auto {
            transport_id: "transport-1".into(),
            protocol_id: "protocol-1".into(),
            channel: 3,
        },
        WidgetBinding::Manual {
            transport_id: "transport-1".into(),
            template: "SET {value}".into(),
        },
    ];
    for case in cases {
        let json = serde_json::to_string(&case).unwrap();
        let restored: WidgetBinding = serde_json::from_str(&json).unwrap();
        assert_eq!(serde_json::to_string(&restored).unwrap(), json);
    }
}

// ============================================================
// PipelineConfig — #[serde(default)] + round-trip
// ============================================================

#[test]
fn pipeline_config_default_matches_documented_values() {
    let p = PipelineConfig::default();
    assert_eq!(p.max_workers, 8);
    assert_eq!(p.memory_budget_mb, 256);
    assert_eq!(p.preview_fps_limit, 60);
    assert_eq!(p.preview_bandwidth_mb_per_sec, 8);
}

#[test]
fn pipeline_config_partial_json_fills_missing_with_defaults() {
    // 只给 max_workers,其他字段应回退到默认值
    let json = r#"{"max_workers":12}"#;
    let p: PipelineConfig = serde_json::from_str(json).unwrap();
    assert_eq!(p.max_workers, 12);
    assert_eq!(p.memory_budget_mb, 256);
    assert_eq!(p.preview_fps_limit, 60);
}

#[test]
fn pipeline_config_empty_object_uses_full_default() {
    let p: PipelineConfig = serde_json::from_str("{}").unwrap();
    assert_eq!(p, PipelineConfig::default());
}

#[test]
fn pipeline_config_full_roundtrip() {
    let p = PipelineConfig {
        max_workers: 16,
        memory_budget_mb: 512,
        preview_fps_limit: 30,
        preview_bandwidth_mb_per_sec: 16,
        ..PipelineConfig::default()
    };
    let json = serde_json::to_string(&p).unwrap();
    let restored: PipelineConfig = serde_json::from_str(&json).unwrap();
    assert_eq!(restored, p);
}
