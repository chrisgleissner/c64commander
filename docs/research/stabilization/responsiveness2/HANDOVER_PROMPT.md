# HANDOVER_PROMPT — C64 Commander Stage-2 (continuation)

Written 2026-05-17 by the agent partway through Phase 1. The agent ran out of context. Resume from here.

## How to use this file

1. Read `STABILIZATION_PROMPT.md` end-to-end. That is the binding spec.
2. Read `IMPLEMENTATION_PLANS.md` for the live status table. Update it as you go.
3. Read this file for what is in flight, what already landed, and what to do next.
4. Continue execution — do NOT redo investigation.

## What is in flight (Phase 1)

Phase 1 (F-DIAG-1 + F-DIAG-2 + F-DIAG-3) has been implemented in source but **NOT yet validated** by tests or build. The changes:

- `src/lib/diagnostics/healthModel.ts`:
  - Added `DeviceScope` type + `eventMatchesDeviceScope` helper + `scopeEvents` helper.
  - `deriveRestContributorHealth`, `deriveFtpContributorHealth`, `deriveTelnetContributorHealth`, `deriveAppContributorHealth` now accept optional `scope?: DeviceScope | null`.
  - `derivePrimaryProblem` now accepts optional `scope?: DeviceScope | null`.
  - REST window trim now mirrors FTP/TELNET: sort ascending + `trimToLatestSuccess` (F-DIAG-2).
  - App contributor uses recency-aware rule: severity from errors in last 60 s; 0 recent → Idle, 1–4 recent → Degraded, ≥5 recent → Unhealthy (F-DIAG-3).
  - Constants: `RECENT_APP_ERROR_WINDOW_MS = 60_000`, `APP_ERROR_UNHEALTHY_RECENT_THRESHOLD = 5`.

- `src/hooks/useHealthState.ts`:
  - Imports `DeviceScope`.
  - Passes `{ deviceId: selectedSavedDevice?.id ?? null, host }` to all contributor + primaryProblem calls (defence in depth on top of the existing host-scoped event prefilter).
  - Fixed broken `resolveTraceAttributedHost` which previously looked for non-existent `device.host`; now uses `savedDeviceHostSnapshot` / `verifiedHostname`.

- `src/hooks/useSavedDeviceHealthChecks.ts`:
  - Replaced `AUTO_REFRESH_MS = 10_000` with `AUTO_REFRESH_MS_FOREGROUND = 10_000` (picker open) and `AUTO_REFRESH_MS_BACKGROUND = 60_000` (picker closed).
  - The `setInterval` now picks an interval based on `context === HEALTH_CHECK_CONTEXTS.backgroundMaintenance`.

- `tests/unit/lib/diagnostics/healthModel.test.ts`:
  - Updated existing test "ignores pre-connection REST failures once a later REST response succeeds" to expect `totalOperations: 1` (was 2) because of the new trim semantic.
  - Updated `deriveAppContributorHealth` tests: renamed to "Degraded for 1–4 RECENT" and added new test "returns Idle when the only error is outside the recent 60 s window".
  - Updated the Unhealthy test to use offsets within the 60 s recent window (was using `(i+1)*10_000` which would not be considered recent enough under the new rule).
  - Added a new `describe("device-scoped contributor health (F-DIAG-1)")` block covering REST/FTP/Telnet/error cross-device contamination prevention.
  - Added new tests "recovers to Healthy after a transient failure when the latest event is a success" and "returns Unhealthy when consecutive failures occur after the latest success".

## NEXT IMMEDIATE STEPS

1. **Run unit tests** for the diagnostics health model:
   ```bash
   npx vitest run tests/unit/lib/diagnostics/healthModel.test.ts
   ```
   If failures appear, fix them — the most likely victims are:
   - Other tests in `tests/unit/lib/diagnostics/` that consume `deriveRestContributorHealth` and expect the old `firstSuccessIndex` trim semantic (search for usages).
   - Snapshot or component tests in `tests/unit/hooks/useHealthState*.test.*` that observe contributor counts.
   - Tests that exercise the App contributor at boundaries 1-error / 5-errors with offsets exceeding 60 s.

2. **Run the lint** (do not change source to silence it; fix root cause):
   ```bash
   npm run lint
   ```

3. **Mark Phase 1 tasks as complete** in the TaskList only after tests are green:
   - Task #2 F-DIAG-1, #3 F-DIAG-2, #4 F-DIAG-3.

4. **Update `IMPLEMENTATION_PLANS.md`** Phase 1 statuses to DONE with evidence file references.

5. **Pixel 4 60 s soak gate (Phase 1 hardware gate)** — build APK, install, soak:
   ```bash
   npm run cap:build && npm run android:apk
   adb -s 9B081FFAZ001WX install -r android/app/build/outputs/apk/debug/c64commander-*-debug.apk
   adb -s 9B081FFAZ001WX shell am force-stop uk.gleissner.c64commander
   adb -s 9B081FFAZ001WX shell am start -W -n uk.gleissner.c64commander/.MainActivity
   sleep 60
   adb -s 9B081FFAZ001WX shell screencap /sdcard/x.png
   adb -s 9B081FFAZ001WX pull /sdcard/x.png docs/research/stabilization/responsiveness2/evidence/phase1-F-DIAG-1-u64-home-60s.png
   adb -s 9B081FFAZ001WX logcat -d -t 5000 > docs/research/stabilization/responsiveness2/evidence/phase1-F-DIAG-1-u64-logcat.txt
   ```
   Pixel 4 adb serial: `9B081FFAZ001WX`.

## REMAINING PHASES (untouched as of handover)

Each is fully spec'd in `STABILIZATION_PROMPT.md`. Below is the executive shortlist with hints.

### Phase 2 — Connection state truthfulness (F-CONN-1, F-CONN-2, F-CONN-3)
- **F-CONN-1**: Add `noteReachable(host, source)` in `src/lib/connection/connectionManager.ts`. Promote `OFFLINE_NO_DEMO`/`DISCOVERING` → `REAL_CONNECTED` when the active host responds 2xx. Wire it from REST success path in `src/lib/c64api/requestRuntime.ts` (or `src/lib/c64api.ts`). Existing `/v1/info` probe stays the authoritative `DeviceInfo` source.
- **F-CONN-2**: Inspect `src/pages/HomePage.tsx` for the Device/Firmware meta row; ensure it consumes `connectionManager.getSnapshot().deviceInfo` or the React Query `c64-info` cache. On `REAL_CONNECTED` transition, fire `queryClient.invalidateQueries({ queryKey: ["c64-info"] })`.
- **F-CONN-3**: `src/components/diagnostics/DiagnosticsDialog.tsx` header — fall back to live `connectionManager.getSnapshot().deviceInfo.product` (or the `c64-info` query cache) when the per-device saved snapshot lacks `product`.

### Phase 3 — Transport overhead + log noise (F-HTTP-1, F-HTTP-2, F-LOG-1, F-LOG-2)
- **F-HTTP-1**: Check `npm run cap:build` actually writes `"CapacitorCookies": { "enabled": false }` into `android/app/src/main/assets/capacitor.config.json`. If the disable is not honored, remove `@capacitor/cookies` from the Android plugin registration (grep `CapacitorCookies` usage in `src/` first — should be unused). Add a Vitest that parses the generated `capacitor.config.json` and asserts the field.
- **F-HTTP-2**: Audit `src/components/.../LightingSummaryCard.tsx`, `src/pages/HomePage.tsx` for per-item LED Strip Settings reads; use `getConfigItems(category, items)` in `src/lib/c64api.ts` to batch. Defer Keyboard Lighting until the relevant section opens.
- **F-LOG-1**: Add `no-console` ESLint rule (allow warn/error) on `src/lib/telnet/**` and `src/lib/diagnostics/**`. Install production `console.log` no-op in `src/main.tsx`. Find the `Msg: undefined` source — likely `console.info(undefined, ...)` in `src/lib/telnet/telnetClient.ts` or `src/lib/telnet/telnetSession*.ts`; build with sourcemaps and grep bundled line 353.
- **F-LOG-2**: Cold-boot `Uncaught TypeError ... triggerEvent`. Suspects: `src/lib/diagnostics/logger.ts`, `src/lib/native/*Plugin.ts`, `src/lib/diagnostics/diagnosticsOverlay.ts`. Defer behind `Capacitor.isReady` or wrap in `Promise.resolve().then(...)`.

### Phase 4 — Interaction-aware scheduling + MimeMap (F-RT-1, F-MIME-1)
- **F-RT-1**: In `src/hooks/useSavedDeviceHealthChecks.ts`, before `void runCycle(false)` in the interval callback, check `pollingPauseRegistry.isPaused()` (add the getter to `src/lib/...pollingPauseRegistry.ts` if needed). Skip the tick if paused.
- **F-MIME-1**: Add `Thread { MimeMap.getDefault().guessMimeTypeFromExtension("html") }.start()` in `MainActivity.onCreate` (`android/app/src/main/java/uk/gleissner/c64commander/MainActivity.kt` — confirm path).

### Phase 5 — Hypothesis verification
H-VOL-1, H-VOL-2, H-PLAY-1, H-RT-2 — see `STABILIZATION_PROMPT.md`. Each requires real-device reproduction before deciding to fix.

### Phase 6 — Full validation sweep
- `npm run lint && npm run test && npm run test:coverage` (≥ 91 % branch)
- `npm run build && npm run cap:build && npm run android:apk`
- Install on Pixel 4 + walk u64 and c64u validation matrix per phase.

## KEY FILES TOUCHED (so far)

```
src/lib/diagnostics/healthModel.ts          (M)
src/hooks/useHealthState.ts                 (M)
src/hooks/useSavedDeviceHealthChecks.ts     (M)
tests/unit/lib/diagnostics/healthModel.test.ts (M)
docs/research/stabilization/responsiveness2/IMPLEMENTATION_PLANS.md (M)
docs/research/stabilization/responsiveness2/HANDOVER_PROMPT.md (NEW — this file)
```

No commits yet. Branch is `feat/reduce-latency-and-fix-errors`. Working tree includes the untracked `docs/research/stabilization/responsiveness2/` tree and the in-progress source edits above.

## CRITICAL POLICY REMINDERS

- **Do not** silence/suppress diagnostics to make badges look healthy. Fix the data flow.
- **Do not** delete tests to make changes pass. Update tests honestly to match new semantics.
- **Do not** use `--no-verify` or skip coverage gates without explicit user approval.
- **Pixel 4 deploy + on-device validation is mandatory** before declaring any change complete (per `CLAUDE.md` Phase 5a). Serial is `9B081FFAZ001WX`.
- **Both u64 and c64u** must be exercised for findings that touch per-device flows. Active device preference order: u64 → c64u.
- Coverage gate `≥ 91 %` branch is a release blocker.
- Update `IMPLEMENTATION_PLANS.md` continuously, not in one batch at the end.

## KNOWN RISKS / GOTCHAS DISCOVERED THIS SESSION

- `filterTraceEventsForConfiguredHost` in `useHealthState.ts` previously had a broken attribution fallback (looked for `device.host` field that doesn't exist on `DiagnosticsDeviceContext`). Now fixed to use `savedDeviceHostSnapshot` / `verifiedHostname`. This may slightly tighten host scoping for events without transport hostname — watch existing tests.
- The trace context's `device` field is GLOBAL. Saved-device probes inherit the active device's attribution because the global context is not updated per-probe. The new `eventMatchesDeviceScope` mitigates this by preferring transport hostname when present (authoritative) and only falling back to device attribution otherwise.
- App contributor previously went Degraded on 1 error over 5 min; now Degraded only on 1+ errors within the last 60 s. This may relax some existing assertions — search `deriveAppContributorHealth` usages in tests.
- REST contributor trim is now symmetric with FTP/TELNET. Some existing tests that depended on `firstSuccessIndex` trim need updates (one was already updated in this session: `ignores pre-connection REST failures...` now expects `totalOperations: 1`).

## EVIDENCE DIRECTORY CONVENTION

`/home/chris/dev/c64/c64commander/docs/research/stabilization/responsiveness2/evidence/phase<N>-<finding-id>-<host>-<artifact>.<ext>`

Examples:
- `phase1-F-DIAG-1-u64-diagnostics.png`
- `phase3-F-LOG-1-u64-logcat-30s.txt`

## TERMINATION CRITERIA (from spec)

Stop only when all findings DONE/BLOCKED, all build+test+coverage gates green, Pixel 4 has the new APK with `am start -W` `Status: ok`, cold-boot logcat smokes pass for Phase 3 + 4, both u64 + c64u validated per-finding, and `IMPLEMENTATION_PLANS.md` lists per-finding status + evidence + validation.
