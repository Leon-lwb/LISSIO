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
