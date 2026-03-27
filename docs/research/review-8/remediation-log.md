# Review 8 Remediation Log

## 2026-03-14T19:01:59+00:00

### Issues addressed

- `R8-01` display-profile preference propagation on web
- `R8-02` display-profile verification/documentation drift
- `R7-04` iOS FTP plugin-proof gap reviewed for feasibility in the current repository harness

### Fixes implemented

- Added browser `storage` event handling in `DisplayProfileProvider` so cross-tab `c64u_display_profile_override` changes refresh the active tab state.
- Added unit coverage proving storage-driven display-profile updates apply the persisted override and ignore unrelated storage keys.
- Added focused Playwright coverage proving compact diagnostics CTAs remain reachable after increased text size.
- Hardened shared modal geometry to read provider-maintained live viewport CSS variables instead of only raw `100dvh`/`100vw` sizing assumptions.
- Tightened `ItemSelectionDialog` flex boundaries so the scrollable middle pane owns overflow and header/footer stay pinned.
- Updated the display-profile implementation plan so it no longer claims keyboard-safe/browser-zoom verification that the current executable suite does not yet prove.

### Files modified

- `src/hooks/useDisplayProfile.tsx`
- `src/hooks/useDisplayProfile.test.tsx`
- `src/lib/modalPresentation.ts`
- `src/index.css`
- `src/components/itemSelection/ItemSelectionDialog.tsx`
- `playwright/displayProfiles.spec.ts`
- `docs/plans/display-profiles/display-profiles-implementation-plan.md`
- `docs/research/review-8/carry-forward.md`
- `docs/research/review-8/remediation-log.md`

### Tests added or updated

- Added storage-event coverage in `src/hooks/useDisplayProfile.test.tsx`.
- Added increased-text-size CTA reachability coverage in `playwright/displayProfiles.spec.ts`.

### Documentation changes

- Corrected `docs/plans/display-profiles/display-profiles-implementation-plan.md` so increased text size is marked verified, while browser zoom and live keyboard-open viewport reduction remain explicitly open.

### Validation

- `runTests` on `src/hooks/useDisplayProfile.test.tsx` passed.
- `runTests` on `src/components/itemSelection/ItemSelectionDialog.test.tsx` passed.
- `PLAYWRIGHT_DEVICES=web npx playwright test playwright/displayProfiles.spec.ts --project=web` passed.
- `npm run lint` passed.
- `npm run build` passed.
- `npm run test:coverage` passed with global branch coverage at `91%` and global statement/line coverage at `92.42%`.

### Remaining unresolved issues

- `R7-04` remains open. The repository still lacks an iOS app-plugin XCTest surface comparable to Android's `FtpClientPluginTest.kt`; current CI only executes `ios/native-tests` Swift package coverage.
- `R8-02` remains open in narrowed form. The documentation drift is corrected and increased-text-size proof now exists, but deterministic browser-zoom and explicit keyboard-open/visual-viewport proof are still missing.

## 2026-03-14T19:24:22+00:00

### Issues addressed

- `R8-02` display-profile verification coverage gap narrowed further after follow-up remediation
- `R7-04` iOS FTP plugin-proof gap re-verified against the live iOS project structure

### Fixes implemented

- Added Playwright coverage proving compact diagnostics CTAs remain reachable after reduced viewport height.
- Added Chromium/web Playwright coverage proving compact diagnostics CTAs remain reachable under browser zoom.
- Refactored `DiagnosticsDialog` into a `min-h-0` flex-column shell so the tab content scrolls within the available viewport instead of relying on fixed `100dvh` max-height math.
- Added one more unit regression in `useDisplayProfile.test.tsx` covering storage-clear refresh and non-`localStorage` storage events so the global coverage gate remains at the repository threshold.
- Re-verified that `ios/App/App.xcodeproj/project.pbxproj` still defines only the app target, so `R7-04` remains a real harness gap rather than stale audit drift.

### Files modified

- `src/components/diagnostics/DiagnosticsDialog.tsx`
- `playwright/displayProfiles.spec.ts`
- `src/hooks/useDisplayProfile.test.tsx`
- `docs/plans/display-profiles/display-profiles-implementation-plan.md`
- `docs/research/review-8/carry-forward.md`
- `docs/research/review-8/remediation-log.md`

### Tests added or updated

- Added reduced-height CTA reachability coverage in `playwright/displayProfiles.spec.ts`.
- Added browser-zoom CTA reachability coverage in `playwright/displayProfiles.spec.ts`.
- Added storage-clear and non-`localStorage` event coverage in `src/hooks/useDisplayProfile.test.tsx`.

### Documentation changes

- Updated `docs/plans/display-profiles/display-profiles-implementation-plan.md` so browser-zoom verification is no longer listed as open.
- Updated `docs/research/review-8/carry-forward.md` so `R8-02` reflects the remaining keyboard-open-only gap and `R7-04` explicitly notes the missing XCTest target.

### Validation

- `runTests` on `src/hooks/useDisplayProfile.test.tsx` passed.
- `PLAYWRIGHT_DEVICES=web npx playwright test playwright/displayProfiles.spec.ts --project=web` passed with 9 tests.
- `npm run lint` passed.
- `npm run build` passed.
- `npm run test:coverage` passed with global branch coverage at `91%` and global statement/line coverage at `92.42%`.

### Remaining unresolved issues

- `R7-04` remains open. The iOS app project still has no XCTest bundle target in `ios/App/App.xcodeproj/project.pbxproj`, so there is still no direct app-plugin harness comparable to Android's `FtpClientPluginTest.kt`.
- `R8-02` remains open in narrowed form. Browser-zoom and reduced-height CTA reachability are now covered, but explicit live keyboard-open or visual-viewport proof is still missing.
