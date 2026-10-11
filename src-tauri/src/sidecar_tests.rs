use super::*;

#[test]
fn sidecar_allows_vite_and_tauri_webview_origins() {
    let mut command = Command::new("lissio-server");
    append_desktop_cors_args(&mut command);
    let args = command
        .get_args()
        .map(|arg| arg.to_string_lossy().into_owned())
        .collect::<Vec<_>>();

    for origin in DESKTOP_CORS_ORIGINS {
        assert!(
            args.windows(2)
                .any(|pair| pair == ["--cors-origin", *origin]),
            "missing CORS origin {origin} in {args:?}"
        );
    }
}
