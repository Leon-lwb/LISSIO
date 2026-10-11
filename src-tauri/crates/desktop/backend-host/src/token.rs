//! 令牌生成 — 全工作区唯一实现 (导出下载 token 与 Web 出口访问令牌同法)。

/// 由操作系统熵源播种的哈希输出拼装 `rounds * 16` 位十六进制串。
///
/// `RandomState` 每个实例使用独立的随机密钥 (来自操作系统), 因此反复取样可得
/// 不可预测的十六进制串。它不是密码学级 CSPRNG: 需要长期暴露到局域网时, 应通过
/// `LISSIO_TOKEN` 显式提供强令牌。
pub fn random_hex(rounds: u128) -> String {
    use std::collections::hash_map::RandomState;
    use std::fmt::Write as _;
    use std::hash::{BuildHasher, Hasher};
    use std::time::{SystemTime, UNIX_EPOCH};

    let nanos = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_or(0, |duration| duration.as_nanos());
    let mut token = String::with_capacity(rounds as usize * 16);
    for round in 0_u128..rounds {
        let mut hasher = RandomState::new().build_hasher();
        hasher.write_u128(nanos);
        hasher.write_u128(round);
        hasher.write_u32(std::process::id());
        // 写入 String 不会失败 (fmt::Write for String 恒为 Ok)
        let _ = write!(token, "{:016x}", hasher.finish());
    }
    token
}
