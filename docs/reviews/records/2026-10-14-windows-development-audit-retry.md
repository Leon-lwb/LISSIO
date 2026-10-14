# Windows development dependency audit retry review

<!-- lissio-review
date: 2026-10-14
scope: Dependency-audit retry after TLS access recovered for the Windows development and quality-gate fixes
reviewer: implementation agent and independent documentation review agent; maintainer sign-off pending
verdict: failed
-->

## Scope

This record supplements the
[Windows desktop development and quality gates review](2026-10-14-windows-development-gates.md).
The original record and its `failed` verdict remain unchanged as historical
evidence. This review covers the repeated `cargo deny check`, the current
RustSec database reference, and the remaining dependency-security gate failure.
The authoritative sources are `src-tauri/Cargo.lock`, `src-tauri/deny.toml`,
the fetched RustSec advisory database, and the local execution log at
`output/check-all-retries/cargo-deny-restored.log`.

## Findings

- TLS access recovered. The required `cargo-deny` 0.20.2 fetched the advisory
  database and completed its checks. The database's `HEAD` and `main` both
  resolve to `caee11f41fab07d676c0a4655a2a5dd1f94da97c`, matching the remote
  reference independently verified in the earlier review. The former stale
  cache and transport failure no longer explain the gate result.
- The command exited with status 1 and reported `advisories FAILED, bans ok,
  licenses ok, sources ok`. Four `error[vulnerability]` findings apply to the
  locked `rustls` 0.23.45 package:

  | Advisory | Patched version reported by the database |
  | --- | --- |
  | `RUSTSEC-2026-0346` | `>=0.23.46` |
  | `RUSTSEC-2026-0347` | `>=0.23.46` |
  | `RUSTSEC-2026-0348` | `>=0.23.46` |
  | `RUSTSEC-2026-0349` | `>=0.23.46` |

  These are the audit's package-level findings; this review does not claim
  that each advisory's exploit conditions occur in Lissio.
- No dependency version, lockfile, advisory ignore, or deny policy was changed
  to obtain this result. `git show HEAD:src-tauri/Cargo.lock` confirms that
  `rustls` 0.23.45 was already locked before these changes; the lockfile and
  `deny.toml` have no diff. Certificate verification remained enabled. The retry
  resolves the previous verification blockage but exposes a substantive
  security-gate failure; it does not turn the complete quality surface green.
  The successful results for the other 23 required gates remain documented in
  the earlier record for the unchanged implementation.
- The independent review found no required correction in the desktop-profile,
  CRLF-parser, or host-log-path-test changes. The change file, authoritative
  English documentation, metadata, and index cover those changes. This new
  historical record is separately indexed; it does not rewrite prior findings.
- The verdict remains `failed` because the dependency-security gate has not
  passed. A local signed commit does not establish merge or release readiness.
  Agent review and a cryptographic commit signature do not substitute for an
  actual maintainer checklist review or sign-off, neither of which is recorded
  here.

## Follow-ups

1. Prepare a separate dependency change updating `rustls` to a version that
   resolves all four advisories, at least 0.23.46 according to this database.
   Review the affected dependency inventory and obligations, run the complete
   quality surface again, and record the results. Owner: Lissio maintainers.
   Due: before merging or releasing the affected change set; review date:
   2026-10-14.
2. Complete the actual maintainer checklist review and sign-off after the
   security gate passes. Owner: Lissio maintainers. Due: before merge or
   release; review date: 2026-10-14.
