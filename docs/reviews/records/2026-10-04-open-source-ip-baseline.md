# 开源与知识产权基线评审

<!-- lissio-review
date: 2026-10-04
scope: 新增开源与知识产权文档集、治理文件与文档审查门禁
reviewer: 维护者（Horldsence）
verdict: 有条件通过
-->

## 范围

新建 `docs/governance/`（开源与知识产权治理、第三方清单、文档规范、评审机制）、
`docs/reviews/`（清单与本记录）、`docs/README.md` 索引；新增根目录 `NOTICE`、`CLA.md`、
`CONTRIBUTING.md`、`CODE_OF_CONDUCT.md`、`SECURITY.md`；新增门禁
`scripts/check-docs.mjs` 并接入 `package.json`、`scripts/check-all.sh`、CI；
更正 README 与 README.zh-CN 中的仓库地址与 License 段落。

清单机器项 1.1-1.7 由 `pnpm check:docs` 通过；人工项结论如下。

## 结论

| 清单项 | 结论 |
| --- | --- |
| 2.1-2.2 许可证表述 | `LICENSE` 保持 GPL-2.0 原文（未改动，sha256 校验）；`package.json` 与全部 workspace 成员为 `GPL-2.0-only`；`NOTICE` 写明双许可与商业许可未发布；未出现 `OR Commercial` 之类非法表达 |
| 2.3 第三方登记 | 依赖现状由 `cargo metadata` 与 `pnpm licenses list --json` 实际统计得出；字体义务取自 `src/assets/fonts/*-LICENSE.txt` 原文；无新增依赖 |
| 2.4 `deny.toml` | 未改动。15 个 allow 标识全部在 `check-docs.mjs` 的 `KNOWN_COMPATIBLE` 内，且无与 `GPL-2.0-only` 冲突的强 copyleft |
| 2.5 第三方归属可达 | 仓库内可达；**产物内存在缺口**，见遗留项 2 |
| 2.6 对外表述 | 已核对 README、About 弹窗与仓库内文档；**存在需修正项**，见遗留项 3、4 |
| 2.7 CLA 与贡献者关系一致 | git 历史中的提交身份为 `Horldsence` 与 `sloray`，维护者确认二者为同一主体，故历史提交均在版权持有人一侧，无待补签贡献 |
| 3.1-3.6 结构与格式 | 落位、命名、元数据、标题层级、代码块语言、相对链接、无过程痕迹标记，均已核对 |
| 4.1-4.5 可维护性 | 可机器判定项已落为门禁；授权主体、第三方清单、字体署名均指明权威来源 |

事实核对结果：仓库 remote 为 `codeberg.org/Horldsence/Lissio`，README 与 README.zh-CN
原徽章指向 `github.com/horldsence/lissio`，已按前者更正。

## 遗留项

| # | 事项 | 依据 | 负责人 | 到期 |
| --- | --- | --- | --- | --- |
| 1 | 分发二进制未提供 GPL-2.0 §2/§3 要求的完整对应源码或书面要约。`.github/workflows/release.yml` 只收集构建产物，无源码包 | GPL-2.0-only §2、§3 | 维护者 | 下次发布前 |
| 2 | 字体许可原文未随产物分发。`src/assets/fonts/*-LICENSE.txt` 无代码引用，Vite 不复制，OFL 要求许可文本随字体提供 | OFL 1.1 §1 | 维护者 | 下次发布前 |
| 3 | `src/components/AboutModal.tsx:17` 硬编码 `APP_LICENSE = 'GPLv2'`，与 `GPL-2.0-only` 及双许可口径不一致 | `open-source-and-ip.md`「许可模型」 | 维护者 | 下次改动该文件时 |
| 4 | `src/components/AboutModal.tsx:18-19` 指向 `github.com/Horldsence/lissio`，与仓库实际托管地不一致（README 中的同类地址已更正） | `git remote -v` | 维护者 | 下次改动该文件时 |
| 5 | MiSans 许可第 2 条禁止改编或二次开发；仓库使用裁剪后的 woff2 子集（字形轮廓未改，见 `MiSans-LICENSE.txt` 附注），是否构成"改编"需法律确认 | `src/assets/fonts/MiSans-LICENSE.txt` | 维护者 | 下次发布前 |
| 6 | `SECURITY.md` 与 `CODE_OF_CONDUCT.md` 使用的邮箱取自 git 提交身份 `m18511047688@163.com`，需确认是否为对外可用的举报邮箱 | `git log` 的提交身份 | 维护者 | 下次发布前 |
| 7 | 商业许可文本尚未发布。发布前不得对外宣称可购买商业许可；发布时须同步 `NOTICE`、README 双语 License 段落与许可模型表 | `open-source-and-ip.md`「许可模型」 | 维护者 | 商业许可发布时 |
| 8 | `docs/architecture/` 下的既有文档尚未携带元数据块，门禁暂不强制该目录；按被修改顺序补齐 | `documentation-standards.md`「既有文档的补齐」 | 维护者 | 渐进，无固定到期 |
| 9 | `.github/workflows/release.yml` 的 `latest.json` 与自动更新地址使用 `github.com/${{ github.repository }}`，与仓库实际托管地不符 | `git remote -v` | 维护者 | 下次发布前 |
| 10 | `pnpm lint:ci` 在 `e2e/docked-panel.spec.ts` 有 7 条 `@typescript-eslint/no-unsafe-*` 错误。该文件是本次改动前就在工作区的未提交内容，非本轮引入，但会阻断 `build.yml` 的 quality job | `pnpm lint:ci` 输出 | 维护者 | 合入前 |
