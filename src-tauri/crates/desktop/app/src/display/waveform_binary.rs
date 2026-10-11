//! 波形窗口 WWB1 二进制列编码 — 波形 detail/overview 流的唯一 IPC 载荷
//!
//! 30fps × 每系列 12k 点的 JSON 数字数组在序列化/解析两侧都是全量拷贝
//! (且 serde_json 把 NaN 编码为 null, 前端还需一次 null→NaN 归一化);
//! 列式二进制让前端以 TypedArray 视图零拷贝读取, NaN 原生传递。
//!
//! 布局 (little-endian):
//! ```text
//! [0..4)    magic "WWB1"
//! [4..6)    schema 版本 = 1 (u16)
//! [6..8)    sampling (u16: 0=raw 1=min_max 2=lttb)
//! [8..16)   seq (u64)
//! [16..24)  latest_timestamp_us (u64)
//! [24..32)  buffer_points (u64)
//! [32..40)  buffer_capacity (u64)
//! [40..48)  raw_window_points (u64)
//! [48..52)  point_count n (u32)
//! [52..56)  channel_slot_count c (u32)
//! [56..60)  channel_count (u32)
//! [60..64)  derived_entry_count d (u32)
//! [64..72)  storage_overflow (u64, v2) — L0 滚动覆盖累计 (降载徽标)
//! [72..73)  buffer_tier (u8, v2) — 服务本窗口的金字塔层级 (0=原始层)
//! [73..80)  保留 (零填充)
//! [80..)    timestamps: n × f64 (相对最新的毫秒偏移)
//! [..)      channels: c 列 × n × f32 (槽位全形, 空槽为 NaN)
//! [..)      derived × d: (u16 长度 + UTF-8 bytes) × {sink, source, handle}
//!                      + n × f32
//! ```

use waveform::{WaveformSampling, WaveformWindow};

pub const WAVEFORM_BINARY_MAGIC: &[u8; 4] = b"WWB1";
pub const WAVEFORM_BINARY_SCHEMA_VERSION: u16 = 2;
pub const WAVEFORM_BINARY_HEADER_LEN: usize = 80;

const fn sampling_code(sampling: WaveformSampling) -> u16 {
    match sampling {
        WaveformSampling::Raw => 0,
        WaveformSampling::MinMax => 1,
        WaveformSampling::Lttb => 2,
    }
}

/// 把通道列对齐到 n 点 (截断补齐) — 快照列与时间戳本就等长, 此为防御性对齐
fn aligned_column(column: &[f32], n: usize) -> Vec<f32> {
    let mut out = Vec::with_capacity(n);
    out.extend_from_slice(&column[..column.len().min(n)]);
    out.resize(n, f32::NAN);
    out
}

pub fn encode_waveform_window(window: &WaveformWindow) -> Vec<u8> {
    let n = window.timestamps.len();
    let slots = window.channels.len();
    let derived_entries: Vec<(&String, &String, &String, &Vec<f32>)> = window
        .derived
        .iter()
        .flat_map(|(sink, sources)| {
            sources.iter().flat_map(move |(source, handles)| {
                handles
                    .iter()
                    .map(move |(handle, values)| (sink, source, handle, values))
            })
        })
        .collect();

    // 每条派生项: 3×(u16 长度 + 键名字节) + 补齐到 4 字节 + n × f32
    // (补齐保证 f32 列 4 字节对齐 — 前端 Float32Array 视图不允许错位偏移)
    let payload_len = 8 * n
        + 4 * slots * n
        + derived_entries
            .iter()
            .map(|(sink, source, handle, _)| {
                let keys_len = 6 + sink.len() + source.len() + handle.len();
                keys_len.next_multiple_of(4) + 4 * n
            })
            .sum::<usize>();
    let mut bytes = Vec::with_capacity(WAVEFORM_BINARY_HEADER_LEN + payload_len);
    bytes.extend_from_slice(WAVEFORM_BINARY_MAGIC);
    bytes.extend_from_slice(&WAVEFORM_BINARY_SCHEMA_VERSION.to_le_bytes());
    bytes.extend_from_slice(&sampling_code(window.sampling).to_le_bytes());
    bytes.extend_from_slice(&window.seq.to_le_bytes());
    bytes.extend_from_slice(&window.latest_timestamp_us.to_le_bytes());
    bytes.extend_from_slice(
        &u64::try_from(window.buffer_points)
            .unwrap_or(u64::MAX)
            .to_le_bytes(),
    );
    bytes.extend_from_slice(
        &u64::try_from(window.buffer_capacity)
            .unwrap_or(u64::MAX)
            .to_le_bytes(),
    );
    bytes.extend_from_slice(
        &u64::try_from(window.raw_window_points)
            .unwrap_or(u64::MAX)
            .to_le_bytes(),
    );
    bytes.extend_from_slice(&u32::try_from(n).unwrap_or(u32::MAX).to_le_bytes());
    bytes.extend_from_slice(&u32::try_from(slots).unwrap_or(u32::MAX).to_le_bytes());
    bytes.extend_from_slice(
        &u32::try_from(window.channel_count)
            .unwrap_or(u32::MAX)
            .to_le_bytes(),
    );
    bytes.extend_from_slice(
        &u32::try_from(derived_entries.len())
            .unwrap_or(u32::MAX)
            .to_le_bytes(),
    );
    // v2: 降载元数据
    bytes.extend_from_slice(&window.storage_overflow.to_le_bytes());
    bytes.push(window.buffer_tier);
    while bytes.len() < WAVEFORM_BINARY_HEADER_LEN {
        bytes.push(0);
    }

    for ts in &window.timestamps {
        bytes.extend_from_slice(&ts.to_le_bytes());
    }
    for column in &window.channels {
        for value in aligned_column(column, n) {
            bytes.extend_from_slice(&value.to_le_bytes());
        }
    }
    for (sink, source, handle, values) in derived_entries {
        for key in [sink, source, handle] {
            let len = u16::try_from(key.len()).unwrap_or(u16::MAX);
            bytes.extend_from_slice(&len.to_le_bytes());
            bytes.extend_from_slice(key.as_bytes());
        }
        while bytes.len() % 4 != 0 {
            bytes.push(0);
        }
        for value in aligned_column(values, n) {
            bytes.extend_from_slice(&value.to_le_bytes());
        }
    }
    bytes
}

#[cfg(test)]
#[path = "waveform_binary_tests.rs"]
mod tests;
