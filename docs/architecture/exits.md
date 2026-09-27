# Software exits — UI / CLI / MCP 统一架构

Lissio 有四个对外的"软件出口"。四者是不同的协议适配器(HTTP-RPC +
WebSocket / JSON-RPC tools / argv 子命令 / 桌面平台壳),字面上不合并;**统一的对象是它们之下的
能力核心、装配与端口**——一份实现,四个薄壳,零业务重复。

```
桌面前端 (React)  浏览器前端 (React)  外部 AI 客户端        运维 / 脚本 / headless
    │ HTTP + WS        │ HTTP + WS          │ MCP (streamable-http)  │ argv 子命令
    │ sidecar server   │ backend-server     │ mcp-server             │ backend-cli
    └────────┬─────────┴─────────┬──────────┴───────────┬───────────┘
             │                   │                      │
             ▼                   ▼                      ▼
        control-api — 能力核心 (普通异步函数 + Toolbox 状态切片, 零 Tauri/rmcp/axum)
             │        rpc-api — 出口无关的命令派发 (命令名 + JSON 参数 → 能力)
             │
        backend-host — 无界面装配 (适配器注册 / 点位观察者 / 工作区恢复 / 收尾)
             │
        pipeline / graph_ops / transport / … (数据平面与图提交核心)
```

Web 出口的完整设计 (线协议 / 鉴权 / 命令能力矩阵 / 落地阶段) 见
[web-exit.md](web-exit.md)。

## 组成

### 1. 能力核心 — `control-api`

全部后端控制能力实现为普通异步函数,输入是 `Toolbox`(AppState 共享 `Arc`
句柄切片)+ 出口无关参数,输出是域类型或 `serde_json::Value`:

- `tools` — 设备列举 / 字节文本 CAN 发送 / 字节注入 / 输入值 / 图输出 /
  波形与缓冲读取 / 节点图提交与连线 (`graph_ops` 同一路径)
- `control` — 端点开闭 / 点位读写 / 工作区运行控制
- `data` — 波形停止快照 / CSV 导出 / 缓冲容量 / 命令帧编码与发送内核
- `recording` — 录制会话生命周期 / 历史与 SQL 查询 / 导出 (含暂停态门控)

其上的 `capabilities` 模块是**软件能力节点注册表** — 每个能力域 (传输/图编辑/
波形/CAN/逻辑分析/采集控制/命令帧/录制/知识库) 注册一个节点,声明自己的工具
(名称/描述/schemars JSON schema/异步处理器,经 `tool()` 构造器从入参类型派生
schema)与自带技能文档 (`docs/{zh,en}` 编译期嵌入)。MCP 工具路由、内置 AI
工具规格与执行分发、skill 清单与系统提示词索引**全部运行期从同一注册表动态
派生**——新增能力域只需实现一个节点构造函数,不改任何出口代码。

消费方(三个出口 + 内置 AI 原生工具执行器)只做协议/参数映射与错误转换。

### 1b. 命令派发 — `rpc-api`

出口无关的"命令名 → 能力调用"派发表: Desktop 与 Web 通过同一 HTTP/WS 后端
拥有同一套命令名、参数名与错误契约。`catalog` 声明
`SUPPORTED / PENDING / DESKTOP_ONLY / CHANNEL` 四类, 由 `pnpm check:web-contract`
校验网络派发表与前端调用面完整，并确保 Tauri `generate_handler!` 只包含
`DESKTOP_ONLY` 平台壳命令。

### 2. 装配 — `backend-host`

常驻服务(`lissio-server`)与运维入口(`backend-cli`)共用同一份装配:
`build_acquisition_runtime` / `install_point_observer` / `restore_workspace` /
`shutdown` / 配置目录解析。保证两种宿主下适配器注册、点位投影、工作区恢复
与收尾行为完全一致。

### 3. 端口(依赖倒置)

| 端口 | 契约 | Tauri 实现 | Web 实现 | 无界面实现 |
|---|---|---|---|---|
| 后端事件 | `events::BackendEventSink` | `BroadcastEventSink`(sidecar WS) | `BroadcastEventSink`(广播到连接) | `CliEventSink`(stderr JSON-lines)/ `NullEventSink` |
| 显示数据流 | `app::display::StreamSink` | `WsStreamSink`(连接级出站队列) | `WsStreamSink`(连接级出站队列) | CLI/测试自有实现 |

L0–L3 与 `mcp-server`、`backend-host`、`backend-cli` 不依赖 Tauri;
Desktop 专有逻辑仅保留在 Tauri 平台壳；业务 flush 由 supervised sidecar 完成。

## 出口能力矩阵

能力按无头场景价值收敛到 control-api；仅窗口、启动页、更新器和 sidecar 管理
保留为 Tauri IPC，AI 会话属于独立后端公共能力。

| 能力域 | IPC | Web | MCP | CLI |
|---|---|---|---|
| 能力域 | IPC | Web | MCP | CLI |
|---|---|---|---|---|
| 设备列举 / 串口发现 | ✓ | ✓ | ✓ | `devices` / `ports` |
| 发送(字节/文本/CAN) | ✓ | ✓ | ✓ | `send bytes/text/can` |
| 字节注入 / 输入值 | ✓ | ✓ | ✓ | `inject` / `input` |
| 节点图提交 / 连线 | ✓ | ✓ | ✓ | `graph update/connect/disconnect` |
| 波形 / CAN / 逻辑 / 原始读取 | ✓ | ✓ | ✓(轮询) | `data *` |
| 流式订阅(推流 + 背压) | ✓(`StreamSink`) | ✓(WS 二进制帧) | —(协议所限,轮询替代) | 预留(`StreamSink` 注入) |
| 波形停止快照 / 原始区间 | ✓ | ✓ | ✓ | `snapshot *` |
| 命令帧编码 / 发送 | ✓ | ✓ | ✓ | `frame compute/send` |
| 端点开闭 / 点位读写 | ✓ | ✓ | ✓ | `endpoint *` |
| 运行控制 | ✓ | ✓ | ✓ | `run start/pause/stop` |
| 录制会话 / 查询 | ✓ | ✓ | ✓ | `record *` |
| 导出到文件 | ✓(HTTP 下载) | ✓(受鉴权下载端点) | ✓ | `snapshot export-csv` / `record export` |
| 窗口 / 启动页 / 更新器 | ✓ | 桌面专有 | — | — |
| AI 对话 / MCP / 密钥状态 | ✓(HTTP/WS) | ✓ | 入站服务由 `AiHost` 管理 | 后端宿主能力 |
| 常驻服务 | 自动管理 sidecar | 独立服务 | 同一服务进程 | `serve` |

## 约定

- **出口参数 schema 单一来源**:工具入参 DTO 与 schemars JSON schema 定义在
  `control-api` 能力节点 (schemars 独立于 rmcp,不违反"control-api 不依赖
  rmcp"),MCP 工具路由与内置 AI 工具规格从同一注册表派生;CLI 用 clap,IPC
  用命令内联参数。语义参数结构若逐字段重复,优先上移 control-api(如 CAN 帧
  构建 `build_can_frame`);不强扭字段不一致的 DTO。
- **契约稳定性**:IPC 命令名/参数、事件名与 payload JSON 形状、持久化文件
  格式由契约检查与生成脚本机器校验;命令层是薄壳,业务文案在 control-api
  维护。Web 出口的命令名与参数名与 IPC 逐字一致 (顶层 camelCase), 差异只在
  传输。旧版本数据不做兼容读取——格式变更即要求重新导出。
- **能力清单是机器可校验的**:新增 IPC 命令必须同时登记进 `rpc-api::catalog`
  四类之一, 否则 `pnpm check:web-contract` 失败;注册表侧工具名/skill id
  全局唯一由 `CapabilityRegistry::new` 校验并有测试兜底。
- **错误映射**:能力节点统一 `Result<ToolOutput, ToolError>`;IPC 侧转
  `data_model::Error`(文案透传),MCP 侧执行失败转 `CallToolResult::error`
  (AI 客户端可见)、参数错误转 invalid params,CLI 侧转 stderr + 非零退出码。
