use super::*;

#[test]
fn test_rect_window_no_change() {
    let mut data = vec![1.0, 2.0, 3.0, 4.0];
    apply_window(&WindowType::Rect, &mut data);
    assert_eq!(data, vec![1.0, 2.0, 3.0, 4.0]);
}

#[test]
fn test_hann_window_endpoints_zero() {
    let mut data = vec![1.0; 100];
    apply_window(&WindowType::Hann, &mut data);
    // 端点应接近 0
    assert!(data[0].abs() < 0.01);
    assert!(data[99].abs() < 0.01);
    // 中间应接近 1
    assert!((data[50] - 1.0).abs() < 0.01);
}

#[test]
fn test_hamming_endpoints_not_zero() {
    let mut data = vec![1.0; 100];
    apply_window(&WindowType::Hamming, &mut data);
    // Hamming 端点不为 0 (约 0.08)
    assert!(data[0] > 0.05);
    assert!(data[0] < 0.12);
}

#[test]
fn test_blackman_endpoints_near_zero() {
    let mut data = vec![1.0; 100];
    apply_window(&WindowType::Blackman, &mut data);
    // Blackman 端点应非常接近 0
    assert!(data[0].abs() < 0.001);
}

#[test]
fn test_coherent_gain() {
    // Rect 增益 = 1
    assert!((WindowType::Rect.coherent_gain(100) - 1.0).abs() < 1e-6);
    // Hann 增益 = 0.5
    assert!((WindowType::Hann.coherent_gain(100) - 0.5).abs() < 1e-3);
    // Hamming 增益 = 0.54
    assert!((WindowType::Hamming.coherent_gain(100) - 0.54).abs() < 1e-3);
    // Blackman 增益 = 0.42
    assert!((WindowType::Blackman.coherent_gain(100) - 0.42).abs() < 1e-3);
}

#[test]
fn test_window_length_one() {
    let mut data = vec![5.0];
    apply_window(&WindowType::Hann, &mut data);
    assert!((data[0] - 5.0).abs() < 1e-6); // 长度 1 时返回 1.0 系数
}

#[test]
fn test_window_empty() {
    let mut data: Vec<f32> = vec![];
    apply_window(&WindowType::Hann, &mut data);
    assert!(data.is_empty());
}
