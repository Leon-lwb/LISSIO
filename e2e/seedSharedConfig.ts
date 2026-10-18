//! Shared end-to-end configuration seed.
//!
//! The functional and performance suites share one backend config directory
//! (`client/src-tauri/target/e2e-config`, named by the webServer entries in
//! `playwright.config.ts`). A fresh checkout has no `settings.json` there, and a
//! missing document is exactly what the first-launch page reads as "never set
//! up" — so without this seed every spec would meet that modal first (and the
//! perf suite would silently skip its measurements under the overlay).
//!
//! The seed runs when the Playwright config module is loaded, which is before
//! the webServer starts. It only writes when the file is absent: an existing
//! directory keeps whatever the previous run left behind.
//!
//! `lastSeenVersion` only has to be non-null. The first-launch page keys off
//! "never confirmed", not off the version string, and these suites do not check
//! version bookkeeping — so a literal marker beats importing a version that
//! would silently go stale.

import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

const SEED_DOCUMENT = {
  app: {
    general: {
      language: 'zh',
      showOnboarding: false,
      autoCheckUpdate: false,
      lastSeenVersion: 'e2e',
    },
    appearance: { theme: 'dark' },
  },
} as const;

/// Write the shared suite settings document if the directory has none.
export function seedSharedEndToEndConfig(configDir: string): void {
  const settingsPath = join(configDir, 'settings.json');
  if (existsSync(settingsPath)) return;
  mkdirSync(dirname(settingsPath), { recursive: true });
  writeFileSync(settingsPath, `${JSON.stringify(SEED_DOCUMENT, null, 2)}\n`, 'utf8');
}
