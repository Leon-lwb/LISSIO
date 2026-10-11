use super::stream_json_frame;

#[test]
fn stream_frame_inlines_payload_without_reencoding() {
    let frame = stream_json_frame(4, r#"{"kind":"waveform","payload":{"n":1}}"#);
    assert_eq!(
        frame,
        r#"{"type":"stream","id":4,"payload":{"kind":"waveform","payload":{"n":1}}}"#
    );
}
