//! 校验和 — 算法表由 `schema_types::checksum` 唯一拥有, 此处只保留 schema 侧
//! 调用签名 (可失败的 `compute_checksum`), 不再复制 CRC/SUM/XOR/LRC 实现。

use schema_types::checksum::ChecksumAlgorithm;

pub use schema_types::checksum::ChecksumAlgorithm as ChecksumKind;

/// 计算校验和 — `Custom` 需要脚本, 后端不支持求值
pub fn compute_checksum(kind: ChecksumKind, data: &[u8]) -> Result<Vec<u8>, String> {
    if kind == ChecksumAlgorithm::Custom {
        return Err("Custom checksum script is unsupported on backend".into());
    }
    Ok(kind.compute(data, None))
}

#[cfg(test)]
#[path = "frame_checksum_tests.rs"]
mod tests;
