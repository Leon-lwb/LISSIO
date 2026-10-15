---
"lissio": patch:fixed
---

Finish `pnpm build:all` by repairing Low-integrity Windows NSIS/MSI installer
labels in the existing project bundle directory and verifying unchanged SHA256
and native integrity SIDs. This prevents NSIS from failing before its welcome
screen with "Error writing temporary file". No separate export command or
external output directory is needed. macOS and Linux retain their normal bundle
outputs and skip the Windows check; checkout-local build temp handling remains.
