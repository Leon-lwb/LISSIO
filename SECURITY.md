# Security and Intellectual Property Policy

<!-- lissio-doc
status: maintained
owner: Lissio maintainers
last-reviewed: 2026-10-07
language: en
authoritative: true
applies-to: Vulnerability, abuse, trademark, and rights reports
-->

## Reporting a security vulnerability

Email `pengheng.wang@foxmail.com`. Do not disclose exploitable details in a
public issue, discussion, or pull request.

Include:

- affected release or commit;
- reproduction steps;
- impact and known exploitation;
- suggested mitigation, if available.

Encrypted email is preferred when attachments are required. Plain email is
acceptable when encryption is unavailable.

## Response targets

| Stage | Target |
| --- | --- |
| Acknowledgement | 3 business days |
| Initial severity and plan | 10 business days |
| Fix release | Within 30 days of severity confirmation, or another agreed date |

Remote code execution and privilege escalation receive the highest severity.
Local privilege escalation and information disclosure follow. Crashes and
resource exhaustion are generally lower severity. The rationale is shared with
the reporter.

## Disclosure

Fixes are published in the next appropriate release. The reporter should keep
details confidential until release unless both parties agree otherwise. Public
credit is offered after remediation, with the attribution chosen by the reporter.

## Intellectual property and trademark reports

Use the same email for suspected unauthorized third-party material, copyright or
patent claims, and misuse of the Lissio name. Include proof of rights and exact
file or product locations. Accepted matters are recorded in
`docs/reviews/records/` when they affect project policy or releases.

## Out of scope

Issues without enough information to reproduce are handled as ordinary issues.
Public disclosure before coordination cannot guarantee a private remediation
window. Dependency vulnerabilities should also be reported upstream.

## Support window

Security fixes target current releases and the active development branch.
Historical releases are not maintained separately; users should upgrade.
