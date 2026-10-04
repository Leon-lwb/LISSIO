# 开源与知识产权治理

<!-- lissio-doc
status: maintained
owner: 维护者（Horldsence）
last-reviewed: 2026-10-04
applies-to: Lissio 全部源码、构建产物、分发形态与对外表述
-->

本文规定 Lissio 的许可模型、版权与贡献者授权、专利、第三方许可证义务与对外表述
边界。它是政策口径；具体事实以代码与配置为准，二者冲突时按
[document-review.md](document-review.md) 修正文档。

配套文档：

- [third-party-licenses.md](third-party-licenses.md) — 第三方依赖许可证清单与新增依赖审查流程
- [documentation-standards.md](documentation-standards.md) — 文档写作与组织规范
- [document-review.md](document-review.md) — 文档审查机制
- [../reviews/checklist.md](../reviews/checklist.md) — 评审清单
- 根目录 `LICENSE`（GPL-2.0 原文）、`NOTICE`、`CLA.md`、`CONTRIBUTING.md`、`SECURITY.md`、`CODE_OF_CONDUCT.md`
- 根目录 `GOVERNANCE.md`（治理结构与发布前置条件）、`MAINTAINERS.md`（维护者与响应时效）、`ROADMAP.md`（已交付范围与合规履约项）

## 治理文件

| 文件 | 作用 | 可否修改 |
| --- | --- | --- |
| `LICENSE` | GPL-2.0 官方原文，供开源轨使用 | **不可**。原文逐字节固定，`pnpm check:docs` 校验 sha256 |
| `NOTICE` | 版权声明、双许可说明、第三方归属、源码获取方式 | 可增改，须过文档审查 |
| `CLA.md` | 贡献者许可协议：授权项目方行使再许可权与专利许可 | 可增改，属法律文件，改动须经外部法律审阅 |
| `CONTRIBUTING.md` | 贡献流程与许可条款入口 | 可增改 |
| `SECURITY.md` | 漏洞与知识产权举报渠道 | 可增改 |
| `CODE_OF_CONDUCT.md` | 社区行为准则 | 可增改 |
| `GOVERNANCE.md` | 治理结构、决策、合入权限、发布前置条件、维护者产生与移交 | 可增改，须过文档审查 |
| `MAINTAINERS.md` | 维护者名单、职责分工、联络渠道与响应时效 | 可增改，须过文档审查 |
| `ROADMAP.md` | 已交付范围、合规履约项、未实现项的验收判据 | 可增改，须过文档审查 |
| `src-tauri/deny.toml` | 第三方许可证放行白名单（`[licenses]`） | 放行新标识须同步本文档与审查记录 |

## 许可模型

Lissio 采用**双许可**：接收方可在下列两条轨道中任选其一。

| 轨道 | 授权内容 | 状态 |
| --- | --- | --- |
| 开源轨 | `GPL-2.0-only` 全文条款 | 生效，随每个版本分发 |
| 商业轨 | 由项目方单独议定的商业许可条款 | **尚未发布**。正式文本发布前，任何"可购买商业许可""可闭源商用"的表述均为无依据承诺 |

要点：

- GPL 是单向授权。项目方保留在商业轨另行授权的权利，该权利来自 `CLA.md` 中贡献者
  授予的**再许可权**，不来自 GPL 本身。仅靠 GPL 或 DCO 无法实现双许可。
- 商业轨未发布不影响开源轨效力。开源使用、分发、二次开发一律以 `LICENSE` 为准。
- 商业轨发布时须同步：本文档许可模型表、`README.md` / `README.zh-CN.md` 的 License
  段落、`NOTICE`，并留一份文档审查记录。

## 许可证字段规范

全仓许可证标识唯一为 `GPL-2.0-only`。GPLv2 的最终版本发布于 1991 年 6 月，此后再无新
版本，因此 `GPL-2.0` 与 `GPL-2.0-or-later` 覆盖的作品相同；仍显式写 `only`，避免下游
工具按 `-or-later` 处理而选择 GPLv3 条款。

- `package.json` 的 `license` 与每个 workspace 成员 crate 的 `license` 字段必须一致，
  由 `pnpm check:docs` 强制。
- **不得**写成 `GPL-2.0-only OR Commercial` 之类表达。SPDX 无"非开源商业许可"标识，
  登记不实会造成下游工具（cargo-deny、OSV scanners、license-finder）误判。
- 双许可的存在与状态以 `NOTICE` 与本文档为准，不以 manifest 字段表达。

## 版权与贡献者授权

- 版权持有人：**Horldsence**。git 历史中的提交身份为 `Horldsence` 与 `sloray`，维护者确认
  二者为同一主体，故历史提交均在版权持有人一侧，无需补签。
- 贡献者**保留**自身著作权；通过 `CLA.md` 授予项目方：复制、修改、分发、再许可（含
  GPL-2.0-only 与商业条款）、以及为实现上述目的所必需的转授权权。
- 提交 pull request 等同签署 `CLA.md`。不接受该协议的贡献不得合入。
- 引入他人作品（代码、模型权重、字体、图标、数据集、协议文档）前必须确认其许可证与
  分发义务，并登记进 [third-party-licenses.md](third-party-licenses.md)。禁止在未确认
  权利来源的情况下复制粘贴外部内容。

## 专利

- **GPL-2.0 本身不含专利条款**，开源轨不提供明示专利授权。
- 专利授权由 `CLA.md` 提供：贡献者就其贡献所覆盖的必然专利侵权主张授予项目方与
  接收方许可，并承诺不针对本项目发起专利诉讼。
- 商业轨发布后，专利条款以商业许可文本为准，可能宽于或严于 CLA。
- 第三方组件的专利条款以其各自许可证为准（例如 Apache-2.0 §3 含明示专利授权）。
- 收到专利侵权指控时的处置流程见 `SECURITY.md`。

## 各分发形态的合规义务

| 形态 | 主要义务 | 现状 |
| --- | --- | --- |
| crates.io 各 `lissio-*` crate | 许可证与版权声明字段准确 | 已满足（成员以 `license.workspace = true` 继承 `GPL-2.0-only`，由 `pnpm check:docs` 校验） |
| 桌面安装包（dmg / AppImage / nsis / msi / app bundle） | 随包提供 `LICENSE` + `NOTICE`；提供完整对应源码或书面要约 | 部分满足：安装包未包含 `LICENSE` / `NOTICE`，也无源码包 |
| Web 构建产物 `dist/` | 提供 `LICENSE` + `NOTICE`；保留第三方归属与字体许可原文 | 部分满足：`dist/` 不含这些文件；字体署名在应用内 About 弹窗 |
| 容器镜像 | 镜像内提供 `LICENSE` + `NOTICE` 与源码获取入口 | 未满足：`Dockerfile` 只复制二进制与 `dist/` |
| 源码仓库 | 根目录齐备治理文件 | 已满足 |

GPL-2.0 §2 / §3 要求分发二进制时提供完整对应源码，含构建脚本与依赖锁文件。当前
发布流水线只收集构建产物作为 release 资产（`.github/workflows/release.yml`），既无源码
包也无书面要约。公开仓库本身不等于源码分发，自行构建所需的环境与依赖集合也必须一并
提供。以上缺口登记在
[../reviews/records/2026-10-04-open-source-ip-baseline.md](../reviews/records/2026-10-04-open-source-ip-baseline.md)
的遗留项，补齐前不得对外宣称已履行 GPL 分发义务。

## 第三方依赖与资产

依赖引入的判定与登记流程见 [third-party-licenses.md](third-party-licenses.md)，需要
人工留意的条目（字体、GSAP、MPL-2.0 组件、许可证字段缺失项）同样在该文档中列出。

- 放行策略以 `src-tauri/deny.toml` 的 `[licenses]` 为唯一来源；`pnpm check:docs` 校验
  该白名单不得超出已评审集合。
- 依赖升级必须重跑 `cargo deny check` 与前端许可证统计。
- 打包进产物的资源（字体、图标、主题、示例数据）同样受许可证约束，与 npm 依赖同等对待。

## 对外集成与出站协议

仓库内存在与外部服务交互的实现（LLM provider、自定义模型仓库、MCP 客户端、串口/USB
硬件、工业协议）。约定：

- 集成本身不改变本项目的许可证；外部服务的使用受其各自条款约束。
- 代码与文档中不得内置任何账号凭据或服务密钥。凭据由用户在运行时配置。
- 外部服务的名称与标识仅用于互操作性说明，不构成授权或背书。

## 协议名称与互操作性

FireWater、JustFloat、Modbus、CAN UDS 诊断服务及厂商私有帧格式等名称仅用于标识互
操作性，不表示本项目与相关厂商存在关联。上游规范文本不纳入本仓库分发；确需引用其
内容时，只引必要的片段并注明来源。

## 商标

- "Lissio" 及项目标识的商号、商标权利归 **Horldsence** 所有。
- 许可证不授予使用项目名称或标识的权利。贡献者与使用者不得用 "Lissio" 作为自身产品
  名称、域名或商标的一部分；引用项目时须注明"基于 Lissio"并不得暗示官方关联。
- 第三方名称与商标归各自权利人所有，仅用于致谢与归属。

## 对外表述红线

以下表述**不得**出现在仓库文档、issue、发布说明与对外材料中：

1. 声称 MIT / Apache / BSD 等任何与 `LICENSE` 不符的许可证；
2. 商业许可尚未发布期间，声称可购买商业许可、可闭源商用或存在已开放的企业版；
3. 声称已履行 GPL 源码分发义务，而分发形态表中的缺口尚未补齐；
4. 声称本项目是某第三方产品的官方实现或认证版本；
5. 移除或弱化第三方归属、许可证声明与专利限制。

## 变更与例外

- 许可模型、版权主体、CLA 条款与对外表述口径的变更，必须走
  [document-review.md](document-review.md) 的评审流程并留记录。
- `pnpm check:docs` 是硬门禁。确需豁免时，在评审记录中写明豁免项、理由、影响面与到期
  复查日期，不得以跳过检查的方式绕过。
