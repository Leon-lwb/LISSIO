use super::*;

/// 无 GPU 时构造路径不 panic (仅覆盖纯逻辑分支; 缓冲创建需设备)
#[test]
fn error_type_formatting() {
    let e = GpuError::BufferOverflow {
        required: 1024,
        limit: 512,
    };
    assert!(e.to_string().contains("1024"));
}
