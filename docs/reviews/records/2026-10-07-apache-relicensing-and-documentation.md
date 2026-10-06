# Apache-2.0 relicensing and documentation review

<!-- lissio-review
date: 2026-10-07
scope: Apache-2.0 relicensing, English documentation authority, Chinese translation backups, community files, and license gates
reviewer: Horldsence
verdict: passed-with-conditions
-->

## Scope

Reviewed the current source tree's transition from GPL-2.0-only to Apache-2.0,
historical-release wording, SPDX fields, dependency allow-list, repository
documentation structure, English authority, Chinese translation mapping,
community metadata, hosting references, and documentation gates.

## Findings

- `LICENSE` contains the canonical Apache License 2.0 text and the gate pins its
  checksum.
- `package.json`, the Rust workspace, and inherited workspace packages use
  `Apache-2.0`.
- `NOTICE`, `CLA.md`, governance, support, release, README, and roadmap text
  consistently distinguish the current Apache-2.0 tree from historical GPL-only
  releases.
- No separate commercial license is offered. Apache-2.0 permits commercial use
  under its own conditions.
- English non-historical documentation is authoritative. Chinese backups map to
  their English sources and explicitly state that English controls.
- Historical review records remain unchanged. Runtime Chinese capability help
  remains at its compile-time source path and declares the English runtime
  document as authoritative.
- `src-tauri/deny.toml` no longer allow-lists GPL-2.0-only for the current
  Apache-2.0 codebase. `cargo deny check` completed with advisories, bans,
  licenses, and sources passing.
- The Codeberg repository is now the canonical hosting reference in project
  metadata and UI links.
- The pre-existing panel catalog split required a minimal visibility/import fix
  so contract export and the backend build could compile.

## Follow-ups

1. Confirm the MiSans subset-modification question with qualified legal advice
   or replace the font before the next release. Owner: maintainer. Review by the
   next release.
2. Keep historical GPL release artifacts and notices unchanged; do not describe
   them as Apache-2.0 releases.
3. Run the complete release-quality surface in the release environment and
   retain its logs with the release record.
