---
"lissio": patch:fixed
---

Restore `pnpm dev:desktop`, which aborted before building anything with "Found
version mismatched Tauri packages": `src-tauri/Cargo.lock` now resolves `tauri`
2.12 and `tauri-plugin-opener` 2.7, matching the `@tauri-apps/api` 2.12 and
`@tauri-apps/plugin-opener` 2.7 already declared in `package.json`. A new
`pnpm check:tauri-versions` gate compares the Tauri npm packages installed under
`node_modules` with the crates resolved in `src-tauri/Cargo.lock` and fails on
any major/minor drift, so this failure class can no longer pass every gate while
the desktop development command refuses to start.
