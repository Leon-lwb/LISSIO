# 文档评审记录

<!-- lissio-doc
status: maintained
owner: 维护者（Horldsence）
last-reviewed: 2026-10-04
applies-to: docs/reviews/records/ 下的全部记录
-->

本目录保存每次文档评审的历史事实：评了什么、结论是什么、还欠什么。记录一经写入即
不修改；需要更正时新增一条记录并指向旧记录。现行规范写在 `docs/governance/`，见
[../governance/document-review.md](../governance/document-review.md)。

## 记录格式

- 文件名：`YYYY-MM-DD-<范围>.md`，范围用小写短横线（如 `open-source-ip-baseline`）。
- 文件开头是元数据块，`pnpm check:docs` 会校验：

```markdown
# <范围> 文档评审

<!-- lissio-review
date: 2026-10-04
scope: 评审范围一句话
reviewer: 评审人
verdict: 通过 | 有条件通过 | 不通过
-->
```

- 正文三段固定：**范围**（评审了哪些文件 / 回答了哪些问题）、**结论**
  （逐条说明清单结果）、**遗留项**（待办、负责人、到期日）。

## 索引

| 日期 | 范围 | 结论 | 记录 |
| --- | --- | --- | --- |
| 2026-10-04 | 开源与知识产权基线 | 有条件通过 | [records/2026-10-04-open-source-ip-baseline.md](records/2026-10-04-open-source-ip-baseline.md) |
| 2026-10-04 | 事实不一致修正（关闭基线遗留项 3、4、6） | 通过 | [records/2026-10-04-fact-consistency-fixes.md](records/2026-10-04-fact-consistency-fixes.md) |
| 2026-10-04 | 项目治理基线（GOVERNANCE / MAINTAINERS / ROADMAP） | 有条件通过 | [records/2026-10-04-project-governance-baseline.md](records/2026-10-04-project-governance-baseline.md) |

## 保留与时效

- 记录永久保留，不做归档压缩。
- 旧记录中的结论若被后续改动推翻，由后续记录说明。
- 治理文档的时效由元数据 `last-reviewed` 控制，
  `pnpm check:docs -- --stale-days <天数>` 超期即报错；与本索引无关。
