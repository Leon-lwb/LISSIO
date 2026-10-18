# Windows transparency and background composition review

<!-- lissio-review
date: 2026-10-15
scope: Windows material fallback diagnosis, single background ownership, theme-editor appearance preservation, generated lint inputs, MSVC doctest linking, and combined quality validation
reviewer: implementation agents and independent documentation review agent; maintainer sign-off pending
verdict: passed-with-conditions
-->

## Scope

Reviewed the root and documentation-area guides, documentation standards,
review checklist, and the implementation sources named in
[Windows desktop rendering](../../../client/docs/architecture/windows-rendering.md).
This record supplements the
[previous acrylic review](2026-10-14-windows-acrylic-backdrop.md),
[development-gate review](2026-10-14-windows-development-gates.md), and
[failed dependency-audit retry](2026-10-14-windows-development-audit-retry.md).
Those historical records remain unchanged. The accompanying
[Rustls security review](2026-10-15-rustls-security-update.md) owns the dependency
update and license-inventory findings.

## Findings

- The window background was painted by both `body` and the full-window App
  wrapper. The node-editor tint was painted by its wrapper, React Flow, and the
  grid SVG background. These repeated alpha colors made the result more opaque
  than the configured token. The fix retains `body` and `.node-editor-rf` as
  the respective background owners while making their redundant containers
  transparent, including the setup and loading wrappers.
- Theme-editor operations invoked the settings callback and then wrote raw
  palette values directly. The second write could replace acrylic RGBA colors
  with opaque theme values. Theme creation, activation, import, reset, and color
  changes now rely on the settings callback and complete appearance application.
  No appearance setting, wire format, or persistence compatibility path changed.
- The targeted component checks passed, including six theme-editor regression
  cases. A browser regression passed for the window/editor background chain in
  both acrylic and opaque modes and for the setup wrapper. These establish
  frontend composition behavior, not native Windows blur.
- A native diagnostic on Windows build 26300 (26H2), with WebView2
  155.0.4283.45, made
  the DOM transparent and retained a visible marker. With the native acrylic
  effect disabled, content behind the window was visible; enabling the existing
  native effect produced a solid gray material. The diagnostic isolated the
  working WebView alpha path from the Windows material fallback. The existing
  Rust shell implementation was retained.
- The interactive user's Windows transparency preference was disabled
  (`EnableTransparency=0`). Microsoft's
  [acrylic guidance](https://learn.microsoft.com/en-us/windows/apps/design/style/acrylic)
  documents solid fallback when Transparency effects is off, when Battery
  Saver applies, and in other unsupported conditions; background acrylic can
  also fall back when a window loses focus. The user authorized and manually
  enabled Windows Transparency effects. Reading back the interactive user's
  preference confirmed `EnableTransparency=1`; `AppsUseLightTheme=0` selected
  dark system app mode.
- Native captures of the corrected ordinary application show the backdrop
  through the client area, with blurred transitions. An independent visible
  Chromium window supplied red/blue halves and black/white stripes; changing
  its colors without moving focus reversed the colors visible through Lissio.
  The independent review inspected the actual desktop-window captures, not
  CDP page screenshots. Recorded cases were:

  | Case | Observation | Local capture |
  | --- | --- | --- |
  | Dark application and dark system; acrylic opacity 0.73, window opacity 1 | Red/blue content remained visible through the normal application and reversed with the fixture; body alpha was 0.608, editor alpha 0.67, and the App wrapper alpha zero | `native-dark-warm.jpg`, `native-dark-cool.jpg` |
  | Light application opposite to dark system; acrylic opacity 0.6 | The normal application revealed and blurred the backdrop after the appearance transition settled | `native-light-cool.jpg` |
  | Application acrylic disabled | The body returned to `rgb(13, 16, 22)` and the normal surfaces hid the colored backdrop | `native-acrylic-off.jpg` |
  | Controlled custom palette through `applyAppearance` | The backdrop remained visible, with body alpha 0.824 and editor alpha 0.843 | `native-custom-theme.jpg` |

  These files and `native-observations.json` are under
  `output/2026-10-15-validation/`. Custom-palette verification used temporary
  in-memory state and the full appearance function; actual ThemeEditor UI
  callbacks are covered separately by the six component tests. The original
  state and appearance were restored without saving diagnostic settings.
- Native verification is limited to this Windows 26H2 host. Windows 10, other
  operating systems, battery-saver transitions, and high-contrast transitions
  were not tested. The captured battery data was raw status 2 at 90% charge,
  and high-contrast flags were 126; Battery Saver was not separately queried.
  The visible successful material is evidence for the capture conditions,
  not a claim that every power or accessibility state was exercised.
- The accompanying lockfile change upgrades only `rustls` 0.23.45 to 0.23.46
  and its checksum. A normal `cargo deny check` has passed all four categories
  with current advisory data, closing the earlier dependency-audit failure.
  The complete gate coverage and corrections are recorded below; the audit
  alone is not a complete passing build.
- The first full-run lint invocation found 64 `no-undef` errors only in
  `output/` browser transforms and the local backdrop fixture. The checkout
  already ignores `/output/` in Git, but ESLint's input configuration had not
  excluded it. The global `output/**` ignore now excludes those generated
  diagnostics and temporary files. No source rule was disabled or weakened.
  Independent scope checks confirmed that App, ThemeEditor, repository scripts,
  and the browser regression remain lint inputs; an in-memory script probe
  still produced an error for an undefined name. No files under `output/` are
  tracked. The full unchanged `pnpm lint:ci` then exited successfully, with the
  original caches and first failure retained. Evidence is in
  `output/check-all/13-ESLint-zero-warnings.log` and
  `output/2026-10-15-validation/lint-after-output-fix.log`. The complete lint
  command also passed after the build-script correction, recorded in
  `output/2026-10-15-validation/lint-after-build-fix.log`.
- The first complete workspace test command reached a `lissio-filter`
  documentation test that failed to link CRT symbols. Both downloaded
  `tauri-build` 2.6.3 and 2.7.2 sources generate the same 82-byte empty
  `msvcrt.lib` in the application's build output. This corrects the
  [October 13 portability review](2026-10-13-check-platform-portability.md):
  2.7.2 does not switch this file to a content-hashed name, and the failure can
  recur during a fresh build. The historical record remains unchanged.
- After `tauri_build::build()`, `src-tauri/build.rs` now removes only the exact
  upstream placeholder from its own `OUT_DIR` on MSVC targets. The match
  requires all 80 payload bytes and either upstream x86/x86-64 machine header;
  independent byte comparison confirmed both upstream versions match.
  Nonmatching files remain untouched. The emitted static CRT link arguments
  are unchanged. The existing local-environment prelude still handles cached
  candidates, and its comments now distinguish its size/symbol checks from
  the new exact-byte check. `docs/ci.md` records both responsibilities.
- The full driver executed all 24 enforcing gates plus the informational
  architecture inventory. Its original result was exit 1: 23 entries passed
  and two failed, in 3,593 seconds. The two failures were the generated lint
  inputs and the CRT documentation-test link failure described above. The
  complete failed commands and affected Rust checks were rerun after their
  fixes; no test selection, ignored-test marker, advisory rule, or performance
  baseline was changed to obtain passing results. This is complete gate
  coverage assembled from the full run and corrective reruns, not a claim
  that one `check:all` invocation exited successfully.

  | Required scope | Final recorded result | Evidence |
  | --- | --- | --- |
  | Architecture, dependencies, Tauri versions, command and wire contracts, model catalog, tokens, motion, layers, documentation, and gate registry (11 gates) | Passed | `output/check-all/01-*.log` through `11-*.log` |
  | TypeScript, zero-warning ESLint, and frontend unit tests (3 gates) | Passed; 198 test files and 1,415 tests | `12-*.log`, `14-*.log`, and the two complete lint-rerun logs above |
  | Rust source size, formatting, workspace Clippy, and workspace tests (4 gates) | Passed; complete Clippy and test reruns after the build fix reported 211 test-result groups, 1,500 passed, zero failed, two existing ignored, zero filtered | `15-*.log` through `18-*.log`; `clippy-after-build-fix.log` and `cargo-test-after-build-fix.log` under `output/2026-10-15-validation/`; post-fix `cargo fmt --check` exited 0 |
  | Change-file validity and release synchronization (2 gates) | Passed | `output/check-all/19-*.log` and `20-*.log` |
  | Production web build, full browser suite, and render budget (3 gates) | Passed; 15 browser tests and three performance scenarios, with no budget regression | `output/check-all/21-*.log` through `23-*.log` |
  | Full dependency audit (1 gate) | Passed: advisories, bans, licenses, and sources | `output/check-all/24-cargo-deny.log` |

  The inventory report in `00-Crate-architecture-inventory.log` is
  informational and is not counted as an enforcing gate. The complete driver
  summary remains in `output/2026-10-15-validation/check-all-summary.log`.
  Final architecture and Rust-size checks also exited 0, recorded in
  `output/2026-10-15-validation/architecture-final.log` and
  `output/2026-10-15-validation/rust-size-final.log`.
  Process-local `CARGO_BUILD_JOBS=1` limited build concurrency without reducing
  test scope. The two existing ignored cases are the manual release-mode
  sustained-throughput test and the frame-decoder `test_data` documentation
  example. Clippy still reports the toolchain's existing unknown
  `clippy::assert_is_empty` lint warning; a successful exit does not imply zero
  warnings. The dependency audit also retains its documented policy warnings.
- The additional `cargo build -p lissio` after removing the placeholder exited
  0 in 17.07 seconds. Independent comparison of the before/after `dumpbin`
  output found the same 29 imported DLL names, with no additions or removals.
  The emitted static CRT arguments and the observed desktop DLL dependencies
  are preserved. Evidence is in `desktop-build-after-msvcrt-fix.log`,
  `desktop-imports-before-build-fix.log`, and
  `desktop-imports-after-build-fix.log` under `output/2026-10-15-validation/`.
  The final comment-only script correction also passed
  `pnpm exec eslint scripts/local-env.mjs --max-warnings 0`.
- Checklist review: the new current document is English, names its code
  authority, has current metadata, and is indexed in `docs/README.md`. Both new
  review records are indexed separately. The background ownership claims match
  the owning CSS and components. No legal text, project license, published
  version, performance baseline, or existing historical record is changed by
  this documentation work. The dependency review covers the regenerated
  third-party inventory. Agent review does not constitute human maintainer
  sign-off.
- The closing documentation gate (`node scripts/check-docs.mjs`, the command
  behind `pnpm check:docs`) passed after the final record text and index
  update: 64 workspace packages use Apache-2.0 and 64 authoritative documents
  are indexed.
- Conclusion: the reported host's native appearance, complete enforcing-gate
  scope, and desktop-link behavior have passing evidence after the documented
  corrections. The verdict is `passed-with-conditions` for the explicit
  platform coverage limits and actual maintainer review below. It does not
  waive a failed gate or claim a release has been approved.

## Follow-ups

1. Complete actual maintainer checklist review separately from agent review
   and commit signing. Owner: Lissio maintainers. Due: before merge or release;
   review date: 2026-10-15.
2. Preserve the untested Windows 10, power-state, accessibility-state, and macOS
   conditions as explicit coverage limits. Verify those conditions before
   claiming equivalent native coverage. Owner: Lissio maintainers. Due: before
   expanding the supported-behavior claim in a release or platform change;
   review date: 2026-10-15.
