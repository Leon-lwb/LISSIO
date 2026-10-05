# 文档索引

仓库地址：<https://codeberg.org/Horldsence/Lissio>（`git remote origin` 指向该地址，
`README.md` 的 clone 命令与此一致）。

Lissio 文档的唯一入口。写作规范见
[governance/documentation-standards.md](governance/documentation-standards.md)；新增或删除
文档必须同步本表，`pnpm check:docs` 校验。

## 治理与合规

| 文档 | 内容 |
| --- | --- |
| [governance/open-source-and-ip.md](governance/open-source-and-ip.md) | 许可模型、版权与贡献者授权、专利、分发义务、对外表述红线 |
| [governance/third-party-licenses.md](governance/third-party-licenses.md) | 第三方依赖与资源许可证清单、需人工留意的条目、新增依赖审查流程 |
| [governance/documentation-standards.md](governance/documentation-standards.md) | 文档落位、命名、元数据、行文禁则、单一来源、评审触发 |
| [governance/document-review.md](governance/document-review.md) | 文档审查的触发条件、流程、结论与豁免 |
| ../../GOVERNANCE.md | 项目治理结构：角色、决策、合入权限、发布前置条件、维护者产生与移交 |
| ../../MAINTAINERS.md | 维护者名单、职责分工、联络渠道与响应时效 |
| ../../ROADMAP.md | 已交付能力、合规履约项、未实现项的优先级与验收判据 |

根目录的对外文件构成治理主体：`LICENSE`（GPL-2.0 原文）、`NOTICE`、`CLA.md`、
`CONTRIBUTING.md`、`SECURITY.md`、`CODE_OF_CONDUCT.md`、`GOVERNANCE.md`
（治理结构、决策、合入与发布）、`MAINTAINERS.md`（维护者名单与响应时效）、
`ROADMAP.md`（已交付范围与未实现项的验收判据）。

贡献与评审的入口模板在 `.github/`：`PULL_REQUEST_TEMPLATE.md`、
`ISSUE_TEMPLATE/`（含 `config.yml` 的非公开渠道指引）。

## 评审

| 文档 | 内容 |
| --- | --- |
| [reviews/README.md](reviews/README.md) | 评审记录格式、索引、保留规则 |
| [reviews/checklist.md](reviews/checklist.md) | 评审清单（事实一致性 / 许可证与知识产权 / 结构与格式 / 可维护性 / 门禁与记录） |
| [reviews/records/](reviews/records/) | 历次评审记录 |

## 架构

| 文档 | 内容 |
| --- | --- |
| [architecture/crates.md](architecture/crates.md) | crate 分层、领域 DAG、依赖规则 |
| [architecture/device-tree.md](architecture/device-tree.md) | 设备拓扑与驱动契约 |
| [architecture/exits.md](architecture/exits.md) | 能力出口与覆盖矩阵 |
| [architecture/web-exit.md](architecture/web-exit.md) | Web 协议契约与命令能力矩阵 |
| [architecture/data-plane.md](architecture/data-plane.md) | 数据面设计 |
| [architecture/backend-model-catalog-plan.md](architecture/backend-model-catalog-plan.md) | 后端模型目录方案 |
| [architecture/shared-model-inventory.md](architecture/shared-model-inventory.md) | 共享模型清单 |
| [architecture/shared-model-catalog-progress.md](architecture/shared-model-catalog-progress.md) | 共享模型目录进度 |
| [architecture/industrial-protocol-integration.md](architecture/industrial-protocol-integration.md) | 工业协议接入 |
| [architecture/modbus-capability-cards.md](architecture/modbus-capability-cards.md) | Modbus 能力卡 |
| [architecture/ui-color-tokens.md](architecture/ui-color-tokens.md) | 颜色与透明度令牌 |
| [architecture/ui-motion.md](architecture/ui-motion.md) | 动效体系 |
| [architecture/motion-tokens.md](architecture/motion-tokens.md) | 动效时序令牌 |
| [architecture/motion-spatial-plan.md](architecture/motion-spatial-plan.md) | 动效界面改造清单 |
| [architecture/architecture-review-2026-09.md](architecture/architecture-review-2026-09.md) | 2026-09 架构评审记录 |
| [architecture/cleanup-plan-2026-09.md](architecture/cleanup-plan-2026-09.md) | 2026-09 清理计划 |
| [performance/frontend-render-budget.md](performance/frontend-render-budget.md) | 前端渲染预算门禁：交互场景的每帧成本计量与回归门禁 |

## 开发约定

| 文档 | 内容 |
| --- | --- |
| [AGENTS.md](AGENTS.md) | AI Agent 开发指南与 PR 前硬性要求 |

## 门禁

| 命令 | 覆盖 |
| --- | --- |
| `pnpm check:docs` | 许可证原文与字段一致性、治理文件齐备、文档索引与链接、元数据与评审记录 |
| `pnpm perf:check` | 前端渲染预算：交互场景的每帧成本速率与基线比较，见 [performance/frontend-render-budget.md](performance/frontend-render-budget.md) |
| `pnpm check:all` | 上述全部门禁，汇总输出 |
