#![allow(
    clippy::cast_possible_truncation,
    clippy::cast_precision_loss,
    clippy::cast_lossless,
    clippy::cast_sign_loss
)]
use super::*;

fn sine(freq: f64, dt: f64, n: usize, offset: f64, amp: f64) -> Vec<f32> {
    (0..n)
        .map(|i| {
            #[allow(clippy::cast_precision_loss)]
            let t = i as f64 * dt;
            amp.mul_add((std::f64::consts::TAU * freq * t).sin(), offset) as f32
        })
        .collect()
}

fn assert_close_to(actual: f64, expected: f64, rel: f64, what: &str) {
    let err = ((actual - expected) / expected).abs();
    assert!(
        err < rel,
        "{what}: actual={actual}, expected={expected}, err={err}"
    );
}

#[test]
fn sine_period_is_accurate() {
    // 1kHz 正弦 @ 100kHz, 8192 样本 (~82 周期)
    let values = sine(1_000.0, 1e-5, 8_192, 0.0, 1.0);
    let est = detect_period(&values, 1e-5).expect("正弦应检出周期");
    assert_close_to(est.period_sec, 1e-3, 0.01, "周期");
    assert_close_to(est.freq_hz, 1_000.0, 0.01, "频率");
    assert!(est.confidence > 0.9, "纯正弦置信度应接近 1");
}

#[test]
fn square_wave_period_is_accurate() {
    // 50Hz 方波 @ 10kHz, 6000 样本 (200 样本/周期, 100 高 + 100 低)
    let values: Vec<f32> = (0..6_000)
        .map(|i| if i % 200 < 100 { 1.0 } else { -1.0 })
        .collect();
    let est = detect_period(&values, 1e-4).expect("方波应检出周期");
    assert_close_to(est.period_sec, 0.02, 0.01, "方波周期");
}

#[test]
fn dc_offset_does_not_change_period() {
    // 评审补充边界: 带 5V 直流偏置的正弦 — 周期不受 DC 影响
    let values = sine(100.0, 1e-4, 8_192, 5.0, 1.0);
    let est = detect_period(&values, 1e-4).expect("带偏置正弦应检出周期");
    assert_close_to(est.period_sec, 0.01, 0.01, "带偏置周期");
}

#[test]
fn multi_tone_finds_fundamental_not_harmonic() {
    // 1kHz 基波 + 3kHz 三次谐波: 首峰必须落在基波 1ms (非 0.33ms / 2ms)
    let values: Vec<f32> = (0..8_192)
        .map(|i| {
            #[allow(clippy::cast_precision_loss)]
            let t = i as f64 * 1e-5;
            0.8_f64.mul_add(
                (std::f64::consts::TAU * 3_000.0 * t).sin(),
                (std::f64::consts::TAU * 1_000.0 * t).sin(),
            ) as f32
        })
        .collect();
    let est = detect_period(&values, 1e-5).expect("复合信号应检出周期");
    assert_close_to(est.period_sec, 1e-3, 0.05, "基波周期");
}

#[test]
fn noise_returns_none() {
    // 确定性伪随机 (LCG) — 两条检测路径都必须拒绝, 不得误报频率
    let mut seed = 1_u64;
    let values: Vec<f32> = (0..4_096)
        .map(|_| {
            seed = seed
                .wrapping_mul(6_364_136_223_846_793_005)
                .wrapping_add(1_442_695_040_888_963_407);
            #[allow(
                clippy::cast_possible_truncation,
                clippy::cast_precision_loss,
                clippy::cast_sign_loss
            )]
            {
                let v = (seed >> 33) % 2_000;
                (f64::from(u32::try_from(v).unwrap_or(1_000)) / 1_000.0 - 1.0) as f32
            }
        })
        .collect();
    assert!(detect_period(&values, 1e-4).is_none(), "噪声不应给出周期");
}

#[test]
fn dc_and_micro_ripple_return_none() {
    assert!(detect_period(&[2.5_f32; 512], 1e-4).is_none(), "恒定直流");
    // 近直流微纹波 (vpp 低于平直阈值)
    let ripple: Vec<f32> = (0..512)
        .map(|i| {
            #[allow(clippy::cast_precision_loss)]
            let t = i as f64 * 1e-4;
            (2.5e-7 * (std::f64::consts::TAU * 100.0 * t).sin()) as f32
        })
        .collect();
    assert!(detect_period(&ripple, 1e-4).is_none(), "微纹波视为平直");
}

#[test]
fn short_or_gapped_input_returns_none() {
    assert!(detect_period(&[1.0_f32, -1.0, 1.0, -1.0, 1.0, -1.0, 1.0], 1e-3).is_none());
    let mut gapped = sine(1_000.0, 1e-5, 1_024, 0.0, 1.0);
    gapped[100] = f32::NAN;
    assert!(detect_period(&gapped, 1e-5).is_none(), "NaN 破坏等间隔假设");
}
