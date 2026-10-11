use super::*;

fn approx(actual: f64, expected: f64, what: &str) {
    assert!(
        (actual - expected).abs() < 1e-9,
        "{what}: actual={actual}, expected={expected}"
    );
}

#[test]
fn snap_up_1_2_5_rounds_to_next_step() {
    approx(snap_up_1_2_5(0.4), 0.5, "0.4→0.5");
    approx(snap_up_1_2_5(0.2), 0.2, "档内不动");
    approx(snap_up_1_2_5(0.201), 0.5, "0.201→0.5");
    approx(snap_up_1_2_5(0.023), 0.05, "0.023→0.05");
    approx(snap_up_1_2_5(7_000.0), 10_000.0, "7000→10k");
    approx(snap_up_1_2_5(2.5e-7), 5e-7, "小信号表外档");
    approx(snap_up_1_2_5(0.0), 1.0, "非法输入回退 1");
    approx(snap_up_1_2_5(f64::NAN), 1.0, "NaN 回退 1");
}

#[test]
fn one_hz_sine_shows_two_periods() {
    // 1Hz 正弦 (Vpp 2V): 窗口 = 2×1s = 2s → 时基 0.2s/div (表内直取)
    let fits = vec![ChannelFit {
        vmin: -1.0,
        vmax: 1.0,
        vpp: 2.0,
        period_sec: Some(1.0),
    }];
    let s = suggest_autoset(&fits, false, &[1.0], 10.0);
    assert!(!s.clamped);
    approx(s.time_base_sec, 0.2, "时基 0.2s/div");
    approx(s.window_sec, 2.0, "窗口 2s");
    approx(s.requested_window_sec, 2.0, "需求窗口 2s");
    // V/div: 2 / (8×0.7) = 0.357 → 0.5
    approx(s.channels[0].v_per_div, 0.5, "V/div 0.5");
    approx(s.channels[0].position, 0.0, "居中");
    assert!(!s.shared_y_span_risk);
    approx(s.h_position, 0.0, "hPosition 归零");
    assert!(s.running);
}

#[test]
fn slow_period_beyond_table_is_clamped() {
    // 200s 周期 → 需求窗口 400s → 目标时基 40s/div > 5s/div 上限
    let fits = vec![ChannelFit {
        vmin: -1.0,
        vmax: 1.0,
        vpp: 2.0,
        period_sec: Some(200.0),
    }];
    let s = suggest_autoset(&fits, false, &[1.0], 10.0);
    assert!(s.clamped, "超出档位表应置钳位标志");
    approx(s.time_base_sec, 5.0, "钳到最大档");
    approx(s.requested_window_sec, 400.0, "需求窗口保留");
    approx(s.window_sec, 50.0, "实际窗口 50s");
}

#[test]
fn unmeasurable_period_falls_back_to_data_span() {
    let fits = vec![ChannelFit {
        vmin: 0.0,
        vmax: 3.3,
        vpp: 3.3,
        period_sec: None,
    }];
    let s = suggest_autoset(&fits, false, &[1.0], 8.0);
    assert!(!s.clamped);
    approx(s.requested_window_sec, 8.0, "回退到数据跨度");
    approx(s.time_base_sec, 1.0, "0.8 → 向上取 1s/div");
}

#[test]
fn flat_channel_keeps_current_v_per_div() {
    let fits = vec![ChannelFit {
        vmin: 2.4,
        vmax: 2.4,
        vpp: 0.0,
        period_sec: None,
    }];
    let s = suggest_autoset(&fits, false, &[0.05], 8.0);
    approx(s.channels[0].v_per_div, 0.05, "平直信号保持现值");
    approx(s.channels[0].position, 2.4, "居中到信号值");
}

#[test]
fn shared_y_uses_max_vpp_not_global_span() {
    // 大信号 5V + 小信号 50mV (同偏置): v_per_div 由 5V 决定, 小信号不被全局跨度压扁
    let fits = vec![
        ChannelFit {
            vmin: 0.0,
            vmax: 5.0,
            vpp: 5.0,
            period_sec: Some(1.0),
        },
        ChannelFit {
            vmin: 0.0,
            vmax: 0.05,
            vpp: 0.05,
            period_sec: Some(1.0),
        },
    ];
    let s = suggest_autoset(&fits, true, &[1.0, 1.0], 10.0);
    approx(s.channels[0].v_per_div, 1.0, "max Vpp → 1V/div");
    approx(s.channels[1].v_per_div, 1.0, "共用同一档");
    assert!(!s.shared_y_span_risk, "同偏置时无压扁风险");
    approx(s.channels[0].position, 2.5, "全局中点");

    // 偏置差异大: 小信号通道在远处 → 提示风险
    let offset = vec![
        ChannelFit {
            vmin: 0.0,
            vmax: 5.0,
            vpp: 5.0,
            period_sec: Some(1.0),
        },
        ChannelFit {
            vmin: 100.0,
            vmax: 100.05,
            vpp: 0.05,
            period_sec: Some(1.0),
        },
    ];
    let s2 = suggest_autoset(&offset, true, &[1.0, 1.0], 10.0);
    assert!(s2.shared_y_span_risk, "跨度和远超 V/div 应提示风险");
}

#[test]
fn slowest_channel_drives_time_base() {
    // 0.5Hz + 2Hz 混合: 由最慢 2s 周期决定 → 窗口 4s → 时基 0.5s/div
    let fits = vec![
        ChannelFit {
            vmin: -1.0,
            vmax: 1.0,
            vpp: 2.0,
            period_sec: Some(2.0),
        },
        ChannelFit {
            vmin: -1.0,
            vmax: 1.0,
            vpp: 2.0,
            period_sec: Some(0.5),
        },
    ];
    let s = suggest_autoset(&fits, false, &[1.0, 1.0], 10.0);
    approx(s.time_base_sec, 0.5, "0.4 → 0.5s/div");
}
