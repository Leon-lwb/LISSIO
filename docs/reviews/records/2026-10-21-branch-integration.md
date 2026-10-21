# Workstream branch integration review

<!-- lissio-review
date: 2026-10-21
scope: Integration of the catalogue workstream branches into develop across the five Lissio repositories, and deletion of the integrated feature branches
reviewer: implementation agent; maintainer sign-off pending
verdict: passed
-->

## Scope

Reviewed the state the catalogue workstreams left behind — the branch per
workstream across `server/core`, `server/physical`, `server`, `client`, and the
umbrella — and integrated it into `develop` under the rules in
[`../../governance/branch-lifecycle.md`](../../governance/branch-lifecycle.md):

- `server/core` carried five feature branches, stacked linearly: the protocol
  registry, the block codec, CBOR frame decoding, catalog v3, and catalog v4;
- `server`, `client`, and the umbrella each carried `feat/binary-cbor-decoding`
  in addition to `develop`, plus the catalog work already integrated on
  `develop`;
- `server/physical` had only `develop`, holding the transport labelling and
  SLCAN recommendation change.

## Findings

- **Every feature branch was integrated; none needed a merge commit.**
  `server/core`'s `develop` was strictly behind `feat/catalog-v4`, so
  `git merge --ff-only` moved it forward five commits and every earlier branch
  became an ancestor in the same step. The other three repositories had already
  absorbed `feat/binary-cbor-decoding`, so their `develop` moved forward with the
  catalog v4 and client changes they already held.
- **Deletion ran only after an ancestry check.** `git branch -d` refused three of
  the branches because their upstream had moved, which is exactly the case where
  a forced delete could hide unmerged work; each was confirmed with
  `git merge-base --is-ancestor <branch> develop` before `git branch -D`.
- **The umbrella pins `develop` commits.** After this integration every submodule
  pointer names a commit that `origin/develop` of that submodule contains, so the
  composed checkout is reproducible from the five remote branches alone. Before
  the integration the `server/core` pointer named a commit that existed only on a
  feature branch.
- **Remote feature branches were kept.** Deleting a remote tip discards a
  historical anchor that a record cites; the maintainer decision for this
  integration was to fast-forward `develop` on every repository and leave the
  remote `feat/*` refs in place. The governance document states remote deletion as
  a maintainer decision rather than a step of the workflow, so this precedent does
  not bind the next integration.

## Disposition

| Repository | Branch | Commit | Disposition |
| --- | --- | --- | --- |
| `server/core` | `feat/protocol-registry` | `eef921e` | ancestor of `develop`; local branch deleted |
| `server/core` | `feat/block-codec` | `2eb93b0` | ancestor of `develop`; local branch deleted |
| `server/core` | `feat/binary-cbor-decoding` | `7022795` | ancestor of `develop`; local branch deleted |
| `server/core` | `feat/catalog-v3` | `ce4a6d3` | ancestor of `develop`; local branch deleted |
| `server/core` | `feat/catalog-v4` | `8bae975` | fast-forwarded into `develop`; local branch deleted |
| `server/physical` | `develop` | `c966956` | pushed; no feature branch outstanding |
| `server` | `feat/binary-cbor-decoding` | `56df656` | ancestor of `develop`; local branch deleted |
| `client` | `feat/binary-cbor-decoding` | `85dbd1c` | ancestor of `develop`; local branch deleted |
| umbrella | `feat/binary-cbor-decoding` | `9712c2c7` | ancestor of `develop`; local branch deleted |

`develop` after the integration: `server/core` `71a736a → 8bae975`,
`server/physical` `f3b15f7 → c966956`, `server` `2cba9af → b67f082`, `client`
`122c035 → ac4f0ae`. Every repository now carries only `develop` and `main`, and
`origin/develop` matches the local branch in all five.

## Follow-ups

- The umbrella's `main` and each submodule's `main` remain behind `develop` by
  the accumulated workstreams; the next release flow brings them level.
- A remote `feat/*` ref that no record cites can be deleted at the next
  housekeeping without further review.
