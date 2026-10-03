//! Web page acquisition for the built-in `fetch_webpage` skill.
//!
//! The transport is kept here so desktop and Web exits share one policy. HTML
//! readability and Markdown conversion are intentionally handled by the
//! frontend libraries in `src/lib/ai/webpage.ts`.

use std::io;
use std::time::Duration;

use error::{AppError, Result};
use reqwest::header::{ACCEPT, CONTENT_TYPE};
use reqwest::{Client, Url};
use serde::Serialize;

/// Maximum downloaded HTML size. Larger pages are rejected before parsing.
const MAX_PAGE_BYTES: usize = 2 * 1024 * 1024;
/// Whole-request ceiling, including redirects and body download.
const REQUEST_TIMEOUT: Duration = Duration::from_secs(15);
/// Redirect ceiling for normal website short links.
const MAX_REDIRECTS: usize = 5;

/// Raw page returned to the frontend readability pipeline.
#[derive(Debug, Clone, Serialize)]
pub struct WebFetchPage {
    /// URL supplied by the caller.
    pub requested_url: String,
    /// URL after redirects.
    pub final_url: String,
    /// Response media type, preserved for diagnostics.
    pub content_type: String,
    /// Downloaded document source.
    pub html: String,
}

fn fetch_error(details: impl Into<String>) -> AppError {
    AppError::Io(io::Error::other(details.into()))
}

fn validate_url(input: &str) -> Result<Url> {
    let url =
        Url::parse(input.trim()).map_err(|error| fetch_error(format!("URL 无效: {error}")))?;
    if !matches!(url.scheme(), "http" | "https") {
        return Err(fetch_error("仅允许 http 和 https URL"));
    }
    if !url.username().is_empty() || url.password().is_some() {
        return Err(fetch_error("URL 不得内嵌用户名或密码"));
    }
    if url.host_str().is_none() {
        return Err(fetch_error("URL 缺少主机名"));
    }
    Ok(url)
}

fn is_html_media_type(content_type: &str) -> bool {
    let media_type = content_type
        .split(';')
        .next()
        .unwrap_or_default()
        .trim()
        .to_ascii_lowercase();
    matches!(
        media_type.as_str(),
        "" | "text/html" | "application/xhtml+xml" | "application/octet-stream"
    )
}

/// Fetch one HTTP(S) document with bounded redirects, time, and body size.
///
/// # Errors
/// Invalid URL, unsupported response type, network/HTTP failure, timeout, or a
/// document larger than [`MAX_PAGE_BYTES`].
pub async fn fetch_page(input: &str) -> Result<WebFetchPage> {
    let url = validate_url(input)?;
    let client = Client::builder()
        .timeout(REQUEST_TIMEOUT)
        .redirect(reqwest::redirect::Policy::limited(MAX_REDIRECTS))
        .user_agent(concat!(
            "Lissio/",
            env!("CARGO_PKG_VERSION"),
            " (+https://github.com/Horldsence/lissio)"
        ))
        .build()
        .map_err(|error| fetch_error(format!("HTTP 客户端初始化失败: {error}")))?;

    let mut response = client
        .get(url)
        .header(ACCEPT, "text/html,application/xhtml+xml;q=0.9,*/*;q=0.1")
        .send()
        .await
        .map_err(|error| fetch_error(format!("网页请求失败: {error}")))?;
    let status = response.status();
    if !status.is_success() {
        return Err(fetch_error(format!("网页返回 HTTP {status}")));
    }

    let final_url = response.url().to_string();
    let content_type = response
        .headers()
        .get(CONTENT_TYPE)
        .and_then(|value| value.to_str().ok())
        .unwrap_or_default()
        .to_string();
    if !is_html_media_type(&content_type) {
        return Err(fetch_error(format!(
            "不支持的内容类型: {}",
            content_type.split(';').next().unwrap_or("unknown")
        )));
    }
    if response
        .content_length()
        .is_some_and(|length| length > MAX_PAGE_BYTES as u64)
    {
        return Err(fetch_error("网页超过 2 MiB 限制"));
    }

    let mut body = Vec::new();
    while let Some(chunk) = response
        .chunk()
        .await
        .map_err(|error| fetch_error(format!("网页读取失败: {error}")))?
    {
        if body.len().saturating_add(chunk.len()) > MAX_PAGE_BYTES {
            return Err(fetch_error("网页超过 2 MiB 限制"));
        }
        body.extend_from_slice(&chunk);
    }

    let html = String::from_utf8_lossy(&body).into_owned();
    if content_type.is_empty() && !html.to_ascii_lowercase().contains("<html") {
        return Err(fetch_error("响应不是 HTML 网页"));
    }
    Ok(WebFetchPage {
        requested_url: input.trim().to_string(),
        final_url,
        content_type,
        html,
    })
}

/// RPC-facing wrapper for the frontend readability pipeline.
///
/// # Errors
/// URL policy, request, response type, timeout, or page-size failure.
pub async fn ai_fetch_webpage_html(url: String) -> Result<WebFetchPage> {
    fetch_page(&url).await
}

#[cfg(test)]
mod tests {
    use super::*;
    use tokio::io::{AsyncReadExt as _, AsyncWriteExt as _};
    use tokio::net::TcpListener;

    async fn serve_once(response: String) -> String {
        let listener = TcpListener::bind("127.0.0.1:0")
            .await
            .expect("绑定测试端口");
        let addr = listener.local_addr().expect("读取测试端口");
        tokio::spawn(async move {
            let (mut stream, _) = listener.accept().await.expect("接受测试请求");
            let mut request = [0_u8; 4096];
            let _ = stream.read(&mut request).await.expect("读取测试请求");
            stream
                .write_all(response.as_bytes())
                .await
                .expect("写入测试响应");
        });
        format!("http://{addr}/page")
    }

    #[test]
    fn validates_supported_urls() {
        assert!(validate_url("https://example.com/docs").is_ok());
        assert!(validate_url("http://127.0.0.1:8080/page").is_ok());
        assert!(validate_url("file:///etc/passwd").is_err());
        assert!(validate_url("https://user:secret@example.com/").is_err());
        assert!(validate_url("not a url").is_err());
    }

    #[test]
    fn recognizes_html_media_types() {
        assert!(is_html_media_type("text/html; charset=utf-8"));
        assert!(is_html_media_type("application/xhtml+xml"));
        assert!(is_html_media_type(""));
        assert!(!is_html_media_type("application/pdf"));
        assert!(!is_html_media_type("image/png"));
    }

    #[tokio::test]
    async fn fetches_bounded_html_page() {
        let body = "<html><body><article>hello</article></body></html>";
        let response = format!(
            "HTTP/1.1 200 OK\r\nContent-Type: text/html; charset=utf-8\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}",
            body.len()
        );
        let url = serve_once(response).await;

        let page = fetch_page(&url).await.expect("测试网页可抓取");
        assert_eq!(page.requested_url, url);
        assert!(page.final_url.ends_with("/page"));
        assert_eq!(page.content_type, "text/html; charset=utf-8");
        assert!(page.html.contains("<article>hello</article>"));
    }

    #[tokio::test]
    async fn rejects_declared_oversized_page_before_download() {
        let response = format!(
            "HTTP/1.1 200 OK\r\nContent-Type: text/html\r\nContent-Length: {}\r\nConnection: close\r\n\r\n",
            MAX_PAGE_BYTES + 1
        );
        let url = serve_once(response).await;

        let error = fetch_page(&url).await.expect_err("超限网页应拒绝");
        assert!(error.to_string().contains("2 MiB"));
    }
}
