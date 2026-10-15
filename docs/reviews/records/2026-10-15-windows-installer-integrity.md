# Windows installer integrity and delivery review

<!-- lissio-review
date: 2026-10-15
scope: NSIS temporary-file startup failure, native Windows installer labels, and byte-preserving delivery export
reviewer: implementation agent; maintainer sign-off pending
verdict: passed-with-conditions
-->

## Scope

Reviewed the root build and release instructions, the earlier
[local environment review](2026-10-14-windows-local-run-environment.md),
`scripts/local-env.mjs`, `scripts/build-desktop.mjs`,
`scripts/export-windows.mjs`, `scripts/windows-integrity.ps1`, and their tests.
External authorities are Microsoft's
[Mandatory Integrity Control documentation](https://learn.microsoft.com/en-us/windows/win32/secauthz/mandatory-integrity-control)
and the resolved NSIS 3.11
[startup source](https://github.com/nsis-dev/nsis/blob/v311/Source/exehead/Main.c).

## Findings

- The 2026-10-15 12:20 local NSIS file had SHA256
  `f9cb233796322533f47816c1a783a4b4b09535363c07415476392379bc1a4ea5`.
  Its length matched the NSIS header, and its calculated CRC32 matched the
  embedded `eee611a2`. The file and checkout output directories had inherited
  Low integrity (`S-1-16-4096`). The user Temp directory had implicit Medium
  integrity, and its `Low` child was absent.
- A new file written from the same installer bytes into an ordinary directory
  had Medium integrity (`S-1-16-8192`) and the identical SHA256. It opened the
  NSIS welcome page and completed installation into a dedicated validation
  directory. This confirms the metadata-dependent failure independently of
  recompilation or a temp-variable change.
- The earlier temp relocation only changes the build process and its children;
  it does not change persisted user or machine variables. It remains necessary
  for restricted MSVC and esbuild processes. NSIS fails before loading its
  script, so application logging fallback and `.onInit` are not remedies.
- Native Windows builds now record the changed installer files and hashes,
  excluding untouched bundles from earlier builds. Independent export validates
  that record; explicit `--bundle-dir` selects a direct Tauri build instead.
  Export streams bytes into unique new files, checks hashes and native numeric
  integrity SIDs, and renames verified files into the delivery directory. No
  checkout ACL, global environment variable, execution policy, or application
  Rust API is changed. A failed export returns nonzero with a recovery command.
- Native acceptance completed on this host: the installed application displayed
  its main UI; both installed executables had Medium integrity; the supervised
  server emitted `LISSIO_READY`; and silent uninstallation removed the dedicated
  validation installation while retaining application user data. No desktop
  shortcut was requested for the validation installation.
- `pnpm build:desktop` completed through the new wrapper, produced both bundles,
  recorded only the newly written files, and successfully exported them. The
  resulting NSIS SHA256 is
  `9092501abd6e33c46b4047b05a0c6d13fbf0b017b8df1932b9ef58261c3c635a`;
  MSI SHA256 is
  `65af31333966236a1ef35fd6812af40cc13ed7b9d3565251962c849c7d22f3c2`.
  Both exported files have Medium integrity and match their source bytes.
  Evidence is in `output/nsis-validation/desktop-build.log`,
  `export-final.log`, and `installed.stderr.log`, plus the native UI observations
  in the implementation chat.
- The complete `pnpm check:all --no-fix` run passed all 24 enforcing gates and
  the informational architecture inventory. This includes 199 frontend test
  files and 1,430 tests, Rust workspace formatting/Clippy/tests, production web
  build, browser E2E, render budget, and `cargo deny`. The summary is retained
  in `output/nsis-validation/check-all-summary.log`; individual gate logs are
  under `output/check-all/`. Existing compiler and tool warnings remain visible;
  no rule or baseline was weakened.
- A real Low-integrity Node process exposed that PowerShell's `Add-Type`
  compiler cannot start at that integrity level. The process pre-flight now
  reads the numeric SID from native `whoami` CSV before any compilation;
  file labels still use Windows APIs. The repeated real Low-process check exits
  1 with `S-1-16-4096` and the ordinary-terminal recovery command, while ordinary
  export succeeds. After this final pre-flight adjustment, all 15 export tests
  and the full zero-warning ESLint gate passed again. Evidence is in
  `low-process-export-final.log`, `export-tests-final.log`, and `lint-final.log`
  under `output/nsis-validation/`.
- The export preserves package bytes, updater-signature validity, and existing license
  and notice contents. No dependency, published version, changelog, baseline,
  or historical review record is changed. Checklist review confirms that the
  updated English documents name implementation authority and the new record
  is indexed. Agent review is not human maintainer sign-off.

## Follow-ups

1. Complete actual maintainer checklist review. Owner: Lissio maintainers.
   Due: before merge or release; review date: 2026-10-15.
2. Run the installation acceptance sequence on every published Windows version
   and architecture; this host's verification does not establish that coverage.
   Owner: Lissio maintainers. Due: before release; review date: 2026-10-15.
