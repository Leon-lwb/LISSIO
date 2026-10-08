import { defineConfig } from 'vitest/config';

/// Vitest configuration — independent of vite.config.ts and does not affect the production build
///
/// - environment: jsdom — component tests need a DOM
/// - globals: true — @testing-library/react automatic cleanup relies on a global afterEach
/// - setupFiles: registers jest-dom matchers + a full @tauri-apps/* mock (no Tauri runtime needed)
///
/// resolve.conditions must list browser first. The jsdom environment defaults to the node
/// condition, so react-resizable-panels would resolve to its SSR build — that build omits the
/// panel group's layout calculation entirely (eagerValuesRef.layout is always an empty array),
/// making collapse()/expand() fail its assertions outright. Tests must load the same build the
/// app actually uses, otherwise they exercise a different implementation.
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
