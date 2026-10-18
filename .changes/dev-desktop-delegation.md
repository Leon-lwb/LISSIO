---
"lissio": patch:fixed
---

Restored `pnpm dev:desktop` and `pnpm dev:web`, which aborted before starting
anything with `Command "client" not found`.

Both commands still delegated into the client repository (`pnpm --dir client
dev:desktop` / `dev:web`), but the client's standalone manifest now carries only
the frontend scripts: desktop orchestration belongs to the umbrella, where
`scripts/local-env.mjs` (the Windows WebView2 profile) and
`scripts/prepare-sidecar.mjs` stayed. From the client directory the same call
reported the real cause, `Command "dev:desktop" not found`; from the root, pnpm
fell back to treating the leftover arguments as a command name and named the
wrong one.

`dev:desktop` now prepares the sidecar from the umbrella and hands off to the
client's own Tauri passthrough. `dev:web` reuses the `dev` delegation, which is
the same Vite server on :1420 and is what the Playwright e2e configuration
starts.
