//! 服务配置 — 绑定地址 / 端口 / 令牌 / 静态站点 / CORS。
//!
//! 优先级与环境变量约定与既有出口一致 (显式参数 > 环境变量 > 默认), 配置目录
//! 复用 `backend_host::resolve_config_dir` (`LISSIO_CONFIG_DIR` 已由那里处理)。

use std::net::{IpAddr, Ipv4Addr};
use std::path::{Path, PathBuf};

/// 环境变量名 (与 `LISSIO_CONFIG_DIR` / `LISSIO_MCP_PORT` 同一命名空间)。
pub const BIND_ENV: &str = "LISSIO_BIND";
/// HTTP 监听端口环境变量。
pub const HTTP_PORT_ENV: &str = "LISSIO_HTTP_PORT";
/// 访问令牌环境变量 (优先级高于令牌文件)。
pub const TOKEN_ENV: &str = "LISSIO_TOKEN";
/// 静态站点目录环境变量。
pub const STATIC_DIR_ENV: &str = "LISSIO_STATIC_DIR";
/// 允许的跨源来源 (逗号分隔) 环境变量。
pub const CORS_ORIGINS_ENV: &str = "LISSIO_CORS_ORIGINS";
/// 默认 HTTP 端口 (MCP 默认 8765 之外的另一条通道)。
pub const DEFAULT_HTTP_PORT: u16 = 8790;
/// 令牌文件名 (位于配置目录)。
pub const TOKEN_FILE_NAME: &str = "server-token";

/// Web 出口运行配置。
#[derive(Debug, Clone)]
pub struct ServerConfig {
    /// 监听地址 (默认 loopback, 容器/局域网需显式放开)。
    pub bind: IpAddr,
    /// HTTP / WebSocket 端口。
    pub http_port: u16,
    /// 访问令牌 — 非 loopback 绑定时强制要求。
    pub token: String,
    /// 可选静态站点目录 (`dist/`), 提供单进程完整应用。
    pub static_dir: Option<PathBuf>,
    /// 允许的跨源来源; 空 = 同源部署, 不启用 CORS 层。
    pub cors_origins: Vec<String>,
    /// 是否在进程内同时启动 MCP server 及其端口。
    pub mcp_port: Option<u16>,
    /// 启动时是否恢复持久化工作区。
    pub restore_workspace: bool,
    /// 显式配置目录 (None = 按平台语义解析)。
    pub config_dir: Option<PathBuf>,
}

impl ServerConfig {
    /// 从显式参数 / 环境变量构造配置, 并解析令牌。
    ///
    /// # Errors
    /// 端口解析失败或令牌无法落盘时返回原因。
    pub fn resolve(
        bind: Option<IpAddr>,
        http_port: Option<u16>,
        token: Option<String>,
        token_file: Option<PathBuf>,
        static_dir: Option<PathBuf>,
        cors_origins: Vec<String>,
        mcp_port: Option<u16>,
        restore_workspace: bool,
        config_dir: Option<PathBuf>,
    ) -> Result<Self, String> {
        let bind = match bind {
            Some(bind) => bind,
            None => env_string(BIND_ENV)
                .map(|value| value.parse::<IpAddr>())
                .transpose()
                .map_err(|error| format!("{BIND_ENV} 解析失败: {error}"))?
                .unwrap_or(IpAddr::V4(Ipv4Addr::LOCALHOST)),
        };
        let http_port = match http_port {
            Some(port) => port,
            None => env_string(HTTP_PORT_ENV)
                .map(|value| value.parse::<u16>())
                .transpose()
                .map_err(|error| format!("{HTTP_PORT_ENV} 解析失败: {error}"))?
                .unwrap_or(DEFAULT_HTTP_PORT),
        };
        let static_dir = static_dir.or_else(|| env_string(STATIC_DIR_ENV).map(PathBuf::from));
        let cors_origins = if cors_origins.is_empty() {
            env_string(CORS_ORIGINS_ENV).map_or_else(Vec::new, |value| {
                value
                    .split(',')
                    .map(str::trim)
                    .filter(|origin| !origin.is_empty())
                    .map(str::to_string)
                    .collect()
            })
        } else {
            cors_origins
        };
        let config_dir = config_dir.or_else(|| backend_host::resolve_config_dir(None).into());
        let token = resolve_token(token, token_file, config_dir.as_deref())?;
        Ok(Self {
            bind,
            http_port,
            token,
            static_dir,
            cors_origins,
            mcp_port,
            restore_workspace,
            config_dir,
        })
    }

    /// 是否允许免令牌访问 (仅 loopback 且显式开启)。
    pub const fn is_loopback(&self) -> bool {
        self.bind.is_loopback()
    }

    /// 令牌文件路径。
    #[must_use]
    pub fn token_path(&self, explicit: Option<&Path>) -> PathBuf {
        explicit.map_or_else(
            || {
                self.config_dir
                    .clone()
                    .unwrap_or_else(|| PathBuf::from("."))
                    .join(TOKEN_FILE_NAME)
            },
            Path::to_path_buf,
        )
    }
}

/// 读取环境变量 (空白视为未设置)。
fn env_string(key: &str) -> Option<String> {
    std::env::var(key)
        .ok()
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
}

/// 解析访问令牌 — 显式 > 环境变量 > 令牌文件 > 新建并落盘。
fn resolve_token(
    explicit: Option<String>,
    token_file: Option<PathBuf>,
    config_dir: Option<&Path>,
) -> Result<String, String> {
    if let Some(token) = explicit
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
    {
        return Ok(token);
    }
    if let Some(token) = env_string(TOKEN_ENV) {
        return Ok(token);
    }
    let path = token_file.unwrap_or_else(|| {
        config_dir.map_or_else(
            || PathBuf::from(TOKEN_FILE_NAME),
            |dir| dir.join(TOKEN_FILE_NAME),
        )
    });
    if let Ok(existing) = std::fs::read_to_string(&path) {
        let existing = existing.trim().to_string();
        if !existing.is_empty() {
            return Ok(existing);
        }
    }
    let token = generate_token();
    if let Some(parent) = path.parent()
        && !parent.as_os_str().is_empty()
    {
        std::fs::create_dir_all(parent)
            .map_err(|error| format!("创建配置目录 {} 失败: {error}", parent.display()))?;
    }
    write_token_file(&path, &token)?;
    log::info!(
        "已生成 Web 出口访问令牌 ({}); 客户端需以 Bearer 携带该值",
        path.display()
    );
    Ok(token)
}

/// 以 0600 权限写入令牌文件 (unix); 其他平台退化为普通写入。
fn write_token_file(path: &Path, token: &str) -> Result<(), String> {
    #[cfg(unix)]
    {
        use std::io::Write;
        use std::os::unix::fs::OpenOptionsExt;
        let mut file = std::fs::OpenOptions::new()
            .write(true)
            .create(true)
            .truncate(true)
            .mode(0o600)
            .open(path)
            .map_err(|error| format!("写入令牌文件 {} 失败: {error}", path.display()))?;
        file.write_all(token.as_bytes())
            .map_err(|error| format!("写入令牌文件 {} 失败: {error}", path.display()))?;
    }
    #[cfg(not(unix))]
    {
        std::fs::write(path, token)
            .map_err(|error| format!("写入令牌文件 {} 失败: {error}", path.display()))?;
    }
    Ok(())
}

/// 生成访问令牌 — 与导出下载 token 共用 `backend_host::random_hex`
/// (64 位十六进制; 非密码学级 CSPRNG, 长期暴露时用 `LISSIO_TOKEN` 提供强令牌)。
fn generate_token() -> String {
    backend_host::random_hex(4)
}

#[cfg(test)]
#[path = "config_tests.rs"]
mod tests;
