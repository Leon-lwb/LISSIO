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
        // 顺带回收过期条目: 登记表条目与磁盘文件都要清掉, 否则导出目录只增不减
        let mut expired: Vec<PathBuf> = Vec::new();
        entries.retain(|_, entry| {
            let alive = entry.created.elapsed() < ARTIFACT_TTL;
            if !alive {
                expired.push(entry.path.clone());
            }
            alive
        });
        entries.insert(
            token.clone(),
            Entry {
                path: path.clone(),
                created: Instant::now(),
            },
        );
        drop(entries);
        for path in expired {
            let _ = std::fs::remove_file(path);
        }
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

/// 下载 token — 与 Web 出口服务令牌同一生成器 (32 位十六进制)。
fn generate_token() -> String {
    crate::random_hex(2)
}

#[cfg(test)]
#[path = "artifacts_tests.rs"]
mod tests;
