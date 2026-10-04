# 维护者

本文列出 Lissio 的维护者、职责分工与响应时效。

**权威来源**：名单与分工的意图以此处为准；提交身份以 git 历史为准（`git shortlog -sne`）；
对外联络渠道以 [SECURITY.md](SECURITY.md) 为准。本文件与 git 历史不一致时，以 git 历史
为准并按 [docs/governance/document-review.md](docs/governance/document-review.md) 修正本文件。

## 维护者

| 姓名 | git 身份 | 提交邮箱 | 职责 |
| --- | --- | --- | --- |
| 王鹏恒 | `Horldsence` | `m18511047688@163.com`、`pengheng.wang@foxmail.com` | 项目治理、合入与发布、许可与知识产权口径、数据面与设备接入层 |
| 黄皓昱 | `sloray` | `i@sloray.com` | 前端与交互、动效与面板体系、文档与提交信息规范 |

`m18511047688@163.com` 与 `pengheng.wang@foxmail.com` 是同一位维护者的两个提交身份，用途
区分见下节。

## 联络渠道

| 用途 | 渠道 |
| --- | --- |
| 漏洞、知识产权与商标举报 | 见 [SECURITY.md](SECURITY.md) |
| 行为准则举报 | 同上邮箱，按 `CODE_OF_CONDUCT.md` 的执行程序处理，不适用 `SECURITY.md` 的漏洞响应时限 |
| 功能讨论与使用问题 | 仓库 issue |
| 贡献与 PR | 仓库 issue 与 PR，流程见 [CONTRIBUTING.md](CONTRIBUTING.md) |

两个提交邮箱均为个人信箱，不具备机构域名。若两者均长期无人查看，安全与行为准则渠道会
实际失效；该风险与处置登记在评审记录中。

## 响应时效

| 事项 | 首次响应目标 | 关闭或给出计划的目标 |
| --- | --- | --- |
| 缺陷报告 | 7 日 | 30 日内给出接受、拒绝或需补充材料的结论 |
| 功能提案 | 14 日 | 60 日内给出是否采纳的结论与理由 |
| 外部 PR | 14 日 | 90 日内合入、关闭或说明阻塞项 |
| 漏洞与知识产权举报 | 3 个工作日 | 按 [SECURITY.md](SECURITY.md) 的时限表 |

首次响应只确认已收到并给出判断所需的信息，不等于承诺排期。超过时效未响应时，欢迎在
issue 中直接 @ 维护者；连续无响应本身属于 [GOVERNANCE.md](GOVERNANCE.md) 的移交触发
条件。

## 职责分工

- **合入与发布**：由维护者执行。发布前置条件见 `GOVERNANCE.md`「发布」。
- **许可与知识产权口径**：由王鹏恒负责。任何涉及 [CLA.md](CLA.md)、
  [NOTICE](NOTICE)、`src-tauri/deny.toml` 的改动须经其确认；`CLA.md` 属法律文件，改动另需
  外部法律审阅。
- **前端与界面**：由黄皓昱负责，包括动效、面板布局与 i18n 双语同步。
- **门禁与文档规范**：`pnpm check:docs` 与 `docs/governance/documentation-standards.md` 的
  变更由维护者共同确认。

分工是职责说明，不是权限边界。任一维护者都可以合入符合门禁的 PR。

## 集中度与补足计划

合入权限与发布目前集中在单一维护者，外部 PR 记录为零。这是本项目最明显的单点风险，已在
[GOVERNANCE.md](GOVERNANCE.md)「现状披露」与 [ROADMAP.md](ROADMAP.md) 中公开登记。补足
第二位提交者的条件见 `GOVERNANCE.md`「成为提交者或维护者」。

## 成为提交者或维护者

维护者公开说明提名理由、生效时点与授权范围，并在 `docs/reviews/records/` 留记录。候选
条件与流程由 [GOVERNANCE.md](GOVERNANCE.md) 规定，不以私下同意为准。