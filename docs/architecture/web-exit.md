# Web 出口 — 服务后端拆分设计

本文件描述已经落地的独立后端架构与 `lissio.web.v2` 协议。Web 与 Desktop 的
业务调用都经 HTTP-RPC + WebSocket 进入同一个 `lissio-server`，CLI 复用同一装配与
派发表。所有出口共用同一份能力核心
([`control-api`](../../src-tauri/crates/desktop/control-api)) 与同一份装配
([`backend-host`](../../src-tauri/crates/desktop/backend-host))。

约定与红线沿用 [exits.md](exits.md): **命令名、参数名、错误 `kind`、事件名、
payload 形状、持久化文件格式对前端保持不变**。Web 出口是"把既有 IPC 语义搬进
HTTP/WS", 不是重新设计 API。

## 1. 目标形态

三个可独立发布的交付单元:

```
                     ┌──────────── 浏览器 ────────────┐
                     │  dist/ (静态托管)               │
                     └──────────────┬─────────────────┘
                                    │ HTTP-RPC + WebSocket
                                    ▼
  桌面 (Tauri webview)       lissio-server (独立进程)
       │ HTTP/WS                  ├ control-api   能力核心
       └────────────────────────►├ backend-host  装配 / 生命周期
       Tauri 只管理同版本 sidecar  ├ ai-host       AI / MCP / secrets
                                  └ workspace / recordings / settings
```

| 形态 | 后端位置 | 前端 transport | 状态 |
|---|---|---|---|
| A Backend/CLI | 独立 `lissio-server` + `backend-cli` | HTTP + WS / argv | 独立压缩包 |
| B Desktop | Tauri 自动监管同版本 sidecar | HTTP + WS | 安装后自动启动 |
| C Web | 任意兼容的远端后端 | HTTP + WS | 纯静态包或 OCI 同源部署 |

Tauri IPC 只承载窗口、菜单、更新器、文件对话框和 sidecar 控制。业务 IPC 不存在
回退路径，波形快路径改由 WebSocket 二进制帧承载。

## 2. crate 边界

| crate | 层 | 职责 | 状态 |
|---|---|---|---|
| `rpc-api` | L4 desktop | 出口无关的命令派发 — 命令名 + JSON 参数 → `control-api` / `app` 能力 | 新增 |
| `backend-server` | L5 desktop | Web 出口组合根 — axum HTTP-RPC / WebSocket / 鉴权 / 静态站点; bin `lissio-server` | 新增 |
| `backend-host` | L4 desktop | 装配与生命周期 — 新增 `BackendHost` / `assemble` / `teardown`, GUI 与全部无界面出口共用 | 扩展 |
| `backend-cli` | L5 desktop | argv 出口 — `Host` 改为复用 `backend-host`, 新增 `serve --http` 与 `rpc` | 扩展 |
| `ai-host` | L4 desktop | AI 会话 / MCP / 内置工具 / 只写密钥端口 | 已完成 |

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
{ "type": "notify",     "level": "error", "message": "...", "url": "/api/v1/download/…" }  // url 仅导出类通知携带 (P3)
{ "type": "stream",     "id": 7, "payload": { "kind": "waveform", "payload": { ... } } }
{ "type": "subscribed", "id": 7 }
{ "type": "unsubscribed", "id": 7 }
{ "type": "response",   "id": 1, "ok": true, "result": { ... } }
{ "type": "channel",    "id": 3, "payload": { "type": "delta", "text": "…" } }
{ "type": "fault",      "message": "...", "id": 7 }   // id 仅订阅建立失败时出现

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

代价是回执与请求只能靠**顺序**配对: 服务端在单条连接上顺序处理文本帧, 因此客户端
必须让"等待回执队列"与 subscribe 帧的发送顺序严格一致 — 取消一条尚未收到回执的
订阅时不能把它从队列里摘掉, 否则后续回执会错配到下一条订阅 (收到回执后再补发
`unsubscribe` 即可)。

`fault.id` 是 P2 补上的: 回执先于订阅尝试下发, 所以"回执到达"不等于"订阅成功",
客户端需要一个归属标记才能把失败落到具体订阅上 (桌面出口对应 `subscribe_data` 的
reject)。帧级错误没有归属, 省略该字段。

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
| `GET /api/v1/download/{token}` | 导出产物下载 — 只服务暂存区登记过的 token, **不接受任意服务器路径** (P3) |
| `GET /api/v1/settings` | 设置读取 — 与桌面 `plugin-store` 的 `settings.json` 同一文件与形状 (P3) |
| `PUT /api/v1/settings` | 设置整表覆盖 (与 `LazyStore.set('app', …)` 等价, P3) |
| `GET /api/v1/health` | 健康检查 (无鉴权) |
| `GET /api/v1/handshake` | 受鉴权握手：服务版本、协议版本、实例 ID、能力清单 |
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
- WS: `Sec-WebSocket-Protocol: lissio.v2, bearer.<token>` —— 浏览器 WebSocket API
  无法设置请求头, 子协议是唯一不把令牌写进 URL 的方式 (URL 会进访问日志)。
- 令牌比较是定长比较, 不按前缀提前返回。
- CORS 白名单为空时不挂 CORS 层 (同源部署无需跨源, 也避免误开放)。
- `SIGTERM` / Ctrl-C 触发优雅收尾: 停录制 + flush 工作区。

## 4. 命令能力矩阵

命令面以 `rpc-api/src/catalog.rs` 为唯一权威, 由 `pnpm check:web-contract`
校验四个清单互斥、后端派发表完整，以及 Tauri 根包只注册 `DESKTOP_ONLY` 壳命令。

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
| `ai_list_providers` / `ai_chat_send` / `ai_chat_cancel` | ✅ 已接入 | 流式事件走 v2 `channel` 帧 |
| `ai_tool_resolve` | ✅ 已接入 | 只回到发起对话的连接 |
| `chat_*` 会话 CRUD | ✅ 已接入 | 会话由后端持久化 |
| `ai_secret_status/set/delete` | ✅ 已接入 | 状态接口不返回明文；环境来源只读 |
| `mcp_list/add/remove/set/list_tools/connection_states/call_tool` | ✅ 已接入 | 外部 MCP 由 `AiHost` 管理 |
| `mcp_server_status/start/stop` | ✅ 已接入 | 入站 MCP 生命周期唯一归属 `AiHost` |
| **文件产物与桌面专有** | | |
| `export_waveform_csv` | ✅ 已接入 | Web 出口写受管暂存区, 下载链接经 `notify` 帧下发 (P3) |
| `export_can_load_csv` | ✅ 已接入 | 同上; 返回值为下载 URL (桌面为本地路径) |
| `get_graph_hir` | ✅ 已接入 | 投影实现下沉 `control-api::graph_hir`, 与 IPC 共用 |
| `parse_frame_decoder_input` | ✅ 已接入 | 实现体下沉 `control-api::frame_decoder`, 与 IPC 共用 |
| `inspect_element` | 🖥 桌面专有 | 打开 webview 开发者工具 |
| `set_window_acrylic` | 🖥 桌面专有 | 窗口毛玻璃 (平台 API) |
| `show_main_window` | 🖥 桌面专有 | 窗口显示 (启动页时序) |
| `close_splashscreen` | 🖥 桌面专有 | 关闭启动页 |
| `check_update` | 🖥 桌面专有 | 应用更新器 (Tauri updater) |
| `download_and_install_update` | 🖥 桌面专有 | 同上 |

## 5. 前端 transport (P2, 已完成)

`src/lib/rpc/` 四个文件把 `api` 对象从 Tauri API 上解绑:

```
types.ts           Transport 契约 (call / listen / eventChannel / subscribe / onReconnect)
tauriTransport.ts  invoke + listen + Channel (原样搬运, 含取消期间的竞态兜底)
httpTransport.ts   fetch + WebSocket + 订阅 demux + 重连 + 微批量
index.ts           运行时选择 + 端点解析
```

```ts
export interface Transport {
  readonly kind: 'tauri' | 'http';
  call<T>(cmd: string, args?: Record<string, unknown>): Promise<T>;
  listen<T>(event: string, handler: (payload: T) => void): Promise<() => void>;
  eventChannel<T>(): EventChannel<T>;
  subscribe<T>(request: unknown, sink: (payload: T) => void,
               options?: SubscribeOptions): SubscriptionHandle;
  onReconnect?(handler: () => void): () => void;
}
```

`src/lib/tauri/tauri.ts` 的业务调用面保持原有调用方式，内部 `invoke(...)` 换成
`transport.call(...)`; `subscribeDisplay` /
`subscribeWaveform` / 各 `*Subscription.ts` 走 `transport.subscribe`。事件监听
(`events.ts` / `App.tsx` / `toolHost` / `updateStore`) 走 `transport.listen`, 因此
handler 收到的是 payload 本身而不是 Tauri 的 `Event` 包装。

### 5.1 Desktop 与 Web 的统一语义

- **订阅 id**: 两种 UI 都由服务端 `subscribed` 回执取得，流帧到达前一定已分配。
- **建立失败**: `SubscribeOptions.onError` 由 `fault{id}` 触发。
- **建立结束**: `SubscriptionHandle.settled` 恒 resolve (成功与失败都算结束), 供
  订阅方做生命周期对账 (`dataClient` 用它收回"在途建立"守卫)。失败之所以不放在这里,
  是因为 Web 的回执先于订阅尝试下发, 一个 promise 无法同时表达两件事。
- **取消竞态**: 记录留在等待队列里占位，回执到达时立即注销，保证不误配下一订阅。
- **事件通道**: `ai_chat_send` 参数中的 `{ "$channel": id }` 让命令自动走 WS RPC；
  后端以 `channel` 帧流式返回。终态事件会释放通道登记。
- **前端工具隔离**: `ai_tool_invoke` 使用连接级事件 sink，只会发给对话发起者。

### 5.2 Web 出口行为

- **微批量**: 同一微任务内发出的命令合成一个数组请求。启动突发与 `ack_data` 背压
  反馈都是这种形态, 合并后显著减少往返。
- **重连**: WS 断开后按 500ms→8s 退避重连, 重连成功即按原顺序重新订阅全部活跃流
  (服务端订阅表已随连接关闭注销), 并触发 `onReconnect` — `events.ts` 据此重新水合
  `workspace_get` / `get_source_graph` / `get_workspace_run_state`。断线期间丢失的后端
  事件无法回放, 只能靠拉取对账。
- **错误形状**: `call` 拒绝的是 `{kind, message}` 结构化错误 (HTTP 与 WS 一致),
  `parseNodeError` / `errorGuidance` 两个出口通用; `kind` 取自 `rpc_api::RpcError`。
- **`notify` 帧**: 已接入 (P3)。帧可携带可选的 `url` — 导出类命令把产物挂在
  `/api/v1/download/{token}` 上, 应用内提示据此给出"下载"动作。浏览器无法在导航
  请求上附加 `Authorization` 头, 因此下载走带鉴权的 `fetch` 取回字节流再触发保存
  (`Transport::downloadFile`), 令牌不进 URL。系统级通知 (Notification API) 仍由平台
  shim 统一接管。

### 5.3 端点与令牌

业务 transport 始终是 HTTP/WS。`window.__TAURI_INTERNALS__` 仅用于选择窗口、更新器、
sidecar 管理等壳层命令。

端点解析: `?server=` → `localStorage['lissio.server']` → 构建期
`VITE_LISSIO_SERVER` → 同源。令牌为 `?token=` →
`sessionStorage['lissio.token']` → `VITE_LISSIO_TOKEN`，默认不跨浏览器会话持久化。
查询参数使用后立即从地址栏摘除；反向代理路径前缀会被保留。

### 5.4 门禁

`pnpm check:web-contract` 有两条并列的"出口泄漏"检查:

1. **IPC 封装** — 除 `src/lib/rpc/` 之外, 任何前端文件不得 import
   `@tauri-apps/api/{core,event}` 或直接调用 `invoke()` / `listen()`。
2. **插件封装** — 除 `src/lib/platform/` 之外, 任何前端文件不得 import **任何**
   `@tauri-apps/*` 模块 (静态 `from` / 裸 `import` / 动态 `import()` 都匹配)。
   `src/lib/rpc/` 只豁免它本职的 `api/{core,event}`, 插件调用点一律必须收进
   platform shim。

这两条是 P2/P3 的防回归核心 —— 漏掉一处调用点就会让该能力在浏览器里静默失效。

### 5.5 平台服务 shim (P3, 已完成)

`src/lib/platform/` 覆盖 Tauri 插件能力, 由 `hasTauriRuntime()` 装配 (与 transport
同一条判定):

```
types.ts    Platform / PlatformStore 契约 (运行时无关)
tauri.ts    tauriPlatform — 薄委托现有插件, 行为与拆分前逐字一致
web.ts      webPlatform   — 浏览器等价能力或明确降级
window.ts   桌面专属窗口控制 (缩放/最小化/最大化/关闭), 浏览器 no-op
index.ts    hasTauriRuntime() ? tauriPlatform : webPlatform
```

浏览器实现:

| 能力 | 桌面 | Web 出口 |
|---|---|---|
| 设置存储 | `plugin-store` 的 `settings.json` | `GET`/`PUT /api/v1/settings` (同一文件与形状) |
| 保存文件 | 原生"另存为"对话框 → 写盘 | 退化为浏览器下载 (Blob + `<a download>`) |
| 打开文件 | 原生"打开"对话框 → 真实路径 | 隐藏 `<input type=file>` + 模块级句柄 `browser-file:<n>` |
| 打开链接 | `plugin-opener` | `window.open(url, '_blank', 'noopener,noreferrer')` |
| 退出 / 重启 | `plugin-process` | 退出仅告警; 重启退化为页面刷新 |
| 版本 / 名称 | `api/app` | `VITE_APP_VERSION ?? 'web'` / `'Lissio'` |
| 窗口控制 | 原生窗口 | 无等价能力 (桌面专属, 已在 `window.ts` 守卫) |

因此浏览器端设置可持久化 (首次引导向导不再每次加载都弹), 文件选择 / 导出走浏览器
等价路径, 更新器与窗口控制在 Web 端隐藏或 no-op。

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
| `pnpm check:web-contract` | 四个清单互补 + `SUPPORTED` 与 `dispatch` 分支一一对应 + Tauri 仅注册 `DESKTOP_ONLY` + 出口封装无泄漏 |
| `pnpm check:architecture` | 新 crate 的目录 / metadata / 层序 / 适配器隔离 |
| `pnpm check:deps` | `axum` (ws feature) / `tower-http` 等新依赖必须登记在 `[workspace.dependencies]` |
| `cargo clippy --workspace --all-targets` | 仓库从严配置, 警告即错误 |
| `cargo test --workspace` | 含 `rpc-api` 参数归一 / 清单互补、`backend-server` 帧编解码 / 令牌比较 / 订阅帧、`app` 恢复完成门时序 |
| `pnpm test` | 含 `src/lib/rpc/__tests__/` 三个套件: 桌面委托语义、Web 出口状态机 (回执 FIFO / 取消竞态 / 重连重订 / 二进制分流)、端点解析 |

Web 出口的自动验证分两层:

- **Vitest transport 契约**: HTTP 微批量、逐条成败映射、WS RPC/事件通道、订阅回执、
  取消竞态、二进制分流、断线重连与重新订阅。
- **Playwright + 真实 `lissio-server`**: 无后端诊断、正确令牌握手后才挂载应用、
  错误令牌与网络不可达的分类，以及查询参数令牌的即时清理。

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
| P1 后端竖切 | `BackendHost` 上移; `rpc-api` 全量派发; `backend-server` (HTTP/WS/鉴权/静态站点); `backend-cli serve --http` 与 `rpc` | 已完成 |
| P2 前端解绑 | `src/lib/rpc/` 四文件; `tauri.ts` 与各 `*Subscription.ts` 切 transport; 事件监听切 transport; 重连重水合; 出口泄漏门禁 | 已完成 |
| P3 全量能力 + 平台 shim | 文件产物、`ai-host`、SecretStore、settings、通知 | 已完成 |
| P4 独立交付 | sidecar、连接门、Backend/Web 压缩包、OCI 与 Release 门禁 | 已完成 |

## 9. 未决事项

1. **多客户端语义** — 当前是"同一后端会话的多个视图", 图并发编辑沿用既有
   `baseVersion` 乐观并发 (`GraphVersionConflict`); 不承诺多人同时编辑。
2. **`parse_frame_decoder_input`** — 实现体下沉到
   [`control-api::frame_decoder`](../../src-tauri/crates/desktop/control-api/src/frame_decoder.rs),
   桌面 IPC 与 Web 出口共用同一份实现 (`get_graph_hir` 同法下沉到
   `control-api::graph_hir`)。
3. **浏览器端性能** — 20 kHz × 4ch 的 TestData 会把浏览器渲染压满 (服务端与线协议
   都正常, 只是前端逐帧重绘跟不上)。这是 Web 出口的固有限制而非缺陷, 但值得在
   P4 明确"浏览器端建议的数据规模"或引入抽帧策略。
