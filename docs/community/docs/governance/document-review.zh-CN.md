# 文档评审流程

<!-- lissio-doc
status: maintained
owner: Lissio maintainers
last-reviewed: 2026-10-07
language: zh-CN
authoritative: false
translation-of: docs/governance/document-review.md
applies-to: Non-authoritative Chinese translation backup
-->

> 中文翻译备份；对应的英文源文件为权威版本。若中英文不一致，以英文为准。
> Chinese translation backup. The English source is authoritative; English controls in case of conflict.

文档评审包括可复现的 `pnpm check:docs` 与人工清单判断，结论保存在
`docs/reviews/records/`。

## 触发

新增/删除/移动文档，修改法律或治理文本，许可/版权/专利/商标变化，依赖变化，打包或发布变化，
以及翻译更新都需要评审记录。

## 流程

作者更新英文权威文档和中文备份；运行 `pnpm check:docs`；评审人执行
`../reviews/checklist.md`；无第二位维护者时必须留下显式自审记录；新增
`YYYY-MM-DD-<范围>.md` 并登记索引；所有门禁失败和发布阻断解决后才合入。

## 结论

新记录使用 `passed`、`passed-with-conditions`、`failed`。历史记录保留原标签。
`passed-with-conditions` 必须有负责人和日期。门禁例外必须记录规则、理由、风险和复查日期。
