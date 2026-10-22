# Lissio Roadmap

<!-- lissio-doc
status: maintained
owner: Lissio maintainers
last-reviewed: 2026-10-22
applies-to: Delivered scope, release hygiene, and explicit project non-goals
-->

This roadmap records delivered scope and concrete follow-up work. It is not a
schedule or a promise of delivery dates. Implementation facts remain in code,
tests, and release artifacts.

## Delivered

Lissio currently provides:

- serial, TCP, UDP, test-data, Slcan, CandleLight, CAN, ISO-TP, diagnostic, and
  Modbus/S7 industrial acquisition paths;
- waveform, RawData, CAN, logic, command-frame, diagnostic, and recording
  workflows;
- a node graph with typed compilation and evaluation, DSP nodes, filters, FFT,
  frame decoding, and sandboxed custom JavaScript;
- desktop, static Web, standalone server, headless CLI, MCP, and built-in AI
  integration;
- architecture, dependency, contract, model-catalog, token, motion,
  documentation, performance, and license gates.

Validated boundaries, including real PLC and multi-vendor hardware coverage,
are documented in `server/physical/docs/architecture/industrial-protocol-integration.md`
and review records.

## Release and compliance work

| Priority | Item | Acceptance criterion |
| --- | --- | --- |
| 1 | Keep `LICENSE`, `NOTICE`, and required third-party notices with every binary | Desktop, Web, server, CLI, and container artifacts contain or link the required texts |
| 2 | Package font license texts | `src/assets/fonts/*-LICENSE.txt` are present in all distributions that contain fonts |
| 3 | Resolve MiSans subset-modification questions | Record a documented legal conclusion or replace the font if subsetting is not permitted |
| 4 | Provide checksums and source links on releases | Published releases identify the exact source revision and artifact hashes |
| 5 | Keep historical GPL release statements accurate | Release notes distinguish current Apache-2.0 releases from earlier GPL-only releases |

Apache-2.0 permits commercial use and proprietary derivatives. Lissio does not
sell a separate commercial license.

## Release hygiene

| Item | Acceptance criterion |
| --- | --- |
| Normalize historical tags | Public tag names match `vX.Y.Z` or an approved pre-release form |
| Unify hosting references | Documentation, manifests, About, release automation, and `git remote` use Codeberg as canonical |
| Publish reproducible release metadata | Release records include source revision, artifacts, checksums, and verification results |

## Industrial protocols

Current adapters and evidence are listed in
`server/docs/architecture/industrial-protocol-integration.md`. Candidate protocols must
pass licensing, dependency health, cross-platform, interoperability, and
failure-recovery review before becoming supported features.

## Hardware interoperability

Future validation should cover representative USB serial devices, Slcan and
CandleLight CAN adapters, Modbus TCP/RTU equipment, S7 PLCs, long disconnects,
clock drift, malformed frames, and sustained high-rate input. Unsupported
hardware must not be described as verified.

## Benchmarks and sustained operation

Maintain waveform-ingestion, graph-evaluation, recording, and full-pipeline
baselines. Long-running tests should account for dropped data explicitly and
distinguish normal zero-drop operation from intentional bounded degradation.

## Low-code user research

Validate node discovery, error recovery, graph readability, and terminology
with embedded, automotive, and industrial users before treating usability
findings as requirements.

## Governance coverage

Add a second maintainer or delegated reviewer when a qualified contributor is
available. Until then, publish the single-maintainer response limitation and
retain explicit review records for governance changes.

## Explicit non-goals

Lissio does not currently promise certified safety systems, guaranteed
real-time behavior, support for every PLC, arbitrary custom hardware drivers,
unlimited historical compatibility, legal advice, or contractual support.
