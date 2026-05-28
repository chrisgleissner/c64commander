# Prod-hardening-5

- Lands the PH5 concurrent worktree edits after the mandated targeted regression run stayed green.
- Hardens Play and Disk imports against late post-switch mutations by aborting on `saved-device-switch` and guarding shared disk-library writes with the expected selected-device id.
- Adds deterministic regression coverage for:
  - Play import stale-result isolation
  - Disk-library stale-result isolation
  - saved-device-switch event publication
  - PlayFilesPage `backgroundAutoSkipDue` listener add/remove counts and exactly-once auto-advance behavior
  - IndexedDB warning routing through `addLog("warn", ...)`
- Replaces the five raw IndexedDB `console.warn(...)` calls with structured warn logging.

## Validation

- `npm run test`
- `npm run lint`
- `npm run build`
- `npm run cap:build`
- `npm run android:apk`
- `npm run test:coverage`
  - Branch coverage: `91.67%`
- Local executable changed-line coverage: `14/14 = 100.00%`

## Hardware evidence

- Pixel 4 `9B081FFAZ001WX`: debug APK installed and launched successfully.
- `u64` reachable and healthy.
- `c64u` offline (`curl: (56) Recv failure: Connection reset by peer`).
- Verified on device that the Settings page still opens and the long-press **Switch Device** dialog progresses from `0/6 probes` to `u64 ONLINE / HEALTHY` and `c64u OFFLINE`.

## Known blocker

- Cross-device playback proof and the full Android mid-import switch scenario remain blocked by `c64u` being offline during this pass.
