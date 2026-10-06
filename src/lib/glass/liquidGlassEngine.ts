//! liquidGL 引擎桥接 — 折射档的加载、装配与降级
//!
//! liquidGL 是一支 300KB 的单文件 ESM 库, 只有 default 导出, 不带类型声明,
//! 且**必须用 CSS 选择器**作为 target (内部走 document.querySelectorAll)。
//! 这三点决定了本文件的全部结构:
//!
//!   1. 不带类型 → 我们用到的子集声明在 src/types/vendor.d.ts, 与其它无类型
//!      依赖 (turndown-plugin-gfm) 同一处; 上游改名时只改那一处。
//!   2. 只吃选择器 → 引擎给每个透镜发一个**一次性唯一类名**, 用该类名装配;
//!      元素卸载时销毁并把类名退回池中。不走全局 tag 选择器, 避免把无关
//!      元素一起玻璃化。
//!   3. 共享画布按 (snapshot, anchor, zIndex) 分组 → 全应用统一 zIndex 且
//!      统一挂 body 之下, 因此所有透镜共用一张画布, 这是它性能设计的意图。
//!
//! **降级链**: WebGPU → WebGL2 → WebGL1 → CSS backdrop-filter。这条链由库
//! 自己走完; 本文件额外负责"库整个都拿不到"的情形 (如无 GPU 的虚拟桌面),
//! 此时后端标记为不可用, glassTier 会把档位退到 blur —— 用户看到的是与
//! 引入液态玻璃之前完全一样的画面, 而不是一块空白。

import type { LiquidGLLens, LiquidGLOptions } from 'liquid-gl';

type LiquidGLFactory = (options: LiquidGLOptions) => LiquidGLLens | LiquidGLLens[] | undefined;

interface LiquidGLModule {
  default: LiquidGLFactory;
}

export type { LiquidGLLens };

/**
 * 透镜的 zIndex 一律交给库自己从 DOM 推导 (不传 zIndex)。
 *
 * 库把画布定位在 `目标 zIndex - 1`, 并把画布插到目标祖先链**之前**, 靠
 * "同层时 DOM 顺序决定谁在上" 让目标盖住画布。这套机制成立的前提是画布
 * 与目标同处一个层叠上下文、且只低一层。
 *
 * 传一个全局常量会同时破坏这两条: 画布被抬到所有浮层之上, 于是一块画布
 * 盖住整个界面 (目标内容连同文字一起消失), 而不是只盖住该折射的那块玻璃。
 * 曾用 1000 换来过这个现象 —— 比"折射看起来不对"严重得多。
 *
 * 不传则库按 `effectiveZ(元素)` 取真实层叠值, 画布落在目标下一层, 正确。
 * 代价是同一时刻打开的浮层若分属不同 z 层级 (modal / toast), 会有多张
 * 画布 —— 这正是它们本来的层叠关系所要求的, 不是浪费。
 */

/** 透镜类名池。用一次性类名而非全局 tag 选择器, 避免误伤无关元素。 */
const lensClassPool: string[] = [];
let lensClassCounter = 0;
function acquireLensClass(): string {
  const reused = lensClassPool.pop();
  if (reused !== undefined) return reused;
  lensClassCounter += 1;
  return `liquid-glass-lens-${lensClassCounter}`;
}
function releaseLensClass(name: string): void {
  lensClassPool.push(name);
}

/** 装配参数。role 只用于日志与将来按角色微调, 当前所有折射角色共用同一套参数。 */
export interface LensMountRequest {
  role: 'floating' | 'transient';
  /** 已按预设 + 强度解析好的折射参数 */
  refraction: number;
  bevelDepth: number;
  bevelWidth: number;
  frost: number;
  aberration: number;
  specular: boolean;
  tint: string | null;
}

interface MountedLens {
  className: string;
  lens: LiquidGLLens;
}

let modulePromise: Promise<LiquidGLFactory | null> | null = null;
let backendAvailable: boolean | null = null;
const mounted = new Map<HTMLElement, MountedLens>();
const subscribers = new Set<(available: boolean) => void>();

/**
 * 后端可用性 — 供 glassTier 判定。
 *
 * 首次调用时才探测 (要 import 库、要建测试画布), 之后缓存。探测失败不抛错:
 * 返回 false 即让全应用停在 blur 档。
 */
export async function probeLiquidGLBackend(): Promise<boolean> {
  if (backendAvailable !== null) return backendAvailable;
  const factory = await loadFactory();
  backendAvailable = factory !== null;
  for (const notify of subscribers) notify(backendAvailable);
  return backendAvailable;
}

/// 订阅后端可用性 — 档位需要在"后端稍后才探测出不可用"时重新判定。
export function subscribeBackend(onChange: (available: boolean) => void): () => void {
  subscribers.add(onChange);
  return () => {
    subscribers.delete(onChange);
  };
}

async function loadFactory(): Promise<LiquidGLFactory | null> {
  // 三种运行环境都走同一条动态 import: Vitest (jsdom, 无 GPU)、纯浏览器 dev
  // (无 Tauri 后端)、Tauri 生产包。差异不在解析而在**库拿到后自己能否建上下文**
  // —— 库内部对无 GPU 的情形会退到 CSS backdrop-filter 分支, 对本模块而言
  // 那也算"装配成功", 因为 CSS 回退产出的观感就是高斯模糊档, 与档位判定
  // 退回 blur 的结果一致。
  try {
    const mod: LiquidGLModule = await import('liquid-gl');
    return typeof mod.default === 'function' ? mod.default : null;
  } catch (error) {
    console.warn('[glass] liquidGL 加载失败, 折射档不可用, 退回高斯模糊:', error);
    return null;
  }
}

function ensureFactory(): Promise<LiquidGLFactory | null> {
  modulePromise ??= loadFactory();
  return modulePromise;
}

function toLens(result: LiquidGLLens | LiquidGLLens[] | undefined): LiquidGLLens | null {
  if (!result) return null;
  return Array.isArray(result) ? (result[0] ?? null) : result;
}

/**
 * 给元素装配透镜。返回是否成功 —— 失败时元素保持 blur 档, 无需回滚。
 *
 * 幂等: 同一元素重复调用时先卸载旧透镜, 因此参数变化 (换预设 / 拖强度滑块)
 * 可以直接重跑本函数, 不需要调用方先卸载。
 */
export async function mountLens(el: HTMLElement, request: LensMountRequest): Promise<boolean> {
  unmountLens(el);
  const factory = await ensureFactory();
  if (factory === null) return false;
  // 库要求 target 已挂载且可被 querySelectorAll 命中
  if (!el.isConnected) return false;

  const className = acquireLensClass();
  el.classList.add(className);

  let lens: LiquidGLLens | null;
  try {
    lens = toLens(
      factory({
        engine: 'auto',
        snapshot: 'body',
        target: `.${className}`,
        resolution: 2,
        // zIndex 刻意不传 —— 见文件头 SHARED 的替代说明
        refraction: request.refraction,
        aberration: request.aberration,
        bevelDepth: request.bevelDepth,
        bevelWidth: request.bevelWidth,
        frost: request.frost,
        shadow: true,
        specular: request.specular,
        // 进场动画交给既有的 motion 体系 (useMotionPresence), 这里必须关掉,
        // 否则一个元素会同时被两套动画驱动
        reveal: 'none',
        // 指针跟随: fluid 模式让表面朝指针位移并回弹。不用 tilt —— 对话框
        // 跟着鼠标转角度在桌面工具里是干扰, 且 tilt 每个透镜会多生成一张镜像画布。
        tilt: false,
        interaction: 'fluid',
        interactionStrength: 0.5,
        interactionRadius: 0.35,
        interactionViscosity: 0.65,
        magnify: 1,
        tint: request.tint,
      }),
    );
  } catch (error) {
    console.warn('[glass] liquidGL 装配失败, 该表面退回高斯模糊:', error);
    el.classList.remove(className);
    releaseLensClass(className);
    return false;
  }

  if (lens === null) {
    el.classList.remove(className);
    releaseLensClass(className);
    return false;
  }

  // 库把目标设成 pointer-events: none —— 它假定交互由"内容层"承担, 而那层是
  // 像素镜像, 接不到指针事件 (见文件头与 dialog-surface.css)。这里清回落空的
  // 内联值, 让事件路径与本档之外一致; 但真正的兜底仍是 CSS 的
  // `[data-glass-tier='liquid'] { pointer-events: auto !important }` ——
  // _activate() 可能延后到 GPU 就绪才设 none, 只清一次并不保证能赢过它。
  el.style.pointerEvents = '';

  mounted.set(el, { className, lens });
  return true;
}

/** 卸载透镜并归还类名。库会自行恢复元素原有内联样式。 */
export function unmountLens(el: HTMLElement): void {
  const entry = mounted.get(el);
  if (!entry) return;
  mounted.delete(el);
  try {
    entry.lens.destroy();
  } catch (error) {
    console.warn('[glass] liquidGL 透镜销毁失败:', error);
  }
  el.classList.remove(entry.className);
  releaseLensClass(entry.className);
}

/** 已装配的透镜数 — 供性能预算与单测断言。 */
export function mountedLensCount(): number {
  return mounted.size;
}

/** 销毁全部透镜并复位引擎。档位整体退回 blur 时调用。 */
export function destroyAllLenses(): void {
  for (const el of [...mounted.keys()]) unmountLens(el);
}
