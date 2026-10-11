use super::*;

#[test]
fn filter_config_lowpass_snake_case_round_trip() {
    // 前端 IPC 形态: { "preset": "lowpass", "cutoff": ..., "sample_rate": ... }
    let json = r#"{"preset":"lowpass","cutoff":100.0,"sample_rate":1000.0}"#;
    let cfg: FilterConfig = serde_json::from_str(json).expect("snake_case 应反序列化");
    match cfg {
        FilterConfig::Lowpass {
            cutoff,
            sample_rate,
        } => {
            assert!((cutoff - 100.0).abs() < 1e-6);
            assert!((sample_rate - 1000.0).abs() < 1e-6);
        }
        _ => panic!("期望 Lowpass 变体"),
    }
}

#[test]
fn filter_config_bandpass_all_fields_snake_case() {
    let json = r#"{"preset":"bandpass","low":50.0,"high":150.0,"sample_rate":1000.0}"#;
    let cfg: FilterConfig = serde_json::from_str(json).expect("带通 snake_case 应反序列化");
    assert!(matches!(cfg, FilterConfig::Bandpass { .. }));
}

#[test]
fn filter_config_camel_case_sample_rate_rejected() {
    // 关键防御: 前端若误用 camelCase (sampleRate) 必须直接报错,
    // 不能与 snake_case 字段名混淆 (rename_all 不影响字段名)
    let json_camel = r#"{"preset":"lowpass","cutoff":100.0,"sampleRate":1000.0}"#;
    let res: Result<FilterConfig, _> = serde_json::from_str(json_camel);
    assert!(
        res.is_err(),
        "camelCase 不应通过反序列化: 仍能误判为有效输入时即契约漂移"
    );
}

#[test]
fn filter_config_serializes_snake_case() {
    let cfg = FilterConfig::Highpass {
        cutoff: 200.0,
        sample_rate: 1000.0,
    };
    let j = serde_json::to_string(&cfg).unwrap();
    assert!(
        j.contains("\"sample_rate\""),
        "字段名应为 sample_rate, 实际: {j}"
    );
    assert!(j.contains("\"preset\":\"highpass\""), "variant 名应小写");
}

#[test]
fn filter_kind_from_config_matches_lowpass_biquad() {
    // IPC 派生产物与现有 lowpass_biquad 一致 (防回归)
    let cfg = FilterConfig::Lowpass {
        cutoff: 100.0,
        sample_rate: 1000.0,
    };
    let expected_kind = FilterKind::IIR {
        b: lowpass_biquad(100.0, 1000.0).0,
        a: lowpass_biquad(100.0, 1000.0).1,
    };
    assert_eq!(filter_kind_from_config(&cfg), expected_kind);
}
