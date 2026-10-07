# 持续集成与发布

<!-- lissio-doc
status: maintained
owner: Lissio maintainers
last-reviewed: 2026-10-07
language: zh-CN
authoritative: false
translation-of: docs/ci.md
applies-to: Non-authoritative Chinese translation backup
-->

> 中文翻译备份；对应的英文源文件为权威版本。若中英文不一致，以英文为准。
> Chinese translation backup. The English source is authoritative; English controls in case of conflict.

## CI 在哪里运行

Lissio 托管在 **Codeberg**（`https://codeberg.org/Horldsence/Lissio`，remote
`codeberg.org:Horldsence/Lissio.git`）。CI 在 **Forgejo Actions** 上运行，使用
**自托管 runner**。

工作流位于 `.forgejo/workflows/`：

| 工作流 | 触发条件 | 用途 |
| --- | --- | --- |
| `ci.yml` | pull request、推送到 `main`/`develop`、手动触发 | 质量门禁 |
| `release.yml` | 手动 dispatch | 发布前的门禁预检 |
| `release-verify.yml` | 手动 dispatch | 对已发布版本做事后校验 |

### 工作流不列出任何门禁

`ci.yml` 不点名任何门禁。它的 PR 作业只运行一条命令——`pr` tier 命令——full 作业也只运行
一条命令——`full` tier 命令。两者都定义在 `scripts/gates.mjs` 中，并都驱动
`scripts/check-all.sh`，后者读取注册表。

这是刻意的，也是整套 CI 设计所依赖的性质。一个把门禁逐条列为 step 的工作流可以被**悄悄解除
武装**：注释掉某个 step、把命令换成 `echo`、包进 `if false`、在上面加一句 `exit 0`、藏进
here-doc、追加 `|| true`，或者设置 `continue-on-error: true`。上述每一种情况下，门禁的命令
都**仍然存在于文件里**，但门禁并不会运行。而通过阅读 shell 文本来区分这些情况并不可靠——
一次独立审计击败了十二次这样的尝试。

一个只运行一个脚本、且不点名任何门禁的工作流，没有什么可以被解除武装。因此
`pnpm check:ci-gates` 强制执行的是通常规则的反面，而这是一个有确定答案的问题：

- 每个工作流都必须能被解析为 YAML；
- 触发了 `pull_request` 的工作流必须**逐字节**运行 `pr` tier 命令，且不得点名任何单个门禁；
- 承载门禁的 step 必须是无条件的，不得带 `continue-on-error`，不得位于 step 级 `if` 之后，
  不得只能通过 `needs:` 到达，也不得用 `|| true` 或 `exit 0` 吞掉退出状态；
- 承载它的作业必须是无条件的，且不得通过 `needs:` 依赖另一个作业，因此它不可能被跳过；
- 只有 `pull_request` 触发器不带 `types`、`branches` 或 `paths` 过滤器时，工作流才算提供了
  pull request 覆盖——因为过滤器可以保留该键，却让工作流在真正打开的 PR 上无法触发；
- 每个作业都必须使用本文档中注册的 runner 标签，因为一个使用没有任何 runner 拥有的标签的作业
  永远不会被调度，而它看起来与一次通过完全一样。

因此新增一条门禁是单文件改动：在 `scripts/gates.mjs` 中登记，它就会自动在 CI 中运行。不需要
编辑任何工作流，也不需要手工更新任何计数。

### 门禁不会悄悄消失

把检查反转有一个明显代价：检查器信任注册表。如果有人从 `scripts/gates.mjs` 中删掉一条门禁，
任何**在注册表内部**做校验的检查都察觉不到，而工作流（运行的是 tier 而非具名门禁）同样察觉
不到。而删除一条门禁恰恰就是门禁悄悄停止运行的方式，因此它需要在注册表之外有锚点：

- **`package.json`。** 每个 `check:*`、`lint*`、`test*`、`typecheck` 和 `architecture` 脚本
  都必须能对应到某条门禁。没有任何门禁运行的检查脚本，要么是被删掉的门禁，要么是未登记的门禁；
  两种情况都会失败。那些刻意不作为门禁的脚本（tier 驱动脚本 `check:all`、`check:all:quick`，
  会写盘的 `lint`/`lint:fix`，交互式的 `test:watch`）会连同原因一并列出。
- **仓库结构。** `src-tauri/Cargo.toml`、`deny.toml`、`tsconfig.json`、`vitest.config.ts`、
  `vite.config.ts`、`playwright.config.ts` 以及 `docs/performance/frontend-perf.json` 的存在，
  各自**要求**注册表中具备相应能力——Rust 格式/静态检查/测试门禁、依赖审计、类型检查、单元测试
  门禁、生产构建门禁、浏览器门禁，以及渲染预算门禁。这些是关于所需能力的陈述，而不是门禁清单的
  第二份副本：它们不关心由哪个门禁 id 来满足。

已直接验证：删除 22 条门禁中的任意一条，然后运行 `pnpm check:ci-gates --fix`——该命令会依据
注册表重新生成文档，本会抹掉证据——在全部 22 种情况下都会失败。

`informational` 同样受到约束。它会把一条命令排除在门禁计数之外，因此只限于已被证明没有失败路径
的命令；批量把门禁标记为 informational 会是一次检查失败，而不是让某条门禁闭嘴的手段。

### 这里无法验证什么

有两条边界值得明说，因为一个被信任到超出其能力范围的检查，比一个已知不完整的检查更糟。

**注册表被默认为完整。** 上面的锚点能抓住"别处还知道它"的门禁被删除——无论那"别处"是一个
`package.json` 脚本，还是由仓库中的文件所隐含的能力。若一条门禁没有任何这样的锚点，它仍然可以
通过编辑 `scripts/gates.mjs` 被移除。这些锚点让这种移除变成一次刻意的、跨多个文件、可被审查的
行为，而不是一行改动——这是可达成的目标；但它们并不让它变得不可能。

**检查无法监督自己。** `scripts/gates.mjs`、`scripts/check-all.sh` 和
`scripts/check-ci-gates.mjs` 都只是本仓库中的普通文件，而 `check:ci-gates` 运行在**它所验证的
那个 tier 内部**。任何拥有提交权限的人都可以同时修改一条门禁和检查它的代码，而 CI 会报告绿灯。
在它之前运行的任何东西同样如此：一个安装钩子或更早的工作流 step 若重写了这套机制，就会解除其后
所有门禁的武装。检查器会拒绝它能识别的具体形态——它拒绝安装期生命周期钩子、拒绝任何提及该机制的
step，并验证可执行的计划而不只是注册表——但一个执意的作者超出了任何仓库内检查所能阻止的范围。

要真正关闭这一类问题，需要在其他任何东西运行之前验证门禁机制所处的那个已审查 revision：把这三个
文件的 SHA-256 提交下来，并作为第一个 CI step 在 `pnpm install` 之前校验，而且要用取自受保护分支
的检查器副本，而不是 pull request 里的那份。本文档没有实现这一点。实际生效的控制手段，是以对待
生产代码同样的审慎来审查对 `scripts/gates.mjs`、`scripts/check-all.sh` 和
`scripts/check-ci-gates.mjs` 的改动。

### 为什么 runner 是自托管的

Codeberg 的托管 runner 有严格上限：`codeberg-tiny` 允许 2 分钟，`codeberg-medium` 允许
10 分钟，并且官方明确表示需要托管 CI 的项目应改用 Woodpecker。本仓库有 63 个 Rust crate，
以及一个链接 `webkit2gtk` 的 Tauri 构建；仅一次冷启动的 `cargo test --workspace` 就会超出
托管额度。因此 `scripts/gates.mjs` 中的门禁在本地、在自托管 runner 上运行，并以完全相同的
形式运行在发布流水线中。

托管档位仍可用于只需数秒的廉价作业，但本仓库不依赖它。

### 注册 runner

工作流请求的标签是 **`lissio-ci`**。在 Forgejo 实例设置中（仓库或组织范围）注册一个带有
该标签的 runner：

```bash
forgejo-runner register --no-interactive \
  --instance https://codeberg.org \
  --token   <REGISTRATION_TOKEN> \
  --name    lissio-ci \
  --labels  lissio-ci:docker://catthehacker/ubuntu:act-22.04
```

然后启动它：

```bash
forgejo-runner daemon --config config.yml
```

注意：

- 标签必须与 `.forgejo/workflows/*.yml` 中的 `runs-on:` 完全一致。只在工作流中和本文档中
  修改它，不要在其他任何地方修改——一个名称，一个归属方。
- 桌面打包完全不在 CI 中运行，因此没有任何作业需要 macOS 或 Windows runner。除非同时引入
  按平台划分的 runner 标签，否则请保持这一状态：Linux 容器无法产出经过签名的 macOS/Windows
  产物。
- **runner 镜像必须自带 Tauri 系统库**，因为 `pr` 作业会运行 `cargo clippy --all-targets`
  和 `cargo test --workspace`，二者都要链接 `webkit2gtk` 与 GTK。工作流刻意不安装它们：
  那需要 root 以及镜像之间未必一致的包管理器。请至少提供 `libwebkit2gtk-4.1-dev`、
  `libgtk-3-dev`、`libayatana-appindicator3-dev`、`librsvg2-dev`、`libxdo-dev`、
  `libssl-dev`、`libudev-dev`、`pkg-config` 和 `patchelf`；`catthehacker/ubuntu:act-22.04`
  已覆盖大部分。若缺少这些，`pr` 作业会在链接阶段失败——那是 runner 配置问题，不是代码问题。
- 镜像还需要 Playwright 的浏览器依赖以支撑 `full` 作业；该作业自行运行
  `pnpm exec playwright install --with-deps chromium`，这需要 root 或预先准备好的镜像。

## 门禁清单只有一个归属方

`scripts/gates.mjs` 是质量门禁的**唯一事实来源**。它按门禁记录：稳定 id、控制台标签、
工作目录、要运行的 argv、它是在 PR 上运行（`pr`）还是只在完整流程中运行（`full`）、
它为何存在，以及哪些文档必须包含它。

其他一切都由它派生：

- `scripts/check-all.sh` 通过 `pnpm gates --plan` 读取执行计划，因此本地运行与 CI 运行的是
  同一份清单。
- `AGENTS.md`、`CONTRIBUTING.md` 和 `.github/PULL_REQUEST_TEMPLATE.md` 在
  `<!-- lissio-gates:start -->` 与 `<!-- lissio-gates:end -->` 之间嵌入一个**生成块**。
- 当某个生成块过期、当某个工作流运行了未注册的脚本、或当某个工作流点名了单个门禁、禁用了承载
  门禁的 step、或偏离了 tier 命令时，`pnpm check:ci-gates` 会失败。

这一结构取代了一份被手工维护、被抄写了四遍且已经发生漂移的清单：某个工作流运行了
`check:layers`，而 `AGENTS.md` 和 pull request 模板遗漏了它；500 行源码上限只存在于一个
永远无法运行的作业中，因此一个 514 行的文件一直没有被发现。

要修改门禁范围：

```bash
# 1. edit the inventory
$EDITOR scripts/gates.mjs
# 2. propagate into the documents
pnpm check:ci-gates --fix
# 3. confirm everything agrees
pnpm check:ci-gates
```

`pnpm gates --list --set pr` 打印 PR 范围；`--set full` 打印全部；`--json` 可供工具使用。

## 本地等价命令

| 用途 | 命令 |
| --- | --- |
| 全部内容，并修复格式 | `pnpm check:all` |
| 仅 PR 级门禁 | `pnpm check:all --quick` |
| 只检查而不写入 | `pnpm check:all --no-fix` |
| 只显示计划而不运行 | `pnpm check:all --list` |
| 查看注册表 | `pnpm gates --list` |

完整的本地运行需要 Playwright 浏览器
（`pnpm exec playwright install --with-deps chromium`）和 `cargo-deny` 0.20.2。

两个门禁作业都会缓存 `~/.cargo/{registry,git}` 与 `src-tauri/target`，缓存键取自
`src-tauri/Cargo.lock`。63 个 crate 的 clippy 与测试套件在冷缓存下无法舒适地放进该作业
60 分钟的时间预算，而那里的超时会让每个 pull request 都以无有效信号的方式失败。该缓存步骤
带有**步骤级** `continue-on-error: true`——这种形式 Forgejo 是支持的，与作业级不同——因此
缓存服务不可用时只是多花时间，而不是让构建失败。

## 与 GitHub Actions 的差异

Forgejo Actions 与 GitHub 兼容但并不完全相同。这里重要的是以下差异：

- **`permissions:` 会被忽略。** Token 权限范围取决于 runner 被授予了什么。不要依赖
  `permissions:` 来限制某个作业。
- **作业级的 `continue-on-error` 会被忽略，但步骤级形式有效。** 本仓库的每个*门禁*都应当
  阻断，因此没有任何门禁带这个标记。唯一使用它的是 cargo 缓存步骤（缓存故障应当只是多花时间，
  而不是让构建失败）。一个根本不可能失败的命令会在注册表中被标记为 `informational`，而不是
  给它 `continue-on-error`，并且不计入门禁数量。
- **Action 引用必须能从 Forgejo 的实例解析。** 使用
  `https://code.forgejo.org/actions/checkout@v4` 而不是 `actions/checkout@v4`。这里没有
  任何在作业之间传递产物的需求，因此不需要 `actions/upload-artifact` 和
  `actions/download-artifact`。
- **没有 `gh` CLI，也没有 `GITHUB_TOKEN`** 可用于 Codeberg。发布通过 Forgejo REST API 配合
  token 创建，环境变量即仓库上配置的 `secrets.*`。
- **`releases/latest/download/...` 不存在。** 见下文。

## 发布流程

打包**不**在 CI 中自动化。一次发布需要 macOS（arm64 与 x64）、Windows 和 Linux 的签名产物。
这需要一台原生 macOS 主机外加 Docker 和 `cargo-xwin`；单个 runner 无法产出全部这些产物，
而交叉构建链接 webkit2gtk 的 Tauri 应用并不现实。

维护者使用 `pnpm auto-build` 在本地构建，它已经实现了交叉目标构建、签名，以及更新器所需的
带架构后缀的 `.sig` 命名。CI 则覆盖它真正擅长的两个阶段，各自放在一个单一职责的工作流里。

**发布前：`release.yml`。** `preflight` 作业在待发布的 revision 上重新运行完整的门禁范围。
发布是发现红灯门禁代价最高、也最难回退的场合。当 `package.json` 与所请求的版本不一致时，它也会
拒绝继续，因此版本不匹配会在产物存在之前就失败，而不是产出被错误标记的产物。

**发布后：`release-verify.yml`。** `verify` 作业通过 HTTP 重新检查线上发布物。正是缺少这项
检查才让应用内更新器一直处于损坏状态：旧流水线把发布物发到 Codeberg，而更新器读取的是一个返回
404 的 GitHub URL，却从来没有任何东西去抓取它。对 URL 字符串的静态断言无法发现这一点；
`pnpm release:verify` 发出真实请求，并针对每个失败报告可复现的 URL。

它们被拆成两个工作流，而不是同一个工作流中两个带条件的作业。以某个 forge 并不求值的条件作为
门控的作业会被跳过，而**被跳过的作业看起来和一个通过的作业完全一样**——流水线会报告成功，
却什么也没检查。一个工作流，一个作业，没有条件式的空操作。

### 发布

发布是一个脚本而不是 YAML，因此本地路径与自动化路径共享同一份实现：

```bash
pnpm auto-build --all                              # build signed bundles locally
pnpm publish:release --version 0.8.0 --dry-run      # preview
pnpm publish:release --version 0.8.0                # publish
pnpm release:verify  --version 0.8.0                # confirm it really works
```

`publish-release.mjs` 把产物上传到不可变的 `vX.Y.Z` tag，生成 `SHA256SUMS`，根据 `.sig` 文件
构建更新器 manifest，最后把滚动通道 tag 指向新的 manifest。顺序很重要：manifest 最后发布，
因此客户端永远不会在其资源存在之前看到 URL。manifest 中各平台的 URL 指向不可变的版本 tag
而非滚动 tag，因此下载到的载荷始终可追溯到某个版本。

设置这些仓库 secret：

| Secret | 用途 |
| --- | --- |
| `RELEASE_TOKEN` | 具有仓库写权限的 Codeberg token，用于发布 API |
| `TAURI_SIGNING_PRIVATE_KEY` | Tauri 更新器签名密钥 |
| `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` | 该密钥的口令 |

没有签名密钥时，脚本会发出警告并跳过更新器 manifest，而不是宣传一个客户端会因缺少签名而
拒绝的更新。这并非假设：目前没有任何已发布版本带有 `.sig` 文件，这正是应用内更新尚不可用的
原因。

发布之前，先准备版本并提交，使工作树与版本一致：

```bash
pnpm release:prepare       # 变更文件 → 版本号 + CHANGELOG + 版本文件
git commit -am "chore(release): v0.8.0"
```

`release:prepare` 消费 `.changes/` 里的变更文件，写入版本号与 `CHANGELOG.md` 条目，然后调用
`set-version.mjs` 把 base 版本扩散到 `tauri.conf.json`、Cargo manifest 与 `Cargo.lock`。两道
pr 层门禁守住这个状态：`check:changes` 校验变更文件，`check:release-sync` 在版本字段、
`CHANGELOG.md` 与其中文备份互不一致时失败。`RELEASING.md` 覆盖面向维护者的检查清单、预发布
模式与人工兜底流程。

## 更新通道

应用内更新器从**滚动发布 tag** 读取**静态 manifest**。为此存在两个固定 tag 名，它们的
manifest 会在每次发布时被替换，因此客户端 URL 永不改变：

| 通道 | Manifest | URL |
| --- | --- | --- |
| stable | `latest.json` | `https://codeberg.org/Horldsence/Lissio/releases/download/stable/latest.json` |
| beta | `beta-latest.json` | `https://codeberg.org/Horldsence/Lissio/releases/download/beta/beta-latest.json` |

两者都在 `src-tauri/crates/desktop/update_flow/src/update.rs` 中被断言。

**为什么用滚动 tag 而不是 "latest" URL。** Codeberg 未实现 GitHub 的
`releases/latest/download/<file>` 伪路径。对一个确实存在的资源实测：
`/releases/download/<tag>/<file>` 返回 200，而 `/releases/latest/download/<file>` 返回 404。
因此固定 tag 名是唯一可用的稳定地址。不要把这些 URL「简化」成 `latest` 路径：那正是这套
方案所取代的故障。

有两种不同的东西都被叫做「latest」，而它们在这里都不可用：

- GitHub 的路径形式 `/releases/latest/download/<file>` 在 Codeberg 上没有对应物——Forgejo
  对它返回 404。实测见下。
- Codeberg 的 tag 位置 `/releases/download/<tag>/<file>` *确实*接受字面 tag `latest`，但
  `latest` 指的是最新的**非预发布**版本，而本项目的每个发布都标记为预发布——因此在本仓库中该
  路径同样解析不到任何东西。

实测：`/releases/latest/download/Lissio_0.7.2_aarch64.dmg` → 404，
`/releases/download/latest/Lissio_0.7.2_aarch64.dmg` → 404，而
`/releases/download/0.7.2-beta/Lissio_0.7.2_aarch64.dmg` → 200。滚动 tag 完全避免了对这两种
概念的依赖：它们是我们控制的固定名称，而不是 forge 计算出的「最新」概念。

预发布更新 beta 通道；完整发布更新 stable 通道。草稿永远不会更新滚动通道，因此草稿无法向
已安装的客户端宣传自己。

## Tag 命名

发布 tag 为 `vX.Y.Z`，预发布追加 `-alpha.N`、`-beta.N` 或 `-rc.N`。保持一致：
`scripts/auto-build.sh` 从 `git tag --list 'v[0-9]*'` 推导下一个版本，因此没有前缀的 tag
对版本递增逻辑不可见，可能产出一个比已发布版本更低的下一版本。

有六个既有 tag 不带 `v` 前缀：四个已发布的版本（`0.6.1`、`0.7.0-rc.1`、`0.7.1-alpha`、
`0.7.2-beta`）、保留的滚动 tag `beta`（见下），以及并非发布的 `issue-1`。那四个发布 tag 不可变，
保持已发布状态；`pnpm release:verify` 对既有发布接受两种形式，而 `pnpm publish:release` 始终
写入 `vX.Y.Z` 形式。

两个 tag 名保留给更新器，它们在版本意义上不是发布：`stable` 和 `beta`。它们保存滚动 manifest。

## 历史

这条流水线取代了 `.github/workflows/{build,lint,release}.yml`，这些文件已在同一次变更中被删除。
它们无法运行：仓库没有 GitHub remote，因此 GitHub Actions 没有该项目的副本，而它们所供给的
更新器端点指向 `github.com/Horldsence/lissio`，该地址返回 404。如果将来添加 GitHub 镜像，
这些文件仍可从 git 历史中恢复。

更早的评审记录已把这一不一致记为待办项：
`docs/reviews/records/2026-10-04-fact-consistency-fixes.md`（第 12 行）和
`docs/reviews/records/2026-10-04-open-source-ip-baseline.md`（第 9 行）。
