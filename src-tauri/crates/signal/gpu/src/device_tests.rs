use super::*;

/// 无 GPU 环境 (CI) 下 acquire 应返回 None 而非 panic
#[test]
fn returns_none_gracefully_without_adapter() {
    // 不断言具体结果 (本地有 GPU / CI 无 GPU), 只验证不 panic、结果可重复
    let first = GpuContext::acquire();
    let second = GpuContext::acquire();
    assert_eq!(first.is_some(), second.is_some());
}
