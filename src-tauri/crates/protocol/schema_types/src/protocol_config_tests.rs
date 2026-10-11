use super::*;

#[test]
fn manual_channels_only_for_float_protocols() {
    assert_eq!(
        ProtocolConfig::JustFloat { channels: Some(2) }.manual_channels(),
        Some(2)
    );
    assert_eq!(
        ProtocolConfig::FireWater { channels: Some(5) }.manual_channels(),
        Some(5)
    );
    assert_eq!(
        ProtocolConfig::JustFloat { channels: None }.manual_channels(),
        None
    );
    assert_eq!(ProtocolConfig::RawData.manual_channels(), None);
    assert_eq!(ProtocolConfig::Slcan.manual_channels(), None);
}

/// 全部协议变体 — 数量断言使「新增变体时忘记在此登记」暴露为测试失败。
fn all_variants() -> Vec<ProtocolConfig> {
    vec![
        ProtocolConfig::JustFloat { channels: None },
        ProtocolConfig::FireWater { channels: None },
        ProtocolConfig::RawData,
        ProtocolConfig::Slcan,
        ProtocolConfig::CandleLight,
        ProtocolConfig::LogicDecode {
            decoder: LogicDecoderConfig::Uart {
                baud_rate: 115_200,
                data_bits: 8,
                parity: data_model::Parity::None,
                stop_bits: data_model::StopBits::One,
                channel: 0,
            },
        },
        ProtocolConfig::Diagnostic {
            config: DiagnosticConfig::default(),
        },
    ]
}

#[test]
fn frame_oriented_classification_covers_every_variant() {
    let variants = all_variants();
    assert_eq!(
        variants.len(),
        7,
        "新增协议变体后必须在本测试登记其速率量纲"
    );
    let frame_oriented: Vec<&ProtocolConfig> = variants
        .iter()
        .filter(|protocol| protocol.is_frame_oriented())
        .collect();
    assert_eq!(
        frame_oriented,
        vec![&ProtocolConfig::Slcan, &ProtocolConfig::CandleLight],
        "只有「每采样点产出一帧 CAN 报文」的协议才是帧定界"
    );
}

#[test]
fn logic_decode_uses_the_sample_cap_despite_producing_one_byte_per_sample() {
    let logic_decode = ProtocolConfig::LogicDecode {
        decoder: LogicDecoderConfig::Uart {
            baud_rate: 115_200,
            data_bits: 8,
            parity: data_model::Parity::None,
            stop_bits: data_model::StopBits::One,
            channel: 0,
        },
    };
    // 每采样点 1 字节 ≠ 每采样点 1 报文: 字节流速率与采样率同阶, 不受帧率上限约束
    assert!(!logic_decode.is_frame_oriented());
    assert_eq!(
        logic_decode.max_simulation_rate(),
        data_model::simulation::MAX_SAMPLE_RATE
    );
}

#[test]
fn max_simulation_rate_separates_frame_from_sample_dimension() {
    assert_eq!(
        ProtocolConfig::Slcan.max_simulation_rate(),
        data_model::simulation::MAX_FRAME_RATE
    );
    assert_eq!(
        ProtocolConfig::CandleLight.max_simulation_rate(),
        data_model::simulation::MAX_FRAME_RATE
    );
    for protocol in [
        ProtocolConfig::JustFloat { channels: Some(4) },
        ProtocolConfig::FireWater { channels: None },
        ProtocolConfig::RawData,
    ] {
        assert_eq!(
            protocol.max_simulation_rate(),
            data_model::simulation::MAX_SAMPLE_RATE,
            "{protocol:?}"
        );
    }
}
