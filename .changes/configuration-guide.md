---
"lissio": minor:added
---

Added a configuration guide as the first screen of a fresh installation: one card
with three steps (interface language, color theme, motion and glass) and a live
preview beside each step, including the looping brand mark on the language step.
The workbench is not mounted until the guide is confirmed, so the card is what a
new installation shows first, and each choice applies immediately. An upgrading
installation keeps its existing settings document and never meets the guide. A new
`general.showConfigGuide` switch forces the guide on every launch so its appearance
can be previewed without reinstalling, and the desktop `check_update` response
reserves a `configGuide` field for a future publishing-side override. The guide
inherits values the settings document already carries, otherwise preselects English
for the language and follows the system appearance preference for the theme, and
labels every value with the source it came from. Confirming records the current app
version in `general.lastSeenVersion` and saves immediately; that field had no writer
before this change. No workspace-level configuration layer is introduced.
