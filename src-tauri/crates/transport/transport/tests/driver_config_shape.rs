//! 字节驱动配置形状契约 —— `NodeDecl.config` 是**驱动负载**(扁平参数),
//! 不是 `TransportConfig` 的 `{ kind, params }` 信封。
//!
//! 三处必须同形, 缺一即「设备属性面板全空 / 连接时配置校验失败」:
//! - `NodeDriver::default_config` 直接写进设备文档 → 必须是负载
//! - `config_schema` 的属性名 (属性面板按名字读写) → 必须与负载键一一对应
//! - `NodeDriver::validate` 收到的 `config` → 必须是负载
//!   ([`ByteDeviceFactory::config`] 把它整体放进 `params`)
//!
//! 端到端测试 (`manager_tests` / `device-tree` production tests) 建节点时也一律
//! 用 `defaults["params"]`, 本文件把该约定固定成可执行断言。

use acquisition::{AcquisitionRunState, ExecutionGate, TransportBackend, TransportConnection};
use async_trait::async_trait;
use data_model::device_tree::NodeRole;
use data_model::{SerialConfig, TransportConfig};
use device_tree::NodeDriver;
use schema_types::TestDataLink;
use serde_json::Value;
use std::sync::Arc;
use transport::device_driver::ByteDeviceDriver;

/// 只用于装配驱动 (validate 不打开端口); 任何 open 都是测试写错。
struct NeverOpenBackend;

#[async_trait]
impl TransportBackend for NeverOpenBackend {
    fn name(&self) -> &'static str {
        "never-open"
    }

    fn accepts(&self, _: &TransportConfig) -> bool {
        true
    }

    async fn open(
        &self,
        _: TransportConfig,
        _: TestDataLink,
    ) -> error::Result<TransportConnection> {
        unreachable!("config shape contract never opens a session")
    }
}

fn serial_driver() -> Arc<ByteDeviceDriver> {
    let execution = ExecutionGate::new(AcquisitionRunState::Stopped);
    Arc::new(ByteDeviceDriver::new(
        "serial",
        "Serial",
        TransportConfig::Serial(SerialConfig::default()),
        Arc::new(NeverOpenBackend),
        NodeRole::Bus,
        execution,
    ))
}

/// 出厂 `SerialConfig` 的负载形态 — 也是节点文档里 `config` 的期望形态。
fn serial_payload() -> Value {
    let envelope = serde_json::to_value(TransportConfig::Serial(SerialConfig::default()))
        .expect("transport config serializes");
    envelope["params"].clone()
}

#[test]
fn default_config_is_the_driver_payload_not_the_transport_envelope() {
    let driver = serial_driver();
    let default_config = driver
        .default_config("node-1")
        .expect("byte driver declares a default config");

    assert_eq!(
        default_config,
        serial_payload(),
        "default_config 必须是驱动负载 (扁平参数); 写成 {{kind, params}} 信封会让属性面板读到空值"
    );
    assert!(
        default_config.get("kind").is_none() && default_config.get("params").is_none(),
        "default_config 不得携带 kind/params 信封: {default_config}"
    );
}

#[test]
fn config_schema_properties_match_the_default_payload_keys() {
    let driver = serial_driver();
    let default_config = driver.default_config("node-1").expect("default config");
    let schema = driver.config_schema();
    let mut property_keys: Vec<&str> = schema
        .json_schema
        .get("properties")
        .and_then(Value::as_object)
        .expect("device schema declares properties")
        .keys()
        .map(String::as_str)
        .collect();
    let mut payload_keys: Vec<&str> = default_config
        .as_object()
        .expect("payload is an object")
        .keys()
        .map(String::as_str)
        .collect();
    property_keys.sort_unstable();
    payload_keys.sort_unstable();

    assert_eq!(
        property_keys, payload_keys,
        "属性面板按 schema 属性名读写 config; 两者不同名即所有字段显示为空/首选项"
    );
}

#[test]
fn validate_accepts_the_payload() {
    let driver = serial_driver();
    assert!(
        driver.validate(&serial_payload(), None).is_ok(),
        "驱动负载必须能构成驱动配置"
    );
}

#[test]
fn validate_rejects_the_transport_envelope() {
    let driver = serial_driver();
    let envelope =
        serde_json::to_value(TransportConfig::Serial(SerialConfig::default())).expect("serializes");
    assert!(
        driver.validate(&envelope, None).is_err(),
        "{{kind, params}} 信封不能当驱动配置使用 (会缺 port_name/baud_rate 等字段)"
    );
}
