---
"lissio": patch:fixed
---

Fixed onboarding reopening after dismissal or version changes. Ending or completing the tour persists the disabled preference; Help still supports manual replay. Desktop and Web settings now use the connected backend, serialize acknowledged writes, and offer retries for read or save failures without overwriting unread configuration. Open onboarding also keeps later startup dialogs queued.

Bound default validation concurrency to one Vitest worker, one Playwright worker, two Cargo build jobs, and one Rust test thread to reduce peak memory use.
