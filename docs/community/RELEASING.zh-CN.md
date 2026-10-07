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

版本是**算出来的，不是选出来的**。贡献者在 `.changes/` 里为每次改动写一个变更文件（见
[`.changes/README.md`](.changes/README.md)），`pnpm release:prepare` 把累积的变更文件变成
一个版本号以及对应的 `CHANGELOG.md` 条目。发布链路上没有任何一步需要维护者手工在 patch /
minor / major 之间做判断。

`package.json` 保存完整版本（含预发布后缀）。`src-tauri/tauri.conf.json` 与 Cargo manifest 只
保存去掉后缀的 base 版本，因为 MSI 打包器不接受预发布标识符。`scripts/set-version.mjs` 是这些
文件的唯一写入者。

本节描述的不变量由两道门禁守住，二者都在 pr 层，因此发布前的 preflight 会自动覆盖：

- `pnpm check:changes` —— 每个变更文件都指向已声明的包、合法的 bump 与已声明的章节 tag。
- `pnpm check:release-sync` —— `package.json`、`tauri.conf.json`、`Cargo.toml` 与 `Cargo.lock`
  版本一致，且 `CHANGELOG.md` 与其中文备份（`docs/community/CHANGELOG.zh-CN.md`）都包含该版本。

## 发布前检查

1. 确认发布 commit 在发布分支上，且工作树干净。
2. 运行 `CONTRIBUTING.md` 的完整命令集。
3. 用默认评审窗口运行 `pnpm check:docs`。
4. 检查 `NOTICE`、第三方文本与打包字体许可。
5. 确认没有安全或评审阻断项。
6. 核对发布说明、支持平台与兼容性变更。

不得为了通过检查而覆盖性能或契约基线。

## 准备版本

```bash
pnpm release:prepare                # 版本 + CHANGELOG + 版本文件
pnpm release:prepare -- --dry-run   # 只打印它将选择的版本
```

`release:prepare` 运行 `covector version`：消费 `.changes/*.md`，把新版本写入 `package.json`，
生成 `CHANGELOG.md` 条目，然后通过 `postversion` 钩子调用 `scripts/changelog-normalize.mjs`。
归一化器恢复本仓库的格式：元数据块与前言回到顶部、标题带上 `## [X.Y.Z] - YYYY-MM-DD`、剥掉
机器生成的前缀。随后运行 `pnpm set-version`，把版本扩散到 `tauri.conf.json`、
`[workspace.package]`、内部 `[workspace.dependencies]` 条目与 `Cargo.lock`。

工作树不干净时它会拒绝执行；确实需要在脏树上继续时加 `--allow-dirty`。提交结果后再开始构建。

在同一次提交里把新条目翻译进 `docs/community/CHANGELOG.zh-CN.md`。译文不自动生成：英文有而
中文备份缺少某个版本时，`check:release-sync` 会失败。

### 预发布

在 `.changes/pre.json` 写入以下内容即可进入预发布模式：

```json
{ "tag": "beta", "changes": [] }
```

此时 `release:prepare` 产出 `X.Y.Z-beta.N`。一个周期的第一次 bump 是 `-beta.0`，之后影响相同
或更小的 bump 会变成 `-beta.N+1`。该模式下被消费的变更文件记录进 `pre.json` 而不是删除。

退出预发布模式：删除 `.changes/pre.json` 与残留变更文件，为稳定版写一个变更文件，再次运行
`pnpm release:prepare`。

## 构建

```bash
pnpm auto-build --version 0.8.0   # 为 macOS (arm64 + x64)、Windows、Linux 构建签名产物
```

`pnpm auto-build` 是唯一受支持的路径，它负责跨目标构建、更新器签名以及更新器所需的
arch 后缀 `.sig` 命名。`release:prepare` 之后**必须显式传 `--version`**：不带该参数时
`auto-build` 会按最近 tag 自行推导版本，从而与已准备好的树不一致。

打包刻意不进 CI：它需要一台原生 macOS 主机加上 Docker 与 `cargo-xwin`，单个 runner 无法提供。
约束与所需 secret 见 `docs/ci.md`。

在每个发布平台上安装并启动产物，收集 Web、服务端/CLI、桌面、源码、`LICENSE`、`NOTICE` 以及
必需的第三方许可文件。

## 发布

```bash
pnpm publish:release --version 0.8.0 --dry-run   # 预览
pnpm publish:release --version 0.8.0             # 上传、校验和、更新器清单
pnpm release:verify  --version 0.8.0             # 确认下载与更新真的可用
```

`publish-release.mjs` 创建 `vX.Y.Z` release、上传产物、生成 `SHA256SUMS`、由 `.sig` 构建更新器
清单，最后才把滚动通道 tag 指向它。它需要 `RELEASE_TOKEN`。清单最后发布，因此客户端永远不会
在产物存在之前看到 URL。

随后：

1. 用 `CHANGELOG.md` 发布 release notes。
2. 用 `pnpm release:verify` 验证下载页、更新器元数据与源码链接。
3. 在 `docs/reviews/records/` 记录本次发布评审。

如果该 revision 还没跑过 CI，先运行 preflight：

```bash
# 手动触发 release.yml，或在本地：
pnpm check:all --no-fix
```

两个发布 workflow 都不打包。`release.yml` 在待发布 revision 上重跑门禁面；`release-verify.yml`
对已发布版本做实网复核（下载可解析、校验和存在、更新器清单存在、它宣称的每个 URL 都返回 200）。
二者是各自只有一个无条件 job 的独立 workflow，因此 job 不可能被跳过却看起来像通过。

最后这项检查不是仪式。应用内更新曾经正是因为没人真正请求过清单 URL 而失效：流水线发布到
Codeberg，更新器却读一个返回 404 的 GitHub 地址。静态字符串断言抓不到这类问题。

Codeberg 没有 `releases/latest/download/...` 路径，而 `releases/download/latest/...` 指向最新的
**非**预发布版本——本仓库所有已发布版本都标记为 prerelease，所以它什么都指不到。这就是客户端
读取固定滚动 tag 的原因（正式版 `stable`，预发布 `beta`）。

当前 Apache-2.0 发布物不承担 GPL 式对应源码义务。早期 GPL 发布物仍按原许可处理。

## 故障恢复

不得静默删除或替换已发布 tag/产物。必要时撤回受影响版本、发布修正版本并记录事故。只有在确认
不存在残缺的公开产物之后，才可以重试失败的 workflow。
