use super::Destination;
use backend_host::ArtifactStaging;
use events::{BackendEventSink, NotifyLevel};
use serde_json::Value;
use std::sync::Mutex;

/// 记录型端口 — 断言交付提示携带下载链接。
#[derive(Default)]
struct RecordingSink {
    notes: Mutex<Vec<(NotifyLevel, String, Option<String>)>>,
}

impl BackendEventSink for RecordingSink {
    fn emit_event(&self, _event: &str, _payload: Value) {}

    fn notify(&self, level: NotifyLevel, message: &str) {
        self.notes
            .lock()
            .expect("sink lock")
            .push((level, message.to_string(), None));
    }

    fn notify_with_url(&self, level: NotifyLevel, message: &str, url: &str) {
        self.notes.lock().expect("sink lock").push((
            level,
            message.to_string(),
            Some(url.to_string()),
        ));
    }
}

/// 暂存区落点: 产物落在受管目录内, token 出现在下载 URL 里。
#[test]
fn staged_destination_stays_inside_managed_dir() {
    let dir = std::env::temp_dir().join(format!("lissio-export-{}", std::process::id()));
    let staging = ArtifactStaging::new(dir.clone()).expect("暂存区应可创建");
    let sink = RecordingSink::default();

    let destination = Destination::staged(Some(&staging), "/etc/passwd")
        .expect("有暂存区就应返回落点")
        .expect("登记应成功");
    let written = destination.write_path();
    assert!(
        written.starts_with(&dir.to_string_lossy().to_string()),
        "客户端路径不得逃出受管目录: {written}"
    );

    destination.publish(&sink, "波形 CSV 已导出 (3 行)");
    let notes = sink.notes.lock().unwrap();
    assert_eq!(notes.len(), 1);
    assert_eq!(notes[0].0, NotifyLevel::Info);
    assert!(notes[0].1.contains("点击下载"));
    assert!(
        notes[0]
            .2
            .as_deref()
            .is_some_and(|url| url.starts_with("/api/v1/download/")),
        "Web 出口必须下发下载链接"
    );

    let _ = std::fs::remove_dir_all(&dir);
}

/// 无暂存区 (CLI) 时不产生通知 — 调用方就在本机。
#[test]
fn local_destination_does_not_notify() {
    let sink = RecordingSink::default();
    let destination = Destination::Local(std::path::PathBuf::from("/tmp/x.csv"));
    destination.publish(&sink, "ignored");
    assert!(sink.notes.lock().unwrap().is_empty());
    assert!(Destination::staged(None, "x.csv").is_none());
}
