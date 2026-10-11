use super::{ServerConfig, generate_token};
use std::net::{IpAddr, Ipv4Addr};

#[test]
fn token_is_long_and_distinct() {
    let first = generate_token();
    let second = generate_token();
    assert_eq!(first.len(), 64);
    assert_ne!(first, second, "每次生成的令牌必须不同");
}

#[test]
fn explicit_token_wins_and_loopback_is_default() {
    let config = ServerConfig::resolve(
        None,
        Some(0),
        Some("  explicit-token  ".to_string()),
        None,
        None,
        Vec::new(),
        None,
        false,
        None,
    )
    .expect("配置解析应成功");
    assert_eq!(config.token, "explicit-token");
    assert_eq!(config.bind, IpAddr::V4(Ipv4Addr::LOCALHOST));
    assert!(config.is_loopback());
}
