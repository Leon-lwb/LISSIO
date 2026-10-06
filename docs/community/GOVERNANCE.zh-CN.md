# Lissio 项目治理

<!-- lissio-doc
status: maintained
owner: Lissio maintainers
last-reviewed: 2026-10-07
language: zh-CN
authoritative: false
translation-of: GOVERNANCE.md
applies-to: Non-authoritative Chinese translation backup
-->

> 中文翻译备份；对应的英文源文件为权威版本。若中英文不一致，以英文为准。
> Chinese translation backup. The English source is authoritative; English controls in case of conflict.

## 权威来源

现行项目政策位于根目录治理文件与 `docs/governance/`。代码、manifest、构建配置和发布
产物是实现事实的权威来源，文档不一致时应修正文档。

## 治理文件

`LICENSE` 为当前源码树的 Apache-2.0 原文；`NOTICE` 记录版权、历史许可范围和归属；
`CLA.md` 规定贡献与专利条款；`CONTRIBUTING.md`、`SECURITY.md`、
`CODE_OF_CONDUCT.md`、`MAINTAINERS.md`、`SUPPORT.md`、`ROADMAP.md` 与
`docs/governance/` 分别规定贡献、安全、行为、维护、支持、路线和专项政策。

## 角色

版权持有人管理项目商标。维护者负责合入、发布、政策和举报处理。贡献者按照
`CLA.md` 提交材料。Git 历史是贡献身份的权威来源。

## 决策

日常决策由维护者在 PR 或评审记录中作出。许可、版权、CLA、商标政策、发布形态和安全
渠道变更要求维护者共识与明确评审记录。无法解决的法律或知识产权分歧不予合入，并通过
`SECURITY.md` 处理。

## 合入权限

维护者合入已复核的改动。维护者不得合入自己未经独立复核的治理改动；单人项目也必须留下
显式清单评审记录。外部 PR 必须通过 `CONTRIBUTING.md` 的完整门禁。

## 发布

版本采用语义化版本，tag 使用 `vX.Y.Z`，预发布使用 `-alpha.N`、`-beta.N` 或 `-rc.N`。
流程见 `RELEASING.md`。

发布前必须通过完整检查、文档门禁，确认 `LICENSE`、`NOTICE` 与第三方文本进入产物，
核对发布说明与安全/许可阻断项。Apache-2.0 不要求当前版本提供 GPL 式对应源码，但源码
与构建可复现性仍是项目发布政策。早期 GPL 发布物继续适用原许可。

## 维护者接替

新维护者需要持续贡献记录、熟悉架构规则、遵守行为准则并接受响应目标。任命与移交记录在
`docs/reviews/records/`。

项目连续六个月无发布时，应公开维护状态：维护、仅修缺陷或归档。归档时保留历史、文档、
许可文本与源码入口。

## 例外

门禁例外必须记录规则、理由、风险、影响范围和复查日期。未执行验证不构成例外。
