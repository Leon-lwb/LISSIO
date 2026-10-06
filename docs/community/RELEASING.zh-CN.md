# Lissio 发布手册

<!-- lissio-doc
status: maintained
owner: Lissio maintainers
last-reviewed: 2026-10-07
language: zh-CN
authoritative: false
translation-of: RELEASING.md
applies-to: Non-authoritative Chinese translation backup
-->

> 中文翻译备份；对应的英文源文件为权威版本。若中英文不一致，以英文为准。
> Chinese translation backup. The English source is authoritative; English controls in case of conflict.

## 范围

本手册面向从 Codeberg 仓库发布 Lissio 的维护者。

## 版本

使用语义化版本和 `vX.Y.Z` tag。预发布追加 `-alpha.N`、`-beta.N` 或 `-rc.N`。前端与 Rust
workspace 版本保持同步。

## 发布前检查

确认发布 commit、干净工作树，运行 `CONTRIBUTING.md` 的完整命令，执行
`pnpm check:docs`，检查 `NOTICE`、第三方文本与字体许可，确认没有安全或评审阻断项，并核对
发布说明、平台与兼容性。不得为了通过检查而覆盖性能或契约基线。

## 构建与发布

从同一源码 revision 构建 Web、服务端、CLI 与桌面产物，收集源码、`LICENSE`、`NOTICE`、
第三方文本与校验和，在每个发布平台验证安装和启动。

创建 annotated `vX.Y.Z` tag，发布 `CHANGELOG.md` 说明、产物和 checksum，验证下载、更新元
数据和源码链接，并在 `docs/reviews/records/` 留记录。

当前 Apache-2.0 发布物不承担 GPL 式对应源码义务。早期 GPL 发布物仍按原许可处理。

## 故障恢复

不得静默删除或替换已发布 tag/产物。必要时撤回受影响版本、发布修正版本并记录事故。
