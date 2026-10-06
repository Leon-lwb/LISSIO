# 文档评审清单

<!-- lissio-doc
status: maintained
owner: Lissio maintainers
last-reviewed: 2026-10-07
language: zh-CN
authoritative: false
translation-of: docs/reviews/checklist.md
applies-to: Non-authoritative Chinese translation backup
-->

> 中文翻译备份；对应的英文源文件为权威版本。若中英文不一致，以英文为准。
> Chinese translation backup. The English source is authoritative; English controls in case of conflict.

逐项检查并在记录中写结论，不能只写“已看”。

## 事实一致性

确认 Apache-2.0 原文、SPDX 一致、路径/命令/标识存在、依赖统计已重生成、代码为事实权威、
外链和仓库地址正确、文档与翻译均入索引、VOFA+ 仅作兼容/致谢。

## 许可与知识产权

确认 LICENSE/NOTICE/manifest/表述一致；不承诺独立商业许可；新依赖和资产已登记；
deny.toml 保持狭窄；许可证和署名在源码与产物可达；历史 GPL 只描述历史；CLA 与贡献关系一致。

## 结构与可维护性

文件落位与命名正确，元数据和复审日期有效，H1/标题/代码块/链接合规，英文权威和中文来源声明
完整，无过程痕迹，权威来源明确，机器规则有门禁，遗留项有负责人和日期。

## 门禁与记录

`pnpm check:docs` 和所有受影响门禁通过；评审记录存在、已入索引，Scope / Findings /
Follow-ups 完整；README、NOTICE、manifest、CI 与发布说明同步。
