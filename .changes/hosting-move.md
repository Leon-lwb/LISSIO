---
"lissio": patch:changed
---

The repositories moved from the `Horldsence` user account to the
`lissio-industries` organization, so every live reference now resolves: the old
path only survives as a redirect, and release automation, the in-app updater,
and the About/menu links are the places where a stale owner name would break
silently. `https://lissio.pengheng.top` is the project homepage and the
documentation entry point; releases, issues, and update manifests stay on
Codeberg. The maintainer contact `pengheng.wang@foxmail.com` is now stated in
`CITATION.cff`, `CLA.md`, and the READMEs, and `check:docs` asserts it.
Historical review records and release notes keep the addresses they were
written with.

Files: package.json, .changes/config.json, .github/ISSUE_TEMPLATE/config.yml,
NOTICE, CITATION.cff, CLA.md, README.md, README.zh-CN.md, docs/ci.md,
scripts/check-docs.mjs, scripts/publish-crates.mjs, scripts/publish-release.mjs,
scripts/verify-release.mjs
