---
"lissio": patch:security
---

Update the locked `rustls-webpki`, `webpki-roots`, and `webpki-root-certs` to
the releases that reject certificate paths built on the distrusted emSign
intermediates (RUSTSEC-2026-0381, RUSTSEC-2026-0382, RUSTSEC-2026-0383), without
relaxing dependency audit policy. `server/`, `server/data/`, and
`client/src-tauri/` all resolve the patched versions.

Every cargo gate now passes `--locked`, and `server/data/Cargo.lock` is refreshed
for the `lissio-flow` dependency the contract crates gained. The data-suite
lockfile had been stale since the catalog v3 contract change, which no gate
caught because none of them asserted the lockfile: `cargo metadata --locked`,
clippy, tests, and `cargo deny` all resolved it silently, so only a `--locked`
release build would have failed.

The same audit found two lint errors in the contract layer that clippy reports
only inside its own workspace, because it is a path dependency rather than a
member of the server workspace; both are fixed without a behaviour change.
