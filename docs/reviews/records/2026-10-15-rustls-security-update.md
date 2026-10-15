# Rustls security update review

<!-- lissio-review
date: 2026-10-15
scope: Rustls security patch, regenerated dependency inventory, and complete cargo-deny audit
reviewer: dependency implementation agent and independent documentation review agent; maintainer sign-off pending
verdict: passed-with-conditions
-->

## Scope

This record addresses the dependency-security failure documented in the
[Windows dependency audit retry review](2026-10-14-windows-development-audit-retry.md).
The earlier record remains unchanged. The authoritative sources are
`src-tauri/Cargo.lock`, `src-tauri/deny.toml`, the downloaded crate metadata and
license files, and the commands in the
[third-party inventory](../../governance/third-party-licenses.md).

## Findings

- The lockfile updates only `rustls` from 0.23.45 to 0.23.46 and its registry
  checksum. No direct dependency, workspace dependency constraint, source API,
  advisory exception, or license allow-list changes. The existing transitive
  dependency constraints accept the patched version; `cargo metadata --locked`
  validates the resulting graph.
- The [upstream 0.23.46 release](https://github.com/rustls/rustls/releases/tag/v/0.23.46)
  and the fetched RustSec database identify this version as fixing
  `RUSTSEC-2026-0346`, `RUSTSEC-2026-0347`, `RUSTSEC-2026-0348`, and
  `RUSTSEC-2026-0349`. The update resolves the audit findings without claiming
  that every advisory's exploit conditions were present in Lissio.
- Reverse-dependency inspection identifies the HTTPS stacks used by AI, MCP,
  and update adapters (`reqwest`, `hyper-rustls`, and `tokio-rustls`) and the
  `ureq` dependency used by `libduckdb-sys` build downloads. The crate-domain
  graph and composition boundaries are unchanged.
- `cargo-deny` 0.20.2 completed the normal `cargo deny check`, including advisory
  fetching, with exit status 0: `advisories ok, bans ok, licenses ok, sources
  ok`. The fetched database and independently queried official `main` branch
  both resolve to `caee11f41fab07d676c0a4655a2a5dd1f94da97c`. TLS certificate
  verification remained enabled. The audit retains 65 duplicate-version
  warnings and 10 unused advisory-exception warnings under the existing policy;
  neither category was suppressed to obtain a pass.
- The crate's `Apache-2.0 OR ISC OR MIT` expression is unchanged, and all three
  shipped license files are byte-identical to 0.23.45. The inventory records the
  existing allowed Apache-2.0 branch. No new notice or license text is required.
  Regenerated metadata counts 765 external Rust crates, including 63 with
  `Apache-2.0 OR MIT`. Regenerated pnpm lists count 394 installed production
  packages and 820 including development; frontend versions are unchanged.
  These measurements correct the previous inventory snapshot rather than
  describe packages introduced by this patch.
- The explicit documentation checklist review covers factual authority,
  dependency counts, paths and external references (1.1–1.8); unchanged project
  licensing and dependency obligations (2.1–2.7); English documentation,
  metadata, placement, and record naming (3.1–3.7); and single authoritative
  sources and review triggers (4.1–4.5). Required gate and indexing completion
  is tracked below (5.1–5.5).
- `pnpm check:deps`, `pnpm check:architecture`, `pnpm check:tauri-versions`, and
  `pnpm check:release-sync` pass for the updated lockfile. These targeted checks
  and the dependency audit do not substitute for the complete quality surface.
- The combined change completed the scope of all 24 enforcing gates plus the
  informational architecture inventory. The original full driver exited 1
  with generated-output ESLint errors and a Windows CRT documentation-test
  link failure; these were corrected and the complete affected commands were
  rerun successfully. Workspace tests then reported 1,500 passed, zero failed,
  and two existing ignored cases across 211 result groups. The full browser
  suite passed all 15 tests, and all three performance scenarios passed against
  the unchanged baseline. The normal dependency audit passed again within the
  full run. The [combined Windows review](2026-10-15-windows-transparency-and-backgrounds.md)
  owns the complete matrix, original failures, corrective reruns, desktop-link
  verification, and native appearance coverage. This does not describe the
  original `check:all` invocation as successful.
- Reproducible evidence is retained locally under
  `output/2026-10-15-validation/`: `architecture.log`, `rustls-before-tree.log`,
  `rustls-update.log`, `cargo-metadata.json`, the two `frontend-licenses-*.json`
  snapshots, `cargo-deny.log`, and `rustsec-reference.txt`. These generated files
  are not repository deliverables.
- The closing documentation gate (`node scripts/check-docs.mjs`, the command
  behind `pnpm check:docs`) passed after the final review records and index
  update. The security findings are resolved without policy exceptions; the
  `passed-with-conditions` conclusion retains actual maintainer review and the
  next dependency/security review trigger below.

## Follow-ups

1. Complete actual maintainer checklist review separately from agent review
   and commit signing. Owner: Lissio maintainers. Due: before merge or release;
   review date: 2026-10-15.
2. Revisit this dependency review when rustls is upgraded again or a new
   applicable advisory is published. Owner: Lissio maintainers. Review trigger:
   the next dependency change or security alert.
