---
"lissio": noop:ci
---

Make the local quality surface and the build commands run on Windows. The tier
driver is now `scripts/check-all.mjs` — one implementation for the Linux CI
checkout and for Windows, where `pnpm check:all` previously failed on the missing
`bash` — with `scripts/check-all.sh` forwarding to it so the tier commands and the
workflows stay unchanged. On Windows the driver, and every build or development
script, first apply `scripts/local-env.mjs`: `TMP`/`TEMP`/`TMPDIR` move to
`output/local-tmp` inside the checkout, and the stale `msvcrt.lib` stub an older
`tauri-build` left behind is removed. That fixes MSVC's `cl.exe` D8050, esbuild's
`Access is denied` during `vite build` — so `pnpm build:all` and `pnpm build:web`
work again — and the contract exporter's IO failure, all of which are symptoms of
a confined session denying child processes the OS temp directory.
