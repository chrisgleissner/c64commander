# HANDOVER_PROMPT — C64 Commander Stage-2 Stabilization

Written 2026-05-17 23:27 BST. Resume from this file if context is compacted or the agent is restarted.

## Operating principle

The user explicitly wants latency and UI stability work to keep moving. Do not spend time on broad or ceremonial verification while iterating. Use targeted tests for each code change, one lint/build gate when needed, and defer full coverage or broad validation until a phase is ready to close or the repo policy makes it unavoidable.

Do not mark code complete without the required gates, but avoid repeatedly running long gates after every small local observation. If a long gate is already running, let it finish; otherwise prefer the narrowest useful command.

## Binding context

1. Read `STABILIZATION_PROMPT.md` for the full spec.
2. Read `IMPLEMENTATION_PLANS.md` for the live status table and update it as you go.
3. Do not redo completed investigation. Continue from the state below.
4. Keep evidence under `docs/research/stabilization/responsiveness2/evidence/`.

## Current classification

`DOC_PLUS_CODE`. The current work affects app behavior and docs/evidence. It is not a visible UI design/layout change, so do not regenerate screenshot docs unless the spec evidence requires a device screenshot.

## Hardware state

- Pixel 4 serial: `9B081FFAZ001WX`.
- Primary hardware target: `u64`.
- `u64` probe succeeds: `curl --max-time 5 -sS http://u64/v1/info` returns product `Ultimate 64 Elite`, firmware `3.14e`, hostname `u64`.
- `c64u` recovered on 2026-05-18: `curl --max-time 5 -sS http://c64u/v1/info` returns product `C64 Ultimate`, firmware `1.1.0`, hostname `c64u`. All stabilization validation phases now have captured evidence on both `u64` and `c64u`.
- Before screenshots, wake/unlock the Pixel. A failed Phase 2 capture was black because the device was dozing and `NotificationShade` was focused, not because the app failed.

Wake command used successfully:

```bash
adb -s 9B081FFAZ001WX shell input keyevent KEYCODE_WAKEUP
sleep 1
adb -s 9B081FFAZ001WX shell wm dismiss-keyguard
adb -s 9B081FFAZ001WX shell input keyevent KEYCODE_MENU
adb -s 9B081FFAZ001WX shell input swipe 500 1600 500 300 300
```

## Phase 1 status

Phase 1 is implemented and validated.

What landed:

- Device-scoped diagnostics contributor filtering in `src/lib/diagnostics/healthModel.ts`.
- `useHealthState` passes selected saved-device scope and fixed host attribution fallback.
- Saved-device background health interval is 60 s while switch picker is closed.
- REST health window trim now matches FTP/TELNET.
- App contributor errors are recency-scoped to the last 60 s.
- `useTelnetActions` capability discovery is scheduled through `withTelnetInteraction` to avoid racing the native Telnet health probe.

Evidence already captured:

- Targeted Vitest set passed 148 tests.
- `npm run lint` passed with only existing `c64scope/coverage` warnings.
- `npm run test:coverage` passed earlier: 965 tests, 91.78% branch.
- Pixel 4 `u64` 60 s soak passed after the Telnet scheduler fix:
  - `evidence/phase1-F-DIAG-1-u64-home-60s-after-telnet-scheduler.png`
  - `evidence/phase1-F-DIAG-1-u64-logcat-after-telnet-scheduler.txt`

## Phase 2 status

Phase 2 code is implemented but final Pixel evidence needs to be redone after the latest Home metadata fallback fix.

Files touched for Phase 2:

```text
src/lib/connection/connectionManager.ts
src/lib/c64api.ts
src/hooks/useC64Connection.ts
src/components/diagnostics/GlobalDiagnosticsOverlay.tsx
src/components/diagnostics/DiagnosticsDialog.tsx
tests/unit/connection/connectionManager.test.ts
tests/unit/hooks/useC64Connection.test.ts
tests/unit/components/diagnostics/DiagnosticsDialog.test.tsx
tests/unit/components/diagnostics/GlobalDiagnosticsOverlay.routeClose.test.tsx
docs/research/stabilization/responsiveness2/IMPLEMENTATION_PLANS.md
```

Implemented behavior:

- `ConnectionSnapshot` carries `deviceInfo: DeviceInfo | null`.
- `connectionManager.noteReachable(host, source, deviceInfo?)` promotes active-host `OFFLINE_NO_DEMO`/`DISCOVERING` to `REAL_CONNECTED` after successful REST reachability.
- `/v1/info` success stores live `DeviceInfo` in the connection snapshot.
- Successful REST responses in `src/lib/c64api.ts` call `noteReachable`.
- `useC64Connection` invalidates `c64-info` when connection state transitions into `REAL_CONNECTED`.
- `GlobalDiagnosticsOverlay` maps connection snapshot `deviceInfo` to diagnostics fallback info.
- `DiagnosticsDialog` falls back to live `deviceInfo.product` when saved-device product is empty.
- Latest fix: `useC64Connection` now exposes `connection.deviceInfo` as a fallback when the `c64-info` query has no displayable identity yet, and uses `refetchOnMount: "always"` for the info query. This was needed because the Pixel showed `U64 · HEALTHY` but Home still displayed `Device Not available` and `Firmware Not available`.

Phase 2 tests already run:

```bash
npx vitest run tests/unit/connection/connectionManager.test.ts tests/unit/hooks/useC64Connection.test.ts tests/unit/components/diagnostics/DiagnosticsDialog.test.tsx tests/unit/hooks/useTelnetActions.test.tsx
```

Passed: 152 tests.

After the latest `useC64Connection` fallback fix, this targeted set passed:

```bash
npx vitest run tests/unit/hooks/useC64Connection.test.ts tests/unit/pages/home/components/SystemInfo.test.tsx tests/unit/connection/connectionManager.test.ts tests/unit/components/diagnostics/DiagnosticsDialog.test.tsx
```

Passed: 142 tests.

`npm run lint` passed after the latest fix with only existing warnings in:

```text
c64scope/coverage/block-navigation.js
c64scope/coverage/prettify.js
c64scope/coverage/sorter.js
```

Coverage note:

- Full coverage passed before the latest `useC64Connection` fallback fix: 965 tests, 91.76% branch.
- A second `npm run test:coverage` was started after that fix and was green through many shards, but the shell session was lost/interrupted before the final merged summary was captured. Do not treat it as evidence.
- To avoid wasting time, do not immediately rerun full coverage unless you are closing Phase 2 or making no further Phase 3/4 code changes. Use targeted tests while iterating.

Phase 2 device evidence state:

- APK was built and installed successfully before the latest fallback fix:

```bash
npm run cap:build && npm run android:apk
adb -s 9B081FFAZ001WX install -r android/app/build/outputs/apk/debug/c64commander-0.7.9-rc1-debug.apk
```

- Black screenshots were caused by the device dozing:
  - `evidence/phase2-F-CONN-1-u64-cold-3s.png`
  - `evidence/phase2-F-CONN-2-u64-cold-5s.png`
- Awake check showed badge was fixed but Home metadata still failed before the latest code fix:
  - `evidence/phase2-F-CONN-1-u64-awake-check.png`
  - UI showed `U64 · HEALTHY`, but `Device` and `Firmware` were still `Not available`.
- Rebuild/reinstall is required before taking final Phase 2 Pixel evidence.

Fast next Phase 2 path:

1. Run only the targeted Phase 2 tests if code has changed since this handover:

   ```bash
   npx vitest run tests/unit/hooks/useC64Connection.test.ts tests/unit/pages/home/components/SystemInfo.test.tsx tests/unit/connection/connectionManager.test.ts tests/unit/components/diagnostics/DiagnosticsDialog.test.tsx
   ```

2. If those are still green, build and install:

   ```bash
   npm run cap:build && npm run android:apk
   adb -s 9B081FFAZ001WX install -r android/app/build/outputs/apk/debug/c64commander-0.7.9-rc1-debug.apk
   ```

3. Wake the Pixel, clear logcat, cold-launch, and capture +3s/+5s:

   ```bash
   adb -s 9B081FFAZ001WX shell input keyevent KEYCODE_WAKEUP
   adb -s 9B081FFAZ001WX shell wm dismiss-keyguard
   adb -s 9B081FFAZ001WX logcat -c
   adb -s 9B081FFAZ001WX shell am force-stop uk.gleissner.c64commander
   adb -s 9B081FFAZ001WX shell am start -W -n uk.gleissner.c64commander/.MainActivity
   sleep 3
   adb -s 9B081FFAZ001WX shell screencap /sdcard/phase2-cold-3s.png
   adb -s 9B081FFAZ001WX pull /sdcard/phase2-cold-3s.png docs/research/stabilization/responsiveness2/evidence/phase2-F-CONN-1-u64-cold-3s-after-info-fallback.png
   sleep 2
   adb -s 9B081FFAZ001WX shell screencap /sdcard/phase2-cold-5s.png
   adb -s 9B081FFAZ001WX pull /sdcard/phase2-cold-5s.png docs/research/stabilization/responsiveness2/evidence/phase2-F-CONN-2-u64-cold-5s-after-info-fallback.png
   adb -s 9B081FFAZ001WX logcat -d -t 5000 > docs/research/stabilization/responsiveness2/evidence/phase2-F-CONN-1-u64-cold-logcat-after-info-fallback.txt
   ```

4. Validate visually:
   - Badge is not OFFLINE, ideally `U64 · HEALTHY`.
   - Home `Device` is `u64` or `Ultimate 64 Elite`.
   - Home `Firmware` is `3.14e`.

5. Do one warm restart evidence capture only if cold launch passes.

6. Update `IMPLEMENTATION_PLANS.md` Phase 2 gate with the evidence filenames. The recovered `c64u` sweep now has Phase 2 and later evidence recorded there as well.

## Phase 3 next work

Prioritize latency/noise fixes that affect the user-visible app first.

Recommended order:

1. F-HTTP-2: reduce Home cold-boot config storm.
   - Current logcat showed repeated LED Strip and Keyboard Lighting config calls during cold launch.
   - Audit `src/pages/HomePage.tsx`, `src/pages/home/components/LightingSummaryCard.tsx`, and relevant config hooks.
   - Batch with `getConfigItems(category, items)` where possible.
   - Defer Keyboard Lighting until the relevant section actually opens if that preserves current UX.

2. F-HTTP-1: verify CapacitorCookies disable.
   - `npm run cap:build` currently reports only `@capacitor/filesystem` and `@capacitor/share`, but logcat still showed `CapacitorCookies` lines for C64U URLs.
   - Check generated `android/app/src/main/assets/capacitor.config.json`.
   - Add one narrow test only if there is a stable generated/config artifact to assert.

3. F-LOG-1/F-LOG-2: log noise and cold boot errors.
   - Do not suppress diagnostics silently.
   - Fix the source of `Msg: undefined` and `triggerEvent` errors.
   - Use logcat grep evidence, not broad manual testing.

## Phase 4 next work

After Phase 3:

- F-RT-1: make saved-device health checks respect the polling pause registry during active interaction.
- F-MIME-1: prewarm `MimeMap.getDefault().guessMimeTypeFromExtension("html")` off the UI thread in `MainActivity.onCreate`.

## Current working tree summary

At handover time, `git status --short` showed:

```text
 M docs/research/stabilization/responsiveness2/IMPLEMENTATION_PLANS.md
 M src/components/diagnostics/DiagnosticsDialog.tsx
 M src/components/diagnostics/GlobalDiagnosticsOverlay.tsx
 M src/hooks/useC64Connection.ts
 M src/lib/c64api.ts
 M src/lib/connection/connectionManager.ts
 M tests/unit/components/diagnostics/DiagnosticsDialog.test.tsx
 M tests/unit/components/diagnostics/GlobalDiagnosticsOverlay.routeClose.test.tsx
 M tests/unit/connection/connectionManager.test.ts
 M tests/unit/hooks/useC64Connection.test.ts
?? docs/research/stabilization/responsiveness2/evidence/phase1-F-DIAG-1-u64-home-60s-after-telnet-scheduler.png
?? docs/research/stabilization/responsiveness2/evidence/phase2-F-CONN-1-u64-awake-check.png
?? docs/research/stabilization/responsiveness2/evidence/phase2-F-CONN-1-u64-cold-3s.png
?? docs/research/stabilization/responsiveness2/evidence/phase2-F-CONN-2-u64-cold-5s.png
```

There may be additional evidence files not listed if the next agent captures more.

## Validation discipline

Use this rule to keep the work fast:

- While editing: run targeted Vitest files only.
- Before closing a phase: run lint and the smallest required device evidence.
- Before declaring the overall task complete: run the full repo gates required by AGENTS.md and `STABILIZATION_PROMPT.md`.
- Do not run full screenshot refreshes; these findings need evidence screenshots only.
- Do not repeatedly probe `c64u` after the documented reset failure unless there is a reason to believe the device/network changed.

## Non-negotiables

- Do not silence or hide health diagnostics to make badges look healthy.
- Do not weaken assertions or delete tests to make failures pass.
- Do not skip root-cause investigation for warnings/errors introduced by these changes.
- Do not claim Pixel validation unless the installed APK was launched and the screenshot/logcat evidence was captured after the relevant code change.
- Do not claim `c64u` validation while `/v1/info` is resetting the connection.
