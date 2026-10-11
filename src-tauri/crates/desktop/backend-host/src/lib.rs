//! # backend-host
//!
//! 无界面后端装配与生命周期 — Tauri 组合根 (`lissio`) 与无界面 CLI
//! (`backend-cli`) 共用同一份装配, 保证 GUI 与单后端注册的适配器、
//! 点位投影、工作区恢复与收尾行为完全一致。
//!
//! 本 crate 不含 Tauri: 配置目录按平台语义解析 (与 `app_config_dir()` 一致),
//! 事件经 [`events::BackendEventSink`] 端口注入。用户设置的持久化文件
//! (`settings.json`) 也由本 crate 统一读写, 桌面 / server / CLI 三出口回放同一份。

mod artifacts;
mod assembly;
mod config;
mod host;
mod lifecycle;
mod settings;
mod token;

pub use artifacts::{ARTIFACT_TTL, ArtifactStaging, sanitize_file_name};
pub use assembly::{
    build_acquisition_runtime, build_model_catalog, install_envelope_engine,
    install_point_observer, install_serial_discovery,
};
pub use config::{APP_IDENTIFIER, CONFIG_DIR_ENV, platform_config_dir, resolve_config_dir};
pub use host::{BackendHost, assemble, teardown};
pub use lifecycle::{restore_workspace, shutdown};
pub use settings::{RECORDING_ENABLED_DEFAULT, SETTINGS_FILE_NAME, SETTINGS_KEY, SettingsStore};
pub use token::random_hex;
