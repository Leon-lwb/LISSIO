use super::*;
use can::{CanIdLoadHistory, CanIdLoadStats, CanLoadHistoryPoint, CanLoadSnapshot};

fn snapshot(window_us: u64) -> CanLoadSnapshot {
    CanLoadSnapshot {
        window_us,
        frame_count: 120,
        total_bits: 12_345,
        total_bytes: 1_543,
        load_ratio: 0.25,
        history: vec![CanLoadHistoryPoint {
            timestamp: 1_000,
            load_ratio: 0.25,
            fps: 60.0,
        }],
        per_id: vec![CanIdLoadStats {
            id: 0x1ABCDEF0,
            extended: true,
            frame_count: 120,
            total_bits: 12_345,
            total_bytes: 1_543,
        }],
        per_id_history: vec![CanIdLoadHistory {
            id: 0x1ABCDEF0,
            extended: true,
            history: vec![CanLoadHistoryPoint {
                timestamp: 2_000,
                load_ratio: 0.1,
                fps: 30.0,
            }],
        }],
    }
}

// ---- CSV 格式化 ----

#[test]
fn csv_contains_metadata_header_and_three_sections() {
    let csv = format_can_load_csv(&snapshot(1_000_000), 500_000, "2026-01-01T00:00:00");
    assert!(csv.starts_with("# Lissio CAN Load Stats Export\n"));
    assert!(csv.contains("# Export Time: 2026-01-01T00:00:00"));
    assert!(csv.contains("# Bitrate: 500000 bps"));
    assert!(
        csv.contains(
            "# Summary: frames=120, total_bits=12345, total_bytes=1543, load_ratio=0.2500"
        )
    );
    // 三个 Section 按序出现
    let history = csv.find("# Section: History").expect("History section");
    let per_id = csv.find("# Section: Per-ID\n").expect("Per-ID section");
    let per_id_history = csv
        .find("# Section: Per-ID History")
        .expect("Per-ID History section");
    assert!(history < per_id && per_id < per_id_history);
    assert!(csv.contains("timestamp_us,load_ratio,fps\n"));
    assert!(csv.contains("id_hex,extended,frame_count,total_bits,total_bytes\n"));
    assert!(csv.contains("id_hex,extended,timestamp_us,load_ratio\n"));
}

#[test]
fn csv_window_uses_s_or_ms_description() {
    assert!(
        format_can_load_csv(&snapshot(1_000_000), 500_000, "t")
            .contains("# Window: 1000000 us (1s)")
    );
    assert!(
        format_can_load_csv(&snapshot(100_000), 500_000, "t")
            .contains("# Window: 100000 us (100ms)")
    );
}

#[test]
fn csv_ids_are_uppercase_hex_with_0x_prefix() {
    let csv = format_can_load_csv(&snapshot(1_000_000), 500_000, "t");
    assert!(csv.contains("0x1ABCDEF0,true,120,12345,1543"), "Per-ID 行");
    assert!(
        csv.contains("0x1ABCDEF0,true,2000,0.100000"),
        "Per-ID History 行"
    );
    assert!(csv.contains("1000,0.250000,60.00"), "History 行");
}

#[test]
fn csv_is_empty_safe_when_no_history() {
    let mut snap = snapshot(1_000_000);
    snap.history.clear();
    snap.per_id.clear();
    snap.per_id_history.clear();
    let csv = format_can_load_csv(&snap, 500_000, "t");
    assert!(csv.contains("# Section: History"));
    assert!(csv.matches('\n').count() >= 8, "空数据也应有表头结构");
}

// ---- 本地时间换算 (Unix 路径依赖 TZ, 只断言范围) ----

#[test]
fn local_components_are_in_valid_ranges() {
    let (year, month, day, hour, minute, second) = secs_to_local_components(0);
    assert!(year >= 1970);
    assert!((1..=12).contains(&month), "month={month}");
    assert!((1..=31).contains(&day), "day={day}");
    assert!(hour <= 23 && minute <= 59 && second <= 59);
}

/// 默认文件名带 `.csv` 后缀与 `vofa-can-load-` 前缀 (各出口共用)。
#[test]
fn default_file_name_is_stable() {
    let name = can_load_csv_file_name(0);
    assert!(name.starts_with("vofa-can-load-"), "{name}");
    assert!(
        std::path::Path::new(&name)
            .extension()
            .is_some_and(|ext| ext.eq_ignore_ascii_case("csv")),
        "{name}"
    );
}
