# Open Source and Intellectual Property Policy

<!-- lissio-doc
status: maintained
owner: Lissio maintainers
last-reviewed: 2026-10-18
applies-to: Licensing, copyright, contributions, patents, notices, and public claims
-->

This policy governs the current Lissio source tree, binaries, containers, and
public statements. Code and configuration are authoritative for implementation
facts.

## License model

The current source tree is licensed under the Apache License, Version 2.0. The
canonical text is `LICENSE` and SPDX fields use `Apache-2.0`.

Apache-2.0 permits commercial use, modification, private use, and distribution
in source or binary form, including distribution with proprietary works, subject
to preserving notices, stating changes, and satisfying the license's other
conditions. Lissio does not offer or promise a separate proprietary license.

Earlier binary releases that were distributed under GNU GPL version 2 only
remain governed by the license and notices supplied with those releases. The
current Apache-2.0 license is not represented as retroactive relicensing of
those artifacts.

## Governance files

| File | Role |
| --- | --- |
| `LICENSE` | Canonical Apache-2.0 text; never locally edited |
| `NOTICE` | Copyright, historical scope, and attribution |
| `CLA.md` | Contributor and patent terms |
| `AUTHORS.md` | Authorship summary; Git history is authoritative |
| `CONTRIBUTING.md` | Contribution and verification rules |
| `SECURITY.md` | Vulnerability and rights reporting |
| `server/deny.toml` | Machine-enforced dependency license allow-list |
| `docs/governance/third-party-licenses.md` | Dependency and asset obligations |

## SPDX fields

`package.json`, the Rust workspace package, and every inherited Rust member must
declare `Apache-2.0`. Do not encode a fictional combined SPDX expression such as
`Apache-2.0 OR Commercial`; there is no separate commercial license.

## Copyright and contributions

Copyright in the project is held by Horldsence and Lissio contributors.
Contributors retain copyright in their work. `CLA.md` describes the Apache-2.0
grant and patent terms for contributions.

The historical contributor agreement published before 2026-10-07 included
relicensing authority for the current source tree. Historical binary release
terms are not changed by that transition.

Every contribution must be original, appropriately licensed, or accompanied by
verified permission and attribution. AI-generated material is accepted only
after human review and license verification.

## Patents

Apache-2.0 includes an express patent license and retaliation termination for
the licensed work. `CLA.md` applies those terms to contributions. Third-party
patent terms remain governed by their own licenses.

## Distribution obligations

| Distribution | Required material |
| --- | --- |
| Source archive | `LICENSE`, `NOTICE`, third-party inventory |
| Desktop installer | `LICENSE`, `NOTICE`, font and third-party license texts |
| Web bundle | `LICENSE`, `NOTICE`, applicable font and asset notices |
| Server/CLI archive | `LICENSE`, `NOTICE`, dependency notices |
| Container image | `LICENSE`, `NOTICE`, source URL, third-party notices |

Apache-2.0 does not impose GPL-style reciprocal source publication for current
releases. Reproducible source and build instructions remain project policy.
Earlier GPL releases retain their original source-distribution obligations.

## Third-party material

Before adding code, fonts, icons, models, data, or specification text, confirm
the license and redistribution obligations and record the item in
`third-party-licenses.md`. The dependency allow-list is not a substitute for
asset-level review.

## Protocols and interoperability

JustFloat and FireWater are compatibility protocol names. `vofa-dock` is an
internal persistence identifier. VOFA+ references identify compatibility
sources and third-party attribution; they do not identify Lissio or imply
endorsement.

## Trademarks

Lissio names and marks identify this project. Third-party marks belong to their
owners. Nominative references must be limited to compatibility, identification,
and attribution.

## Public claims

Do not claim:

- a separate commercial license, paid support, warranty, or certification that
  has not been published;
- verified hardware or protocol interoperability without evidence;
- historical relicensing of previously published GPL artifacts;
- compliance or legal approval that has not actually been obtained.

## Review and exceptions

License, notice, dependency, and distribution changes require
`document-review.md`. Exceptions must be explicit, time-bounded, and recorded.
