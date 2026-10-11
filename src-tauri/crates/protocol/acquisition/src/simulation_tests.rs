use super::*;
#[test]
fn deterministic_random_and_wave_parameters() {
    let signal = SignalParameters {
        waveform: TestWaveform::Random,
        amplitude: 2.0,
        offset: 4.0,
        ..Default::default()
    };
    let a: Vec<_> = (0..100)
        .map(|i| sample(&signal, 42, i, 100, "pressure"))
        .collect();
    let b: Vec<_> = (0..100)
        .map(|i| sample(&signal, 42, i, 100, "pressure"))
        .collect();
    assert_eq!(a, b);
    assert!(a.iter().all(|x| (2.0..=6.0).contains(x)));
    assert!(
        (sample(&signal, 42, 1, 100, "pressure") - sample(&signal, 43, 1, 100, "pressure")).abs()
            > f64::EPSILON
    );
}

fn config_with_rate(sample_rate: u32) -> SimulationConfig {
    SimulationConfig {
        sample_rate,
        ..SimulationConfig::default()
    }
}

#[test]
fn default_rate_is_valid_for_every_protocol_dimension() {
    let config = SimulationConfig::default();
    for protocol in [
        ProtocolConfig::JustFloat { channels: Some(4) },
        ProtocolConfig::FireWater { channels: None },
        ProtocolConfig::RawData,
        ProtocolConfig::Slcan,
        ProtocolConfig::CandleLight,
    ] {
        assert!(
            validate_for_protocol(&config, &protocol).is_ok(),
            "默认速率必须对所有协议合法: {protocol:?}"
        );
    }
}

#[test]
fn frame_protocol_rejects_a_rate_derived_from_the_bus_bitrate() {
    // 量级契约的核心回归: 「按 500k 波特率对齐」填进来的 500 000 在 SLCAN 下
    // 是 50 万帧/s, 必须被拒绝而不是静默放大。
    let config = config_with_rate(500_000);
    let error = validate_for_protocol(&config, &ProtocolConfig::Slcan)
        .expect_err("帧定界协议必须拒绝按波特率折算的高速率");
    let message = error.to_string();
    assert!(
        message.contains("500000"),
        "错误消息须含被拒速率: {message}"
    );
    assert!(
        message.contains("frame rate"),
        "错误消息须说明该量纲是帧率: {message}"
    );
    assert!(
        validate_for_protocol(&config, &ProtocolConfig::CandleLight).is_err(),
        "CandleLight 同为帧定界协议"
    );
}

#[test]
fn sample_protocol_accepts_the_same_rate_that_the_frame_protocol_rejects() {
    let config = config_with_rate(500_000);
    assert!(
        validate_for_protocol(&config, &ProtocolConfig::JustFloat { channels: Some(4) }).is_ok(),
        "流式协议的速率是采样率, 不受帧率上限约束"
    );
    assert!(
        validate_for_protocol(&config, &ProtocolConfig::RawData).is_ok(),
        "RawData 无逐采样帧, 不按帧率收窄"
    );
    // LogicDecode 同理 (每采样点只产出一个字节, 字节流速率与采样率同阶), 但它需要
    // `logic::LogicDecoderConfig` 才能构造, 而本 crate 不依赖 `logic` —— 量纲分类
    // 由 `schema_types` 的
    // `logic_decode_uses_the_sample_cap_despite_producing_one_byte_per_sample` 覆盖,
    // 本测试只负责「非帧定界协议不按帧率收窄」这一侧。
}

#[test]
fn frame_rate_cap_boundary_is_inclusive() {
    let at_cap = config_with_rate(data_model::simulation::MAX_FRAME_RATE);
    assert!(validate_for_protocol(&at_cap, &ProtocolConfig::Slcan).is_ok());
    let over_cap = config_with_rate(data_model::simulation::MAX_FRAME_RATE + 1);
    assert!(validate_for_protocol(&over_cap, &ProtocolConfig::Slcan).is_err());
}

#[test]
fn protocol_validation_does_not_skip_the_base_range_check() {
    assert!(
        validate_for_protocol(&config_with_rate(0), &ProtocolConfig::Slcan).is_err(),
        "零速率必须先被基础校验拦下"
    );
    assert!(
        validate_for_protocol(
            &config_with_rate(data_model::simulation::MAX_SAMPLE_RATE + 1),
            &ProtocolConfig::JustFloat { channels: None }
        )
        .is_err(),
        "超出采样率上限仍须被基础校验拦下"
    );
    let bad_channels = SimulationConfig {
        channels: 0,
        ..SimulationConfig::default()
    };
    assert!(validate_for_protocol(&bad_channels, &ProtocolConfig::Slcan).is_err());
}
