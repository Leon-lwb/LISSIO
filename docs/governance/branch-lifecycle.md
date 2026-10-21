# Branch Lifecycle

<!-- lissio-doc
status: maintained
owner: Lissio maintainers
last-reviewed: 2026-10-21
applies-to: Branch roles, integration, and deletion across the five Lissio repositories
-->

Lissio is five repositories — the umbrella checkout, `client/`, `server/`, and the
nested `server/core/`, `server/physical/`, and `server/data/` — and each one
carries the same two long-lived lines. A change that crosses repositories is
integrated in every repository it touches, not in one of them.

## Branch roles

| Branch | Role | Rules |
| --- | --- | --- |
| `main` | Released state | Updated by the release flow in [`RELEASING.md`](../../RELEASING.md). Feature work never targets it directly. |
| `develop` | Integration line | Every integrated change lands here first. CI runs the quality gates on a push to it. |
| `feat/<scope>` | One workstream | Short-lived, cut from `develop`, deleted once integrated. It may span several repositories under the same name so the workstream is recognisable in a log. |

`main` history is contained in `develop`: a release-preparation commit made on
`main` comes back to `develop` with the next integration, so `develop` never
lacks a released fact.

## Integration

1. Cut `feat/<scope>` from `develop` in each repository the workstream touches.
2. Land the work there and run the complete command set in
   [`CONTRIBUTING.md`](../../CONTRIBUTING.md).
3. Integrate into `develop`:
   - fast-forward with `git merge --ff-only feat/<scope>` when `develop` has not
     moved, because a linear history keeps one workstream readable as one run of
     commits;
   - a merge commit is only for the case where `develop` moved in the meantime;
     never rebase an integrated `develop` commit to keep a branch linear.
4. Bump the umbrella's submodule pointers in the same integration, and only to a
   commit that is reachable from that submodule's `develop` — a pointer to a
   branch tip that exists nowhere else is a state CI cannot reproduce.
5. Push `develop` in every repository, submodules before the repositories that
   pin them, and the umbrella last.

## Deletion

A feature branch is deleted after its commits are reachable from `develop`:

- Delete the local branch once per repository. `git branch -d` refuses a branch
  whose upstream moved, so confirm the merge first:
  `git merge-base --is-ancestor feat/<scope> develop` must exit zero, then
  `git branch -D` is safe.
- Deleting the remote branch is a maintainer decision, not an automatic step. A
  remote `feat/*` tip is a historical anchor a review record can name; several
  workstreams leave theirs in place.
- `main` and `develop` are never deleted.

## Recording the integration

An integration that spans repositories adds one review record under
[`../reviews/records/`](../reviews/records/) that names each branch, its final
commit, and whether it was fast-forwarded or merged, so a later reader can tell
where a workstream went without guessing from a log. The record links this
document rather than restating the rules.
