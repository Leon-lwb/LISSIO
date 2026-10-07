# Change files

A pull request that changes user-visible behaviour, contracts, packaging, or
commands adds **one** Markdown file here. `pnpm release:prepare` consumes these
files to decide the next version and to build the `CHANGELOG.md` entry, so the
release notes are written by the people who made the change instead of being
reconstructed at release time.

```markdown
---
"lissio": minor:added
---

Added a configurable acquisition-device panel with USB metadata.
```

The filename is free (`acquisition-panel.md`); it only needs to end in `.md`.

## Front matter

`"<package>": <bump>[:<tag>]`. Lissio ships one product version, so the package
is always `lissio`.

| Bump | Meaning |
| --- | --- |
| `major` | Incompatible change to a published contract |
| `minor` | Backwards-compatible feature |
| `patch` | Backwards-compatible fix |
| `noop` | Recorded but does not raise the version (documentation-only or housekeeping) |

The optional tag selects the `CHANGELOG.md` section. Sections render in the
order declared by `changeTags` in `config.json`:

| Tag | Section |
| --- | --- |
| `added` | Added |
| `changed` | Changed (default when no tag is given) |
| `deprecated` | Deprecated |
| `removed` | Removed |
| `fixed` | Fixed |
| `security` | Security |
| `performance` | Performance |
| `ci` | CI |

Everything after the closing `---` is the summary: prose, no headings needed.

## Checks

`pnpm check:changes` validates every file here — unknown package names, unknown
tags, invalid bump types, and missing summaries fail the PR gate rather than
being dropped silently at release time. `README.md` is not a change file.

## Prereleases

`pre.json` in this directory puts the repository in prerelease mode:

```json
{ "tag": "beta", "changes": [] }
```

`pnpm release:prepare` then bumps to `X.Y.Z-beta.N` and records consumed change
files in `pre.json` instead of deleting them. Delete `pre.json` and any leftover
change files, add one change file for the stable version, and run
`pnpm release:prepare` again to leave prerelease mode. See `RELEASING.md`.
