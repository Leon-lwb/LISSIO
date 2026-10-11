//! 集成测试共用支持 — 日志安装与生产路径的 host/rpc 装配。
//!
//! `cargo test` 默认不安装任何 logger, 而数据平面的断链诊断 (`DataPlaneState::warn_feed_gap_once`)
//! 与协议/评估 worker 的运行状态只走 `log`。测试若不显式安装实现, 这些一次性警告
//! 完全不可见 —— 「没有日志」会被误读成「没有断链」。
#![allow(dead_code)]

use std::sync::Arc;
use std::sync::OnceLock;

use backend_host::BackendHost;
use events::NullEventSink;
use serde_json::Value;

struct StderrLogger;

impl log::Log for StderrLogger {
    fn enabled(&self, metadata: &log::Metadata) -> bool {
        metadata.level() <= log::Level::Debug
    }

    fn log(&self, record: &log::Record) {
        if self.enabled(record.metadata()) {
            println!(
                "TEST-LOG [{:>5}] {} — {}",
                record.level(),
                record.target(),
                record.args()
            );
        }
    }

    fn flush(&self) {}
}

static LOGGER: StderrLogger = StderrLogger;
static INSTALLED: OnceLock<()> = OnceLock::new();

/// 安装一次性测试日志器 (每个测试二进制进程只生效一次)。
pub fn install_test_logger() {
    INSTALLED.get_or_init(|| {
        // 同一进程可能已有其他测试安装过日志器 — 此时保持既有实现, 不视为失败。
        let _ = log::set_logger(&LOGGER);
        log::set_max_level(log::LevelFilter::Debug);
    });
}

/// 装配与桌面端/浏览器端同一套生产命令路径 (AppState + 目录 + 驱动 + 工具箱)。
pub fn host() -> BackendHost {
    let (runtime, drivers) = backend_host::build_acquisition_runtime();
    let state = Arc::new(app::AppState::with_acquisition(runtime));
    state.install_model_catalog(Arc::new(backend_host::build_model_catalog(&drivers)));
    state.install_drivers(drivers);
    let sink: events::EventSinkHandle = Arc::new(NullEventSink);
    let config_dir = std::env::temp_dir().join("lissio-rpc-api-test-support");
    let ai = Arc::new(ai_host::AiHost::new(
        config_dir.clone(),
        Arc::clone(&state),
        sink.clone(),
    ));
    BackendHost {
        state,
        ai,
        sink,
        performance: performance::PerformanceMonitor::new(),
        config_dir,
        artifacts: None,
    }
}

/// 走生产 dispatch — 命令名与参数形状与 Tauri IPC / HTTP-RPC 完全一致。
pub async fn rpc(host: &BackendHost, command: &str, args: Value) -> Value {
    rpc_api::dispatch(host, command, args)
        .await
        .unwrap_or_else(|error| panic!("{command}: {error:?}"))
}
