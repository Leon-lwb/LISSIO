---
"lissio": minor:changed
---

Releases are now prepared from change files instead of a hand-picked version.
Contributors record each change in `.changes/`, and `pnpm release:prepare`
derives the next version, generates the `CHANGELOG.md` entry, and synchronizes
every version file. Two new PR-tier gates keep that state honest:
`check:changes` rejects change files that covector would silently drop, and
`check:release-sync` fails when the version fields, the changelog, and its
Chinese backup disagree.
