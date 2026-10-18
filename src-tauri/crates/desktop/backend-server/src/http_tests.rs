use super::{WS_TOKEN_PREFIX, constant_time_eq, subprotocol_token};
use axum::http::{HeaderMap, HeaderValue, header};
use std::net::{IpAddr, Ipv4Addr, SocketAddr};
use std::path::PathBuf;
use std::sync::Arc;
use std::sync::atomic::{AtomicU32, AtomicUsize};
use tokio::io::{AsyncReadExt, AsyncWriteExt};

use crate::{ServerConfig, ServerState};

#[test]
fn token_comparison_is_exact() {
    assert!(constant_time_eq("abc", "abc"));
    assert!(!constant_time_eq("abc", "abd"));
    assert!(!constant_time_eq("abc", "abcd"));
    assert!(!constant_time_eq("", "abc"));
}

#[test]
fn subprotocol_carries_bearer_token() {
    let mut headers = HeaderMap::new();
    let value = format!("lissio.v1, {WS_TOKEN_PREFIX}secret-token");
    headers.insert(
        header::SEC_WEBSOCKET_PROTOCOL,
        HeaderValue::from_str(&value).expect("头部应合法"),
    );
    assert_eq!(subprotocol_token(&headers), Some("secret-token"));
}

#[test]
fn missing_subprotocol_yields_no_token() {
    assert_eq!(subprotocol_token(&HeaderMap::new()), None);
}

/// 下载文件名去掉内部 token 前缀, 且不会把普通连字符名误当前缀。
#[test]
fn download_file_name_drops_internal_token_prefix() {
    let staged =
        std::path::Path::new("/tmp/downloads/0123456789abcdef0123456789abcdef-waveform.csv");
    assert_eq!(super::download_file_name(staged), "waveform.csv");
    let plain = std::path::Path::new("/tmp/downloads/my-export.csv");
    assert_eq!(super::download_file_name(plain), "my-export.csv");
}

// ===== 真实路由行为 — 令牌鉴权 (M24) 与 API 命名空间隔离 (M26) =====

const TEST_TOKEN: &str = "test-token";
/// 静态站点的 index.html 载荷标记 — 用于区分 SPA 回落与 JSON 错误信封。
const SPA_MARKER: &str = "lissio-spa-marker";

/// 装配与生产同一入口 (AppState + 驱动 + 模型目录 + AI 宿主), 不打开任何设备。
fn test_host(config_dir: &std::path::Path) -> backend_host::BackendHost {
    let (runtime, drivers) = backend_host::build_acquisition_runtime();
    let state = Arc::new(app::AppState::with_acquisition(runtime));
    state.install_model_catalog(Arc::new(backend_host::build_model_catalog(&drivers)));
    state.install_drivers(drivers);
    let sink: events::EventSinkHandle = Arc::new(events::NullEventSink);
    let ai = Arc::new(ai_host::AiHost::new(
        config_dir.to_path_buf(),
        Arc::clone(&state),
        sink.clone(),
    ));
    backend_host::BackendHost {
        state,
        ai,
        sink,
        performance: performance::PerformanceMonitor::new(),
        config_dir: config_dir.to_path_buf(),
        artifacts: None,
    }
}

/// 真实 HTTP 出口 — 路由、令牌中间件与 SPA 回落都在这一层, 只能用真实服务验证。
struct TestExit {
    addr: SocketAddr,
    server: tokio::task::JoinHandle<()>,
    dirs: Vec<PathBuf>,
}

impl TestExit {
    async fn start(tag: &str, with_static_site: bool) -> Self {
        let base = std::env::temp_dir().join(format!("lissio-http-{tag}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&base);
        let config_dir = base.join("config");
        let mut dirs = vec![base.clone()];
        let static_dir = if with_static_site {
            let site = base.join("site");
            std::fs::create_dir_all(&site).expect("静态站点目录应可创建");
            std::fs::write(
                site.join("index.html"),
                format!("<!doctype html><title>{SPA_MARKER}</title>"),
            )
            .expect("index.html 应可写");
            dirs.push(site.clone());
            Some(site)
        } else {
            None
        };
        let config = ServerConfig::resolve(
            Some(IpAddr::V4(Ipv4Addr::LOCALHOST)),
            Some(0),
            Some(TEST_TOKEN.to_string()),
            None,
            static_dir,
            Vec::new(),
            None,
            false,
            Some(config_dir.clone()),
        )
        .expect("测试配置应可解析");
        let (broadcast, _receiver) = tokio::sync::broadcast::channel(16);
        let state = Arc::new(ServerState {
            host: Arc::new(test_host(&config_dir)),
            config,
            broadcast,
            next_subscription_id: Arc::new(AtomicU32::new(0)),
            active_websockets: Arc::new(AtomicUsize::new(0)),
            active_display_subscriptions: Arc::new(AtomicUsize::new(0)),
        });
        let listener = tokio::net::TcpListener::bind(("127.0.0.1", 0))
            .await
            .expect("测试端口应可绑定");
        let addr = listener.local_addr().expect("监听地址应可用");
        let app = super::router(state);
        let server = tokio::spawn(async move {
            let _ = axum::serve(listener, app).await;
        });
        Self { addr, server, dirs }
    }

    /// 原始 HTTP/1.1 GET — 不引入客户端依赖; `Connection: close` 保证读到响应结尾。
    async fn get(&self, path: &str, token: Option<&str>) -> (u16, String) {
        let mut stream = tokio::net::TcpStream::connect(self.addr)
            .await
            .expect("应能连上测试服务");
        let auth = token.map_or_else(String::new, |value| {
            format!("Authorization: Bearer {value}\r\n")
        });
        let request =
            format!("GET {path} HTTP/1.1\r\nHost: localhost\r\nConnection: close\r\n{auth}\r\n");
        stream
            .write_all(request.as_bytes())
            .await
            .expect("请求应可写出");
        let mut raw = Vec::new();
        stream.read_to_end(&mut raw).await.expect("响应应可读完");
        let text = String::from_utf8_lossy(&raw).into_owned();
        let status = text
            .lines()
            .next()
            .and_then(|line| line.split_whitespace().nth(1))
            .and_then(|code| code.parse().ok())
            .unwrap_or(0);
        (status, text)
    }
}

impl Drop for TestExit {
    fn drop(&mut self) {
        self.server.abort();
        for dir in &self.dirs {
            let _ = std::fs::remove_dir_all(dir);
        }
    }
}

/// M24: 未鉴权调用者不得读取命令面; 同一个路由对已鉴权客户端必须仍然可用。
#[tokio::test(flavor = "multi_thread")]
async fn capabilities_requires_the_bearer_token() {
    let exit = TestExit::start("capabilities", false).await;

    let (status, body) = exit.get("/api/v1/capabilities", None).await;
    assert_eq!(status, 401, "未鉴权的能力清单必须被拒绝: {body}");
    assert!(
        !body.contains("\"supported\""),
        "未鉴权响应不得泄漏命令清单: {body}"
    );

    let (status, body) = exit.get("/api/v1/capabilities", Some(TEST_TOKEN)).await;
    assert_eq!(status, 200, "已鉴权的能力清单必须可用: {body}");
    assert!(body.contains("\"supported\""), "{body}");
}

/// 健康检查是唯一保持无鉴权的 API 路由。
#[tokio::test(flavor = "multi_thread")]
async fn health_stays_unauthenticated() {
    let exit = TestExit::start("health", false).await;
    let (status, body) = exit.get("/api/v1/health", None).await;
    assert_eq!(status, 200, "{body}");
    assert!(body.contains("\"ok\""), "{body}");
}

/// M26: 未知 API 路径是 JSON 404, 即使配了静态站点也不能回 index.html。
#[tokio::test(flavor = "multi_thread")]
async fn unknown_api_path_is_a_json_404_even_with_a_static_site() {
    let exit = TestExit::start("api-404", true).await;
    for path in ["/api/v1/definitely-not-a-route", "/api/other", "/api"] {
        let (status, body) = exit.get(path, None).await;
        assert_eq!(status, 404, "{path} 必须是 404: {body}");
        assert!(
            body.contains("\"NotFound\""),
            "{path} 必须回 JSON 错误信封: {body}"
        );
        assert!(!body.contains(SPA_MARKER), "{path} 不得回落到 SPA: {body}");
    }
}

/// SPA 深链 (非 API 路径) 仍然由 index.html 承载。
///
/// `ServeDir::not_found_service` 是 tower-http 的 SPA recipe: 它固定回
/// `404` + 回落文件的内容 (浏览器按内容渲染, 与 M26 之前的行为一致)。M26 只把
/// `/api/*` 从这条回落里摘出去, 非 API 深链的响应体因此必须仍是 index.html。
#[tokio::test(flavor = "multi_thread")]
async fn spa_deep_link_still_serves_index_html() {
    let exit = TestExit::start("spa", true).await;
    let (status, body) = exit.get("/workspace/deep/link", None).await;
    assert_eq!(
        status, 404,
        "tower-http 的 SPA recipe 固定 404 + index.html: {body}"
    );
    assert!(
        body.contains(SPA_MARKER),
        "非 API 深链必须仍由 index.html 承载: {body}"
    );
}
