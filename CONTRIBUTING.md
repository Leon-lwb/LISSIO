# 贡献指南

感谢参与。提交 pull request 即表示你同意本文件与 [CLA.md](CLA.md)。

## 环境与流程

```bash
git remote add upstream <fork-url>
git switch -c <type>/<scope>       # 提交信息沿用 type(scope): summary
```

改动 Rust 前先读 `docs/architecture/crates.md` 并运行 `pnpm architecture`；改动前后端
契约时同步更新 Rust owner 与生成的 TS。仓库约定见 `AGENTS.md`。

PR 模板见 `.github/PULL_REQUEST_TEMPLATE.md`，其中的门禁自检与本文件一致。合入权限、
发布前置条件与维护者产生方式见 [GOVERNANCE.md](GOVERNANCE.md)。

## 响应时效

维护者的响应目标见 [MAINTAINERS.md](MAINTAINERS.md)「响应时效」：缺陷报告 7 日、功能提案
14 日、外部 PR 14 日首次响应。首次响应只确认收到并说明判断所需信息，不等于承诺排期。
超出未响应时可在 issue 中直接 @ 维护者。

未实现项的优先级与验收判据见 [ROADMAP.md](ROADMAP.md)。提案前先读它，避免重复提出已在
计划内的工作。

## 合入门禁

提 PR 前必须本地跑通，`pnpm check:all` 已覆盖全部项目：

| 范围 | 命令 |
| --- | --- |
| 架构与契约 | `pnpm architecture` `pnpm check:architecture` `pnpm check:deps` `pnpm check:web-contract` `pnpm check:contracts` `pnpm check:model-catalog` `pnpm check:tokens` |
| 文档与许可证 | `pnpm check:docs` |
| 前端 | `pnpm typecheck` `pnpm lint:ci` `pnpm test` `pnpm build:web` `pnpm test:e2e` |
| Rust | `cargo fmt --check` `cargo clippy --workspace --all-targets` `cargo test --workspace` `cargo deny check` |

未实际运行的检查不得声明通过。涉及 UI 的改动需 `pnpm dev:desktop` 手动验证。

## 许可条款

- 你的贡献以 **GPL-2.0-only** 发布，并按 [CLA.md](CLA.md) 授予项目方再许可权与专利许可权。
- 不接受 CLA 的贡献不予合入，包括自动生成的代码改动。
- 你必须有权提交所贡献的内容；受雇于他人时需取得雇主的许可。
- 引入他人作品（代码、模型权重、字体、图标、数据集、规范文本）前先确认许可证，
  并登记进 `docs/governance/third-party-licenses.md`。未确认权利来源的复制粘贴不予合入。
- 新增依赖须先登记到 `src-tauri/Cargo.toml` 的 `[workspace.dependencies]`，许可证
  须落在 `src-tauri/deny.toml` 的 `[licenses]` 白名单内；白名单变更需人工评审。
- 不得移除或弱化许可证、第三方归属与署名声明。

## 文档与评审

- 新增文档须登记进 `docs/README.md`，写法见
  [docs/governance/documentation-standards.md](docs/governance/documentation-standards.md)。
- 改动治理文档、许可证口径、第三方清单、发布形态时，按
  [docs/governance/document-review.md](docs/governance/document-review.md) 走评审并
  在 `docs/reviews/records/` 留记录。

## 其他

- 行为准则见 [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md)。
- 漏洞与知识产权举报见 [SECURITY.md](SECURITY.md)。
- 许可证与知识产权口径见 [docs/governance/open-source-and-ip.md](docs/governance/open-source-and-ip.md)。
- 不接受的行为请走举报渠道；对批评的正当回应是改进，不是报复。
