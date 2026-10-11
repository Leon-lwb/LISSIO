use super::*;
use std::f32::consts::PI;

#[test]
fn test_push_and_ready() {
    let mut analyzer =
        SpectrumAnalyzer::new(8, WindowType::Rect, SpectrumOutput::Magnitude, 1000.0);
    assert!(!analyzer.is_ready());
    for i in 0..8 {
        analyzer.push(i as f32);
    }
    assert!(analyzer.is_ready());
}

#[test]
fn test_compute_not_ready() {
    let mut analyzer =
        SpectrumAnalyzer::new(8, WindowType::Rect, SpectrumOutput::Magnitude, 1000.0);
    analyzer.push(1.0);
    assert!(analyzer.compute().is_none());
}

#[test]
fn test_fft_sine_signal_peak() {
    // 采样率 1000 Hz, 窗口 256 点, 信号频率 50 Hz
    // FFT 后应在 bin k=50*256/1000=12.8≈13 处出现峰值
    let n = 256;
    let fs = 1000.0;
    let freq = 50.0;
    let mut analyzer = SpectrumAnalyzer::new(n, WindowType::Rect, SpectrumOutput::Magnitude, fs);
    for i in 0..n {
        let t = i as f32 / fs;
        analyzer.push((2.0 * PI * freq * t).sin());
    }
    let result = analyzer.compute().expect("应能计算");
    assert_eq!(result.frequencies.len(), n / 2 + 1);
    assert_eq!(result.values.len(), n / 2 + 1);

    // 找到峰值 bin
    let max_idx = result
        .values
        .iter()
        .enumerate()
        .max_by(|a, b| a.1.partial_cmp(b.1).unwrap())
        .map(|(i, _)| i)
        .unwrap();
    // 峰值频率应接近 50 Hz (允许 ±1 bin)
    let peak_freq = result.frequencies[max_idx];
    assert!(
        (peak_freq - freq).abs() < fs / n as f32 * 2.0,
        "峰值频率 {peak_freq} 应接近 {freq}"
    );
}

#[test]
fn test_fft_dc_signal() {
    // 直流信号 (常数) → bin 0 应为最大
    let n = 64;
    let mut analyzer =
        SpectrumAnalyzer::new(n, WindowType::Rect, SpectrumOutput::Magnitude, 1000.0);
    for _ in 0..n {
        analyzer.push(1.0);
    }
    let result = analyzer.compute().expect("应能计算");
    // bin 0 (DC) 应为最大
    let dc = result.values[0];
    for v in &result.values[1..] {
        assert!(dc > *v, "DC 分量应大于其他 bin");
    }
    // DC 分量 ≈ 1.0 (Rect 窗, 振幅 = |sum| / N = N/N = 1)
    assert!((dc - 1.0).abs() < 0.01, "DC 分量应接近 1.0, 实际 {dc}");
}

#[test]
fn test_windowed_fft_reduces_leakage() {
    // 加窗后频谱泄漏应减少 (旁瓣降低)
    let n = 256;
    let fs = 1000.0;
    let freq = 50.5; // 非整数 bin 频率, 触发泄漏
    let signal: Vec<f32> = (0..n)
        .map(|i| (2.0 * PI * freq * i as f32 / fs).sin())
        .collect();

    // Rect 窗 (不加窗)
    let mut a_rect = SpectrumAnalyzer::new(n, WindowType::Rect, SpectrumOutput::Magnitude, fs);
    a_rect.push_slice(&signal);
    let r_rect = a_rect.compute().unwrap();

    // Hann 窗
    let mut a_hann = SpectrumAnalyzer::new(n, WindowType::Hann, SpectrumOutput::Magnitude, fs);
    a_hann.push_slice(&signal);
    let r_hann = a_hann.compute().unwrap();

    // 找到 Rect 窗的峰值
    let peak_idx = r_rect
        .values
        .iter()
        .enumerate()
        .max_by(|a, b| a.1.partial_cmp(b.1).unwrap())
        .map(|(i, _)| i)
        .unwrap();

    // 测量远离峰值的旁瓣最大值 (取距离峰值 5 bin 以外的最大值)
    let side_rect = r_rect
        .values
        .iter()
        .enumerate()
        .filter(|(i, _)| (*i as i32 - peak_idx as i32).abs() > 5)
        .map(|(_, v)| *v)
        .fold(0.0f32, f32::max);
    let side_hann = r_hann
        .values
        .iter()
        .enumerate()
        .filter(|(i, _)| (*i as i32 - peak_idx as i32).abs() > 5)
        .map(|(_, v)| *v)
        .fold(0.0f32, f32::max);

    // Hann 窗的旁瓣应明显低于 Rect 窗
    assert!(
        side_hann < side_rect * 0.5,
        "Hann 旁瓣 {} 应小于 Rect 旁瓣 * 0.5 = {}",
        side_hann,
        side_rect * 0.5
    );
}

#[test]
fn test_psd_output() {
    // PSD 输出不应为 NaN/Inf
    let n = 128;
    let mut analyzer = SpectrumAnalyzer::new(n, WindowType::Hann, SpectrumOutput::PSD, 1000.0);
    for i in 0..n {
        analyzer.push((i as f32 * 0.1).sin());
    }
    let result = analyzer.compute().expect("应能计算");
    for v in &result.values {
        assert!(v.is_finite(), "PSD 值应为有限数");
    }
}

#[test]
fn test_decibel_output() {
    let n = 128;
    let mut analyzer = SpectrumAnalyzer::new(n, WindowType::Hann, SpectrumOutput::Decibel, 1000.0);
    for i in 0..n {
        analyzer.push((i as f32 * 0.1).sin());
    }
    let result = analyzer.compute().expect("应能计算");
    // dB 值应为有限数 (可能为负)
    for v in &result.values {
        assert!(v.is_finite(), "dB 值应为有限数");
    }
}

#[test]
fn test_frequencies_correct() {
    let n = 8;
    let fs = 1000.0;
    let analyzer = SpectrumAnalyzer::new(n, WindowType::Rect, SpectrumOutput::Magnitude, fs);
    // 频率应为 [0, 125, 250, 375, 500] (n/2+1 = 5 个)
    assert_eq!(analyzer.frequencies.len(), 5);
    assert!((analyzer.frequencies[0] - 0.0).abs() < 1e-6);
    assert!((analyzer.frequencies[1] - 125.0).abs() < 1e-3);
    assert!((analyzer.frequencies[4] - 500.0).abs() < 1e-3);
}

#[test]
fn test_reset() {
    let mut analyzer =
        SpectrumAnalyzer::new(8, WindowType::Rect, SpectrumOutput::Magnitude, 1000.0);
    for i in 0..8 {
        analyzer.push(i as f32);
    }
    assert!(analyzer.is_ready());
    analyzer.reset();
    assert!(!analyzer.is_ready());
}
