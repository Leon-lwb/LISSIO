declare module 'turndown-plugin-gfm' {
  import type TurndownService from 'turndown';

  export const gfm: TurndownService.Plugin;
  export const highlightedCodeBlock: TurndownService.Plugin;
  export const strikethrough: TurndownService.Plugin;
  export const tables: TurndownService.Plugin;
  export const taskListItems: TurndownService.Plugin;
}

// liquid-gl v3 不带类型声明 (单文件 ESM, 只有 default 导出)。
// 这里声明的是**我们实际使用的子集**, 不是上游全部选项 —— 类型的作用是让
// 我们用错库 API 时编译期失败, 而不是复述 README。字段语义见
// src/lib/glass/liquidGlassEngine.ts 的 LiquidGLOptions 注释。
declare module 'liquid-gl' {
  /** 单个透镜实例。库还提供 setDraggable/setShadow 等方法, 本项目不依赖。 */
  export interface LiquidGLLens {
    destroy(): void;
    setTint(color: string): void;
    setTilt(enabled: boolean): void;
  }

  export interface LiquidGLOptions {
    /** 渲染后端链起点。'auto' = WebGPU → WebGL2 → WebGL1 → CSS。 */
    engine?: 'auto' | 'webgpu' | 'webgl2' | 'webgl';
    /** 用于折射的快照区域, CSS 选择器。 */
    snapshot?: string;
    /** **必填**。要玻璃化的元素, CSS 选择器 (库内部走 querySelectorAll)。 */
    target?: string;
    /** 快照分辨率倍率, 0.1-3.0。 */
    resolution?: number;
    /** 透镜层叠序。共享画布按此分组, 同一页面需一致。 */
    zIndex?: number;
    /** 基础折射强度 0-1。 */
    refraction?: number;
    /** 色散强度 0-1, 0 = 关闭。 */
    aberration?: number;
    /** 边缘折射深度 0-1。 */
    bevelDepth?: number;
    /** 倒角带宽度 (占最短边比例) 0-1。 */
    bevelWidth?: number;
    /** 磨砂模糊半径 px, 0 = 全通透。 */
    frost?: number;
    shadow?: boolean;
    specular?: boolean;
    reveal?: 'none' | 'fade';
    tilt?: boolean;
    tiltFactor?: number;
    tiltEase?: number;
    draggable?: boolean;
    interaction?: 'none' | 'fluid';
    interactionStrength?: number;
    interactionRadius?: number;
    interactionViscosity?: number;
    magnify?: number;
    tint?: string | null;
    helper?: boolean;
    on?: {
      init?(lens: LiquidGLLens): void;
    };
  }

  /**
   * 返回单个透镜 (只匹配到一个元素) 或透镜数组; 未命中任何元素时返回 undefined。
   */
  const liquidGL: (
    options: LiquidGLOptions,
  ) => LiquidGLLens | LiquidGLLens[] | undefined;

  export default liquidGL;
}
