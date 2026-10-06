# Lissio 文档开发指南

<!-- lissio-doc
status: maintained
owner: Lissio maintainers
last-reviewed: 2026-10-07
language: zh-CN
authoritative: false
translation-of: docs/AGENTS.md
applies-to: Non-authoritative Chinese translation backup
-->

> 中文翻译备份；对应的英文源文件为权威版本。若中英文不一致，以英文为准。
> Chinese translation backup. The English source is authoritative; English controls in case of conflict.

根目录 `AGENTS.md` 是仓库开发的权威指南。本文只覆盖文档工作。

英文文档为权威版本。中文备份放在 `docs/community/`，镜像原路径并使用 `.zh-CN.md`。
历史评审记录不得改写。

修改 Rust 或 wire 契约前，阅读 `architecture/crates.md` 并运行 `pnpm architecture`。
文档流程是：更新英文源、更新中文备份、登记索引、更新 `last-reviewed`、运行
`pnpm check:docs`、完成清单、写入并索引评审记录。

当前源码树使用 Apache-2.0。历史 GPL 发布物保留原许可。VOFA+ 与 `vofa` 仅用于协议兼容名、
内部标识与第三方致谢。
