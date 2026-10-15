use super::{SETTINGS_FILE_NAME, SETTINGS_KEY, SettingsStore};
use serde_json::{Map, Value, json};

fn temp_dir(tag: &str) -> std::path::PathBuf {
    let dir = std::env::temp_dir().join(format!("lissio-settings-{tag}-{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&dir);
    dir
}

/// 缺失文件 = 空文档 (前端回落默认值), 不是错误。
#[test]
fn missing_file_reads_as_empty_document() {
    let dir = temp_dir("missing");
    let store = SettingsStore::new(&dir);
    assert!(store.read().expect("缺文件不应报错").is_empty());
    assert_eq!(store.path(), dir.join(SETTINGS_FILE_NAME));
}

/// Acknowledged writes preserve the current `{ "app": … }` document shape.
#[test]
fn round_trip_preserves_settings_document_shape() {
    let dir = temp_dir("roundtrip");
    let store = SettingsStore::new(&dir);
    let mut document = Map::new();
    document.insert(
        SETTINGS_KEY.to_string(),
        json!({ "general": { "lang": "zh" } }),
    );

    store.write(&document).expect("写入应成功");
    let raw = std::fs::read_to_string(store.path()).expect("文件应存在");
    let parsed: Value = serde_json::from_str(&raw).expect("应是合法 JSON");
    assert_eq!(parsed["app"]["general"]["lang"], json!("zh"));

    let read_back = store.read().expect("读取应成功");
    assert_eq!(read_back[SETTINGS_KEY], document[SETTINGS_KEY]);
    // 不留临时文件
    assert!(!store.path().with_extension("json.tmp").exists());

    let _ = std::fs::remove_dir_all(&dir);
}

/// Invalid existing files must never masquerade as a fresh installation.
#[test]
fn corrupt_file_returns_an_error_and_preserves_the_file() {
    let dir = temp_dir("corrupt");
    std::fs::create_dir_all(&dir).expect("目录应可创建");
    let store = SettingsStore::new(&dir);
    for content in ["{ not json", "[1,2,3]", "null", ""] {
        std::fs::write(store.path(), content).expect("写入应成功");
        assert!(
            store.read().is_err(),
            "Invalid settings must fail: {content}"
        );
        assert_eq!(std::fs::read_to_string(store.path()).unwrap(), content);
    }
    let _ = std::fs::remove_dir_all(&dir);
}

#[test]
fn unreadable_file_returns_an_error() {
    let dir = temp_dir("unreadable");
    let store = SettingsStore::new(&dir);
    std::fs::create_dir_all(store.path()).unwrap();
    assert!(store.read().is_err(), "A directory is not a settings file");
    let _ = std::fs::remove_dir_all(&dir);
}

/// MCP 端口是用户配置: 读得到就用, 缺失 / 类型不对 / `0` 一律视为未配置。
#[test]
fn mcp_server_port_reads_only_a_usable_persisted_value() {
    let dir = temp_dir("mcp-port");
    std::fs::create_dir_all(&dir).expect("目录应可创建");
    let store = SettingsStore::new(&dir);

    assert_eq!(store.mcp_server_port(), None, "缺文件视为未配置");

    let mut document = Map::new();
    for (value, expected) in [
        (json!(9001), Some(9001)),
        (json!(0), None),
        (json!(70000), None),
        (json!("8765"), None),
        (json!(null), None),
    ] {
        document.insert(
            SETTINGS_KEY.to_string(),
            json!({ "ai": { "mcpServerPort": value } }),
        );
        store.write(&document).expect("写入应成功");
        assert_eq!(
            store.mcp_server_port(),
            expected,
            "mcpServerPort = {value} 的解析结果不符"
        );
    }

    let _ = std::fs::remove_dir_all(&dir);
}

/// 总开关默认关闭; 显式 true 才开启; 类型不对或文件缺失一律回落默认。
#[test]
fn recording_switch_defaults_to_off_and_reads_the_persisted_value() {
    let dir = temp_dir("recording-switch");
    std::fs::create_dir_all(&dir).expect("目录应可创建");
    let store = SettingsStore::new(&dir);

    assert!(!store.recording_enabled(), "缺文件必须默认关闭");

    let mut document = Map::new();
    document.insert(
        SETTINGS_KEY.to_string(),
        json!({ "data": { "recordingEnabled": true } }),
    );
    store.write(&document).expect("写入应成功");
    assert!(store.recording_enabled(), "持久化的 true 必须生效");

    document.insert(
        SETTINGS_KEY.to_string(),
        json!({ "data": { "recordingEnabled": "no" } }),
    );
    store.write(&document).expect("写入应成功");
    assert!(!store.recording_enabled(), "类型不对必须回落默认关闭");

    let _ = std::fs::remove_dir_all(&dir);
}
