---
name: Feature request
about: Suggest an idea for Lissio
title: '[Feat] '
labels: enhancement
assignees: ''

---

<!-- lissio-doc
status: maintained
owner: Lissio maintainers
last-reviewed: 2026-10-07
language: en
authoritative: true
applies-to: Lissio community issue intake
-->

**Is your feature request related to a problem? Please describe.**
A clear and concise description of what the problem is. Ex. When monitoring a high-rate serial stream, I'm always frustrated when [...]

**Describe the solution you'd like**
A clear and concise description of what you want to happen. If it involves a specific area (widget, protocol parser, node graph, transport, CAN diagnostics, ...), name it.

**Describe alternatives you've considered**
A clear and concise description of any alternative solutions, workarounds, or features in other tools (e.g. the VOFA+ or another compatible tool) you've considered.

**Mockups / references (optional)**
Screenshots, sketches, links to similar implementations, or protocol documents that help explain the request.

**Are you willing to submit a PR for this feature?**
Yes / No / Need guidance.

> Note: AI-assisted ("vibe") PRs are welcome, but they must meet the hard requirements in [`docs/AGENTS.md`](/docs/AGENTS.md) — all checks (`pnpm typecheck`, `pnpm test`, `cargo test --workspace`, `cargo clippy --workspace --all-targets` with zero new warnings) must actually be run and pass, UI changes must be verified in `pnpm tauri dev`, and the code must not contain session traces (Stage/Phase/Task markers). Unverified PRs will be asked to rework.

**Additional context**
Add any other context about the feature request here.
