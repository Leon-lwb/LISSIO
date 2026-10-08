# Architecture Cleanup Register (2026-09)

<!-- lissio-doc
status: maintained
owner: Lissio maintainers
last-reviewed: 2026-10-07
applies-to: Open structural debt inherited from the September 2026 architecture review
-->

This register follows [`architecture-review-2026-09.md`](architecture-review-2026-09.md).
It records structural debt and acceptance criteria without duplicating established
architecture.

## Documentation alignment completed

- `crates.md` is the single authority for domains, layers, and workspace crates.
- `data-plane.md` uses real crate paths and the `waveform_pyramid_bench`,
  `ingest_bench`, `eval_bench`, and `pipeline_soak` benchmarks.
- `exits.md` reflects the supervised sidecar; Tauri is not a business adapter.
- Shared model documentation describes current owners, contracts, and boundaries.

## Remaining structural debt

| Debt | Impact | Acceptance criterion |
| --- | --- | --- |
| Remove dead Tauri command and host modules when they are no longer referenced | Dead paths suggest an obsolete business exit | Workspace checks pass and no references remain |
| Keep crate responsibility metadata substantive | Architecture output cannot explain why a crate exists | Each affected crate declares a real, specific responsibility |
| Reject placeholder architecture metadata | Placeholders can pass CI | The gate rejects empty or generic responsibility strings |
| Evaluate `pipeline` only when evidence justifies a split | It owns routing, evaluation scheduling, recording bindings, and diagnostics | Split only for measurable change-frequency, isolation, or benchmark benefit; never create a facade merely to reduce dependencies |
| Align `automotive*` layer semantics or document why they differ | Similar adapter names currently span different layers | Layer meanings are consistent or explicitly justified |
| Keep frontend modules within responsibility and size limits | Transport, stores, AI, and charts can mix again | Split oversized files without changing public behavior |
| Preserve benchmark evidence when trends are needed | Source benchmarks alone do not record hardware or historical raw output | Record machine, revision, raw data, statistics, and reproduction commands when comparing trends |

## Verification

Run the complete gate set in `CONTRIBUTING.md`. A green subset is not a green
build.
