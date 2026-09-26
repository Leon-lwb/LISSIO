//! 传输编排层 — 后端扩展契约 + AcquisitionRuntime + 测试数据生成
//!
//! 负责按节点 ID 注册多路传输连接,统一收发/统计/状态接口。
//! 各类后端实现下沉到 `serial`/`network`/`can-transport` crate,由组合根注入。
//!
//! 对外暴露 `AcquisitionRuntime` (编排) 与 `LiveNodeHandle` (数据平面轻量句柄);
//! `TransportHandle` 为 crate 内部细节, 不对外导出。

pub mod can_backend;
pub mod test_data;
pub use can_backend::CanBackend;
mod byte_simulation;
pub mod device_driver;
pub mod device_factory;
