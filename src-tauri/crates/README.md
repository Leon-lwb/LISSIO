# Crate domains

Crates are grouped by business domain: `crates/<domain>/<crate>`.
The directory is for navigation only; dependency direction is defined by each
crate's `[package.metadata.lissio]` entry and checked by
`pnpm check:architecture`.

Do not add layer directories or facade crates. A crate may directly depend on
any allowed lower layer.
