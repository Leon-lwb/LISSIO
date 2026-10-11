use super::*;
use data_model::{Parity, StopBits};
use logic::LogicDecoderConfig;

fn decoder_config() -> LogicDecoderConfig {
    LogicDecoderConfig::Uart {
        baud_rate: 115_200,
        data_bits: 8,
        parity: Parity::None,
        stop_bits: StopBits::One,
        channel: 0,
    }
}

/// 7 种 ProtocolConfig 都能产出引擎, 且名字可辨识
#[test]
fn create_engine_covers_all_protocol_kinds() {
    let cases: Vec<(ProtocolConfig, &str)> = vec![
        (ProtocolConfig::JustFloat { channels: None }, "JustFloat"),
        (ProtocolConfig::FireWater { channels: None }, "FireWater"),
        (ProtocolConfig::RawData, "RawData"),
        (ProtocolConfig::Slcan, "Slcan"),
        (ProtocolConfig::CandleLight, "CandleLight"),
        (
            ProtocolConfig::LogicDecode {
                decoder: decoder_config(),
            },
            "LogicDecoder",
        ),
    ];
    for (config, expected_name) in &cases {
        let engine = create_engine(config);
        assert_eq!(engine.name(), *expected_name, "config {config:?}");
    }
}

/// Diagnostic 配置映射到 RawData 引擎 (诊断帧按原文透传)
#[test]
fn diagnostic_config_maps_to_raw_data_engine() {
    // 不 import diagnostic crate — 依赖名会遮蔽 tauri::command 生成的
    // #[diagnostic::on_unimplemented] 内建命名空间导致编译失败;
    // 字段 Default 由变体类型推断 (clippy 显式路径建议在此不可用)
    #[allow(clippy::default_trait_access)]
    let diagnostic = ProtocolConfig::Diagnostic {
        config: Default::default(),
    };
    let engine = create_engine(&diagnostic);
    let raw = create_engine(&ProtocolConfig::RawData);
    assert_eq!(engine.name(), raw.name(), "Diagnostic 应回退 RawData 引擎");
}

/// 帧定界协议 (JustFloat) 支持并行切分; RawData 不产帧
#[test]
fn engine_capabilities_match_protocol_kind() {
    let mut justfloat = create_engine(&ProtocolConfig::JustFloat { channels: None });
    assert!(
        justfloat.split_aligned(&[], 2).is_some(),
        "JustFloat 应支持帧边界切分"
    );
    // encode_channels + feed 往返: 2 通道一帧
    let bytes = justfloat.encode_channels(&[1.0, 2.0]);
    let output = justfloat.feed(&bytes);
    assert_eq!(output.frames.len(), 1);
    assert_eq!(output.frames[0].channels, vec![1.0, 2.0]);

    let mut raw = create_engine(&ProtocolConfig::RawData);
    assert!(raw.feed(b"any bytes").frames.is_empty(), "RawData 不产帧");
}
