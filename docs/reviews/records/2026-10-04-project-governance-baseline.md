# 项目治理基线评审

<!-- lissio-review
date: 2026-10-04
scope: 新增项目治理文件（GOVERNANCE.md、MAINTAINERS.md、ROADMAP.md）、PR 模板与 issue 入口配置
reviewer: 维护者（Horldsence）
verdict: 有条件通过
-->

## 范围

新建根目录治理文件 `GOVERNANCE.md`、`MAINTAINERS.md`、`ROADMAP.md`，新增
`.github/PULL_REQUEST_TEMPLATE.md` 与 `.github/ISSUE_TEMPLATE/config.yml`；更新
`docs/README.md` 的治理主体清单、`docs/reviews/README.md` 的索引、
`docs/governance/documentation-standards.md` 的文档落位表、
`docs/governance/open-source-and-ip.md` 的治理文件表与配套文档清单、`CONTRIBUTING.md`
的入口与响应时效、`CODE_OF_CONDUCT.md` 的举报渠道说明；`scripts/check-docs.mjs` 的
`ROOT_FILES` 纳入三份新文件。

回答的问题是：治理结构、长期规划与维护者事实在仓库内是否有唯一且可校验的表达，以及它们
是否与许可、版权与分发合规的现行口径一致。

机器项由 `pnpm check:docs` 判定并通过。人工项结论如下。

## 结论

| 清单项 | 结论 |
| --- | --- |
| 1.1 LICENSE 原文 | 未改动，sha256 由门禁校验通过 |
| 1.2 许可证字段 | `package.json` 与全部 workspace 成员仍为 `GPL-2.0-only`，门禁通过 |
| 1.3 引用的路径、命令、crate 名 | 新增文档中的相对链接、命令与文件路径逐条核对可达；`pnpm check:docs` 的链接检查覆盖 `ROOT_FILES`，三份新文件纳入检查范围 |
| 1.4 引用的数量与清单 | 新增文档**不引用任何易漂移的数量**（crate 数、测试数、基准数字），已交付能力改以 `docs/architecture/` 与代码为权威，避免 1.4 类失配 |
| 1.5 不复述代码事实 | `ROADMAP.md` 只写能力范围与验收判据，不复述实现细节；具体事实指向架构文档 |
| 1.6 外链与仓库地址一致 | 见遗留项 4：托管地口径尚未定论，本次未新增不可达外链，`config.yml` 的主机名取自 `git remote` |
| 1.7 索引无游离文档 | 三份新文件登记进 `docs/README.md`，本记录登记进 `docs/reviews/README.md` |
| 2.1-2.2 许可证表述 | 未改动 `NOTICE` 的双许可与商业轨状态表述；新文件一律引用 `NOTICE`，不自行复述许可结论 |
| 2.6 对外表述红线 | 新文件未出现「已履行 GPL 源码分发义务」「可购买商业许可」等表述；`ROADMAP.md` 把分发合规列为未完成的履约项，并在 `GOVERNANCE.md`「发布」中设为硬前置 |
| 2.7 CLA 与贡献者关系 | 未改动。`MAINTAINERS.md` 按 `open-source-and-ip.md` 的既有结论记录提交身份，未新增或推断贡献者范围 |
| 3.1-3.6 结构与格式 | 新文件落位符合 `documentation-standards.md` 的落位表（该表已同步纳入三份根目录文件）；根目录文件按惯例不带元数据块，与既有 `CONTRIBUTING.md` / `SECURITY.md` 一致；全文无过程痕迹标记 |
| 4.1-4.5 可维护性 | 三份新文件均在开头声明权威来源；`GOVERNANCE.md`「发布」第 3 条与 `ROADMAP.md`「合规履约项」指向同一处合规表，不重复维护事实；`MAINTAINERS.md` 的响应时效为本轮新增承诺，无既有来源可指 |
| 5.1-5.5 门禁与记录 | `pnpm check:docs` 通过；`AGENTS.md`、`docs/AGENTS.md` 与双语 README 的命令清单已含 `check:docs`，本轮未改动 |

`pnpm typecheck`、`pnpm lint:ci` 亦通过（遗留项 10 已闭合）。涉及前后端契约与 Rust crate 的
改动不在本轮范围，故未运行 `cargo` 系列与 e2e；本轮为纯文档与模板新增，不触及运行时行为。

### 对前一份记录的更正

`2026-10-04-open-source-ip-baseline.md` 遗留项 6 记载 `SECURITY.md` 与 `CODE_OF_CONDUCT.md`
使用的邮箱取自 git 提交身份 `m18511047688@163.com`。核对文件正文，二者实际使用
`pengheng.wang@foxmail.com`。按 `document-review.md`「记录失效时怎么办」，不改写旧记录，
在此更正；邮箱可用性的确认转为遗留项 3。

## 遗留项

| # | 事项 | 依据 | 负责人 | 到期 |
| --- | --- | --- | --- | --- |
| 1 | 分发二进制未提供 GPL-2.0 §2/§3 要求的完整对应源码或书面要约；`release.yml` 只收集构建产物 | `open-source-and-ip.md` 分发合规表 | 维护者 | 发布任何二进制之前 |
| 2 | 字体许可原文未随产物分发；所用字体许可是否允许当前裁剪子集化尚未给出结论 | OFL 1.1 §1；`MiSans-LICENSE.txt` | 维护者 | 发布任何二进制之前 |
| 3 | `SECURITY.md` 与行为准则举报渠道使用个人信箱 `pengheng.wang@foxmail.com`，可用性未确认；行为准则举报与漏洞举报目前共用同一信箱 | `MAINTAINERS.md`「联络渠道」 | 维护者 | 下次发布前 |
| 4 | 托管地口径未定论：`git remote` 指向 Codeberg，双语 README 与 About 弹窗已改指 Codeberg，而参赛材料与既有的社会认同在 GitHub；`release.yml` 的 `latest.json` 与自动更新地址仍按 `github.com/${{ github.repository }}` 生成 | `git remote -v`；`2026-10-04-open-source-ip-baseline.md` 遗留项 9 | 维护者 | 下次发布前 |
| 5 | `issue-1` 与 `beta` 两个误建 tag 未清理，且存在无 `v` 前缀的重复 tag（`0.6.1` / `v0.6.1`、`0.7.2-beta` / `v0.7.2`），与 `GOVERNANCE.md` 的 `vX.Y.Z` 约定不一致 | `git tag` | 维护者 | 下次发布前 |
| 6 | 首个 GitHub Release 尚未创建，README「Versioning」段指向空的 Release 页 | `README.md` | 维护者 | 遗留项 1 闭合后 |
| 7 | 仓库描述仍为 `a next stage of serial debug.`，无 topics，与项目实际定位不符 | GitHub 仓库元数据 | 维护者 | 下次发布前 |
| 8 | 外部 PR 记录为零，合入与发布权限集中在单一维护者；补足第二位提交者的条件已公开登记 | `GOVERNANCE.md`「现状披露」 | 维护者 | 无固定到期，按季度复核 |
| 9 | 版权归属是否需由机构承接尚未结论；若变更须同步 `NOTICE` 与 `CLA.md` | `MAINTAINERS.md`；`ROADMAP.md`「治理补足」 | 维护者 | 与合作方洽谈后 |
| 10 | `docs/architecture/` 下既有文档仍无元数据块，门禁暂不强制该目录 | `documentation-standards.md`「既有文档的补齐」 | 维护者 | 渐进，无固定到期 |