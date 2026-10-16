# Documentation Review Process

<!-- lissio-doc
status: maintained
owner: Lissio maintainers
last-reviewed: 2026-10-16
applies-to: Triggers, verification, decisions, and review records
-->

Documentation review has two layers: the reproducible `pnpm check:docs` gate and
human judgment recorded in `docs/reviews/records/`.

## Triggers

| Change | Required action |
| --- | --- |
| Add, remove, or move a document | Update indexes and create a review record |
| Change legal or governance text | Review facts, authority, and external claims |
| Change a license, copyright, patent, or trademark statement | Obtain appropriate approval and record it |
| Add, upgrade, or remove a dependency | Update the third-party inventory and review obligations |
| Change packaging or release delivery | Verify notices and artifact contents |
| Change product localization | Update every language directory and keep the English source authoritative |
| Add or update a translated document | Declare its source in metadata and keep it in step with the authoritative English file |

## Process

1. The author updates the authoritative English document, and its translation
   when the change touches translated facts.
2. `pnpm check:docs` passes.
3. A reviewer walks through `../reviews/checklist.md`. A single maintainer must
   record an explicit checklist review when no second maintainer is available.
4. Add `../reviews/records/YYYY-MM-DD-<scope>.md` with scope, findings,
   conclusion, and follow-ups, then add it to the review index.
5. Merge only after gate failures and release blockers are resolved.

## Conclusions

| Verdict | Meaning |
| --- | --- |
| `passed` | No unresolved issue |
| `passed-with-conditions` | Specific follow-ups have owners and dates |
| `failed` | Facts, authority, rights, or release safety are unacceptable |

Historical review records use their original established verdict labels and are
not rewritten. New records use the English labels above.

Gate exceptions must identify the rule, reason, risk, affected scope, and
review date. Missing verification is not an exception.
