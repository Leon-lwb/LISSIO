---
"lissio": patch:fixed
---

Use a persistent checkout-local WebView2 profile for `pnpm dev:desktop` on
Windows, avoiding startup failures caused by an unavailable installed-app
profile. Development browser data stays in `output/desktop-webview` between
restarts. An explicit `WEBVIEW2_USER_DATA_FOLDER` still takes precedence, and
existing application data is preserved.

Fix `pnpm check:ci-gates` falsely reporting generated documentation drift in
CRLF and mixed-line-ending checkouts. Line endings are normalized before
surrounding blank lines are removed; command and content changes still fail
the gate.
