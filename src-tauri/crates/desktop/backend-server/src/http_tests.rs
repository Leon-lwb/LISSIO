use super::{WS_TOKEN_PREFIX, constant_time_eq, subprotocol_token};
use axum::http::{HeaderMap, HeaderValue, header};

#[test]
fn token_comparison_is_exact() {
    assert!(constant_time_eq("abc", "abc"));
    assert!(!constant_time_eq("abc", "abd"));
    assert!(!constant_time_eq("abc", "abcd"));
    assert!(!constant_time_eq("", "abc"));
}

#[test]
fn subprotocol_carries_bearer_token() {
    let mut headers = HeaderMap::new();
    let value = format!("lissio.v1, {WS_TOKEN_PREFIX}secret-token");
    headers.insert(
        header::SEC_WEBSOCKET_PROTOCOL,
        HeaderValue::from_str(&value).expect("头部应合法"),
    );
    assert_eq!(subprotocol_token(&headers), Some("secret-token"));
}

#[test]
fn missing_subprotocol_yields_no_token() {
    assert_eq!(subprotocol_token(&HeaderMap::new()), None);
}

/// 下载文件名去掉内部 token 前缀, 且不会把普通连字符名误当前缀。
#[test]
fn download_file_name_drops_internal_token_prefix() {
    let staged =
        std::path::Path::new("/tmp/downloads/0123456789abcdef0123456789abcdef-waveform.csv");
    assert_eq!(super::download_file_name(staged), "waveform.csv");
    let plain = std::path::Path::new("/tmp/downloads/my-export.csv");
    assert_eq!(super::download_file_name(plain), "my-export.csv");
}
