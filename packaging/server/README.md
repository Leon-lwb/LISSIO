# Lissio Backend/CLI

- macOS/Linux: run `./start.sh`.
- Windows: run `./start.ps1` from PowerShell.
- The server listens on `127.0.0.1:8790` by default. Its generated token is stored under `data/server-token`.
- Use `LISSIO_TOKEN` to provide a fixed token, `LISSIO_BIND=0.0.0.0` for remote access, and `LISSIO_CONFIG_DIR` for another persistent directory.
- `backend-cli --help` lists automation and maintenance commands.

Do not expose a non-loopback server without a strong token and appropriate network controls.
