//! CLI 子命令定义与分发 — 参数解析 (clap) + 调用 [`control_api`] 共享实现。
//!
//! 子命令按能力域分组在子模块; 每个命令返回 JSON 结果 (stdout) 或错误字符串
//! (stderr + 非零退出码)。`serve` 是唯一常驻命令 (进程内启动 MCP server)。
//!
//! 命令行模式 (顶层 [`Cli`] 与全部子命令枚举) 在 [`schema`]; 本模块只保留
//! 模块组织、[`execute`] / `dispatch` 分发与 [`ok`] 结果包装。

pub mod data;
pub mod devices;
pub mod graph;
pub mod record;
pub mod run;
pub mod schema;
pub mod transfer;

use control_api::Toolbox;
use serde_json::{Value, json};

pub use schema::{
    Cli, Command, DataAction, EndpointAction, FrameAction, GraphAction, RecordAction, RunAction,
    SendAction, SnapshotAction,
};

use crate::Host;

/// 分发入口 — `serve` 之外的命令按 装配→执行→收尾 一次性完成。
pub async fn execute(cli: Cli) -> Result<(), String> {
    match cli.command {
        Command::Serve {
            bind,
            http_port,
            token,
            token_file,
            static_dir,
            cors_origins,
            mcp_port,
            no_mcp,
            no_http,
        } => {
            run::serve(run::ServeOptions {
                bind,
                http_port,
                token,
                token_file,
                static_dir,
                cors_origins,
                mcp_port,
                no_mcp,
                no_http,
                no_restore: cli.no_restore,
            })
            .await
        }
        command => {
            let host = crate::assemble(!cli.no_restore).await?;
            let result = dispatch(&host, command).await;
            crate::teardown(&host);
            let value = result?;
            crate::print_json(&value);
            Ok(())
        }
    }
}

/// 命令分发 — 每个域委托对应子模块 (全部走 control-api 共享实现)。
async fn dispatch(host: &Host, command: Command) -> Result<Value, String> {
    let tb: &Toolbox = &host.state;
    match command {
        Command::Devices => Ok(transfer::devices(tb).await),
        Command::Ports => transfer::ports(tb),
        Command::Send { action } => transfer::send(tb, &action).await,
        Command::Inject {
            source_node_id,
            data,
        } => transfer::inject(host, &source_node_id, &data).await,
        Command::Input { widget_id, value } => Ok(transfer::input(tb, &widget_id, value)),
        Command::Endpoint { action } => devices::endpoint(host, &action).await,
        Command::Graph { action } => graph::graph(host, &action).await,
        Command::Data { action } => data::data(tb, &action),
        Command::Snapshot { action } => data::snapshot(tb, &action).await,
        Command::Frame { action } => transfer::frame(tb, &action).await,
        Command::Run { action } => run::run_control(host, &action).await,
        Command::Record { action } => record::record(tb, &action).await,
        Command::Rpc { cmd, args } => {
            let args = crate::parse_json_arg(args.as_deref())?;
            rpc_api::dispatch(host, &cmd, args)
                .await
                .map_err(|error| format!("{}: {}", error.kind, error.message))
        }
        Command::Serve { .. } => unreachable!("serve 在 execute 中单独处理"),
    }
}

/// 统一包装无返回值操作。
pub fn ok() -> Value {
    json!({ "ok": true })
}
