use super::*;

fn temp_dir(tag: &str) -> PathBuf {
    let dir = std::env::temp_dir().join(format!("lissio-ai-session-{tag}-{}", std::process::id()));
    std::fs::remove_dir_all(&dir).ok();
    dir
}

fn user_item(text: &str) -> ViewItemDto {
    ViewItemDto {
        role: ViewRoleDto::User,
        text: text.to_string(),
        attachments: None,
        tools: None,
        timeline: None,
        reasoning: None,
        duration_ms: None,
        error: None,
        error_kind: None,
        error_data: None,
    }
}

fn assistant_item(text: &str) -> ViewItemDto {
    ViewItemDto {
        role: ViewRoleDto::Assistant,
        text: text.to_string(),
        attachments: None,
        tools: None,
        timeline: None,
        reasoning: None,
        duration_ms: None,
        error: None,
        error_kind: None,
        error_data: None,
    }
}

#[test]
fn store_create_append_and_meta() {
    let dir = temp_dir("store");
    let store = SessionStore::empty(&dir);

    let session = store.create("新会话").expect("新建会话");
    store
        .append_items(&session.id, vec![user_item("hi"), assistant_item("hello")])
        .expect("追加条目");

    let metas = store.list_metas();
    assert_eq!(metas.len(), 1);
    assert_eq!(metas[0].title, "新会话");
    assert_eq!(metas[0].item_count, 2);

    let loaded = store.get(&session.id).expect("读取会话");
    assert_eq!(loaded.items.len(), 2);

    std::fs::remove_dir_all(&dir).ok();
}

#[test]
fn store_rename_remove_clear_truncate() {
    let dir = temp_dir("mutate");
    let store = SessionStore::empty(&dir);
    let s1 = store.create("a").expect("新建");
    let s2 = store.create("b").expect("新建");
    store
        .append_items(
            &s1.id,
            vec![user_item("hi"), assistant_item("x"), assistant_item("y")],
        )
        .expect("追加");

    store.rename(&s1.id, "改名").expect("重命名");
    assert_eq!(store.get(&s1.id).unwrap().title, "改名");
    assert!(store.rename("nope", "x").is_err(), "未知会话应报错");

    store.truncate_after_last_user(&s1.id).expect("截断");
    assert_eq!(store.get(&s1.id).unwrap().items.len(), 1);

    store.clear_items(&s1.id).expect("清空");
    assert_eq!(store.get(&s1.id).unwrap().items, []);

    store.remove(&s2.id).expect("删除");
    assert!(store.get(&s2.id).is_none());
    // 静默语义: 重复删除 / 对缺失会话追加与清空都不报错
    store.remove(&s2.id).expect("重复删除静默");
    store
        .append_items(&s2.id, vec![user_item("hi")])
        .expect("缺失会话追加静默");
    store.clear_items(&s2.id).expect("缺失会话清空静默");

    std::fs::remove_dir_all(&dir).ok();
}

/// 反复写入回合草稿只保留最后一份 (中途快照不重复), 终态写入替换草稿。
#[test]
fn upsert_turn_replaces_draft_tail() {
    let dir = temp_dir("upsert");
    let store = SessionStore::empty(&dir);
    let session = store.create("会话").expect("新建");
    store
        .append_items(&session.id, vec![user_item("问")])
        .expect("追加用户条目");

    store
        .upsert_turn_items(&session.id, vec![assistant_item("部分")])
        .expect("首次草稿");
    store
        .upsert_turn_items(&session.id, vec![assistant_item("部分回答")])
        .expect("覆盖草稿");
    store
        .upsert_turn_items(
            &session.id,
            vec![assistant_item("部分回答"), assistant_item("错误")],
        )
        .expect("终态写入");

    let items = store.get(&session.id).unwrap().items;
    assert_eq!(items.len(), 3, "用户条目 + 终态两条");
    assert_eq!(items[1].text, "部分回答");
    assert_eq!(items[2].text, "错误");

    // 磁盘上的内容与内存一致 (草稿已被替换而非叠加)
    let reloaded = SessionStore::load(&dir).expect("重新加载");
    assert_eq!(reloaded.get(&session.id).unwrap().items, items);

    std::fs::remove_dir_all(&dir).ok();
}

/// 空快照与缺失会话都是静默空操作, 不写盘也不报错。
#[test]
fn upsert_turn_is_silent_without_anchor_or_session() {
    let dir = temp_dir("upsert-empty");
    let store = SessionStore::empty(&dir);
    let session = store.create("会话").expect("新建");
    store
        .append_items(&session.id, vec![user_item("问"), assistant_item("答")])
        .expect("追加");

    store
        .upsert_turn_items(&session.id, Vec::new())
        .expect("空快照静默");
    store
        .upsert_turn_items("missing", vec![assistant_item("x")])
        .expect("缺失会话静默");
    assert_eq!(store.get(&session.id).unwrap().items.len(), 2);

    // 没有用户条目的会话退化为追加 (仅终态调用一次)
    let bare = store.create("裸会话").expect("新建");
    store
        .upsert_turn_items(&bare.id, vec![assistant_item("独答")])
        .expect("无锚点追加");
    assert_eq!(store.get(&bare.id).unwrap().items.len(), 1);

    std::fs::remove_dir_all(&dir).ok();
}

/// 损坏文件被隔离保留, 存储按空会话启动且随后可正常落盘。
#[test]
fn load_or_quarantine_keeps_corrupt_file() {
    let dir = temp_dir("quarantine");
    std::fs::create_dir_all(&dir).expect("建目录");
    std::fs::write(config_path(&dir), "{ not json").expect("写坏文件");

    let store = SessionStore::load_or_quarantine(&dir);
    assert!(store.list_metas().is_empty(), "损坏文件按空会话启动");
    assert!(!config_path(&dir).exists(), "坏文件已改名");

    let quarantined: Vec<PathBuf> = std::fs::read_dir(&dir)
        .expect("列目录")
        .filter_map(std::result::Result::ok)
        .map(|entry| entry.path())
        .filter(|path| {
            path.file_name().is_some_and(|name| {
                name.to_string_lossy()
                    .starts_with("ai_chat_sessions.corrupt-")
            })
        })
        .collect();
    assert_eq!(quarantined.len(), 1, "隔离文件唯一");
    assert_eq!(
        std::fs::read_to_string(&quarantined[0]).expect("读隔离文件"),
        "{ not json"
    );

    // 隔离后新建会话会写回干净文件, 不再触碰隔离副本
    store.create("新会话").expect("新建会话");
    assert_eq!(
        SessionStore::load(&dir)
            .expect("重新加载")
            .list_metas()
            .len(),
        1
    );

    std::fs::remove_dir_all(&dir).ok();
}

/// 文件缺失不是损坏: 空会话启动且不产生隔离文件。
#[test]
fn load_or_quarantine_missing_file_is_empty() {
    let dir = temp_dir("quarantine-missing");
    let store = SessionStore::load_or_quarantine(&dir);
    assert!(store.list_metas().is_empty());
    assert!(!dir.exists(), "不应为缺失文件创建目录或隔离副本");

    std::fs::remove_dir_all(&dir).ok();
}
