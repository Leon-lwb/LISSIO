# 文档规范

<!-- lissio-doc
status: maintained
owner: Lissio maintainers
last-reviewed: 2026-10-07
language: zh-CN
authoritative: false
translation-of: docs/governance/documentation-standards.md
applies-to: Non-authoritative Chinese translation backup
-->

> 中文翻译备份；对应的英文源文件为权威版本。若中英文不一致，以英文为准。
> Chinese translation backup. The English source is authoritative; English controls in case of conflict.

每份文档必须说明描述对象、权威来源和复审时点。

## 语言

所有非历史项目文档以英文为权威。中文备份位于 `docs/community/`，镜像原路径并使用
`.zh-CN.md`，必须声明 `authoritative: false` 和 `translation-of`。历史评审记录保留原文。
运行时帮助的 `en/` 为权威，`zh/` 是产品翻译。

## 落位与命名

根目录放对外入口和法律/治理文件；`docs/architecture/` 放技术事实；`docs/governance/` 放政策；
`docs/performance/` 放性能；`docs/reviews/` 放评审；`docs/community/` 放中文备份。

文件名使用小写短横线。历史记录使用 `YYYY-MM-DD-<范围>.md`。

## 元数据

非历史 Markdown 必须包含 `status`、`owner`、`last-reviewed`、`language`、
`authoritative`、`applies-to`。翻译另含 `translation-of`。评审记录使用
`<!-- lissio-review -->`。

## 结构

唯一 H1，标题层级不超过四级，表格用于对照，代码块标明语言，相对链接必须可达。文档开头交代
权威来源，不写任务号、阶段号、迭代号或“待后续”等过程痕迹。

同一机器可判定事实不得手工重复。许可、依赖、发布和结构变化必须走评审记录。
