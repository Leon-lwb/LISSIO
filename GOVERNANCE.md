# 项目治理

本文规定 Lissio 的治理结构：谁有权决定什么、如何合入、如何发布、如何成为维护者。

**权威来源**：角色与联系方式的事实以 [MAINTAINERS.md](MAINTAINERS.md) 与 git 提交身份
为准；许可、版权与知识产权口径以 [NOTICE](NOTICE)、[CLA.md](CLA.md) 和
[docs/governance/open-source-and-ip.md](docs/governance/open-source-and-ip.md) 为准；发布
形态的合规状态以该文档的「各分发形态的合规义务」表为准。三者与代码冲突时以代码为准，
并按 [docs/governance/document-review.md](docs/governance/document-review.md) 修正文档。

## 治理文件

| 文件 | 作用 | 可否修改 |
| --- | --- | --- |
| `LICENSE` | GPL-2.0 官方原文，供开源轨使用 | **不可**，逐字节固定，由 `pnpm check:docs` 校验 sha256 |
| `NOTICE` | 版权声明、双许可状态、第三方归属、源码获取方式 | 可增改，须过文档审查 |
| `CLA.md` | 贡献者许可协议：再许可权与专利许可 | 可增改，属法律文件，改动须经外部法律审阅 |
| `CONTRIBUTING.md` | 贡献流程、许可条款、门禁要求 | 可增改 |
| `CODE_OF_CONDUCT.md` | 社区行为准则与执行程序 | 可增改 |
| `SECURITY.md` | 漏洞与知识产权举报渠道、响应时限 | 可增改 |
| `GOVERNANCE.md` | 本文：治理结构、决策、合入、发布、维护者产生与移交 | 可增改，须过文档审查 |
| `MAINTAINERS.md` | 维护者名单、职责、响应时效 | 可增改，须过文档审查 |
| `ROADMAP.md` | 已交付范围、未实现项的优先级与验收判据 | 可增改，须过文档审查 |
| `src-tauri/deny.toml` | 第三方许可证放行白名单 | 放行新标识须同步审查记录 |

## 角色

| 角色 | 权限 | 现状 |
| --- | --- | --- |
| 版权持有人 | 持有著作权与商标权；按 `CLA.md` 行使再许可权与专利许可 | Horldsence |
| 维护者 | 合入 PR、发布版本、修改治理文件、响应举报 | 见 [MAINTAINERS.md](MAINTAINERS.md) |
| 提交者（committer） | 在维护者授权范围内合入他人 PR | **暂缺**。判据见「成为提交者或维护者」 |
| 贡献者 | 提交 issue 与 PR，无需额外授权 | 名单即 git 历史中的提交身份 |
| 报告人 | 提交漏洞、知识产权或行为准则举报 | 不受报复，见 `CODE_OF_CONDUCT.md` |

## 决策方式

**常规决策**由维护者作出，过程与理由留在对应的 PR 或
[文档评审记录](docs/reviews/records/)中，不另设会议纪要。

以下事项**须经维护者一致同意**，且不得由单方绕过：

- 变更许可证、版权主体或 `CLA.md` 条款（含贡献者再许可权范围）；
- 放宽 `src-tauri/deny.toml` 的 `[licenses]` 白名单；
- 变更对外表述口径，或触碰
  [open-source-and-ip.md](docs/governance/open-source-and-ip.md) 的「对外表述红线」；
- 改变发布形态、分发流水线或容器镜像的合规状态；
- 删除或重命名治理文件。

**意见不一致时**：维护者应在同一 PR 内说明分歧与所采信的理由。涉及许可、著作权或专利
的分歧无法达成一致时，以不合并处理，并按 `SECURITY.md` 的知识产权渠道征询外部意见。

## 合入权限

合入权限集中于维护者。维护者不得合入自己未按
[docs/reviews/checklist.md](docs/reviews/checklist.md) 复核过的治理文件改动——单人项目下，
该复核以一份显式的评审记录留痕，见 `document-review.md`「流程」第 3 步。

外部 PR 的合入前置条件：

1. 已签署 [CLA.md](CLA.md)（提交 PR 即视为签署）；
2. 关联的 issue 或变更动机已说明；
3. [CONTRIBUTING.md](CONTRIBUTING.md) 列出的全部门禁在本地实际跑通；
4. 涉及前端界面或协议行为时，作者已说明验证方式。

## 发布

版本号采用语义化版本，发布 tag 统一为 `vX.Y.Z`（预发布追加 `-alpha.N` / `-beta.N` /
`-rc.N`）。历史 tag 中存在与该约定不一致的条目，清理项登记在
[ROADMAP.md](ROADMAP.md) 的「发布卫生」一节。

发布前必须全部满足：

1. `AGENTS.md`「PR / 提交前的硬性要求」所列检查全部通过，且未以「未运行」充数；
2. `pnpm check:docs` 通过，含 `docs/` 索引与治理文件齐备性；
3. [open-source-and-ip.md](docs/governance/open-source-and-ip.md)「各分发形态的合规义务」
   表中拟发布形态的状态为**已满足**。

第 3 条是硬前置。GPL-2.0-only §2 / §3 要求随二进制提供完整对应源码（含构建脚本与依赖
锁文件）或书面要约；该义务未履行前**不得对外发布二进制产物**，也不得在任何对外材料中
声称已履行。当前状态与缺口见该文档与最近的评审记录。

版本说明遵循 [CHANGELOG.md](CHANGELOG.md) 的既有条目格式；破坏性变更需在说明中给出
迁移方式。

## 成为提交者或维护者

维护者按下列条件提名，经公开说明后生效：

- 有连续、可核验的贡献记录，且至少包含一次他人 PR 的实质评审；
- 熟悉 `docs/architecture/crates.md` 的分层规则，能独立判断跨层依赖是否合理；
- 承诺遵守 [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md)，并在冲突时按其执行程序处理；
- 承诺承担响应时效（见 [MAINTAINERS.md](MAINTAINERS.md)）。

提名与生效记入 `docs/reviews/records/`。首次提名第二位维护者时，须同时给出合入权限的
分担方式，避免权限长期集中在单一身份。

## 项目移交、归档与弃用

- **移交**：项目转由新维护者时，须公开说明时点、原因与联系方式变更，并在
  `docs/reviews/records/` 留记录；`CLA.md` 授予版权持有人的权利不因个人变更而自动转移，
  须由版权持有人与贡献者另行约定。
- **降活跃**：连续 6 个月无发布且无 issue 响应时，应公开说明项目状态（维护 / 仅修缺陷 /
  归档），不静默停止。
- **归档**：归档时保留完整 git 历史与文档索引，将 `ROADMAP.md` 状态改为 `deprecated`，
  并在 README 显著位置标注。

## 例外与豁免

任何门禁的豁免必须写进评审记录，包含豁免项、理由、影响面与到期复查日期，不得以跳过
检查的方式绕过。豁免到期未处理时，在下一次评审中升级为遗留项。

## 现状披露

当前项目由单一维护者承担合入与发布，外部 PR 记录为零。维护者公开这一事实，并把「补足
第二位提交者」列入 [ROADMAP.md](ROADMAP.md)，以免读者按不存在的团队规模预期响应速度。