//! HEX 字符串解析工具 — 全工作区唯一实现。

/// 解析 HEX 字符串为字节序列
///
/// 输入格式: `"AA BB"` / `"AABB"` / `"aa bb"` / `"0xAA,0xBB"` 均可;
/// 空白、逗号与 `0x`/`0X` 前缀会被忽略。
///
/// # Errors
/// 有效字符数为奇数或含非法十六进制字符时返回错误说明。
pub fn parse_hex(input: &str) -> Result<Vec<u8>, String> {
    // 先去掉所有 "0x" / "0X" 前缀, 再过滤空白与逗号
    let no_prefix = input.replace("0x", "").replace("0X", "");
    let clean: String = no_prefix
        .chars()
        .filter(|c| !c.is_whitespace() && *c != ',')
        .collect();
    if clean.is_empty() {
        return Ok(Vec::new());
    }
    if !clean.len().is_multiple_of(2) {
        return Err(format!(
            "HEX 长度必须为偶数 (每字节 2 个十六进制字符), 当前长度 {}",
            clean.len()
        ));
    }
    let chars: Vec<char> = clean.chars().collect();
    let mut bytes = Vec::with_capacity(chars.len() / 2);
    for i in (0..chars.len()).step_by(2) {
        let pair: String = chars[i..i + 2].iter().collect();
        let byte = u8::from_str_radix(&pair, 16).map_err(|_| format!("无效的 HEX 字节: {pair}"))?;
        bytes.push(byte);
    }
    Ok(bytes)
}

/// 宽松变体 — 解析失败返回空 `Vec`
///
/// 供"输入即用户草稿"的解析路径使用 (帧解析器按空字节处理非法输入)。
#[must_use]
pub fn parse_hex_lossy(input: &str) -> Vec<u8> {
    parse_hex(input).unwrap_or_default()
}
