# Third-Party License Inventory

<!-- lissio-doc
status: maintained
owner: Lissio maintainers
last-reviewed: 2026-10-11
applies-to: Dependency policy, current snapshot, special obligations, and review workflow
-->

This document records third-party license facts and manual obligations. The
machine allow-list is `src-tauri/deny.toml`; this file explains and audits it.

## Reproduction

```bash
cargo metadata --format-version 1 --manifest-path src-tauri/Cargo.toml
pnpm licenses list --json --prod
pnpm licenses list --json
cargo deny check
```

`cargo deny check` covers Rust advisories, licenses, bans, and sources. The
frontend inventory is generated with pnpm and reviewed when dependencies change.

## Rust snapshot

The current graph contains 772 external crates. Frequent SPDX expressions are:

| Expression | Packages |
| --- | ---: |
| `MIT OR Apache-2.0` | 363 |
| `MIT` | 163 |
| `Apache-2.0 OR MIT` | 66 |
| `MIT/Apache-2.0` | 34 |
| `Apache-2.0` | 26 |
| `Zlib OR Apache-2.0 OR MIT` | 23 |
| `Unicode-3.0` | 18 |
| `Unlicense OR MIT` | 10 |
| `Apache-2.0 WITH LLVM-exception OR Apache-2.0 OR MIT` | 7 |
| `MPL-2.0` | 6 |

Special selections:

| Package | Expression | Selection |
| --- | --- | --- |
| `unescaper` 0.1.10 | `MIT OR GPL-3.0-only` | Use the MIT branch; do not select GPL-3.0-only |
| two crates | `MIT OR Apache-2.0 OR LGPL-2.1-or-later` | Use MIT or Apache-2.0 |
| `dompurify` | `MPL-2.0 OR Apache-2.0` | Use Apache-2.0 |

The project does not allow single-license GPL, AGPL, SSPL, BUSL, Elastic, or
commercial-only dependencies in linked production code. Dual-license packages
must select an allowed branch. MPL-2.0 dependencies are allowed with file-level
copyleft handling.

## Frontend snapshot

Production contains 391 packages; the complete graph contains 820 packages.

| Expression | Production | Including development |
| --- | ---: | ---: |
| MIT | 325 | 673 |
| ISC | 38 | 58 |
| Apache-2.0 | 7 | 36 |
| BSD-3-Clause | 8 | 14 |
| BSD-2-Clause | 1 | 10 |
| `MIT OR Apache-2.0` | 4 | 4 |
| `Apache-2.0 OR MIT` | 1 | 3 |
| `(MPL-2.0 OR Apache-2.0)` | 1 | 1 |
| MPL-2.0 | 0 | 3 |
| CC0-1.0 | 1 | 2 |
| MIT-0 | 0 | 2 |
| Python-2.0 | 0 | 1 |
| BlueOak-1.0.0 | 0 | 6 |
| CC-BY-4.0 | 0 | 1 |
| ODC-By-1.0 | 0 | 1 |
| Unknown (manually reviewed `khroma`) | 1 | 1 |
| Unlicense | 1 | 1 |
| OFL-1.1 | 1 | 1 |
| GSAP standard no-charge terms | 2 | 2 |

## Manual obligations

| Item | License or terms | Handling |
| --- | --- | --- |
| MiSans font subsets | MiSans Font License | Keep attribution in About, ship the license text, and confirm whether subsetting is permitted |
| Maple Mono CN | SIL OFL 1.1 | Ship the license text and preserve font names |
| JetBrains Mono | SIL OFL 1.1 | Preserve package license when distributed |
| GSAP | Custom standard no-charge license | Re-read terms on upgrades; never describe as MIT |
| `serialport` | MPL-2.0 | Avoid modifying vendored source; publish modified MPL files if necessary |
| `liquid-gl` | MIT | Preserve its license when bundled |
| `khroma` | MIT found in package license file | Record the manual result despite missing package metadata |
| dev-only attribution datasets | CC-BY-4.0, ODC-By-1.0 | Keep attribution; verify they are not shipped |

Font license files must accompany every distribution that includes fonts. The
application attribution source is `src/lib/fontAttributions.ts`.

The Tauri store plugin is not a dependency; settings persistence uses the
existing backend HTTP client. No new third-party dependency is required.

## Dependency review

1. Register Rust versions in `[workspace.dependencies]` or frontend versions in
   `package.json`.
2. Inspect actual package metadata and license files.
3. Confirm the SPDX selection is allowed and record OR-branch choices.
4. Classify permissive, file-level copyleft, weak copyleft, custom terms, and
   missing metadata.
5. Run `cargo deny check`, `pnpm check:deps`, and `pnpm check:docs`.
6. Update this inventory and the review record.

Do not weaken `src-tauri/deny.toml` merely to pass a gate. New identifiers
require an explicit policy decision and review record.
