#!/usr/bin/env node
// 颜色 / 透明度 Token 统一静态检查 — 文字符号层 (text/symbol layer)
//
// 防止组件绕过 token 散写"颜色 + 透明度"。用法: pnpm check:tokens (CI 必跑)。
//
// 规则 (作用于 src/**/*.{ts,tsx,css}, 跳过 src/types/generated):
//   1. opacity 档位 — class 串只允许:
//        opacity-0 / opacity-100            显隐动画 (textTone.ts 头注白名单)
//        opacity-{faint,subtle,disabled,muted,secondary}   档位工具类 (--opacity-* 桥接)
//      其余 opacity-NN / opacity-[...] 一律报错。
//   2. 调色板色阶 — {text,bg,border,ring,fill,stroke,divide}-<色相>-<NN> 报错:
//      色阶值来自 tailwind 默认调色板, 不随主题联动。裸色相 (text-green / bg-blue)
//      经 @theme token (--color-green …) 解析, 允许。
//   3. text-white 报错 — 白色文字一律 text-text-inverse / text-text-bright (随主题);
//      text-black / bg-white / bg-black 是固定中性色 (经 --color-black/white), 允许。
//   4. CSS 组件规则内 opacity: 必须引用 var(--alpha-*) 档位; @keyframes 动画插值
//      (0/1/0.85 之类) 与显隐语义不属 token 层, 放行。
//   5. 同步校验 — 四处单一来源必须对齐:
//        theme.css --alpha-*        ↔ textTone.ts TEXT_TONE_ALPHA (名与值)
//        theme.css --alpha-*        ↔ theme.css --opacity-* 桥接 (每个档位可成工具类)
//        textTone.ts 类名           ↔ theme.css 对应 --color-text-* token / state-* utility
//        theme.ts 语义别名          ↔ theme.css 对应 token 存在 (否则运行时注入悬空)
//
// 明确不在本层 (面/边框/阴影层, 另行推进): box-shadow 的 rgba、画布 ctx.fillStyle、
// 终端 ANSI 色。详见 docs/architecture/ui-color-tokens.md 的分层说明。

import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const errors = [];

/// tailwind 默认调色板色相 (裸色相经 @theme token, 允许; 带色阶禁止)
const HUES =
  'red|amber|yellow|green|emerald|lime|blue|sky|cyan|orange|zinc|slate|gray|stone|indigo|violet|purple|pink|rose|teal|fuchsia';
const PALETTE_SHADE = new RegExp(`\\b(?:text|bg|border|ring|fill|stroke|divide)-(?:${HUES})-\\d`);
const RAW_OPACITY = /(?<![-\w])opacity-(?!0\b|100\b)\d/;
const ARBITRARY_OPACITY = /(?<![-\w])opacity-\[/;
const TEXT_WHITE = /(?<![\w-])text-white(?![\w-])/;

/** 递归收集 src 下指定后缀的文件 */
function collect(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'generated') continue;
    const p = path.join(dir, entry.name);
    if (entry.isDirectory()) collect(p, out);
    else if (/\.(ts|tsx|css)$/.test(entry.name)) out.push(p);
  }
  return out;
}

/** 去掉整行注释 (// / /// / //! / * / /*) — 文档注释里的反例不应触发规则 */
function stripCommentLines(line) {
  const t = line.trimStart();
  return t.startsWith('//') || t.startsWith('*') || t.startsWith('/*') ? '' : line;
}

/** 去掉 @keyframes 块 (动画插值不属 token 层) */
function stripKeyframes(css) {
  let depth = 0;
  let out = '';
  let skipping = false;
  for (const ch of css) {
    if (!skipping && ch === '{') depth += 1;
    if (depth > 0) {
      if (ch === '{') skipping = true;
      if (ch === '}') {
        depth -= 1;
        if (depth === 0) skipping = false;
      }
      continue;
    }
    out += ch;
  }
  return out;
}

for (const file of collect(path.join(root, 'src'))) {
  const rel = path.relative(root, file);
  const isCss = file.endsWith('.css');
  const raw = fs.readFileSync(file, 'utf8');
  const lines = raw.split('\n');

  lines.forEach((line, i) => {
    const code = stripCommentLines(line);
    if (!code) return;
    const at = `${rel}:${i + 1}`;

    if (!isCss) {
      if (RAW_OPACITY.test(code)) {
        errors.push(`${at}  裸 opacity-NN — 用档位类 opacity-faint/subtle/disabled/muted/secondary 或 disabled:opacity-disabled (显隐动画仅 0/100)`);
      }
      if (ARBITRARY_OPACITY.test(code)) {
        errors.push(`${at}  任意值 opacity-[…] — 透明度只允许走 --alpha-* 档位`);
      }
      if (PALETTE_SHADE.test(code)) {
        errors.push(`${at}  调色板色阶 (hue-NN) 不随主题联动 — 文字用 text-text-* 语义角色, 徽标用 state-*, 底/边框用 token+透明度修饰 (bg-warning/10)`);
      }
      if (TEXT_WHITE.test(code)) {
        errors.push(`${at}  text-white 不随主题联动 — 用 text-text-inverse / text-text-bright`);
      }
    }
  });

  if (isCss && !rel.endsWith('styles/theme.css')) {
    const css = stripKeyframes(raw);
    const re = /(^|[;{\s])opacity:\s*(?!var\()([0-9]*\.?[0-9]+)/g;
    let m;
    while ((m = re.exec(css)) !== null) {
      const value = m[2];
      if (value === '0' || value === '1') continue; // 显隐语义放行
      const line = css.slice(0, m.index).split('\n').length;
      errors.push(`${rel}:${line}  裸 opacity: ${value} — 用 var(--alpha-*) 档位 (@keyframes 动画插值除外)`);
    }
  }
}

// ---------- 同步校验: 四处单一来源 ----------

const themeCss = fs.readFileSync(path.join(root, 'src/styles/theme.css'), 'utf8');
const textTone = fs.readFileSync(path.join(root, 'src/lib/ui/textTone.ts'), 'utf8');
const themeTs = fs.readFileSync(path.join(root, 'src/settings/theme.ts'), 'utf8');

/// theme.css 的 --alpha-* 档位 (名 -> 百分比数值)
const alphaTiers = {};
for (const m of themeCss.matchAll(/^\s*--alpha-([a-z]+):\s*([0-9.]+)%;/gm)) {
  alphaTiers[m[1]] = Number(m[2]);
}

/// textTone.ts TEXT_TONE_ALPHA 白名单 (名 -> 小数)
const toneBlock = textTone.match(/TEXT_TONE_ALPHA[^=]*=\s*\{([\s\S]*?)\};/);
const toneAlphas = {};
if (toneBlock) {
  for (const m of toneBlock[1].matchAll(/([a-z]+):\s*([0-9.]+),/g)) {
    toneAlphas[m[1]] = Number(m[2]) * 100;
  }
}

const tierNames = Object.keys(alphaTiers);
if (tierNames.length === 0) errors.push('theme.css 未解析到任何 --alpha-* 档位 (格式变了?)');
for (const name of tierNames) {
  if (!(name in toneAlphas)) {
    errors.push(`同步: theme.css --alpha-${name} 在 textTone.ts TEXT_TONE_ALPHA 中缺失`);
  } else if (toneAlphas[name] !== alphaTiers[name]) {
    errors.push(`同步: --alpha-${name} 值不一致 — theme.css ${alphaTiers[name]}% vs TEXT_TONE_ALPHA ${toneAlphas[name]}%`);
  }
}
for (const name of Object.keys(toneAlphas)) {
  if (!(name in alphaTiers)) {
    errors.push(`同步: TEXT_TONE_ALPHA.${name} 在 theme.css 缺少 --alpha-${name} 定义`);
  }
}

/// 每个档位必须有 --opacity-* 桥接 (否则该档位无法作为工具类使用)
const bridged = new Set([...themeCss.matchAll(/--opacity-([a-z]+):\s*var\(--alpha-/g)].map((m) => m[1]));
for (const name of tierNames) {
  if (!bridged.has(name)) errors.push(`同步: --alpha-${name} 缺少 --opacity-${name} 桥接 (theme.css @theme)`);
}

/// textTone.ts 类名 -> theme.css token / utility
/// 类名 `text-text-X` = 工具类前缀 `text-` + 色名 `text-X` → token 是 `--color-text-X`
for (const m of textTone.matchAll(/'(text-text-[a-z-]+)'/g)) {
  const varName = `--color-${m[1].replace(/^text-/, '')}`;
  if (!themeCss.includes(`${varName}:`)) {
    errors.push(`同步: textTone.ts 类名 ${m[1]} 在 theme.css 缺少 ${varName} token`);
  }
}
for (const m of textTone.matchAll(/'(state-[a-z]+)'/g)) {
  if (!themeCss.includes(`@utility ${m[1]}`)) {
    errors.push(`同步: textTone.ts 类名 ${m[1]} 在 theme.css 缺少 @utility ${m[1]} 注册 (变体写法会静默失效)`);
  }
}

/// theme.ts 语义别名 -> theme.css token 存在
const aliasBlock = themeTs.match(/SEMANTIC_TOKEN_ALIASES[^=]*=\s*\{([\s\S]*?)\n\};/);
if (!aliasBlock) {
  errors.push('同步: theme.ts 未解析到 SEMANTIC_TOKEN_ALIASES');
} else {
  for (const m of aliasBlock[1].matchAll(/'(--[a-z-]+)':/g)) {
    if (!themeCss.includes(`${m[1]}:`)) {
      errors.push(`同步: theme.ts 别名 ${m[1]} 在 theme.css 缺少定义 (运行时注入会悬空)`);
    }
  }
}

// ---------- 输出 ----------

if (errors.length > 0) {
  console.error(`check:tokens 失败 — ${errors.length} 处违规:\n`);
  for (const e of errors) console.error(`  ${e}`);
  console.error('\n规范: docs/architecture/ui-color-tokens.md | 档位单一来源: src/styles/theme.css');
  process.exit(1);
}
console.log(`check:tokens 通过 — ${tierNames.length} 个透明度档位 (${tierNames.join('/')}) 与语义 token 四处同步。`);
