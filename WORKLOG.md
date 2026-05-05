# Worklog

## 2026-05-05

- Read `README.md`, `.github/copilot-instructions.md`, `docs/ux-guidelines.md`, `package.json`, and relevant Home/config/connection/diagnostics source.
- Classified the task as `DOC_PLUS_CODE` and `UI_CHANGE`.
- Established initial impact map in `PLANS.md`.
- Validation plan: focused Vitest specs during implementation, then `npm run lint`, `npm run test:coverage`, `npm run build`; Android APK deploy/install/launch to Pixel 4 if attached.

## Evidence Notes

- CPU Speed currently has `onValueChangeAsync` that writes every preview change and `onValueCommitAsync` that writes again; SID Pan uses local state plus interactive write pattern with config override on commit.
- Screen Snapshot currently saves `$DD00-$DD0F`; Program Snapshot currently saves `$0200-$FFFF`, which includes all CIA registers. This can restore CIA timer state.
- Diagnostics currently slices filtered activity to 20 rows without a load-more/infinite-scroll path.
- Diagnostics action summaries currently include `responsePayloadPreview` whenever a trace has a preview, even for JSON/text responses with decoded bodies.

## Changes Made

- Home quick actions:
  - Added `ram_snapshots_enabled` as a visible experimental feature flag.
  - Hid Save RAM and Load RAM when that flag is disabled.
  - Hid Power Cycle unless product detection resolves to C64U or U64E2 and Telnet reports support.
  - Removed Power Cycle discovery helper text from Quick Actions.
- Snapshots:
  - Basic Snapshot now saves `$002B-$0038, $0801-$9FFF`.
  - Program Snapshot no longer saves/restores `$DD00-$DDFF`.
  - Screen Snapshot no longer saves/restores `$DD02-$DDFF`; it keeps only `$DD00-$DD01`.
  - Restore overlays now preserve live `$DD02-$DDFF` for legacy snapshots that still contain that volatile CIA2 range.
- CPU Speed slider:
  - Difference found: CPU Speed wrote to the device on every preview drag event and again on commit; SID Pan used local preview state and committed the device write through the shared interactive path.
  - CPU Speed now previews locally and sends a single committed config write, with rollback on failure.
- Config and health:
  - Known-good config category data is preserved across retryable query failures.
  - Config Browser distinguishes retryable load failure from a genuine loaded-empty response and provides a retry button.
  - Reactivation no longer triggers resume rediscovery or an immediate offline transition.
  - Scheduled/background requests have explicit 3s timeout, max 3 attempts, and 6s elapsed retry guard.
  - User-triggered REST calls have no automatic retry and do not inherit the scheduled 3s timeout.
  - Rapid user-triggered REST interactions were protected by keeping scheduled retry policy explicit to background calls only; successful organic device interactions still refresh device-state evidence through the existing device interaction manager.
- Diagnostics:
  - Activity list supports paged loading from the filtered result set and resets pagination on filter changes.
  - Added REST and FTP quick filters.
  - Suppressed routine system in-progress health-check rows from the primary activity list.
  - Export/action serialization omits `responsePayloadPreview` for JSON/text decoded responses and preserves it for binary payloads.

## Tests Added Or Updated

- `tests/unit/pages/home/components/MachineControls.test.tsx`
- `tests/unit/pages/HomePage.test.tsx`
- `tests/unit/pages/HomePage.ramActions.test.tsx`
- `tests/unit/featureFlags.test.ts`
- `tests/unit/lib/snapshot/snapshotCreation.test.ts`
- `tests/unit/machine/ramOperations.test.ts`
- `tests/unit/c64api.test.ts`
- `tests/unit/c64api.branches.test.ts`
- `tests/unit/components/ConnectionController.test.tsx`
- `tests/unit/hooks/useC64Connection.test.ts`
- `tests/unit/pages/ConfigBrowserPage.test.tsx`
- `tests/unit/components/diagnostics/DiagnosticsDialog.test.tsx`
- `tests/unit/lib/diagnostics/actionSummaries.test.ts`
- `tests/unit/lib/diagnostics/diagnosticsExport.test.ts`

## Validation Run

- Focused Vitest command covering Home, snapshots, request policy, config recovery, lifecycle, Diagnostics, and export behavior: passed, 13 files and 272 tests.
- `npx tsc --noEmit`: passed.
- `npm run lint`: passed after targeted Prettier formatting of changed/generated files and `npm run variant:generate`.
- `npm run test:coverage`: passed with global branch coverage 92%.
- `npm run build`: passed. Vite reported existing chunk/externalization warnings.
- `npm run cap:build`: passed. iOS sync warned CocoaPods and xcodebuild are unavailable locally.
- `npm run android:apk`: passed after Capacitor sync.

## Device Evidence

- Hardware probe:
  - `http://u64/v1/info` responded with product `Ultimate 64 Elite`.
  - `http://c64u/v1/info` timed out.
  - Validation target selected: `u64`.
- Pixel 4:
  - Attached adb device: `9B081FFAZ001WX`, model Pixel 4.
  - Installed latest synced APK: `android/app/build/outputs/apk/debug/c64commander-0.7.9-debug.apk`.
  - Install result: `Success`.
  - Launch command started `uk.gleissner.c64commander/.MainActivity`.
  - `dumpsys window` confirmed current focus and focused app are C64 Commander.

## Remaining Uncertainties

- Direct cursor blink validation requires hands-on interaction with the Ultimate 64 Elite after restoring Program Snapshot and repeatedly restoring Screen Snapshot. Deterministic tests cover the range/restore logic that prevents `$DD02-$DDFF` from being reapplied.
- WebView UI text was not exposed through `uiautomator`, so the Pixel 4 validation confirms install/launch of the latest APK rather than full on-device traversal of every changed UI path.
- Screenshots under `docs/img/` were not refreshed because no documented screenshot corpus state was intentionally changed.
