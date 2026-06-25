# S2-DISKS-DRIVE-A-STATUS-STUCK-HOST-UNREACHABLE — Drive A status sticks on "Host unreachable" after a failed/slow mount and does not self-recover

- ID: S2-DISKS-DRIVE-A-STATUS-STUCK-HOST-UNREACHABLE
- Title: Drive A status indicator sticks on "Host unreachable" after a slow/failed mount request and does not recover on subsequent successful polls
- Severity: S2 (major)
- Priority: P1
- Product area: Disks / Drive A status display; per-drive status query error handling
- Route: Disks (`/disks`); also reflected on Home drive rows
- Overlay/dialog: Drive A `Mount disk` sheet (`mount-disk-sheet`)
- CTA fingerprint: `drive-mount-toggle-a` ("Drive A Mount disk" / "Drive A Eject disk"); status field `drive-status-a`
- Control label: Drive A Mount disk → status "Host unreachable"
- Input method: Touch via DroidMind (`mcp__droidmind__android-ui` tap)
- Build identity: `0.8.9-cf84d`, APK SHA-256 `462bfa1578c219d1f753311695688863c68bdda27480a449823ce60b36d49a07` (built from working tree incl. uncommitted `src/lib/c64api.ts` Connection: close change)
- Git SHA: `cf84d8e565cbc1511bfe9758887af7c9ae07fba8`
- Pixel 4 identity: `9B081FFAZ001WX` (Pixel 4, Android 16, SDK 36)
- Target identity: `c64u` (192.168.1.167), HTTP 80, FTP 21, Telnet 23, fw 1.1.0
- First reproduced UTC: 2026-06-25T13:18:37Z (mount cycle 1)
- Last reproduced UTC: 2026-06-25T13:25:05Z (mount cycle 5)
- Reproduction count: 2 of 5 Drive A mount cycles (cycles 1 and 5)
- Reproduction rate: ~2/5 mounts; intermittent (race-conditioned on a transient request failure during/around the mount)
- Preconditions: App connected to `c64u` (green badge, fw 1.1.0); Drive A ON, `No disk mounted`; test disk `/USB2/test-data/d64/Boulder Dash 2.d64` present.

## Exact actions
1. Disks → tap `drive-mount-toggle-a` ("Drive A Mount disk") @ device (928,361) → mount sheet opens.
2. Tap "Mount Boulder Dash 2.d64" @ device (912,852).
3. Observe Drive A status (`drive-status-a`) and Drive B status (`drive-status-b`).

## Expected result
After a mount, Drive A status reflects the true device state. If a transient request fails during the mount, the status must recover on the next successful periodic poll (the app polls `/v1/drives` ~every 60s) — as the overall connection badge and the mounted-disk label both do.

## Actual result
On cycles 1 and 5, `drive-status-a` became "Host unreachable" and **stayed stuck** even after the overall connection fully recovered. Decisive evidence that this is an app-side per-drive state bug, not a real outage:
- On the same page, same poll cycle: **`drive-status-a` = "Host unreachable" while `drive-status-b` = "OK"**. A real host outage would affect both drives.
- Overall badge recovered to green "C64U ●"; the Drive A mounted-disk label updated correctly (cycle 1 showed "Boulder Dash 2.d64") — proving live polls were succeeding while the status field stayed stuck.
- Direct device readback (`GET /v1/drives`, `x-password: pwd`) returned `errors: []` and the correct Drive A image_file.
- Direct `GET /v1/info` returned HTTP 403 in 7–8 ms throughout (device healthy).
- The stuck status only cleared after navigating away and back (Home → Disks force-remounts the page); it did **not** clear on the periodic poll.

Two distinct triggers produced the same stuck state:
- Cycle 1: mount **succeeded** on the device (1774 ms PUT) but a concurrent Drive A status request failed transiently → status stuck.
- Cycle 5: mount **failed** — `PUT /v1/drives/a:mount` hung **10,032 ms** then threw `UnknownHostException: Unable to resolve host "c64u": No address associated with hostname` (a single transient Pixel 4 DNS blip; only 1 occurrence all session). Device readback confirmed Drive A did not mount → status stuck "Host unreachable".

In both cases the residual app defect is identical: **the per-Drive-A status error does not clear on subsequent successful polls.**

## User impact
After a normal disk mount, the user can be shown a persistent, alarming "Host unreachable" on a drive that is actually mounted (or simply fine) and reachable, with no auto-recovery short of leaving and re-entering the page. Misleading; erodes trust in the status display.

## State before / after
- Before: Drive A ON, No disk mounted, status OK; badge C64U ●; c64u 403/8 ms.
- After (defect): Drive A status "Host unreachable" (stuck); badge "C64U ▲ 1"; Drive B status "OK"; device healthy.
- After recovery (nav Home→Disks): Drive A status "OK".

## Recovery performed
Navigated Home→Disks to clear the stuck status; verified clean Drive A (No disk mounted, status OK) and green badge.

## Cleanup status
Drive A left `No disk mounted`, status OK, badge green. Device readback `image_file=''`. Clean.

## Suspected component
Disks per-drive status query (`/v1/drives` or per-drive `/v1/configs/Drive A ...`) error-state handling: a failed query result is written to the Drive A status cell but is not reset/overwritten when later queries succeed (likely a stale cached error in the drive-status query state, or the per-drive status query is keyed/cached separately from the `/v1/drives` query that updates the mounted label).

## Evidence supporting suspected component
- Drive B status updates to OK while Drive A status stays stuck on the same page/poll.
- Mounted-disk label and connection badge recover while the status cell does not.
- Page re-mount (fresh query) clears it.

## Remaining uncertainty
- The triggering failures are partly environmental (Pixel 4 ↔ c64u WiFi/DNS flakiness: WiFi scan churn in logcat; one `UnknownHostException`). The app *bug* is the non-recovery of the status cell, independent of the trigger.
- Whether the same stickiness affects Drive B / Soft IEC under their own slow ops was not exhaustively tested.

## Replay
Connect to c64u; on Disks, repeatedly mount/eject `Boulder Dash 2.d64` to Drive A. Reproduces intermittently when a request fails during the slow (~1–10 s) mount. Compare `drive-status-a` vs `drive-status-b`; navigate away/back to confirm recovery.

## Linked evidence (artifact root: c64scope/artifacts/bughunt-20260625T125855Z-pixel4-c64u-cf84d8e565cb/)
- screenshots/s1-c1-before-mount.png, s1-c1-mount-sheet.png, s1-c1-after-mount.png, s1-c1-stuck-status.png, s1-c1-after-nav-refresh.png, s1-c1-before-eject.png, s1-c1-after-eject.png
- screenshots/s1-c5-after-mount.png, s1-c5-repro-stuck.png
- hierarchies/ same case names .xml
- logs/logcat/s1-c1-*.log, s1-c5-*.log; logs/logcat/session-continuous.log
- logs/c64scope/cdp-console-network.jsonl (CapacitorHttp request timings + UnknownHostException)
- Relevant log excerpts:
  - Cycle1 mount: `PUT http://c64u/v1/drives/a:mount?image=...Boulder Dash 2.d64&type=d64&mode=readonly` 1774.9 ms (success; device image_file set)
  - Cycle5 mount: same URL 10032.4 ms then `Sending plugin error: ... "Unable to resolve host \"c64u\": No address associated with hostname","code":"UnknownHostException"` (device image_file='')
  - Eject durations (all clean, no stuck status): 198.8 / 150.4 / 205.3 / 259.9 ms

## Related
- [[S1-DISKS-MOUNT-EJECT-RESETS-C64U]] — original catastrophic connection-reset. NOT reproduced in this session's 5 rapid cycles (c64u stayed 403/7-8 ms throughout); `Connection: close` fix appears effective for the catastrophic aspect. This S2 is the residual, milder display bug.

## STATUS: FIXED + VERIFIED ON DEVICE (2026-06-25)

Fixed build APK SHA-256 `5c6625f7c42f4c8b73e6be8d13b563ec602be24df7a8e84a346c94eba168aca7` (installed on Pixel 4). Two complementary fixes:

- **Fix A (root trigger) — `src/lib/c64api.ts`:** `mountDrive`/`unmountDrive` now use an explicit `MOUNT_REQUEST_TIMEOUT_MS = 8000` instead of the default 1500 ms interactive budget. A real mount takes 0.8–1.8 s, so the old budget aborted a slow-but-successful mount and mislabeled it "Host unreachable" — that false error was the most common trigger of this bug.
- **Fix B (non-recovery) — `src/components/disks/HomeDiskManager.tsx`:** a timestamped `driveErrorsSetAtRef` + a clear block in the drive poll-reconciliation effect now drop a stale per-drive error once a later successful `/v1/drives` poll supersedes it (mirrors the existing `mountedByDrive`/`drivePowerOverride` pattern). The error no longer persists until page re-mount.

**Verification:**
- `npm run typecheck` PASS; full unit suite **643 files / 7458 tests PASS**; `npm run lint` PASS.
- On device: mount/eject cycles on the fixed build never produced a stuck "Host unreachable" (vs 2/5 on the unfixed build). Deterministic recovery test — dropped Pixel WiFi during a mount so `drive-status-a` showed the failure message while `drive-status-b` stayed "OK" (exact bug asymmetry); on WiFi restore, **`drive-status-a` self-cleared to "OK" on the next poll without navigation** (verified at the first post-recovery poll). Evidence: `c64scope/artifacts/bughunt-20260625T125855Z-pixel4-c64u-cf84d8e565cb/screenshots/verify-wifidrop-failed.png`, `verify-fixB-recovered.png`. See `fix-report.md`.
