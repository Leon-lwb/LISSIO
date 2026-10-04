import { defineConfig } from 'vitest/config';

/// Vitest 配置 — 与 vite.config.ts 相互独立, 不影响生产构建
///
/// - environment: jsdom — 组件测试需要 DOM
/// - globals: true — @testing-library/react 自动 cleanup 依赖全局 afterEach
/// - setupFiles: 注册 jest-dom 匹配器 + @tauri-apps/* 全量 mock (无需 Tauri 运行时)
///
/// resolve.conditions 必须把 browser 放在前面。jsdom 环境默认走 node 条件, 于是
/// react-resizable-panels 会解析到它的 SSR 构建 —— 那份构建整段省略了面板组的布局
/// 计算 (eagerValuesRef.layout 永远是空数组), collapse()/expand() 会直接断言失败。
/// 测试必须加载应用真正使用的那份构建, 否则测的是另一套实现。
export default defineConfig({
  resolve: {
    conditions: ['browser', 'development', 'import', 'default'],
  },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./src/test/setup.ts'],
    exclude: ['e2e/**', '**/node_modules/**', '.mimocode/**'],
  },
});
