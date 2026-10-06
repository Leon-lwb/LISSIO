# Lissio Release Handbook

<!-- lissio-doc
status: maintained
owner: Lissio maintainers
last-reviewed: 2026-10-07
language: en
authoritative: true
applies-to: Versioning, verification, packaging, and publication
-->

## Scope

This handbook is for maintainers publishing Lissio from the Codeberg repository.

## Versioning

Use semantic versions and tags named `vX.Y.Z`. Pre-release tags append
`-alpha.N`, `-beta.N`, or `-rc.N`. Keep the frontend and Rust workspace versions
synchronized.

## Preflight

1. Confirm the intended commit is on the release branch and the working tree is
   clean.
2. Run the complete command set in `CONTRIBUTING.md`.
3. Run `pnpm check:docs` with the default review window.
4. Review `NOTICE`, third-party notices, and packaged font licenses.
5. Check security and review records for release blockers.
6. Verify release notes, supported platforms, and compatibility changes.

Never overwrite performance or contract baselines merely to make checks pass.

## Build

Build all artifacts from the same source revision:

```bash
pnpm build:web
pnpm build:server
pnpm build:desktop
```

Collect Web, server/CLI, desktop, source, `LICENSE`, `NOTICE`, and required
third-party license files. Test installation and launch on every published
platform.

## Publish

1. Create an annotated `vX.Y.Z` tag.
2. Publish release notes from `CHANGELOG.md`.
3. Upload artifacts and checksums.
4. Verify the download page, updater metadata, and source links.
5. Record the release review in `docs/reviews/records/`.

Current Apache-2.0 releases do not carry GPL reciprocal-source obligations.
Earlier GPL releases remain subject to their original terms.

## Failure recovery

Do not delete or replace a published tag or artifact silently. Mark the affected
release as withdrawn when necessary, publish a corrective release, and document
the incident. Failed workflows may be retried only after confirming that no
partial public artifact exists.
