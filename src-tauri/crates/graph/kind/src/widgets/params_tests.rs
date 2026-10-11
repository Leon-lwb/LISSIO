use super::*;

#[test]
fn snap_matches_frontend_semantics() {
    assert!((snap_control_value(50.0, 0.0, 100.0, 1.0) - 50.0).abs() < f64::EPSILON);
    assert!((snap_control_value(50.4, 0.0, 100.0, 1.0) - 50.0).abs() < f64::EPSILON);
    assert!((snap_control_value(150.0, 0.0, 100.0, 1.0) - 100.0).abs() < f64::EPSILON);
    // Invalid ranges return the original value.
    assert!((snap_control_value(50.0, 100.0, 0.0, 1.0) - 50.0).abs() < f64::EPSILON);
    // Negative zero must normalize to positive zero.
    assert_eq!(
        snap_control_value(-0.0, 0.0, 100.0, 1.0).to_bits(),
        0.0_f64.to_bits()
    );
}

#[test]
fn binding_normalization_never_keeps_ambiguous_targets() {
    let auto = serde_json::json!({"mode": "Auto", "params": {"transportId": "t", "protocolId": "p", "channel": 2.7}});
    assert_eq!(normalize_binding(&auto).mode, BindingMode::Auto);
    let broken = serde_json::json!({"mode": "Auto", "params": {"transportId": "t"}});
    assert_eq!(normalize_binding(&broken).mode, BindingMode::None);
    let manual = serde_json::json!({"mode": "Manual", "params": {"transportId": "t"}});
    let binding = normalize_binding(&manual);
    assert_eq!(binding.params.unwrap().template, "{value}");
    let unknown = serde_json::json!({"mode": "Unknown"});
    assert_eq!(normalize_binding(&unknown).mode, BindingMode::None);
}
