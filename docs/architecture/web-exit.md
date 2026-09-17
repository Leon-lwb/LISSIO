# Web 出口 — 服务后端拆分设计

本文件描述"把服务后端从 Tauri 宿主里拆出来"这一目标的架构、协议契约与落地
顺序。它是对 [exits.md](exits.md) 的扩展: 出口从三个 (UI / MCP / CLI) 增加到
四个, 新增的 Web 出口 (HTTP-RPC + WebSocket) 与其余三个共用同一份能力核心
([`control-api`](../../src-tauri/crates/desktop/control-api)) 与同一份装配
([`backend-host`](../../src-tauri/crates/desktop/backend-host))。

约定与红线沿用 [exits.md](exits.md): **命令名、参数名、错误 `kind`、事件名、
payload 形状、持久化文件格式对前端保持不变**。Web 出口是"把既有 IPC 语义搬进
HTTP/WS", 不是重新设计 API。

## 1. 目标形态

一份前端产物 (`dist/`), 三种运行方式:

```
                     ┌──────────── 浏览器 ────────────┐
                     │  dist/ (静态托管)               │
                     └──────────────┬─────────────────┘
                                    │ HTTP-RPC + WebSocket
                                    ▼
  桌面 (Tauri webview)       lissio-server (独立进程)
       │  IPC (默认)              ├ control-api   能力核心
       └────────────┬────────────►├ backend-host  装配 / 生命周期
                    │             ├ mcp-server    :8765 (可选)
       (也可改走 HTTP/WS 连远端)   └ workspace / recordings / settings
```

| 形态 | 后端位置 | 前端 transport | 状态 |
|---|---|---|---|
| A 独立服务 | `lissio-server` 进程 | HTTP + WS | 后端已就绪, 前端 transport 待接入 (P2) |
| B 桌面嵌入式 | Tauri 进程内 | Tauri IPC (现状) | 行为与性能零变化 |
| C 桌面连远端 | 远端 `lissio-server` | HTTP + WS | 复用 A; 前端 transport 决定后即可用 |

桌面默认保留 IPC 的理由: 波形走 `Channel` 二进制快路径 + 自适应节流, 换成
WebSocket 只会引入回归风险; A/C 才是新增路径。

## 2. crate 边界

| crate | 层 | 职责 | 状态 |
|---|---|---|---|
| `rpc-api` | L4 desktop | 出口无关的命令派发 — 命令名 + JSON 参数 → `control-api` / `app` 能力 | 新增 |
| `backend-server` | L5 desktop | Web 出口组合根 — axum HTTP-RPC / WebSocket / 鉴权 / 静态站点; bin `lissio-server` | 新增 |
| `backend-host` | L4 desktop | 装配与生命周期 — 新增 `BackendHost` / `assemble` / `teardown`, GUI 与全部无界面出口共用 | 扩展 |
| `backend-cli` | L5 desktop | argv 出口 — `Host` 改为复用 `backend-host`, 新增 `serve --http` 与 `rpc` | 扩展 |
| `ai-host` | L4 desktop | AI 会话 / MCP / 内置工具 / 密钥端口 | **规划中** (P3) |

分层约束 (由 `pnpm check:architecture` 强制):
`rpc-api` 不依赖 `tauri` / `axum` / `rmcp`; `backend-server` 只做协议适配,
业务判断一律下沉; `keyring` 与 `rmcp` 只允许出现在 L4/L5。

## 3. 线协议

### 3.1 请求 / 响应 — `POST /api/v1/rpc`

```jsonc
// 单条或数组 (数组用于启动时的并发突发, 减少往返)
{ "id": 1, "cmd": "update_tab_graph",
  "args": { "tabId": "t1", "documents": [], "edges": [], "baseVersion": 7 } }

{ "id": 1, "ok": true,  "result": { "nodes": [] } }
{ "id": 1, "ok": false, "error": { "kind": "GraphVersionConflict", "message": "..." } }
```

- `cmd` 与 `invoke` 名称逐字一致; `args` 是原样 camelCase 参数对象。
- 服务端只做**顶层** camelCase → snake_case 归一 (`rpc_api::normalize_args`),
  嵌套结构由各自 serde 形状负责 — 与 Tauri v2 的参数转换规则一致。
- 错误 `kind` 取自 `error::Error::kind()`, 前端 `errorGuidance` 的引导逻辑继续可用。

### 3.2 推送 — `GET /api/v1/ws`

```jsonc
// 服务端 → 客户端
{ "type": "event",      "event": "transport:state", "payload": { ... } }
{ "type": "notify",     "level": "error", "message": "..." }
{ "type": "stream",     "id": 7, "payload": { "kind": "waveform", "payload": { ... } } }
{ "type": "subscribed", "id": 7 }
{ "type": "unsubscribed", "id": 7 }
{ "type": "response",   "id": 1, "ok": true, "result": { ... } }
{ "type": "fault",      "message": "..." }

// 客户端 → 服务端
{ "type": "subscribe",   "args": { "request": { ... }, "intervalMs": 33, "maxItems": 2000 } }
{ "type": "unsubscribe", "id": 7 }
{ "type": "rpc",         "id": 1, "cmd": "workspace_get", "args": {} }
{ "type": "ping" }
```

订阅 **不带 id**: 由服务端在进程级命名空间分配, 并通过 `subscribed` 回执下发。
回执先于该 id 的任何流帧发出 (同一条出站队列), 因此客户端不需要握手超时。
这样做是因为 `app::display` 的订阅表是全局的 — 让客户端自选 id 会在多连接间互相
踢掉订阅。

**二进制流**用 WS 二进制帧, 头部固定, payload 与桌面 IPC 的 `Raw` 逐字节相同:

```
[u8 version=1][u8 format=1][u32 BE subscription_id][u32 BE payload_len][payload...]
```

因此 `WWB1` / `VNDP` / `VENV` 不需要重编码, 前端现有解码器无需按宿主分支。

### 3.3 生命周期映射

| 桌面 IPC | Web 出口 |
|---|---|
| `Channel` id 由 Tauri 分配 | 服务端进程级计数器分配 |
| `TauriChannelSink` | `WsStreamSink` (每订阅一个实例) |
| `closeTauriChannel` + `unsubscribe_data` | `unsubscribe` 帧 (服务端调 `app::display::unsubscribe_data`) |
| `ack_data` 背压反馈 | 照旧走 `/api/v1/rpc` |
| 连接关闭 | 遍历该连接订阅表逐个注销 — **必须做**, 否则订阅循环对已关闭连接空转 |

### 3.4 路由与配置

| 路由 | 用途 |
|---|---|
| `POST /api/v1/rpc` | 命令派发 (单条 / 数组) |
| `GET /api/v1/ws` | 事件 + 订阅 + 单连接 RPC |
| `GET /api/v1/health` | 健康检查 (无鉴权) |
| `GET /api/v1/capabilities` | `{supported, pending, desktop_only, protocol}` — 前端据此降级 UI |
| `--static-dir` | 同进程托管前端 `dist/` (SPA 回落 `index.html`) |

| flag | env | 默认 |
|---|---|---|
| `--bind` | `LISSIO_BIND` | `127.0.0.1` |
| `--http-port` | `LISSIO_HTTP_PORT` | `8790` |
| `--token` / `--token-file` | `LISSIO_TOKEN` | `<配置目录>/server-token` (0600, 首次生成) |
| `--static-dir` | `LISSIO_STATIC_DIR` | 空 |
| `--cors-origin` (可重复) | `LISSIO_CORS_ORIGINS` | 空 = 同源部署, 不挂 CORS 层 |
| `--mcp-port` / `--no-mcp` | `LISSIO_MCP_PORT` | `8765` / 默认启动 |
| — | `LISSIO_CONFIG_DIR` | 复用 `backend_host::resolve_config_dir` |

### 3.5 鉴权

- HTTP: `Authorization: Bearer <token>`。
- WS: `Sec-WebSocket-Protocol: lissio.v1, bearer.<token>` —— 浏览器 WebSocket API
  无法设置请求头, 子协议是唯一不把令牌写进 URL 的方式 (URL 会进访问日志)。
- 令牌比较是定长比较, 不按前缀提前返回。
- CORS 白名单为空时不挂 CORS 层 (同源部署无需跨源, 也避免误开放)。
- `SIGTERM` / Ctrl-C 触发优雅收尾: 停录制 + flush 工作区。

## 4. 命令能力矩阵

命令面以 `rpc-api/src/catalog.rs` 为唯一权威, 由 `pnpm check:web-contract`
校验"四个清单两两不相交, 且并集 = `generate_handler!` 注册的全部命令"。

| 命令 | 出口状态 | 说明 |
|---|---|---|
| **设备与采集** | | |
| `list_ports` | ✅ 已接入 |  |
| `list_candle_devices` | ✅ 已接入 |  |
| `list_adapter_capabilities` | ✅ 已接入 |  |
| `describe_acquisition_points` | ✅ 已接入 |  |
| `discover_acquisition_endpoints` | ✅ 已接入 |  |
| `validate_adapter_configuration` | ✅ 已接入 |  |
| `list_acquisition_endpoints` | ✅ 已接入 |  |
| `latest_acquisition_samples` | ✅ 已接入 |  |
| `open_acquisition_endpoint` | ✅ 已接入 |  |
| `close_acquisition_endpoint` | ✅ 已接入 |  |
| `read_acquisition_points` | ✅ 已接入 |  |
| `subscribe_acquisition_points` | ✅ 已接入 |  |
| `write_acquisition_points` | ✅ 已接入 |  |
| **传输与协议** | | |
| `close_transport` | ✅ 已接入 |  |
| `send_raw` | ✅ 已接入 |  |
| `send_string` | ✅ 已接入 |  |
| `send_text_out_now` | ✅ 已接入 |  |
| `send_widget_value` | ✅ 已接入 |  |
| `send_and_capture` | ✅ 已接入 |  |
| `update_transport_protocol` | ✅ 已接入 |  |
| `set_protocol` | ✅ 已接入 |  |
| `get_protocol` | ✅ 已接入 |  |
| `get_detected_channels` | ✅ 已接入 |  |
| `send_can_frame` | ✅ 已接入 |  |
| `get_recent_can_frames` | ✅ 已接入 |  |
| `clear_can_buffer` | ✅ 已接入 |  |
| `get_can_buffer_info` | ✅ 已接入 |  |
| **节点图与工作区** | | |
| `update_tab_graph` | ✅ 已接入 |  |
| `remove_tab_graph` | ✅ 已接入 |  |
| `get_source_graph` | ✅ 已接入 |  |
| `set_node_positions` | ✅ 已接入 |  |
| `set_input_value` | ✅ 已接入 |  |
| `submit_custom_output` | ✅ 已接入 |  |
| `submit_custom_text_output` | ✅ 已接入 |  |
| `inject_bytes` | ✅ 已接入 |  |
| `connect_edge` | ✅ 已接入 |  |
| `disconnect_edge` | ✅ 已接入 |  |
| `workspace_get` | ✅ 已接入 |  |
| `workspace_set_tabs` | ✅ 已接入 |  |
| **流水线与运行控制** | | |
| `set_pipeline_config` | ✅ 已接入 |  |
| `get_pipeline_config` | ✅ 已接入 |  |
| `workspace_run` | ✅ 已接入 |  |
| `get_workspace_run_state` | ✅ 已接入 |  |
| `set_widget_send_tasks` | ✅ 已接入 |  |
| `get_send_task_status` | ✅ 已接入 |  |
| **缓冲与波形快照** | | |
| `clear_buffer` | ✅ 已接入 |  |
| `set_buffer_channels` | ✅ 已接入 |  |
| `get_buffer_info` | ✅ 已接入 |  |
| `set_waveform_buffer_capacity` | ✅ 已接入 |  |
| `set_rawdata_buffer_capacity` | ✅ 已接入 |  |
| `set_can_buffer_capacity` | ✅ 已接入 |  |
| `set_logic_buffer_capacity` | ✅ 已接入 |  |
| `compute_waveform_autoset` | ✅ 已接入 |  |
| `create_waveform_snapshot` | ✅ 已接入 |  |
| `query_waveform_snapshot` | ✅ 已接入 |  |
| `release_waveform_snapshot` | ✅ 已接入 |  |
| `get_waveform_raw_range` | ✅ 已接入 |  |
| `compute_command_frame_bytes` | ✅ 已接入 |  |
| `send_command_frame` | ✅ 已接入 |  |
| **显示订阅** | | |
| `subscribe_data` | 🔌 通道 | 对应 WS `subscribe` 帧 |
| `unsubscribe_data` | 🔌 通道 | 对应 WS `unsubscribe` 帧 |
| `ack_data` | ✅ 已接入 |  |
| `get_data_health` | ✅ 已接入 |  |
| **四域读取与调试** | | |
| `get_recent_logic_samples` | ✅ 已接入 |  |
| `clear_logic_buffer` | ✅ 已接入 |  |
| `get_logic_buffer_info` | ✅ 已接入 |  |
| `get_recent_decoded_events` | ✅ 已接入 |  |
| `clear_decoded_buffer` | ✅ 已接入 |  |
| `get_decoded_buffer_info` | ✅ 已接入 |  |
| `clear_raw_data_collector` | ✅ 已接入 |  |
| `get_can_load_stats` | ✅ 已接入 |  |
| `set_can_load_window` | ✅ 已接入 |  |
| `clear_can_load_stats` | ✅ 已接入 |  |
| `get_current_can_bitrate` | ✅ 已接入 |  |
| `match_trigger_command` | ✅ 已接入 |  |
| **录制** | | |
| `get_recording_health` | ✅ 已接入 |  |
| `list_recording_sessions` | ✅ 已接入 |  |
| `list_recording_session_summaries` | ✅ 已接入 |  |
| `list_recording_bindings` | ✅ 已接入 |  |
| `get_recording_database_info` | ✅ 已接入 |  |
| `query_recording_history` | ✅ 已接入 |  |
| `query_recording_sql` | ✅ 已接入 |  |
| `cancel_recording_query` | ✅ 已接入 |  |
| `flush_recording` | ✅ 已接入 |  |
| `delete_recording_session` | ✅ 已接入 |  |
| `cleanup_recording_sessions` | ✅ 已接入 |  |
| `export_recording_data` | ✅ 已接入 |  |
| `create_recording_session` | ✅ 已接入 |  |
| `set_active_recording_session` | ✅ 已接入 |  |
| `apply_recording_settings` | ✅ 已接入 |  |
| **AI / MCP** | | |
| `ai_list_providers` | 🕓 待接入 |  |
| `ai_chat_send` | 🕓 待接入 |  |
| `ai_chat_cancel` | 🕓 待接入 |  |
| `ai_tool_resolve` | 🕓 待接入 | 对应 WS 反向 RPC 回执 (P3) |
| `chat_list_sessions` | 🕓 待接入 |  |
| `chat_create_session` | 🕓 待接入 |  |
| `chat_get_session` | 🕓 待接入 |  |
| `chat_rename_session` | 🕓 待接入 |  |
| `chat_delete_session` | 🕓 待接入 |  |
| `chat_clear_session` | 🕓 待接入 |  |
| `ai_keychain_get` | 🕓 待接入 |  |
| `ai_keychain_set` | 🕓 待接入 |  |
| `ai_keychain_delete` | 🕓 待接入 |  |
| `mcp_list_servers` | 🕓 待接入 |  |
| `mcp_add_server` | 🕓 待接入 |  |
| `mcp_remove_server` | 🕓 待接入 |  |
| `mcp_set_server_enabled` | 🕓 待接入 |  |
| `mcp_list_tools` | 🕓 待接入 |  |
| `mcp_connection_states` | 🕓 待接入 |  |
| `mcp_call_tool` | 🕓 待接入 |  |
| `mcp_server_status` | 🕓 待接入 |  |
| `mcp_server_start` | 🕓 待接入 |  |
| `mcp_server_stop` | 🕓 待接入 |  |
| **文件产物与桌面专有** | | |
| `export_waveform_csv` | 🕓 待接入 | 服务端文件路径语义 → 需 `/api/v1/download/{token}` (P3) |
| `export_can_load_csv` | 🕓 待接入 | 同上 (P3) |
| `get_graph_hir` | 🕓 待接入 | 图 HIR 查询, 按需接入 (P3) |
| `parse_frame_decoder_input` | 🕓 待接入 | 纯预览计算, 实现体较长, P3 与 IPC 路径同步下沉 |
| `inspect_element` | 🖥 桌面专有 | 打开 webview 开发者工具 |
| `set_window_acrylic` | 🖥 桌面专有 | 窗口毛玻璃 (平台 API) |
| `show_main_window` | 🖥 桌面专有 | 窗口显示 (启动页时序) |
| `close_splashscreen` | 🖥 桌面专有 | 关闭启动页 |
| `check_update` | 🖥 桌面专有 | 应用更新器 (Tauri updater) |
| `download_and_install_update` | 🖥 桌面专有 | 同上 |

## 5. 前端设计 (P2, 待实施)

新增 `src/lib/rpc/` 四个文件, 把 `api` 对象从 Tauri API 上解绑:

```
types.ts           Transport 接口
tauriTransport.ts  今天的 invoke / Channel / listen (原样搬运)
httpTransport.ts   fetch + WebSocket + 订阅 demux + 重连 + 批量
index.ts           运行时选择 + 端点解析
```

```ts
export interface Transport {
  call<T>(cmd: string, args?: Record<string, unknown>): Promise<T>;
  listen<T>(event: string, handler: (p: T) => void): Promise<() => void>;
  subscribe<T>(req: unknown, kind: string, sink: (p: T) => void,
               opts?: { intervalMs?: number; maxItems?: number }): { cancel(): void };
  onReverse?(handler: (cmd: string, args: unknown) => Promise<unknown>): void;
}
```

`src/lib/tauri/tauri.ts` 的 `api` 对象**签名全部不变**, 只把内部 `invoke(...)`
换成 `transport.call(...)`; `subscribeDisplay` / `subscribeWaveform` / 各
`*Subscription.ts` 走 `transport.subscribe`。这样 88 个方法、~100 处调用点、
40+ 组件全部不改 — 这是前端改造的风险控制点。

选择规则: `window.__TAURI_INTERNALS__` 存在 → Tauri IPC, 否则 HTTP/WS。
端点解析: `?server=` → `localStorage['lissio.server']` → `VITE_LISSIO_SERVER` → 同源。
重连后重新水合 (`workspace_get` + `get_source_graph` + `get_workspace_run_state`
+ 重订阅) — 这条路径前端已存在, 直接复用。

平台服务 shim (`src/lib/platform/`) 覆盖 Tauri 插件能力: `plugin-store` (设置落
服务端 `/api/v1/settings` 或 localStorage)、`plugin-dialog` + `plugin-fs` (浏览器
文件选择 / 下载)、`plugin-opener` (`window.open`)、更新器 (Web 端隐藏)、系统通知
(应用内 Toast + `Notification` API)。

## 6. CLI 设计

```
backend-cli serve [--bind] [--http-port] [--token-file] [--static-dir]
                  [--cors-origin] [--mcp-port | --no-mcp] [--no-http]
backend-cli rpc <cmd> [--args <json|@file>]
backend-cli devices|send|inject|endpoint|graph|data|snapshot|frame|run|record   # 不变
```

- `serve` 默认同时提供 Web 出口与 MCP; `--no-http` 退回"仅 MCP"的旧行为。
- `rpc` 直通 `rpc-api` 派发表 — CLI 自动覆盖全量能力面, 不必为每个新命令加子命令。
- `backend-cli` 与 `lissio-server` 是同一装配的两个入口 (都走
  `backend_host::assemble` + `rpc_api::dispatch`), 零业务重复。

## 7. 测试与门禁

| 门禁 | 内容 |
|---|---|
| `pnpm check:web-contract` | 四个清单互补 + `SUPPORTED` 与 `dispatch` 分支一一对应 + 前端 `invoke` 名都在 IPC 注册表内 |
| `pnpm check:architecture` | 新 crate 的目录 / metadata / 层序 / 适配器隔离 |
| `pnpm check:deps` | `axum` (ws feature) / `tower-http` 等新依赖必须登记在 `[workspace.dependencies]` |
| `cargo clippy --workspace --all-targets` | 仓库从严配置, 警告即错误 |
| `cargo test --workspace` | 含 `rpc-api` 参数归一 / 清单互补、`backend-server` 帧编解码 / 令牌比较 / 订阅帧 |

手工验收 (P1 竖切):

```sh
# 终端 1: 起服务 (静态站点内嵌则浏览器直开 http://127.0.0.1:8790)
cargo run -p backend-server            # 或 backend-cli serve

# 终端 2: 探活 + 能力清单 + 一条命令
curl -s http://127.0.0.1:8790/api/v1/health
TOKEN=$(cat ~/Library/Application\ Support/top.pengheng.lissio/server-token)
curl -s -H "Authorization: Bearer $TOKEN" http://127.0.0.1:8790/api/v1/capabilities
curl -s -H "Authorization: Bearer $TOKEN" -H 'content-type: application/json' \
  -d '{"id":1,"cmd":"get_pipeline_config","args":{}}' http://127.0.0.1:8790/api/v1/rpc

# 等价的 CLI 逃生口 (与上面同一条派发路径)
cargo run -p backend-cli -- rpc get_pipeline_config
```

## 8. 落地阶段

| 阶段 | 内容 | 状态 |
|---|---|---|
| P0 契约冻结 | 本文件 + 命令能力矩阵 + `scripts/check-web-contract.mjs` | 已完成 |
| P1 后端竖切 | `BackendHost` 上移; `rpc-api` (88 条命令); `backend-server` (HTTP/WS/鉴权/静态站点); `backend-cli serve --http` 与 `rpc` | 已完成 |
| P2 前端解绑 | `src/lib/rpc/` 四文件; `tauri.ts` 与各 `*Subscription.ts` 切 transport; 先验证桌面零回归 | 待实施 |
| P3 全量能力 + 平台 shim | 文件产物下载端点; `ai-host` 迁移 + `SecretStore` 端口; `parse_frame_decoder_input` / `get_graph_hir`; `platform/` shim; 服务端 settings | 待实施 |
| P4 收尾 | 前端浏览器 E2E; `exits.md` 与本文件的最终校对; README 使用说明 | 待实施 |

## 9. 未决事项

1. **桌面端是否统一走 HTTP/WS** — 当前设计保留双 transport (桌面 IPC 默认), 以获得
   二进制快路径与零回归。
2. **首版是否包含 AI 面板** — 涉及 `ai-host` 迁移 (会话存储 / MCP 管理器 / 内置工具
   执行器从 `src-tauri` 搬出) 与 `SecretStore` 端口注入 (桌面用 keyring, 服务端用
   0600 文件或 `LISSIO_AI_API_KEY`); 未完成前 AI 相关命令在 `/capabilities` 中列为
   `pending`。
3. **多客户端语义** — 当前是"同一后端会话的多个视图", 图并发编辑沿用既有
   `baseVersion` 乐观并发 (`GraphVersionConflict`); 不承诺多人同时编辑。
4. **`parse_frame_decoder_input`** — 纯预览计算, 实现体在 Tauri 命令层; 应下沉到
   共享层后两个出口同时接入, 而不是复制一份。
