# Appearance Styles — Implementation Plan

Read `spec.md` first. This document is the sequence, not the design.

## Required reading

- `docs/plans/appearance-styles/spec.md`
- `docs/plans/appearance-styles/research.md`
- `docs/architecture.md`
- `docs/ux-guidelines.md`, `docs/ux-interactions.md`
- `docs/internals/display-profiles.md`

## Sizing

An audit of the shipped source found **217 chrome decisions that do not follow the CSS custom
properties today**: 90 colour decisions and 127 radius, shadow and border-width decisions, spread
over roughly 60 files. Four mechanical refactors clear 172 of them (79%). A further 32 platform
surfaces need an explicit brand-versus-style ruling, and 21 domain-data sites must be protected
from the sweep.

Phases 0-2 are that clean-up. They are worth doing on their own merits and are a hard prerequisite
for anything in phase 3 onwards: a style system laid over 217 hard-coded decisions produces an app
that changes appearance in patches.

---

## Phase 0 — Repairs that block everything else

- [x] **Fix the toast theme bug.** `src/components/ui/sonner.tsx:15` calls `useTheme()` from
      `next-themes`, but that provider is never mounted anywhere in `src/` — the app mounts its own
      `ThemeProvider` at `src/App.tsx:342`. Sonner's theme is therefore permanently `"system"` and
      its internal light/dark CSS follows the OS rather than the app. Replace with
      `useThemeContext().resolvedTheme`. Without this, toasts ignore the style entirely.
- [x] **De-literalise the modal backdrop assertion.**
      `playwright/modalConsistency.spec.ts:314-315` asserts
      `backgroundColor === "rgba(0, 0, 0, 0.4)"` and `"rgba(0, 0, 0, 0.25)"`. Replace with the
      relational claim the test actually cares about: the depth-2 backdrop is less opaque than the
      depth-1 backdrop. This is the one assertion guaranteed to break in phase 2.
- [x] **Tokenise the keypad ring radius.** `src/index.css:530` hard-codes
      `border-radius: 0.375rem` inside `[data-key-selected="true"]`. Under a style that changes
      radius the ring stops matching its control. Use the radius token.
- [x] **Delete dead shadcn primitives.** `src/components/ui/chart.tsx`, `sidebar.tsx`,
      `carousel.tsx`, `menubar.tsx`, `navigation-menu.tsx`, `context-menu.tsx` are not imported
      anywhere in `src/`. Removing them clears about 24 radius/shadow occurrences at zero risk, and
      removes the only hard-coded `THEMES = { light, dark }` map in the codebase.
- [x] **Delete the tokens those primitives were the sole consumer of.** With `sidebar.tsx` gone, the
      16 `--sidebar-*` declarations in `src/index.css` and the eight `sidebar.*` colour bindings in
      `tailwind.config.ts:87-96` have no consumer left. Nothing breaks if they stay, but `spec.md`
      §8 invariant 1 requires every style to declare every token the stylesheet references, so
      leaving them forces eight dead tokens into all twelve palettes and every contrast test.
      Sweep for other orphans from the same deletion.
- [x] **Decide the launch screen.** `src/components/StartupLaunchSequence.tsx:36` paints the launch
      backdrop from `variant.theme.backgroundColor`. It runs before storage is read, so it cannot
      follow a style. Record the decision in `spec.md` §7.3 as brand-locked and add a comment at the
      call site so it is not "fixed" later.

## Phase 1 — The token layer

- [ ] Add the shape and elevation tokens from `spec.md` §5.1 to `:root` in `src/index.css`:
      `--radius-panel`, `--edge-width`, `--shadow-1/2/3`, `--ring-style`, `--app-bar-band`.
- [ ] Add the missing semantic colour tokens: `--interstitial-scrim`, the `--media-*` group, the
      `--key-character` / `--key-function` trios, `--category-1..4`, `--chart-1..5`.
      `--chart-2` is referenced at `src/components/diagnostics/LatencyAnalysisPopup.tsx:395` and is
      **not defined anywhere**, so the literal fallback is what renders today.
- [ ] Extend `tailwind.config.ts`. Today it rebinds only `borderRadius.lg/md/sm` to `var(--radius)`,
      so `rounded-xl`, `rounded-2xl`, `rounded-3xl`, bare `rounded` and every `shadow-*` are stock
      Tailwind and will not follow a style. Add `borderRadius.panel`, a `boxShadow` scale bound to
      `--shadow-*`, and the new colour tokens.
- [ ] Add an `edge` utility that renders the style's edge as `box-shadow: inset 0 0 0
      var(--edge-width)`, per decision D10. Nothing may set `border-width` from a style.
- [ ] Add `font-variant-numeric: tabular-nums` to numeric readouts app-wide (not per style).

## Phase 2 — Migrate the 217 chrome sites

Do these in the order below; each clears the largest remaining group.

- [ ] **Radius, shadow and edge sweep — clears ~105 occurrences across ~45 files.** Codemod
      `rounded-xl` / `rounded-2xl` / `rounded-3xl` → `rounded-panel`, bare `rounded` (0.25rem) →
      `rounded-sm` (which already derives from `--radius`), `shadow-sm|md|lg|xl|2xl` →
      the new `shadow-elev-*`, and the 22 `border-0|2|4` sites → the `edge` utility.
      Leave `rounded-full` alone: a pill must stay a pill, so treat it as geometry.
      Copy the pattern already used correctly at `src/lib/modalPresentation.ts:33` and
      `src/components/ui/app-surface.tsx:221,317`.
- [ ] **Semantic state colours — clears 17 findings, all tokens already exist.**
      `text-amber-500|600|700` → `text-warning` at `UnifiedHealthBadge.tsx:299`,
      `DiagnosticsDialog.tsx:157`, `HealthHistoryPopup.tsx:54`, `HealthCheckDetailView.tsx:31,36`,
      `diagnosticsSeverity.ts:24`, `SaveRamDialog.tsx:177`, `RestoreSnapshotDialog.tsx:72`,
      `HvscControls.tsx:223`, `RemoteInputSheet.tsx:600`.
      `bg-blue-500` → `bg-diagnostics-system` at `DiagnosticsDialog.tsx:166`.
      The five literals in `src/lib/diagnostics/healthHistoryTimeline.ts:15-19` →
      `success` / `warning` / `destructive` / `muted` / `muted-foreground`.
      Delete the `dark:` forks these sites carry; fix the contrast in the token, not the call site.
- [ ] **Media overlay tokens — clears 26 findings in one coherent decision.** Sweep
      `src/components/streams/AvMirrorImmersive.tsx` (17 sites), `AvMirrorPreview.tsx` (3),
      `AvMirrorMinimap.tsx` (2), `AvMirrorControls.tsx` (1) and
      `src/components/remoteInput/RemoteInputSheet.tsx` (2) onto `--media-scrim`,
      `--media-on-scrim`, `--media-letterbox`, `--media-reticle`.
- [ ] **Interstitial scrim — 3 findings, highest visual leverage per line.**
      `src/components/ui/interstitialStyles.ts:28` (`bg-black`) and `:51`, plus
      `src/components/itemSelection/AddItemsProgressOverlay.tsx:76`. Also make the colour inside
      `--interstitial-shadow` (`src/index.css:9`) a token while keeping its geometry.
- [ ] **Key tones and disk-group chips — 8 findings.** `src/lib/remoteInput/keyTone.ts:25,34,43,48`
      onto `--key-character` / `--key-function` / `destructive` / `warning`;
      `src/lib/disks/diskGroupColors.ts:10-13` onto `--category-1..4`. The latter also fixes a live
      dark-mode bug: those chips use `text-*-700` with no dark variant and are illegible today.
      `tests/unit/components/UnifiedHealthBadge.test.tsx` and
      `tests/unit/lib/disks/diskGroupColors.test.ts` assert on literal class strings and need
      matching updates.
- [ ] **Origin icons — 3 findings.** `public/c64u-icon.svg` and `public/device-icon.svg` use
      `stroke="currentColor"` but are loaded through `<img>` at
      `src/components/FileOriginIcon.tsx:75`, where `currentColor` cannot inherit. Inline them as
      components (or switch to `mask-image`) and delete the `dark:invert dark:brightness-0` hack at
      `FileOriginIcon.tsx:71`, which is guaranteed to look wrong under any non-neutral style.
- [ ] **Lighting Studio split.** Tokenise only the app's own chrome: the selection strokes at
      `LightingStudioDialog.tsx:464,465` → `--ring` / `--border`, the stage panel gradient at `:510`,
      and the preview drop shadow at `:514`. **Leave frozen**: `:119`, `:123`, `:125`, `:206`
      (`#BFBBAF`, the physical case beige), `:207`, `:208`, `:683`. Those describe the user's
      hardware, and recolouring them makes the preview lie.
- [ ] **Verify the domain-data boundary held.** `src/lib/config/ledColors.ts`,
      `src/lib/lighting/constants.ts`, `PaletteSwatchStrip.tsx:63`, `AvSyncPanel.tsx:380`,
      `LightingSummaryCard.tsx:399,416,440`, `src/lib/streams/vicPalette.ts`,
      `HeatMapPopup.tsx:75,76` must be **unchanged** by this phase. Add a lint rule or a test that
      pins them if that is cheap; otherwise assert it in review.

## Phase 3 — Source format, compiler, drift gate

- [ ] Create `styles/appearance-styles.yaml` from the draft in `spec.md` Appendix A.
- [ ] Write `scripts/compile-styles.mjs`, emitting `src/generated/appStyles.ts` and
      `src/generated/appStyles.css`. Copy the `--check` contract from
      `scripts/compile-palettes.mjs:153-160` and `scripts/generate-variant.mjs:940-955` exactly:
      deterministic render to a string, Prettier-format before comparing, whole-file compare,
      `generated file is out of date: <path>\n  run: <command>`, exit 1, never write in check mode.
- [ ] Enforce the six compile-time invariants in `spec.md` §8, including the contrast gates and the
      rule that `--ring` never equals `--border`.
- [ ] Import `appStyles.css` from `src/index.css` after the base `:root` / `.dark` blocks.
- [ ] Add `styles:build` and `styles:check` to `package.json`, and add `styles:check` to the `lint`
      chain.
- [ ] **Add a CI drift job.** `npm run lint` is not run by any GitHub workflow — grepping
      `.github/workflows/` finds only `npm run typecheck`. Model a `Styles | Generation + drift` job
      on the existing `Notices | Generation + drift` job at `.github/workflows/android.yaml:90-136`,
      or the gate will only ever fail on developer machines.
- [ ] Add `tests/unit/scripts/compileStyles.test.ts`. Every sibling compiler has one; note that
      `compile-palettes.mjs` does **not**, and do not copy that gap.

## Phase 4 — Runtime

- [ ] Add a style hook and provider as a **sibling** of `useTheme`, not a widening of it. Use a new
      localStorage key beside `c64u_theme`, following `c64u_display_profile_override`. This leaves
      the 18 existing tests in `tests/unit/hooks/useTheme.test.ts` and
      `tests/unit/components/ThemeProvider.test.tsx` untouched.
- [ ] Implement `resolveAppearance()` per `spec.md` §7.1, including the dark-only clamp and the
      unknown-id fallback. This is the highest-value unit test in the feature: 12 styles x 3 theme
      settings x 2 system preferences = 72 pure cases.
- [ ] Write `data-app-style` on `<html>` alongside the existing `light` / `dark` class.
- [ ] Make `syncNativeSystemBarAppearance` (`src/lib/native/safeArea.ts:122`) derive icon polarity
      from the **luminance of the resolved background**, not from `resolvedTheme === "light"`.
      This is the only place a style can produce an unreadable system bar.
- [ ] Update `<meta name="theme-color">` at runtime when the style changes. Leave the build-time
      value in `index.html:14` and the manifest as brand colours.

## Phase 5 — The picker and Match my device

- [ ] Add the Style group to the Appearance card in `src/pages/SettingsPage.tsx` (the section begins
      at `:1177`). Full-width rows, each with the style name, a live three-colour swatch, and a
      dark-only marker where it applies. Follow the existing button-grid pattern used by Text size
      and Display profile, including their compact-profile single-column rule.
- [ ] Disable the Theme row when a dark-only style is selected, and say why. Do not hide it —
      a control that vanishes is harder to understand than one that explains itself.
- [ ] Add the "Match my device" entry, stored as its own sentinel value rather than as the style it
      currently resolves to. Read the device scheme on connect and on manual refresh only; never
      poll. Put the mapping table in the YAML, not in code.
- [ ] Handle the disconnected and unknown-scheme cases visibly: fall back to the compiled default
      and say so in the row's helper text.

## Phase 6 — The style gallery

- [ ] Add a developer-only `/dev/styles` route behind the existing developer-only feature-flag
      mechanism, rendering the real components in the sections listed in `spec.md` §11. It must
      import the shipped components, not copies.
- [ ] Accept `?style=` and `?mode=` so a screenshot run can address one palette directly.
- [ ] Add one Playwright spec walking 7 styles x 2 modes x N sections, writing
      `docs/img/app/styles/<style-id>-<mode>-<section>.png`. Set `meta.videoExpected = false` or use
      the `screenshots--` test-id prefix, or `scripts/validate-playwright-evidence.mjs:138-140` will
      fail the run demanding a `video.webm`. Register slugs through
      `playwright/screenshotCatalog.ts:44` so ordering is stable.

## Phase 7 — Tests

The organising principle: **a style is a data table**. Anything that is a property of the table is
tested as arithmetic in vitest, in milliseconds. Only the wiring between the table and the DOM needs
a browser, and the wiring is style-independent, so it is proved once.

**On all 12 palettes:**

- [ ] `tests/unit/lib/appStyles/contrast.test.ts` — every pair and minimum in `spec.md` §9, over the
      generated table. 12 palettes x ~10 pairs, under 50 ms. This is the real contrast gate.
- [ ] Structural completeness — every palette declares every token the stylesheet references; ids
      are kebab-case and stable; exactly the declared modes have colour blocks.
- [ ] Appearance resolution — the 72 pure cases from phase 4.
- [ ] **Geometry invariance**, per `spec.md` §10. One Playwright spec, two routes, two display
      profiles, twelve palettes applied in-page with no reload. Exact equality, no tolerance.
      Build the snapshot on the `page.evaluate` body at `playwright/layoutMetadata.ts:50-73` and
      the hidden-subtree filter at `playwright/smallScreenLayoutAudit.ts:119-127`. About 90 s.

**On the default style only — leave exactly as they are:**

`screenshots.spec.ts`, `smallScreenErgonomics.spec.ts`, `compactTextSweep.spec.ts`,
`smallScreenLayoutIntegrity`, `displayProfiles.spec.ts`, `callbackSmallScreen.spec.ts`,
`layoutOverflow.spec.ts`, `keypadInput.spec.ts`, `keypadOnlyNavigation.spec.ts`,
`buttonHighlightProof.spec.ts`.

- [ ] Write the justification into the header comment of the geometry-invariance spec and
      cross-reference it from those files, in the style `smallScreenErgonomics.spec.ts:33-37`
      already uses. Once "switching style changes zero geometry" is proven, re-running every layout
      and ergonomics assertion twelve times re-proves the same theorem. The keypad specs are already
      style-agnostic by construction: not one of them reads a colour, `box-shadow` or `outline` —
      they assert on `data-key-selected`, `data-c64-tap-flash` and `data-c64-persistent-active`.
- [ ] Decide `playwright/accessibility.spec.ts`. It currently filters axe results to
      `impact === "critical"` and tolerates up to 5, but axe's `color-contrast` rule is
      `impact: "serious"` — so contrast is computed and thrown away. Either tighten it to `serious`
      on the default style, or state in a comment that the vitest gate is now the contrast
      authority. Do not leave both weak.
- [ ] Do **not** multiply the screenshot corpus. 273 tracked PNGs x 12 would be 3,276 files and
      about 580 MB, and the existing pixel-dedupe in `screenshots.spec.ts:1211-1310` would never
      fire, because every pixel changes for every style.

**Expected CI delta:** the vitest work is unmeasurable inside the 1663 s unit job; geometry
invariance adds about 90 s to one e2e shard; the gallery adds about 50 s to the screenshots job;
the drift job runs in parallel. Roughly **+1.5 min on a 32 min pipeline**, and about +2 MB in git.

## Phase 8 — Documentation

- [ ] Add an internals note describing the style contract, the token list and the compiler, in the
      shape of `docs/internals/display-profiles.md`.
- [ ] Update the manual's Appearance section. `docs/manual/**/*.md` is **generated** by
      `scripts/build-manuals.mjs` — edit the source, not the output.
- [ ] Note in `docs/ux-guidelines.md` that new UI must use tokens, never raw Tailwind palette
      utilities, and point at the gallery route as the way to check it.
- [ ] **Clear the residual naming item in `spec.md` §6.4 before release.** EUIPO and USPTO have been
      searched; national registers (DE, GB, IT, JP and others) have not. Sweep those for each style
      `name:`. Changing a name is a one-field YAML edit — changing an `id` is not, so ids must be
      final before the first release that persists them.

---

## Sequencing notes

- Phases 0-2 can land as their own pull request. They are a strict improvement with no user-visible
  change beyond the toast and disk-chip bug fixes, and they make the phase-3 diff readable.
- Phase 3 is inert until phase 4 wires it up, so it can also land alone.
- Phases 4-6 are the user-visible change and should land together.
- Phase 7's geometry-invariance test should be written **before** phase 2's radius sweep, so that
  the sweep itself is checked by it.

## Definition of done

1. Seven styles selectable; twelve palettes; two dark-only styles clamp the Theme row and explain it.
2. Every palette passes every gate in `spec.md` §9 at compile time and in vitest.
3. The geometry-invariance test passes with exact equality on two routes at two display profiles.
4. `styles:check` fails on drift, in CI and not only locally.
5. The gallery renders every widget listed in `spec.md` §11 and its screenshots are committed.
6. No raw Tailwind palette utility, hex literal, or stock `rounded-*`/`shadow-*` remains in shipped
   app chrome. The 21 domain-data sites are unchanged.
7. "Match my device" maps all six device scheme names, falls back visibly, and never polls.
