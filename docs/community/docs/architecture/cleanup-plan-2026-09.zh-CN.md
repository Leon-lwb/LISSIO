# 架构清理清单（2026-09）

<!-- lissio-doc
status: maintained
owner: Lissio maintainers
last-reviewed: 2026-10-07
language: zh-CN
authoritative: false
translation-of: docs/architecture/cleanup-plan-2026-09.md
applies-to: Non-authoritative Chinese translation backup
-->

> 中文翻译备份；对应的英文源文件为权威版本。若中英文不一致，以英文为准。
> Chinese translation backup. The English source is authoritative; English controls in case of conflict.

> 承接 [`architecture-review-2026-09.md`](architecture-review-2026-09.md)。
> 本文登记当前结构债务、影响和验收条件，不重复描述已经落地的架构。

## 已完成的文档对齐

- `crates.md` 已按 `pnpm architecture` 补全领域、层级和 crate 清单，并说明图编译链
  由 `graph` 门面编排。
- `data-plane.md` 已改用真实 crate 路径和 `waveform_pyramid_bench` / `ingest_bench` /
  `eval_bench` / `pipeline_soak` 四个现有基准。
- `exits.md` 已按 supervised sidecar 结构修正事件/流端口；Tauri 不再是业务端口实现。
- 共享模型文档已收敛为当前目录、合同和边界说明。
- `crate-layers.md` 已删除，`crates.md` 是唯一分层权威。

## 当前结构债务

| 债务 | 影响 | 验收条件 |
|---|---|---|
| 删除未挂入模块树的 `src-tauri/src/commands/`、`src-tauri/src/event_sink.rs`、`src-tauri/src/gui_host.rs` | 容易被误认为仍存在 Tauri 业务出口；`commands/mod.rs` 还声明不存在的 `ai` 模块 | `git rm` 后 `cargo check -p lissio --all-targets` 通过，全仓无这些路径引用 |
| 补齐 10 个 `Focused crate responsibility` | `pnpm architecture` 不能表达 crate 为什么存在 | `bus`、`buffer-graph`、`filter`、`measurement`、`raw-data`、`spectrum`、`waveform`、`automotive`、`automotive-isotp`、`automotive-diag` 均填写真实职责 |
| 让 `check:architecture` 拒绝占位职责 | 占位元数据可以继续流入 CI | 改回占位串时检查必须失败；同时校验 responsibility 非空且长度足够 |
| 评估拆分 `pipeline` | 该 crate 同时承担字节路由、记录、求值调度、点位投影、录制绑定和指标 | 只有当变更频率、测试隔离或基准收益明确时才拆；禁止为减少依赖数建立 facade |
| 统一 `automotive*` 层级语义 | `automotive-diag` 为 L2，`automotive` / `automotive-isotp` 为 L4 | 同一适配器族的层义一致，或文档明确不同层级的原因 |
| 收敛前端大文件 | transport、store、AI 和图表边界容易重新混合 | 按职责拆分 `tauri.ts` / `httpTransport.ts` / `ThemeEditor.tsx` / `AiChatPanel.tsx` / `dockStore.ts` / `WaveformChart.tsx`，不改变公共行为。`App.tsx` 已完成: 启动副作用下沉 `src/lib/startup/*`（阶段链 + 单测 21 例），懒加载收敛到 `src/components/lazy/`（唯一 `React.lazy` 清单, lint 强制） |
| 补集中性能实验记录（可选） | 有基准源码但缺少跨版本硬件/原始结果记录 | 如需趋势比较，再记录机器、版本、原始输出、统计方法和复现命令 |

## 验证命令

```sh
pnpm architecture
pnpm check:architecture
pnpm check:deps
pnpm check:web-contract
pnpm check:contracts
pnpm check:model-catalog
pnpm typecheck
pnpm lint:ci
pnpm test
pnpm build:web
pnpm test:e2e
cd src-tauri && cargo fmt --check
cd src-tauri && cargo clippy --workspace --all-targets
cd src-tauri && cargo test --workspace
cd src-tauri && cargo deny check
```

局部绿不等于完整构建绿；上述命令与 CI `quality` job 一致。