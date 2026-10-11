use super::can_bitrate_choice;

#[test]
fn override_bitrate_wins_over_transport() {
    assert_eq!(
        can_bitrate_choice(Some(1_000_000), Some(500_000)),
        1_000_000
    );
}

#[test]
fn zero_override_falls_through_to_transport() {
    assert_eq!(can_bitrate_choice(Some(0), Some(250_000)), 250_000);
}

#[test]
fn transport_config_used_when_no_override() {
    assert_eq!(can_bitrate_choice(None, Some(250_000)), 250_000);
}

#[test]
fn default_500k_prevents_division_by_zero() {
    assert_eq!(can_bitrate_choice(None, None), 500_000);
    assert_eq!(can_bitrate_choice(Some(0), None), 500_000);
}
