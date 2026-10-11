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
