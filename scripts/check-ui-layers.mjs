#!/usr/bin/env node
// 前端分层门禁 —— "实现层 / 交互层 / 效果层 / 视图层" 的依赖方向从散文变成 CI 检查。
// 用法: pnpm check:layers
//
// 为什么要有这道门禁:
//
//   1. 前端的分层一直只靠注释和评审维持。`docs/architecture/architecture-review-2026-09.md`
//      的"前端仍有大文件"是唯一一条前端架构债务, 全文没有分层模型; 而
//      `pnpm check:architecture` / `check:deps` 只管 Rust, 前端结构没有任何机器约束。
//   2. 反向依赖不会让任何既有测试变红, 也不会报错 —— 它只是让下一次改动多一层惊讶。
//      例如 `widgets/` 去 import `displays/` 的一个状态条组件, 单看那一行完全合理,
//      代价却要等到有人想单独复用控件层时才出现。
//   3. 依赖方向一旦可以自由反向, "注册表 / 绑定 / 原语"就会被视图里的实现细节污染,
//      统一范式也就无从谈起。所以方向必须是可执行的, 不是倡议。
//
// 检查面: src 下所有 .ts/.tsx 的模块说明符 (静态 import / export from / 动态
// import() / require)。解析相对路径后按目录前缀判定, 不做类型层分析 —— 门禁要能在
// 任何一次提交里跑, 而不是只在 IDE 里成立。
//
// 豁免: 见下方 EXEMPTIONS 登记表。豁免是公开的、逐条写明理由的, 新增一条等于承认
// 一次有意的例外; 没有登记的一律报错。**违规的修法是改代码, 不是加豁免。**

import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const SRC = path.join(root, 'src');
const errors = [];

/**
 * 分层规则。`files` 命中被检查的文件, `forbid` 命中禁止依赖的目标目录。
 *
 * 方向只有一个: 视图 → 效果 → 交互 → 实现。每条规则都对应
 * `docs/architecture/ui-layers.md` 里的一行, 规则号一致。
 */
const RULES = [
  {
    id: 'L1',
    files: /^src\/components\/(?:ui|brand)\//,
    forbid: /^src\/components\/(?:common|nodes|layout|onboarding|panels|acquisition|displays|widgets|ai)\//,
    why: '基础件 (ui / brand) 不得依赖任何领域目录 — 它们要被所有层复用, 反向依赖会让基础件随业务变形',
  },
  {
    id: 'L2',
    files: /^src\/components\/(?:ui|brand)\//,
    forbid: /^src\/store\//,
    why: '基础件靠 props 变纯, 不直读 store — 直读会让"基础"与"全局状态形状"绑死, 且无法在测试里单独渲染',
  },
  {
    id: 'L3',
    files: /^src\/components\/widgets\//,
    forbid: /^src\/components\/(?:panels|displays|layout|acquisition|nodes|ai)\//,
    why: '控件是叶子内容层 — 它只能被面板注册表引用, 不得反过来引用面板 / 显示层, 否则控件无法离开完整应用外壳复用',
  },
  {
    id: 'L4',
    files: /^src\/store\//,
    forbid: /^src\/components\//,
    why: 'store 是实现层 — 一旦依赖视图, "控件 → 窗口面板 → store" 链路就会把整个显示层拖进状态模块, 直接制造循环',
  },
  {
    id: 'L5',
    files: /^src\/lib\/(?:motion|glass)\//,
    forbid: /^src\/store\//,
    why: '效果层只依赖实现层的数据形状, 不订阅 store — 效果层要能被任何一层按参数调用, 订阅状态会让它无法在非应用环境复用',
  },
  {
    id: 'L6',
    files: /^src\/lib\/(?:interaction|hooks)\//,
    forbid: /^src\/components\//,
    why: '交互层是输入 → 意图的纯映射, 不认识组件树 — 一旦引用视图, 手势原语就无法脱离具体组件',
  },
  {
    id: 'L7',
    files: /^src\/.*\.tsx?$/,
    forbid: null,
    why: 'JS 侧只有 lib/motion 可以写 will-change / transitionProperty — 合成层晋升必须经过 promote() 的引用计数, 手写等于永久占据合成层且无人归还',
  },
  {
    id: 'L8',
    files: /^src\/lib\/(?:rpc|platform|tauri|data|buffers|models|utils|panels)\//,
    forbid: /^src\/components\//,
    why: '实现层不得依赖视图 — 反过来把视图细节拖进实现层, 会让请求 / 缓冲 / 目录这些纯模块带上渲染依赖',
  },
  {
    id: 'L9',
    files: /^src\/styles\/components\/dialog\.css$/,
    forbid: null,
    why: '遮罩的层级只能来自调用方传入的桥接类 — 基础规则自带 z-index 会静默盖掉它',
  },
  {
    id: 'L10',
    files: /^src\/lib\/(?:motion|glass)\//,
    forbid: /^src\/components\//,
    why: '效果层不得认识视图 — 它要能被任何一层按参数调用 (测试、文档生成、非应用环境), 引用组件会让"这段动画能不能单独跑"变成要读整棵组件树才能回答的问题',
  },
  {
    id: 'L11',
    files: /^src\/lib\/(?:interaction|hooks)\//,
    forbid: /^src\/lib\/(?:motion|glass)\//,
    why: '交互层只产出意图, 不认识动画 — 手势说"松手速度是多少", 效果层决定"因此滑多远、滑多久"。反过来让手势去调弹簧, 判定低动画偏好、翻译令牌这些纯动画的事就会住进输入处理里, 断言手势的测试也不得不同时准备动画环境',
  },
];

/**
 * 有意的例外。每条必须同时回答: 是什么, 以及为什么这里的方向反转是有界的。
 *
 * 这张表就是"允许反向依赖"的完整清单 —— 它应该短。变长说明该改依赖, 而不是该加豁免。
 *
 * `movable: true` 表示这是**放错位置**而非真正需要反向依赖: 目标目录本身是纯数据/纯
 * 函数, 只是被摆在了视图侧。搬迁即可消除, 不需要新的抽象。
 */
const EXEMPTIONS = [
  {
    file: 'src/components/ui/ContextMenu.tsx',
    rule: 'L2',
    reason: '全局浮层单例: 它渲染的就是 contextMenuStore 的内容, 没有 props 可传 (与 DockDragGhost 订阅 dockDrag 同构)。它是"视图直接绑一个 UI 单例"的边界, 不是通用基础件。',
  },
  {
    file: 'src/lib/utils/connectionRules.ts',
    rule: 'L8',
    reason: '节点的连接规则必须与 nodes/registry 的端口声明同源, 否则两处会各自漂移出不同的合法连接集合。',
  },
];

/**
 * JS 侧禁止手写的合成层 / 过渡控制属性 (L7)。
 *
 * 三种写法都要覆盖, 否则门禁只挡住最老实的那个:
 *   - `el.style.willChange = 'transform'`  (赋值)
 *   - `{ willChange: 'transform' }`        (对象字面量)
 *   - `el.style.setProperty('will-change', …)`  (字符串参数)
 * `transitionProperty` 的 camelCase 拼写尤其重要 —— `check:motion` 的内联正则
 * 只认 `transition` / `transition-property` 后接冒号, 曾经整个漏掉这个拼法。
 */
const FORBIDDEN_MOTION_WRITES = [
  { pattern: /(?<![\w-])will-?[Cc]hange['"]?\s*[:=]/g, name: 'will-change / willChange' },
  { pattern: /(?<![\w-])transition-?[Pp]roperty['"]?\s*[:=]/g, name: 'transition-property / transitionProperty' },
];

/** 模块说明符: 静态 import / export from / 动态 import() / require()。 */
const IMPORT_RE = /(?:\bfrom\s*|\bimport\s*\(\s*|\brequire\s*\(\s*|\bimport\s+)['"]([^'"]+)['"]/g;

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

/** 去掉块注释与整行注释, 保持行数不变。 */
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

/**
 * 把相对说明符解析成 src 相对路径 (不带扩展名)。
 *
 * 只处理相对路径: 裸包名 (@tauri-apps/*, react, …) 的归属由
 * `check:web-contract` 负责, 这里不重复判定。
 */
function resolveSpecifier(fromFile, specifier) {
  if (!specifier.startsWith('.')) return null;
  const resolved = path.resolve(path.dirname(fromFile), specifier);
  let rel = path.relative(root, resolved).split(path.sep).join('/');
  // `../lib/motion` 这种目录导入由 index.ts 兜底; 去掉扩展名后统一比较前缀。
  rel = rel.replace(/\.(?:tsx?|css|json)$/, '');
  return rel;
}

function isExempt(file, ruleId) {
  return EXEMPTIONS.some((entry) => entry.file === file && entry.rule === ruleId);
}

function report(file, line, message) {
  errors.push(`${file}:${line}  ${message}`);
}

function checkImports(file, source) {
  const rel = relative(file);
  const seen = new Set();
  for (const rule of RULES) {
    if (rule.forbid === null) continue;
    if (!rule.files.test(rel)) continue;
    if (isExempt(rel, rule.id)) continue;

    for (const match of source.matchAll(IMPORT_RE)) {
      const target = resolveSpecifier(file, match[1]);
      if (target === null) continue;
      // 目录导入 (`../motion` → `src/lib/motion`) 解析结果不带尾斜杠, 而规则里的
      // `dir/` 前缀要求它 —— barrel 写法因此整条绕过规则。两种形态都要试:
      // `src/lib/motion` 与 `src/lib/motion/release` 必须得到同一个判定。
      if (!rule.forbid.test(target) && !rule.forbid.test(`${target}/`)) continue;
      // 同一目标的重复 import 只报一次, 免得一份文件刷满屏。
      const key = `${rule.id}|${target}`;
      if (seen.has(key)) continue;
      seen.add(key);
      report(rel, lineOf(source, match.index), `[${rule.id}] 不得依赖 ${target} — ${rule.why}`);
    }
  }
}

function checkMotionWrites(file, source) {
  const rel = relative(file);
  if (/^src\/lib\/motion\//.test(rel)) return;
  const rule = RULES.find((entry) => entry.id === 'L7');
  if (!rule.files.test(rel) || isExempt(rel, 'L7')) return;

  for (const { pattern, name } of FORBIDDEN_MOTION_WRITES) {
    for (const match of source.matchAll(pattern)) {
      report(
        rel,
        lineOf(source, match.index),
        `[L7] 手写 ${name} — ${rule.why} (合成层晋升走 src/lib/motion 的 promote()/release())`
      );
    }
  }
}

/**
 * L9 — 遮罩基础规则不得自带 z-index。
 *
 * `.dialog-overlay` 与 `.z-*` 桥接类都是未分层 CSS、特异性同为 (0,1,0), 于是**后出现的
 * 整体胜出**。基础规则里留一个 `z-index`, 调用方传的 `zClassName` 就被静默盖掉 ——
 * 属性确实传了、类也确实挂上了, 只有层高不对: `--z-modal-secondary` (110) 与
 * `--z-tour` (1100) 一起退化成 100, 比 `@xyflow/react` 的选中节点 (1000) 还低,
 * 引导遮罩会被节点穿透。这条失效不会让任何测试变红, 浏览器里也不会报错。
 *
 * 所以层级只允许来自显式桥接类 (layers.css), 遮罩自己不给默认值。
 */
function checkOverlayZIndex() {
  const rel = 'src/styles/components/dialog.css';
  const file = path.join(root, rel);
  if (!fs.existsSync(file)) return;
  const css = stripComments(fs.readFileSync(file, 'utf8'));
  for (const match of css.matchAll(/\.dialog-overlay\s*\{([^}]*)\}/g)) {
    if (!/(?:^|;)\s*z-index\s*:/.test(match[1])) continue;
    report(
      rel,
      lineOf(css, match.index),
      '[L9] `.dialog-overlay` 不得声明 z-index — 它会静默盖掉调用方传入的 `zClassName` ' +
        '(`.z-tour` 1100 / `.z-modal-secondary` 110 一起退化成 100); 层级只从 layers.css 的桥接类来'
    );
  }
}

for (const file of collect(SRC, ['.ts', '.tsx'])) {
  const rel = relative(file);
  // 测试可以横跨分层: 夹具与断言本就需要同时看见两侧, 约束的是生产代码的方向。
  // 与 check-ui-tokens.mjs 的 500 行上限采用同一口径。
  if (rel.includes('__tests__') || /\.(?:test|spec)\.tsx?$/.test(rel)) continue;
  const source = stripComments(fs.readFileSync(file, 'utf8'));
  checkImports(file, source);
  checkMotionWrites(file, source);
}

checkOverlayZIndex();

if (errors.length > 0) {
  console.error(`前端分层门禁失败 (${errors.length} 项):\n`);
  for (const line of errors) console.error(`  ${line}`);
  console.error(
    '\n依赖方向反转不会让任何既有测试变红, 只会让下一次改动多一层惊讶; 需要在这里拦住。\n' +
      '修法是改依赖, 不是加豁免 —— 确属有界的例外请在 EXEMPTIONS 里登记理由。'
  );
  process.exit(1);
}

const movable = EXEMPTIONS.filter((entry) => entry.movable).length;
console.log(
  `前端分层门禁通过: ${RULES.length} 条规则无违规; ` +
    `豁免 ${EXEMPTIONS.length} 条 (其中 ${movable} 条是摆错位置、搬迁即可消除)。`
);
