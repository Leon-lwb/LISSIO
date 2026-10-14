---
"lissio": patch:fixed
---

The desktop shell no longer refuses to start when the log file cannot be
created. `tauri-plugin-log` resolves the log directory, creates it, and opens the
file inside its plugin initialization, so any failure there surfaces as
`PluginInitialization("log", …)` from `tauri::Builder::build()`: on Windows this
aborted startup with "拒绝访问。 (os error 5)" before a single window or the server
sidecar existed, and no log line could record why. The shell now probes the same
path before registering the plugin — create the directory, reject a directory
where the log file belongs, and open the file the way the plugin will — and hands
the plugin an explicit `TargetKind::Folder`. When the conventional directory
(`%LOCALAPPDATA%\top.pengheng.lissio\logs` on Windows, `~/Library/Logs/<id>` on
macOS) is not usable, logging continues in `<temp>/lissio-logs` and the reason,
with both paths, is printed to stderr and written through the logger; if neither
directory works, the file target is dropped and stdout/webview logging keeps the
application usable. `lissio-server.log` follows the same resolved directory, so a
blocked log directory can no longer take the backend sidecar down with it. The
file name, log directory, and rotation behavior are unchanged when the directory
is writable.
