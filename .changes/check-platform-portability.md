---
"lissio": noop:ci
---

Make four checks independent of the platform and of where the checkout is allowed
to write. `pnpm check:docs` normalizes line endings before hashing `LICENSE`, and
`pnpm check:ci-gates` reads the runner registration with a CRLF-tolerant fence
pattern and compares generated gate blocks ignoring line endings, so a Windows
checkout with `core.autocrlf=true` no longer fails either gate over its line
endings. `pnpm check:tokens` compares file paths with forward slashes, so the
`theme.css` and `component-tokens.css` exemptions apply on Windows instead of
reporting 17 violations inside the exempt files. `pnpm check:contracts` exports
into `src-tauri/target` instead of the OS temp directory, because the exporter is
a child process and a confined environment can deny it writes outside the
checkout while allowing the build tree.
