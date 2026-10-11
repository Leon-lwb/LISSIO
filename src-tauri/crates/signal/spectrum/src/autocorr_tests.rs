use super::*;

#[test]
fn sine_autocorrelation_peaks_at_period() {
    // 1kHz 正弦 @ 100kHz 采样: 周期 100 样本
    let n = 4096;
    let samples: Vec<f32> = (0..n)
        .map(|i| {
            #[allow(clippy::cast_precision_loss)]
            let t = i as f32 / 100_000.0;
            (std::f32::consts::TAU * 1_000.0 * t).sin()
        })
        .collect();
    let acf = normalized_autocorrelation(&samples, n / 2).expect("正弦有能量");
    assert!((acf[0] - 1.0).abs() < 1e-5);
    // 首个显著峰应落在周期 100 样本附近
    let peak = (2..acf.len() - 1)
        .find(|&k| acf[k] >= 0.35 && acf[k] > acf[k - 1] && acf[k] >= acf[k + 1])
        .expect("周期信号必有 ACF 峰");
    #[allow(clippy::cast_precision_loss)]
    let peak_f = peak as f64;
    assert!((peak_f - 100.0).abs() <= 2.0, "peak={peak}");
}

#[test]
fn dc_signal_returns_none() {
    let samples = vec![2.5_f32; 256];
    assert!(normalized_autocorrelation(&samples, 32).is_none());
}

#[test]
fn nan_samples_return_none() {
    let mut samples = vec![1.0_f32; 64];
    samples[10] = f32::NAN;
    assert!(normalized_autocorrelation(&samples, 8).is_none());
}
