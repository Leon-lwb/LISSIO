use super::*;

fn doc() -> SkillDoc {
    SkillDoc {
        id: "demo",
        title_zh: "演示",
        title_en: "Demo",
        summary_zh: "中文摘要",
        summary_en: "English summary",
        md_zh: "中文正文",
        md_en: "English body",
    }
}

/// 按语言取标题/摘要/全文。
#[test]
fn localized_accessors() {
    let d = doc();
    assert_eq!(d.title(Lang::Zh), "演示");
    assert_eq!(d.summary(Lang::En), "English summary");
    assert_eq!(d.md(Lang::Zh), "中文正文");
}

/// 语言解析:未知回退中文。
#[test]
fn lang_parse_fallback() {
    assert_eq!(Lang::parse("en"), Lang::En);
    assert_eq!(Lang::parse("EN"), Lang::En);
    assert_eq!(Lang::parse("zh"), Lang::Zh);
    assert_eq!(Lang::parse("fr"), Lang::Zh);
    assert_eq!(Lang::Zh.to_string(), "zh");
}
