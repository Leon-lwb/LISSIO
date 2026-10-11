//! 适配器单次操作的失败形状与质量映射 — modbus/s7 共用。
//!
//! 两个适配器各自复制过同一结构体与同一 `error_quality` (只有 `domain`
//! 字符串不同); 这里持有唯一实现。

use points::{NativeStatus, PointQuality, quality_flags};

/// 单次操作失败 (传输 / 编码 / 协议异常)
#[derive(Clone, Debug)]
pub struct OperationError {
    pub code: String,
    pub detail: String,
    pub disconnect: bool,
}

impl OperationError {
    /// 构造失败 — `disconnect` 标记该失败是否意味着连接已断开
    #[must_use]
    pub fn new(code: &str, detail: &str, disconnect: bool) -> Self {
        Self {
            code: code.into(),
            detail: detail.into(),
            disconnect,
        }
    }
}

/// 操作失败 → 采集质量 — `domain` 由适配器传入 (`"modbus"` / `"s7"`)
#[must_use]
pub fn error_quality(error: OperationError, domain: &str) -> PointQuality {
    let flags = if error.disconnect {
        quality_flags::COMM_FAILURE
    } else {
        0
    };
    PointQuality::bad(
        flags,
        NativeStatus {
            domain: domain.into(),
            code: error.code,
            detail: Some(error.detail),
        },
    )
}
