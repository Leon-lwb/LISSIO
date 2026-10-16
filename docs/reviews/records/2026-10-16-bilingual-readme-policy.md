# Bilingual README policy and translation metadata review

<!-- lissio-review
date: 2026-10-16
scope: The README.zh-CN.md translation, the relaxed language rule in documentation-standards.md, and the pnpm check:docs translation-metadata check
reviewer: implementation agent; maintainer sign-off pending
verdict: passed-with-conditions
-->

## Scope

Reviewed the move from an English-only repository prose rule to a rule that
allows a declared translation beside an authoritative English document:

- new [`../../../README.zh-CN.md`](../../../README.zh-CN.md), a Simplified
  Chinese translation of the product README with `language: zh-CN`,
  `authoritative: false`, and `translation-of: README.md`, plus a language
  switcher in both README files;
- the rewritten language rules in
  [`../../governance/documentation-standards.md`](../../governance/documentation-standards.md)
  (language, placement, naming, and metadata sections),
  [`../../governance/document-review.md`](../../governance/document-review.md),
  [`../../AGENTS.md`](../../AGENTS.md), [`../../README.md`](../../README.md),
  [`../../../CONTRIBUTING.md`](../../../CONTRIBUTING.md), and
  [`../checklist.md`](../checklist.md);
- `scripts/check-docs.mjs`: a `*.zh-CN.md` document must declare
  `language: zh-CN`, `authoritative: false`, and the `translation-of` source
  derived from its own file name; that source must exist, and the body must
  state that the English source is authoritative. The product-localization rule
  under `capabilities/docs/zh/` now shares that code path;
- `scripts/gates.mjs`: the `check-docs` description now names translation
  metadata, and the generated documentation blocks were re-synced.

## Findings

- The previous English-only rule was a reviewer-confirmed convention, not a
  gate rule, so relaxing it needed no gate exception; the change adds a check
  instead of removing one.
- `README.zh-CN.md` stays in step with `README.md`: 33 headings, 26 code
  fences, and 13 contents entries on both sides, with identical section order
  and kinds. Commands, paths, identifiers, tables, and links are preserved, and
  translated links resolve from the repository root.
- The translation is a reader aid. Product localization under
  `src/i18n/resources/zh/` and `capabilities/docs/zh/` is untouched, English
  stays authoritative, and historical review records keep their original
  language and verdict labels.
- The removed `docs/community/` mirror tree stays deleted. This change adds one
  current translation rather than restoring the old backups.

## Follow-ups

1. Keep the two README files in step: an edit to `README.md` that changes
   user-visible facts updates `README.zh-CN.md` in the same change. Owner:
   maintainer.
2. Structural parity between the two files is documented but not gated; add a
   gate if drift becomes a repeated review finding. Owner: maintainer.
3. Confirm or amend this record's reviewer and verdict, which were prepared by
   the implementation agent. Owner: maintainer.
