# Prod-Hardening-5 Implementation Results

## Scope

CODE_CHANGE implementation pass for the four PH5 tasks selected in the analysis package:

1. PH5-01 concurrent-worktree landing
2. PH5-04 import cancellation on saved-device switch
3. PH5-05 deterministic PlayFilesPage listener-once proof
4. PH5-06 IndexedDB warning routing through structured logging

## Implemented changes

### PH5-01 — concurrent worktree landing

- Re-inspected the three concurrent worktree files called out by the prompt.
- Ran the mandated targeted regression command.
- Result: green, so the edits were kept in the PH5 boundary unchanged.

### PH5-04 — saved-device-switch import hardening

- `addFileSelections.ts`
  - Captures the selected saved-device id at import start.
  - Aborts active Play imports on the existing `c64u-connection-change` event when the reason is `saved-device-switch`.
  - Re-checks abort state before late playlist mutation and songlength application.
- `HomeDiskManager.tsx`
  - Mirrors the same saved-device-switch abort wiring for Disk imports.
  - Prevents late disk-library mutation after a saved-device switch.
- `useDiskLibrary.ts`
  - Adds an `expectedSelectedDeviceId` guard to `addDisks(...)` so the shared disk library cannot be mutated by stale post-switch results.
- Clean cancellation behavior is preserved:
  - classified as `"Add cancelled"`
  - no duplicate error toast
  - no unclassified failure log on switch-driven cancellation

### PH5-05 — deterministic once-only listener proof

- Added a focused PlayFilesPage regression that pins:
  - one `backgroundAutoSkipDue` listener registration per mount
  - removal only on unmount
  - exactly-once auto-advance through the stable-ref control flow

### PH5-06 — quiet IndexedDB warning channel

- Replaced the five raw `console.warn(...)` calls in `indexedDbRepository.ts` with `addLog("warn", ...)`.
- Preserved each message text and details payload.
- Added regression coverage that proves zero raw `console.warn` emissions and one structured warn log per failure path.

## Tests and validation

### Targeted regressions

- `npm run test -- tests/unit/playFiles/usePlaybackController.concurrency.test.tsx tests/unit/lib/deviceInteraction/deviceInteractionManager.test.ts tests/unit/lib/ftp/ftpClient.test.ts`
  - **pass**
- `npm run test -- tests/unit/playFiles/addFileSelections.deviceSwitch.test.ts tests/unit/hooks/useDiskLibrary.deviceSwitch.test.ts tests/unit/hooks/useSavedDeviceSwitching.cancelsImport.test.tsx tests/unit/pages/playFiles/PlayFilesPage.backgroundAutoSkipListener.test.tsx tests/unit/lib/playlistRepository/indexedDbRepository.test.ts`
  - **pass**
- `npm run test -- tests/unit/components/disks/HomeDiskManager.branches.test.tsx tests/unit/components/disks/HomeDiskManager.extended.test.tsx`
  - **pass**

### Full validation

- `npm run test`
  - **pass** (`578` files, `6674` tests)
- `npm run lint`
  - **pass**
- `npm run build`
  - **pass**
- `npm run cap:build`
  - **pass**
- `npm run android:apk`
  - **pass**
- `npm run test:coverage`
  - **pass**
  - Statements: `94.62%`
  - Branches: `91.67%`
  - Functions: `91.00%`
  - Lines: `94.62%`
- Local executable changed-line coverage check against `coverage/lcov.info`
  - **pass** (`14/14 = 100.00%`)

## Hardware / mobile validation

### Live target probes

- `u64`: reachable
  - product `Ultimate 64 Elite`
  - firmware `3.14e`
  - hostname `u64`
  - unique id `38C1BA`
- `c64u`: unreachable
  - `curl: (56) Recv failure: Connection reset by peer`

### Pixel 4 deployment

- Device: `9B081FFAZ001WX`
- Installed APK:
  - `android/app/build/outputs/apk/debug/c64commander-0.7.9-rc1-debug.apk`
- Install result: **Success**
- Launch result: **Success**

### On-device observations

- Home screen loaded with `u64` selected and healthy.
- Settings page loaded successfully.
- Long-press on the header status badge opened the **Switch Device** dialog.
- The open dialog progressed from the initial `0/6 probes` state to:
  - `u64` → `ONLINE / HEALTHY`
  - `c64u` → `OFFLINE`

This provides direct device evidence that the saved-device picker still updates while open and remains truthful under the existing 10-second health-cycle contract.

## Blockers

- `c64u` was offline throughout the pass, so cross-device playback proof and a real switch onto `c64u` could not be completed.
- The full Android mid-import switch scenario for PH5-04 was not replayed end-to-end on the Pixel because the secondary target stayed offline and the file-picker/import flow is not controllable through the available WebView-only automation surface in this run.

## Remaining risks

- The PH5-04 Android end-to-end scenario should still be re-run against live hardware once `c64u` is reachable again, even though the deterministic JS tests already prove the stale-result isolation contract.
- No screenshot regeneration was required because no documented visible UI changed.
