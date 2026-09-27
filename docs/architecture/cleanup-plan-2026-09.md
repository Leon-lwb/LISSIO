# 架构清理执行计划（2026-09）

> 承接 [`architecture-review-2026-09.md`](architecture-review-2026-09.md) 的 P1/P2 发现。
> 本文件是**可派发的任务清单**：每个任务含涉及文件、操作步骤、验收标准与验证命令。

## 0. 工作流约定（所有任务共同前提）

| 约定 | 内容 |
|---|---|
| 分支 | 从 `develop` 切 `chore/architecture-cleanup-2026-09`；P1 与 P2 各一个分支 |
| 删除方式 | 一律 `git rm`（保留历史可回滚），**禁止 `rm -rf`**；`src/commands/**` 已确认不在编译范围 |
| 提交粒度 | 一任务一提交，消息前缀 `chore(arch): T{n} …` |
| 总闸 | 每任务结束必须跑完第 5 节的验收命令组，全绿才允许进入下一任务 |

### 关键风险（执行前必读）

`src/commands/skills/{zh,en}/*.md` 这 10 个文件**不是死代码**——
`src-tauri/crates/desktop/ai-host/src/skills.rs:63-100` 用 10 处
`include_str!("../../../../src/commands/skills/...")` 在编译期嵌入了它们。
**必须先迁移再删除**（T1 是 T2 的前置）。

除此之外，`src/commands/` 与 `src/event_sink.rs`、`src/gui_host.rs` 已全仓检索确认无引用：
`scripts/check-web-contract.mjs` 只读 `src-tauri/src/lib.rs`，不读 `commands/`。

## 1. 阶段 S1 — 死代码清理与资源归位（P1）

### T1 迁移 AI skills 文档并更新 `include_str!` 路径

> **已完成 (2026-09, 被软件能力节点注册表方案取代)**:`ai-host/src/skills.rs`
> 已删除,10 个 md 文档迁至
> `src-tauri/crates/desktop/control-api/src/capabilities/docs/{zh,en}/`,由
> `control-api/src/capabilities/` 各能力节点挂载;skill 清单与 `read_skill`
> 从注册表动态派生。T2 的前置条件已满足。

### T2 删除桌面壳死代码

- **涉及**：`src-tauri/src/commands/`（29 个 `.rs`，1,774 行）、
  `src-tauri/src/event_sink.rs`（83 行）、`src-tauri/src/gui_host.rs`（36 行）
- **前置**：T1 完成
- **步骤**：`git rm -r src-tauri/src/commands src-tauri/src/event_sink.rs src-tauri/src/gui_host.rs`
- **验收**：`cargo check -p lissio --all-targets` 通过（这些文件本就不参与编译，删除后行为不变）
- **备注**：`src/commands/mod.rs` 声明的 `pub mod ai;` 指向不存在的目录——这是它被遗弃的证据，
  不要尝试"修复"，直接删除

### T3 更新 `rpc-api` 的过期注释引用

- **涉及**：`src-tauri/crates/desktop/rpc-api/src/lib.rs:6`
- **步骤**：注释里"桌面 IPC (`src-tauri/src/commands`)"改为
  "桌面平台壳 (`src-tauri/src/lib.rs` 的 `generate_handler!`)"
- **验收**：注释不再指向已删除路径

## 2. 阶段 S2 — 文档对齐（P1）

### T4 修正 `docs/architecture/crates.md`

- **涉及**：`crates.md` 三处
- **步骤**
  1. **"Stable target crates"表**（59-72 行）按 `pnpm architecture --format=json` 重填：
     `shared` 域改为 `data-model` / `error` / `flow` / `subscription`（`config` 不存在）；
     `graph` 域补 `kind` / `hir` / `plane` / `lower` / `eval` / `buffer-graph`；
     `protocol` 域补 `schema-types` / `logic-decoder` / `protocol-float` / `protocol-can-bridge`；
     `transport` 域删除 `test-data`（它只是 `transport/src/test_data.rs` 一个模块）
  2. **74-75 行**删除"Do not split compiler phases into crates"条款，改为说明四段已各自成 crate、
     由 `graph` 门面编排
  3. **域 DAG**（41-54 行）移除空域 `application` / `integration` / `workspace` 及其箭头
- **验收**：`pnpm architecture` 输出的域/层清单与文档表格一致

### T5 重写 `data-plane.md` 的位置索引与基准引用

- **涉及**：`docs/architecture/data-plane.md` §7（122-135 行）、§5（99-103 行）、§8（137-155 行）
- **步骤**：按下表替换全部 13 条路径（`crates/<domain>/<crate>` 前缀）

| 文档旧路径 | 真实路径 |
|---|---|
| `data_plane/src/data_plane/mod.rs` | `crates/desktop/pipeline/src/data_plane/protocol_node_state.rs`(`restamp_frames`) |
| `data_plane/src/data_plane/frame_dispatch.rs` | `crates/desktop/pipeline/src/data_plane/frame_dispatch.rs` |
| `data_plane/src/data_plane/byte_router.rs` | `crates/desktop/pipeline/src/data_plane/byte_router.rs` |
| `mod.rs`(`rebuild_route_groups`) | `crates/desktop/pipeline/src/data_plane/routes.rs` |
| `eval_queue.rs` | `crates/desktop/pipeline/src/data_plane/eval_queue.rs` |
| `graph_eval.rs` | `crates/desktop/pipeline/src/graph_eval/mod.rs` |
| `buffer_databuffer/src/tier.rs` | `crates/signal/waveform/src/tier.rs` |
| `window.rs`(`snapshot_window_budget`) | `crates/signal/waveform/src/window/snapshot.rs` |
| `buffer_databuffer/src/derived.rs` | `crates/signal/waveform/src/derived.rs` |
| `mod.rs`(`tune_buffer_capacity`) | `crates/desktop/pipeline/src/data_plane/routes.rs` |
| `cmd/display/src/waveform_binary.rs` | `crates/desktop/app/src/display/waveform_binary.rs` |
| `pipeline/src/data_plane/read_task.rs` | `crates/desktop/pipeline/src/data_plane/read_task.rs` |
| `transport/src/byte_simulation.rs` | `crates/transport/transport/src/byte_simulation.rs` |

  另：§5 引用的 `docs/experiments/` 与 §8 的 `../performance/bench-audit-2026-09-04.md` 均不存在，
  改写为现有三个 bench：`crates/signal/waveform/benches/waveform_pyramid_bench.rs`、
  `crates/desktop/pipeline/benches/{eval_bench,ingest_bench,pipeline_soak}.rs`
- **验收**：索引表 13 条路径全部能在仓库中打开

### T6 删除废弃的 `crate-layers.md`

- **步骤**：`git rm docs/architecture/crate-layers.md`（4 行占位，已声明 superseded）
- **验收**：`docs/architecture/` 下无 superseded 文件

## 3. 阶段 S3 — 元数据与守门增强（P1）

### T7 补齐 10 个占位的 `responsibility`

- **涉及**：`bus`、`buffer-graph`、`filter`、`measurement`、`raw-data`、`spectrum`、`waveform`、
  `automotive`、`automotive-diag`、`automotive-isotp` 的 `[package.metadata.lissio].responsibility`
- **步骤**：逐个按实际职责填写（一行中文，描述"它为什么存在"）。
  参考：`waveform` = "多通道波形缓冲 — L0 原始环 + min-max 金字塔 + 派生独立时间轴 + 预算感知快照"
- **验收**：`pnpm architecture` 输出中不再出现 "Focused crate responsibility"

### T8 让 `check:architecture` 拒绝占位串

- **涉及**：`scripts/check-crate-architecture.mjs`
- **步骤**：把 `Focused crate responsibility` 加入黑名单，命中即报错退出；
  顺带校验 `responsibility` 非空且长度 ≥ 8
- **验收**：临时把某个 crate 改回占位串 → 脚本必须失败

## 4. 阶段 S4 — 中期项（P2，另起分支 `chore/architecture-mid-2026-09`）

| 编号 | 任务 | 要点 |
|---|---|---|
| T9 | 拆分 `pipeline` 降低耦合顶点 | 当前依赖 31 个 crate；评估把"图求值调度"或"记录平面"拆为 L2 独立 crate |
| T10 | 统一 `automotive*` 分层 | `automotive-diag` 现为 L2，与 `automotive`/`automotive-isotp`(L4) 不一致，统一到 L4 |
| T11 | 建 `docs/experiments/` | 把三个 bench 的实测值与五条不变量的仲裁测试落文，供 `data-plane.md` 引用 |
| T12 | 前端大文件收敛 | `lib/tauri/tauri.ts`(800)、`httpTransport.ts`(712)、`ThemeEditor.tsx`(774)、`AiChatPanel.tsx`(804)、`dockStore.ts`(623)、`WaveformChart.tsx`(627) |

## 5. 验收命令组（每任务结束必跑）

```sh
pnpm architecture
pnpm check:architecture
pnpm check:deps
pnpm check:web-contract
pnpm check:contracts
cd src-tauri && cargo fmt --check
cd src-tauri && cargo clippy --workspace --all-targets
cd src-tauri && cargo test --workspace
```

预期：全部通过，`check:architecture` 仍输出 "62 domain-grouped crates + lissio composition root"，
`check:web-contract` 仍输出 "SUPPORTED 120 / DESKTOP_ONLY 9 / CHANNEL 2"。

## 6. 派发顺序与依赖

```
T1 → T2 → T3        （S1：必须先迁移 skills，再删死代码）
T4、T5、T6          （S2：文档，三者互不依赖，可并行派发）
T7 → T8             （S3：先补数据，再上守门）
T9 / T10 / T11 / T12（S4：互不依赖，按迭代排期）
```

S1 建议串行单人执行（涉及删除，需连续验证）；S2 三条可并行；S3 串行。
