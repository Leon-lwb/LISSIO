# 第三方依赖许可证清单与审查流程

<!-- lissio-doc
status: maintained
owner: 维护者（Horldsence）
last-reviewed: 2026-10-04
applies-to: Rust workspace 全部依赖、pnpm 全部依赖、打包进产物的资源文件
-->

本文记录第三方依赖的许可证现状、必须人工留意的条目，以及新增/升级依赖时的审查流程。
放行白名单的唯一机器来源是 `src-tauri/deny.toml` 的 `[licenses]`，本文解释它。

## 复现与再生成

```bash
# Rust 侧：SPDX 分布（需安装 Rust 工具链）
cargo metadata --format-version 1 --manifest-path src-tauri/Cargo.toml \
  | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{const m=JSON.parse(s);const w=new Set(m.workspace_members);const c=new Map();for(const p of m.packages.filter(p=>!w.has(p.id)&&p.source)){const l=p.license||'NOASSERTION';c.set(l,(c.get(l)||0)+1)};[...c].sort((a,b)=>b[1]-a[1]).forEach(([l,n])=>console.log(String(n).padStart(4),l))})"

# 前端侧：pnpm 侧的许可证分布
pnpm licenses list --json --prod     # 产物内依赖
pnpm licenses list --json            # 含 devDependencies
```

`cargo deny check` 覆盖 Rust 侧的 advisories / licenses / bans / sources 四个维度，
是发布前的硬门禁。本仓库未引入前端许可证扫描工具，因此前端侧以本文的统计为准，
依赖变动时需人工复核。

## 现状快照（2026-10-04）

### Rust 侧：778 个外部 crate

出现 5 次及以上的 SPDX 标识：

| SPDX 标识 | 次数 | 说明 |
| --- | --- | --- |
| `MIT OR Apache-2.0` | 364 | 取任一分支即可 |
| `MIT` | 167 | |
| `Apache-2.0 OR MIT` | 67 | |
| `MIT/Apache-2.0` | 34 | 旧式斜杠写法，语义同上 |
| `Apache-2.0` | 26 | |
| `Zlib OR Apache-2.0 OR MIT` | 23 | |
| `Unicode-3.0` | 18 | |
| `Unlicense OR MIT` | 10 | |
| `Apache-2.0 WITH LLVM-exception OR Apache-2.0 OR MIT` | 7 | |
| `MPL-2.0` | 6 | 文件级 copyleft，见下表 |
| `ISC` / `Apache-2.0/MIT` | 各 5 | |
| `Zlib` / `MIT OR Apache-2.0 OR Zlib` | 各 4 | |
| `BSD-3-Clause` / `Apache-2.0 OR ISC OR MIT` | 各 3 | |

其余 1-2 次的标识共 30 种，含 `CC0-1.0`、`CDLA-Permissive-2.0`、`0BSD`、`BSL-1.0`、
`MIT OR GPL-3.0-only` 等。

判定规则：SPDX 的 `OR` 只需满足其中一支，`AND` 则每支都要满足。需要注意的两项：

| crate | 表达式 | 处置 |
| --- | --- | --- |
| `unescaper` 0.1.10 | `MIT OR GPL-3.0-only` | 取 MIT 分支；GPL-3.0 分支与 `GPL-2.0-only` 冲突 |
| 2 个 crate | `MIT OR Apache-2.0 OR LGPL-2.1-or-later` | 取 MIT/Apache 分支，避开 LGPL 的动态链接义务 |

Rust 侧无 GPL-3.0 / AGPL / SSPL / BUSL / Elastic 等与 `GPL-2.0-only` 冲突的强 copyleft
依赖；`src-tauri/deny.toml` 的 `[licenses]` 放行 15 个标识，与 `check-docs.mjs` 的
`KNOWN_COMPATIBLE` 一致。

### 前端侧：产物内 395 个包 / 含 dev 共 789 个包

| 标识 | 产物内 | 含 dev |
| --- | --- | --- |
| MIT | 327 | 652 |
| ISC | 38 | 54 |
| Apache-2.0 | 8 | 29 |
| BSD-3-Clause | 8 | 14 |
| BSD-2-Clause | 1 | 10 |
| `MIT OR Apache-2.0` | 5 | 5 |
| `OFL-1.1` | 1 | 1 |
| GSAP 标准"no charge"许可 | 2 | 2 |
| `(MPL-2.0 OR Apache-2.0)` | 1 | 1 |
| `MPL-2.0` | 0 | 3 |
| `CC-BY-4.0` | 0 | 1 |
| `ODC-By-1.0` | 0 | 1 |
| `BlueOak-1.0.0` | 0 | 6 |
| `Python-2.0` | 0 | 1 |
| `CC0-1.0` | 1 | 2 |
| `Unlicense` | 1 | 1 |
| Unknown（无 SPDX 字段） | 1 | 1 |

## 必须人工留意的条目

### 随产物分发的字体

字体二进制随 Web 构建与桌面包分发，构成再分发。三个字体族的事实来源是
`src/styles/theme.css` 的 `@font-face` 与 `src/lib/fontAttributions.ts`（后者是 UI 署名
的唯一出口，由 `AboutModal` 消费），MiSans 与 Maple Mono CN 的许可原文在
`src/assets/fonts/*-LICENSE.txt`。

| 字体族 | 许可证 | 条款要点 | 本仓处置 |
| --- | --- | --- | --- |
| MiSans（4 个 woff2 子集） | MiSans Font License（小米） | ① 必须在软件中明确注明使用；② 不得改编或二次开发；③ 不得单独对外租赁、再许可、出借或进一步分发字体及其副本，也不得售卖；④ 授权可撤销、免版税 | 条件①由 About 弹窗署名满足；字体只随应用分发，不单独提供。**条件②与子集化的关系（仓库使用裁剪过的 woff2，未改字形轮廓）需法律确认，见评审记录遗留项** |
| Maple Mono CN（3 个 woff2） | SIL OFL 1.1 | 随字体提供许可文本；不得单独售卖字体；不得用保留字体名声明新的衍生字体 | 许可文本在 `src/assets/fonts/MapleMonoCN-LICENSE.txt`，署名见 About 弹窗 |
| JetBrains Mono（经 `@fontsource/jetbrains-mono` 5.3.0） | SIL OFL 1.1 | 同上 | 该包内 `LICENSE` 为 OFL 1.1 全文，但只在 `node_modules` 中，未随产物分发（见下） |

共性缺口：`src/assets/fonts/*-LICENSE.txt` 与 npm 包内的 OFL 原文**未被打包进
`dist/` 或安装包**（无代码 import 这些 `.txt`，Vite 不会复制）。OFL 要求许可文本随字体
提供，需在打包阶段补齐或在应用内提供完整文本入口。已记入评审记录遗留项。

### 其他依赖

| 对象 | 许可证 | 义务 / 风险 | 处置 |
| --- | --- | --- | --- |
| `gsap`、`@gsap/react` | GSAP Standard "no charge" license（非 SPDX、非 OSI） | 条款可能随版本变化；历史上对 Club 插件另有条件 | 版本升级时重读 https://gsap.com/standard-license 并更新本表；不得对外描述为 MIT/开源依赖 |
| `serialport` 4.10.1 | MPL-2.0 | 文件级 copyleft：若修改其源文件，修改部分须以 MPL-2.0 公开。仓库无 `[patch]` 与 vendor 目录，按 crates.io 原始源码编译 | 保持不修改；确需修改时按 MPL-2.0 公开修改文件并在此登记 |
| `dompurify` | `MPL-2.0 OR Apache-2.0` | 可取 Apache-2.0 分支 | 已取 Apache-2.0 分支 |
| `lightningcss`（构建期） | MPL-2.0 | 不进产物 | 无需动作，仅登记 |
| `khroma`（传递依赖） | MIT | `package.json` **缺 license 字段**，pnpm 报 `Unknown`；包内 `license` 文件为 MIT | 已在本文确认；不得因 `Unknown` 误判为不合规 |
| `caniuse-lite`（dev） | CC-BY-4.0 | 署名义务，且不进入产物 | 仅构建期使用，产物不含，无需随附 |
| `language-subtag-registry`（dev） | ODC-By-1.0 | 数据库许可，署名 | 同上 |
| argparse / lru-cache / minimatch 等（dev） | Python-2.0 / BlueOak-1.0.0 | 均宽松许可，不进产物 | 仅登记 |
| 各 `lissio-*` crate 自身 | `GPL-2.0-only` | 对外分发即触发源码义务 | 见 [open-source-and-ip.md](open-source-and-ip.md)「各分发形态的合规义务」 |

## 新增或升级依赖的审查流程

1. **先登记版本**。Rust 侧进 `src-tauri/Cargo.toml` 的 `[workspace.dependencies]` 后由
   成员继承（`pnpm check:deps` 强制）；前端侧进 `package.json`。
2. **查许可证**。Rust 侧用 `cargo add --dry-run` 预览后读 `cargo metadata`；前端侧读
   npm registry 的 `license` 字段，或 `pnpm licenses list --json`。
3. **对照放行策略**。Rust 侧看 `deny.toml` `[licenses]` 是否已含该标识。前端侧对照本文
   「必须人工留意的条目」判断。
4. **分类处置**：

   | 情形 | 处置 |
   | --- | --- |
   | MIT / Apache-2.0 / BSD / ISC / Zlib / 0BSD / CC0 / Unlicense | 直接引入 |
   | `MIT OR Apache-2.0` 等宽松 `OR` 表达式 | 直接引入，记录所取分支 |
   | 文件级 copyleft（MPL-2.0、EPL、CDDL）、弱 copyleft（LGPL） | 记录本表；确认不修改其源码 |
   | 单一分支 GPL / AGPL / SSPL / BUSL / Elastic / CC-BY-NC | **禁止**引入，与 `GPL-2.0-only` 分发冲突 |
   | 无 license 字段（pnpm 报 Unknown） | 打开包内 `license`/`LICENSE` 文件人工判定，结果登记本表 |
   | 非 OSI 自定义条款（GSAP 一类） | 逐版本人工阅读条款，登记本表并写明复查节点 |
5. **跑门禁**：`cargo deny check`、`pnpm check:docs`、`pnpm check:deps`。
6. **登记**：本表如有变化，在同一次文档审查记录中说明新增/移除项与理由。

## 禁止事项

- 不得为了让门禁通过而放宽 `deny.toml` 白名单；白名单变更本身需要人工评审与本文同步。
- 不得复制外部源码到本仓库而不登记来源与许可证（含 AI 生成代码中混入的第三方片段）。
- 不得移除或替换产物的许可证与第三方归属声明。
