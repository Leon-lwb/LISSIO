//! 系统提示词文件与运行期能力索引。
//!
//! 主提示词从设置目录的 Markdown 文件逐轮读取，用户编辑后无需重启。
//! 按独立开关附加内置工具约定/知识库索引与 Web 技能约定。

use std::fs::{self, OpenOptions};
use std::io::{self, Write as _};
use std::path::{Path, PathBuf};

use control_api::capabilities::registry::CapabilityRegistry;
use control_api::capabilities::skill::Lang;

/// 设置目录内供用户编辑的系统提示词文件。
pub const PROMPT_FILE_NAME: &str = "ai-system-prompt.md";

const DEFAULT_PROMPT: &str = include_str!("../default-system-prompt.md");
const TOOLS_START: &str = "<!-- LISSIO_BUILTIN_TOOLS_START -->";
const TOOLS_END: &str = "<!-- LISSIO_BUILTIN_TOOLS_END -->";
const TITLE_START: &str = "<!-- LISSIO_FIRST_TURN_TITLE_START -->";
const TITLE_END: &str = "<!-- LISSIO_FIRST_TURN_TITLE_END -->";

fn prompt_path(config_dir: &Path) -> PathBuf {
    config_dir.join(PROMPT_FILE_NAME)
}

fn path_error(action: &str, path: &Path, error: io::Error) -> io::Error {
    io::Error::new(
        error.kind(),
        format!(
            "{action} AI 系统提示词文件 {} 失败: {error}",
            path.display()
        ),
    )
}

fn section_valid(text: &str, start: &str, end: &str) -> bool {
    let start_count = text.matches(start).count();
    let end_count = text.matches(end).count();
    (start_count == 0 && end_count == 0)
        || (start_count == 1
            && end_count == 1
            && text
                .split_once(start)
                .and_then(|(_, after)| after.split_once(end))
                .is_some())
}

fn render_section(text: &str, start: &str, end: &str, include: bool) -> String {
    let Some((before, rest)) = text.split_once(start) else {
        return text.to_string();
    };
    let Some((section, after)) = rest.split_once(end) else {
        return text.to_string();
    };
    if include {
        format!("{before}{section}{after}")
    } else {
        format!("{before}{after}")
    }
}

/// 首次创建默认提示词；已存在的文件绝不覆盖。
///
/// # Errors
/// 设置目录或文件无法创建、默认内容无法写入。
pub fn ensure_prompt_file(config_dir: &Path) -> io::Result<()> {
    let path = prompt_path(config_dir);
    fs::create_dir_all(config_dir).map_err(|error| path_error("创建目录以保存", &path, error))?;
    let mut file = match OpenOptions::new().write(true).create_new(true).open(&path) {
        Ok(file) => file,
        Err(error) if error.kind() == io::ErrorKind::AlreadyExists => return Ok(()),
        Err(error) => return Err(path_error("创建", &path, error)),
    };
    if let Err(error) = file.write_all(DEFAULT_PROMPT.as_bytes()) {
        let _ = fs::remove_file(&path);
        return Err(path_error("写入", &path, error));
    }
    Ok(())
}

/// 每轮重新读取 Markdown 主提示词，不缓存用户编辑。
///
/// # Errors
/// 文件无法创建、读取，或不是有效 UTF-8。
pub fn load_prompt(config_dir: &Path) -> io::Result<String> {
    ensure_prompt_file(config_dir)?;
    let path = prompt_path(config_dir);
    let text = fs::read_to_string(&path).map_err(|error| path_error("读取", &path, error))?;
    if text.trim().is_empty() {
        return Err(io::Error::new(
            io::ErrorKind::InvalidData,
            format!("AI 系统提示词文件 {} 为空，请编辑后重试", path.display()),
        ));
    }
    if !section_valid(&text, TOOLS_START, TOOLS_END)
        || !section_valid(&text, TITLE_START, TITLE_END)
    {
        return Err(io::Error::new(
            io::ErrorKind::InvalidData,
            format!("AI 系统提示词文件 {} 的条件段标记不完整", path.display()),
        ));
    }
    Ok(text)
}

/// 组装文件主提示词；仅在内置工具可用时附加真实工具约定和知识库索引。
#[must_use]
pub fn compose_system_prompt(
    registry: &CapabilityRegistry,
    lang: Lang,
    file_prompt: &str,
    use_builtin_tools: bool,
    use_web_tools: bool,
    first_turn: bool,
) -> String {
    use std::fmt::Write as _;

    let out = render_section(file_prompt, TOOLS_START, TOOLS_END, use_builtin_tools);
    let mut out = render_section(&out, TITLE_START, TITLE_END, first_turn);
    if use_builtin_tools {
        if !out.ends_with('\n') {
            out.push('\n');
        }
        out.push_str(match lang {
            Lang::Zh => "\n可用知识库 (read_skill 按需读取全文):\n",
            Lang::En => "\nKnowledge base (read full text via read_skill as needed):\n",
        });
        for (_, skill) in registry.skills() {
            let _ = writeln!(
                out,
                "- {}: {} — {}",
                skill.id,
                skill.title(lang),
                skill.summary(lang)
            );
        }
    }
    if use_web_tools {
        if !out.ends_with('\n') {
            out.push('\n');
        }
        out.push_str(match lang {
            Lang::Zh => "\n## Web 技能\n\n`fetch_webpage` 可抓取公开 HTTP/HTTPS 网页并返回清洗后的主要正文 Markdown。仅在回答需要网页资料、在线文档或最新信息时调用；引用结果时保留来源 URL。工具不执行 JavaScript，也不代表已绕过登录或付费墙。\n",
            Lang::En => "\n## Web skill\n\n`fetch_webpage` fetches public HTTP/HTTPS pages and returns cleaned main-content Markdown. Use it only when the answer needs web material, online documentation, or current information, and retain the source URL in citations. It does not execute JavaScript or bypass authentication or paywalls.\n",
        });
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::test_support::unique_temp_path;

    /// 默认提示词里的稳定锚点。`default-system-prompt.md` 已由中文改为英文,
    /// 断言跟着文档走 — 这里只验证"基础提示词被完整带上", 不锁死具体措辞。
    const BASE_PROMPT_MARKER: &str = "Operating principles";

    #[test]
    fn creates_once_and_reads_edits_on_each_turn() {
        let dir = unique_temp_path("lissio-ai-prompt");
        let path = prompt_path(&dir);
        let initial = load_prompt(&dir).expect("首次创建并读取");
        assert!(initial.contains(BASE_PROMPT_MARKER));
        assert_eq!(fs::read_to_string(&path).unwrap(), initial);

        fs::write(&path, "自定义完整提示词\n").expect("用户编辑");
        ensure_prompt_file(&dir).expect("再次初始化不覆盖");
        assert_eq!(load_prompt(&dir).unwrap(), "自定义完整提示词\n");
        fs::remove_dir_all(dir).ok();
    }

    #[test]
    fn read_error_names_the_prompt_file() {
        let dir = unique_temp_path("lissio-ai-prompt");
        fs::create_dir_all(&dir).unwrap();
        fs::write(prompt_path(&dir), [0xff]).unwrap();
        let error = load_prompt(&dir).expect_err("非 UTF-8 文件应报错");
        assert!(error.to_string().contains(PROMPT_FILE_NAME));
        fs::remove_dir_all(dir).ok();
    }

    #[test]
    fn whitespace_only_prompt_is_visible_error() {
        let dir = unique_temp_path("lissio-ai-prompt");
        fs::create_dir_all(&dir).unwrap();
        fs::write(prompt_path(&dir), " \n\t ").unwrap();
        let error = load_prompt(&dir).expect_err("空提示词不能发送");
        assert!(error.to_string().contains(PROMPT_FILE_NAME));
        assert!(error.to_string().contains("为空"));
        fs::remove_dir_all(dir).ok();
    }

    #[test]
    fn composition_respects_tool_availability_and_current_registry() {
        let registry = CapabilityRegistry::builtin();
        let base = DEFAULT_PROMPT;
        let without = compose_system_prompt(&registry, Lang::Zh, base, false, false, false);
        assert!(without.contains(BASE_PROMPT_MARKER));
        assert!(!without.contains("connect_edge"));
        assert!(!without.contains("- overview:"));
        assert!(!without.contains(TOOLS_START));

        let with = compose_system_prompt(&registry, Lang::Zh, base, true, false, false);
        assert!(with.contains(BASE_PROMPT_MARKER));
        assert!(with.contains("connect_edge"));
        assert!(with.contains("query_recording_history"));
        assert!(with.contains("- overview:"));
        assert!(!with.contains("connect_nodes"));
        assert!(!with.contains(TOOLS_START));

        let web_only = compose_system_prompt(&registry, Lang::Zh, base, false, true, false);
        assert!(web_only.contains("fetch_webpage"));
        assert!(!web_only.contains("connect_edge"));
        assert!(!web_only.contains("- overview:"));
    }
}
