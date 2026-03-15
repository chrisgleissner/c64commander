# Review 9 Remediation Log

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
- `doc/research/review-9/carry-forward.md`
- `doc/research/review-9/remediation-log.md`

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
