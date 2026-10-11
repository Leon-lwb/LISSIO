use super::*;
use crate::types::adapter_kind_from_str;

fn config(adapter: &str, base_url: &str) -> AiProviderConfig {
    AiProviderConfig {
        adapter: adapter.to_string(),
        base_url: base_url.to_string(),
        api_key: "sk-test".to_string(),
        model: "openai/gpt-4o-mini".to_string(),
        temperature: None,
        max_tokens: None,
    }
}

/// orcarouter 映射到 OpenAI 协议;空 base_url 校验通过 (官方端点兜底)。
#[test]
fn orcarouter_maps_to_openai_and_validates_with_empty_base_url() {
    assert!(matches!(
        adapter_kind_from_str("orcarouter").unwrap(),
        genai::adapter::AdapterKind::OpenAI
    ));
    validate_config(&config("orcarouter", "")).expect("orcarouter 空 base_url 应合法");
}

/// genai 按 RFC 3986 join 拼接服务路径: 端点末段无 `/` 时会被相对路径
/// 替换 (`…/v1` + `chat/completions` → `…/chat/completions`,`/v1` 丢失)。
/// 端点必须归一化为末尾带 `/` — 曾因缺斜杠导致所有请求 404 落入网关首页。
#[test]
fn base_url_normalized_to_trailing_slash() {
    assert!(ORCAROUTER_ENDPOINT.ends_with('/'));
    assert_eq!(
        normalize_base_url("https://api.orcarouter.ai/v1"),
        "https://api.orcarouter.ai/v1/"
    );
    assert_eq!(
        normalize_base_url("https://api.example.com/v1/"),
        "https://api.example.com/v1/"
    );
    assert_eq!(
        normalize_base_url("https://api.example.com"),
        "https://api.example.com/"
    );
    // 带 query 的端点不适用 join 语义, 原样保留
    assert_eq!(
        normalize_base_url("https://api.example.com/v1?api-version=1"),
        "https://api.example.com/v1?api-version=1"
    );
}

/// openai_compatible 仍必须提供 base_url;未知适配器仍报错。
#[test]
fn compatible_requires_base_url_and_unknown_adapter_fails() {
    assert!(validate_config(&config("openai_compatible", "")).is_err());
    assert!(validate_config(&config("nope", "")).is_err());
}
