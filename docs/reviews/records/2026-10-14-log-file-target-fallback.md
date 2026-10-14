# Log file target fallback review

<!-- lissio-review
date: 2026-10-14
scope: Desktop startup dependency on a writable log directory — plugin initialization, log-path resolution shared with the server sidecar, and the degraded targets
reviewer: implementation agent; maintainer sign-off pending
verdict: passed-with-conditions
-->

## Scope

Read `src-tauri/src/lib.rs` (log plugin registration), `src-tauri/src/sidecar.rs`
(sidecar log path), the resolved `tauri-plugin-log` 2.9.1 sources
(`acquire_logger`, `RotatingFile`), `tauri` 2.12.3 (`Builder::build`,
`PluginStore::initialize_all`, `PathResolver::app_log_dir`, `AppManager::with_handlers`),
and `tauri-codegen` 2.7.2 (`package_info`). The subject is a Windows startup abort:

```text
thread 'main' panicked at src\lib.rs:75:10:
error while building tauri application: PluginInitialization("log", "拒绝访问。 (os error 5)")
```

## Findings

- The failure is not a logging inconvenience, it is a startup gate. The plugin's
  `setup` closure runs inside `Plugin::initialize`, which `AppManager::with_handlers`
  runs from `Builder::build`; `PluginStore::initialize_all` maps any error to
  `Error::PluginInitialization("log", …)`. `.expect(…)` at `lib.rs:75` therefore
  panicked before `run()`, before any window, and before the sidecar started.
- The io error comes from `acquire_logger`: `app_log_dir()` → `create_dir_all` →
  `RotatingFile::new` → `OpenOptions::create(true).append(true).open(…)`. The
  plugin reports the io error but never the path, which is why the panic names no
  directory.
- Retrying `build()` without the file target is not an option: the runtime and the
  event loop are created by `AppManager::with_handlers` *before*
  `initialize_plugins` (app.rs:2607), so a second `Builder::build` would fail on a
  second event loop. The pre-flight has to happen before the first `build()`.
- The path cannot be obtained from tauri: `PathResolver::app_dir` is `pub(crate)`.
  The rule is therefore mirrored from `PathResolver::app_log_dir` (macOS
  `~/Library/Logs/<identifier>`, otherwise `<data_local_dir>/<identifier>/logs`)
  and the base directory is resolved with the same `dirs` crate and major version
  tauri uses, so the two cannot disagree about the platform convention.
- `sidecar.rs` resolved `app_log_dir()` itself and opened `lissio-server.log`
  there, so a blocked log directory would also have failed the sidecar — logging
  degradation would have taken the backend down with it. Both now use the one
  directory the shell verified.
- The log file name is not "whatever the plugin feels like": the plugin uses
  `package_info().name`, which `tauri-codegen` fills from `productName`, and the
  existing file on a working installation is `Lissio.log` (capital L). The
  pre-flight therefore takes `file_name` from `context.package_info().name`
  instead of hardcoding a name, and passes it through `TargetKind::Folder`, so the
  probed file and the written file are the same one.
- `window-vibrancy` 0.6 → 0.8 and the acrylic work in the previous commit are
  unrelated: the lockfile diff across those commits touches no other crate, and
  `tauri-plugin-log` has been pinned at 2.9.1 since `a227d846`.

## Changes

- `src-tauri/src/logging.rs` (new): `targets(identifier, file_name)` assembles
  stdout + [probed file target] + webview; `plan`/`plan_for` implement the primary →
  `<temp>/lissio-logs` → no-file-target chain; `prepare` mirrors the plugin's
  directory creation, rejects a directory in place of the log file, and opens the
  file with `create + append`. `resolved_log_dir()` exposes the directory that was
  actually chosen, and `report_degradation()` re-emits the reason through the
  logger once it exists (stderr is invisible in a release build).
- `src-tauri/src/lib.rs`: builds the context once, feeds
  `logging::targets(&identifier, &package_info().name)` to the plugin, and reports
  the degradation from `setup`.
- `src-tauri/src/sidecar.rs`: `lissio-server.log` now follows
  `logging::resolved_log_dir()`, falling back to tauri's own resolver.
- `src-tauri/Cargo.toml`: adds `dirs = "7"` (workspace dependency), the same line
  tauri resolves.

## Verification

- `cargo test -p lissio --lib`: 10 tests, including the platform layout rule
  (both shapes), the file-name collision case, and both `plan_for` outcomes.
- Smoke run of the built binary with a hermetic `HOME`/`TMPDIR`:
  - healthy: the application ran, `Lissio.log` and `lissio-server.log` appeared in
    `~/Library/Logs/top.pengheng.lissio`, no fallback directory was created, and
    the file name is still capitalized;
  - primary directory occupied by a file: the application ran, stderr carried
    `日志目录 … 不可写 (建目录 … 失败: File exists (os error 17)), 本次写入 …/lissio-logs`,
    the same line was written through the logger, and both log files landed in the
    fallback directory.
- Not verified on Windows hardware: the os error 5 variant is the same code path
  (create/open) with a different errno, and the Windows path shape is unit-tested
  rather than executed.

## Follow-ups

1. Maintainer sign-off.
2. Windows pass (owner: maintainers): reproduce the original panic directory state
   and confirm the application now starts, logs the reason, and that
   `%TEMP%\lissio-logs` receives `Lissio.log` and `lissio-server.log`. The root
   cause of the unwritable directory itself (permissions, read-only attribute, or
   a file where a directory belongs) is an environment fact this change reports
   instead of guessing.
3. Rotation is unchanged (`KeepOne`, 40 KB, append): the pre-flight covers
   directory creation and opening the file, not the delete/rename that a rotation
   performs when the existing log already exceeds the limit. A rotation denied by
   a lock still surfaces as the original `PluginInitialization` panic; narrowing
   that would mean owning rotation in the shell.
