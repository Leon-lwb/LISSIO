use super::*;

#[test]
fn derives_only_reversible_frame_decoder_layouts() {
    let supported = vec![
        DecoderBlockDef::Header {
            id: "head".into(),
            hex: "AA".into(),
            match_id: None,
        },
        DecoderBlockDef::Field {
            id: "value".into(),
            field_type: FieldType::Float32LE,
            port_name: "value".into(),
            length_ref: None,
            match_id: None,
        },
    ];
    assert!(frame_decoder_encoding(&supported).is_some());

    let unsupported = vec![DecoderBlockDef::Bitfield {
        id: "bits".into(),
        byte_offset: 0,
        bit_offset: 0,
        bit_length: 1,
        is_signed: false,
        port_name: "flag".into(),
        match_id: None,
    }];
    assert!(frame_decoder_encoding(&unsupported).is_none());
}
