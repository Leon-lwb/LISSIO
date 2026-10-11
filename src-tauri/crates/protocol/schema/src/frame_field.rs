//! 命令块字段类型 (`FieldType`) + 单字段打包 (`pack_field`)
//!
//! 字节序与小端约定与前端 `commandParser.ts` 的 `packField` 完全一致;
//! 任何偏移视为契约漂移。

use schema_types::decoder_block::FieldType;

/// 解析十进制 / `0xHEX` / `0bBIN` / 浮点数字字符串
///
/// 浮点输入按向零截断语义取整 (f64→i64 饱和转换); 越界值由下方范围检查统一拒绝
#[allow(clippy::cast_possible_truncation)]
fn parse_number_str(value: &str, min: i64, max: i64) -> Result<i64, String> {
    let trimmed = value.trim();
    let n: i64 = if let Some(rest) = trimmed
        .strip_prefix("0x")
        .or_else(|| trimmed.strip_prefix("0X"))
    {
        i64::from_str_radix(rest, 16).map_err(|e| format!("无效的 HEX 数字 `{value}`: {e}"))?
    } else if let Some(rest) = trimmed
        .strip_prefix("0b")
        .or_else(|| trimmed.strip_prefix("0B"))
    {
        i64::from_str_radix(rest, 2).map_err(|e| format!("无效的 BIN 数字 `{value}`: {e}"))?
    } else if trimmed.contains('.') {
        let f: f64 = trimmed
            .parse()
            .map_err(|e| format!("无效的浮点数字 `{value}`: {e}"))?;
        if !f.is_finite() {
            return Err(format!("无效的数字 `{value}`"));
        }
        f as i64
    } else {
        trimmed
            .parse::<i64>()
            .map_err(|e| format!("无效的数字 `{value}`: {e}"))?
    };
    if n < min || n > max {
        return Err(format!("数值 {n} 超出范围 [{min}, {max}]"));
    }
    Ok(n)
}

/// 解析并校验后转换为目标整型 — 范围检查保证 `try_from` 不失败
fn parse_in_range<T: TryFrom<i64>>(value: &str, min: i64, max: i64) -> Result<T, String> {
    let n = parse_number_str(value, min, max)?;
    T::try_from(n).map_err(|_| format!("数值 {n} 超出目标类型范围"))
}

/// HEX 字符串解析 (与前端 parseHex 一致)
/// 接受 `AA 01 02 BB` / `AA0102BB` / `AA,01,02` / `0xAA 0x01` 等格式
///
/// 实现由 [`schema_types::hex::parse_hex`] 唯一拥有。
///
/// # Errors
/// 有效字符数为奇数或含非法十六进制字符时返回错误说明。
pub fn parse_hex(input: &str) -> Result<Vec<u8>, String> {
    schema_types::hex::parse_hex(input)
}

/// 单字段打包 — 与前端 `packField` 逐字节对齐 (同 `FieldType` 同字节序)
pub fn pack_field(field_type: FieldType, value: &str) -> Result<Vec<u8>, String> {
    match field_type {
        FieldType::UInt8 => {
            let n: u8 = parse_in_range(value, 0, 0xff)?;
            Ok(vec![n])
        }
        FieldType::Int8 => {
            let n: i8 = parse_in_range(value, -0x80, 0x7f)?;
            Ok(vec![n.cast_unsigned()])
        }
        FieldType::UInt16LE | FieldType::UInt16BE => {
            let n: u16 = parse_in_range(value, 0, 0xffff)?;
            if matches!(field_type, FieldType::UInt16LE) {
                Ok(n.to_le_bytes().to_vec())
            } else {
                Ok(n.to_be_bytes().to_vec())
            }
        }
        FieldType::Int16LE | FieldType::Int16BE => {
            let n: i16 = parse_in_range(value, -0x8000, 0x7fff)?;
            if matches!(field_type, FieldType::Int16LE) {
                Ok(n.to_le_bytes().to_vec())
            } else {
                Ok(n.to_be_bytes().to_vec())
            }
        }
        FieldType::UInt32LE | FieldType::UInt32BE => {
            let n: u32 = parse_in_range(value, 0, 0xffff_ffff)?;
            if matches!(field_type, FieldType::UInt32LE) {
                Ok(n.to_le_bytes().to_vec())
            } else {
                Ok(n.to_be_bytes().to_vec())
            }
        }
        FieldType::Int32LE | FieldType::Int32BE => {
            let n: i32 = parse_in_range(value, -0x8000_0000, 0x7fff_ffff)?;
            if matches!(field_type, FieldType::Int32LE) {
                Ok(n.to_le_bytes().to_vec())
            } else {
                Ok(n.to_be_bytes().to_vec())
            }
        }
        FieldType::Float32LE | FieldType::Float32BE => {
            let f: f32 = value
                .trim()
                .parse()
                .map_err(|e| format!("无效的浮点数 `{value}`: {e}"))?;
            if !f.is_finite() {
                return Err(format!("无效的浮点数 `{value}`"));
            }
            if matches!(field_type, FieldType::Float32LE) {
                Ok(f.to_le_bytes().to_vec())
            } else {
                Ok(f.to_be_bytes().to_vec())
            }
        }
        FieldType::Bytes => parse_hex(value),
    }
}

/// 拼接多个字节块 (与前端 `concatChunks` 同语义)
pub fn concat_chunks(chunks: &[Vec<u8>]) -> Vec<u8> {
    let total: usize = chunks.iter().map(std::vec::Vec::len).sum();
    let mut out = Vec::with_capacity(total);
    for c in chunks {
        out.extend_from_slice(c);
    }
    out
}

#[cfg(test)]
#[path = "frame_field_tests.rs"]
mod tests;
