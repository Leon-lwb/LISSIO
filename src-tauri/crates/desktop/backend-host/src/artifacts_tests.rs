use super::{ArtifactStaging, sanitize_file_name};

#[test]
fn sanitize_strips_paths_and_traversal() {
    assert_eq!(sanitize_file_name("/tmp/waveform.csv"), "waveform.csv");
    assert_eq!(sanitize_file_name("C:\\Users\\x\\a.csv"), "a.csv");
    assert_eq!(sanitize_file_name("../../etc/passwd"), "passwd");
    assert_eq!(sanitize_file_name(".."), "export.csv");
    assert_eq!(sanitize_file_name(""), "export.csv");
    // 危险字符被替换, 分隔符不可能残留
    assert_eq!(sanitize_file_name("a b;c.csv"), "a_b_c.csv");
}

#[test]
fn allocate_and_resolve_round_trip() {
    let dir = std::env::temp_dir().join(format!("lissio-artifacts-{}", std::process::id()));
    let staging = ArtifactStaging::new(dir.clone()).expect("暂存区应可创建");
    let (token, path) = staging
        .allocate("/home/someone/waveform.csv")
        .expect("登记应成功");
    assert_eq!(path.parent(), Some(dir.as_path()), "产物必须落在受管目录内");
    assert!(path.to_string_lossy().ends_with("waveform.csv"));
    assert_eq!(staging.resolve(&token), Some(path));
    // 未知 token 不解析
    assert!(staging.resolve("not-a-token").is_none());
    let _ = std::fs::remove_dir_all(&dir);
}

#[test]
fn tokens_are_long_and_distinct() {
    let first = super::generate_token();
    let second = super::generate_token();
    assert_eq!(first.len(), 32);
    assert_ne!(first, second);
}
