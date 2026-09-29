# AGENTS.md — AI 开发指南

本文件指导 AI Agent 在本仓库中开发。核心原则:**vibe 出来的每一行代码,你都是第一责任人**。

## 项目概览

Lissio:基于 Tauri 2 的跨平台串口数据上位机(波形 / 节点图 / 协议解析 / CAN 诊断)。

- 前端:React 19 + TypeScript + Vite + Tailwind 4 + Zustand + React Flow,包管理用 **pnpm**
- 后端:Rust workspace(`src-tauri/crates/<domain>/<crate>`),Tauri 2 + Tokio
- Desktop 与 Web 共用 `lissio-server` 的 HTTP-RPC + WebSocket transport;Tauri 只承载平台壳命令。事件契约在 `events` crate,wire 类型由 Rust 生成并严格对齐

修改 Rust 前必须先读 `docs/architecture/crates.md`,并运行 `pnpm architecture` 查看定义者和反向依赖。

## 常用命令

```bash
# 前端
pnpm dev                # Vite 开发服务器
pnpm typecheck          # tsc --noEmit,改 TS 后必跑
pnpm test               # vitest run
pnpm build              # tsc && vite build

# 后端 (在 src-tauri/ 下)
cargo check --workspace
cargo test --workspace
cargo clippy --workspace --all-targets   # 仓库对 clippy 从严,警告需清零
cargo fmt --check

# 契约与完整质量面
pnpm check:web-contract
pnpm check:contracts
pnpm check:model-catalog
pnpm build:web
pnpm test:e2e

# 整应用
pnpm dev:desktop
```

```bash
# 分层与依赖审查门禁 (CI 硬门槛)
pnpm architecture       # 当前 crate 的领域、层级、职责、正反向依赖
pnpm check:architecture # 二级领域目录、metadata、领域 DAG、层级和适配器隔离
pnpm check:deps         # 第三方依赖版本统一 (workspace.dependencies 唯一登记)
cd src-tauri && cargo deny check   # 安全公告 / 许可证 / 重复版本 / 依赖来源
```

## 目录速查

- `src/components/` — UI(controls / displays / layout / nodes / panels / onboarding)
- `src/lib/` — 前端逻辑(hooks / tauri IPC 封装 / utils)
- `src/types/` — 与后端对齐的 TS 类型(改 Rust 侧 serde 结构时必须同步)
- `src/i18n/locales/{zh,en}.yml` — 所有用户可见文案走 i18n,中英双语同步添加
- `src-tauri/src/lib.rs` — Tauri 平台壳组合根;业务能力经 sidecar HTTP/WS 进入 `control-api` / `rpc-api`
- `src-tauri/crates/<domain>/<crate>` — 二级目录按功能域直观分区;依赖层由 manifest metadata 表达
- `src-tauri/crates/protocol/schema/src/{frame_field,frame_checksum,command_frame}.rs` — 命令帧字节打包权威

## 编码约定

- 注释 / 文档用**中文**,标识符用英文;doc comment 写"是什么、为什么",不写"从哪来"
- **禁止留下编码过程痕迹**:不在代码 / 注释 / 文档中出现 `Stage X`、`Task #N`、`Phase N`、迭代编号、"待后续阶段"之类的过程标记;注释描述代码现状,不叙述重构历史
- 最小改动:修 bug 不顺手重构,加功能不引入 speculative 抽象,风格向周围代码看齐
- 不擅自新增依赖;确需新增时先说明理由
- 大测试放 `tests/` 集成测试,不写巨型 inline `#[cfg(test)]` 模块(dev-dep 循环会踩 E0308,见 `data_plane/tests/byte_router_tests.rs` 头部注释)

## PR / 提交前的硬性要求(不可省略)

vibe coding 提速的是写代码,不是验证。提 PR 前必须亲自跑通以下检查,**没跑过就不许说"完成"**:

1. `pnpm architecture`、`pnpm check:architecture`、`pnpm check:deps` 通过
2. `pnpm check:web-contract`、`pnpm check:contracts`、`pnpm check:model-catalog` 通过
3. `pnpm typecheck`、`pnpm lint:ci`、`pnpm test`、`pnpm build:web`、`pnpm test:e2e` 通过
4. `cd src-tauri && cargo fmt --check`、`cargo clippy --workspace --all-targets`、`cargo test --workspace`、`cargo deny check` 通过
5. 涉及前后端契约(事件名、payload、命令参数、serde 结构)的改动,同步更新 Rust owner 与生成 TS,并核对字段名逐一对应
6. 涉及 UI 的改动,`pnpm dev:desktop` 实际点开验证过,而不是"理论上没问题"

## 责任条款

- 对自己的改动负责到底:引入的回归自己修,不留给下一个人 / 下一轮会话
- 无法验证就明说("此项未实际运行验证"),禁止把未验证的改动描述为已完成
- 发现前提错误(需求理解错、假设不成立)立即停下澄清,不硬凑实现
- 提交信息遵循仓库现有风格:`type(scope): summary`(如 `fix(clippy): ...`、`refactor(crates): ...`)
