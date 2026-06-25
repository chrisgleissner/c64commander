# Fix Report — C64 Commander defects fixed + verified on Pixel 4

Date: 2026-06-25. Device: Pixel 4 `9B081FFAZ001WX`. Targets: c64u (192.168.1.167), u64 (192.168.1.13) fallback.
Build with fixes: versionName `0.8.9-cf84d`, versionCode `2044`, **APK SHA-256 `5c6625f7c42f4c8b73e6be8d13b563ec602be24df7a8e84a346c94eba168aca7`** (prior unfixed build `462bfa15…`).

## Summary

All issues identified in `bug-hunt-report.md` are fixed and verified against the app running on the Pixel 4 talking to c64u (u64 as fallback during a c64u dropout).

| ID | Issue | Fix | Device verification |
|----|-------|-----|---------------------|
| S2 (P1) | Drive A status sticks on "Host unreachable" after a slow/failed mount | Fix A: explicit mount/eject timeout; Fix B: clear stale per-drive error on next successful poll | ✅ self-heals on poll w/o nav |
| C1 | Disconnected drives show false "Status OK" | Gate drive status on connection → "Not available" | ✅ Home + Disks |
| C2 | App slow/stuck OFFLINE after launch-time outage; no easy reconnect | OFFLINE badge tap now triggers `discoverConnection("manual")` | ✅ tap → reconnect ~1s |
| C3 | Mount hangs ~10s, no real timeout; false "Host unreachable" on slow mount | Intentional 8000ms mount timeout (was accidental 1500ms) | ✅ no false timeout; native-cancel limitation documented |

## Code changes (product)

1. **`src/lib/c64api.ts`** — added `MOUNT_REQUEST_TIMEOUT_MS = 8000` and passed it to `mountDrive()` and `unmountDrive()`. Previously these used the default 1500ms INTERACTIVE budget, but real c64u-resident mounts take 0.8–1.8s (measured up to 1774ms), so a slow-but-successful mount was aborted and mislabeled "Host unreachable" (root trigger of S2). *(S2 Fix A + C3.)*

2. **`src/components/disks/HomeDiskManager.tsx`**
   - Added `driveErrorsSetAtRef` + a stamping effect + a guarded clear block in the existing drive poll-reconciliation effect (mirrors the `mountedByDrive`/`drivePowerOverride` timestamp pattern). A transient per-drive operation error now clears on the next successful `/v1/drives` poll instead of sticking until page re-mount. *(S2 Fix B.)*
   - Gated the Disks per-drive "OK" status branch on `status.isConnected` → shows "Not available" (muted) when disconnected. *(C1.)*

3. **`src/pages/home/components/DriveManager.tsx`** — gated the Home drive `statusSummary`/`statusSeverity`/`statusDetails` on `isConnected`: shows "Not available" when disconnected instead of asserting "OK" against stale cached data. *(C1.)*

4. **`src/components/UnifiedHealthBadge.tsx`** — when `connectivity === "Offline"`, a badge tap now also calls `discoverConnection("manual")` (the same proven path as Settings → Save & Connect). Diagnostics still opens, so existing behavior/tests are preserved; this is additive. *(C2.)*

## Static + unit verification

- `npm run typecheck`: PASS.
- Full unit suite `npm run test`: **643 files / 7458 tests PASS** — zero regressions across all four changed files (incl. c64api.branches 94, HomeDiskManager*, DriveManager, UnifiedHealthBadge 32, connectionManager 68, ConnectionController 14).

## On-device verification (Pixel 4)

### S2 Fix A — no false "Host unreachable" on slow mount
Ran mount/eject cycles on the fixed build (Boulder Dash 2.d64). All clean: badge stayed `C64U ●`, `drive-status-a`/`-b` stayed "OK" through every mount (durations 769–1004ms), c64u 403/7-8ms throughout. The old build stuck on cycle 1 (1774ms mount > 1500ms timeout). Mount timeout is now 8000ms.

### S2 Fix B — drive status self-heals (deterministic)
With the app connected, dropped the Pixel WiFi during a mount → the mount failed → `drive-status-a` = "Unable to resolve host \"c64u\"…" while `drive-status-b` = "OK" (the exact A-stuck/B-OK asymmetry of the bug). On WiFi restore, **`drive-status-a` self-cleared to "OK" on the next successful poll — without any navigation** (verified at the first post-recovery poll). On the unfixed build this stayed stuck until a page re-mount.
Evidence: `screenshots/verify-wifidrop-failed.png`, `verify-fixB-recovered.png`.

### C1 — disconnected status shows "Not available"
Launched the app while unreachable (genuine OFFLINE, `connectivity="Offline"`):
- Home: `home-drive-status-a` = **"Not available"** (was false "OK"); row reads "…Status Not available".
- Disks: `drive-status-message-a` and `-b` = **"Not available"**.
Config values (Bus ID, Type) intentionally remain as last-known; only the health *status* is gated.
Evidence: `screenshots/verify-c1-disks-offline.png`.

### C2 — OFFLINE badge → immediate reconnect
Put the app in the OFFLINE/launch-disconnected state (still "OFFLINE ○" with the network already restored). Tapped the OFFLINE badge → connectivity went **Offline → Online within ~1s** (device c64u, fw 1.1.0 repopulated), versus the passive recovery observed at ~10–50s. Diagnostics still opens on the tap (existing behavior preserved).
Evidence: `screenshots/verify-c2-offline-before-tap.png`, `verify-c2-reconnected.png`.

### C3 — mount timeout
The mount budget is now an intentional 8000ms, so a normal slow mount (≤~2s) is never aborted as "Host unreachable" (the false-positive that fed S2). Note: `CapacitorHttp` (native) ignores the JS `AbortSignal`, so an in-flight native request cannot be cancelled before the OS DNS timeout (~10s) on a genuine host-resolution failure — a structural transport limitation, not a per-request defect. The user-visible failure is bounded by the JS timeout and the drive status now self-heals (Fix B).

## c64u stability note
c64u dropped out during testing when the Pixel's WiFi was toggled repeatedly (shared-AP instability — see memory `c64u-flakiness`). A single, deliberate WiFi toggle for the final C2 check did **not** drop c64u (stayed 403). u64 stayed HTTP 200 throughout and is the authorized fallback.

## Final device state
App connected: badge `C64U ●`/`○`, device c64u, fw 1.1.0; Drive A ON / No disk mounted / Status OK; Drive B OFF / No disk mounted; device readback `image_file=''`. c64u 403, u64 200. No settings drift.
