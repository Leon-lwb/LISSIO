//! 令牌生成 — `backend-host` 侧唯一实现 (导出下载 token 与 Web 出口访问令牌同法)。

/// 由操作系统 CSPRNG 生成 `rounds` 个 8 字节随机块, 拼装为小写十六进制串。
///
/// 长度语义: `rounds` 是块数, 输出长度 = `rounds * 16` 个 hex 字符
/// (`rounds = 4` → 64 字符 = 256 位熵)。熵直接来自 [`getrandom`]
/// (操作系统 CSPRNG), 不是 `RandomState` 时间/进程播种的哈希输出。
///
/// # Panics
///
/// 操作系统熵源不可用时 panic — 令牌生成是安全边界, 宁可失败也不返回弱令牌。
pub fn random_hex(rounds: u128) -> String {
    use std::fmt::Write as _;

    /// 每个 round 消耗的熵字节数 — 8 字节 = 16 个 hex 字符。
    const BYTES_PER_ROUND: usize = 8;

    let mut token = String::new();
    for _ in 0..rounds {
        let mut bytes = [0_u8; BYTES_PER_ROUND];
        getrandom::fill(&mut bytes).expect("操作系统 CSPRNG 不可用, 无法生成安全令牌");
        for byte in bytes {
            // 写入 String 不会失败 (fmt::Write for String 恒为 Ok)
            let _ = write!(token, "{byte:02x}");
        }
    }
    token
}

#[cfg(test)]
#[path = "token_tests.rs"]
mod tests;
