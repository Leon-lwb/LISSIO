# Lissio Governance

<!-- lissio-doc
status: maintained
owner: Lissio maintainers
last-reviewed: 2026-10-07
applies-to: Decision rights, merge authority, releases, and maintainer succession
-->

## Authority

Project policy is maintained in root-level governance files and
`docs/governance/`. Code, manifests, build configuration, and release artifacts
are authoritative for implementation facts. Documentation must be corrected
when it disagrees with those sources.

## Governance files

| File | Purpose |
| --- | --- |
| `LICENSE` | Apache License 2.0 for the current source tree |
| `NOTICE` | Copyright, historical-license scope, and attribution |
| `CLA.md` | Contributor licensing and patent terms |
| `CONTRIBUTING.md` | Contribution and verification workflow |
| `SECURITY.md` | Security and rights-reporting channels |
| `CODE_OF_CONDUCT.md` | Community conduct and enforcement |
| `MAINTAINERS.md` | Maintainer roles and response targets |
| `SUPPORT.md` | User support boundaries |
| `ROADMAP.md` | Delivered scope and explicit non-goals |
| `docs/governance/` | Licensing, dependency, documentation, and review policy |

## Roles

| Role | Authority |
| --- | --- |
| Copyright holder | Holds project trademarks and administers the project |
| Maintainer | Merges changes, publishes releases, updates policy, and handles reports |
| Contributor | Submits issues and pull requests under `CLA.md` |
| User | Uses and redistributes the project under Apache-2.0 and third-party terms |

The current maintainer list is `MAINTAINERS.md`. Commit history is authoritative
for contribution identity.

## Decisions

Routine decisions are made by maintainers in the relevant pull request or
review record. Changes to licensing, copyright ownership, `CLA.md`, trademark
policy, release shape, or security-reporting channels require maintainer
consensus and an explicit review record.

Unresolved legal or intellectual-property disagreements are not merged and are
handled through `SECURITY.md`.

## Merge authority

Maintainers merge reviewed changes. A maintainer does not merge an unreviewed
governance change authored by themselves; a separate review record is required.
External pull requests must pass the complete checks in `CONTRIBUTING.md`.

## Releases

Releases use semantic versions and tags in the form `vX.Y.Z`, with pre-release
suffixes such as `-beta.1`. The release procedure is in `RELEASING.md`.

Before publication:

1. all commands in `CONTRIBUTING.md` pass;
2. `pnpm check:docs` passes;
3. `LICENSE`, `NOTICE`, and required third-party notices ship with binary
   artifacts;
4. release notes identify compatibility and migration effects;
5. security and licensing review records have no unresolved release blockers.

Apache-2.0 does not require reciprocal source publication for current releases,
but source and build reproducibility remain project release policies. GPL terms
continue to apply to earlier GPL releases.

## Maintainer succession

New maintainers require a sustained contribution record, competence with the
architecture rules, agreement to the code of conduct, and acceptance of the
published response targets. Appointment and handoff are recorded in
`docs/reviews/records/`.

If the project becomes inactive for six months, maintainers should publish its
status as maintained, bug-fix-only, or archived. Archival preserves history,
documentation, license texts, and source availability.

## Exceptions

Any gate exception must be recorded with scope, rationale, risk, and review
date. Missing verification is not an approved exception.
