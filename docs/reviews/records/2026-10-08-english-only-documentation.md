# English-only documentation policy review

<!-- lissio-review
date: 2026-10-08
scope: Removal of the Chinese documentation backups, the English-language repository convention in documentation-standards.md, the metadata contract change, and the Chinese prose translated out of scripts, e2e specs, and build/CI configuration
reviewer: implementation agent; maintainer sign-off pending
verdict: passed-with-conditions
-->

## Scope

Reviewed the repository-wide move to English prose:

- deletion of the `docs/community/` Chinese backup tree (44 files), including
  its mirrored `.github/`, `docs/`, `src/`, and `src-tauri/` paths and the
  community index;
- the rewritten language rules in
  [`../../governance/documentation-standards.md`](../../governance/documentation-standards.md),
  [`../../governance/document-review.md`](../../governance/document-review.md),
  [`../../AGENTS.md`](../../AGENTS.md), [`../../README.md`](../../README.md),
  [`../../../CONTRIBUTING.md`](../../../CONTRIBUTING.md),
  [`../../../RELEASING.md`](../../../RELEASING.md), [`../../ci.md`](../../ci.md),
  [`../checklist.md`](../checklist.md), and the pull-request
  template;
- the metadata contract change: `language` and `authoritative` are no longer
  documentation metadata (57 files, 116 lines removed), except for the product
  localization under `capabilities/docs/zh/`;
- Chinese prose translated out of `scripts/` and `e2e/` (34 files) and out of
  the build/CI configuration, and the removal of the Chinese CHANGELOG link from
  `check:release-sync` and `release-prepare.mjs`.

## Findings

- `docs/community/` was the only translated-documentation surface. Deleting it
  removed 44 mapped backups, and every rule, index, and gate that referenced
  them was updated in the same change; `pnpm check:docs` reports no missing
  index or broken link.
- Written English is a **soft repository requirement**, not a gate rule. The
  policy says repository prose is written in English and that reviewers confirm
  it; `pnpm check:docs` deliberately does not scan for characters, so a
  translation cannot fail CI on its own. This avoids encoding "no Chinese" as a
  checked property and keeps the obligation where it belongs: the author and the
  reviewer.
- Metadata was the load-bearing part of the old policy: the gate required
  `language` and `authoritative` on every document, and the Chinese backups
  declared `translation-of`. The contract is now `status`, `owner`,
  `last-reviewed`, and `applies-to`; product localization keeps `language:
  zh-CN`, `authoritative: false`, and `translation-of`, because there the two
  fields still describe real semantics.
- Product localization is retained on purpose. The application's default UI
  language is `zh` (`src/settings/defaults.ts`), so `src/i18n/resources/zh/` and
  the runtime capability help under `capabilities/docs/zh/` are shipped product
  surfaces. Nine e2e locator lines in `e2e/backend-connection.spec.ts` and
  `e2e/performance-monitor.spec.ts` keep matching that Chinese copy; only
  comments, test titles, assertion messages, skip reasons, and thrown errors
  were translated.
- `CHANGELOG.md` keeps three Chinese UI labels inside code spans (`右截取`,
  `插入`, `删除`) because they name the glyphs the fix was about. Quoted product
  strings are not prose and stay.
- Historical records are untouched. Their Chinese and their established verdict
  labels remain valid because those records are immutable; `check:docs` still
  accepts both the English and the historical verdict labels.
- The Chinese that remains in `scripts/check-docs.mjs` is limited to `\u`
  escapes for those historical verdict labels and for the Chinese process-trace
  patterns the gate has always caught.

## Follow-ups

1. Rust and TypeScript source comments outside the agreed scope still contain
   Chinese (roughly 1,340 files), as do 55 crate-level `Cargo.toml` manifests.
   Translating them is a separate, larger change. Owner: maintainer.
2. Keep the English requirement visible in review: checklist item 3.6 asks the
   reviewer to confirm the language, and `CONTRIBUTING.md` points at the
   standard. Owner: maintainer.
3. Confirm or amend this record's reviewer and verdict, which were prepared by
   the implementation agent. Owner: maintainer.
