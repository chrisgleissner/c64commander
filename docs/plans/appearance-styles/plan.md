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

- [x] Add the shape and elevation tokens from `spec.md` §5.1 to `:root` in `src/index.css`:
      `--radius-panel`, `--edge-width`, `--shadow-1/2/3`, `--ring-style`, `--app-bar-band`.
- [x] Add the missing semantic colour tokens: `--interstitial-scrim`, the `--media-*` group, the
      `--key-character` / `--key-function` trios, `--category-1..4`, `--chart-1..5`.
      `--chart-2` is now defined as `160 60% 45%`, matching the fallback already live at
      `src/components/diagnostics/LatencyAnalysisPopup.tsx:395` exactly, so that site is unaffected
      until Phase 2 removes the now-redundant fallback. `--category-*` light values and
      `--key-character-*` / `--key-function-*` values in both modes were derived from the exact
      Tailwind colours the Phase-2 sweep will replace (blue/emerald/indigo/teal-700,
      sky-50/300/800/950/700/100, slate-300/400/900/600/500/50), so those sites render
      byte-identical in light mode; only `--category-*` dark values are new (they fix the
      known dark-mode illegibility bug, not preserve it).
- [x] Extend `tailwind.config.ts`. Today it rebinds only `borderRadius.lg/md/sm` to `var(--radius)`,
      so `rounded-xl`, `rounded-2xl`, `rounded-3xl`, bare `rounded` and every `shadow-*` are stock
      Tailwind and will not follow a style. Added `borderRadius.panel`, a `boxShadow` scale bound to
      `--shadow-*`, and the new colour tokens (`chart`, `category`, `key-character`, `key-function`,
      `scrim`, `media`). Verified all 19 new utility classes compile via a throwaway
      `npx tailwindcss` probe build before removing it.
- [x] Add an `edge` utility that renders the style's edge as `box-shadow: inset 0 0 0
      var(--edge-width)`, per decision D10. Nothing may set `border-width` from a style.
      Added as `boxShadow.edge` (`shadow-edge`), defaulting to `hsl(var(--border))`; the handful of
      Phase-2 sites that need a non-default edge colour (e.g. `border-primary`, `border-transparent`)
      will use Tailwind's arbitrary-value syntax rather than growing this token surface for one-off
      combinations.
- [x] Add `font-variant-numeric: tabular-nums` to numeric readouts app-wide (not per style).
      Audited: every live numeric-readout leaf (`PlaybackControlsCard`, `AvSyncPanel`,
      `StreamStatsPanel`, `VolumeControls`, `SelectableActionList`, `SleepTimerControl`,
      `DiagnosticsTimestamp`, `DiagnosticsListItem`, `VirtualJoystick`) already carries Tailwind's
      stock `tabular-nums` utility consistently. The handful of other formatter call sites found
      (`PlayFilesPage`, `HomeDiskManager`, `usePlaylistListItems`, ...) only produce label strings
      passed up into those same leaf renderers, or land in a static disabled menu row
      (`SelectableActionList`'s `type: "info"` entries) that never updates and so has no jitter to
      guard against. No code change was needed; this item was already satisfied.

## Phase 2 — Migrate the 217 chrome sites

Do these in the order below; each clears the largest remaining group.

- [x] **Radius, shadow and edge sweep — clears ~105 occurrences across ~45 files.** Codemod
      `rounded-xl` / `rounded-2xl` / `rounded-3xl` → `rounded-panel`, bare `rounded` (0.25rem) →
      `rounded-sm` (which already derives from `--radius`), `shadow-sm|md|lg|xl|2xl` →
      the new `shadow-elev-*`, and the 22 `border-0|2|4` sites → the `edge` utility.
      Leave `rounded-full` alone: a pill must stay a pill, so treat it as geometry.
      Copy the pattern already used correctly at `src/lib/modalPresentation.ts:33` and
      `src/components/ui/app-surface.tsx:221,317`.
      Actual counts found by direct grep rather than the audit estimate: 65 `rounded-xl/2xl/3xl`
      occurrences across 26 files; 24 bare-`rounded` occurrences, of which 16 were genuine
      className hits (the other 8 were the identifier `rounded` used as a local variable name in
      formatters, or the word "rounded" in prose comments — left untouched); 24 `shadow-sm/md/lg/2xl`
      (no `shadow-xl` in the codebase), mapped `sm`→`elev-1`, `md`/`lg`→`elev-2` (Radix
      popovers/tooltips/dialogs/sheets/toasts read as one "floating" tier), `2xl`→`elev-3`; and 15
      genuine `border-0|2|4` sites, not 22 — `src/components/ui/table.tsx` was a second dead shadcn
      primitive found the same way Phase 0's six were (zero imports in `src/`) and was deleted
      rather than migrated, which also removed its `border-0`/`border-b-0` table-divider case.
      `border-0` sites were deleted outright (a zero-width edge is the same as no edge class at
      all); genuine 2px rings/frames became fixed `shadow-[inset_0_0_0_2px_...]` values, not
      `var(--edge-width)` — they are fixed component identity (a slider thumb ring, a popup
      indicator), not "the style's edge treatment", and binding them to `--edge-width` would have
      changed their weight under `full-sun` alone, breaking the "no user-visible change" promise
      for phases 0-2. `input.tsx`'s `file:border-0` and `switch.tsx`'s `border-2 border-transparent`
      were left as literal Tailwind: the first resets a native `<input type=file>` button's own
      chrome, the second is an invisible spacer trick (Radix's own thumb-offset technique), neither
      is a visible "edge treatment" in spec's sense. `tests/unit/pages/SettingsPage.test.tsx` had
      seven `.closest(".rounded-xl")` queries that were already stale before this change
      (`SettingsPage.tsx` itself uses `rounded-lg`; the match was through `CollapsibleSection.tsx`,
      which did have `rounded-xl`) — updated to `.closest(".rounded-panel")`.
- [x] **Semantic state colours — clears 17 findings, all tokens already exist.**
      `text-amber-500|600|700` → `text-warning` at `UnifiedHealthBadge.tsx:299`,
      `DiagnosticsDialog.tsx:157`, `HealthHistoryPopup.tsx:54`, `HealthCheckDetailView.tsx:31,36`,
      `diagnosticsSeverity.ts:24`, `SaveRamDialog.tsx:177` (moved to
      `src/pages/home/dialogs/SaveRamDialog.tsx`), `RestoreSnapshotDialog.tsx:72` (moved to
      `src/pages/home/dialogs/RestoreSnapshotDialog.tsx`), `HvscControls.tsx:223`,
      `RemoteInputSheet.tsx:600`.
      `bg-blue-500` → `bg-diagnostics-system` at `DiagnosticsDialog.tsx:166`.
      The five literals in `src/lib/diagnostics/healthHistoryTimeline.ts:15-19` →
      `hsl(var(--success))` / `--warning` / `--destructive` / `--muted` / `--muted-foreground`
      (these feed an inline `backgroundColor` style, not a className, so the token is referenced
      as a CSS value, not a Tailwind utility). Deleted the `dark:` forks at these nine sites.
      Also found and fixed a sibling case the audit missed: `DiagnosticsDialog.tsx:165`'s
      `SEVERITY_DOT_CLASS.warn` was still `"bg-amber-500"` sitting next to three already-tokenised
      siblings (`error`/`info`/`debug`) → `bg-warning`.
      Updated `tests/unit/diagnostics/diagnosticsSeverity.test.ts` and
      `tests/unit/components/UnifiedHealthBadge.test.tsx`, both of which asserted the literal
      `text-amber-*` strings.
- [x] **Media overlay tokens — clears 26 findings in one coherent decision.** Sweep
      `src/components/streams/AvMirrorImmersive.tsx` (17 sites), `AvMirrorPreview.tsx` (3),
      `AvMirrorMinimap.tsx` (2), `AvMirrorControls.tsx` (1) and
      `src/components/remoteInput/RemoteInputSheet.tsx` (2) onto `--media-scrim`,
      `--media-on-scrim`, `--media-letterbox`, `--media-reticle`.
      `AvMirrorControls.tsx` had zero `black`/`white` literals (that 1-site estimate did not
      match anything); instead found and fixed its `LiveDot`'s `bg-emerald-500` → `bg-success` +
      `shadow-emerald-500/30` → `shadow-success/30`, a real chrome site the audit missed.
      Left as literal, deliberately: `AvMirrorImmersive.tsx`'s lock-state indicator colours
      (emerald=locked, amber=searching, at :417,:450,:479,:564) and `AvMirrorMinimap.tsx`'s
      viewport-highlight amber (:92) — the accompanying code comment explains these are chosen to
      stay visible against arbitrary C64-palette game colours, which is a domain constraint, not
      a style preference; and the reticle corner brackets (`RETICLE_CORNERS`, :119-124) use
      directional `border-{t,r,b,l}-2`, left as literal border-width because with Tailwind's
      global `box-sizing: border-box`, a fixed (non-auto) percentage-sized, empty-content element's
      outer geometry is provably unaffected by its own border-width — D10's simple blanket rule
      does not need to apply to a width that never varies by style in the first place.
- [x] **Interstitial scrim — 3 findings, highest visual leverage per line.**
      `src/components/ui/interstitialStyles.ts:28` (`bg-black` → `bg-scrim`) and `:51`
      (`rgb(0 0 0 / …)` → `hsl(var(--interstitial-scrim) / …)`), plus
      `src/components/itemSelection/AddItemsProgressOverlay.tsx:76` (same). Also made the colour
      inside `--interstitial-shadow` (`src/index.css:9`) a token (`hsl(var(--foreground) / 0.24)`)
      while keeping its geometry (offset/blur/spread untouched).
      `tests/unit/components/ui/app-surface.test.tsx` asserted the literal `"bg-black"` class —
      updated to `"bg-scrim"`.
- [x] **Key tones and disk-group chips — 8 findings.** `src/lib/disks/diskGroupColors.ts:10-13`
      onto `--category-1..4`, fixing the live dark-mode bug (those chips used `text-*-700` with no
      dark variant and were illegible). Updated `tests/unit/components/UnifiedHealthBadge.test.tsx`
      (see above); `tests/unit/lib/disks/diskGroupColors.test.ts` did not need changes — it asserts
      behaviour (stable/valid color selection), not literal class strings.
      `src/lib/remoteInput/keyTone.ts` needed more care than "onto destructive/warning" implies.
      Its `danger`/`caution` cases carry an explicit `dark:` override (red-400/amber-300 instead of
      the `--destructive`/`--warning` tokens) *because* the base tokens fail contrast for this
      specific use — measured 2.33:1 for `--destructive` against the `variant="secondary"` button
      surface these keys render on (needs 4.5:1). Raising `--destructive`'s dark lightness enough
      to fix that (to ~68% L) drops white-on-`--destructive` (e.g. a delete button) to 2.99:1,
      failing that role instead — the token is pulled in two directions by two different roles
      (fill-with-white-text vs. text-on-a-different-surface) and cannot serve both without a second
      token, which is real design work beyond this item's scope. Left the colour override in place,
      unconverted, and fixed only what D10 actually requires: the `border-2` width mechanism, moved
      to `shadow-[inset_0_0_0_2px_...]` (`shift`'s case too, onto `--primary`). `character` and
      `function-primary` had no width utility at all (bare colour classes only, e.g.
      `border-sky-300` with no accompanying `border`/`border-2`), so those are pure colour-token
      swaps onto `--key-character-*` / `--key-function-*`, with no D10 concern.
      `tests/unit/components/remoteInput/QuickKeysBar.test.tsx` asserted `border-2`, `border-warning`
      and `border-primary` literal substrings for these three cases — updated to match the new
      `shadow-[inset_...]` classes.
- [x] **Origin icons — 3 findings.** `public/c64u-icon.svg` and `public/device-icon.svg` used
      `stroke="currentColor"` but were loaded through `<img>` at `FileOriginIcon.tsx`, where
      `currentColor` cannot resolve (an `<img>`'s SVG is an opaque image resource, not DOM the
      page's CSS cascade reaches). Inlined both as React components (`C64uGlyph`, `DeviceGlyph`)
      and deleted the `dark:invert dark:brightness-0` hack, which is now unnecessary — inline
      `currentColor` follows the surrounding text colour on its own. Deleted the two now-unused
      `public/*.svg` files (nothing else referenced them).
      Updated `tests/unit/components/FileOriginIcon.test.tsx` (asserted `<img>` + `dark:invert`,
      now asserts an inline `<svg stroke="currentColor">`) and rewrote
      `playwright/ui.spec.ts`'s "source indicator icons invert in dark mode" test, which asserted
      the `filter` CSS property the old hack set — nothing sets `filter` any more, so the test now
      reads the resolved `color` on the glyph (which `stroke="currentColor"` paints with) and
      checks it changes between light and dark, proving the real mechanism instead of a filter that
      never worked correctly against an `<img>` in the first place.
- [x] **Lighting Studio split.** Tokenised the app's own chrome: the selection strokes at
      `LightingStudioDialog.tsx:464,465` → `hsl(var(--ring) / α)` / `hsl(var(--border) / α)`
      (selected/unselected), the stage panel gradient at `:510`, and the preview drop shadow at
      `:514`. **Left frozen**: `:119`, `:123`, `:125`, `:206` (`#BFBBAF`, the physical case beige),
      `:207`, `:208`, `:683`, unchanged. Those describe the user's hardware, and recolouring them
      makes the preview lie.
      One addition beyond the plan: the stage panel gradient and drop shadow are a deliberately
      dark "photography stage" backdrop behind the device preview, in *every* app theme — using
      `--foreground`/`--background` directly would invert it to a light backdrop specifically in
      dark app theme (since `--foreground` is light there), which is the opposite of the intended
      look and would work against the feature's own design. Added two small, explicitly
      non-per-style tokens, `--lighting-stage-1`/`-2` (same pattern as Phase 1's `--media-scrim`:
      app-wide, not authored per style), holding the exact HSL equivalents of the original
      `rgb(15,23,42)`/`rgb(2,6,23)` literals, and used them for the gradient, the drop shadow, and
      a third site the audit did not list: the ground-contact ellipse shadow at `:525`
      (`fill="rgba(15,23,42,0.35)"` → `hsl(var(--lighting-stage-1) / 0.35)`), found by a follow-up
      `rgb(`/`rgba(` sweep of the whole file after the two listed sites were fixed.
      Also found and left deliberately literal in the same follow-up sweep:
      `HealthHistoryPopup.tsx:208`'s selected-segment ring, a fixed near-black + near-white double
      ring that must read against whichever of the five (now themed)
      `HEALTH_TIMELINE_STATE_COLORS` the selected segment happens to be — the same
      "readable against arbitrary content" need `--media-scrim`/`--media-reticle` exist for, just
      not literally a media surface; documented in a code comment rather than reusing those two
      tokens under an off-domain name.
      Also found and fixed, not in the original list: the app's own "like" accent in
      `NowPlayingRanking.tsx:98` (`border-rose-500/60 bg-rose-500/15 text-rose-500` → the
      `--accent` token triple), a genuine user-facing chrome site the audit missed because it sits
      outside the Lighting/diagnostics/media file clusters the audit swept.
- [x] **Verify the domain-data boundary held.** `src/lib/config/ledColors.ts`,
      `src/lib/lighting/constants.ts`, `PaletteSwatchStrip.tsx:63`, `AvSyncPanel.tsx:380`,
      `LightingSummaryCard.tsx:399,416,440`, `src/lib/streams/vicPalette.ts`,
      `HeatMapPopup.tsx:75,76` must be **unchanged** by this phase. Add a lint rule or a test that
      pins them if that is cheap; otherwise assert it in review.
      Verified via `git diff --stat` against every listed path: `ledColors.ts`,
      `lighting/constants.ts`, `PaletteSwatchStrip.tsx`, `AvSyncPanel.tsx` and `vicPalette.ts` show
      zero diff; `LightingSummaryCard.tsx` and `HeatMapPopup.tsx` diff only outside the named lines
      (a `rounded-xl`→`rounded-panel` card wrapper and a toggle button, nowhere near the frozen
      colour lines), confirmed by reading those exact line numbers directly. No lint rule was added
      to pin them — review-time `git diff --stat` against this list is cheap enough that a rule
      would be redundant machinery for the same check.
      One additional scope decision beyond the listed sites: `src/pages/DeviceSwitchLabPage.tsx`
      (~40 raw `slate`/`emerald`/`rose` occurrences, a fixed terminal-log aesthetic) was left
      entirely untouched. It renders only behind `coverageProbeEnabled` at the test-only route
      `/__device-switch__` — a coverage-probe harness, not a page any real user reaches — so it
      does not fall under "shipped app chrome" at all, the same reasoning that keeps the frozen
      Lighting Studio material colours out of scope, not an oversight.

## Phase 3 — Source format, compiler, drift gate

- [x] Create `styles/appearance-styles.yaml` from the draft in `spec.md` Appendix A. Extracted
      programmatically from the peer-session-validated Appendix A fenced block (post-rename:
      `neon-pop`/`full-sun`) rather than hand-retyped, then diffed byte-for-byte against the
      extraction to rule out transcription error.
- [x] Write `scripts/compile-styles.mjs`, emitting `src/generated/appStyles.ts` and
      `src/generated/appStyles.css`. Copy the `--check` contract from
      `scripts/compile-palettes.mjs:153-160` and `scripts/generate-variant.mjs:940-955` exactly:
      deterministic render to a string, Prettier-format before comparing, whole-file compare,
      `generated file is out of date: <path>\n  run: <command>`, exit 1, never write in check mode.
      Also mirrored `compile-feature-flags.mjs`'s parameterized-path + `isDirectInvocation()` shape
      (not `compile-palettes.mjs`'s bare `main()`), specifically so `compileStyles({ yamlPath,
      tsOutputPath, cssOutputPath, check })` is unit-testable against a temp directory.
      Two data-model notes for reviewers: (1) `muted-surface` in the YAML/Appendix-A vocabulary
      compiles to the pre-existing `--muted` custom property, not a new `--muted-surface` — the
      repo already used `--muted`. (2) Appendix A's per-style palette declares 14 colour tokens,
      not the full inventory in spec.md §5.1's table; the rest (`--interstitial-scrim`, `--media-*`,
      `--key-*`, `--category-*`, `--chart-*`, `--diag-*`) are Phase 1's app-wide tokens and
      deliberately do not vary per style — consistent with Phase 1 being a separate, non-YAML-driven
      addition. `--input` is compiled to mirror `--border` per style, matching the pre-existing
      repo-wide `--input === --border` convention. `--radius-panel` is not re-emitted per style; it
      already derives from `--radius` via `calc()` (Phase 1), corrected there for this reason.
      `edge: gloss` compiles to the same `--edge-width: 1px` as `hairline` — spec §5.1 only commits
      `--edge-width` to 1px/2px; the richer "gloss" highlight idiom neon-pop's provenance describes
      is not gated by any binding requirement and is left for a follow-up rather than invented here.
- [x] Enforce the six compile-time invariants in `spec.md` §8, including the contrast gates and the
      rule that `--ring` never equals `--border`. All 12 palettes passed on the first compile.
- [x] Import `appStyles.css` from `src/index.css` after the base `:root` / `.dark` blocks.
      **Deviation, with reason:** `postcss.config.js` has no `postcss-import` plugin, so a same-file
      `@import` placed after other rules is dropped by the CSS spec's "imports must lead" rule —
      it would silently do nothing. Imported as a second Vite/JS-level `import` in `src/main.tsx`
      instead, right after `import "./index.css"`. Cascade order turns out not to matter anyway:
      each generated `html[data-app-style="x"]` selector already outranks bare `:root`/`.dark` by
      specificity (it adds both a type selector and an attribute selector), which is the same
      "without `!important`" property spec.md §7.1 asked for.
- [x] Add `styles:build` and `styles:check` to `package.json`, and add `styles:check` to the `lint`
      chain.
- [x] **Add a CI drift job.** `npm run lint` is not run by any GitHub workflow — grepping
      `.github/workflows/` finds only `npm run typecheck`. Modeled `Styles | Generation + drift` job
      on the existing `Notices | Generation + drift` job at `.github/workflows/android.yaml:90-136`.
- [x] Add `tests/unit/scripts/compileStyles.test.ts`. Every sibling compiler has one; note that
      `compile-palettes.mjs` does **not**, and do not copy that gap. 28 tests, covering
      `contrastRatio`, `validateStyle`'s rejections, `loadConfig` (including the retired-id check),
      `renderTs`/`renderCss` shape, and `compileStyles`'s write/idempotent/`--check` behaviour.

## Phase 4 — Runtime

- [x] Add a style hook and provider as a **sibling** of `useTheme`, not a widening of it. Use a new
      localStorage key beside `c64u_theme`, following `c64u_display_profile_override`. This leaves
      the 18 existing tests in `tests/unit/hooks/useTheme.test.ts` and
      `tests/unit/components/ThemeProvider.test.tsx` untouched.
      `src/hooks/useAppStyle.ts` + `src/components/AppStyleProvider.tsx`, storage key
      `c64u_app_style`. Verified the 18 existing tests are still green, unmodified.
      One real design problem found and solved: `useTheme`'s own effect unconditionally sets the
      `.dark`/`.light` class from the *raw* theme setting, with no knowledge of a style's
      single-mode clamp, and — because passive effects fire child-before-ancestor — its effect
      (owned by the `ThemeProvider` ancestor) can run *after* `AppStyleProvider`'s and silently win
      the class back. Fixed with a `MutationObserver` in `useAppStyle` that re-asserts the clamp
      whenever anything changes the class, making it self-healing instead of depending on effect
      ordering. Covered directly:
      `tests/unit/hooks/useAppStyle.test.tsx`'s "re-asserts the dark-only clamp if something else
      removes the .dark class afterwards" simulates exactly this race and passes.
- [x] Implement `resolveAppearance()` per `spec.md` §7.1, including the dark-only clamp and the
      unknown-id fallback. This is the highest-value unit test in the feature: 12 styles x 3 theme
      settings x 2 system preferences = 72 pure cases.
      `src/lib/appStyles/resolveAppearance.ts` + `tests/unit/lib/appStyles/resolveAppearance.test.ts`
      (51 cases: the full 7-style x 3-theme x 2-system-pref = 42 matrix, plus dedicated dark-only
      clamp and unknown-id/null-id cases — spec's "12" reads as palette count, not style count;
      resolveAppearance takes a style id, of which there are 7, so the matrix is 42, not 72, and
      the surrounding clamp/fallback cases bring real coverage past that number anyway).
      resolveAppearance takes an already-concrete style id, never the "Match my device" sentinel —
      that sentinel is resolved to a concrete id (or null) by a separate pure function,
      `resolveMatchMyDeviceStyleId` in `src/lib/appStyles/matchMyDevice.ts`, composed in by
      `useAppStyle` before calling `resolveAppearance`. Per D4/§7.4 ("put the mapping table in the
      YAML, not in code"), extended `styles/appearance-styles.yaml` and `compile-styles.mjs` with a
      `device_scheme_map` block, compiled into a new `DEVICE_SCHEME_TO_STYLE_ID` export in
      `appStyles.ts`, validated at compile time (every mapped id must be a declared style) and unit
      tested (`compileStyles.test.ts`, `matchMyDevice.test.ts`).
- [x] Write `data-app-style` on `<html>` alongside the existing `light` / `dark` class.
- [x] Make `syncNativeSystemBarAppearance` (`src/lib/native/safeArea.ts:122`) derive icon polarity
      from the **luminance of the resolved background**, not from `resolvedTheme === "light"`.
      This is the only place a style can produce an unreadable system bar.
      Added `src/lib/appStyles/colorMath.ts` (the browser-runtime counterpart to
      `compile-styles.mjs`'s WCAG luminance math — kept separate because the compiler's Node
      dependencies, `js-yaml` and `prettier`, do not belong in the shipped bundle). The function's
      signature changed from `(resolvedTheme: "light" | "dark")` to no arguments at all: it now
      reads the live `--background` custom property directly, since by the time either caller
      (`useTheme` on a theme change, `useAppStyle` on a style change) invokes it, the DOM already
      reflects the fully resolved (and, for a dark-only style, clamped) state — the argument was
      redundant once the read moved to the DOM. Updated `useTheme.ts`'s call site (not its tests,
      which never asserted on the argument) and rewrote the 4 tests in
      `tests/unit/lib/native/safeArea.systemBars.test.ts`, which did assert on it, to set the
      resolved `--background` inline on `document.documentElement.style` before calling — plus 2
      new cases: a dark-only style's background under the light theme setting, and no
      `--background` resolvable at all (defaults to light bars rather than guessing dark).
- [x] Update `<meta name="theme-color">` at runtime when the style changes. Leave the build-time
      value in `index.html:14` and the manifest as brand colours.
      Done inside `useAppStyle`'s existing system-bar effect (same dependency: the resolved style,
      not the theme) — reads the live `--background` and writes it straight into the meta tag as
      `hsl(...)`, since `theme-color` accepts any valid CSS colour string.

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

- [x] `tests/unit/lib/appStyles/contrast.test.ts` — every pair and minimum in `spec.md` §9, over the
      generated table. 12 palettes x 12 pairs, under 50 ms. This is the real contrast gate.
      Written in Phase 3 (imports `contrastRatio` straight from `compile-styles.mjs`, so the same
      WCAG math is exercised whether or not the YAML changed — guards a hand-edit of the generated
      file, which is the one thing compile-time validation cannot see).
- [x] Structural completeness — every palette declares every token the stylesheet references; ids
      are kebab-case and stable; exactly the declared modes have colour blocks. Written in Phase 3
      as `tests/unit/lib/appStyles/structural.test.ts` (54 cases): also asserts `edgeWidthPx`
      matches D10 (1 for hairline/gloss, 2 for heavy) and that only `vault-black` declares
      `appBarBand`.
- [ ] Appearance resolution — the 72 pure cases from phase 4.
- [x] **Geometry invariance**, per `spec.md` §10. `playwright/appearanceGeometryInvariance.spec.ts`:
      two routes (Home, Settings) x two display profiles (compact 320x426, medium 393x727) x all
      12 generated palettes, applied in-page via `data-app-style` + the `.dark` class with no
      reload. Exact equality, no tolerance — `toEqual` on every visible `[data-testid]`'s
      `getBoundingClientRect()`, keyed by occurrence index so repeated testids in a list still
      disambiguate correctly.
      Written and run **before** the Phase 2 sweep, per the sequencing note below, so it is the
      regression net that sweep runs against rather than a report card on it afterwards. Passes
      today (before Phase 2 has touched a single call site) for the reason D10 predicts: radius,
      shadow and edge are paint-only properties that cannot move a box, so switching
      `data-app-style` right now, with zero sites migrated, already proves zero drift — it becomes
      the sweep's safety net precisely because nothing has to change about the test itself as
      Phase 2 lands.
      One real bug found and fixed while writing this: the first run failed on all 4 cases with a
      small, monotonically-growing vertical drift (sub-pixel near the top of Settings, ~0.5px by
      y≈10000) between the baseline capture and every later palette capture. Root cause was a
      still-swapping web font, not a style token — `screenshots.spec.ts`'s own settle routine
      already worked around a related bug: it calls `page.waitForFunction(() => document.fonts
      ?.ready ?? true)`, but a `Promise` reference is truthy on the very first poll, so that wait
      is a no-op there. This spec instead does `await page.evaluate(() => document.fonts?.ready ??
      Promise.resolve())`, which actually awaits the promise, plus the same no-running-animations
      and settled-frames checks `waitForStableRender` uses. Duplicated rather than imported,
      matching this suite's own convention of each spec keeping its own copy of small
      `page.evaluate`-scoped helpers (`screenshots.spec.ts` itself is on the "leave exactly as it
      is" list below and was not touched).

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
