//! # backend-host
//!
//! 无界面后端装配与生命周期 — Tauri 组合根 (`lissio`) 与无界面 CLI
//! (`backend-cli`) 共用同一份装配, 保证 GUI 与单后端注册的适配器、
//! 点位投影、工作区恢复与收尾行为完全一致。
//!
//! 本 crate 不含 Tauri: 配置目录按平台语义解析 (与 `app_config_dir()` 一致),
//! 事件经 [`events::BackendEventSink`] 端口注入。

mod artifacts;
mod assembly;
mod config;
mod host;
mod lifecycle;

pub use artifacts::{ARTIFACT_TTL, ArtifactStaging, sanitize_file_name};
pub use assembly::{
    build_acquisition_runtime, install_envelope_engine, install_point_observer,
    install_serial_discovery,
};
pub use config::{
    APP_IDENTIFIER, CONFIG_DIR_ENV, migrate_legacy_config, platform_config_dir, resolve_config_dir,
};
pub use host::{BackendHost, assemble, teardown};
pub use lifecycle::{restore_workspace, shutdown};
