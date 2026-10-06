# Documentation Standards

<!-- lissio-doc
status: maintained
owner: Lissio maintainers
last-reviewed: 2026-10-07
language: en
authoritative: true
applies-to: Repository documentation, metadata, language, and maintenance rules
-->

Every document must answer three questions: what it describes, which source is
authoritative, and when it must be reviewed.

## Language authority

- English documentation is authoritative for all non-historical project documents.
- Chinese translation backups live below `docs/community/` and use the
  `<name>.zh-CN.md` suffix while preserving a mirrored repository path.
- Every Chinese backup declares `language: zh-CN`, `authoritative: false`, and
  `translation-of`. If it differs from the English source, English controls.
- Historical review records and historical release logs preserve their original
  language and are not rewritten as translations.
- Runtime localized help keeps its `en/` and `zh/` load paths. The English
  runtime document is authoritative; the Chinese file is a product translation.
- Identifiers, SPDX expressions, commands, paths, and code remain unchanged.

## Placement

| Directory | Content |
| --- | --- |
| root | External entry points, legal texts, governance, support, roadmap, changelog |
| `docs/architecture/` | Current technical facts and architectural contracts |
| `docs/governance/` | Licensing, dependencies, documentation, and review policy |
| `docs/performance/` | Performance budgets and measurement policy |
| `docs/reviews/` | Review checklist, indexes, and immutable historical records |
| `docs/community/` | Non-authoritative Chinese translation backups |
| `.github/`, `.forgejo/` | Contribution, issue, ownership, and community automation |

New documents must be indexed in `docs/README.md`. Translation backups must be
indexed in `docs/community/INDEX.zh-CN.md`.

## Naming

Use lowercase kebab-case names. Historical review records use
`YYYY-MM-DD-<scope>.md`. Chinese backups retain the source stem and add
`.zh-CN` before `.md`.

## Metadata

Every non-historical Markdown document contains:

```markdown
<!-- lissio-doc
status: maintained
owner: Lissio maintainers
last-reviewed: 2026-10-07
language: en
authoritative: true
applies-to: one sentence describing scope
-->
```

Translations use `language: zh-CN`, `authoritative: false`, and a
`translation-of` repository path. Historical review records use
`<!-- lissio-review -->` and are exempt from language metadata.

## Structure

Use one H1, descriptive section headings, tables for comparisons, and labeled
code blocks. State the authoritative code, manifest, or configuration source.
Use relative links that remain valid from the file's actual location.

Do not include development-process traces such as task numbers, phases,
iteration numbers, or “to be done later.” Describe current state; historical
decisions belong in review records.

## Single sources

| Fact | Source |
| --- | --- |
| Project license | `LICENSE` and SPDX manifest fields |
| Copyright and notices | `NOTICE` |
| Dependency allow-list | `src-tauri/deny.toml` |
| Third-party inventory | `docs/governance/third-party-licenses.md` |
| Crate layers and dependencies | `docs/architecture/crates.md` and crate metadata |
| User-visible strings | `src/i18n/resources/` |
| Runtime capability help | `src-tauri/crates/desktop/control-api/src/capabilities/docs/en/` |

Do not maintain competing hand-written copies of machine-checkable facts.

## Review triggers

Documentation and a review record are required for license, copyright, patent,
dependency, packaging, public-command, repository structure, release pipeline,
or governance changes. The process is defined in `document-review.md`.
