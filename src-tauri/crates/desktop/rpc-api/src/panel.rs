//! 数据面板拉取出口 — 面板拉取面 (`control_api::panel_data`) 的参数解包。
//!
//! 与订阅出口的分工: 订阅 (`subscribe_data`) 由出口通道持续推送 (桌面 IPC 用
//! `Channel`, Web 出口用 WebSocket), 面板拉取是一次性读取, 因此走 `dispatch`。
//! 两侧共用同一份 `app::display::NodePortTarget` 寻址, 面板身份与失败语义同源于
//! `data_model::panel_descriptor`, 因此同一面板「订阅一路」与「拉取一次」拿到的是
//! 同一份数据、同一个错误词表。

use app::display::NodePortTarget;
use backend_host::BackendHost;
use control_api::panel_data::{self, PanelFetchParams};
use data_model::panel_descriptor::PanelKind;
use serde_json::Value;

use crate::args::{RpcError, normalize_args, optional, required, text};

/// 拉取一个数据面板此刻的数据 — 面板拉取面的唯一出口。
///
/// 参数 (顶层 camelCase, 由 [`crate::args::normalize_args`] 归一):
///
/// - `panelKind` (必填) — 面板身份, 与目录下发的 `PanelDescriptor.kind` 同一拼写;
/// - `nodeId` / `port` (可选) — 面板寻址, 整库面板 (CAN / 逻辑) 可省;
/// - `params` (可选) — 每面板参数袋, 见 [`PanelFetchParams`]。
///
/// 返回载荷随面板而定, 形状由目录下发的 `PanelDescriptor.data_plane.fetch_op`
/// 单点定义 (见 [`control_api::panel_data::fetch_panel_data`] 的分派表)。
pub fn fetch_panel_data(host: &BackendHost, cmd: &str, args: &Value) -> Result<Value, RpcError> {
    let (panel_kind, target, params) = parse_request(cmd, args)?;
    text(panel_data::fetch_panel_data(
        &host.toolbox,
        panel_kind,
        &target,
        &params,
    ))
}

/// 解包面板拉取请求 — 与 [`crate::dispatch`] 同一条归一 + 取值路径。
///
/// 独立成函数是为了让参数契约 (命令名 → 参数名 → 面板身份) 能脱离宿主被校验,
/// 而不是把「缺 `panelKind` 时给什么错误」留到集成时才暴露。
fn parse_request(
    cmd: &str,
    args: &Value,
) -> Result<(PanelKind, NodePortTarget, PanelFetchParams), RpcError> {
    let args = normalize_args(args.clone());
    let panel_kind: PanelKind = required(&args, cmd, "panel_kind")?;
    let node_id: Option<String> = optional(&args, cmd, "node_id")?;
    let port: Option<String> = optional(&args, cmd, "port")?;
    let params: Option<PanelFetchParams> = optional(&args, cmd, "params")?;
    Ok((
        panel_kind,
        NodePortTarget::new(node_id.unwrap_or_default(), port.unwrap_or_default()),
        params.unwrap_or_default(),
    ))
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn request_unpacks_camel_case_addressing() {
        let (panel, target, params) = parse_request(
            "fetch_panel_data",
            &json!({
                "panelKind": "table-view",
                "nodeId": "n1",
                "port": "value",
                "params": { "count": 7 },
            }),
        )
        .expect("合法请求");
        assert_eq!(panel, PanelKind::TableView);
        assert_eq!(target, NodePortTarget::at_port("n1", "value"));
        assert_eq!(params.count, Some(7));
    }

    #[test]
    fn addressing_fields_default_to_node_level_and_empty_params() {
        let (panel, target, params) =
            parse_request("fetch_panel_data", &json!({ "panelKind": "can" }))
                .expect("整库面板无需寻址");
        assert_eq!(panel, PanelKind::Can);
        assert_eq!(target, NodePortTarget::default());
        assert_eq!(params.count, None);
    }

    #[test]
    fn missing_panel_kind_is_an_argument_error() {
        let error = parse_request("fetch_panel_data", &json!({ "nodeId": "n1" }))
            .expect_err("panelKind 必填");
        assert_eq!(error.kind, "InvalidArguments");
        assert!(error.message.contains("panel_kind"), "{}", error.message);
    }

    #[test]
    fn unknown_panel_kind_is_rejected() {
        let error = parse_request("fetch_panel_data", &json!({ "panelKind": "hologram" }))
            .expect_err("未知面板身份");
        assert_eq!(error.kind, "InvalidArguments");
        assert!(error.message.contains("panel_kind"), "{}", error.message);
    }
}
