# Lissio 架构设计与审查（2026-09）

> 复核日期：2026-09-29。基于 `pnpm architecture` / `check:architecture` /
> `check:deps` / `check:web-contract` / `check:contracts` / `check:model-catalog`
> 的实机结果与源码勘察。所有结论带路径，可复核。

## 0. 系统定位

Lissio 是一个**设备数据采集 + 实时可视化 + 节点图计算**的上位机。它不是"一个 Tauri 应用"，
而是**一个独立后端 + 四个协议出口**：桌面壳只是其中一个出口，且把业务能力全部委托给
独立进程 `lissio-server`（sidecar）。

| 指标 | 数值 |
|---|---|
| Rust crate | 63（62 成员 + 根 `lissio`） |
| Rust 代码 | 624 个 `.rs` / 约 112.3k 行 |
| 前端代码 | 711 个 `.ts|.tsx` / 约 67.8k 行 |
| 后端公共命令 | 121 条（`SUPPORTED`）+ 10 条桌面专有 + 2 条通道命令 |
| 机器生成的 TS 契约 | 185 个文件（`src/types/generated/`） |

## 1. 总体形态：四个出口，一个核心

```
桌面壳 (Tauri)   浏览器           MCP 客户端        CLI 脚本
  │ HTTP+WS        │ HTTP+WS        │ rmcp tools     │ argv
  │ sidecar        │ backend-server │ mcp-server     │ backend-cli
  └────────────────┴────────┬───────┴────────────────┘
                            ▼
        control-api（能力核心）+ rpc-api（出口无关派发）
                            ▼
        backend-host（统一装配：适配器注册 / 点位投影 / 工作区恢复 / 收尾）
                            ▼
        L0–L3 能力层（pipeline / graph_ops / acquisition / device-tree / graph / waveform）
```

关键性质：**L0–L3 不依赖 Tauri、rmcp、axum、clap**。`src-tauri/src/lib.rs` 的
`generate_handler!` 只剩 10 条壳命令（窗口、启动页、更新器、sidecar 管理），
与 `rpc_api::catalog::DESKTOP_ONLY` 逐字相等，由 `pnpm check:web-contract` 守护。

## 2. 分层与域

层级由 `[package.metadata.lissio].layer` 声明，域目录仅作视觉分组。

| 层 | 数量 | 语义 | 代表 crate |
|---|---|---|---|
| L0 | 7 | 稳定契约与类型 | `data-model`（41 反向依赖）、`error`（24）、`can`（19）、`points`、`flow`、`subscription`、`diagnostic` |
| L1 | 24 | 确定性引擎与内存结构 | `waveform`、`protocol*`、`schema`、`frame-decoder`、`graph` 编译链 9 个、`bus`、`events` |
| L2 | 8 | 有状态运行时与编排 | `pipeline`、`stream`、`evaluator`、`acquisition`、`device-tree`、`transport`、`recording`、`automotive-diag` |
| L3 | 3 | 产品用例与应用状态 | `app`、`control-api`、`graph_ops` |
| L4 | 16 | 硬件/OS/SDK/外部服务适配器 | `serial`、`network`、`can-transport`、`modbus-adapter`、`s7-adapter`、`automotive*`、`gpu`、`llm`、`chat*`、`mcp-client`、`mcp-server`、`ai-host`、`backend-host`、`rpc-api` |
| L5 | 5 | 组合根 | `lissio`、`backend-server`、`backend-cli`、`menu-shell`、`update-flow` |

规则：只能依赖同层或更低层，且必须满足域 DAG（`docs/architecture/crates.md`）。
`pnpm check:architecture` 当前通过。

耦合顶点（依赖数）：`pipeline` 31 → `rpc-api` 28 → `app` 22 → `backend-host` 21。

## 3. 七个值得保留的设计决策

### D1 端口式依赖倒置

| 端口 | 定义位置 | L4 实现 |
|---|---|---|
| `BackendEventSink` | `desktop/events` | `BroadcastEventSink`（WS）/ `CliEventSink` / `NullEventSink` |
| `StreamSink`（显示推流） | `desktop/app::display` | `WsStreamSink` |
| `EnvelopeEngine`（波形包络） | `signal/waveform` | `signal/gpu`（wgpu）与其 CPU 参考实现 |
| `ExecutionGate`（运行门控） | `protocol/acquisition` | 组合根注入 |
| `NodeDriver` / `NodeRuntime` | `transport/device-tree` | `serial` / `network` / `modbus-adapter` / `s7-adapter` … |
| `AcquisitionBackend` | `protocol/acquisition::plane` | `DeviceTreeAcquisition`（`device-tree/src/production.rs`） |

因此 `pipeline` 只见 `AcquisitionRuntime`，对设备树是透明的（`device-tree` 仅是它的
dev-dependency）。

### D2 架构约束机器可校验

| 脚本 | 守护什么 |
|---|---|
| `pnpm architecture` | crate / 域 / 层 / 职责 / 正反向依赖清单（`--format=json|dot`） |
| `pnpm check:architecture` | 布局、元数据、DAG、层级、适配器隔离、testkit 仅 dev-dep |
| `pnpm check:deps` | 第三方依赖版本全部走 `[workspace.dependencies]` 继承 |
| `pnpm check:web-contract` | 命令名四分类互斥、Tauri 注册表 == `DESKTOP_ONLY`、前端调用面无泄漏 |
| `pnpm check:contracts` | Rust 类型 → TS 契约生成物（179 文件）无漂移 |

这是本项目最强的资产：**架构腐化会在 CI 被拦住，而不是靠 review 发现**。

### D3 数据平面五条结构不变量

见 `docs/architecture/data-plane.md`。要点：

- 单一时钟域：`ts = 锚点 + 逻辑推进`，到达时间只在首批锚点出现（`restamp_frames`）
- 容量自洽：L0 容量 = 速率 × 2.5s 自动整定，上限 16M 点
- 记录与求值解耦：原始入库在字节平面完成；派生通道独立 `Mutex` + 独立时间轴
- 一次解析多路分发：同（字节源，协议配置等价）共享一次解析，`Arc<Vec<DataFrame>>` fan-out
- 丢弃显式化：`Lagged` / 评估队列丢批（`pending_gap`）/ `storage_overflow` 三类都可见

实测落点：`eval_queue` 三重预算 140,000 帧 · 8 MiB · 256 批；金字塔 `DECIMATION=16`、
每层 4096 块；预览降载 512 点/批且恒含批尾最新值。

### D4 节点图三段式编译 + 双平面

`kind`（词汇表）→ `hir`（TypedGraph）→ `plane`（值平面 `ValueMir` + 字节平面 `BytePlan`）
→ `lower`（`SlotPlan`）→ `eval`（`CompiledEval` 逐帧），`graph` 是门面。
热路径只有 `CompiledOp` 数组与非负 usize 槽位下标，**零字符串哈希**；
并行走 `graph_eval_parallel`（`spawn_blocking` + 自旋屏障 + SciRS2 SIMD）。

### D5 两级存储

- 实时：`RingBuffer` + min-max 金字塔（`crates/signal/waveform/src/{ring,data_buffer,tier,derived}.rs`），
  深拷贝即冻结（停止态快照语义）
- 历史：`data/recording` 用 **DuckDB**（`store.rs`，`rusqlite` 仅作基准对照），
  四域（waveform / raw / can / logic）分类型批次 + 崩溃恢复 + SQL 查询

### D6 设备树驱动契约 + 能力投影

`device-tree` 用 `NodeDriver::validate` → `ValidatedNodeConfig::driver_state` 在
validate→open 之间传递**强类型句柄**（不跨序列化边界）；运行时按
`as_byte_source / as_can_frame_source / as_reader / as_invoker …` 投影，再用
`contract_mismatches` 与声明的能力位图闭环自检。

### D7 前端单一传输抽象

`src/lib/rpc/` 定义 `Transport` 接口，两个实现：

- `httpTransport.ts`（712 行）：`POST /api/v1/rpc` + `GET /api/v1/ws`，Bearer 令牌
  （WS 走子协议 `bearer.<token>`），二进制流帧 10 字节头
- `tauriTransport.ts`：Tauri IPC，仅单测与 10 条壳命令使用

命令名、参数、事件名与 payload 在两种传输下**逐字一致**，因此业务代码不感知出口。
状态层是 zustand 单 store + 14 个 slice（`src/store/slices/`）。

## 4. 端到端数据流

```
设备 ──▶ L4 适配器 (serial/network/can-transport/…)
     ──▶ acquisition::TransportConnection { data_tx: broadcast }
     ──▶ pipeline::read_task          合批（字节目标 ∧ 50ms）
     ──▶ byte_router::route_inner     沿 BytePlan 分发，深度上限 16
     ──▶ protocol_feed::feed_protocol 解析 + 采样时钟定案 + 缓冲容量整定
       ├─▶ record_frames        → DataBuffer（L0 环 + 金字塔）
       └─▶ enqueue_frames       → 求值队列 → eval_worker → 派生通道
     ──▶ stream::WaveformSource::drain  锁内 memcpy 快照，锁外包络
     ──▶ app::display::waveform_binary  WWB1 v2 编码
     ──▶ BackendEventSink / WsStreamSink → 前端 TypedArray 零拷贝
```

11 个背压/丢弃点全部显式记账（设备广播 `Lagged`、门控丢字节、评估队列三重预算、
单批超预算拒收、缺口复位、L0 覆盖、预览降载、路由深度、发送失败、录制故障停机）。

## 5. 当前结构结论

### 已形成并被机器守护的结构

1. **产品逻辑退出 Tauri**：Desktop webview 与浏览器共用 `lissio-server` 的
   HTTP-RPC + WebSocket；Tauri 只管理窗口、菜单、更新器、启动页和 sidecar。
2. **四个出口共用一个能力核心**：`control-api` 承载能力，`rpc-api` 承载命令派发，
   `backend-host` 承载装配，`backend-server` / `backend-cli` / MCP 是薄适配器。
3. **设备模型统一为设备树**：`NodeDecl` 表达拓扑，`NodeDriver` 表达行为，
   `NodeRuntime` 投影能力，生命周期按子树传播。
4. **业务模型由 owner 定义**：模型目录、创建准备、草稿描述和 ts-rs wire 合同
   形成同一责任链；前端创建入口全部走目录服务。
5. **前端出口与平台能力解耦**：`src/lib/rpc/` 封装传输，`src/lib/platform/`
   封装桌面/浏览器平台服务，断线重连和重水合由 transport 层统一处理。
6. **契约可验证**：`check:web-contract`、`check:contracts`、`check:model-catalog`
   分别约束命令面、生成类型和模型目录。

### 仍需处理的结构债务

1. **未挂入模块树的历史文件**：`src-tauri/src/commands/`、`src/event_sink.rs`、
   `src/gui_host.rs` 不参与编译，且 `commands/mod.rs` 仍声明不存在的 `ai` 模块。
   它们容易被误认为 Tauri 业务出口，应通过 `git rm` 清理。
2. **crate 职责元数据仍有占位符**：`bus`、`buffer-graph`、`filter`、`measurement`、
   `raw-data`、`spectrum`、`waveform`、`automotive`、`automotive-isotp`、
   `automotive-diag` 仍写 `Focused crate responsibility`，应补齐并由
   `check:architecture` 拒绝占位串。
3. **`pipeline` 是耦合顶点**：同时承担字节路由、记录、求值调度、点位投影、录制绑定
   与指标。是否拆分必须以真实变更频率和基准结果为依据，不为减少依赖数盲目建 crate。
4. **`automotive*` 分层不一致**：`automotive-diag` 为 L2，`automotive` /
   `automotive-isotp` 为 L4。若继续作为同一适配器族演进，应统一层级语义。
5. **前端仍有大文件**：`lib/tauri/tauri.ts`、`lib/rpc/httpTransport.ts`、
   `ThemeEditor.tsx`、`AiChatPanel.tsx`、`dockStore.ts`、`WaveformChart.tsx`
   需要按职责继续拆分，避免 transport/UI/store 边界重新混杂。
6. **性能证据可继续独立成档**：当前基准源码与执行入口已经明确，但没有集中记录
   硬件、版本、原始结果和复现实验；如需跨版本比较，再建立实验结果目录。

## 6. 架构文档对齐结果

- `crates.md` 已按实际 workspace 补全领域、层级和 crate 清单；图编译链明确为
  独立责任 crate，由 `graph` 门面编排。
- `data-plane.md` 已改用真实 crate 路径和四个现有基准，不再引用已删除的实验文档。
- `exits.md` 已按 supervised sidecar 结构修正事件/流端口实现，并明确 Tauri 不再
  实现业务端口。
- `web-exit.md` 已去除交付阶段编号，改为当前交付边界与稳定不变量。
- 共享模型三份文档已从实施计划/迁移记录收敛为当前目录、合同与边界说明。
- `crate-layers.md` 已删除，避免与 `crates.md` 双重权威。

## 7. 结论

当前骨架已经从“Tauri 应用承载业务”演进为“独立后端 + 多出口 + 平台壳”：
分层、端口、设备树、模型目录和契约门禁都形成了明确结构。剩余风险主要是历史
未编译文件、占位元数据和少数高耦合/大文件，而不是出口或业务核心重复。
后续变更应优先删除误导性结构、补齐机器可校验元数据，再根据实际维护成本决定是否
拆分 `pipeline` 或重组前端大文件。
