# 字体与许可

Lissio 前端不依赖系统字体渲染主界面:全部字形随应用分发,离线可用、跨平台一致。
本文件记录**每个内置字体的来源、许可和再分发依据**,以及新增字体时必须遵守的合规约束。

## 内置字体

| 字体族 | 用途 | 许可 | 版权方 | 随包文件 |
| --- | --- | --- | --- | --- |
| `GoMono Nerd Font Mono` | UI 与代码区的拉丁/希腊/西里尔字形 + Nerd Fonts 图标 | BSD-3-Clause | © 2016 Bigelow & Holmes Inc.(Go Mono);Nerd Fonts 补丁为 MIT | `GoMonoNerdFontMono-{Regular,Bold,Italic}.woff2` |
| `Clear Han Serif`(屏显臻宋) | UI 中文首选字形(宋体) | SIL OFL 1.1 | © chncwk,衍生自思源宋体(© Adobe,OFL 1.1) | `ClearHanSerif-Regular.woff2` |
| `Maple Mono CN` | 代码/数据区中文兜底(2:1 等宽) | SIL OFL 1.1 | © 2022 The Maple Mono Project Authors | `MapleMonoCN-{Regular,Medium,Bold}.woff2` |
| `JetBrains Mono` | 缺字兜底(@fontsource) | SIL OFL 1.1 | © JetBrains | 由 `@fontsource/jetbrains-mono` 提供 |

许可原文逐字保留在 `src/assets/fonts/*-LICENSE.txt`;每个 woff2 内部的版权(name ID 0)
与许可(name ID 13/14)记录在子集化后依然完整,满足 OFL 1.1 与 BSD-3 对再分发的署名要求。

## 字体栈

`--font-ui` 与 `--font-mono` 定义在 `src/styles/theme.css`,运行时默认值同时在
`src/settings/defaults.ts`(用户可在设置中覆盖)。

- `--font-ui`:GoMono(拉丁) → 屏显臻宋(中文) → Maple Mono CN → JetBrains Mono → 系统字体
- `--font-mono`:GoMono(拉丁) → Maple Mono CN(中文,保持 2:1 等宽对齐)→ 屏显臻宋 → JetBrains Mono

代码/数据区把 Maple Mono CN 放在屏显臻宋之前是刻意的:屏显臻宋是比例宋体,用它承载代码里的
中文会破坏等宽对齐;UI 区则以屏显臻宋为先。

GoMono 只随包 Regular/Bold/Italic:Go Mono 上游无 Medium,`font-weight: 500` 按 CSS 字体匹配
规则回落到 400;屏显臻宋上游仅有单一字重,中文粗体由浏览器合成。

## 合规约束

- **只允许内置可再分发许可的字体**:OFL 1.1、BSD-3、Apache-2.0 等允许随软件再分发的许可。
- **禁止把商用授权字体提交进仓库**。典型如方正屏显雅宋——由方正字库(字加网)按商用授权销售,
  本仓库以 GPL-2.0-only 分发,打包这类字体构成未授权再分发,会连带下游使用者。
  使用者若自行向方正取得授权并安装到本机,可由字体栈自然回退命中,**但字体文件不得入仓**。
- 注意同名不同源:本仓库内置的「屏显臻宋」是 chncwk 基于思源宋体制作、以 OFL 1.1 发布的字体,
  与方正字库的同名/近名商用字体无关;引入字体前必须核对**字体文件内嵌的许可记录**
  (name ID 13/14)与发布方,而不是只看字体名。
- 新增内置字体时:同步放入 `src/assets/fonts/`,补一份 `<字体名>-LICENSE.txt` 许可原文,并在上表登记。
- 子集化不得修改字形轮廓,且必须保留字体内部的版权与许可记录(见下)。

## 重新生成子集

内置 woff2 均为子集,以控制安装包体积(完整屏显臻宋 6.6 MB → GB2312 子集 1.6 MB)。
重新生成需要 `fonttools` 与 `brotli`:

```bash
pip install fonttools brotli

# 中文: GB2312 + ASCII/拉丁 + 常用标点/全角字符
pyftsubset Clear-Han-Serif.ttf \
  --text-file=charset.txt --flavor=woff2 --output-file=ClearHanSerif-Regular.woff2 \
  --name-IDs='*' --name-languages='*' --notdef-outline --recommended-glyphs --drop-tables+=DSIG

# 拉丁 + 全套 Nerd Fonts 图标 (PUA): 对 Regular/Bold/Italic 各跑一次
pyftsubset GoMonoNerdFontMono-Regular.ttf \
  --text-file=gomono-charset.txt --flavor=woff2 --output-file=GoMonoNerdFontMono-Regular.woff2 \
  --name-IDs='*' --name-languages='*' --notdef-outline --recommended-glyphs --drop-tables+=DSIG
```

`--name-IDs='*'` 是合规关键:它保留 name ID 0(版权)与 13/14(许可),缺省子集化会丢掉它们。
`--drop-tables+=DSIG` 用于丢弃原始字体中已失效的数字签名表。

中文字形覆盖 GB2312 全集(6763 汉字)。超出子集范围的生僻字会按字体栈回退到系统字体,
与改动前 Maple Mono CN 的覆盖范围一致。

## 相关源码位置

- `src/styles/theme.css` — `@font-face` 声明与 `--font-ui` / `--font-mono` 默认值
- `src/settings/defaults.ts` — 可持久化的字体设置默认值
- `src/settings/applyTheme.ts` — 把设置写入 `:root` 与 `body`
- `src/store/settingsStore.ts` — 旧默认字体值的升级迁移(`LEGACY_DEFAULT_*_FONTS`)
