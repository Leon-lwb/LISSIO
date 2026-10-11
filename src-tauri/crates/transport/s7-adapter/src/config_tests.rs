use super::*;

fn point(id: &str, area: S7Area, byte_offset: u32, data_type: S7DataType) -> S7Point {
    S7Point {
        id: PointId(id.into()),
        area,
        db_number: if area.uses_db_number() { 10 } else { 0 },
        byte_offset,
        bit: 0,
        data_type,
        scale: 1.0,
        offset: 0.0,
        poll_period_ms: 100,
    }
}

#[test]
fn accepts_valid_config() {
    let config = S7Config {
        host: "127.0.0.1".into(),
        port: 102,
        plc_type: S7PlcType::S1200,
        rack: 0,
        slot: 1,
        timeout_ms: 2_000,
        reconnect: ReconnectConfig::default(),
        points: vec![
            point("flag", S7Area::Markers, 0, S7DataType::Bool),
            point("db", S7Area::Db, 4, S7DataType::F32),
        ],
    };
    config.validate().unwrap();
}

#[test]
fn rejects_bit_on_non_bool_and_bad_db_number() {
    let mut config = S7Config {
        host: "127.0.0.1".into(),
        port: 102,
        plc_type: S7PlcType::S1200,
        rack: 0,
        slot: 1,
        timeout_ms: 2_000,
        reconnect: ReconnectConfig::default(),
        points: vec![point("word", S7Area::Markers, 0, S7DataType::U16)],
    };
    config.points[0].bit = 3;
    assert!(config.validate().is_err());

    config.points[0].bit = 0;
    config.points[0].db_number = 10;
    assert!(config.validate().is_err());

    config.points[0].area = S7Area::Db;
    config.validate().unwrap();
}

#[test]
fn rejects_offsets_beyond_the_24_bit_address_space() {
    let config = S7Config {
        host: "127.0.0.1".into(),
        port: 102,
        plc_type: S7PlcType::S1200,
        rack: 0,
        slot: 1,
        timeout_ms: 2_000,
        reconnect: ReconnectConfig::default(),
        points: vec![point(
            "far",
            S7Area::Markers,
            MAX_BYTE_OFFSET,
            S7DataType::F64,
        )],
    };
    assert!(config.validate().is_err());
}
