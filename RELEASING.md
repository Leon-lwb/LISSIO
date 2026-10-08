# Lissio Release Handbook

<!-- lissio-doc
status: maintained
owner: Lissio maintainers
last-reviewed: 2026-10-08
applies-to: Versioning, verification, packaging, and publication
-->

## Scope

This handbook is for maintainers publishing Lissio from the Codeberg repository.

## Versioning

Use semantic versions and tags named `vX.Y.Z`. Pre-release tags append
`-alpha.N`, `-beta.N`, or `-rc.N`. Keep the frontend and Rust workspace versions
synchronized.

The version is **computed, not chosen**. Contributors record each change as a
change file in `.changes/` (see [`.changes/README.md`](.changes/README.md)), and
`pnpm release:prepare` turns the accumulated files into one version number plus
the matching `CHANGELOG.md` entry. Nothing in the release path asks a maintainer
to decide between patch, minor, and major by hand.

`package.json` carries the full version, including any pre-release suffix.
`src-tauri/tauri.conf.json` and the Cargo manifests carry only the base version,
because the MSI bundler rejects pre-release identifiers.
`scripts/set-version.mjs` is the only writer of those files.

Two gates enforce the invariants this section describes, and both run in the PR
tier, so the release preflight covers them automatically:

- `pnpm check:changes` — every change file names a declared package, a valid
  bump, and a declared section tag.
- `pnpm check:release-sync` — `package.json`, `tauri.conf.json`, `Cargo.toml`,
  and `Cargo.lock` agree on one version, and `CHANGELOG.md` carries that version.

## Preflight

1. Confirm the intended commit is on the release branch and the working tree is
   clean.
2. Run the complete command set in `CONTRIBUTING.md`.
3. Run `pnpm check:docs` with the default review window.
4. Review `NOTICE`, third-party notices, and packaged font licenses.
5. Check security and review records for release blockers.
6. Verify release notes, supported platforms, and compatibility changes.

Never overwrite performance or contract baselines merely to make checks pass.

## Prepare the version

```bash
pnpm release:prepare                # version + CHANGELOG + version files
pnpm release:prepare -- --dry-run   # print the version it would pick
```

`release:prepare` runs `covector version`, which consumes every `.changes/*.md`,
writes the new version into `package.json`, generates the `CHANGELOG.md` entry,
and then invokes `scripts/changelog-normalize.mjs` through its `postversion`
hook. The normalizer restores the repository's format: metadata block and
preamble at the top, a dated `## [X.Y.Z] - YYYY-MM-DD` heading, machine prefixes
stripped. It then runs `pnpm set-version` to propagate the version to
`tauri.conf.json`, `[workspace.package]`, the internal
`[workspace.dependencies]` entries, and `Cargo.lock`.

It refuses to run on a dirty working tree; pass `--allow-dirty` only when you
mean it. Commit the result before building.

### Pre-releases

Put the repository into pre-release mode by adding `.changes/pre.json`:

```json
{ "tag": "beta", "changes": [] }
```

`release:prepare` then produces `X.Y.Z-beta.N`. The first bump of a cycle is
`-beta.0`, and a later bump with an equal or smaller impact becomes
`-beta.N+1`. In this mode the consumed change files are recorded in `pre.json`
instead of being deleted.

To leave pre-release mode, delete `.changes/pre.json` and any leftover change
files, add one change file for the stable version, and run `pnpm release:prepare`
again.

## Build

```bash
pnpm auto-build --version 0.8.0   # signed bundles for macOS (arm64 + x64), Windows, Linux
```

`pnpm auto-build` is the supported path. It handles the cross-target builds, the
updater signing, and the arch-suffixed `.sig` naming that the updater needs.
Always pass `--version` after `release:prepare`: without it `auto-build` derives
its own version from the last tag and would disagree with the prepared tree.

Packaging is deliberately not automated in CI: it needs a native macOS host plus
Docker and `cargo-xwin`, which one runner cannot provide. `docs/ci.md` explains
the constraint and the required secrets.

Install the resulting artifacts and launch them on every published platform.
Collect Web, server/CLI, desktop, source, `LICENSE`, `NOTICE`, and required
third-party license files.

## Publish

```bash
pnpm publish:release --version 0.8.0 --dry-run   # preview
pnpm publish:release --version 0.8.0             # upload, checksums, updater manifest
pnpm release:verify  --version 0.8.0             # confirm downloads and updates work
```

`publish-release.mjs` creates the `vX.Y.Z` release, uploads the artifacts,
generates `SHA256SUMS`, builds the updater manifest from the `.sig` files, and
lastly points the rolling channel tag at it. It requires `RELEASE_TOKEN`. The
manifest is published last so a client never sees a URL before its asset exists.

Then:

1. Publish release notes from `CHANGELOG.md`.
2. Verify the download page, updater metadata, and source links with
   `pnpm release:verify`.
3. Record the release review in `docs/reviews/records/`.

Run the preflight gate first if the revision has not already passed CI:

```bash
# dispatch release.yml, or locally:
pnpm check:all --no-fix
```

Neither release workflow packages anything. `release.yml` re-runs the gate
surface on the revision being released; `release-verify.yml` re-checks a live
release over HTTP (downloads resolve, checksums present, updater manifest
present, and every URL it advertises returns 200). They are separate workflows
with one unconditional job each, so a job can never be skipped into looking like
a pass.

That last check is not ceremony. In-app updates were broken precisely because
nothing ever fetched the manifest URL: the pipeline released on Codeberg while
the updater read a GitHub address that returns 404. Static string assertions
cannot catch that.

Codeberg has no `releases/latest/download/...` path, and `releases/download/latest/...`
resolves to the newest **non**-prerelease — which for this repository is nothing,
since every published release is marked prerelease. That is why the client reads
fixed rolling tags (`stable` for a full release, `beta` for a pre-release).

Current Apache-2.0 releases do not carry GPL reciprocal-source obligations.
Earlier GPL releases remain subject to their original terms.

## Failure recovery

Do not delete or replace a published tag or artifact silently. Mark the affected
release as withdrawn when necessary, publish a corrective release, and document
the incident. Failed workflows may be retried only after confirming that no
partial public artifact exists.
