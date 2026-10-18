use super::random_hex;

/// 输出长度 = `rounds * 16` 个 hex 字符 (块数语义, 不是字节数)。
#[test]
fn length_matches_rounds_times_sixteen() {
    assert_eq!(random_hex(0).len(), 0);
    assert_eq!(random_hex(1).len(), 16);
    assert_eq!(random_hex(4).len(), 64);
}

/// 输出字符集必须是小写十六进制 — 令牌进入 HTTP 头与命令行参数。
#[test]
fn output_is_lowercase_hex() {
    let token = random_hex(8);
    assert_eq!(token.len(), 128);
    assert!(
        token
            .bytes()
            .all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte)),
        "非十六进制字符: {token}"
    );
}

/// 两次调用必须不同 (CSPRNG 每次重新取熵; 时间/进程播种的实现会碰撞)。
#[test]
fn two_calls_differ() {
    let first = random_hex(4);
    let second = random_hex(4);
    assert_ne!(first, second);
}
