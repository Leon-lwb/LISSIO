//! HTTP / WebSocket 路由 — 健康检查 / 能力清单 / RPC / 事件推送 / 静态站点。
//!
//! 鉴权: HTTP 用 `Authorization: Bearer <token>`; 浏览器 WebSocket API 无法设置
//! 请求头, 因此升级请求用 `Sec-WebSocket-Protocol: lissio.v1, bearer.<token>`
//! 携带令牌 — 令牌不出现在 URL 里, 不会被写进访问日志。

use std::sync::Arc;

use axum::body::Bytes;
use axum::extract::ws::WebSocketUpgrade;
use axum::extract::{Request, State};
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
pub const WS_SUBPROTOCOL: &str = "lissio.v1";
/// 子协议中携带令牌的前缀。
pub const WS_TOKEN_PREFIX: &str = "bearer.";
/// 请求体上限 — 全量节点图提交可能达到数 MB。
const MAX_BODY_BYTES: usize = 32 * 1024 * 1024;

/// 构造完整路由。
pub fn router(state: Arc<ServerState>) -> Router {
    let protected = Router::new()
        .route("/api/v1/rpc", post(rpc_handler))
        .route("/api/v1/ws", get(ws_handler))
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
        .allow_methods([axum::http::Method::GET, axum::http::Method::POST])
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
    match rpc_api::dispatch(&state.host, &request.cmd, request.args).await {
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
}
