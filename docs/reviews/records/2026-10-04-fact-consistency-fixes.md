# 事实不一致修正

<!-- lissio-review
date: 2026-10-04
scope: 修正基线评审遗留项 3、4、6；i18n 键随常量改名
reviewer: 维护者（Horldsence）
verdict: 通过
-->

修正 [2026-10-04-open-source-ip-baseline.md](2026-10-04-open-source-ip-baseline.md) 的遗留项
3、4、6。原记录不修改，按此记录为准。

## 范围

| 项 | 内容 |
| --- | --- |
| 3 | `src/components/AboutModal.tsx` 的许可证显示由 `GPLv2` 改为 `GPL-2.0-only` |
| 4 | `src/components/AboutModal.tsx` 的仓库与文档链接改为 Codeberg 地址；`APP_GITHUB` 更名为 `APP_REPO` |
| 6 | `SECURITY.md` 的举报邮箱统一为 `pengheng.wang@foxmail.com` |

## 结论

| 清单项 | 结论 |
| --- | --- |
| 1.3 引用真实性 | `APP_REPO` 与 `docs/README.md` 首段、`README.md` 的 clone 命令一致，均为 `https://codeberg.org/Horldsence/Lissio`；`APP_DOCS` 指向该仓库 `docs/README.md` |
| 2.1 许可证表述 | About 弹窗显示 `GPL-2.0-only`，与 `package.json` 及各 crate 字段一致；双许可说明仍只在 `NOTICE` 与 `open-source-and-ip.md` 中维护，不进 UI 字段 |
| 2.6 对外表述 | 按钮文案由 "GitHub 仓库 / GitHub Repository" 改为中立的 "源码仓库 / Source Repository"，图标由 `Github` 换为 `Code`，避免用 GitHub 图标指向 Codeberg |
| 3.3 元数据 | 本记录为新增记录，`docs/reviews/README.md` 索引表已追加一行 |
| 5.1 门禁 | `pnpm check:docs`、`pnpm typecheck`、`pnpm lint:ci`、`pnpm test` 通过 |

i18n 键 `aboutGithub` 随之更名为 `aboutRepo`，中英两份 `settings.yml` 与组件引用同步
修改，无遗留旧键。密钥键名不变，界面显示值随常量。

## 遗留项

| # | 事项 | 依据 | 负责人 | 到期 |
| --- | --- | --- | --- | --- |
| 11 | About 弹窗改动未做运行时目视验证（无对应单测，`pnpm dev:desktop` 未执行），仅有类型检查与静态检查通过 | 本记录「结论」 | 维护者 | 下次打开应用时 |
| 12 | `.github/workflows/release.yml` 全流程使用 `GITHUB_TOKEN`、`gh release create` 与 `github.com/${{ github.repository }}`，而 `git remote` 只有 Codeberg。需确认发布实际托管地后再定自动更新地址，基线记录的遗留项 9 因此仍未关闭 | `git remote -v`、`.github/workflows/release.yml` | 维护者 | 下次发布前 |
