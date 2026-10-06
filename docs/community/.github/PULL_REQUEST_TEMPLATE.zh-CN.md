<!-- lissio-doc
status: maintained
owner: Lissio maintainers
last-reviewed: 2026-10-07
language: zh-CN
authoritative: false
translation-of: .github/PULL_REQUEST_TEMPLATE.md
applies-to: Non-authoritative Chinese translation backup
-->

> 中文翻译备份；对应的英文源文件为权威版本。若中英文不一致，以英文为准。
> Chinese translation backup. The English source is authoritative; English controls in case of conflict.

<!--
本模板对应 CONTRIBUTING.md 的合入前置条件。删掉用不上的段落，不要删掉「门禁自检」——
未实际运行的检查不得声明通过。
-->

## 变更动机

<!-- 关联 issue，或说明为什么需要这次改动。先说清问题，再说方案。 -->

Closes #

## 变更范围

| 区域 | 是否涉及 |
| --- | --- |
| Rust crate（`src-tauri/crates/<域>/`） | |
| 前端（`src/`） | |
| IPC / 事件契约 / wire 类型 | |
| 协议或传输适配器 | |
| 文档 | |
| 依赖或第三方资源 | |

<!-- 改 Rust 前先读 docs/architecture/crates.md，并运行 pnpm architecture 确认定义者与
     反向依赖。若新增 crate，说明它承担的是独立能力、依赖倒置端口、重适配器还是跨 crate
     测试支持，并附 package.metadata.lissio 的域与依赖层。 -->

## 门禁自检

勾选已在本机实际跑通的项。未运行的项不要勾，也不要在描述里声明通过。

- [ ] `pnpm architecture` `pnpm check:architecture` `pnpm check:deps`
- [ ] `pnpm check:web-contract` `pnpm check:contracts` `pnpm check:model-catalog` `pnpm check:tokens`
- [ ] `pnpm check:docs`
- [ ] `pnpm typecheck` `pnpm lint:ci` `pnpm test` `pnpm build:web` `pnpm test:e2e`
- [ ] `cargo fmt --check` `cargo clippy --workspace --all-targets` `cargo test --workspace` `cargo deny check`
- [ ] 涉及 UI 的改动已用 `pnpm dev:desktop` 实际打开验证

需要 `cargo` 检查但本机未装 Rust 工具链的，在这里写明「未运行」及原因：

## 兼容性

- [ ] 不涉及前后端契约变更
- [ ] 涉及契约：已同步 Rust 侧的 serde owner 与生成的 TS，并逐一核对字段名
- [ ] 涉及持久化文件、IPC 载荷或配置格式：按当前格式读写，未做旧格式兼容或迁移
- [ ] 涉及公开接口或配置项变更：已在 `CHANGELOG.md` 记录，并说明迁移方式

## 视觉与交互

- [ ] 无界面改动
- [ ] 有界面改动：附前后截图，说明深浅色主题与文字缩放下的表现
- [ ] 动效遵循 `docs/architecture/ui-motion.md`，尊重 `prefers-reduced-motion`
- [ ] 新增用户可见文案：`src/i18n/resources/{zh,en}/` 已同步，未硬编码

## 许可证与第三方

- [ ] 未引入新的第三方代码、字体、图标、数据集或规范文本
- [ ] 有引入：已确认权利来源与许可证，并登记进 `docs/governance/third-party-licenses.md`
- [ ] 新增依赖已登记到根 `[workspace.dependencies]`，且许可证落在 `src-tauri/deny.toml` 的白名单内
- [ ] 未移除或弱化许可证、第三方归属与署名声明

## 风险与回滚

<!-- 这次改动可能影响哪些既有行为？出问题如何回滚？需要哪些配置迁移或人工步骤？ -->

## 许可确认

提交本 PR 即表示同意 [CLA.md](../CLA.md)，并确认有权提交上述内容；若属受雇作品，已取得
雇主许可。