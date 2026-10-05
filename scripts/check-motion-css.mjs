#!/usr/bin/env node
// 动效属性门禁 —— "动画必须留在合成器/绘制层" 从散文变成 CI 检查。用法: pnpm check:motion
//
// 为什么要有这道门禁:
//
//   1. 前端性能探针看不见布局过渡。`transition: flex-grow` 引发的每帧 flex 重排发生在
//      浏览器 C++ 里, 不经过任何 JS, 因此 setAttribute / getBoundingClientRect 这些
//      主线程计数器对它完全无感 (见 docs/performance/frontend-render-budget.md)。
//      换句话说: 性能门禁绿, 不代表没有逐帧布局。
//   2. 这类缺陷长得像一行无害的代码, 评审时看不出代价, 也不会让任何既有测试变红。
//      只有把"哪些属性可以过渡"变成可执行的白名单, 才谈得上防回归。
//
// 检查面 (三类写法都要覆盖, 因为 Tailwind 的 arbitrary 值能绕过纯 CSS 扫描):
//   - src/**/*.css 的 `transition` / `transition-property` 声明
//   - src/**/*.css 的 `@keyframes` 帧内属性
//   - src/**/*.{ts,tsx} 的 `transition-[...]` / `transition-all` 工具类与内联
//     `transition` / `transitionProperty`
//
// 豁免: 见下方 EXEMPTIONS 登记表。豁免是公开的、逐条写明理由的, 新增一条等于承认
// 一次有意的例外, 评审时看得见; 没有登记的一律报错。

import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const SRC = path.join(root, 'src');
const errors = [];

/**
 * 过渡 / 关键帧里允许出现的属性: 全部只触发绘制或合成, 不让浏览器重新布局。
 *
 * 判定口径是"改这个属性会不会让浏览器重排", 不是"看起来贵不贵" —— 后者无法检查。
 * `background` 走的是 shorthand 插值: 本仓只在无 background-image 的纯色底上用它,
 * 属于绘制层; 一旦某天给它配上渐变, 这条豁免就该被收回。
 */
const COMPOSITOR_SAFE = new Set([
  'transform',
  'opacity',
  'visibility',
  'filter',
  'backdrop-filter',
  '-webkit-backdrop-filter',
  'color',
  'fill',
  'stroke',
  'stroke-dasharray',
  'stroke-dashoffset',
  'background',
  'background-color',
  'background-image',
  'border-color',
  'border-style',
  'border-image',
  'outline-color',
  'outline-style',
  'box-shadow',
  'text-shadow',
  'text-decoration-color',
  'caret-color',
  'accent-color',
  'column-rule-color',
]);

/** 时间值与缓动关键字: 出现在 transition 值里时不是属性名。 */
const TIMING_KEYWORDS = new Set([
  'linear',
  'ease',
  'ease-in',
  'ease-out',
  'ease-in-out',
  'step-start',
  'step-end',
  'allow-discrete',
]);

/**
 * 有意的例外。每条必须同时回答两件事: 是什么, 以及为什么这里的逐帧布局是有界的。
 *
 * 这张表就是"允许在布局层做动画"的完整清单 —— 它应该短。变长说明该改动画方案,
 * 而不是该加豁免。
 *
 * `clip-path` 不在白名单里, 但也不在这里: 它本身是绘制层属性, 只是作用在**祖先**上
 * 会让后代的 backdrop-filter 静默失效(元素成为自己的 Backdrop Root)。这条约束只能靠
 * "作用域限定到具体文件"来表达, 放行整个仓库等于把这道防线的钥匙挂在门把上。
 */
const EXEMPTIONS = [
  {
    file: 'src/components/onboarding/TourSpotlight.tsx',
    properties: /^(?:left|top|width|height|x|y)$/,
    reason: '新手引导聚光灯: 单个无子元素的 fixed 覆盖盒, 逐帧布局只作用于这一个空盒; 且仅在引导打开期间运行。它必须跟随任意 DOM 矩形, 没有等价的 transform 表达。',
  },
  {
    file: 'src/components/widgets/progress/ProgressBarWidget.tsx',
    properties: /^clip-path$/,
    reason: '填充块满尺寸 + clip-path 裁占比: 绘制层属性, 且是替代 width/height 过渡的那条路径本身。作用域限定在本文件 —— 它挂在 widget 卡片内部, 不在任何 backdrop-filter 表面之下。',
  },
  {
    file: 'src/components/NotificationToasts.tsx',
    properties: /^max-height$/,
    reason: '消息展开/收起要表达的是**文本换行行数**的变化, 而换行只能由布局算出来; transform 无法改变盒子的高度, scaleY 会把文字压扁。这里逐帧重排的范围是一个 max-height 4.5em 的通知正文, 且只在用户点击时运行。',
  },
];

/** 递归收集 src 下指定后缀的文件 (跳过生成物)。 */
function collect(dir, extensions, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'generated') continue;
    const p = path.join(dir, entry.name);
    if (entry.isDirectory()) collect(p, extensions, out);
    else if (extensions.some((ext) => entry.name.endsWith(ext))) out.push(p);
  }
  return out;
}

function relative(file) {
  return path.relative(root, file).split(path.sep).join('/');
}

/** 顶层逗号切分 —— 函数内部的逗号不是分隔符。 */
function splitTopLevel(value) {
  const parts = [];
  let depth = 0;
  let buffer = '';
  for (const ch of value) {
    if (ch === '(') depth += 1;
    else if (ch === ')') depth -= 1;
    if (ch === ',' && depth === 0) {
      parts.push(buffer);
      buffer = '';
      continue;
    }
    buffer += ch;
  }
  parts.push(buffer);
  return parts.map((part) => part.trim()).filter(Boolean);
}

/**
 * 从一段 transition 值里取出属性名。
 *
 * 逐 token 跳过时间、倍数、缓动关键字与函数 (var/cubic-bezier/steps), 剩下的第一个
 * 裸标识符就是属性名 —— 这正是 CSS transition 简写的语法位置。自定义属性返回原样,
 * 交给调用方报错: 未注册的自定义属性根本不可过渡, 写了等于没写。
 */
function propertyOf(part) {
  for (const token of part.split(/\s+/)) {
    if (!token || token === '!important') continue;
    if (/^-?[\d.]+(?:m?s)?$/.test(token)) continue;
    if (token.startsWith('--')) return token;
    if (/^[a-z-]+\(/i.test(token)) continue;
    if (TIMING_KEYWORDS.has(token.toLowerCase())) continue;
    return token;
  }
  return null;
}

function isExempt(file, property) {
  return EXEMPTIONS.some(
    (entry) => entry.file === relative(file) && entry.properties.test(property)
  );
}

function report(file, line, property, why) {
  errors.push(`${relative(file)}:${line}  ${property} — ${why}`);
}

/** 去掉块注释与整行注释, 但保持行数不变, 让行号仍然可用。 */
function stripComments(source) {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, (block) => block.replace(/[^\n]/g, ' '))
    .split('\n')
    .map((line) => (/^\s*(?:\/\/|\/\*|\*)/.test(line) ? '' : line))
    .join('\n');
}

function lineOf(source, index) {
  return source.slice(0, index).split('\n').length;
}

// ---------- CSS ----------

/** 取出所有 @keyframes 的名字与函数体, 并把它们从源码里摘掉, 避免重复扫描。 */
function extractKeyframes(css) {
  const blocks = [];
  const pattern = /@keyframes\s+([\w-]+)\s*\{/g;
  let match = pattern.exec(css);
  while (match !== null) {
    let depth = 1;
    let cursor = pattern.lastIndex;
    while (cursor < css.length && depth > 0) {
      if (css[cursor] === '{') depth += 1;
      else if (css[cursor] === '}') depth -= 1;
      cursor += 1;
    }
    blocks.push({
      name: match[1],
      offset: pattern.lastIndex,
      body: css.slice(pattern.lastIndex, cursor - 1),
    });
    pattern.lastIndex = cursor;
    match = pattern.exec(css);
  }
  const stripped = css.replace(/@keyframes\s+[\w-]+\s*\{[\s\S]*?\n\}/g, (block) =>
    block.replace(/[^\n]/g, ' ')
  );
  return { blocks, stripped };
}

function checkCss(file) {
  const raw = fs.readFileSync(file, 'utf8');
  const css = stripComments(raw);
  const { blocks, stripped } = extractKeyframes(css);

  if (blocks.length === 0 && !/transition/.test(css)) return;

  // @keyframes 帧内属性
  for (const block of blocks) {
    for (const match of block.body.matchAll(/(?:^|[;{])\s*([a-zA-Z-]+)\s*:/g)) {
      const property = match[1];
      if (COMPOSITOR_SAFE.has(property) || isExempt(file, property)) continue;
      report(file, lineOf(css, block.offset + match.index), property, '@keyframes 里只能插值绘制层属性');
    }
  }

  // transition / transition-property 声明
  for (const match of stripped.matchAll(/(?:^|[;{])\s*(transition(?:-property)?)\s*:\s*([^;]+)/g)) {
    const declarationStart = match.index + match[0].indexOf(match[2]);
    for (const part of splitTopLevel(match[2])) {
      if (part === 'none' || part === 'initial' || part === 'unset') continue;
      const property = propertyOf(part);
      if (property === null) continue;
      if (COMPOSITOR_SAFE.has(property) || isExempt(file, property)) continue;
      report(
        file,
        lineOf(stripped, declarationStart),
        property,
        `逐帧过渡会触发布局; 改用 transform/opacity, 或在 check-motion-css.mjs 的 EXEMPTIONS 里登记理由`
      );
    }
  }
}

// ---------- TS / TSX ----------

/** Tailwind arbitrary 值里 `_` 代表空格。 */
function normalizeArbitrary(value) {
  return value.replace(/_/g, ' ').trim();
}

function checkScript(file) {
  const source = stripComments(fs.readFileSync(file, 'utf8'));
  if (!/transition/i.test(source)) return;

  // Tailwind 工具类: transition-[width] / transition-[background,box-shadow]
  for (const match of source.matchAll(/(?<![\w-])transition-\[([^\]"'\s]+)\]/g)) {
    for (const raw of match[1].split(',')) {
      const property = normalizeArbitrary(raw);
      if (property === '') continue;
      if (COMPOSITOR_SAFE.has(property) || isExempt(file, property)) continue;
      report(file, lineOf(source, match.index), property, 'transition-[...] 逐帧过渡会触发布局; 改用 transform/opacity');
    }
  }

  // transition-all: 把当前和未来所有可动画属性纳入过渡, 布局属性迟早混进来
  for (const match of source.matchAll(/(?<![\w-])transition-all(?![\w-])/g)) {
    report(file, lineOf(source, match.index), 'transition-all', '禁止使用; 显式列出属性, 避免布局属性被顺带过渡');
  }

  // 内联样式: transition / transitionProperty
  for (const match of source.matchAll(/(?<![\w-])transition(?:-property)?\s*:\s*([`'"](?:[^`'"]*)[`'"])/g)) {
    const value = match[1].slice(1, -1);
    for (const part of splitTopLevel(value)) {
      const property = propertyOf(part);
      if (property === null) continue;
      if (COMPOSITOR_SAFE.has(property) || isExempt(file, property)) continue;
      report(file, lineOf(source, match.index), property, '内联 transition 逐帧过渡会触发布局; 改用 transform/opacity, 或登记豁免');
    }
  }
}

// ---------- 遍历 ----------

for (const file of collect(SRC, ['.css'])) checkCss(file);
for (const file of collect(SRC, ['.ts', '.tsx'])) checkScript(file);

if (errors.length > 0) {
  console.error(`动效属性门禁失败 (${errors.length} 项):\n`);
  for (const line of errors) console.error(`  ${line}`);
  console.error('\n逐帧过渡布局属性的代价不会出现在任何既有测试里, 需要在这里拦住。');
  process.exit(1);
}

console.log('动效属性门禁通过: 过渡与关键帧只涉及绘制层属性。');
