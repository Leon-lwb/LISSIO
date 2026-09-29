//! 描述管线在线缆上的形状契约与端口推导回归。
//!
//! 三个曾经同时成立的缺陷:
//!
//! 1. **顶层参数名被改写** — `dispatch` 对 args 做 Tauri 式顶层 camelCase → snake_case
//!    归一, 但 `describe_node_documents` 的参数对象本身就是请求 DTO。`requestRevision`
//!    被改成 `request_revision`, serde 契约却是 camelCase → 每次调用整批
//!    `InvalidArguments`, 前端 `markFailed()`, 全部节点端口丢失且不自愈。
//! 2. **边引用的线缆命名** — `GraphEdgeRef` 曾是全仓唯一 snake_case DTO, 前端发
//!    `sourceHandle` 被 serde 静默丢弃, `source_handle` 退化为 `None` → RawData 的
//!    `src:*` 动态端口推导不到任何边 (正是「RawData 端口丢失」且无任何报错)。
//! 3. **信封整体反序列化** — 画布上任意一条结构不合法的文档让整批 `invalid_args`。
//!    现由 `DescribeBatch` 逐条解码, 单条失败只影响自己。
//!
//! 本文件全程使用前端真实 payload (camelCase + `sourceHandle`), 因此它同时是
//! 线缆形状的守卫: 任何一侧再退回 snake_case 都会让这里变红。

mod support;

use serde_json::{Value, json};

/// 与前端 `nodeDocument()` 输出同形的 widget 文档。
fn widget_document(id: &str, widget_kind: &str, params: Value) -> Value {
    json!({
        "id": id,
        "tabId": "t1",
        "label": widget_kind,
        "layout": { "x": 0.0, "y": 0.0, "width": null, "height": null },
        "kind": "widget",
        "config": { "widgetKind": widget_kind, "params": params, "customPorts": null },
    })
}

/// 未知 kind 的文档 — 前端 `node.type` 未映射时的真实形态。
fn unknown_kind_document(id: &str) -> Value {
    json!({
        "id": id,
        "tabId": "t1",
        "label": "Mystery",
        "layout": { "x": 0.0, "y": 0.0, "width": null, "height": null },
        "kind": "mystery",
        "config": {},
    })
}

/// 与前端 `documentsOfStore()` 输出同形的边。
///
/// 边引用**刻意**沿用图提交 DTO 的 snake_case (`source_handle`), 见 `GraphEdgeRef`;
/// 前端必须用生成类型构造。用 camelCase 写在这里不会报错 —— serde 会静默忽略
/// `sourceHandle` 并把 `source_handle` 留成 `None`, 那正是「RawData 端口丢失」的成因。
fn edge(source: &str, source_handle: Value, target: &str, target_handle: Value) -> Value {
    json!({
        "source": source,
        "source_handle": source_handle,
        "target": target,
        "target_handle": target_handle,
    })
}

async fn describe_with(
    host: &backend_host::BackendHost,
    documents: Vec<Value>,
    edges: Vec<Value>,
) -> Value {
    support::rpc(
        host,
        "describe_node_documents",
        json!({ "documents": documents, "edges": edges, "requestRevision": 42 }),
    )
    .await
}

async fn describe(host: &backend_host::BackendHost, documents: Vec<Value>) -> Value {
    describe_with(host, documents, Vec::new()).await
}

#[tokio::test]
async fn one_invalid_document_does_not_strip_ports_from_the_rest() {
    support::install_test_logger();
    let host = support::host();
    let response = describe(
        &host,
        vec![
            widget_document("w-math", "Math", json!({ "op": "add", "inputCount": 3 })),
            unknown_kind_document("w-bad"),
            widget_document("w-text", "TextDisplay", json!({})),
        ],
    )
    .await;

    assert_eq!(response["requestRevision"], 42, "请求版本号必须原样回传");
    let nodes = response["nodes"].as_array().expect("nodes 必须是数组");
    assert_eq!(
        nodes.len(),
        3,
        "每条文档都必须得到一条描述 — 少给即等于端口丢失"
    );
    // 坏节点两侧的合法节点必须照常拿到完整端口
    assert_eq!(nodes[0]["nodeId"], "w-math");
    assert_eq!(nodes[0]["status"], "ready");
    assert_eq!(nodes[0]["inputs"].as_array().expect("inputs").len(), 3);
    assert_eq!(nodes[1]["nodeId"], "w-bad");
    assert_eq!(nodes[1]["status"], "unsupported");
    assert!(
        nodes[1]["issues"]
            .as_array()
            .is_some_and(|issues| !issues.is_empty()),
        "失败节点必须带上可归因的结构化问题"
    );
    assert_eq!(nodes[2]["nodeId"], "w-text");
    assert_eq!(nodes[2]["status"], "ready");
    assert_eq!(nodes[2]["defaultInput"], "text");
}

#[tokio::test]
async fn a_fully_invalid_batch_still_answers_every_node() {
    support::install_test_logger();
    let host = support::host();
    let response = describe(
        &host,
        (0..3)
            .map(|index| unknown_kind_document(&format!("bad{index}")))
            .collect(),
    )
    .await;

    let nodes = response["nodes"].as_array().expect("nodes 必须是数组");
    assert_eq!(nodes.len(), 3);
    for (index, node) in nodes.iter().enumerate() {
        assert_eq!(node["nodeId"], format!("bad{index}"));
        assert_eq!(node["status"], "unsupported");
    }
}

/// RawData 的动态 `src:*` 输入口唯一来源是 `sourceHandle`。
///
/// 这条测试是「RawData 端口丢失」最直接的守卫: 只要 `GraphEdgeRef` 的线缆命名与
/// 前端不一致, serde 就会把 `sourceHandle` 当未知字段丢掉, 端口静默退化为默认单口。
#[tokio::test]
async fn raw_data_ports_are_derived_from_the_source_handle() {
    support::install_test_logger();
    let host = support::host();
    let response = describe_with(
        &host,
        vec![widget_document("w-raw", "RawData", json!({}))],
        vec![
            edge("dev-1", json!("rx"), "w-raw", json!(null)),
            edge("dev-2", json!("out"), "w-raw", json!("src:dev-2:out")),
            // 与第一条同源同口 → 去重, 不得产生第二个端口
            edge("dev-1", json!("rx"), "w-raw", json!(null)),
            // 指向别的节点 → 与本节点无关
            edge("dev-3", json!("rx"), "w-other", json!(null)),
        ],
    )
    .await;

    let nodes = response["nodes"].as_array().expect("nodes 必须是数组");
    assert_eq!(nodes.len(), 1);
    assert_eq!(
        nodes[0]["hint"]["kind"], "rawDataRouting",
        "命中动态端口路径"
    );
    let handles: Vec<&str> = nodes[0]["inputs"]
        .as_array()
        .expect("inputs 必须是数组")
        .iter()
        .map(|input| input["handle"].as_str().expect("handle 必须是字符串"))
        .collect();
    assert_eq!(
        handles,
        vec!["src:dev-1:rx", "src:dev-2:out"],
        "每个 (source, sourceHandle) 唯一组合一个动态端口, 顺序稳定且去重"
    );
    // rx / out 是字节域; 其余句柄是 F32 域
    assert_eq!(nodes[0]["inputs"][0]["domain"], "Bytes");
    assert_eq!(nodes[0]["inputs"][1]["domain"], "Bytes");
    assert_eq!(nodes[0]["defaultInput"], "src:dev-1:rx");
}

/// 线缆形状是**严格** camelCase: 载荷型命令不参与顶层参数名归一。
///
/// 这条测试把「跳过归一」钉成契约而不是实现细节 —— 若有人把
/// `describe_node_documents` 从 `catalog::PAYLOAD_ARGS` 移除, 这里立刻变红。
#[tokio::test]
async fn snake_case_payload_is_rejected_instead_of_silently_accepted() {
    support::install_test_logger();
    let host = support::host();
    let error = rpc_api::dispatch(
        &host,
        "describe_node_documents",
        json!({
            "documents": [],
            "edges": [],
            "request_revision": 7,
        }),
    )
    .await
    .expect_err("snake_case 顶层键不是本命令的线缆契约");
    assert_eq!(error.kind, "InvalidArguments");
    assert!(
        error.message.contains("requestRevision"),
        "错误必须指出缺失的是契约字段名: {}",
        error.message
    );
}

/// 信封本身的协议错误仍必须整批拒绝 — 逐节点容错不得被误用为「任何垃圾都接受」。
#[tokio::test]
async fn envelope_level_errors_are_still_rejected() {
    support::install_test_logger();
    let host = support::host();
    let error = rpc_api::dispatch(
        &host,
        "describe_node_documents",
        json!({ "documents": "not-an-array", "edges": [], "requestRevision": 1 }),
    )
    .await
    .expect_err("documents 不是数组属协议错误");
    assert_eq!(error.kind, "InvalidArguments");
    assert!(
        error.message.contains("describe request decode failed"),
        "错误消息须指向信封解码失败: {}",
        error.message
    );
}

#[tokio::test]
async fn valid_batch_is_unaffected_by_the_tolerance_path() {
    support::install_test_logger();
    let host = support::host();
    let response = describe(
        &host,
        vec![
            widget_document("w-math", "Math", json!({ "op": "sqrt", "inputCount": 4 })),
            widget_document("w-text", "TextDisplay", json!({})),
        ],
    )
    .await;

    let nodes = response["nodes"].as_array().expect("nodes 必须是数组");
    assert_eq!(nodes.len(), 2);
    assert!(nodes.iter().all(|node| node["status"] == "ready"));
    // sqrt 是一元算子: inputCount 被算子元数覆盖
    assert_eq!(nodes[0]["inputs"].as_array().expect("inputs").len(), 1);
    assert_eq!(nodes[0]["defaultOutput"], "result");
}

/// `prepare_node_documents` 同为载荷型命令 — 目录版本守卫必须真正生效。
///
/// 归一错位的后果在这里是**静默**的: `catalogRevision` 被改名后
/// `#[serde(default)]` 让字段落空为 `""`, 守卫被跳过, 目录已刷新的客户端仍会被
/// 静默接受。修复前本测试的第二段会返回 `Ok`。
#[tokio::test]
async fn prepare_enforces_the_catalog_revision_guard() {
    support::install_test_logger();
    let host = support::host();
    let catalog = support::rpc(&host, "get_model_catalog", json!({})).await;
    let revision = catalog["revision"]
        .as_str()
        .expect("目录必须带 revision")
        .to_owned();

    let error = rpc_api::dispatch(
        &host,
        "prepare_node_documents",
        json!({ "catalogRevision": "stale-revision", "operations": [] }),
    )
    .await
    .expect_err("过期目录版本必须被拒");
    assert_eq!(error.kind, "CatalogRevisionMismatch");
    assert_eq!(
        error.data.as_ref().expect("错误须携带期望版本")["expected"],
        revision
    );

    let accepted = support::rpc(
        &host,
        "prepare_node_documents",
        json!({ "catalogRevision": revision, "operations": [] }),
    )
    .await;
    assert_eq!(accepted["catalogRevision"], revision);
    assert!(
        accepted["results"]
            .as_array()
            .expect("results 必须是数组")
            .is_empty()
    );
}
