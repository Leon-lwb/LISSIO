//! 节点图 — tabs / outputs / update / connect / disconnect。

use control_api::tools;
use serde_json::Value;

use super::GraphAction;
use crate::{Host, read_json_file};

/// 节点图命令分发 (update/connect/disconnect 与前端、MCP 同一编译提交路径)。
pub async fn graph(host: &Host, action: &GraphAction) -> Result<Value, String> {
    let tb = &host.state;
    match action {
        GraphAction::Tabs => Ok(tools::list_tabs(tb)),
        GraphAction::Outputs => Ok(tools::get_graph_outputs(tb)),
        GraphAction::Update {
            tab_id,
            file,
            base_version,
        } => {
            let value = read_json_file(file)?;
            let documents = value
                .get("documents")
                .cloned()
                .ok_or_else(|| format!("{file} 缺少 documents 数组"))?;
            let edges = value
                .get("edges")
                .cloned()
                .ok_or_else(|| format!("{file} 缺少 edges 数组"))?;
            let documents: Vec<serde_json::Value> = serde_json::from_value(documents)
                .map_err(|error| format!("documents 应为数组: {error}"))?;
            let edges: Vec<serde_json::Value> = serde_json::from_value(edges)
                .map_err(|error| format!("edges 应为数组: {error}"))?;
            tools::update_graph(
                tb,
                host.sink.as_ref(),
                tab_id,
                documents,
                edges,
                *base_version,
            )
            .await
            .and_then(|derived| serde_json::to_value(derived).map_err(|e| e.to_string()))
        }
        GraphAction::Connect {
            source,
            target,
            tab_id,
            source_handle,
            target_handle,
        } => {
            tools::connect_edge(
                tb,
                host.sink.as_ref(),
                tab_id.clone(),
                source,
                target,
                source_handle.clone(),
                target_handle.clone(),
            )
            .await
        }
        GraphAction::Disconnect {
            edge_id,
            source,
            target,
        } => {
            tools::disconnect_edge(
                tb,
                host.sink.as_ref(),
                edge_id.clone(),
                source.clone(),
                target.clone(),
            )
            .await
        }
    }
}
