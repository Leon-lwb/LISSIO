import { defineConfig } from 'vitest/config';

/**
 * Vitest configuration for the umbrella's own suite.
 *
 * The umbrella owns the gate registry, its drivers, and the packaging helpers, and
 * their self-tests live beside them in `scripts/`. Those tests are the ones that
 * catch a gate regression — a matcher that stopped matching, a plan that stopped
 * being emitted, a doc block that stopped round-tripping — so they must run from
 * the repository that owns the scripts.
 *
 * The frontend has its own Vitest project in `client/` (jsdom, component setup,
 * colocated tests) and runs as `pnpm test:client`. This config deliberately
 * includes only `scripts/**` so the two suites cannot silently absorb each
 * other's fixtures, and it needs no DOM environment: the gate self-tests spawn
 * Node subprocesses and read the repository.
 */
export default defineConfig({
  test: {
    include: ['scripts/**/*.test.mjs'],
    environment: 'node',
  },
});
