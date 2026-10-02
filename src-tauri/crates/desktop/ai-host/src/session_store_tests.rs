//! `AiHost` 启动时的会话文件损坏处理 — 隔离而非静默清空。

use std::path::PathBuf;
use std::sync::Arc;

use super::*;
use crate::test_support::unique_temp_path;

/// 隔离副本路径 (目录下唯一的 `ai_chat_sessions.corrupt-*.json`)。
fn quarantine_files(dir: &std::path::Path) -> Vec<PathBuf> {
    std::fs::read_dir(dir)
        .map(|entries| {
            entries
                .filter_map(std::result::Result::ok)
                .map(|entry| entry.path())
                .filter(|path| {
                    path.file_name().is_some_and(|name| {
                        name.to_string_lossy()
                            .starts_with("ai_chat_sessions.corrupt-")
                    })
                })
                .collect()
        })
        .unwrap_or_default()
}

/// 损坏文件被隔离保留, 宿主按空会话启动并能继续写回干净文件。
#[tokio::test]
async fn corrupt_sessions_file_is_quarantined_on_start() {
    let dir = unique_temp_path("lissio-ai-session-quarantine");
    std::fs::create_dir_all(&dir).expect("建目录");
    let path = chat_session::store::config_path(&dir);
    std::fs::write(&path, "{ not json").expect("写坏文件");

    let host = AiHost::new(
        dir.clone(),
        Toolbox::from_state(&app::AppState::new()),
        Arc::new(events::NullEventSink),
    );

    assert!(chat_list_sessions(&host).is_empty(), "损坏文件不阻塞启动");
    assert!(!path.exists(), "坏文件应已改名");
    let quarantined = quarantine_files(&dir);
    assert_eq!(quarantined.len(), 1, "隔离副本唯一");
    assert_eq!(
        std::fs::read_to_string(&quarantined[0]).expect("读隔离副本"),
        "{ not json"
    );

    let session = chat_create_session(&host, "新会话".into()).expect("新建会话");
    assert!(chat_get_session(&host, session.id).is_some());
    assert_eq!(quarantine_files(&dir).len(), 1, "后续落盘不新增隔离副本");

    std::fs::remove_dir_all(dir).ok();
}
