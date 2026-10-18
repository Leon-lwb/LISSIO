# Continuous integration and release

<!-- lissio-doc
status: maintained
owner: Lissio maintainers
last-reviewed: 2026-10-18
applies-to: CI platform, runner setup, gate execution, and the release pipeline
-->

## Where CI runs

Lissio is hosted on **Codeberg** (`https://codeberg.org/Horldsence/Lissio`, remote
`codeberg.org:Horldsence/Lissio.git`). CI runs on **Forgejo Actions** using a
**self-hosted runner**.

The workflows live in `.forgejo/workflows/`:

| Workflow | Trigger | Purpose |
| --- | --- | --- |
| `ci.yml` | pull request, push to `main`/`develop`, manual | quality gates |
| `release.yml` | manual dispatch | pre-publish gate preflight |
| `release-verify.yml` | manual dispatch | post-publish verification of a released version |

### Repository composition and checkout

The umbrella repository is a composition of five repositories: `server/` (the Rust Cargo
workspace root) and `client/` (the React frontend plus the Tauri shell) are submodules, and
`server/core`, `server/physical`, and `server/data` are submodules of the server workspace.
Every gate that reads Rust or frontend code therefore depends on those checkouts.

- Each job checks the submodules out **recursively**. The checkout step carries
  `with: submodules: recursive`, and an explicit
  `git submodule update --init --recursive` step follows it: the explicit form works on any
  runner version and is a no-op once the submodules are present. A job that skips either one
  would scan empty directories, and the gates that walk the workspace would report the wrong
  thing rather than fail.
- Dependencies are installed on both sides. The umbrella is a single package with no
  workspace members, so `pnpm install --frozen-lockfile` at the root is paired with
  `pnpm --dir client install --frozen-lockfile`; the frontend gate scripts delegate through
  `pnpm --dir client` and need the client's own `node_modules`.
- `release-verify.yml` needs neither: it inspects a published release over HTTP and reads
  only the umbrella's own scripts and `.changes/`.

### The workflows do not list gates

`ci.yml` names no gate. Its PR job runs one command — the `pr` tier command —
and its full job runs one command, the `full` tier command. Both are defined in
`scripts/gates.mjs` and both drive `scripts/check-all.mjs`, which reads the
registry; `scripts/check-all.sh` is the shell entry point the workflow text names,
and it forwards to that driver unchanged.

That is deliberate, and it is the property the CI design rests on. A workflow
that lists gates as individual steps can be silently defanged: comment a step
out, replace its command with `echo`, wrap it in `if false`, put an `exit 0`
above it, hide it in a here-doc, append `|| true`, or set
`continue-on-error: true`. In every one of those cases the gate's command is
still *present in the file* while the gate does not run. Distinguishing those
cases by reading shell text is not reliably possible — an independent audit
defeated twelve attempts to do exactly that.

A workflow that runs one script and names no gate has nothing to defang. So
`pnpm check:ci-gates` enforces the inverse of the usual rule, and it is a
question with an exact answer:

- every workflow must parse as YAML;
- a workflow that triggers on `pull_request` must run the `pr` tier command
  **byte for byte**, and must name no individual gate;
- the gate-bearing step must be unconditional, must not carry
  `continue-on-error`, must not sit behind a step-level `if`, must not be
  reachable only through `needs:`, and must not swallow its status with
  `|| true` or `exit 0`;
- the job carrying it must be unconditional, and must not depend on another job
  through `needs:`, so it cannot be skipped;
- a workflow counts as providing pull-request coverage only when its
  `pull_request` trigger carries no `types`, `branches`, or `paths` filter, since
  a filter can keep the key while making the workflow unreachable on an open PR;
- every job must use the runner label registered in this document, because a job
  on a label no runner has is never scheduled and looks exactly like a pass.

Adding a gate is therefore a one-file change: register it in `scripts/gates.mjs`
and it runs in CI automatically. No workflow is edited, and no count needs
updating by hand.

### A gate cannot disappear quietly

Inverting the check has one obvious cost: the checker trusts the registry. If
someone deletes a gate from `scripts/gates.mjs`, nothing that verifies the
registry *internally* would notice, and the workflows — which run tiers, not
named gates — would not notice either. Deleting a gate is exactly how a gate
silently stops running, so it needs anchors outside the registry:

- **`package.json`.** Every `check:*`, `lint*`, `test*`, `typecheck`, and
  `architecture` script must be accounted for by a gate. A check script that no
  gate runs is either a dropped gate or an unregistered one; both fail. Scripts
  that are deliberately not gates (the tier drivers `check:all`,
  `check:all:quick`, the writable `lint`/`lint:fix`, the interactive
  `test:watch`) are listed with their reason.
- **Repository structure.** The presence of `server/Cargo.toml`, `server/deny.toml`,
  `client/tsconfig.json`, `client/vitest.config.ts`, `client/vite.config.ts`,
  `playwright.config.ts`, and `docs/performance/frontend-perf.json` each *require* a
  corresponding capability in the registry — a Rust format/lint/test gate, a dependency
  audit, a type check, a unit-test gate, a production build gate, a browser gate, and a
  render-budget gate. These are statements about required capabilities, not a
  second copy of the gate list: they do not care which gate id satisfies them.
- **Gate tiers.** Pull requests are the merge gate, so an enforcing gate runs in
  the `pr` tier unless `scripts/check-ci-gates.mjs` declares it
  complete-flow-only in `FULL_ONLY_GATES` with the reason it cannot run on every
  change — `build-web`, `e2e`, `perf-check`, and `cargo-deny` today. The rule is
  bidirectional: a gate that leaves the `pr` tier without that declaration
  fails, and so does a stale declaration for a gate that has returned. Without
  this anchor, demoting a gate kept every other check green: the documents are
  rendered *from* the registry, so `--fix` regenerated them with no trace of the
  move.

Verified directly: deleting any of the 25 registry entries (24 enforcing gates
plus the informational `architecture-inventory`) and then running
`pnpm check:ci-gates --fix` — which regenerates the documentation from the
registry and would otherwise erase the evidence — fails in all 25 cases.

`informational` is likewise constrained. It excludes a command from the gate
count, so it is limited to commands shown to have no failure path; marking gates
informational in bulk is a check failure, not a way to silence one.

### What this cannot verify

Two limits are worth stating plainly, because a check trusted beyond its reach is
worse than one that is known to be partial.

**The registry is trusted to be complete.** The anchors above catch deletion of a
gate that something else knows about — a `package.json` script, or a capability
implied by files in the tree. A gate with no such anchor could still be removed by
editing `scripts/gates.mjs`. The anchors make that a deliberate, multi-file,
reviewable act rather than a one-line change, which is the achievable goal; they
do not make it impossible.

**The check cannot police itself.** `scripts/gates.mjs`, `scripts/check-all.mjs`,
`scripts/check-all.sh`, and `scripts/check-ci-gates.mjs` are ordinary files in this
repository, and
`check:ci-gates` runs *inside* the tier it verifies. Anyone with commit access can
edit a gate and the code that checks it together, and CI will report green. The
same applies to whatever runs before it: an install hook or an earlier workflow
step that rewrites the machinery would disarm every gate that follows. The checker
refuses the specific shapes it can recognise — it rejects install-time lifecycle
hooks, refuses any step that mentions the machinery, and verifies the executable
plan rather than only the registry — but a determined author is outside what any
in-repo check can stop.

Closing this class properly means verifying the reviewed revision of the gate
machinery *before* anything else runs: commit SHA-256 hashes of those files and
check them as the first CI step, before `pnpm install`, using a copy of the
checker taken from the protected branch rather than from the pull request. That is
not implemented here. Reviewing changes to `scripts/gates.mjs`,
`scripts/check-all.mjs`, `scripts/check-all.sh`, and `scripts/check-ci-gates.mjs`
with the same care as production code is the control actually in force.

### Why the runner is self-hosted

Codeberg's hosted runners are tightly capped: `codeberg-tiny` allows 2 minutes
and `codeberg-medium` 10 minutes, with a stated preference that projects needing
hosted CI use Woodpecker instead. The Rust workspace includes a Tauri build
that links `webkit2gtk`; a cold `cargo test --workspace` alone
exceeds the hosted budget. The gates in `scripts/gates.mjs` therefore run
locally, on the self-hosted runner, and — unchanged — in the release pipeline.

The hosted tier is still usable for cheap, seconds-long jobs, but nothing here
depends on it.

### Registering the runner

The workflows request the label **`lissio-ci`**. Register a runner with that
label, from the Forgejo instance settings (repository or organisation scope):

```bash
forgejo-runner register --no-interactive \
  --instance https://codeberg.org \
  --token   <REGISTRATION_TOKEN> \
  --name    lissio-ci \
  --labels  lissio-ci:docker://catthehacker/ubuntu:act-22.04
```

Then start it:

```bash
forgejo-runner daemon --config config.yml
```

Notes:

- The label must match `runs-on:` in `.forgejo/workflows/*.yml` exactly. Change
  it in the workflow, in this document, and nowhere else — one name, one owner.
- Desktop packaging does not run in CI at all, so no job needs a macOS or
  Windows runner. Keep it that way unless you also add per-platform runner
  labels; a Linux container cannot produce the signed macOS/Windows bundles.
- **The runner image must carry the Tauri system libraries**, because the `pr`
  job runs `cargo clippy --workspace --all-targets` and
  `cargo test --workspace` (through the tier command), which link `webkit2gtk`
  and GTK. The workflows install none of them, on purpose: doing so
  would need root and a package manager the images may not share. Expect to
  provide at least `libwebkit2gtk-4.1-dev`, `libgtk-3-dev`,
  `libayatana-appindicator3-dev`, `librsvg2-dev`, `libxdo-dev`, `libssl-dev`,
  `libudev-dev`, `pkg-config`, and `patchelf`. `catthehacker/ubuntu:act-22.04`
  covers most of it. If these are missing, the `pr` job fails at link time —
  which is a runner-provisioning problem, not a code problem.
- The image also needs Playwright's browser dependencies for the `full` job;
  that job runs `pnpm exec playwright install --with-deps chromium` itself, which
  requires root or a pre-provisioned image.

## The gate list has one owner

`scripts/gates.mjs` is the **single source of truth** for quality gates. It
records, per gate: the stable id, the console label, the working directory, the
argv to run, whether it runs on PRs (`pr`) or only in the complete flow
(`full`), why it exists, and which documents must carry it.

Everything else derives from it:

- `scripts/check-all.mjs` reads its execution plan via `pnpm gates --plan`, so
  local runs and CI run the same list; `scripts/check-all.sh` forwards to it.
- `AGENTS.md`, `CONTRIBUTING.md`, and `.github/PULL_REQUEST_TEMPLATE.md` embed a
  **generated block** between `<!-- lissio-gates:start -->` and
  `<!-- lissio-gates:end -->`.
- `pnpm check:ci-gates` fails when a generated block is stale, when a workflow
  runs an unregistered script, or when a workflow names an individual gate,
  disables the gate-bearing step, or drifts from the tier command.

This structure replaces a hand-maintained list that had been written out four
times and had already drifted: one workflow ran `check:layers` while `AGENTS.md`
and the pull-request template omitted it, and a 500-line source limit existed
only inside a job that could never run, so a 514-line file went unnoticed.

The generated-block reader in `scripts/gates.mjs` normalizes CRLF to LF before
trimming boundary blank lines. Gate descriptions, order, and meaningful
whitespace still compare exactly. A Windows checkout does not need `--fix`
solely because its line endings differ from the generated output.

To change the gate surface:

```bash
# 1. edit the inventory
$EDITOR scripts/gates.mjs
# 2. propagate into the documents
pnpm check:ci-gates --fix
# 3. confirm everything agrees
pnpm check:ci-gates
```

`pnpm gates --list --set pr` prints the PR surface; `--set full` prints
everything; `--json` is available for tooling.

### Gates the registry does not own

The registry describes this repository's gates. The split also gave every repository
its own documentation gate, because a document is checked where it is written:

| Repository | Command |
| --- | --- |
| umbrella (this checkout) | `pnpm check:docs` |
| `server/`, `server/core/`, `server/physical/`, `server/data/` | `node scripts/check-docs.mjs` |
| `client/` | `pnpm check:docs` |

The five copies are byte-identical and each judges only the tree it lives in, so
none of them needs another repository to be present. That is also why the umbrella's
copy does not descend into `server/` or `client/`: in a superproject `git ls-files`
reports a submodule as a single entry rather than as the paths inside it, and the
ownership rule is one repository, one document gate. Each copy checks the
`<!-- lissio-doc -->` metadata, the `docs/README.md` index, every relative link, and
the license fields of the Cargo workspaces rooted in its own repository.

The cross-repository gates in the table above are a different matter: they read
several repositories at once through `scripts/repo-root.mjs`, so they run here, in
the only checkout where all five are present.

## Local equivalents

| Purpose | Command |
| --- | --- |
| Everything, with formatting fixes | `pnpm check:all` |
| PR-tier gates only | `pnpm check:all --quick` |
| Check without writing | `pnpm check:all --no-fix` |
| Show the plan without running it | `pnpm check:all --list` |
| Inspect the registry | `pnpm gates --list` |

A full local run needs Playwright browsers
(`pnpm exec playwright install --with-deps chromium`) and `cargo-deny` 0.20.2.
It also needs both sides installed: `pnpm install --frozen-lockfile` for the
umbrella and `pnpm --dir client install --frozen-lockfile` for the frontend scripts
the registry delegates to. The Rust gates run in `server/`, so `cargo` resolves the
server workspace and its `core/`, `physical/`, and `data/` submodules.

The tier driver is Node (`scripts/check-all.mjs`; `scripts/check-all.sh` forwards
to it), so these commands run on Windows too, where no shell is required. On
Windows the driver first applies `scripts/local-env.mjs`: it points `TMP`, `TEMP`,
and `TMPDIR` at `output/local-tmp` inside the checkout, and removes
cached `msvcrt.lib` stubs that `tauri-build` leaves in
`target/<profile>/build/lissio-<hash>/out`. Without that, MSVC aborts with `cl.exe`
D8050, esbuild aborts `vite build` with `Access is denied`, and the contract
exporter cannot write its output directory — failures that have nothing to do with
the gate that reports them. The build and development scripts run through the same
prelude, so `pnpm build:all` and `pnpm dev:desktop` work there as well. The
render-budget gate still needs bash (Git Bash) on Windows, because it runs
`scripts/perf-gate.sh`.

The build temp environment does not make a Windows installer ready to deliver.
`pnpm build:all` finishes with `scripts/finalize-bundles.mjs`, which raises Low
installer labels to Medium in the original `client/src-tauri/target/release/bundle/`
subfolders and verifies that the bytes are unchanged. Native SID checks in
`scripts/windows-integrity.ps1` avoid localized permission text. A failed check
fails `build:all` and directs the user to run it from an ordinary Windows
terminal. Other platforms skip this step. See
[the release handbook](../RELEASING.md#native-windows-delivery).
This is a native packaging check; Linux CI still does not build desktop installers.

`tauri-build` 2.7.2 also generates the empty MSVC library during a fresh build.
[`client/src-tauri/build.rs`](../client/src-tauri/build.rs) removes only the exact upstream
82-byte COFF placeholder from its own output after Tauri emits its static CRT
link arguments. This prevents the placeholder from shadowing the SDK's real
library in other workspace crates' documentation tests. The runtime link
arguments remain unchanged, and the prelude still handles cached output.

`eslint.config.js` owns the lint input scope. `output/` contains gitignored local
diagnostics, browser-test transforms, and tool temporary files; its generated
contents are excluded by the global `output/**` ignore alongside build and
coverage output. Application code, repository scripts, and browser-test sources
remain subject to their existing lint rules.

Both gate jobs cache `~/.cargo/{registry,git}`, `server/target`, and
`client/src-tauri/target`, keyed on `server/Cargo.lock` and
`client/src-tauri/Cargo.lock`. Clippy and the test suite across the Rust workspace do not fit
comfortably in the job's 60-minute budget on a cold cache, and a timeout there
would fail every pull request with no useful signal. The cache step carries
step-level `continue-on-error: true` — a form Forgejo honours, unlike the
job-level one — so an unavailable cache service costs time rather than failing
the build.

The `full` tier includes browser-based gates, which are the ones most likely to
fail for environmental reasons rather than real defects. `cargo deny check` also
needs a writable `~/.cargo/advisory-dbs`; a read-only cache makes it fail while
acquiring its advisory-database lock, which is an environment problem, not a
gate failure.

`e2e/sliding-pill.spec.ts` samples animation frames and asserts the pill settles
within 1px of its target. Under CPU contention the frames thin out and sampling
can stop mid-interpolation, producing a false failure. It passes 8/8 on an idle
machine. Playwright is therefore configured with `retries: 2` in CI only, so a
genuine regression still fails while a loaded machine does not produce noise.
Flaky browser gates that fail every few runs are worse than useless: they train
people to ignore red.

## Differences from GitHub Actions

Forgejo Actions is GitHub-compatible but not identical. The differences that
matter here:

- **`permissions:` is ignored.** Token scope is whatever the runner was given.
  Do not rely on `permissions:` to restrict a job.
- **Job-level `continue-on-error` is ignored, but the step-level form works.**
  Every *gate* in this repository is meant to block, so no gate carries it. The
  two places it is used are not gates: the cargo cache step (a cache outage
  should cost time, not fail the build) and nothing else. A command that cannot
  fail at all is marked `informational` in the registry rather than given
  `continue-on-error`, and is excluded from the gate count.
- **Action references must resolve from Forgejo's instance.** Use
  `https://code.forgejo.org/actions/checkout@v4` rather than
  `actions/checkout@v4`. Nothing here passes artifacts between jobs, so
  `actions/upload-artifact` and `actions/download-artifact` are not needed.
- **There is no `gh` CLI and no `GITHUB_TOKEN`** for Codeberg. Releases are
  created through the Forgejo REST API with a token, and the environment
  variables are `secrets.*` as configured on the repository.
- **`releases/latest/download/...` does not exist.** See below.

## Release process

Packaging is **not** automated in CI. A release needs signed bundles for macOS
(arm64 and x64), Windows, and Linux. That requires a native macOS host plus
Docker and `cargo-xwin`; a single runner cannot produce all of them, and
cross-building a webkit2gtk-linked Tauri app is not practical.

Maintainers build locally with `pnpm auto-build`, which already implements the
cross-target builds, the signing, and the arch-suffixed `.sig` naming that the
updater needs. CI covers the two stages it is actually good at, in two separate
single-purpose workflows.

**Pre-publish: `release.yml`.** The `preflight` job re-runs the complete gate
surface on the revision being released. A release is the most expensive place to
discover a red gate, and the most expensive to undo. It also refuses to proceed
when `package.json` disagrees with the requested version, so a mismatch fails
before artifacts exist instead of producing mislabelled ones.

**Post-publish: `release-verify.yml`.** The `verify` job re-checks the live
release over HTTP. This is the check whose absence let the in-app updater stay
broken: the old pipeline published on Codeberg while the updater read a GitHub
URL that returns 404, and nothing ever fetched it. Static assertions on URL
strings cannot catch that; `pnpm release:verify` makes real requests and reports
each failure with the reproducing URL.

These are separate workflows rather than two conditionally-gated jobs in one. A
job gated on a condition that a forge does not evaluate is skipped, and a skipped
job looks exactly like a passing one — the pipeline would report success while
checking nothing. One workflow, one job, no conditional no-op.

### Publishing

Publishing is a script, not YAML, so the local and automated paths share one
implementation:

```bash
pnpm auto-build --all                              # build signed bundles locally
pnpm publish:release --version 0.8.0 --dry-run      # preview
pnpm publish:release --version 0.8.0                # publish
pnpm release:verify  --version 0.8.0                # confirm it really works
```

`publish-release.mjs` uploads the artifacts to the immutable `vX.Y.Z` tag,
generates `SHA256SUMS`, builds the updater manifest from the `.sig` files, and
finally points the rolling channel tag at the new manifest. Order matters: the
manifest is published last, so a client never sees a URL before its asset
exists. The manifest's platform URLs point at the immutable version tag rather
than the rolling tag, so a downloaded payload stays traceable to a version.

Set these repository secrets:

| Secret | Purpose |
| --- | --- |
| `RELEASE_TOKEN` | Codeberg token with repository write scope, for the release API |
| `TAURI_SIGNING_PRIVATE_KEY` | Tauri updater signing key |
| `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` | Passphrase for that key |

Without a signing key the script warns and skips the updater manifest rather
than advertising an update the client would reject for having no signature. This
is not hypothetical: no published release currently carries `.sig` files, which
is why in-app updates do not work yet.

Before publishing, prepare and commit the version so the tree matches:

```bash
pnpm release:prepare       # change files → version + CHANGELOG + version files
git commit -am "chore(release): v0.8.0"
```

`release:prepare` consumes the change files in `.changes/`, writes the version
and the `CHANGELOG.md` entry, and then calls `set-version.mjs` to propagate the
base version to `tauri.conf.json`, the Cargo manifests, and `Cargo.lock`. Two
PR-tier gates keep that state honest: `check:changes` validates the change files,
and `check:release-sync` fails when the version fields and `CHANGELOG.md`
disagree. `RELEASING.md` covers the maintainer-facing checklist,
pre-release mode, and the manual fallbacks.

## Updater channels

The in-app updater reads a **static manifest** from a **rolling release tag**.
Two fixed tag names exist for this purpose, and their manifests are replaced on
every release so the client URL never changes:

| Channel | Manifest | URL |
| --- | --- | --- |
| stable | `latest.json` | `https://codeberg.org/Horldsence/Lissio/releases/download/stable/latest.json` |
| beta | `beta-latest.json` | `https://codeberg.org/Horldsence/Lissio/releases/download/beta/beta-latest.json` |

Both are asserted in
`client/src-tauri/crates/update_flow/src/update.rs`.

**Why rolling tags rather than a "latest" URL.** Codeberg does not implement
GitHub's `releases/latest/download/<file>` pseudo-path. Measured against an asset
that exists, `/releases/download/<tag>/<file>` returns 200 while
`/releases/latest/download/<file>` returns 404. A fixed tag name is therefore the
only stable address available. Do not "simplify" these URLs to a `latest` path:
that is precisely the failure this scheme replaced.

Two different things are both called "latest", and neither works here:

- GitHub's path form `/releases/latest/download/<file>` has no Codeberg
  equivalent — Forgejo returns 404 for it. Measured below.
- Codeberg's tag position `/releases/download/<tag>/<file>` *would* accept the
  literal tag `latest`, but `latest` means the newest **non-prerelease**, and
  every release of this project is marked prerelease — so on this repository
  that path also resolves to nothing.

Measured: `/releases/latest/download/Lissio_0.7.2_aarch64.dmg` → 404,
`/releases/download/latest/Lissio_0.7.2_aarch64.dmg` → 404, while
`/releases/download/0.7.2-beta/Lissio_0.7.2_aarch64.dmg` → 200. Rolling tags
avoid the dependency on either notion entirely: they are fixed names we control,
not a forge-computed idea of "newest".

A pre-release updates the beta channel; a full release updates the stable
channel. Drafts never update a rolling channel, so a draft cannot advertise
itself to installed clients.

## Tag naming

Release tags are `vX.Y.Z`, with `-alpha.N`, `-beta.N`, or `-rc.N` appended for
pre-releases. Keep this consistent: `scripts/auto-build.sh` derives the next
version from `git tag --list 'v[0-9]*'`, so an unprefixed tag is invisible to
the bump logic and can produce a lower next version than the one already
released.

Six existing tags do not carry the `v` prefix: four published releases
(`0.6.1`, `0.7.0-rc.1`, `0.7.1-alpha`, `0.7.2-beta`), the reserved rolling tag
`beta` (see below), and `issue-1`, which is not a release. The four release tags
are immutable and left as published; `pnpm release:verify` accepts either form
for an existing release, and `pnpm publish:release` always writes the `vX.Y.Z`
form.

Two tag names are reserved for the updater and are not releases in the version
sense: `stable` and `beta`. They hold the rolling manifests.

## History

This pipeline replaces `.github/workflows/{build,lint,release}.yml`, which were
removed in the same change. They could not run: the repository has no GitHub
remote, so GitHub Actions had no copy of the project, and the updater endpoint
they fed pointed at `github.com/Horldsence/lissio`, which returns 404. Those
files remain recoverable from git history if a GitHub mirror is ever added.

Earlier review records had already logged the mismatch as an open item:
`docs/reviews/records/2026-10-04-fact-consistency-fixes.md` (row 12) and
`docs/reviews/records/2026-10-04-open-source-ip-baseline.md` (row 9).
