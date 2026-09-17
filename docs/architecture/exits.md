# Software exits — UI / CLI / MCP 统一架构

Lissio 有三个对外的"软件出口"。三者是不同的协议适配器(前端 RPC / JSON-RPC
tools / argv 子命令),字面上不合并;**统一的对象是它们之下的能力核心、装配
与端口**——一份实现,三个薄壳,零业务重复。

```
前端 (React)          外部 AI 客户端           运维 / 脚本 / headless
    │ Tauri IPC             │ MCP (streamable-http)     │ argv 子命令
    │ src-tauri/src/commands│ crates/desktop/mcp-server │ crates/desktop/backend-cli
    └──────────┬────────────┴──────────┬────────────────┘
               │                       │
               ▼                       ▼
        control-api — 能力核心 (普通异步函数 + Toolbox 状态切片, 零 Tauri/rmcp)
               │
        backend-host — 无界面装配 (适配器注册 / 点位观察者 / 工作区恢复 / 收尾)
               │
        pipeline / graph_ops / transport / … (数据平面与图提交核心)
```

## 组成

### 1. 能力核心 — `control-api`

全部后端控制能力实现为普通异步函数,输入是 `Toolbox`(AppState 共享 `Arc`
句柄切片)+ 出口无关参数,输出是域类型或 `serde_json::Value`:

- `tools` — 设备列举 / 字节文本 CAN 发送 / 字节注入 / 输入值 / 图输出 /
  波形与缓冲读取 / 节点图提交与连线 (`graph_ops` 同一路径)
- `control` — 端点开闭 / 点位读写 / 工作区运行控制
- `data` — 波形停止快照 / CSV 导出 / 缓冲容量 / 命令帧编码与发送内核
- `recording` — 录制会话生命周期 / 历史与 SQL 查询 / 导出 (含暂停态门控)

消费方(三个出口 + 内置 AI 原生工具执行器)只做参数解包与错误映射。

### 2. 装配 — `backend-host`

GUI 组合根(`lissio`)与无界面宿主(`backend-cli`)共用同一份装配:
`build_acquisition_runtime` / `install_point_observer` / `restore_workspace` /
`shutdown` / 配置目录解析。保证两种宿主下适配器注册、点位投影、工作区恢复
与收尾行为完全一致。

### 3. 端口(依赖倒置)

| 端口 | 契约 | Tauri 实现 | 无界面实现 |
|---|---|---|---|
| 后端事件 | `events::BackendEventSink` | `TauriEventSink`(组合根 `event_sink.rs`) | `CliEventSink`(stderr JSON-lines)/ `NullEventSink` |
| 显示数据流 | `app::display::StreamSink` | `TauriChannelSink`(包装 IPC `Channel`) | CLI/测试自有实现 |

L0–L3 与 `mcp-server`、`backend-host`、`backend-cli` 不依赖 Tauri;
GUI 专有逻辑(启动页兜底、退出 flush 的窗口部分)留在组合根 `gui_host.rs`。

## 出口能力矩阵

能力按无头场景价值收敛到 control-api;UI-only 命令(窗口 / splashscreen /
AI 聊天会话状态)不入共享层,仍是 IPC 专有。

| 能力域 | IPC | MCP | CLI |
|---|---|---|---|
| 设备列举 / 串口发现 | ✓ | ✓ | `devices` / `ports` |
| 发送(字节/文本/CAN) | ✓ | ✓ | `send bytes/text/can` |
| 字节注入 / 输入值 | ✓ | ✓ | `inject` / `input` |
| 节点图提交 / 连线 | ✓ | ✓ | `graph update/connect/disconnect` |
| 波形 / CAN / 逻辑 / 原始读取 | ✓ | ✓(轮询) | `data *` |
| 流式订阅(推流 + 背压) | ✓(`StreamSink`) | —(协议所限,轮询替代) | 预留(`StreamSink` 注入) |
| 波形停止快照 / CSV 导出 | ✓ | ✓ | `snapshot *` |
| 命令帧编码 / 发送 | ✓ | ✓ | `frame compute/send` |
| 端点开闭 / 点位读写 | ✓ | ✓ | `endpoint *` |
| 运行控制 | ✓ | ✓ | `run start/pause/stop` |
| 录制会话 / 查询 / 导出 | ✓ | ✓ | `record *` |
| 常驻服务(MCP server) | 进程内启动 | 本体 | `serve --mcp-port` |

## 约定

- **出口参数 schema 各自拥有**:MCP 用 schemars(schemars 独立于 rmcp,不
  违反"control-api 不依赖 rmcp"),CLI 用 clap,IPC 用命令内联参数。语义参数
  结构若逐字段重复,优先上移 control-api(如 CAN 帧构建 `build_can_frame`);
  不强扭字段不一致的 DTO。
- **兼容性红线**:IPC 命令名/参数、事件名与 payload JSON 形状、持久化文件
  格式对前端保持不变;命令层是薄壳,业务文案在 control-api 维护。
- **错误映射**:control-api 统一 `Result<_, String>`;IPC 侧转
  `data_model::Error`(文案透传),MCP 侧转 internal error,CLI 侧转
  stderr + 非零退出码。
