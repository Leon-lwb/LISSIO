# Lissio 架构设计与审查（2026-09）

> 基于 `pnpm architecture` / `check:architecture` / `check:deps` / `check:web-contract` /
> `check:contracts` 的实机结果与源码勘察。所有结论带路径，可复核。

## 0. 系统定位

Lissio 是一个**设备数据采集 + 实时可视化 + 节点图计算**的上位机。它不是"一个 Tauri 应用"，
而是**一个独立后端 + 四个协议出口**：桌面壳只是其中一个出口，且把业务能力全部委托给
独立进程 `lissio-server`（sidecar）。

| 指标 | 数值 |
|---|---|
| Rust crate | 63（62 成员 + 根 `lissio`） |
| Rust 代码 | 594 个 `.rs` / 约 104.6k 行 |
| 前端代码 | 682 个 `.ts|.tsx` / 约 65.2k 行 |
| 后端公共命令 | 120 条（`SUPPORTED`）+ 9 条桌面专有 + 2 条通道命令 |
| 机器生成的 TS 契约 | 179 个文件（`src/types/generated/`） |

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
`generate_handler!` 只剩 9 条壳命令（窗口、启动页、更新器、sidecar 管理），
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
- `tauriTransport.ts`：Tauri IPC，仅单测与 9 条壳命令使用

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

## 5. 审查发现

### P1 — 应尽快处理

**1. `src-tauri/src/` 下约 1,900 行死代码未挂入模块树**
`src/lib.rs` 只声明 `mod shell; mod sidecar;`。`src/commands/`（11 个子目录，
acquisition / buffer / can_load / can_transport / debug / display / graph / pipeline /
rawdata / recording，约 1,763 行）、`src/event_sink.rs`（83 行）、`src/gui_host.rs`（36 行）
都**不在编译范围内**，是出口拆分前的遗留。更糟的是 `src/commands/mod.rs` 声明了
`pub mod ai;`，而该目录并不存在——一旦有人把它接回模块树会直接编译失败。
建议：确认无用后删除；若确有价值，先补 `ai` 模块再接入。

**2. 架构文档与代码已漂移（文档仍被 AGENTS.md 指定为权威）**
- `docs/architecture/crates.md:74-75` 明令 "`graph` keeps `compiler::{hir, plane, lower}`
  and `eval` as private implementation stages. Do not split compiler phases into crates."
  现实：`hir` / `plane` / `lower` / `eval` / `kind` / `trigger` / `buffer_graph` 全是独立 crate。
- 同文件"Stable target crates"表与现状不符：`shared` 域写的 `config` 不存在
  （多了 `error`、`subscription`）；`transport` 域写的 `test-data` 只是
  `transport/src/test_data.rs` 一个模块；`protocol` / `graph` 两域各缺 4–6 个现存 crate。
- `docs/architecture/data-plane.md` §7 关键位置索引 13 条路径**仅 2 条正确**
  （旧 crate 名 `data_plane` / `buffer_databuffer` / `cmd/display` 早已不存在）。
- `data-plane.md` 引用的 `docs/experiments/` 与 `../performance/bench-audit-2026-09-04.md`
  均不存在；真实基准在 `crates/signal/waveform/benches/` 与
  `crates/desktop/pipeline/benches/{eval_bench,ingest_bench,pipeline_soak}.rs`。
- `docs/architecture/crate-layers.md` 是 4 行废弃占位，建议删除。

**3. 10 个 crate 的 `responsibility` 仍是占位符**
`bus`、`buffer-graph`、`filter`、`measurement`、`raw-data`、`spectrum`、`waveform`、
`automotive`、`automotive-diag`、`automotive-isotp` 的值都是
"Focused crate responsibility"。违反 AGENTS.md「新 crate 需要元数据与文档」，
而 `check:architecture` 并未拦截。建议把占位串加入检查的黑名单。

**4. 三个空域目录与域 DAG 冲突**
`crates/application`、`crates/integration`、`crates/workspace` 完全为空，
但 `crates.md` 的域 DAG 仍把它们画进去并声明了依赖箭头（`integration → application & ai`、
`application → data & transport & graph & …`）。建议：要么落地 crate，要么从 DAG 与文档移除。

### P2 — 值得排期

5. **`pipeline` 是全仓耦合顶点**（依赖 31 个 crate），同时承担字节平面、记录平面、
   图求值调度、点位投影、录制绑定与指标统计。建议把"图求值调度"或"记录平面"拆成
   L2 独立 crate，降低单点复杂度。
6. **同族 crate 分层不一致**：`automotive` 与 `automotive-isotp` 是 L4，
   `automotive-diag` 却是 L2。三者在概念上是同一族，应统一到 L4。
7. **前端大文件**：`lib/tauri/tauri.ts` 800 行、`lib/rpc/httpTransport.ts` 712、
   `components/ThemeEditor.tsx` 774、`components/ai/AiChatPanel.tsx` 804、
   `store/dockStore.ts` 623、`components/displays/waveform/WaveformChart.tsx` 627。
   `tauri.ts` 在 HTTP 出口时代已退化为门面，可考虑按域拆分或收缩。
8. **基准与实验文档缺失**：代码里有三个 bench 与 `scripts/bench-audit.sh`，
   但没有对应的 `docs/experiments/`（`data-plane.md` 已在引用它）。

## 6. 建议的演进顺序

**短期（1–2 天，纯清理，风险低）**
1. 删除 `src/commands/`、`src/event_sink.rs`、`src/gui_host.rs`（先 `git rm`，可回滚）
2. 删除空域目录 `application` / `integration` / `workspace`，同步从 `crates.md` DAG 移除
3. 修正 `crates.md` 的域清单表与"禁止拆分编译阶段"条款；重写 `data-plane.md` §7 索引
4. 删除 `crate-layers.md`
5. 补齐 10 个占位 `responsibility`，并在 `check:architecture` 中拒绝占位串

**中期（按迭代排期）**
6. 拆分 `pipeline`，统一 `automotive*` 分层
7. 建 `docs/experiments/`，把 bench 结果与五条不变量的仲裁测试落文
8. 前端按"通信门面 / 图表 / AI 面板"三块收敛大文件

## 7. 结论

架构骨架是健康的：**分层清晰、方向单一、端口完备、且被五个脚本机器守护**。
数据平面与图编译器的设计尤其扎实——不是补丁堆叠，而是用结构不变量消灭了整类问题。
当前的主要风险不在代码，而在**文档与代码的漂移**：AGENTS.md 指定 `crates.md` 为权威，
但它已经落后于实现；一个新人按文档读会得出与代码相反的结论。
先把文档对齐、清掉死代码，这个架构可以继续支撑 2–3 倍的规模。
