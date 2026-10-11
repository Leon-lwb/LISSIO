#![allow(
    clippy::cast_possible_truncation,
    clippy::cast_precision_loss,
    clippy::cast_lossless,
    clippy::cast_sign_loss
)]
use super::*;

#[test]
fn sine_stats_match_closed_form() {
    // 1V 幅值正弦 @ 1kHz, 100k 采样 (~159 个整周期取整窗口)
    let n = 100_000;
    let values: Vec<f32> = (0..n)
        .map(|i| {
            #[allow(clippy::cast_precision_loss)]
            let t = i as f64 * 1e-5;
            (std::f64::consts::TAU * 1_000.0 * t).sin() as f32
        })
        .collect();
    let s = channel_stats(&values).expect("正弦有数据");
    assert!((s.vpp - 2.0).abs() < 1e-2, "vpp={}", s.vpp);
    assert!((s.vmin + 1.0).abs() < 1e-2, "vmin={}", s.vmin);
    assert!(s.vavg.abs() < 1e-2, "vavg={}", s.vavg);
    assert!(
        (s.vrms - std::f64::consts::FRAC_1_SQRT_2).abs() < 5e-3,
        "vrms={}",
        s.vrms
    );
    assert!(
        (s.vrms_ac - s.vrms).abs() < 1e-6,
        "零均值信号 vrms_ac == vrms"
    );
    assert!((s.duty.expect("正弦非平直") - 0.5).abs() < 1e-2);
}

#[test]
fn dc_offset_separates_vrms_and_vrms_ac() {
    // 5V 直流 + 1V 幅值正弦: vrms ≈ 5.707, vrms_ac ≈ 0.707
    let values: Vec<f32> = (0..20_000)
        .map(|i| {
            #[allow(clippy::cast_precision_loss)]
            let t = i as f64 * 1e-4;
            (5.0 + (std::f64::consts::TAU * 50.0 * t).sin()) as f32
        })
        .collect();
    let s = channel_stats(&values).expect("有数据");
    assert!((s.vavg - 5.0).abs() < 1e-2);
    assert!((s.vrms - 5.0_f64.hypot(std::f64::consts::FRAC_1_SQRT_2)).abs() < 5e-3);
    assert!((s.vrms_ac - std::f64::consts::FRAC_1_SQRT_2).abs() < 5e-3);
}

#[test]
fn square_wave_duty_reflects_asymmetry() {
    // 30% 占空比方波: 0..3 低, 3..10 高 (周期 10)
    let values: Vec<f32> = (0..10_000)
        .map(|i| if i % 10 < 3 { 0.0 } else { 1.0 })
        .collect();
    let s = channel_stats(&values).expect("有数据");
    assert!((s.vpp - 1.0).abs() < 1e-9);
    let duty = s.duty.expect("方波非平直");
    assert!((duty - 0.7).abs() < 1e-6, "duty={duty}");
}

#[test]
fn flat_and_empty_signals_are_flagged() {
    assert!(channel_stats(&[]).is_none());
    assert!(channel_stats(&[f32::NAN, f32::NAN]).is_none());
    let flat = channel_stats(&[1.5_f32; 100]).expect("平直信号仍有统计");
    assert!(flat.vpp < FLAT_SIGNAL_VPP);
    assert!(flat.duty.is_none(), "平直信号占空比无意义");
    // NaN 混入不影响有效样本统计
    let mixed = channel_stats(&[1.0_f32, f32::NAN, 3.0]).expect("有有效样本");
    assert!((mixed.vmin - 1.0).abs() < 1e-9 && (mixed.vmax - 3.0).abs() < 1e-9);
}

#[test]
fn micro_ripple_near_dc_is_treated_as_flat() {
    // 近直流微纹波: vpp (≈5e-7) 低于平直阈值 1e-6 → duty None (周期检测同样拒绝)
    let values: Vec<f32> = (0..4_000)
        .map(|i| {
            #[allow(clippy::cast_precision_loss)]
            let t = i as f64 * 1e-3;
            (2.5e-7 * (std::f64::consts::TAU * 10.0 * t).sin()) as f32
        })
        .collect();
    let s = channel_stats(&values).expect("有数据");
    assert!(s.vpp < FLAT_SIGNAL_VPP, "vpp={}", s.vpp);
    assert!(s.duty.is_none(), "亚阈值纹波不应给出占空比");
}
