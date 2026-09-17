//! `backend-cli` 无界面宿主入口 — 参数解析交给 [`backend_cli::run`]。

fn main() {
    let code = backend_cli::run();
    std::process::exit(code);
}
