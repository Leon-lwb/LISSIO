# Change-file release flow and release gates documentation review

<!-- lissio-review
date: 2026-10-07
scope: Replace the hand-chosen release version with change files consumed by covector, and add two PR-tier gates that keep change files, version fields, and both changelogs in step
reviewer: Lissio maintainers
verdict: passed-with-conditions
-->

## Scope

The release path had two gaps. Nobody derived the next version from the content
of a change — `auto-build.sh` raised the patch number from the last tag — and
nothing checked that `CHANGELOG.md`, its Chinese backup, and the five places a
version number lives agreed with each other. Both were manual steps documented
in `RELEASING.md` and enforced by nothing.

Reviewed and changed files:

| File | Change |
| --- | --- |
| `.changes/config.json` | covector configuration: one `lissio` package on the `javascript` manager, section tags mapped to changelog headings, `postversion` hook into the normalizer |
| `.changes/README.md` | change-file convention, bump and tag tables, pre-release mode |
| `scripts/changelog-normalize.mjs` | restores the repository's changelog format after `covector version` rewrites it |
| `scripts/release-prepare.mjs` | local release preparation; refuses a dirty tree |
| `scripts/check-changes.mjs` | new gate: change files and configuration are valid |
| `scripts/check-release-sync.mjs` | new gate: version ↔ changelog ↔ Chinese backup |
| `scripts/gates.mjs` | both gates registered in a new `Release` group |
| `package.json` | `covector` dev dependency, `release:prepare`, `changes:add`, `changes:status` |
| `AGENTS.md`, `CONTRIBUTING.md`, `.github/PULL_REQUEST_TEMPLATE.md` | change files become the contributor-facing requirement |
| `RELEASING.md`, `docs/community/RELEASING.zh-CN.md` | the version is computed, not chosen; pre-release mode documented |
| `docs/ci.md`, `docs/community/docs/ci.zh-CN.md` | the release sequence starts at `release:prepare`, not `set-version` |

## Findings

covector is a change-management tool whose own release features are GitHub-only,
so it was adopted for the part it does host-agnostically: assembling change files
into a version, a changelog entry, and a command pipeline. Everything after that
— packaging, Codeberg upload, rolling channel tags, the updater manifest —
remains the existing scripts.

Four properties were verified by running covector 0.13.2, not by reading its
documentation:

- It reads a version only from a manifest that declares one. Declaring a member
  crate that inherits `version.workspace = true` aborts with
  `package version is not set`. Declaring the root manifest works, but writes
  only `[package] version`, leaving `[workspace.package] version` and all 63
  inheriting crates behind. This is why `set-version.mjs` stays the single writer
  and runs from the `postversion` hook.
- `gitSiteUrl` is the only host coupling on the version path; changelog commit
  links resolved to `codeberg.org` with no GitHub API call.
- The generated changelog format is not configurable. It inserts the new entry
  directly below the H1, which relocates the `lissio-doc` metadata block and the
  Keep a Changelog preamble to the middle of the file.
- `covector add` and `covector preview` are reachable through the default
  command, and `preview` does not consume change files.

One defect was found and fixed during rehearsal: a change file with no associated
commit renders as a link to `commit/undefined`, which the first prefix-stripping
pattern missed because it required a hexadecimal hash. The pattern now accepts
any backticked token, and historical entries are cleaned as well.

`check:release-sync` covers four independent version locations plus both
changelogs. `tauri.conf.json` and the Cargo manifests deliberately differ from
`package.json` when a pre-release suffix is present, so the gate compares those
against the base version and `package.json` against the full version.

## Follow-ups

- `docs/community/CHANGELOG.zh-CN.md` is still translated by hand. The gate
  detects a missing version; it does not produce the text.
- `auto-build.sh` retains its own tag-derived version. Passing `--version`
  explicitly after `release:prepare` avoids two competing sources, and
  `RELEASING.md` says so, but the fallback path was left in place rather than
  removed.
- Pre-release numbering starts at `-beta.0`, one below the `-beta.N` convention
  used before this change. No existing release is rewritten.
- Adding a gate that requires a change file on every non-documentation pull
  request needs a diff base; the PR checkout is depth-1. The requirement stays
  with the pull-request template until that is addressed.
