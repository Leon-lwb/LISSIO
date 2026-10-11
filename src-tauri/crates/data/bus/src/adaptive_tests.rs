use super::*;

/// 构造已建立 ewma 速率的控制器。回拨 last_observed 使 elapsed 恒为 dt,
/// ewma 完全确定 (不依赖测试机的真实调度时序)。
fn controller_with_ewma(rate_bps: u64) -> AdaptiveController {
    let mut controller = AdaptiveController::default();
    let input_per_observe = usize::try_from(rate_bps / 100).unwrap_or(usize::MAX);
    for _ in 0..8 {
        observe_dt(&mut controller, 10, 0.05, 1, 2, input_per_observe);
    }
    controller
}

/// 以确定的观察间隔驱动一次 observe
fn observe_dt(
    controller: &mut AdaptiveController,
    dt_ms: u64,
    queue_fill: f64,
    queue_age_ms: u64,
    service_ms: u64,
    input_bytes: usize,
) {
    let now = std::time::Instant::now();
    controller.last_observed = now
        .checked_sub(Duration::from_millis(dt_ms))
        .expect("时钟早于当前时刻至少 dt, 系统时钟异常");
    controller.observe_at(
        now,
        queue_fill,
        Duration::from_millis(queue_age_ms),
        Duration::from_millis(service_ms),
        input_bytes,
        RuntimeLimits::default(),
    );
}

#[test]
fn deep_queue_grows_batch_despite_slow_service() {
    // 旧策略回归: 服务时间 46ms (含数值平面评估) + 深积压时,
    // 批必须增长以摊薄固定开销, 而不是被「>16ms 减半」压到 16KB 下限
    // 不变量以控制器实际 ewma 为基准 (断言与测试机的调度时序无关):
    // 深队列下批次必须 ≥ 到达下限 (ewma × service_time), 否则队列单调增长。
    let mut controller = controller_with_ewma(512 * 1024);
    for _ in 0..12 {
        observe_dt(&mut controller, 10, 0.9, 40, 46, 512 * 1024 / 100);
    }
    let floor = controller.ewma_input_bytes_per_sec() * 46 / 1000;
    let floor = usize::try_from(floor.max(16 * 1024)).unwrap_or(usize::MAX);
    assert!(
        controller.target_batch_bytes() >= floor,
        "深队列下批 {} 低于到达下限 {floor}",
        controller.target_batch_bytes()
    );
}

#[test]
fn slow_service_never_shrinks_batch_below_arrival_floor() {
    // 到达不变量: 持续 46ms 服务 + 512KB/s 输入时, 批不得小于服务期内到达量
    // (否则队列单调增长, 必然 Lagged)
    let mut controller = controller_with_ewma(512 * 1024);
    for _ in 0..12 {
        observe_dt(&mut controller, 10, 0.05, 1, 46, 512 * 1024 / 100);
    }
    // ewma 实际收敛值 = input_per_observe × 100 (5242 字节 / 10ms)
    let floor = (512 * 1024 / 100) * 100 * 46 / 1000;
    assert!(
        controller.target_batch_bytes() >= floor,
        "批 {} 低于到达下限 {floor}",
        controller.target_batch_bytes()
    );
}

#[test]
fn shallow_queue_converges_to_latency_target() {
    // 浅队列回归延迟优先: 目标收敛到 ewma × 8ms 量级 (受 16KB 下限约束)
    let mut controller = controller_with_ewma(512 * 1024);
    // 先人为抬高到过载水位
    for _ in 0..4 {
        observe_dt(&mut controller, 10, 0.9, 40, 46, 512 * 1024 / 100);
    }
    for _ in 0..24 {
        observe_dt(&mut controller, 10, 0.05, 1, 2, 512 * 1024 / 100);
    }
    let latency_target = (512 * 1024 * 8 / 1000).clamp(16 * 1024, 1024 * 1024);
    assert!(
        controller.target_batch_bytes() <= latency_target * 2,
        "浅队列应收敛到延迟目标附近: {} (目标 {latency_target})",
        controller.target_batch_bytes()
    );
}
