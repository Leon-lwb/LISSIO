//! Exercise the same graph/open/run commands as the desktop and browser clients.

use std::sync::Arc;
use std::time::Duration;

use backend_host::BackendHost;
use events::NullEventSink;
use serde_json::{Value, json};

mod support;

fn host() -> BackendHost {
    let (runtime, drivers) = backend_host::build_acquisition_runtime();
    let state = app::AppState::with_acquisition(runtime);
    state.install_model_catalog(Arc::new(backend_host::build_model_catalog(&drivers)));
    state.install_drivers(drivers);
    let toolbox = control_api::Toolbox::from_state(&state);
    let sink: events::EventSinkHandle = Arc::new(NullEventSink);
    let config_dir = std::env::temp_dir().join("lissio-simulation-ingest-rpc-test");
    let ai = Arc::new(ai_host::AiHost::new(
        config_dir.clone(),
        toolbox.clone(),
        sink.clone(),
    ));
    BackendHost {
        state,
        toolbox,
        ai,
        sink,
        performance: performance::PerformanceMonitor::new(),
        config_dir,
        artifacts: None,
    }
}

async fn rpc(host: &BackendHost, command: &str, args: Value) -> Value {
    rpc_api::dispatch(host, command, args)
        .await
        .unwrap_or_else(|error| panic!("{command}: {error:?}"))
}

fn slcan_document() -> Value {
    let config = serde_json::to_value(data_model::SlcanConfig::default()).unwrap();
    let protocol = schema_types::ProtocolConfig::Slcan;
    let schema = schema_types::schema_from_protocol_config(&protocol);
    json!({
        "id": "source", "tabId": "tab", "label": "Slcan",
        "layout": { "x": 0, "y": 0, "width": null, "height": null },
        "kind": "device",
        "config": { "node": {
            "id": "source", "name": "Slcan", "driver": "slcan",
            "schemaVersion": 1, "enabled": true, "capabilityEndpointId": "device",
            "config": config,
            "children": [
                {
                    "id": "parser", "name": "Slcan parser", "driver": "protocol-engine",
                    "schemaVersion": 1, "enabled": true, "children": [],
                    "config": { "protocol": protocol, "convertTo": null, "schema": schema }
                },
                {
                    "id": "source::simulation", "name": "simulation", "driver": "simulation",
                    "schemaVersion": 1, "enabled": true, "children": [],
                    "config": data_model::device::SimulationConfig {
                        sample_rate: 100,
                        // Graph compilation must derive SLCAN from the protocol child.
                        encoding: None,
                        ..Default::default()
                    }
                }
            ]
        } }
    })
}

#[tokio::test]
async fn slcan_simulation_reaches_can_panel_through_production_rpc_commands() {
    support::install_test_logger();
    let host = host();
    rpc(
        &host,
        "update_tab_graph",
        json!({
            "tabId": "tab", "documents": [slcan_document()], "edges": []
        }),
    )
    .await;
    let opened = rpc(
        &host,
        "open_acquisition_endpoint",
        json!({ "nodeId": "source" }),
    )
    .await;
    assert_eq!(opened["state"]["state"], "online");
    rpc(&host, "workspace_run", json!({ "action": "start" })).await;
    let batch = tokio::time::timeout(Duration::from_secs(2), async {
        loop {
            // `get_recent_can_frames` 的线缆形状是 `CanFrameBatch` 对象 {seq, frames} —
            // 帧在 `frames` 键下。对顶层整体做数组判断会恒为空, 形成假失败。
            let batch = rpc(&host, "get_recent_can_frames", json!({ "count": 10 })).await;
            if batch["frames"]
                .as_array()
                .is_some_and(|frames| !frames.is_empty())
            {
                break batch;
            }
            tokio::time::sleep(Duration::from_millis(10)).await;
        }
    })
    .await
    .expect("SLCAN test bytes must reach the CAN panel");
    assert_eq!(batch["seq"], 0, "同步快照必须是非流式 seq=0");
    let frames = batch["frames"].as_array().expect("frames 必须是数组");
    assert_eq!(frames[0]["dlc"], 8);
    let node_id = data_model::device_tree::NodeId::new("source").unwrap();
    assert!(host.state.transport.stats(&node_id).unwrap().rx_bytes > 0);
    rpc(
        &host,
        "close_acquisition_endpoint",
        json!({ "nodeId": "source" }),
    )
    .await;
}

/// 线缆形状守卫: `get_recent_can_frames` 必须返回对象 {seq, frames}。
/// 这条断言的存在是为了让「把响应当数组读」的测量错误在源头暴露, 而不是
/// 表现成被测系统无数据的假失败。
#[tokio::test]
async fn recent_can_frames_wire_shape_is_a_batch_object() {
    support::install_test_logger();
    let host = host();
    let response = rpc(&host, "get_recent_can_frames", json!({ "count": 4 })).await;
    let object = response.as_object().expect("响应必须是对象, 不是数组");
    assert_eq!(object.len(), 2, "CanFrameBatch 只含 seq 与 frames");
    assert!(object.contains_key("seq"), "缺少 seq");
    assert!(object.contains_key("frames"), "缺少 frames");
    assert_eq!(response["seq"], 0);
    assert!(response["frames"].is_array());
}
