use super::*;
use std::collections::HashMap;

fn sample_window() -> WaveformWindow {
    let mut derived = HashMap::new();
    let mut sources = HashMap::new();
    let mut handles = HashMap::new();
    handles.insert("out".to_string(), vec![1.0, f32::NAN, 3.0]);
    sources.insert("math-1".to_string(), handles);
    derived.insert("wave-1".to_string(), sources);
    WaveformWindow {
        seq: 42,
        timestamps: vec![-30.0, -20.0, -10.0],
        channels: vec![vec![10.0, 11.0, 12.0], vec![], vec![30.0, 31.0, 32.0]],
        channel_count: 3,
        derived,
        buffer_points: 1_000,
        buffer_capacity: 100_000,
        latest_timestamp_us: 1_234_567,
        raw_window_points: 2_000,
        sampling: WaveformSampling::MinMax,
        storage_overflow: 7,
        buffer_tier: 2,
    }
}

#[test]
fn header_and_columns_are_encoded() {
    let bytes = encode_waveform_window(&sample_window());
    // 键名 15 字节 + 补齐 3 = 每项键区对齐到 24; (6+键名+补齐+4n) = 36
    let expected = 80 + 8 * 3 + 4 * 3 * 3 + 24 + 4 * 3;
    assert_eq!(bytes.len(), expected);
    let view = &bytes[..WAVEFORM_BINARY_HEADER_LEN];
    assert_eq!(u16::from_le_bytes(view[4..6].try_into().unwrap()), 2);
    assert_eq!(u16::from_le_bytes(view[6..8].try_into().unwrap()), 1); // min_max
    assert_eq!(u64::from_le_bytes(view[8..16].try_into().unwrap()), 42);
    assert_eq!(u32::from_le_bytes(view[48..52].try_into().unwrap()), 3);
    assert_eq!(u32::from_le_bytes(view[52..56].try_into().unwrap()), 3);
    assert_eq!(u32::from_le_bytes(view[56..60].try_into().unwrap()), 3);
    assert_eq!(u32::from_le_bytes(view[60..64].try_into().unwrap()), 1);
    // v2 降载元数据
    assert_eq!(u64::from_le_bytes(view[64..72].try_into().unwrap()), 7);
    assert_eq!(view[72], 2);
    // timestamps
    let ts: f64 = f64::from_le_bytes(bytes[80..88].try_into().unwrap());
    assert!((ts + 30.0).abs() < 1e-9);
    // 通道 1 空槽对齐为 NaN
    let ch1_offset = 80 + 8 * 3 + 4 * 3;
    let v: f32 = f32::from_le_bytes(bytes[ch1_offset..ch1_offset + 4].try_into().unwrap());
    assert!(v.is_nan());
    // 派生列 NaN 原生传递 (JSON 路径下这里曾是 null); 值列 4 字节对齐
    let derived_offset = 80 + 8 * 3 + 4 * 3 * 3 + 24;
    assert_eq!(derived_offset % 4, 0);
    let v: f32 = f32::from_le_bytes(
        bytes[derived_offset + 4..derived_offset + 8]
            .try_into()
            .unwrap(),
    );
    assert!(v.is_nan());
}

#[test]
fn short_columns_are_padded_to_point_count() {
    let mut window = sample_window();
    window.channels = vec![vec![1.0]]; // 长度不足
    let bytes = encode_waveform_window(&window);
    // n 仍由 timestamps 决定 = 3; 键区 21 对齐到 24
    let expected = 80 + 8 * 3 + 4 * 3 + 24 + 4 * 3;
    assert_eq!(bytes.len(), expected);
}
