use super::*;

/// 用例里统一用 productName 形态的文件名 (大写 L) —— 真实日志文件名就是 `Lissio.log`
const FILE_NAME: &str = "Lissio";

/// 每次用例一个独立目录名 — 复用同一个会被上一次的残留干扰
fn scratch(label: &str) -> PathBuf {
    std::env::temp_dir().join(format!("lissio-logging-{label}-{}", std::process::id()))
}

#[test]
fn data_local_layout_matches_tauri_app_log_dir() {
    let dir = log_dir(
        Path::new("/base"),
        "top.pengheng.lissio",
        LogDirShape::DataLocal,
    );
    assert_eq!(dir, Path::new("/base/top.pengheng.lissio/logs"));
}

#[test]
fn macos_layout_is_home_library_logs() {
    let dir = log_dir(
        Path::new("/Users/someone"),
        "top.pengheng.lissio",
        LogDirShape::HomeLibraryLogs,
    );
    assert_eq!(
        dir,
        Path::new("/Users/someone/Library/Logs/top.pengheng.lissio")
    );
}

#[test]
fn prepare_creates_the_directory_and_the_log_file() {
    let dir = scratch("prepare");
    let _ = std::fs::remove_dir_all(&dir);
    let prepared = prepare(&dir, FILE_NAME);
    assert!(prepared.is_ok(), "新建的临时目录必须可写: {prepared:?}");
    // 预检建的正是插件随后会打开的那个文件 (create + append 会把空文件留在这里)
    assert!(dir.join("Lissio.log").is_file());
    let _ = std::fs::remove_dir_all(&dir);
}

#[test]
fn prepare_rejects_a_directory_where_the_log_file_belongs() {
    let dir = scratch("occupied");
    let _ = std::fs::remove_dir_all(&dir);
    assert!(std::fs::create_dir_all(dir.join("Lissio.log")).is_ok());
    let prepared = prepare(&dir, FILE_NAME);
    assert!(prepared.is_err(), "同名目录必须被识别成不可用");
    assert!(
        prepared
            .err()
            .is_some_and(|reason| reason.contains("是目录而不是日志文件")),
        "错误信息要指出占位的是一个目录"
    );
    let _ = std::fs::remove_dir_all(&dir);
}

#[test]
fn plan_falls_back_to_the_second_directory_and_explains_why() {
    let base = scratch("plan");
    let _ = std::fs::remove_dir_all(&base);
    assert!(std::fs::create_dir_all(&base).is_ok());
    // 主路径被一个同名文件占住 → create_dir_all 失败
    let blocked = base.join("blocked");
    assert!(std::fs::write(&blocked, b"not a directory").is_ok());
    let fallback = base.join("fallback");

    match plan_for(blocked.clone(), fallback.clone(), FILE_NAME) {
        Ok(planned) => {
            assert_eq!(planned.dir, fallback);
            let note = planned.note.unwrap_or_default();
            assert!(note.contains(&blocked.display().to_string()), "{note}");
            assert!(note.contains(&fallback.display().to_string()), "{note}");
        }
        Err(reason) => panic!("应当降级到兜底目录, 却报错: {reason}"),
    }
    let _ = std::fs::remove_dir_all(&base);
}

#[test]
fn plan_reports_both_directories_when_neither_is_usable() {
    let base = scratch("plan-fail");
    let _ = std::fs::remove_dir_all(&base);
    assert!(std::fs::create_dir_all(&base).is_ok());
    let primary = base.join("primary");
    let fallback = base.join("fallback");
    assert!(std::fs::write(&primary, b"not a directory").is_ok());
    assert!(std::fs::write(&fallback, b"not a directory").is_ok());

    match plan_for(primary.clone(), fallback.clone(), FILE_NAME) {
        Ok(planned) => panic!("两个候选都不可用时不该给出文件目标: {:?}", planned.dir),
        Err(reason) => {
            assert!(reason.contains(&primary.display().to_string()), "{reason}");
            assert!(reason.contains(&fallback.display().to_string()), "{reason}");
        }
    }
    let _ = std::fs::remove_dir_all(&base);
}

#[test]
fn the_platform_layout_is_the_one_this_host_should_use() {
    // Check the host base directory and the complete platform-specific layout.
    let identifier = "top.pengheng.lissio";
    let resolved = app_log_dir(identifier).expect("host must expose a home/data-local dir");
    let expected = if cfg!(target_os = "macos") {
        dirs::home_dir()
            .expect("host must expose a home directory")
            .join("Library")
            .join("Logs")
            .join(identifier)
    } else {
        dirs::data_local_dir()
            .expect("host must expose a local data directory")
            .join(identifier)
            .join("logs")
    };
    assert_eq!(resolved, expected);
}
