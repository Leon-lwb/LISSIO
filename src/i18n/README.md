# Internationalization

<!-- lissio-doc
status: maintained
owner: Lissio maintainers
last-reviewed: 2026-10-07
language: en
authoritative: true
applies-to: i18next runtime and React integration
-->

This directory uses `i18next` with `react-i18next`.

- `resources.ts` loads and validates resources; conventions are in `resources/README.md`.
- `instance.ts` creates the global i18next instance and exposes `translate` for non-React code.
- React components use `useTranslation()` and the root uses `I18nextProvider`.
- `Lang` remains aligned with `settings.general.language`; switching settings calls `changeLanguage`.
- Missing keys return their key names so failures remain diagnosable.
