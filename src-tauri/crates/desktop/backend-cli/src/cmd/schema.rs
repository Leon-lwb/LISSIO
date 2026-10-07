//! CLI 命令行模式 (clap) — 顶层 [`Cli`]、[`Command`] 与各域子命令枚举。
//!
//! 本模块只描述"命令行长什么样"; 参数到 [`control_api`] 调用的映射在
//! [`super::dispatch`]。子命令按能力域分组, 每个域对应一个 `*Action` 枚举。

use clap::{Parser, Subcommand};

/// Lissio 无界面后端 CLI。
#[derive(Parser)]
pub struct Cli {
    /// 跳过启动时的工作区恢复 (空工作区启动)
    #[arg(long)]
    pub no_restore: bool,

    #[command(subcommand)]
    pub command: Command,
}

/// 设备发送子命令。
#[derive(Subcommand)]
pub enum SendAction {
    /// 发送原始字节
    Bytes {
        /// 目标传输节点 id
        node_id: String,
        /// 字节 (hex: AABB / "AA BB" / 0xAA,0xBB)
        data: String,
    },
    /// 发送 UTF-8 文本
    Text {
        /// 目标传输节点 id
        node_id: String,
        /// 文本内容 (按字节原样发送)
        text: String,
    },
    /// 发送 CAN 帧 (经 CAN 协议节点编码)
    Can {
        /// 目标设备节点 id
        node_id: String,
        /// 帧 id (11 位标准帧或 29 位扩展帧)
        #[arg(long)]
        id: u32,
        /// 数据字节 (hex, 最多 8 个)
        #[arg(long, default_value = "")]
        data: String,
        /// 使用扩展帧 (29 位 id)
        #[arg(long)]
        extended: bool,
        /// 编码用 Protocol 节点 id (缺省沿字节平面自动溯源)
        #[arg(long)]
        protocol_node: Option<String>,
    },
}

/// 采集端点子命令。
#[derive(Subcommand)]
pub enum EndpointAction {
    /// 列出全部已打开端点快照
    List,
    /// 按图中设备节点 id 打开端点
    Open {
        /// 图中设备节点 id (Acquisition 节点)
        node_id: String,
    },
    /// 关闭采集节点
    Close {
        /// 图中 Acquisition 节点 id
        node_id: String,
    },
    /// 读取采集节点点位值
    Read {
        /// 图中 Acquisition 节点 id
        node_id: String,
        /// 点位 id 列表 (逗号分隔)
        point_ids: String,
    },
    /// 写入采集节点点位值 (request JSON 文件, 与 IPC 同构)
    Write {
        /// 图中 Acquisition 节点 id
        node_id: String,
        /// WriteRequest JSON 文件路径
        request_file: String,
    },
}

/// 节点图子命令。
#[derive(Subcommand)]
pub enum GraphAction {
    /// 列出已提交节点图的 tab id
    Tabs,
    /// 读取图输出快照
    Outputs,
    /// 原子替换指定 tab 的节点图 (与前端提交同一路径)
    Update {
        /// 目标 tab id
        tab_id: String,
        /// 图 JSON 文件: {documents: [...], edges: [...]} (与 workspace.json 内同构)
        file: String,
        /// 乐观并发基线版本 (缺省不校验)
        #[arg(long)]
        base_version: Option<u64>,
    },
    /// 建立连线 (后端编译校验)
    Connect {
        /// 源节点 id
        source: String,
        /// 目标节点 id
        target: String,
        /// 归属 tab (缺省自动定位)
        #[arg(long)]
        tab_id: Option<String>,
        /// 源端口 id (缺省补默认)
        #[arg(long)]
        source_handle: Option<String>,
        /// 目标端口 id (缺省补默认)
        #[arg(long)]
        target_handle: Option<String>,
    },
    /// 删除连线 (edge_id 或 source/target 至少给一个)
    Disconnect {
        /// 连线 id (优先精确匹配)
        #[arg(long)]
        edge_id: Option<String>,
        /// 源节点 id
        #[arg(long)]
        source: Option<String>,
        /// 目标节点 id
        #[arg(long)]
        target: Option<String>,
    },
}

/// 数据读取子命令。
#[derive(Subcommand)]
pub enum DataAction {
    /// 列出存在波形缓冲的数据源
    Sources,
    /// 读取最近 N 个采样点
    Waveform {
        /// 数据源 (协议/FrameDecoder 节点 id)
        source: String,
        /// 采样点数 (上限 10000)
        #[arg(long, default_value_t = 1000)]
        count: u32,
    },
    /// 读取时间窗口内的波形 (相对最新时间戳, 毫秒)
    Window {
        /// 数据源
        source: String,
        /// 窗口起点 (负数=过去)
        #[arg(long, allow_negative_numbers = true)]
        start_ms: i64,
        /// 窗口终点
        #[arg(long, allow_negative_numbers = true)]
        end_ms: i64,
    },
    /// 读取缓冲区信息 (通道数/点数)
    Buffer {
        /// 数据源
        source: String,
    },
    /// 读取最近 CAN 帧与负载统计
    Can {
        /// 帧条数 (上限 1000)
        #[arg(long, default_value_t = 100)]
        count: u32,
        /// 总线比特率 (缺省 500k)
        #[arg(long)]
        bitrate: Option<u32>,
    },
    /// 读取逻辑采样与解码事件
    Logic {
        /// 条数 (上限 5000)
        #[arg(long, default_value_t = 1000)]
        count: u32,
    },
    /// 读取最近原始字节 (hex 编码)
    Raw {
        /// 数据源节点 id
        source: String,
        /// 最大字节数 (上限 64KiB)
        #[arg(long, default_value_t = 4096)]
        max_bytes: u32,
    },
}

/// 波形停止快照子命令。
#[derive(Subcommand)]
pub enum SnapshotAction {
    /// 克隆当前原始波形缓存为停止快照
    Create {
        /// 数据源
        source: String,
    },
    /// 查询停止快照时间窗内的波形
    Query {
        /// 快照 id
        snapshot_id: String,
        /// 窗口起点 (相对快照最新时间戳, 毫秒)
        #[arg(long, allow_negative_numbers = true)]
        start_ms: f64,
        /// 窗口终点
        #[arg(long, allow_negative_numbers = true)]
        end_ms: f64,
        /// LTTB 降采样点数
        #[arg(long, default_value_t = 2000)]
        max_points: u32,
    },
    /// 释放停止快照
    Release {
        /// 快照 id
        snapshot_id: String,
    },
    /// 按绝对时间范围导出原始样本到 CSV 文件
    ExportCsv {
        /// 数据源
        source: String,
        /// 停止快照 id (缺省用实时缓冲)
        #[arg(long)]
        snapshot_id: Option<String>,
        /// 起始绝对时间戳 (微秒)
        #[arg(long)]
        start_timestamp_us: u64,
        /// 结束绝对时间戳 (微秒)
        #[arg(long)]
        end_timestamp_us: u64,
        /// 目标 CSV 路径
        #[arg(long)]
        path: String,
    },
}

/// 命令帧子命令。
#[derive(Subcommand)]
pub enum FrameAction {
    /// 编码命令帧为字节 (预览, 不发送)
    Compute {
        /// 命令帧定义 JSON 文件 (CommandFrameDto, 与前端同构)
        frame_file: String,
        /// var_ref 输入 name=value (可多次)
        #[arg(long)]
        input: Vec<String>,
    },
    /// 发送命令帧 (要求工作区运行中)
    Send {
        /// 命令发送器 widget 节点 id
        widget_id: String,
        /// 命令帧定义 JSON 文件
        frame_file: String,
        /// var_ref 输入 name=value (可多次)
        #[arg(long)]
        input: Vec<String>,
    },
}

/// 录制子命令。
#[derive(Subcommand)]
pub enum RecordAction {
    /// 列出全部录制会话
    List,
    /// 列出指定会话的通道绑定
    Bindings {
        /// 录制会话 id
        session_id: String,
    },
    /// 暂停态新建录制会话并切换写入目标
    Create,
    /// 暂停态切换写入目标到指定已停止会话
    Switch {
        /// 目标会话 id
        session_id: String,
    },
    /// 删除录制会话
    Delete {
        /// 会话 id
        session_id: String,
    },
    /// 分页查询历史采样
    History {
        /// 会话 id
        session_id: String,
        /// 通道绑定 id (缺省全部绑定)
        #[arg(long)]
        binding_id: Option<String>,
        /// 起始行 id 之后 (翻页)
        #[arg(long)]
        after_row_id: Option<i64>,
        /// 起始时间 (微秒)
        #[arg(long)]
        from_us: Option<u64>,
        /// 结束时间 (微秒)
        #[arg(long)]
        to_us: Option<u64>,
        /// 页大小 (缺省 500)
        #[arg(long)]
        limit: Option<usize>,
        /// 携带 payload 字节
        #[arg(long)]
        include_payload: bool,
    },
    /// 只读 SQL 查询录制数据库
    Sql {
        /// SQL 语句 (DuckDB 方言)
        sql: String,
        /// 最大返回行数 (缺省 10000)
        #[arg(long)]
        max_rows: Option<usize>,
    },
    /// 录制子系统健康状态
    Health,
    /// 强制刷盘
    Flush,
    /// 导出录制数据到文件 (request JSON 文件, 与 IPC 同构)
    Export {
        /// RecordingExportRequest JSON 文件路径
        request_file: String,
    },
}

/// 工作区运行控制子命令。
#[derive(Subcommand)]
pub enum RunAction {
    /// 启动 / 恢复
    Start,
    /// 暂停
    Pause,
    /// 停止
    Stop,
}

/// 全部子命令。
#[derive(Subcommand)]
pub enum Command {
    /// 列出已打开设备会话及其连接状态
    Devices,
    /// 列出系统可用串口
    Ports,
    /// 发送字节 / 文本 / CAN 帧
    Send {
        #[command(subcommand)]
        action: SendAction,
    },
    /// 把字节注入全局字节平面 (协议调试)
    Inject {
        /// 注入源节点 id (字节边起点)
        source_node_id: String,
        /// 字节 (hex)
        data: String,
    },
    /// 设置控件输入值 (立即触发求值)
    Input {
        /// 控件节点 id
        widget_id: String,
        /// 目标值
        value: f32,
    },
    /// 采集端点开闭与点位读写
    Endpoint {
        #[command(subcommand)]
        action: EndpointAction,
    },
    /// 节点图查看与编辑
    Graph {
        #[command(subcommand)]
        action: GraphAction,
    },
    /// 数据读取 (波形 / CAN / 逻辑 / 原始字节)
    Data {
        #[command(subcommand)]
        action: DataAction,
    },
    /// 波形停止快照 (创建 / 查询 / 释放 / CSV 导出)
    Snapshot {
        #[command(subcommand)]
        action: SnapshotAction,
    },
    /// 命令帧编码与发送
    Frame {
        #[command(subcommand)]
        action: FrameAction,
    },
    /// 工作区运行控制
    Run {
        #[command(subcommand)]
        action: RunAction,
    },
    /// 录制会话管理 / 查询 / 导出
    Record {
        #[command(subcommand)]
        action: RecordAction,
    },
    /// 常驻服务: 恢复工作区 + 启动录制 + 进程内 MCP server 与 Web 出口, 直至退出信号
    Serve {
        /// 监听地址 (缺省 127.0.0.1, 可被 LISSIO_BIND 覆盖)
        #[arg(long)]
        bind: Option<std::net::IpAddr>,
        /// Web 出口端口 (缺省 8790, 可被 LISSIO_HTTP_PORT 覆盖)
        #[arg(long)]
        http_port: Option<u16>,
        /// 访问令牌 (缺省读 LISSIO_TOKEN, 再缺省读/生成配置目录下的 server-token)
        #[arg(long)]
        token: Option<String>,
        /// 令牌文件路径 (缺省 <配置目录>/server-token)
        #[arg(long)]
        token_file: Option<std::path::PathBuf>,
        /// 静态站点目录 (前端 dist/)
        #[arg(long)]
        static_dir: Option<std::path::PathBuf>,
        /// 允许的跨源来源 (可重复)
        #[arg(long = "cors-origin")]
        cors_origins: Vec<String>,
        /// MCP 监听端口 (缺省 8765, 可被 LISSIO_MCP_PORT 覆盖)
        #[arg(long)]
        mcp_port: Option<u16>,
        /// 不启动 MCP server
        #[arg(long)]
        no_mcp: bool,
        /// 只启动 MCP server, 不监听 Web 出口 (旧行为)
        #[arg(long)]
        no_http: bool,
    },
    /// 直接调用 Web 出口命令派发表 (与 IPC 命令名/参数同构的通用逃生口)
    Rpc {
        /// 命令名 (与 `invoke` 名称一致, 见 `lissio-server` 的 /api/v1/capabilities)
        cmd: String,
        /// 参数 JSON (内联字符串或 `@文件路径`; 缺省 `{}`)
        #[arg(long)]
        args: Option<String>,
    },
}
