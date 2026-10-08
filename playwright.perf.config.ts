import { defineConfig } from '@playwright/test';
import base from './playwright.config';

/**
 * Configuration dedicated to frontend performance measurement.
 *
 * Why a separate config instead of adding a grep to e2e:
 *
 * - **Serial**. Measurement asks "how long does this code take on its own"; parallel workers
 *   competing for CPU turn the numbers into noise. Here workers=1: prefer slow over letting
 *   scenarios share the machine.
 * - **Separate from functional tests**. Functional-test retries, timeouts, and concurrency must
 *   not affect measurement; conversely, measurement must not block the functional gate because
 *   one scenario hangs. Two steps, so whichever goes red can be investigated on its own.
 * - **Collect only the perf directory**. Keeps new e2e cases from being swept into the
 *   performance gate.
 *
 * webServer reuses the base config: the frontend and backend services are the same, so the
 * startup logic is not duplicated.
 */
export default defineConfig({
  ...base,
  testDir: './e2e/perf',
  // Must be cleared explicitly: the base config sets testIgnore '**/perf/**' to keep
  // measurement out of the functional suite. That rule is spread in from base, and without
  // overriding it this config would ignore its own cases, showing "No tests found" — a
  // silently broken measurement step is worse than no measurement at all.
  testIgnore: undefined,
  fullyParallel: false,
  workers: 1,
  // Do not retry failed measurements: a retry would let a "first run happened to be slow"
  // overwrite the real result.
  retries: 0,
  timeout: 120_000,
  reporter: [['list']],
});