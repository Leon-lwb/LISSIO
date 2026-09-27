//! 技能文档 — 能力节点自带的使用文档 (zh/en 双语, 编译期嵌入)。
//!
//! 文档挂在拥有该能力的节点下 (如协议文档挂 transport 节点、节点参考挂 graph
//! 节点);系统提示词只放索引 (省 token),`read_skill` 工具按需读全文。

use std::fmt;

/// 单篇技能文档 (双语内容按 [`Lang`] 取)。
pub struct SkillDoc {
    /// 稳定 id (read_skill 参数 / 索引键)。
    pub id: &'static str,
    /// zh 标题 (索引用)。
    pub title_zh: &'static str,
    /// en 标题。
    pub title_en: &'static str,
    /// zh 一句话用途。
    pub summary_zh: &'static str,
    /// en 一句话用途。
    pub summary_en: &'static str,
    /// zh 全文。
    pub md_zh: &'static str,
    /// en 全文。
    pub md_en: &'static str,
}

impl SkillDoc {
    /// 按语言取标题。
    #[must_use]
    pub const fn title(&self, lang: Lang) -> &'static str {
        match lang {
            Lang::Zh => self.title_zh,
            Lang::En => self.title_en,
        }
    }

    /// 按语言取一句话用途。
    #[must_use]
    pub const fn summary(&self, lang: Lang) -> &'static str {
        match lang {
            Lang::Zh => self.summary_zh,
            Lang::En => self.summary_en,
        }
    }

    /// 按语言取全文。
    #[must_use]
    pub const fn md(&self, lang: Lang) -> &'static str {
        match lang {
            Lang::Zh => self.md_zh,
            Lang::En => self.md_en,
        }
    }
}

/// 界面语言 (前端 appStore.lang 同构)。
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Lang {
    /// 中文。
    Zh,
    /// 英文。
    En,
}

impl Lang {
    /// 解析语言字符串,未知值回退中文。
    pub const fn parse(raw: &str) -> Self {
        if raw.eq_ignore_ascii_case("en") {
            Self::En
        } else {
            Self::Zh
        }
    }
}

impl fmt::Display for Lang {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(match self {
            Self::Zh => "zh",
            Self::En => "en",
        })
    }
}

#[cfg(test)]
mod tests {
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
}
