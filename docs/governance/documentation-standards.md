# 文档规范

<!-- lissio-doc
status: maintained
owner: 维护者（Horldsence）
last-reviewed: 2026-10-04
applies-to: docs/ 下全部文档、根目录 README 与治理文件
-->

本文规定 Lissio 文档的组织方式与写法。目的是让任何一份文档都能回答三个问题：
**它描述什么、它的权威来源在哪、它什么时候需要重新评审**。

## 语言

- 文档正文用**中文**，标识符、许可证标识、命令、路径、代码保持英文原样。
- 面向国际贡献者的入口文件（`README.md`）保持中英双份 README，其余文档仅中文。
- 不为同一主题维护两份非双语文档；需要英文版时在文档开头写明英文入口位置。

## 文档落位

| 目录 | 放什么 | 不放什么 |
| --- | --- | --- |
| `docs/architecture/` | 系统结构、数据面、crate 分层、UI 令牌等**技术事实** | 流程规范、治理约定 |
| `docs/governance/` | 许可证、知识产权、文档规范、评审机制等**约定** | 技术事实的重复描述 |
| `docs/reviews/` | 评审清单与评审记录（历史事实，不改写） | 现行规范（须改规范请改 `docs/governance/`） |
| 根目录 | 面向外部的入口文件：`README*.md`、`LICENSE`、`NOTICE`、`CONTRIBUTING.md`、`CLA.md`、`CODE_OF_CONDUCT.md`、`SECURITY.md`、`GOVERNANCE.md`、`MAINTAINERS.md`、`ROADMAP.md` | 内部实现说明 |

新增文档必须登记进 [../README.md](../README.md) 的索引，`pnpm check:docs` 校验。

## 文件命名

- 全小写，短横线分隔：`documentation-standards.md`、`document-review.md`。
- 不使用日期前缀、不使用"最终版""新版"等词；状态由元数据表达。
- 评审记录例外，固定为 `YYYY-MM-DD-<范围>.md`，见 [../reviews/README.md](../reviews/README.md)。

## 结构与元数据

`docs/governance/` 下的文档与 `docs/reviews/` 下的索引、清单，必须在 H1 之后带元数据块：

```markdown
# 标题

<!-- lissio-doc
status: maintained          # maintained | draft | deprecated
owner: 维护者（Horldsence）
last-reviewed: 2026-10-04    # 最近一次人工评审日期
applies-to: 适用范围的一句话描述
-->
```

其余要求：

- 一级标题唯一，标题即结论，不写"关于……的一些说明"。
- 章节用 `##` / `###`，不超过四级。
- 表格用于对照与枚举；单元格内不写整段话。
- 代码块必须标语言（bash、json、mermaid、text 等）。
- 文档开头交代**权威来源**（哪份代码/配置是唯一真相），不一致时以代码为准并提 issue。
- 链接优先用相对路径，门禁会校验可达；外链不加跟踪参数。

## 行文禁则

- 不写过程痕迹：禁止 `Stage N`、`Task #N`、`Phase N`、迭代编号、"待后续阶段"、
  "下一步再做"。文档描述当前状态，历史归 [../reviews/records/](../reviews/records/)。
- 不写未经验证的断言，尤其涉及许可证、数量、URL、命令输出。写不确定的事实用
  "待确认"并同步登记遗留项。
- 不承诺未实现的对外能力（与
  [open-source-and-ip.md](open-source-and-ip.md)「对外表述红线」一致）。
- 标识符用英文、注释与文档用中文，与 `AGENTS.md` 一致。

## 单一来源

| 内容 | 唯一来源 | 文档角色 |
| --- | --- | --- |
| 许可证原文 | `LICENSE` | 索引，不复述条文 |
| 许可证字段 | `package.json` 与各 crate `Cargo.toml` | 索引，由 `pnpm check:docs` 校验 |
| 第三方许可证放行 | `src-tauri/deny.toml` | 解释与快照 |
| 字体署名 | `src/lib/fontAttributions.ts` | 索引 |
| crate 分层与依赖方向 | `crates.md` + `[package.metadata.lissio]` | 解释 |
| UI 令牌 | `src/styles/theme.css` | 索引，由 `pnpm check:tokens` 校验 |

同一事实不得在两处手工维护。能被脚本判定的规则都要写成门禁，而不是只写进文档。

## 评审触发

以下改动必须同步更新文档并走 [document-review.md](document-review.md) 的评审流程：

- 许可证、版权、专利、对外表述口径变化；
- 新增/移除依赖，或 `third-party-licenses.md` 需要登记新条目；
- 新增文档，或文档元数据 `status` 变为 `deprecated`；
- 目录结构、构建产物形态、发布流水线变化。

## 既有文档的补齐

`docs/architecture/` 下的既有文档尚无元数据块，`pnpm check:docs` 暂不强制该目录。
补齐按文档被修改的顺序进行，不做一次性批量改写。待全部补齐后，把门禁强制范围
扩大到 `docs/`，该变更本身需一次评审记录。
