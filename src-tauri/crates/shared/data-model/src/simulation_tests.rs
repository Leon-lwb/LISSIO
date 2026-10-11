use super::*;

#[test]
fn samples_per_message_is_ceilinged_and_never_zero() {
    // 100 采样/s × 5ms = 0.5 → 向上取整为 1, 不允许出现 0
    assert_eq!(samples_per_message(100.0), 1);
    // 300 采样/s × 5ms = 1.5 → 2 (整数截断会得到 1, 使丢包换算少算一半)
    assert_eq!(samples_per_message(300.0), 2);
    assert_eq!(samples_per_message(1000.0), 5);
    assert_eq!(samples_per_message(0.0), 1);
    assert_eq!(samples_per_message(-5.0), 1);
}

#[test]
fn high_rate_message_size_stays_within_f32_resolution() {
    assert_eq!(samples_per_message(rate_as_f32(MAX_SAMPLE_RATE)), 25_000);
}

#[test]
fn rate_rejects_zero_and_over_cap() {
    assert_eq!(
        SimulationRate::new(0, MAX_SAMPLE_RATE),
        Err(RateRangeError {
            value: 0,
            max: MAX_SAMPLE_RATE
        })
    );
    assert_eq!(
        SimulationRate::new(MAX_FRAME_RATE + 1, MAX_FRAME_RATE),
        Err(RateRangeError {
            value: MAX_FRAME_RATE + 1,
            max: MAX_FRAME_RATE
        })
    );
    // 边界两端都是合法值
    assert_eq!(
        SimulationRate::new(1, MAX_FRAME_RATE).map(SimulationRate::get),
        Ok(1)
    );
    assert_eq!(
        SimulationRate::new(MAX_FRAME_RATE, MAX_FRAME_RATE).map(SimulationRate::get),
        Ok(MAX_FRAME_RATE)
    );
}

#[test]
fn frame_cap_is_an_order_of_magnitude_below_the_sample_cap() {
    // 量纲不同的两个上限不得退化为同一个值 — 否则「帧率误填波特率」失去拦截。
    // 用 const 块把这条关系变成**编译期**断言, 而不是运行期才验证的巧合。
    const { assert!(MAX_FRAME_RATE < MAX_SAMPLE_RATE) };
    assert!(SimulationRate::new(500_000, MAX_FRAME_RATE).is_err());
    assert!(SimulationRate::new(500_000, MAX_SAMPLE_RATE).is_ok());
}

#[test]
fn message_rate_is_about_two_hundred_for_rates_at_or_above_the_floor() {
    for rate in [200, 1_000, 50_000, MAX_SAMPLE_RATE] {
        let typed = SimulationRate::new(rate, MAX_SAMPLE_RATE).expect("rate in range");
        let actual = typed.messages_per_second();
        assert!(
            (actual - 200.0).abs() < 5.0,
            "rate {rate} 的消息条率应约为 200/s, 实际 {actual}"
        );
        assert_eq!(
            typed.samples_per_message(),
            samples_per_message(rate_as_f32(rate))
        );
    }
}

#[test]
fn below_the_floor_each_message_carries_a_single_sample() {
    // 100 采样/秒 × 5ms = 0.5 < 1 → 每条消息 1 个采样, 条率退化为速率本身
    let typed = SimulationRate::new(100, MAX_SAMPLE_RATE).expect("rate in range");
    assert_eq!(typed.samples_per_message(), 1);
    assert!((typed.messages_per_second() - 100.0).abs() < f64::EPSILON);
}

#[test]
fn message_intervals_accumulate_to_real_time() {
    let typed = SimulationRate::new(300, MAX_SAMPLE_RATE).expect("rate in range");
    let total: Duration = typed.message_interval() * 200;
    // 200 条消息 × 2 采样 / 300 采样每秒 = 4/3 s。容差取 1µs: Duration 是
    // 纳秒分辨率的整数类型, 逐条累加必然带纳秒级舍入。
    assert!((total.as_secs_f64() - 4.0 / 3.0).abs() < 1e-6);
}
