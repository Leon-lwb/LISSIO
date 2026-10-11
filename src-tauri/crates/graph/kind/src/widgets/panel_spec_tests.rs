use super::*;

fn spec() -> PanelSpec {
    PanelSpec {
        panel: PanelKind::Waveform,
        tab_type: "waveform-extra",
        label_key: "dataTabWaveform",
        delivery: PanelDelivery::Both,
        push_request: Some(panel_ops::PUSH_WAVEFORM),
        fetch_op: Some(panel_ops::FETCH_WAVEFORM_WINDOW),
        binding: PanelBindingSpec::EdgeBound,
        default_interval_ms: Some(33),
        default_max_items: Some(1000),
    }
}

#[test]
fn valid_spec_passes() {
    assert_eq!(validate(&spec(), "Waveform"), Ok(()));
}

#[test]
fn shell_tab_type_is_rejected() {
    let mut spec = spec();
    spec.tab_type = "compile-errors";
    assert!(
        validate(&spec, "Waveform")
            .unwrap_err()
            .contains("application shell")
    );
}

#[test]
fn push_without_request_is_rejected() {
    let mut spec = spec();
    spec.push_request = None;
    assert!(
        validate(&spec, "Waveform")
            .unwrap_err()
            .contains("push_request")
    );
}

#[test]
fn fetch_without_operation_is_rejected() {
    let mut spec = spec();
    spec.fetch_op = None;
    assert!(
        validate(&spec, "Waveform")
            .unwrap_err()
            .contains("fetch_op")
    );
}

#[test]
fn push_only_panel_needs_no_fetch_operation() {
    let mut spec = spec();
    spec.delivery = PanelDelivery::Push;
    spec.fetch_op = None;
    assert_eq!(validate(&spec, "Waveform"), Ok(()));
}

#[test]
fn empty_label_key_is_rejected() {
    let mut spec = spec();
    spec.label_key = "";
    assert!(
        validate(&spec, "Waveform")
            .unwrap_err()
            .contains("label_key")
    );
}

#[test]
fn unknown_push_request_is_rejected() {
    let mut spec = spec();
    spec.push_request = Some("waveform_raster");
    assert!(
        validate(&spec, "Waveform")
            .unwrap_err()
            .contains("not a known display request")
    );
}

#[test]
fn unknown_fetch_operation_is_rejected() {
    let mut spec = spec();
    spec.fetch_op = Some("waveform_window");
    assert!(
        validate(&spec, "Waveform")
            .unwrap_err()
            .contains("not a known panel operation")
    );
}

#[test]
fn unavailable_data_plane_must_declare_no_operations() {
    let mut spec = spec();
    spec.delivery = PanelDelivery::Unavailable;
    spec.push_request = None;
    spec.fetch_op = None;
    assert_eq!(validate(&spec, "Image"), Ok(()));

    // 预支未来能力名 = 契约说谎, 必须拒绝
    spec.fetch_op = Some(panel_ops::FETCH_GRAPH_OUTPUTS);
    assert!(
        validate(&spec, "Image")
            .unwrap_err()
            .contains("no data plane yet")
    );
    spec.fetch_op = None;
    spec.push_request = Some(panel_ops::PUSH_RAW_DATA);
    assert!(
        validate(&spec, "Image")
            .unwrap_err()
            .contains("no data plane yet")
    );
}
