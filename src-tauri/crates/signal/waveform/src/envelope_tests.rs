use super::{column_of, envelope_minmax_cpu};

/// 列映射: 单调不减、范围合法、0.5 偏移近似等宽
#[test]
fn column_mapping_is_monotonic_and_valid() {
    for (n, columns) in [
        (1000usize, 64usize),
        (17, 64),
        (64, 17),
        (1, 8),
        (100_003, 2000),
    ] {
        let mut prev = 0;
        for i in 0..n {
            let col = column_of(i, n, columns);
            assert!(col < columns, "n={n} cols={columns} i={i} 越界");
            assert!(col >= prev, "n={n} cols={columns} i={i} 非单调");
            prev = col;
        }
    }
    // n=1, columns=8: scale=8 → col(0) = floor(0.5 * 8) = 4
    assert_eq!(column_of(0, 1, 8), 4);
}

/// CPU 参考: 空输入 / 全 NaN / 列数大于样本数
#[test]
#[allow(clippy::float_cmp)] // 断言精确值 (手算常量, 非运算结果)
fn cpu_reference_edge_cases() {
    let e = envelope_minmax_cpu(&[], 4);
    assert!(e.min.iter().all(|v| *v == f32::INFINITY));
    assert!(e.count.iter().all(|&c| c == 0));

    let e = envelope_minmax_cpu(&[f32::NAN; 3], 2);
    assert!(e.count.iter().all(|&c| c == 0));

    let e = envelope_minmax_cpu(&[1.0, 2.0, f32::NAN, -3.0], 8);
    let total: u32 = e.count.iter().sum();
    assert_eq!(total, 3, "NaN 不计数");
    assert!(e.min.contains(&1.0));
}

/// CPU 参考: 手工可验小案例 (4 点 → 2 列, 精确列归属)
#[test]
#[allow(clippy::float_cmp)] // 断言精确值 (手算常量, 非运算结果)
fn cpu_reference_hand_computed() {
    // n=4, columns=2: scale = 0.5; col(i) = floor((i+0.5)/2)
    // i=0 → floor(0.25)=0; i=1 → floor(0.75)=0; i=2 → floor(1.25)=1; i=3 → floor(1.75)=1
    let e = envelope_minmax_cpu(&[5.0, 1.0, 7.0, 3.0], 2);
    assert_eq!(e.min, vec![1.0, 3.0]);
    assert_eq!(e.max, vec![5.0, 7.0]);
    assert_eq!(e.count, vec![2, 2]);
}

/// ±0 归一: min/max 里 -0 与 +0 等同
#[test]
fn zero_normalization() {
    let e = envelope_minmax_cpu(&[-0.0, 0.0], 1);
    assert_eq!(e.min[0].to_bits(), 0.0f32.to_bits());
    assert_eq!(e.max[0].to_bits(), 0.0f32.to_bits());
    assert_eq!(e.count[0], 2);
}
