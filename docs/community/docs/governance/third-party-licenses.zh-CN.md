# 第三方许可证清单

<!-- lissio-doc
status: maintained
owner: Lissio maintainers
last-reviewed: 2026-10-07
language: zh-CN
authoritative: false
translation-of: docs/governance/third-party-licenses.md
applies-to: Non-authoritative Chinese translation backup
-->

> 中文翻译备份；对应的英文源文件为权威版本。若中英文不一致，以英文为准。
> Chinese translation backup. The English source is authoritative; English controls in case of conflict.

机器白名单的唯一来源是 `src-tauri/deny.toml`，本文解释并审计它。

复现命令：

```bash
cargo metadata --format-version 1 --manifest-path src-tauri/Cargo.toml
pnpm licenses list --json --prod
pnpm licenses list --json
cargo deny check
```

## Rust 快照

当前外部 crate 以宽松许可为主，包括 `MIT OR Apache-2.0`、MIT、Apache-2.0、BSD、ISC、
Unicode、Zlib、Unlicense、CC0、CDLA 与 MPL。`unescaper` 取 MIT 分支；含 LGPL 备选的包取
MIT/Apache 分支；`dompurify` 取 Apache-2.0 分支。

当前 Apache-2.0 代码不放行单许可 GPL、AGPL、SSPL、BUSL、Elastic 或 commercial-only 的
链接型生产依赖。双许可包必须选择允许分支。MPL-2.0 仅允许按文件级 copyleft 处理。

## 前端快照

生产 392 个包、完整图 791 个包，主要为 MIT、ISC、Apache、BSD。另有 OFL 字体、GSAP 自定义
no-charge 条款、MPL 备选和开发期署名数据集。

## 人工义务

MiSans 需要 About 署名并确认子集化是否允许；Maple Mono CN 与 JetBrains Mono 使用 OFL 1.1，
必须随字体提供许可；GSAP 每次升级重读条款且不得描述为 MIT；`serialport` 的 MPL 源文件如被
修改必须公开修改文件；`khroma` 按包内 MIT 文件人工登记。

字体许可文本必须随含字体的产物分发，应用署名来源是 `src/lib/fontAttributions.ts`。

## 审查流程

登记版本，检查实际 license 文件，确认 SPDX 选择，区分宽松/文件级/弱 copyleft/自定义/缺字段，
运行 `cargo deny check`、`pnpm check:deps`、`pnpm check:docs`，最后更新清单和评审记录。
不得为了通过门禁放宽 deny.toml。
