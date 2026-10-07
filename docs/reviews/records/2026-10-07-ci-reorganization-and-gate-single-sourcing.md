# CI reorganization and gate single-sourcing review

<!-- lissio-review
date: 2026-10-07
scope: Forgejo Actions migration, gate registry, anti-drift verification, release pipeline, updater hosting, and the red gates found underneath
reviewer: Horldsence
verdict: passed-with-conditions
-->

## Scope

Reviewed the replacement of the GitHub Actions workflows with Forgejo Actions
pipelines, the extraction of the gate list into a single registry, the
anti-drift checker that keeps documentation and workflows aligned with it, the
release and post-publish verification path, and the updater endpoint migration
to Codeberg. The review covers a repository whose canonical remote is
`codeberg.org/Horldsence/Lissio` but which still carried three GitHub workflows
that could not run.

## Findings

### The previous CI could not run, and hid a live gate violation

`.github/workflows/{build,lint,release}.yml` were GitHub Actions workflows in a
repository with no GitHub remote. None of them had ever executed. The
consequence was not merely "no CI":

- The 500-line rule for production Rust files existed only inside
  `lint.yml` — the workflow that never ran. It was **currently violated**:
  `backend-cli/src/cmd/mod.rs` was 514 lines. The rule is stated in `AGENTS.md`
  as a repository requirement, so the tree had been failing a stated rule with
  no signal.
- `cargo clippy` and `cargo test` did not compile:
  `app/src/models/catalog/tests.rs` referenced `PanelKind`, `PanelBinding`, and
  `PanelDelivery` without importing them after an earlier catalog split.
- Two `ai-host` prompt tests asserted a Chinese marker (`行动范式`) that
  `default-system-prompt.md` no longer contains, because the prompt had been
  translated to English.

All three are fixed in this change. `cargo test --workspace` now passes
(1515 passed, 0 failed).

### The gate list had drifted across four hand-written copies

`build.yml` ran `check:layers`; `AGENTS.md`, `CONTRIBUTING.md`, and
`.github/PULL_REQUEST_TEMPLATE.md` did not. `CONTRIBUTING.md` additionally
lacked `check:tokens` and `check:motion`. No copy was authoritative, so no copy
could be corrected. This is the structural cause of the above: a rule that lives
in several places is enforced in none.

`scripts/gates.mjs` is now the single source. `scripts/check-all.sh` builds its
plan from it, and `pnpm check:ci-gates` regenerates the documentation blocks and
fails when any of the three documents or the workflows disagree.

### The first version of the anti-drift checker was not good enough

The initial implementation searched the concatenated text of the workflow files
for each gate's command. An independent audit demonstrated **six** realistic
drifts that it passed in green:

1. Deleting the Vitest step while leaving `pnpm test:e2e` — `pnpm test` is a
   substring of `pnpm test:e2e`, so the deleted gate still "matched".
2. Commenting out a gate step.
3. Replacing a step's command with `echo`, leaving the gate name in the step's
   `name:`.
4. Moving a gate into a job guarded by `if:` so it never runs on a pull request.
5. Adding an unregistered `pnpm bench:check` (only gate-shaped prefixes were
   scanned, so a real gate could be added unnoticed).
6. Registering a `full`-tier gate that no workflow runs.

The second implementation parsed the workflow YAML, considered only executable
`run:` steps, resolved pnpm script names and cargo subcommands, and treated job
`if:` conditions as significant. All six above failed correctly. A second
independent audit then defeated it **twelve** more ways, all single-line
edits — a commented-out `# pnpm check:tokens`, `echo "would run: ..."`,
`if false; then ... fi`, an `exit 0` above the command, a here-doc, a trailing
`|| true`, step-level `continue-on-error`, job `if: false` (which YAML parses as
a boolean, collapsing a "no condition" test), `if: event_name == 'push'`,
`if: != 'pull_request'`, a `needs:` chain through a guarded job, and a bogus
`runs-on` label. Every one leaves the gate's command present in the file while
the gate does not run.

That is the point at which the approach was abandoned rather than patched again.
**Deciding by reading shell text whether a command executes is not a solvable
problem**, and each patch moved the hole rather than closing the class.

### The workflows no longer name gates

The design was inverted instead. `.forgejo/workflows/ci.yml` has two jobs, each
running exactly one command: the `pr` tier command and the `full` tier command,
both defined in `scripts/gates.mjs`. No gate is named anywhere in the YAML.

There is therefore no per-gate step to disable. Nothing can be commented out,
echoed, wrapped in a dead branch, hidden in a here-doc, or made non-blocking
one gate at a time, because no gate appears individually. `pnpm check:ci-gates`
enforces the inverse property, which *is* exactly decidable:

- the tier command must appear byte for byte, so appending anything is drift;
- the gate-bearing step must have no `continue-on-error`, no step-level `if`,
  no `|| true`/`exit 0`/`set +e`/leading `!`, and no `needs:` upstream;
- the job must genuinely run on a pull request, including the `if: false`
  boolean case;
- every job must use the runner label registered in `docs/ci.md`, because a job
  on a label no runner carries is never scheduled and looks like a pass;
- no step may name an individual gate.

All fifteen previously demonstrated attacks now fail.

A third independent audit then attacked the inverted design and found seven more
holes, of which four were real and are now fixed:

- **The executable plan was validated by nothing.** `check-all.sh` runs
  `gates.mjs --plan`, not the `GATES` array, so replacing every `cmd` with
  `['true']` — or making the `--plan` branch return early — left CI printing a
  passing summary having run nothing while `check:ci-gates` reported green. The
  checker now rejects no-op commands and verifies that both tiers' plans are
  non-empty and match the registry row for row.
- **A never-true `if:` passed.** `${{ false && github.event_name ==
  'pull_request' }}` contains the pull-request test, so a regex test accepted a
  job that never runs on a PR. The step carrying the PR tier must now have no
  `if:` at all, which removes the need to interpret the expression.
- **`pull_request` filters were not inspected.** `types: [closed]`,
  `paths-ignore: ['**']`, and `branches: [does-not-exist]` all kept the trigger
  key while making the workflow unreachable on an open pull request.
- **The runner label was hijackable by prose.** The label was read from the first
  `--labels <x>:` match anywhere in `docs/ci.md`; a sentence warning against a
  stale label would have been adopted as the expected one, after which every job
  could move to a label no runner carries. It now reads only fenced code blocks.

Three further holes are mitigated rather than closed, and one cannot be closed
from inside the repository at all:

- **Install-time lifecycle hooks** ran before any gate could object. Nothing here
  needs one, so they are now refused, along with `patchedDependencies`.
- **A workflow step that rewrote the gate machinery** left the tier command
  byte-exact while disarming every gate after it. Steps may no longer reference
  `scripts/gates.mjs` or `scripts/check-ci-gates.mjs`.
- **`LOCAL_ONLY_SCRIPTS` was a documented way to silence a gate**, which the
  failure message itself invited. A `check:*` script is now a gate by
  construction and has no allowlist escape; only non-`check:` local variants may
  be declared.
- **The checker cannot police itself.** `check:ci-gates` runs inside the tier it
  verifies, so anyone who edits a gate and the code checking it together gets a
  green build. This is stated in `docs/ci.md` under "What this cannot verify",
  together with the mitigation that would close it — pinning SHA-256 hashes of
  the gate machinery and verifying them as the first CI step, before
  `pnpm install`, using a checker copy from the protected branch. That is not
  implemented; see the follow-ups.

The cost of the inversion is that the checker trusts the registry, so deleting a
gate from `scripts/gates.mjs` had to be addressed separately: `package.json` (every check-shaped script must be
accounted for) and repository structure (`Cargo.toml`, `deny.toml`,
`tsconfig.json`, `vitest.config.ts`, `vite.config.ts`, `playwright.config.ts`,
and the perf baseline each require a corresponding capability) act as anchors
outside the registry, with the anchors living outside the file they protect.
Verified: deleting any of the 22 gates and then running `--fix` — which
regenerates the docs from the registry and would otherwise erase the evidence —
fails in all 22 cases. The earlier version of this anchor allowed a deleted gate
to be silenced by adding it to `LOCAL_ONLY_SCRIPTS`; 16 of 18 gates could be
removed that way, and the failure message advertised the technique. `check:*`
scripts now have no allowlist escape.

### Silent-pass paths were removed

- `check-crate-size.mjs` reported success when it scanned zero files; a wrong
  path would have read as a pass. It now fails loudly when the scan is empty.
- The same script added 1 to the line count for a missing trailing newline,
  which diverged from the original `find | wc -l` rule that counts newlines
  only. Parity with the shell oracle is now exact, verified on synthetic
  fixtures including a 501-logical-line file with no trailing newline.
- `pnpm architecture` prints a useful inventory but has no failure path; it
  cannot block anything. It is now marked `informational` in the registry and
  excluded from the gate count, so "18 gates" does not overstate what is
  enforced. `check:architecture` is the gate that enforces those rules.

### Release packaging does not belong in CI

A single runner cannot produce signed macOS (arm64 and x64), Windows, and Linux
bundles; that needs a native macOS host plus Docker and `cargo-xwin`.
`auto-build.sh` already implements the cross-target builds, signing, and
arch-suffixed `.sig` naming. CI therefore runs preflight gates before a release
and verification after it, and the maintainer packages locally with
`pnpm auto-build`.

An earlier draft gated two jobs on an `inputs.stage` condition. If that form
were unsupported the jobs would be **skipped while the pipeline reported
success** — a silent no-op, the worst available failure mode. It was replaced by
two single-purpose workflows, one job each, with no conditional gating.

### The updater read a host that does not exist

`update_flow` and `tauri.conf.json` pointed at
`github.com/Horldsence/lissio`, which returns 404. The pipeline published to
Codeberg. Nothing ever fetched the URL, because no check made a request. The
endpoints now use Codeberg rolling tags (`stable`, `beta`), and
`pnpm release:verify` performs real HTTP checks after publishing.

Both URL forms commonly assumed to work do not: the GitHub path
`/releases/latest/download/<file>` has no Forgejo equivalent (404), and
`/releases/download/latest/<file>` resolves to nothing on this repository
because every release is marked prerelease. Rolling tags avoid both.

`check:ci-gates` now enforces the updater host statically as well: it rejects
`github.com` in the manifest URLs, rejects the `releases/latest/download` path,
and cross-checks the `tauri.conf.json` endpoint against the Rust constants.

## Follow-ups

1. **Pin the gate machinery and verify it before anything else runs.** Commit
   SHA-256 hashes of `scripts/gates.mjs`, `scripts/check-all.sh`, and
   `scripts/check-ci-gates.mjs`, and check them as the first CI step — before
   `pnpm install`, so an install hook cannot get ahead of it — using a copy of
   the checker taken from the protected branch rather than from the pull request.
   This is the only measure that closes the class in which a gate and the code
   verifying it are edited together. Until it exists, review changes to those
   three files as carefully as production code. Owner: maintainer.
2. **Register the self-hosted runner.** No Forgejo runner is registered yet, so
   no workflow has executed even once. The label is `lissio-ci`. Until this is
   done the new pipelines are as unverified as the ones they replace. Owner:
   maintainer. This is the most important item in this record.
3. **Provide the Tauri system libraries in the runner image.** The `pr` job
   links `webkit2gtk` and GTK; the workflows install none of it deliberately.
   The required package list is in `docs/ci.md`. A missing library fails the job
   at link time, which is a provisioning problem rather than a code problem.
4. **Measure the first real run and confirm the timeouts are right.** Caching is
   in place — `~/.cargo/{registry,git}` and `src-tauri/target`, keyed on
   `src-tauri/Cargo.lock`, with step-level `continue-on-error: true` so an
   unavailable cache service costs time rather than failing the build. It has
   never run, so the 60-minute PR budget and 150-minute full budget are estimates.
   Both jobs run the whole tier through one command now, which is a long single
   step; confirm the totals on the first green run and adjust.
5. **`cargo deny check` fails locally for an environment reason only.** In the
   development sandbox `~/.cargo` is outside the writable area, so it cannot take
   the exclusive lock on `advisory-dbs/db.lock`. Re-run with a writable
   `CARGO_HOME` on the same tree reports `advisories ok, bans ok, licenses ok,
   sources ok` and exits 0, so the gate itself is green. Confirm it on the runner,
   where `~/.cargo` is writable.
6. **Publish the first release that actually carries updater metadata.** No
   published release has `latest.json`, `.sig` files, or `SHA256SUMS`, so in-app
   updates do not work for any current user. `pnpm release:verify` reports this
   correctly today; it should be run against the first release produced by the
   new pipeline.
7. **Replace or clear `scripts/perf-gate.sh`'s silent baseline fallback.**
   A missing baseline currently passes without comparison, and the benchmark
   baseline at `docs/experiments/results/criterion.json` is absent, so
   `pnpm bench:check` would warn and pass. Neither is reachable from CI today,
   but both are the same class of silent pass removed elsewhere in this change.
