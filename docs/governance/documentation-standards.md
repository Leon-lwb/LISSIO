# Documentation Standards

<!-- lissio-doc
status: maintained
owner: Lissio maintainers
last-reviewed: 2026-10-08
applies-to: Repository documentation, metadata, language, and maintenance rules
-->

Every document must answer three questions: what it describes, which source is
authoritative, and when it must be reviewed.

## Language

- Repository prose is written in English: documentation, tooling scripts, e2e
  specs, and CI/build configuration text. This is a repository convention that
  authors follow and reviewers confirm; it is not enforced by a gate.
- Historical review records and historical release logs preserve their original
  language. They are never rewritten or translated.
- Product localization is not documentation. `src/i18n/resources/zh/` and the
  runtime capability help under `capabilities/docs/zh/` are shipped product
  surfaces; their English sources remain authoritative.
- Identifiers, SPDX expressions, commands, paths, and code remain unchanged.
  Quoted product strings inside code spans are allowed.

## Placement

| Directory | Content |
| --- | --- |
| root | External entry points, legal texts, governance, support, roadmap, changelog |
| `docs/architecture/` | Current technical facts and architectural contracts |
| `docs/governance/` | Licensing, dependencies, documentation, and review policy |
| `docs/performance/` | Performance budgets and measurement policy |
| `docs/reviews/` | Review checklist, indexes, and immutable historical records |
| `.github/`, `.forgejo/` | Contribution, issue, ownership, and community automation |

New documents must be indexed in `docs/README.md`.

## Naming

Use lowercase kebab-case names. Historical review records use
`YYYY-MM-DD-<scope>.md`.

## Metadata

Every Markdown document contains:

```markdown
<!-- lissio-doc
status: maintained
owner: Lissio maintainers
last-reviewed: 2026-10-07
applies-to: one sentence describing scope
-->
```

`language` and `authoritative` are not part of the contract: repository
documents are English and authoritative. The product localization under
`capabilities/docs/zh/` is the one exception, and it keeps `language: zh-CN`,
`authoritative: false`, and a `translation-of` path naming its English source.
Historical review records use `<!-- lissio-review -->` and carry no language
metadata.

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
