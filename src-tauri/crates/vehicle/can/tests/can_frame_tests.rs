//! `can::can_frame` 单元测试
//!
//! 覆盖:
//! - CanDirection 默认值与等值
//! - CanFrame 构造、`data_len` 计算
//! - CanBitrate bps / slcan_cmd 映射
//! - CanFilter / CanFrameFilter 多场景命中
//! - CanFrameBatch 构造与状态
//! - CandleDeviceInfo 序列化

use can::{CanBitrate, CanDirection, CanFilter, CanFrame, CanFrameBatch, CanFrameFilter};

#[test]
fn direction_default_is_rx() {
    assert_eq!(CanDirection::default(), CanDirection::Rx);
}

#[test]
fn direction_eq_and_copy() {
    let a = CanDirection::Rx;
    let b = a;
    assert_eq!(a, b);
    assert_ne!(CanDirection::Rx, CanDirection::Tx);
}

#[test]
fn frame_new_truncates_data_to_dlc8() {
    let f = CanFrame::new(
        100,
        0x100,
        vec![1, 2, 3, 4, 5, 6, 7, 8, 9, 10],
        CanDirection::Tx,
    );
    assert_eq!(f.timestamp, 100);
    assert_eq!(f.id, 0x100);
    assert!(!f.extended);
    assert_eq!(f.dlc, 8);
    assert_eq!(f.data, vec![1, 2, 3, 4, 5, 6, 7, 8]);
    assert_eq!(f.direction, CanDirection::Tx);
    assert_eq!(f.data_len(), 8);
}

#[test]
fn frame_empty_data_has_dlc_zero() {
    let f = CanFrame::new(0, 0x42, vec![], CanDirection::Rx);
    assert_eq!(f.dlc, 0);
    assert_eq!(f.data.len(), 0);
    assert_eq!(f.data_len(), 0);
}

#[test]
fn frame_serde_roundtrip() {
    let f = CanFrame {
        timestamp: 1_234_567,
        id: 0x7FF,
        extended: false,
        rtr: true,
        dlc: 3,
        data: vec![0xDE, 0xAD, 0xBE],
        direction: CanDirection::Tx,
    };
    let json = serde_json::to_string(&f).unwrap();
    let restored: CanFrame = serde_json::from_str(&json).unwrap();
    assert_eq!(restored.timestamp, f.timestamp);
    assert_eq!(restored.id, f.id);
    assert!(restored.rtr);
    assert_eq!(restored.data, f.data);
    assert_eq!(restored.direction, CanDirection::Tx);
}

#[test]
fn bitrate_bps_returns_expected_values() {
    assert_eq!(CanBitrate::Bps10k.bps(), 10_000);
    assert_eq!(CanBitrate::Bps20k.bps(), 20_000);
    assert_eq!(CanBitrate::Bps50k.bps(), 50_000);
    assert_eq!(CanBitrate::Bps100k.bps(), 100_000);
    assert_eq!(CanBitrate::Bps125k.bps(), 125_000);
    assert_eq!(CanBitrate::Bps250k.bps(), 250_000);
    assert_eq!(CanBitrate::Bps500k.bps(), 500_000);
    assert_eq!(CanBitrate::Bps800k.bps(), 800_000);
    assert_eq!(CanBitrate::Bps1m.bps(), 1_000_000);
}

#[test]
fn bitrate_serde_uses_frontend_contract_names() {
    for (bitrate, expected) in [
        (CanBitrate::Bps10k, "\"Bps10k\""),
        (CanBitrate::Bps20k, "\"Bps20k\""),
        (CanBitrate::Bps50k, "\"Bps50k\""),
        (CanBitrate::Bps100k, "\"Bps100k\""),
        (CanBitrate::Bps125k, "\"Bps125k\""),
        (CanBitrate::Bps250k, "\"Bps250k\""),
        (CanBitrate::Bps500k, "\"Bps500k\""),
        (CanBitrate::Bps800k, "\"Bps800k\""),
        (CanBitrate::Bps1m, "\"Bps1m\""),
    ] {
        assert_eq!(serde_json::to_string(&bitrate).unwrap(), expected);
        assert_eq!(
            serde_json::from_str::<CanBitrate>(expected).unwrap(),
            bitrate
        );
    }
}

/// NAMES 与 ALL 必须逐位对齐 — schema 生成与 parse 都依赖这一不变量。
#[test]
fn bitrate_names_align_with_all_variants() {
    assert_eq!(CanBitrate::ALL.len(), CanBitrate::NAMES.len());
    for (bitrate, name) in CanBitrate::ALL.iter().zip(CanBitrate::NAMES) {
        assert_eq!(
            serde_json::to_string(bitrate).unwrap(),
            format!("\"{name}\"")
        );
    }
}

#[test]
fn bitrate_slcan_cmd_mapping() {
    assert_eq!(CanBitrate::Bps10k.slcan_cmd(), "S0");
    assert_eq!(CanBitrate::Bps20k.slcan_cmd(), "S1");
    assert_eq!(CanBitrate::Bps50k.slcan_cmd(), "S2");
    assert_eq!(CanBitrate::Bps100k.slcan_cmd(), "S3");
    assert_eq!(CanBitrate::Bps125k.slcan_cmd(), "S4");
    assert_eq!(CanBitrate::Bps250k.slcan_cmd(), "S5");
    assert_eq!(CanBitrate::Bps500k.slcan_cmd(), "S6");
    assert_eq!(CanBitrate::Bps800k.slcan_cmd(), "S7");
    assert_eq!(CanBitrate::Bps1m.slcan_cmd(), "S8");
}

#[test]
fn bitrate_parse_accepts_contract_names() {
    for (index, name) in CanBitrate::NAMES.iter().enumerate() {
        assert_eq!(CanBitrate::parse(name), Some(CanBitrate::ALL[index]));
    }
}

/// 修复前 schema 曾以 `Bps1M` (大写 M) 写入工作区 — 反序列化必须兜底。
#[test]
fn bitrate_parse_is_case_insensitive_fallback() {
    assert_eq!(CanBitrate::parse("Bps1M"), Some(CanBitrate::Bps1m));
    assert_eq!(CanBitrate::parse("bps800K"), Some(CanBitrate::Bps800k));
    assert_eq!(CanBitrate::parse("BPS500K"), Some(CanBitrate::Bps500k));
    assert_eq!(CanBitrate::parse("bps10k"), Some(CanBitrate::Bps10k));
}

#[test]
fn bitrate_parse_rejects_unknown_names() {
    assert_eq!(CanBitrate::parse("Bps200k"), None);
    assert_eq!(CanBitrate::parse("1000000"), None);
    assert_eq!(CanBitrate::parse(""), None);
    assert_eq!(CanBitrate::parse(" Bps500k"), None);
}

#[test]
fn bitrate_deserialize_accepts_legacy_uppercase_m() {
    assert_eq!(
        serde_json::from_str::<CanBitrate>("\"Bps1M\"").unwrap(),
        CanBitrate::Bps1m
    );
    assert_eq!(
        serde_json::from_str::<CanBitrate>("\"bps800K\"").unwrap(),
        CanBitrate::Bps800k
    );
}

#[test]
fn bitrate_deserialize_rejects_unknown_and_non_string() {
    assert!(serde_json::from_str::<CanBitrate>("\"Bps200k\"").is_err());
    assert!(serde_json::from_str::<CanBitrate>("500000").is_err());
    assert!(serde_json::from_str::<CanBitrate>("null").is_err());
}

#[test]
fn filter_disabled_matches_all() {
    let f = CanFilter {
        enabled: false,
        id_mask_std: 0,
        id_mask_ext: 0,
    };
    let frame = CanFrame::new(0, 0x123, vec![1, 2, 3], CanDirection::Rx);
    assert!(f.matches(&frame));
}

#[test]
fn filter_enabled_always_matches_with_full_mask() {
    // 全 1 掩码: 总等于自身
    let f = CanFilter {
        enabled: true,
        id_mask_std: 0xFFFF,
        id_mask_ext: 0xFFFF_FFFF,
    };
    let std = CanFrame::new(0, 0x7FF, vec![], CanDirection::Rx);
    let ext = CanFrame {
        extended: true,
        id: 0x1FFFFFFF,
        ..std.clone()
    };
    assert!(f.matches(&std));
    assert!(f.matches(&ext));
}

#[test]
fn frame_filter_direction_only_rx() {
    let f = CanFrameFilter {
        rx_only: true,
        tx_only: false,
        id_whitelist: vec![],
        id_blacklist: vec![],
    };
    let rx = CanFrame::new(0, 1, vec![], CanDirection::Rx);
    let tx = CanFrame::new(0, 1, vec![], CanDirection::Tx);
    assert!(f.matches(&rx));
    assert!(!f.matches(&tx));
}

#[test]
fn frame_filter_direction_only_tx() {
    let f = CanFrameFilter {
        rx_only: false,
        tx_only: true,
        id_whitelist: vec![],
        id_blacklist: vec![],
    };
    assert!(!f.matches(&CanFrame::new(0, 1, vec![], CanDirection::Rx)));
    assert!(f.matches(&CanFrame::new(0, 1, vec![], CanDirection::Tx)));
}

#[test]
fn frame_filter_id_whitelist_strict() {
    let f = CanFrameFilter {
        rx_only: false,
        tx_only: false,
        id_whitelist: vec![0x100, 0x200],
        id_blacklist: vec![],
    };
    assert!(f.matches(&CanFrame::new(0, 0x100, vec![], CanDirection::Rx)));
    assert!(!f.matches(&CanFrame::new(0, 0x300, vec![], CanDirection::Rx)));
}

#[test]
fn frame_filter_id_blacklist_strict() {
    let f = CanFrameFilter {
        rx_only: false,
        tx_only: false,
        id_whitelist: vec![],
        id_blacklist: vec![0x100],
    };
    assert!(!f.matches(&CanFrame::new(0, 0x100, vec![], CanDirection::Rx)));
    assert!(f.matches(&CanFrame::new(0, 0x200, vec![], CanDirection::Rx)));
}

#[test]
fn frame_filter_combined_rules() {
    let f = CanFrameFilter {
        rx_only: true,
        tx_only: false,
        id_whitelist: vec![1, 2, 3],
        id_blacklist: vec![3],
    };
    // Rx, id=1, 不在黑名单 → 通过
    assert!(f.matches(&CanFrame::new(0, 1, vec![], CanDirection::Rx)));
    // Rx, id=3, 在黑名单 → 拦截
    assert!(!f.matches(&CanFrame::new(0, 3, vec![], CanDirection::Rx)));
    // Tx 即使 id 正确 → 方向拦截
    assert!(!f.matches(&CanFrame::new(0, 1, vec![], CanDirection::Tx)));
}

#[test]
fn frame_batch_seq_propagates_and_len_tracks() {
    let mut batch = CanFrameBatch::new(7);
    assert_eq!(batch.seq, 7);
    assert!(batch.is_empty());
    batch
        .frames
        .push(CanFrame::new(0, 1, vec![], CanDirection::Rx));
    batch
        .frames
        .push(CanFrame::new(0, 2, vec![], CanDirection::Rx));
    assert_eq!(batch.len(), 2);
}

#[test]
fn frame_batch_serde_roundtrip() {
    let mut batch = CanFrameBatch::new(42);
    batch
        .frames
        .push(CanFrame::new(100, 0x200, vec![0xAA], CanDirection::Rx));
    let json = serde_json::to_string(&batch).unwrap();
    let restored: CanFrameBatch = serde_json::from_str(&json).unwrap();
    assert_eq!(restored.seq, 42);
    assert_eq!(restored.frames.len(), 1);
}
