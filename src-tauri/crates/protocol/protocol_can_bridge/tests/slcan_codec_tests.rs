use can::{CanDirection, CanDlc, CanFrame, CanId};
use protocol::ProtocolEngine;
use protocol_can_bridge::SlcanEngine;
use protocol_can_bridge::{SlcanDecodeError, SlcanDecoder};

fn frames(input: &[u8]) -> Vec<CanFrame> {
    SlcanEngine::new().feed(input).can_frames
}

#[test]
fn decodes_lowercase_hex_and_crlf_in_arbitrary_chunks() {
    let mut engine = SlcanEngine::new();
    assert!(engine.feed(b"\r\n>t12").can_frames.is_empty());
    assert!(engine.feed(b"32ab").can_frames.is_empty());
    let frames = engine.feed(b"cd\nt7ff0\r\n").can_frames;
    assert_eq!(frames.len(), 2);
    assert_eq!(frames[0].id, 0x123);
    assert_eq!(frames[0].data, vec![0xab, 0xcd]);
    assert_eq!(frames[1].id, 0x7ff);
}

#[test]
fn accepts_optional_device_timestamps_on_all_frame_kinds() {
    let frames = frames(b"t1232AABB00FF\rT123456781AA0011\rr12340022\rR1234567840033\r");
    assert_eq!(frames.len(), 4);
    assert!(frames.iter().all(|frame| frame.validate().is_ok()));
    assert_eq!(frames[0].data, vec![0xaa, 0xbb]);
    assert!(frames[2].rtr);
    assert!(frames[3].rtr);
}

#[test]
fn malformed_frame_does_not_poison_following_frame() {
    let frames = frames(b"t1238ZZ\rt4561AA\r");
    assert_eq!(frames.len(), 1);
    assert_eq!(frames[0].id, 0x456);
}

#[test]
fn recovers_from_non_utf8_prompt_noise() {
    let frames = frames(b"\xff\xfe>t1231AA\r\n\0T000000011BB\r\n");
    assert_eq!(frames.len(), 2);
    assert_eq!(frames[0].id, 0x123);
    assert_eq!(frames[1].id, 1);
}

#[test]
fn long_unterminated_line_resynchronizes_after_boundary() {
    let mut decoder = SlcanDecoder::new();
    let first = decoder.push(&[b'x'; 300]);
    assert!(matches!(
        first.errors.as_slice(),
        [SlcanDecodeError::LineTooLong]
    ));
    let second = decoder.push(b"t1231AA\r");
    assert_eq!(second.frames().count(), 1);
}

#[test]
fn control_and_error_lines_are_classified_without_frames() {
    let mut decoder = SlcanDecoder::new();
    let batch = decoder.push(b"S6\rO\rC\rV\rN1234\rz00AA\rZ00BB\r? \r");
    assert_eq!(batch.frames().count(), 0);
    assert_eq!(batch.messages.len(), 8);
    assert!(batch.errors.is_empty());
}

#[test]
fn validated_codec_round_trip_preserves_data_and_remote_frames() {
    for original in [
        CanFrame::data(
            1,
            CanId::standard(0x123).unwrap(),
            vec![0x01, 0xa5, 0xff],
            CanDirection::Tx,
        )
        .unwrap(),
        CanFrame::data(
            2,
            CanId::extended(0x1234_5678).unwrap(),
            vec![],
            CanDirection::Rx,
        )
        .unwrap(),
        CanFrame::remote(
            3,
            CanId::standard(0x456).unwrap(),
            CanDlc::new(4).unwrap(),
            CanDirection::Tx,
        ),
        CanFrame::remote(
            4,
            CanId::extended(0x1fff_ffff).unwrap(),
            CanDlc::new(8).unwrap(),
            CanDirection::Rx,
        ),
    ] {
        let mut engine = SlcanEngine::new();
        let wire = engine.encode_can(&original);
        let decoded = engine
            .feed_with_direction(&wire, original.direction)
            .can_frames;
        assert_eq!(decoded.len(), 1);
        assert_eq!(decoded[0].id, original.id);
        assert_eq!(decoded[0].extended, original.extended);
        assert_eq!(decoded[0].rtr, original.rtr);
        assert_eq!(decoded[0].dlc, original.dlc);
        assert_eq!(decoded[0].data, original.data);
        assert_eq!(decoded[0].direction, original.direction);
    }
}

#[test]
fn wire_body_model_rejects_inconsistent_frames() {
    let remote_with_data = CanFrame {
        timestamp: 0,
        id: 1,
        extended: false,
        rtr: true,
        dlc: 1,
        data: vec![1],
        direction: CanDirection::Rx,
    };
    assert!(remote_with_data.body().is_err());

    let mismatched_dlc = CanFrame {
        rtr: false,
        dlc: CanDlc::MAX,
        ..remote_with_data
    };
    assert!(mismatched_dlc.body().is_err());
}

#[test]
fn wire_body_model_accepts_validated_parts() {
    let frame = CanFrame::data(
        10,
        CanId::extended(0x1234).unwrap(),
        vec![1, 2, 3],
        CanDirection::Tx,
    )
    .unwrap();
    assert_eq!(frame.parts().unwrap().body.dlc(), CanDlc::new(3).unwrap());
}
