# Documentation Review Checklist

<!-- lissio-doc
status: maintained
owner: Lissio maintainers
last-reviewed: 2026-10-08
applies-to: Substantive repository documentation and governance changes
-->

Record findings and a conclusion; do not write only “reviewed.” Machine-checkable
items are executed by `pnpm check:docs`; reviewers confirm that the results match
the intended change.

## Factual consistency

- [ ] 1.1 `LICENSE` is canonical Apache-2.0 text and its checksum passes.
- [ ] 1.2 `package.json` and every Rust package use `Apache-2.0`.
- [ ] 1.3 Referenced paths, commands, crates, identifiers, and endpoints exist.
- [ ] 1.4 Counts and inventories match regenerated dependency data.
- [ ] 1.5 Code or configuration is named as authority for duplicated facts.
- [ ] 1.6 External links resolve and hosting references match `git remote`.
- [ ] 1.7 All documents are indexed.
- [ ] 1.8 VOFA+ and `vofa` references are limited to compatibility and attribution.

## License and intellectual property

- [ ] 2.1 `LICENSE`, `NOTICE`, SPDX fields, and public prose agree.
- [ ] 2.2 No separate commercial license or unimplemented service is promised.
- [ ] 2.3 New dependencies and assets are recorded with their obligations.
- [ ] 2.4 `deny.toml` remains narrow and compatible with Apache-2.0 distribution.
- [ ] 2.5 License texts and attribution remain reachable in source and artifacts.
- [ ] 2.6 Historical GPL statements are limited to historical releases.
- [ ] 2.7 `CLA.md` matches contribution and patent arrangements.

## Structure and format

- [ ] 3.1 Files are placed according to `documentation-standards.md`.
- [ ] 3.2 Names use lowercase kebab-case; reviews use `YYYY-MM-DD-<scope>.md`.
- [ ] 3.3 Metadata is complete and `last-reviewed` is current.
- [ ] 3.4 There is one clear H1 and no heading level beyond four.
- [ ] 3.5 Code blocks are labeled and relative links resolve.
- [ ] 3.6 Documentation, tooling, and CI text are written in English.
- [ ] 3.7 No development-process markers remain.

## Maintainability

- [ ] 4.1 Each document names its authoritative source.
- [ ] 4.2 Script-detectable rules are enforced by a gate.
- [ ] 4.3 The change does not create competing hand-maintained facts.
- [ ] 4.4 Follow-ups have owners and dates in the review record.
- [ ] 4.5 The next review trigger is clear.

## Gates and records

- [ ] 5.1 `pnpm check:docs` passes.
- [ ] 5.2 Every gate affected by the change passes.
- [ ] 5.3 A record exists in `docs/reviews/records/` and is indexed.
- [ ] 5.4 Scope, findings, and follow-ups are complete.
- [ ] 5.5 README, notices, manifests, CI, and release instructions are synchronized.
