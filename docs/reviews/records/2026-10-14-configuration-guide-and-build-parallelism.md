# Configuration guide and Rust build parallelism review

<!-- lissio-review
date: 2026-10-14
scope: Configuration guide as the first screen of a fresh installation (language, theme, motion and glass), its inheritance sources, the preview switch and remote entry it reserves, the startup gating it changes, and removing the local cargo job cap
reviewer: implementation agent; maintainer sign-off pending
verdict: passed-with-conditions
-->

## Scope

Read `src/lib/startup/{phases,useStartupDialogs,configGuide,useConfigGuidePending}.ts`,
`src/store/{settingsStore,configGuideStore,updateStore}.ts`,
`src/settings/{defaults,configGuideSources}.ts`,
`src/components/onboarding/ConfigGuide.tsx`, `src/components/brand/LissajousMark.tsx`,
`src/components/SettingsControl.tsx`,
`src/components/settingFieldGroups/generalFields.ts`, `src/App.tsx`,
`src/components/lazy/lazyComponents.ts`, the `onboarding` and `settings` i18n
resources, `src-tauri/crates/desktop/update_flow/src/update.rs`, `AGENTS.md`,
`docs/architecture/{web-exit,ui-layers,ui-color-tokens,ui-motion}.md`, the
playwright configs, and `.cargo/config.toml`. The subject is the configuration
guide surface and the uncapped local Rust build parallelism request.

## Findings

- The guide is the first screen, not an overlay. `App` returns the guide before
  the workbench whenever it is open, so no part of the workbench is mounted behind
  it; the desktop window is still revealed when settings finish loading
  (`useFirstFrameReveal`), which is what makes the card the first thing a user
  sees. The boot state renders a plain window-coloured screen, so the workbench
  cannot flash for one frame before the guide opens.
- The card's two columns need their own row container. `.dialog-surface` is
  unlayered component CSS that already declares `display: flex; flex-direction:
  column` for the dialogs that stack a header, a body, and a footer; unlayered CSS
  outranks Tailwind's utilities layer, so a `flex-row` utility on the card has no
  effect and the columns stack. The guide wraps its left and right columns in an
  inner `flex flex-1 flex-row min-h-0` element instead of overriding the cascade.
  This was found by measuring rendered geometry, not by reading the class list.
- The read-failure path deliberately skips the gate. Gating on "settings not
  loaded" unconditionally would leave a load failure behind a blank page with the
  retry notification inside the unmounted workbench, so the gate applies only when
  the guide is actually pending or open.
- The guide is scoped to a fresh installation. `settings/configGuideSources.ts`
  records whether the settings document existed at read time, and
  `needsConfigGuide` opens the guide only when it did not, so an upgrading
  installation never meets it. The alternative signal (`lastSeenVersion === null`)
  was rejected: no release ever wrote that field, so every existing installation
  would have seen the guide once.
- Two explicit overrides exist. `general.showConfigGuide` is a preview switch that
  forces the guide on every launch; it is documented as such in its field
  description rather than presented as a normal preference. The remote entry is a
  reserved placeholder: `CheckUpdateResult` carries `configGuide` and the desktop
  command always leaves it unset, so the frontend path
  (`updateStore.remoteConfigGuide` → `needsConfigGuide`) is wired end to end and a
  future manifest field needs no caller changes. The manifest is not fetched
  separately yet, because the Tauri updater parses `latest.json` into a type that
  hides unknown fields.
- The preview switch needs a session latch. With it on, `needsConfigGuide` keeps
  returning true, so `configGuideStore.completedThisSession` is what releases the
  startup gate after confirmation; without it the onboarding tour, the keychain
  reminder, and the automatic update check would queue forever.
- `general.lastSeenVersion` still carries two meanings (version record and
  "guide confirmed"), and it stays necessary alongside document presence: it is
  what closes the guide for the rest of the session and for later launches once
  the document has been written. `defaults.ts` records both meanings and the
  standing rule that it must never override the `showOnboarding` preference.
- The language step preselects English for a user who never chose one
  (`CONFIG_GUIDE_DEFAULT_LANGUAGE`), rather than deriving from the system locale,
  because the first reader of this card may not read Chinese. The application
  default stays Chinese; only the guide's preselection changes. The theme step
  still follows `prefers-color-scheme` when nothing was stored, so a light system
  starts light.
- Inheritance stays inside the current format. `readConfigGuideSources` reads only
  `app.general.language` and `app.appearance.theme` from the loaded document and
  classifies each as `stored` or `default`; a stored value is never overwritten by
  a derived one, and the page labels each value with the source it came from. A
  versioned old-key to new-key migration table would require amending the
  no-legacy rule in `AGENTS.md` and is not part of this change.
- The motion preview exercises the real animation system rather than imitating it.
  The panel is a `MotionPresence` (`window` role, `origin` and geometry overridden
  for legibility) so it runs the same `usePresence` → `springTween` →
  `motionSpringFor(family, phase, distance)` path as every floating surface,
  including the reduced-motion branch and the speed preset; the timer only decides
  when to reverse, not how long anything takes. Sampling `transform` over a cycle
  shows the overshoot a spring produces (`scale 1.0016`, `y -0.93px`) instead of a
  monotonic ease, and the exit unmounts through the same retention path. Step
  changes go through `useContentSwitch`, which is the repository's own
  direction-aware content handoff, and the preview's frost is only legible because
  it sits on a token-coloured backdrop: the token document states that blur over a
  flat colour is invisible, which is why the earlier single flat card read as
  static.
- The three steps reuse what already exists instead of inventing a second
  vocabulary: the third step renders the same `SettingsControl` primitives against
  the same `appearance` fields and the same setting labels as the settings page,
  and theme previews use the token keys the theme editor previews
  (`bgEditor` + `bgSidebar`), read from the theme definition because a non-active
  theme's CSS variables are not on `:root`. The right column shows the brand mark
  looping on the language step and a token-coloured miniature on the theme step, so
  each choice is visible rather than described.
- Startup ordering is serialized in one place. `resolveStartupFlow` gained
  `configGuidePending`, so the tour, the keychain reminder, and the update check
  stay queued until the guide is confirmed.
- Escape and the backdrop-free page mean Escape keeps the current selections and
  confirms, which is the keyboard user's only exit; the page itself has no close
  control because a fresh installation has nothing to fall back to.
- `.cargo/config.toml` no longer caps `jobs`. Cargo has no unlimited setting — a
  negative value is still a cap ("CPUs + value") — so omitting the key is the only
  way to reach the default, which is the logical CPU count. The CI
  `CARGO_BUILD_JOBS` and the `RUST_TEST_THREADS` pin are unchanged: the workflow
  comment states the CI cap exists, and the test-thread pin protects
  timing-sensitive tests, neither of which is compile parallelism.
- Because a fresh workspace has no `settings.json`, every end-to-end and perf spec
  that shares `src-tauri/target/e2e-config` would meet the guide first — the exact
  behaviour this change introduces, now as a full-page gate rather than a dialog.
  The shared directory is seeded at Playwright config load time, and only when the
  file is absent.
- Three `DockedPanel` anchor assertions were hardened because this change
  perturbed the suite's file scheduling and exposed a latent race in them. They
  read the surface's inline `transform-origin` synchronously after `render()`,
  while GSAP can apply an entrance's from-state on its first tick instead of at
  tween creation; the observed failure was an empty origin with reduced motion
  resolved as false and a 0.42 s spring, so it was a timing race rather than a
  reduced-motion or zero-duration defect. They now wait for the origin to appear
  before asserting which edge it names, matching the `waitFor` pattern that file
  already uses for its deferred layout effects. No product code changed for this:
  the probes used to reach that conclusion were removed.

## Follow-ups

- The remote entry is a reserved interface, not a working remote configuration:
  the manifest field it will read does not exist yet, and reading it will require
  fetching `latest.json` separately because the updater plugin hides unknown
  fields.
- The guide is imported eagerly by `App` because it is the first screen; that is
  deliberate (a lazy chunk would need a fallback frame before the card), and it is
  the only component that leaves the lazy manifest for this reason.
- The version-mapped field conversion ("old release key to current key") remains
  unimplemented by design; adopting it requires amending the no-legacy rule in
  `AGENTS.md` first.
- The dialog tests report React `act(...)` warnings from the deferred appearance
  transition in `transitionStore`; this matches the existing dialog tests and was
  not addressed here.
- GSAP can still paint one frame of a docked entrance with the default
  `transform-origin` before its first tick. The hardened assertions expose rather
  than hide that, but changing the motion layer is its own reviewed change and was
  deliberately left out of this one.
- `src/store/settingsStore.ts` is close to the 500-line frontend budget, which is
  why the source classification lives in its own module. Further state additions
  to that store should split the load path first.
- The guide itself hit the same budget once the motion preview was added, so it is
  split into `ConfigGuide.tsx` (steps, options, navigation), `ConfigGuidePreview.tsx`
  (the three right-hand previews) and `configGuideSteps.ts` (the shared step
  vocabulary, which exists as its own module so the two components do not import
  each other).
