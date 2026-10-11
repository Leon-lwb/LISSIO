use super::*;

#[test]
fn test_constants_match_pipeline_config_default() {
    // 模块常量与 PipelineConfig::default() 保持同步 (常量是默认值文档来源)
    let d = PipelineConfig::default();
    assert_eq!(d.max_workers, MAX_FEED_WORKERS);
}

#[test]
fn test_workers_needed_idle() {
    let cfg = PipelineConfig::default();
    // 无积压 → 单 worker
    assert_eq!(workers_needed(0, 0, &cfg), 1);
    assert_eq!(workers_needed(7, 0, &cfg), 1);
    // 字节数大但无积压 → 单 worker
    assert_eq!(workers_needed(0, 64 * 1024, &cfg), 1);
    // 积压高但批次小 → 单 worker
    assert_eq!(workers_needed(255, 1024, &cfg), 1);
}

#[test]
fn test_workers_needed_scaling() {
    let cfg = PipelineConfig::default();
    let big = 256 * 1024;
    // 每 8 批积压升一级
    assert_eq!(workers_needed(8, big, &cfg), 2);
    assert_eq!(workers_needed(15, big, &cfg), 2);
    assert_eq!(workers_needed(16, big, &cfg), 3);
    assert_eq!(workers_needed(24, big, &cfg), 4);
}

#[test]
fn test_workers_needed_clamp() {
    let cfg = PipelineConfig::default();
    let big = 1024 * 1024;
    let max_workers = worker_limit(&cfg);
    // 上限 clamp 到 max_workers
    assert_eq!(workers_needed(255, big, &cfg), max_workers);
    assert_eq!(workers_needed(1000, big, &cfg), max_workers);
    // 字节数下限: 32KB 才够 2 worker
    assert_eq!(workers_needed(8, MIN_WORKER_BYTES - 1, &cfg), 1);
    assert_eq!(workers_needed(8, MIN_WORKER_BYTES, &cfg), 2);
}

#[test]
fn test_workers_needed_custom_config() {
    // 自定义安全上限
    let cfg = PipelineConfig {
        max_workers: 2,
        ..PipelineConfig::default()
    };
    // 8 批积压 + 32KB → 2 worker
    assert_eq!(workers_needed(8, 32 * 1024, &cfg), 2);
    // 积压再高也被 clamp 到 2
    assert_eq!(workers_needed(255, 1024 * 1024, &cfg), 2);
    // 3 批积压 (< 4) → 单 worker
    assert_eq!(workers_needed(7, 1024 * 1024, &cfg), 1);
}
