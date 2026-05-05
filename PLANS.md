# C64 Commander Fix Plan

## Classification

`DOC_PLUS_CODE` and `UI_CHANGE`.

Executable code, visible Home/Diagnostics UI, runtime health/request behavior, tests, and generated feature-flag registry are in scope. Screenshots may be needed only for documented visible Home/Diagnostics changes; this will be decided after implementation.

## Orientation Findings

- App overview and validation guidance are in `README.md` and `.github/copilot-instructions.md`.
- UX guidance for visible changes is in `docs/ux-guidelines.md`.
- Test/build scripts are in `package.json`:
  - `npm run lint`
  - `npm run test`
  - `npm run test:coverage`
  - `npm run build`
  - `npm run cap:build`
  - `npm run android:apk`
- Feature flags are authored in `src/lib/config/feature-flags.yaml` and generated into `src/lib/config/featureFlagsRegistry.generated.ts`.
- Home page UI is mainly `src/pages/HomePage.tsx` and `src/pages/home/components/MachineControls.tsx`.
- RAM snapshots are in `src/lib/snapshot/snapshotCreation.ts`, `src/lib/snapshot/snapshotTypes.ts`, and restore is in `src/lib/machine/ramOperations.ts`.
- CPU slider currently lives in `src/pages/HomePage.tsx`; SID pan reference behavior is in `src/pages/home/components/AudioMixer.tsx` and `src/components/ui/slider.tsx`.
- Config category hooks and query behavior are in `src/hooks/useC64Connection.ts`; config browser empty state is in `src/pages/ConfigBrowserPage.tsx`.
- Initial full-config snapshot logic is in `src/hooks/useAppConfigState.ts`.
- Connection lifecycle is in `src/lib/connection/connectionManager.ts`; app reactivation calls reconcilers in `src/App.tsx`.
- REST request implementation and current timeout/retry behavior are in `src/lib/c64api.ts`; scheduling/cooldown/backoff is in `src/lib/deviceInteraction/deviceInteractionManager.ts`.
- Diagnostics UI is `src/components/diagnostics/DiagnosticsDialog.tsx`; action summaries are `src/lib/diagnostics/actionSummaries.ts`; export zip construction is `src/lib/diagnostics/diagnosticsExport.ts`.

## Likely Files To Change

- `src/lib/config/feature-flags.yaml`
- `src/lib/config/featureFlagsRegistry.generated.ts`
- `src/pages/HomePage.tsx`
- `src/pages/home/components/MachineControls.tsx`
- `src/lib/snapshot/snapshotCreation.ts`
- `src/lib/snapshot/snapshotTypes.ts`
- `src/lib/machine/ramOperations.ts`
- `src/hooks/useC64Connection.ts`
- `src/pages/ConfigBrowserPage.tsx`
- `src/hooks/useAppConfigState.ts`
- `src/lib/connection/connectionManager.ts`
- `src/lib/c64api.ts`
- `src/lib/c64api/requestPolicy.ts` (new if useful)
- `src/components/diagnostics/DiagnosticsDialog.tsx`
- `src/lib/diagnostics/actionSummaries.ts`
- `src/lib/diagnostics/diagnosticsExport.ts`
- Focused tests under `tests/unit/**`

## Execution Plan

1. Add feature flag and gate Save RAM / Load RAM.
2. Fix snapshot ranges:
   - Basic Snapshot display and saved ranges to `$002B-$0038, $0801-$9FFF`.
   - Avoid restoring volatile CIA `$DD00-$DDFF` timer state for program/screen restore; preserve needed VIC bank select narrowly.
3. Hide unsupported Power Cycle and remove Quick Actions discovery note.
4. Align CPU Speed slider with SID Pan pattern: local slider state and one commit write, no intermediate device flood.
5. Make config categories/state failures retryable and avoid misleading empty state.
6. Implement health check cadence and request timeout/retry policy with tests.
7. Fix Diagnostics pagination, REST/FTP quick filters, health-check lifecycle noise, and export preview pruning.
8. Run focused tests during implementation, then required validation.
9. Build/deploy latest APK to attached Pixel 4 if possible; document blocker if hardware/adb is unavailable.

## Progress

- [x] Orientation and impact map
- [x] Feature flag and Home quick actions
- [x] Snapshot range/restore fixes
- [x] Power Cycle visibility
- [x] CPU slider responsiveness
- [x] Config failure recovery
- [x] Health cadence and request retry policy
- [x] Diagnostics pagination/filters/export fixes
- [x] Validation and APK deployment

## Implementation Summary

- Added user-visible experimental `ram_snapshots_enabled` feature flag and hid Save RAM / Load RAM when disabled.
- Updated Basic Snapshot to save/display `$002B-$0038, $0801-$9FFF`.
- Narrowed snapshot CIA restore behavior:
  - Program Snapshot excludes `$DD00-$DDFF` by splitting around the CIA page.
  - Screen Snapshot keeps only `$DD00-$DD01` for VIC bank select.
  - Restore overlays preserve live `$DD02-$DDFF` even for older snapshots that include that range.
- Hid Power Cycle unless the connected product is C64U or U64E2 and Telnet reports power-cycle support.
- Removed Power Cycle discovery helper text from Quick Actions.
- Changed CPU Speed drag handling to preview locally and commit one config/device write, matching the responsive SID Pan pattern.
- Preserved known-good config category data across retryable failures and added an explicit retryable config-load error state.
- Removed resume-triggered rediscovery that pessimistically marked the app offline after foregrounding.
- Applied explicit request policy:
  - scheduled/background calls use a 3s timeout and at most 3 attempts total;
  - retries are guarded by elapsed time from first attempt and stop after 6s;
  - user-triggered calls do not inherit scheduled timeout/retry behavior.
- Diagnostics now pages filtered activities with load-more/infinite-scroll support, adds REST/FTP quick filters, suppresses noisy routine in-progress health-check rows, and omits redundant response payload previews for JSON/text exports.

## Validation Summary

- Focused Vitest suite: passed.
- `npx tsc --noEmit`: passed.
- `npm run lint`: passed after targeted formatting and variant regeneration.
- `npm run test:coverage`: passed, global branch coverage 92%.
- `npm run build`: passed with existing Vite/Capacitor warnings.
- `npm run cap:build`: passed; iOS sync warned that CocoaPods/xcodebuild are unavailable locally.
- `npm run android:apk`: passed after Capacitor sync.
- Latest APK `android/app/build/outputs/apk/debug/c64commander-0.7.9-debug.apk` installed and launched on Pixel 4 `9B081FFAZ001WX`.

## Remaining Hardware Validation

- `u64` was reachable at `http://u64/v1/info` and identified as Ultimate 64 Elite; `c64u` timed out.
- The synced APK was installed and launched on the Pixel 4, but WebView automation did not expose enough UI text for full manual feature traversal.
- Cursor blink behavior still needs hands-on device validation: restore Program Snapshot and repeatedly restore Screen Snapshot on the reachable Ultimate 64 Elite and confirm cursor blink cadence does not accelerate.
