# Translation Resources

<!-- lissio-doc
status: maintained
owner: Lissio maintainers
last-reviewed: 2026-10-07
language: en
authoritative: true
applies-to: Localized product string organization and parity rules
-->

Translation resources are grouped by stable product capability:

```text
src/i18n/resources/
  zh/
    navigation.yml
    widgets.yml
    ai-control.yml
    workspace.yml
    settings.yml
    custom-widgets.yml
    onboarding.yml
    panels.yml
    decoder.yml
    analysis.yml
    layout.yml
  en/
    ...
```

Rules:

- use lowercase English kebab-case filenames for stable capability domains;
- language directories must contain identical filenames and translation keys;
- keep flat keys unique within each capability file;
- add every user-visible string to both language directories;
- `src/i18n/resources.ts` merges files into i18next `translation` resources.

Repository documentation is authoritative in English. These product
translations remain runtime localization, while repository translation backups
are stored in `docs/community/`.
