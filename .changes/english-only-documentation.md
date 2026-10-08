---
"lissio": noop:removed
---

Repository prose is written in English. Removed the Chinese translation backups
under `docs/community/`, dropped `language` and `authoritative` from the
documentation metadata contract, translated the Chinese prose out of `scripts/`,
`e2e/`, and the build/CI configuration, and `check:release-sync` no longer
requires a Chinese CHANGELOG backup. Historical review records and product
localization (`src/i18n/resources/zh/`, runtime capability help `docs/zh/`) are
unchanged, and the English requirement is a reviewer-confirmed convention rather
than a gate rule.
