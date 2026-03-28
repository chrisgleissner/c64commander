# Review 9 Remediation Log

## 2026-03-15T12:00:00Z

### Current remediation pass opened

- Re-read the full `docs/research/review-9/` document set, including `review-9.md`, `display-profiles-review.md`, `carry-forward.md`, `remediation-log.md`, `work-log.md`, and `worklog.md`.
- Confirmed that the previously resolved items remain resolved and that the live remaining work is still concentrated in:
  - profile-sensitive Home / Play / Settings layout debt
  - `QuickActionCard` caller-owned density contract
  - `ConfigItemRow` measurement-only contract
  - stale UX coverage inventory entries versus actual Playwright coverage
  - missing Settings coverage for `System theme` and `Test connection`
  - legacy diagnostics screenshot filenames using `expanded` outside profile folders
  - lack of an automated guardrail against new raw breakpoint classes in the audited surfaces
- Replaced `PLANS.md` with a multi-phase implementation plan that maps each outstanding Review 9 issue to concrete code, test, documentation, screenshot, validation, commit, push, and CI tasks.
- Next step: implement the remaining profile-branching cleanup and shared-component contract changes before updating the test inventory.

## 2026-03-15T13:30:00Z

### Profile cleanup and coverage pass completed

- Replaced the remaining reviewed `sm:` / `md:` structural branches in Home, Play, Settings, and the shared selection list with display-profile-aware logic.
- Normalized `QuickActionCard` to consume shared profile/grid density context and updated `ConfigItemRow` so Compact layout is profile-driven before measurement fallback.
- Added regression coverage for shared profile behavior and new Playwright proofs for Home machine quick actions, confirmed power off, System theme, Refresh connection, and Recurse folders.
- Reconciled `docs/ux-interactions.md` with the current suite and renamed diagnostics screenshot outputs to avoid reusing `expanded` outside the profile-folder convention.

## 2026-03-15T00:00:00Z

### Issues addressed

- Missing focused-input Compact keyboard-safe coverage beyond the diagnostics dialog.
- Missing end-user README guidance for display profiles and profile-specific screenshots.
- Remaining binary mobile abstraction used by the sidebar path.
- Remaining shared breakpoint dependence in dialog/footer and selection-browser layout primitives identified in Review 9.

### Fixes implemented

- Added Playwright coverage for Compact reduced-height keyboard-like conditions while an input is focused in the selection browser and snapshot manager.
- Reworked shared `Dialog` and `AlertDialog` header/footer layout classes to use modal-presentation mode instead of `sm:` responsive classes.
- Reworked `ItemSelectionDialog` interstitial grid and footer layout to use the resolved display profile instead of `sm:` breakpoint classes, and tightened Compact fullscreen spacing so the focused-input selection browser keeps its confirm CTA visible in reduced-height mode.
- Updated the sidebar to consume `useDisplayProfile()` directly and removed the now-unused `use-mobile` helper.
- Added README documentation for display-profile behavior, override labels, and profile-specific screenshot folders.

### Files modified

- `src/components/ui/dialog.tsx`
- `src/components/ui/alert-dialog.tsx`
- `src/components/ui/sidebar.tsx`
- `src/components/itemSelection/ItemSelectionDialog.tsx`
- `playwright/displayProfiles.spec.ts`
- `README.md`
- `docs/research/review-9/carry-forward.md`
- `docs/research/review-9/remediation-log.md`

### Files removed

- `src/hooks/use-mobile.tsx`

### Tests added or updated

- Updated `playwright/displayProfiles.spec.ts` with Compact focused-input reduced-height coverage for:
  - selection browser dialog
  - snapshot manager dialog

### Documentation changes

- Documented display-profile override semantics and profile-specific screenshot organization in `README.md`.

### Validation

- `npm run build` passed.
- `npm run lint` passed after removing the temporary `.cov-review9/` coverage artifact used to inspect the global coverage summary.
- Targeted unit tests passed for `src/components/ui/dialog.test.tsx` and `src/components/itemSelection/ItemSelectionDialog.test.tsx`.
- Targeted Playwright coverage passed for the new Compact reduced-height selection-browser and snapshot-manager scenarios in `playwright/displayProfiles.spec.ts`.
- Global unit coverage summary from `.cov-review9/coverage-summary.json` reported 91.01% branch coverage.

### Remaining unresolved issues

- Home and playback subcomponents still contain profile-sensitive `sm:` / `md:` structural layout debt.
- Several CTA coverage gaps from Review 9 remain open.
- `ConfigItemRow` remains measurement-driven rather than profile-driven and is intentionally deferred for now.
