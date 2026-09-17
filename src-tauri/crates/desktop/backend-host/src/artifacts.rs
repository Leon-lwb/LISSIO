//! 导出产物暂存 — Web 出口把命令产物落进服务端受管目录, 再经下载端点交付。
//!
//! 为什么需要: 桌面出口的导出命令直接写用户选的本地绝对路径 (Tauri 命令层)。
//! 浏览器没有可写路径, 若把 `path` 语义照搬进 HTTP-RPC, 就等于让任何已鉴权客户端
//! 向服务器任意路径写文件。Web 出口因此把产物写进受管目录, 用 token 化的
//! `/api/v1/download/{token}` 交付 (见 `docs/architecture/web-exit.md` §4 / §5.5)。
//!
//! 生命周期: 登记时顺带清扫超过 [`ARTIFACT_TTL`] 的条目。`resolve` 不消费条目 —
//! 浏览器重试 / 多次下载在 TTL 内都有效, 过期后由下一次登记回收。

use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::time::{Duration, Instant};

/// 产物在暂存区的存活时间 — 超时后在下一次登记时清扫。
pub const ARTIFACT_TTL: Duration = Duration::from_hours(1);

/// 导出产物暂存区 (进程内, 目录受管)。
pub struct ArtifactStaging {
    dir: PathBuf,
    entries: Mutex<HashMap<String, Entry>>,
}

/// 一条已登记产物。
struct Entry {
    path: PathBuf,
    created: Instant,
}

impl ArtifactStaging {
    /// 在 `dir` 下建立暂存区 (目录不存在时创建)。
    ///
    /// # Errors
    /// 目录无法创建时返回原因。
    pub fn new(dir: PathBuf) -> Result<Self, String> {
        std::fs::create_dir_all(&dir)
            .map_err(|error| format!("创建下载目录 {} 失败: {error}", dir.display()))?;
        Ok(Self {
            dir,
            entries: Mutex::new(HashMap::new()),
        })
    }

    /// 受管目录。
    #[must_use]
    pub fn dir(&self) -> &Path {
        &self.dir
    }

    /// 登记一个新产物, 返回 (下载 token, 写入路径)。
    ///
    /// `file_name` 只取 basename 并消毒, 因此调用方传入绝对路径也不会逃出暂存目录。
    ///
    /// # Errors
    /// 登记表锁被毒化时返回原因。
    pub fn allocate(&self, file_name: &str) -> Result<(String, PathBuf), String> {
        let safe = sanitize_file_name(file_name);
        let token = generate_token();
        let path = self.dir.join(format!("{token}-{safe}"));
        let mut entries = self
            .entries
            .lock()
            .map_err(|_| "下载登记表已损坏".to_string())?;
        // 顺带回收过期条目 (无需后台任务)
        entries.retain(|_, entry| entry.created.elapsed() < ARTIFACT_TTL);
        entries.insert(
            token.clone(),
            Entry {
                path: path.clone(),
                created: Instant::now(),
            },
        );
        Ok((token, path))
    }

    /// token → 产物路径; 未知或已过期返回 `None`。
    ///
    /// 不消费条目: 浏览器的重试与重复下载在 TTL 内都应当成功。
    #[must_use]
    pub fn resolve(&self, token: &str) -> Option<PathBuf> {
        let entries = self.entries.lock().ok()?;
        let entry = entries.get(token)?;
        (entry.created.elapsed() < ARTIFACT_TTL).then(|| entry.path.clone())
    }
}

/// 文件名消毒 — 只保留 basename 的安全字符, 空结果回落到 `export.csv`。
///
/// 这是"客户端不能指定服务器路径"这条边界的落点: 分隔符 (`/` `\`) 与父目录引用
/// 都在这里被抹掉。
#[must_use]
pub fn sanitize_file_name(raw: &str) -> String {
    let base = raw.rsplit(['/', '\\']).next().unwrap_or_default();
    let cleaned: String = base
        .chars()
        .map(|ch| {
            if ch.is_ascii_alphanumeric() || matches!(ch, '.' | '-' | '_') {
                ch
            } else {
                '_'
            }
        })
        .collect();
    let cleaned = cleaned.trim_matches(['.', '-', '_']);
    if cleaned.is_empty() {
        "export.csv".to_string()
    } else {
        cleaned.to_string()
    }
}

/// 下载 token — 由操作系统熵源播种的哈希输出拼装 (与 Web 出口服务令牌同法)。
fn generate_token() -> String {
    use std::collections::hash_map::RandomState;
    use std::fmt::Write as _;
    use std::hash::{BuildHasher, Hasher};
    use std::time::{SystemTime, UNIX_EPOCH};

    let nanos = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_or(0, |duration| duration.as_nanos());
    let mut token = String::with_capacity(32);
    for round in 0_u128..2 {
        let mut hasher = RandomState::new().build_hasher();
        hasher.write_u128(nanos);
        hasher.write_u128(round);
        hasher.write_u32(std::process::id());
        // 写入 String 不会失败 (fmt::Write for String 恒为 Ok)
        let _ = write!(token, "{:016x}", hasher.finish());
    }
    token
}

#[cfg(test)]
mod tests {
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
}
