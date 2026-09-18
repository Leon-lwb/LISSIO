//! Desktop-owned lifecycle for the independently built `lissio-server` sidecar.

use std::fs::OpenOptions;
use std::io::{BufRead as _, BufReader, Write as _};
use std::path::PathBuf;
use std::process::{Child, Command, Stdio};
use std::sync::{Mutex, mpsc};

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager, State};

const WEB_PROTOCOL: &str = "lissio.web.v2";

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum SidecarStatus {
    Starting,
    Running,
    Failed,
    Stopped,
}

#[derive(Debug, Clone, Serialize)]
pub struct SidecarInfo {
    pub status: SidecarStatus,
    pub base: Option<String>,
    pub token: Option<String>,
    pub version: String,
    pub log_path: Option<String>,
    pub error: Option<String>,
}

struct RunningChild {
    child: Child,
}

#[derive(Deserialize)]
struct ReadyRecord {
    port: u16,
    protocol: String,
    version: String,
}

pub struct SidecarManager {
    child: Mutex<Option<RunningChild>>,
    info: Mutex<SidecarInfo>,
}

impl Default for SidecarManager {
    fn default() -> Self {
        Self {
            child: Mutex::new(None),
            info: Mutex::new(SidecarInfo {
                status: SidecarStatus::Stopped,
                base: None,
                token: None,
                version: env!("CARGO_PKG_VERSION").to_string(),
                log_path: None,
                error: None,
            }),
        }
    }
}

impl SidecarManager {
    pub fn start(&self, app: &AppHandle) -> Result<SidecarInfo, String> {
        self.stop();
        *self.info.lock().map_err(|_| "sidecar state poisoned")? = SidecarInfo {
            status: SidecarStatus::Starting,
            base: None,
            token: None,
            version: env!("CARGO_PKG_VERSION").to_string(),
            log_path: None,
            error: None,
        };
        match Self::spawn(app) {
            Ok((child, info)) => {
                *self.child.lock().map_err(|_| "sidecar child poisoned")? = Some(child);
                *self.info.lock().map_err(|_| "sidecar state poisoned")? = info.clone();
                Ok(info)
            }
            Err(error) => {
                let failed = SidecarInfo {
                    status: SidecarStatus::Failed,
                    base: None,
                    token: None,
                    version: env!("CARGO_PKG_VERSION").to_string(),
                    log_path: self.info.lock().ok().and_then(|info| info.log_path.clone()),
                    error: Some(error.clone()),
                };
                if let Ok(mut info) = self.info.lock() {
                    *info = failed;
                }
                Err(error)
            }
        }
    }

    fn spawn(app: &AppHandle) -> Result<(RunningChild, SidecarInfo), String> {
        let mut bytes = [0_u8; 32];
        getrandom::fill(&mut bytes).map_err(|error| format!("无法生成访问令牌: {error}"))?;
        let mut token = String::with_capacity(bytes.len() * 2);
        for byte in bytes {
            use std::fmt::Write as _;
            write!(&mut token, "{byte:02x}").map_err(|error| error.to_string())?;
        }
        let binary = resolve_binary(app)?;
        let config_dir = app
            .path()
            .app_config_dir()
            .map_err(|error| error.to_string())?;
        std::fs::create_dir_all(&config_dir).map_err(|error| error.to_string())?;
        let log_dir = app
            .path()
            .app_log_dir()
            .map_err(|error| error.to_string())?;
        std::fs::create_dir_all(&log_dir).map_err(|error| error.to_string())?;
        let log_path = log_dir.join("lissio-server.log");
        let stdout_log = OpenOptions::new()
            .create(true)
            .append(true)
            .open(&log_path)
            .map_err(|error| format!("无法打开 sidecar 日志: {error}"))?;
        let stderr = stdout_log.try_clone().map_err(|error| error.to_string())?;
        let mut child = Command::new(&binary)
            .args([
                "--bind",
                "127.0.0.1",
                "--http-port",
                "0",
                "--mcp-port",
                "0",
                "--supervised-stdio",
                "--config-dir",
            ])
            .arg(&config_dir)
            .env("LISSIO_TOKEN", &token)
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::from(stderr))
            .spawn()
            .map_err(|error| format!("无法启动 {}: {error}", binary.display()))?;
        let stdout = child
            .stdout
            .take()
            .ok_or_else(|| "无法读取 sidecar stdout".to_string())?;
        let (ready_tx, ready_rx) = mpsc::sync_channel(1);
        std::thread::spawn(move || {
            let mut log = stdout_log;
            for line in BufReader::new(stdout).lines() {
                let Ok(line) = line else { break };
                let _ = writeln!(log, "{line}");
                if let Some(payload) = line.strip_prefix("LISSIO_READY=") {
                    let parsed = serde_json::from_str::<ReadyRecord>(payload)
                        .map_err(|error| format!("sidecar ready 记录无效: {error}"));
                    let _ = ready_tx.send(parsed);
                }
            }
        });
        let ready = match ready_rx.recv_timeout(std::time::Duration::from_secs(30)) {
            Ok(Ok(ready)) => ready,
            Ok(Err(error)) => {
                terminate_child(&mut child);
                return Err(error);
            }
            Err(error) => {
                let status = child.try_wait().ok().flatten();
                terminate_child(&mut child);
                return Err(status.map_or_else(
                    || format!("等待 sidecar ready 超时: {error}"),
                    |status| format!("sidecar 在 ready 前退出: {status}"),
                ));
            }
        };
        if ready.protocol != WEB_PROTOCOL || ready.version != env!("CARGO_PKG_VERSION") {
            terminate_child(&mut child);
            return Err(format!(
                "sidecar 版本不兼容: protocol={}, version={}",
                ready.protocol, ready.version
            ));
        }
        Ok((
            RunningChild { child },
            SidecarInfo {
                status: SidecarStatus::Running,
                base: Some(format!("http://127.0.0.1:{}", ready.port)),
                token: Some(token),
                version: env!("CARGO_PKG_VERSION").to_string(),
                log_path: Some(log_path.to_string_lossy().into_owned()),
                error: None,
            },
        ))
    }

    pub fn info(&self) -> SidecarInfo {
        let mut info = self.info.lock().map_or_else(
            |_| SidecarInfo {
                status: SidecarStatus::Failed,
                base: None,
                token: None,
                version: env!("CARGO_PKG_VERSION").to_string(),
                log_path: None,
                error: Some("sidecar state poisoned".to_string()),
            },
            |info| info.clone(),
        );
        if let Ok(mut child) = self.child.lock()
            && let Some(running) = child.as_mut()
            && let Ok(Some(status)) = running.child.try_wait()
        {
            info.status = SidecarStatus::Failed;
            info.error = Some(format!("后端进程已退出: {status}"));
            info.token = None;
            *child = None;
            if let Ok(mut stored) = self.info.lock() {
                *stored = info.clone();
            }
        }
        info
    }

    pub fn stop(&self) {
        let running = self.child.lock().ok().and_then(|mut slot| slot.take());
        if let Some(mut running) = running {
            if let Some(stdin) = running.child.stdin.as_mut() {
                let _ = stdin.write_all(b"shutdown\n");
            }
            for _ in 0..50 {
                if matches!(running.child.try_wait(), Ok(Some(_))) {
                    return;
                }
                std::thread::sleep(std::time::Duration::from_millis(100));
            }
            let _ = running.child.kill();
            let _ = running.child.wait();
        }
    }
}

fn terminate_child(child: &mut Child) {
    let _ = child.kill();
    let _ = child.wait();
}

fn resolve_binary(app: &AppHandle) -> Result<PathBuf, String> {
    if let Some(path) = std::env::var_os("LISSIO_SIDECAR_PATH").map(PathBuf::from)
        && path.is_file()
    {
        return Ok(path);
    }
    let suffix = if cfg!(windows) { ".exe" } else { "" };
    let name = format!("lissio-server{suffix}");
    let current = std::env::current_exe().map_err(|error| error.to_string())?;
    let mut candidates = vec![
        current
            .parent()
            .unwrap_or_else(|| std::path::Path::new("."))
            .join(&name),
    ];
    if let Ok(resources) = app.path().resource_dir() {
        candidates.push(resources.join(&name));
    }
    candidates
        .into_iter()
        .find(|path| path.is_file())
        .ok_or_else(|| {
            format!("未找到 {name}；请运行 pnpm prepare:sidecar 或设置 LISSIO_SIDECAR_PATH")
        })
}

#[tauri::command]
pub fn backend_sidecar_info(state: State<'_, SidecarManager>) -> SidecarInfo {
    state.info()
}

#[tauri::command]
pub fn backend_sidecar_restart(
    app: AppHandle,
    state: State<'_, SidecarManager>,
) -> Result<SidecarInfo, String> {
    state.start(&app)
}

#[tauri::command]
pub fn backend_sidecar_open_logs(
    app: AppHandle,
    state: State<'_, SidecarManager>,
) -> Result<(), String> {
    use tauri_plugin_opener::OpenerExt as _;

    let path = state
        .info()
        .log_path
        .ok_or_else(|| "sidecar 日志尚未创建".to_string())?;
    app.opener()
        .reveal_item_in_dir(path)
        .map_err(|error| error.to_string())
}
