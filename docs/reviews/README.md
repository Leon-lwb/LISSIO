# Documentation Review Records

<!-- lissio-doc
status: maintained
owner: Lissio maintainers
last-reviewed: 2026-10-21
applies-to: Historical records under docs/reviews/records
-->

This directory preserves historical review facts: what was reviewed, the
decision, and outstanding work. Records are not rewritten after publication.
Corrections are added as new records that reference the old record. Current
policy lives in [`../governance/document-review.md`](../governance/document-review.md).

## Record format

- Name records `YYYY-MM-DD-<scope>.md` using lowercase kebb-case scopes.
- Begin with metadata that `pnpm check:docs` validates:

```markdown
# <scope> documentation review

<!-- lissio-review
date: 2026-10-04
scope: one-sentence review scope
reviewer: reviewer identity
verdict: passed | passed-with-conditions | failed
-->
```

- Preserve three sections: **Scope**, **Findings**, and **Follow-ups**.
- Historical records retain their original language and established verdict
  labels. New records use English and the labels above.

## Index

| Date | Scope | Verdict | Record |
| --- | --- | --- | --- |
| 2026-10-20 | Protocol registry implementation: `{ protocol, params }`, `ProtocolRegistry`, and the single engine dispatch | passed with conditions | [records/2026-10-20-protocol-registry.md](records/2026-10-20-protocol-registry.md) |
| 2026-10-20 | Prepared-node driver contract implementation and remaining source-port decision | passed with conditions | [records/2026-10-20-prepared-node-driver-contract.md](records/2026-10-20-prepared-node-driver-contract.md) |
| 2026-10-20 | Device and protocol engine abstraction survey and target contracts | passed with conditions | [records/2026-10-20-device-protocol-abstraction.md](records/2026-10-20-device-protocol-abstraction.md) |
| 2026-10-15 | Build-all bundle finalization | passed with conditions | [records/2026-10-15-build-all-bundle-finalization.md](records/2026-10-15-build-all-bundle-finalization.md) |
| 2026-10-15 | Windows installer integrity and delivery | passed with conditions | [records/2026-10-15-windows-installer-integrity.md](records/2026-10-15-windows-installer-integrity.md) |
| 2026-10-15 | Windows transparency and background composition | passed with conditions | [records/2026-10-15-windows-transparency-and-backgrounds.md](records/2026-10-15-windows-transparency-and-backgrounds.md) |
| 2026-10-15 | Rustls security update | passed with conditions | [records/2026-10-15-rustls-security-update.md](records/2026-10-15-rustls-security-update.md) |
| 2026-10-14 | Windows development dependency audit retry | failed | [records/2026-10-14-windows-development-audit-retry.md](records/2026-10-14-windows-development-audit-retry.md) |
| 2026-10-14 | Windows desktop development and quality gates | failed | [records/2026-10-14-windows-development-gates.md](records/2026-10-14-windows-development-gates.md) |
| 2026-10-14 | Log file target fallback | passed with conditions | [records/2026-10-14-log-file-target-fallback.md](records/2026-10-14-log-file-target-fallback.md) |
| 2026-10-14 | Windows acrylic backdrop | passed with conditions | [records/2026-10-14-windows-acrylic-backdrop.md](records/2026-10-14-windows-acrylic-backdrop.md) |
| 2026-10-14 | Configuration guide and Rust build parallelism | passed with conditions | [records/2026-10-14-configuration-guide-and-build-parallelism.md](records/2026-10-14-configuration-guide-and-build-parallelism.md) |
| 2026-10-14 | Recording read handle under Windows locking | passed with conditions | [records/2026-10-14-recording-read-handle.md](records/2026-10-14-recording-read-handle.md) |
| 2026-10-14 | Windows local run environment | passed with conditions | [records/2026-10-14-windows-local-run-environment.md](records/2026-10-14-windows-local-run-environment.md) |
| 2026-10-13 | Check platform and confinement portability | passed with conditions | [records/2026-10-13-check-platform-portability.md](records/2026-10-13-check-platform-portability.md) |
| 2026-10-13 | Tauri npm/crate version alignment and gate | passed with conditions | [records/2026-10-13-tauri-version-alignment.md](records/2026-10-13-tauri-version-alignment.md) |
| 2026-10-13 | Linux device selection rendering | passed with conditions | [records/2026-10-13-linux-device-select.md](records/2026-10-13-linux-device-select.md) |
| 2026-10-13 | Linux controls and content-switch rendering | passed with conditions | [records/2026-10-13-linux-controls-and-switch-flicker.md](records/2026-10-13-linux-controls-and-switch-flicker.md) |
| 2026-10-04 | Open-source and IP baseline | passed with conditions | [records/2026-10-04-open-source-ip-baseline.md](records/2026-10-04-open-source-ip-baseline.md) |
| 2026-10-04 | Fact consistency corrections | passed | [records/2026-10-04-fact-consistency-fixes.md](records/2026-10-04-fact-consistency-fixes.md) |
| 2026-10-04 | Project governance baseline | passed with conditions | [records/2026-10-04-project-governance-baseline.md](records/2026-10-04-project-governance-baseline.md) |
| 2026-10-04 | Motion stagger and release behavior | passed with conditions | [records/2026-10-04-motion-stagger-and-release.md](records/2026-10-04-motion-stagger-and-release.md) |
| 2026-10-04 | Sticky widget palette section bar | passed with conditions | [records/2026-10-04-palette-sticky-section-bar.md](records/2026-10-04-palette-sticky-section-bar.md) |
| 2026-10-05 | Frontend motion and frost budget | passed | [records/2026-10-05-frontend-motion-and-frost-budget.md](records/2026-10-05-frontend-motion-and-frost-budget.md) |
| 2026-10-05 | Docked-panel exit physics | passed | [records/2026-10-05-docked-panel-exit-physics.md](records/2026-10-05-docked-panel-exit-physics.md) |
| 2026-10-04 | Motion reorder and solve cache | passed with conditions | [records/2026-10-04-motion-list-reorder-and-solve-cache.md](records/2026-10-04-motion-list-reorder-and-solve-cache.md) |
| 2026-10-06 | UI layers and gate coverage | passed | [records/2026-10-06-ui-layers-and-gate-holes.md](records/2026-10-06-ui-layers-and-gate-holes.md) |
| 2026-10-06 | Motion token single source and fallback cleanup | passed | [records/2026-10-06-motion-token-single-source-and-dead-fallback.md](records/2026-10-06-motion-token-single-source-and-dead-fallback.md) |
| 2026-10-06 | Dialog primitive and interaction contract | passed | [records/2026-10-06-dialog-primitive-and-interaction-layer.md](records/2026-10-06-dialog-primitive-and-interaction-layer.md) |
| 2026-10-06 | Interaction extraction and motion handoff | passed | [records/2026-10-06-interaction-extraction-and-motion-handoff.md](records/2026-10-06-interaction-extraction-and-motion-handoff.md) |
| 2026-10-06 | Layer exemptions and effect input ports | passed | [records/2026-10-06-layer-exemption-paydown-and-effect-input-port.md](records/2026-10-06-layer-exemption-paydown-and-effect-input-port.md) |
| 2026-10-07 | Apache-2.0 relicensing and documentation authority | passed with conditions | [records/2026-10-07-apache-relicensing-and-documentation.md](records/2026-10-07-apache-relicensing-and-documentation.md) |
| 2026-10-07 | Recording database default-off | passed with conditions | [records/2026-10-07-recording-database-default-off.md](records/2026-10-07-recording-database-default-off.md) |
| 2026-10-07 | CI reorganization and gate single-sourcing | passed with conditions | [records/2026-10-07-ci-reorganization-and-gate-single-sourcing.md](records/2026-10-07-ci-reorganization-and-gate-single-sourcing.md) |
| 2026-10-07 | Change-file release flow and release gates | passed with conditions | [records/2026-10-07-change-file-release-flow-and-gates.md](records/2026-10-07-change-file-release-flow-and-gates.md) |
| 2026-10-08 | Database backend investigation and plan | passed with conditions | [records/2026-10-08-database-backend-investigation.md](records/2026-10-08-database-backend-investigation.md) |
| 2026-10-08 | English-only documentation policy | passed with conditions | [records/2026-10-08-english-only-documentation.md](records/2026-10-08-english-only-documentation.md) |
| 2026-10-11 | Onboarding and shared settings persistence | passed with conditions | [records/2026-10-11-onboarding-settings-persistence.md](records/2026-10-11-onboarding-settings-persistence.md) |
| 2026-10-11 | Workspace quality recovery | passed | [records/2026-10-11-workspace-quality-recovery.md](records/2026-10-11-workspace-quality-recovery.md) |
| 2026-10-11 | Rust flat test layout | passed with conditions | [records/2026-10-11-rust-flat-test-layout.md](records/2026-10-11-rust-flat-test-layout.md) |
| 2026-10-11 | Abstraction unification batches | passed with conditions | [records/2026-10-11-unification-batches.md](records/2026-10-11-unification-batches.md) |
| 2026-10-16 | Bilingual README policy and translation metadata | passed with conditions | [records/2026-10-16-bilingual-readme-policy.md](records/2026-10-16-bilingual-readme-policy.md) |

## Retention

Records are permanent and are not compressed or archived away from the
repository. A later record supersedes an earlier conclusion when needed.
Governance freshness is controlled by `last-reviewed` and
`pnpm check:docs -- --stale-days <days>`.
