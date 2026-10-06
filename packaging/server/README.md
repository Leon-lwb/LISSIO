# Lissio Backend and CLI Package

<!-- lissio-doc
status: maintained
owner: Lissio maintainers
last-reviewed: 2026-10-07
language: en
authoritative: true
applies-to: Standalone server and headless CLI runtime package
-->

- macOS/Linux: run `./start.sh`.
- Windows: run `./start.ps1` from PowerShell.
- The server listens on `127.0.0.1:8790` by default. Its generated token is stored under `data/server-token`.
- Use `LISSIO_TOKEN` for a fixed token, `LISSIO_BIND=0.0.0.0` for remote access, and `LISSIO_CONFIG_DIR` for another persistent directory.
- Run `backend-cli --help` to list automation and maintenance commands.

Do not expose a non-loopback server without a strong token and appropriate network controls. The package must include `LICENSE`, `NOTICE`, and applicable third-party notices.
