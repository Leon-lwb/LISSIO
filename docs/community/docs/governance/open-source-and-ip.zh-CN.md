# 开源与知识产权政策

<!-- lissio-doc
status: maintained
owner: Lissio maintainers
last-reviewed: 2026-10-07
language: zh-CN
authoritative: false
translation-of: docs/governance/open-source-and-ip.md
applies-to: Non-authoritative Chinese translation backup
-->

> 中文翻译备份；对应的英文源文件为权威版本。若中英文不一致，以英文为准。
> Chinese translation backup. The English source is authoritative; English controls in case of conflict.

本政策覆盖当前 Lissio 源码树、二进制、容器与对外表述。实现事实以代码和配置为准。

## 许可模型

当前源码树使用 Apache License 2.0，权威原文是 `LICENSE`，SPDX 标识为 `Apache-2.0`。
Apache-2.0 允许商业使用、修改、私用和源码/二进制分发，也可与专有作品一起分发，但必须
保留署名、声明修改并满足许可其他条件。Lissio 不提供或承诺独立商业许可证。

早期以 GNU GPL version 2 only 分发的二进制继续按其随附许可处理。当前 Apache-2.0 不被
表述为对历史产物的追溯再许可。

## 文件职责

`LICENSE` 为原文；`NOTICE` 记录版权、历史范围和归属；`CLA.md` 规定贡献和专利；`AUTHORS.md`
提供作者摘要；`CONTRIBUTING.md`、`SECURITY.md`、`src-tauri/deny.toml` 与
`third-party-licenses.md` 分别负责贡献、举报、依赖白名单和第三方义务。

## SPDX 与贡献

`package.json`、Rust workspace 和继承成员必须声明 `Apache-2.0`，不得写虚构的
`Apache-2.0 OR Commercial`。贡献者保留著作权，按照 `CLA.md` 以 Apache-2.0 授权。

2026-10-07 前发布的历史贡献协议包含当前源码树再许可权。AI 生成材料只有在人工复核并确认
许可后才可接收。

## 专利与分发

Apache-2.0 包含专利许可与报复终止条款。第三方专利条款由各自许可决定。

源码包、桌面安装包、Web、服务端/CLI 和镜像必须携带 `LICENSE`、`NOTICE` 和适用的第三方/
字体许可。Apache-2.0 不施加 GPL 式当前版本对应源码义务，但源码和构建可复现仍是项目政策。
早期 GPL 发布物保留原源码义务。

## 协议名称与商标

JustFloat、FireWater 是兼容协议名，`vofa-dock` 是内部持久化标识。VOFA+ 引用仅表示兼容来源
和第三方致谢，不表示 Lissio 身份或背书。Lissio 与第三方商标归各自权利人。

## 对外表述

不得声称未发布的商业许可证、付费支持、担保或认证；不得无证据声称硬件/协议已验证；不得声称
历史 GPL 产物已追溯改许可；不得声称不存在的法律批准。

许可、通知、依赖与分发变化必须走 `document-review.md`。例外必须明确并设复查日期。
