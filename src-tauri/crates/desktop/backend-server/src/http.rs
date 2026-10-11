//! HTTP / WebSocket 路由 — 健康检查 / 能力清单 / RPC / 事件推送 / 静态站点。
//!
//! 鉴权: HTTP 用 `Authorization: Bearer <token>`; 浏览器 WebSocket API 无法设置
//! 请求头, 因此升级请求用 `Sec-WebSocket-Protocol: lissio.v2, bearer.<token>`
//! 携带令牌 — 令牌不出现在 URL 里, 不会被写进访问日志。

use std::sync::Arc;

use axum::body::Bytes;
use axum::extract::ws::WebSocketUpgrade;
use axum::extract::{Path, Request, State};
use axum::http::{HeaderMap, StatusCode, header};
use axum::middleware::Next;
use axum::response::{IntoResponse, Response};
use axum::routing::{get, post};
use axum::{Json, Router};
use serde_json::{Value, json};
use tower_http::cors::{AllowOrigin, CorsLayer};
use tower_http::limit::RequestBodyLimitLayer;
use tower_http::services::{ServeDir, ServeFile};

use crate::ServerState;
use crate::frames::{PROTOCOL_VERSION, RpcRequest, RpcResponse};
use crate::session::SessionContext;

/// WebSocket 子协议标识 (浏览器端第一个提议值)。
pub const WS_SUBPROTOCOL: &str = "lissio.v2";
/// 子协议中携带令牌的前缀。
pub const WS_TOKEN_PREFIX: &str = "bearer.";
/// 请求体上限 — 全量节点图提交可能达到数 MB。
const MAX_BODY_BYTES: usize = 32 * 1024 * 1024;

/// 构造完整路由。
pub fn router(state: Arc<ServerState>) -> Router {
    let protected = Router::new()
        .route("/api/v1/rpc", post(rpc_handler))
        .route("/api/v1/handshake", get(handshake))
        .route("/api/v1/ws", get(ws_handler))
        .route("/api/v1/download/{token}", get(download_handler))
        .route("/api/v1/settings", get(get_settings).put(put_settings))
        .route_layer(axum::middleware::from_fn_with_state(
            state.clone(),
            require_token,
        ));

    let mut app = Router::new()
        .route("/api/v1/health", get(health))
        .route("/api/v1/capabilities", get(capabilities))
        .merge(protected);

    if let Some(dir) = state.config.static_dir.clone() {
        // SPA: 未命中的路径回落到 index.html (前端路由)
        app = app.fallback_service(
            ServeDir::new(dir.clone()).not_found_service(ServeFile::new(dir.join("index.html"))),
        );
    }

    let mut app = app
        .with_state(state.clone())
        .layer(RequestBodyLimitLayer::new(MAX_BODY_BYTES));

    if !state.config.cors_origins.is_empty() {
        app = app.layer(cors_layer(&state.config.cors_origins));
    }
    app
}

/// 跨源白名单 — 空列表时不挂 CORS 层 (同源部署无需跨源, 也避免误开放)。
fn cors_layer(origins: &[String]) -> CorsLayer {
    let allowed: Vec<header::HeaderValue> = origins
        .iter()
        .filter_map(|origin| origin.parse().ok())
        .collect();
    CorsLayer::new()
        .allow_origin(AllowOrigin::list(allowed))
        .allow_methods([
            axum::http::Method::GET,
            axum::http::Method::POST,
            // 设置整表覆盖用 PUT — 跨源部署时预检必须放行
            axum::http::Method::PUT,
        ])
        .allow_headers([header::AUTHORIZATION, header::CONTENT_TYPE])
}

/// 健康检查 — 无鉴权, 供探针与 CLI 自检使用。
async fn health() -> Json<Value> {
    Json(json!({ "status": "ok", "protocol": PROTOCOL_VERSION }))
}

/// 能力清单 — 前端据此隐藏本出口不支持的 UI。
async fn capabilities(State(state): State<Arc<ServerState>>) -> Json<Value> {
    Json(serde_json::to_value(state.capabilities()).unwrap_or(Value::Null))
}

/// Authenticated handshake used before the React application mounts.
async fn handshake(State(state): State<Arc<ServerState>>) -> Json<Value> {
    Json(json!({
        "status": "ok",
        "version": env!("CARGO_PKG_VERSION"),
        "protocol": PROTOCOL_VERSION,
        "instance_id": format!("{}-{}", std::process::id(), state.config.http_port),
        "capabilities": state.capabilities(),
    }))
}

/// 导出产物下载 — 只服务暂存区登记过的 token, **不接受任意服务器路径**。
///
/// 与其它受保护路由共用 `require_token`, 因此链接可以安全地直接发给浏览器;
/// 暂存文件名里的内部 token 前缀不外泄。
async fn download_handler(
    State(state): State<Arc<ServerState>>,
    Path(token): Path<String>,
) -> Response {
    let Some(artifacts) = state.host.artifacts.as_ref() else {
        return error_response(StatusCode::NOT_FOUND, "NotFound", "本出口未启用产物下载");
    };
    let Some(path) = artifacts.resolve(&token) else {
        return error_response(StatusCode::NOT_FOUND, "NotFound", "下载链接不存在或已过期");
    };
    let bytes = match tokio::fs::read(&path).await {
        Ok(bytes) => bytes,
        Err(error) => {
            return error_response(
                StatusCode::INTERNAL_SERVER_ERROR,
                "IoError",
                &format!("读取导出产物失败: {error}"),
            );
        }
    };
    (
        [
            (header::CONTENT_TYPE, "text/csv; charset=utf-8".to_string()),
            (
                header::CONTENT_DISPOSITION,
                format!("attachment; filename=\"{}\"", download_file_name(&path)),
            ),
            (header::CACHE_CONTROL, "no-store".to_string()),
        ],
        bytes,
    )
        .into_response()
}

/// 从暂存路径还原用户可见文件名 — 去掉 `<token>-` 内部前缀。
fn download_file_name(path: &std::path::Path) -> String {
    let raw = path.file_name().map_or_else(
        || "export.csv".to_string(),
        |name| name.to_string_lossy().into_owned(),
    );
    match raw.split_once('-') {
        Some((prefix, rest))
            if !rest.is_empty() && prefix.chars().all(|ch| ch.is_ascii_hexdigit()) =>
        {
            rest.to_string()
        }
        _ => raw,
    }
}

/// Read the shared Desktop/Web settings document from the assembled backend.
async fn get_settings(State(state): State<Arc<ServerState>>) -> Response {
    match settings_store(&state).read() {
        Ok(document) => Json(Value::Object(document)).into_response(),
        Err(error) => error_response(StatusCode::INTERNAL_SERVER_ERROR, "IoError", &error),
    }
}

/// Persist the complete settings document before acknowledging the write.
async fn put_settings(State(state): State<Arc<ServerState>>, body: Bytes) -> Response {
    let parsed: Value = match serde_json::from_slice(&body) {
        Ok(parsed) => parsed,
        Err(error) => {
            return error_response(StatusCode::BAD_REQUEST, "InvalidBody", &error.to_string());
        }
    };
    let Value::Object(document) = parsed else {
        return error_response(
            StatusCode::BAD_REQUEST,
            "InvalidBody",
            "设置文档必须是 JSON 对象",
        );
    };
    match settings_store(&state).write(&document) {
        Ok(()) => Json(json!({ "ok": true })).into_response(),
        Err(error) => error_response(StatusCode::INTERNAL_SERVER_ERROR, "IoError", &error),
    }
}

/// 设置存储 — 落在已装配宿主的配置目录 (与桌面壳同一位置)。
///
/// 读写实现由 `backend-host` 拥有: 装配期回放设置 (录制总开关) 走的是同一份
/// 解析, 出口之间不会漂移。
fn settings_store(state: &ServerState) -> backend_host::SettingsStore {
    backend_host::SettingsStore::new(&state.host.config_dir)
}

/// HTTP-RPC — 单条或数组 (数组用于启动时的并发突发, 减少往返)。
async fn rpc_handler(State(state): State<Arc<ServerState>>, body: Bytes) -> Response {
    let parsed: Value = match serde_json::from_slice(&body) {
        Ok(parsed) => parsed,
        Err(error) => {
            return error_response(StatusCode::BAD_REQUEST, "InvalidBody", &error.to_string());
        }
    };
    match parsed {
        Value::Array(items) => {
            let mut responses = Vec::with_capacity(items.len());
            for item in items {
                responses.push(handle_one(&state, item).await);
            }
            Json(Value::Array(
                responses
                    .into_iter()
                    .map(|response| serde_json::to_value(response).unwrap_or(Value::Null))
                    .collect(),
            ))
            .into_response()
        }
        single => {
            Json(serde_json::to_value(handle_one(&state, single).await).unwrap_or(Value::Null))
                .into_response()
        }
    }
}

/// 单条请求 → 响应 (命令未接入时不做参数解包, 直接返回不支持)。
async fn handle_one(state: &ServerState, request: Value) -> RpcResponse {
    let request: RpcRequest = match serde_json::from_value(request) {
        Ok(request) => request,
        Err(error) => {
            return RpcResponse::failure(
                Value::Null,
                json!({ "kind": "InvalidRequest", "message": error.to_string() }),
            );
        }
    };
    if !rpc_api::catalog::is_supported(&request.cmd) {
        return RpcResponse::failure(
            request.id,
            serde_json::to_value(rpc_api::RpcError::unsupported(&request.cmd))
                .unwrap_or(Value::Null),
        );
    }
    let started = std::time::Instant::now();
    let response = rpc_api::dispatch(&state.host, &request.cmd, request.args).await;
    state
        .host
        .performance
        .record_rpc(started.elapsed(), response.is_ok());
    match response {
        Ok(result) => RpcResponse::success(request.id, result),
        Err(error) => RpcResponse::failure(
            request.id,
            serde_json::to_value(error).unwrap_or(Value::Null),
        ),
    }
}

/// WebSocket 升级 — 校验令牌后交出连接。
async fn ws_handler(State(state): State<Arc<ServerState>>, upgrade: WebSocketUpgrade) -> Response {
    // 子协议协商: 只回我们认识的那个, 令牌留在请求头里
    let upgrade = upgrade.protocols([WS_SUBPROTOCOL]);
    let context = SessionContext {
        host: state.host.clone(),
        broadcast: state.broadcast.clone(),
        next_subscription_id: state.next_subscription_id.clone(),
        active_websockets: state.active_websockets.clone(),
        active_display_subscriptions: state.active_display_subscriptions.clone(),
        performance: state.host.performance.clone(),
    };
    upgrade.on_upgrade(move |socket| async move {
        crate::session::run(socket, context).await;
    })
}

/// 令牌校验中间件 — 同时接受 `Authorization` 与 WS 子协议两种携带方式。
async fn require_token(
    State(state): State<Arc<ServerState>>,
    request: Request,
    next: Next,
) -> Response {
    let expected = state.config.token.as_str();
    let provided = bearer_token(request.headers()).or_else(|| subprotocol_token(request.headers()));
    match provided {
        Some(token) if constant_time_eq(token, expected) => next.run(request).await,
        _ => error_response(
            StatusCode::UNAUTHORIZED,
            "Unauthorized",
            "缺少或无效的访问令牌",
        ),
    }
}

/// 从 `Authorization: Bearer <token>` 提取令牌。
fn bearer_token(headers: &HeaderMap) -> Option<&str> {
    headers
        .get(header::AUTHORIZATION)
        .and_then(|value| value.to_str().ok())
        .and_then(|value| value.strip_prefix("Bearer "))
        .map(str::trim)
        .filter(|token| !token.is_empty())
}

/// 从 `Sec-WebSocket-Protocol` 的 `bearer.<token>` 项提取令牌。
fn subprotocol_token(headers: &HeaderMap) -> Option<&str> {
    headers
        .get(header::SEC_WEBSOCKET_PROTOCOL)
        .and_then(|value| value.to_str().ok())
        .and_then(|value| {
            value
                .split(',')
                .map(str::trim)
                .find_map(|item| item.strip_prefix(WS_TOKEN_PREFIX))
        })
        .map(str::trim)
        .filter(|token| !token.is_empty())
}

/// 定长比较 — 避免按前缀提前返回泄漏令牌长度与内容。
fn constant_time_eq(provided: &str, expected: &str) -> bool {
    let provided = provided.as_bytes();
    let expected = expected.as_bytes();
    if provided.len() != expected.len() {
        return false;
    }
    provided
        .iter()
        .zip(expected)
        .fold(0_u8, |acc, (a, b)| acc | (a ^ b))
        == 0
}

/// 统一错误响应 (与 RPC 错误信封同形, 便于前端单点处理)。
fn error_response(status: StatusCode, kind: &str, message: &str) -> Response {
    (
        status,
        Json(json!({ "ok": false, "error": { "kind": kind, "message": message } })),
    )
        .into_response()
}

#[cfg(test)]
mod tests {
    use super::{WS_TOKEN_PREFIX, constant_time_eq, subprotocol_token};
    use axum::http::{HeaderMap, HeaderValue, header};

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
}
