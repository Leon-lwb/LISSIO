# Documentation Standards

<!-- lissio-doc
status: maintained
owner: Lissio maintainers
last-reviewed: 2026-10-18
applies-to: Repository documentation, metadata, language, and maintenance rules
-->

Every document must answer three questions: what it describes, which source is
authoritative, and when it must be reviewed.

## Language

- Repository prose is written in English, and the English document stays
  authoritative: documentation, tooling scripts, e2e specs, and CI/build
  configuration text. This is a repository convention that authors follow and
  reviewers confirm; it is not enforced by a gate.
- A document may ship a translation beside its English source when the
  translation is a reader aid rather than a second authority. The product README
  is the one such pair today: [`../../README.md`](../../README.md) and
  [`../../README.zh-CN.md`](../../README.zh-CN.md). A translated document uses
  `<name>.zh-CN.md`, declares `language: zh-CN`, `authoritative: false`, and a
  `translation-of` path naming its English source, states in the body that the
  English source is authoritative, and is updated in the same change as any
  source edit that changes translated facts. `pnpm check:docs` verifies the
  metadata, the source path, and the authority statement.
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
| root | External entry points (including the product README and its `zh-CN` translation), legal texts, governance, support, roadmap, changelog |
| `server/docs/architecture/`, `client/docs/architecture/` | Current technical facts and architectural contracts, held by the repository that owns them |
| `docs/governance/` | Licensing, dependencies, documentation, and review policy |
| `docs/performance/` | Performance budgets and measurement policy |
| `docs/reviews/` | Review checklist, indexes, and immutable historical records |
| `.github/`, `.forgejo/` | Contribution, issue, ownership, and community automation |

New documents must be indexed in `docs/README.md`.

## Naming

Use lowercase kebab-case names. Historical review records use
`YYYY-MM-DD-<scope>.md`. A translated document is `<name>.zh-CN.md` beside its
English source (`README.md` → `README.zh-CN.md`).

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

`language` and `authoritative` are required only on a translated document: it
declares `language: zh-CN`, `authoritative: false`, and a `translation-of` path
naming its English source. The product localization under
`capabilities/docs/zh/` and the repository `README.zh-CN.md` are the two such
surfaces, and `pnpm check:docs` verifies both. Historical review records use
`<!-- lissio-review -->` and carry no language metadata.

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
| Dependency allow-list | `server/deny.toml` |
| Third-party inventory | `docs/governance/third-party-licenses.md` |
| Crate layers and dependencies | `server/docs/architecture/crates.md` and crate metadata |
| User-visible strings | `client/src/i18n/resources/` |
| Runtime capability help | `server/crates/desktop/control-api/src/capabilities/docs/en/` |

Do not maintain competing hand-written copies of machine-checkable facts.

## Review triggers

Documentation and a review record are required for license, copyright, patent,
dependency, packaging, public-command, repository structure, release pipeline,
or governance changes. The process is defined in `document-review.md`.
