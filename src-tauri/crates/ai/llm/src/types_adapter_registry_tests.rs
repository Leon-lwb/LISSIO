use super::*;

/// 目录与解析表单一来源: 每个目录 id 必须可解析; 解析表没有目录之外的 id。
#[test]
fn adapters_and_parser_share_one_registry() {
    for adapter in list_adapters() {
        assert!(
            adapter_kind_from_str(adapter.id).is_ok(),
            "目录 id {} 必须可解析",
            adapter.id
        );
        if adapter.requires_custom_url {
            assert!(
                adapter.default_base_url.is_empty(),
                "{} 声明必须自定义 URL, 却有默认端点",
                adapter.id
            );
        }
    }
    // openai_responses 曾只在解析侧可用 — 现在必须在目录中
    assert!(ADAPTERS.iter().any(|a| a.id == "openai_responses"));
}
