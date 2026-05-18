# IMPLEMENTATION_PROMPT — Stabilization Refuel (Responsiveness 3, Stage 2)

Written 2026-05-18. This prompt is the binding execution brief for the next
stage. It is self-contained: an agent picking it up cold needs nothing but
this document, the responsiveness3 handoff folder, and access to the live
Pixel 4 + u64 + c64u hardware.

## Read first

1. This document (full).
2. `responsiveness3/FINDINGS.md` — the catalogue of new defects with code
   loci.
3. `responsiveness3/DIAGNOSTICS_ROOT_CAUSE_MATRIX.md` — defect-to-cause
   mapping.
4. `responsiveness3/FEATURE_INVENTORY.md` — priority ranking + implementation
   order.
5. `responsiveness3/RESPONSIVENESS_NOTES.md` — acceptance criteria.
6. `responsiveness3/PLANS.md` — investigation scope (what was DONE, what was
   intentionally out of scope).
7. `responsiveness2/IMPLEMENTATION_PLANS.md` — what landed in PR #258. Do
   not re-do.

After reading, proceed to the phase plan below.

## Operating principle

The user explicitly wants responsiveness and error-free behaviour. Stage 2 must
not silence diagnostics, weaken assertions, delete tests, or downgrade labels
to make things look better. Every fix must move data, scheduling, or transport
— not labels.

Targeted validation while iterating, full repo gates before closing each phase.
Match the responsiveness2 rhythm: narrow Vitest runs while editing, lint +
coverage before closing a phase, then Pixel evidence.

## Binding context

- Branch to start from: a fresh branch off `main` named
  `feat/responsiveness3-cold-boot` (or similar). Do not continue
  `feat/reduce-latency-and-fix-errors2`.
- Pixel 4 serial: `9B081FFAZ001WX`.
- Primary device: `u64` (Ultimate 64 Elite, fw 3.14e). Secondary: `c64u`
  (C64 Ultimate, fw 1.1.0). Always probe `u64` first via
  `curl --max-time 5 -sS http://u64/v1/info`. Fall back to `c64u` if `u64`
  is unreachable. Do not block on `c64u` if only one device is up; capture
  the documented constraint and proceed.
- Wake/unlock command:
  ```bash
  adb -s 9B081FFAZ001WX shell input keyevent KEYCODE_WAKEUP
  adb -s 9B081FFAZ001WX shell wm dismiss-keyguard
  adb -s 9B081FFAZ001WX shell input keyevent KEYCODE_MENU
  adb -s 9B081FFAZ001WX shell input swipe 500 1600 500 300 300
  ```
- Build + install command:
  ```bash
  npm run cap:build && npm run android:apk
  adb -s 9B081FFAZ001WX install -r android/app/build/outputs/apk/debug/c64commander-0.7.9-rc1-debug.apk
  ```
  If install fails because of "INSTALL_FAILED_UPDATE_INCOMPATIBLE", uninstall
  `uk.gleissner.c64commander` first.
- Evidence directory: `docs/research/stabilization/responsiveness3/evidence/`.
  Use file-name conventions consistent with responsiveness2:
  `phase<N>-<finding-id>-<host>-<artifact>`.

## Classification

`CODE_CHANGE` for Phases 1-4 and 6; `DOC_PLUS_CODE` for Phase 5 (only) when
adding a JSON capability map asset. No `UI_CHANGE` — no visible documented UI
changes are required by this brief; do not refresh screenshot corpora.

## Phase 1 — Home cold-boot enrichment storm (F3-HTTP-1, F3-CACHE-1, F3-HTTP-2)

This is the biggest-leverage phase. Land it before everything else.

### Phase 1 acceptance gate

1. Cold-boot Pixel 4 (`am force-stop` then `am start`) against `u64`:
   - `grep -c 'Handling CapacitorHttp request' logcat` ≤ **30** within the
     first 12 s (was 95).
   - All Home cards (CPU/RAM, Drives, Audio Mixer, Lighting summary) visible
     with authoritative values within 3 s of `am start -W`'s `TotalTime`.
2. Re-cold-boot of the same APK against the same device:
   - Telnet plugin calls ≤ 1 (capability cache hit) — addressed in Phase 2;
     for Phase 1 the only target is the REST storm.
3. Saved-device switch `u64 → c64u → u64`:
   - The second `u64` cold mount issues 0 per-item enrichment requests for
     keys already in the persisted cache.
4. Existing `npm run test:coverage` thresholds intact (≥ 91 % branch).

### Phase 1 work plan

1. **Default-skip enrichment for Home consumers.**
   - In `src/hooks/useC64Connection.ts`, add a `skipEnrichment: true` default
     to `useC64ConfigItems` options used by Home (or invert: a new
     `enrichOnDemand: true` option that defaults to true for HOME tier).
   - Threaded callers: `src/pages/HomePage.tsx:119-148`, `src/pages/home/
     hooks/useDriveData.ts:19,26,33`, `src/pages/home/hooks/useStreamData.ts
     :44`, `src/pages/home/hooks/usePrinterData.ts:19`, `src/components/disks/
     HomeDiskManager.tsx:213,219,225`, `src/hooks/useLightingStudio.tsx
     :274,280`. Confirm each card renders correctly with flat values (the
     C64U firmware returns valid current values at the category level; the
     only thing missing is the `values` allow-list for sliders/selects).
   - For sliders that today rely on enriched `values`, fall back to the
     hard-coded SI domain in `src/lib/config/sidStatus.ts`,
     `src/pages/home/components/HomeCpuSpeedSlider.tsx`, or define new
     small maps in `src/lib/config/`. Document each hard-coded domain with a
     comment that names its firmware source.
2. **Persistent enrichment cache (F3-CACHE-1).**
   - In `src/lib/c64api.ts`, replace
     `private readonly configCategoryItemsCache = new Map<...>()` with a
     persistent store keyed by `${unique_id}|${firmware_version}|${category}`,
     backed by `localStorage` via a wrapper module
     `src/lib/c64api/configEnrichmentCache.ts`. Hold the in-memory `Map` as
     a hot cache, write through on every `rememberConfigCategoryItems`.
   - On `setBaseUrl` / `setPassword` / `setDeviceHost`, do NOT clear the
     persistent cache; only swap the active key namespace. The in-memory
     `inFlightReadRequests` and `readRequestBudget` still need to clear.
   - On firmware version change for the same `unique_id`, invalidate that
     device's cache namespace.
3. **Defer `useAppConfigState` snapshot capture (F3-HTTP-2).**
   - In `src/hooks/useAppConfigState.ts`, replace the mount-time capture
     trigger with one of:
     - User-initiated capture (button presses "Save" / "Revert" / first
       config write).
     - Idle capture: after 5 s with no in-flight requests AND
       `pollingPauseRegistry.isPollingPaused() === false`.
   - When deferred, the Revert flow should fall back to a "no snapshot
     yet — capture now?" prompt the first time it's invoked without one.
4. **Tests.**
   - `tests/unit/hooks/useC64Connection.useC64ConfigItems.enrichment.test.tsx`:
     when `skipEnrichment` is on (Home tier default), the API call resolves
     with flat values and no per-item REST is issued.
   - `tests/unit/lib/c64api/configEnrichmentCache.test.ts`: `localStorage`
     read/write/roundtrip, key namespacing, firmware-change invalidation.
   - `tests/unit/lib/c64api/c64api.setBaseUrl.test.ts`: switching base URL
     preserves the persistent cache.
   - `tests/unit/hooks/useAppConfigState.deferredCapture.test.tsx`:
     mount-time does not trigger `fetchAllConfig`; user-initiated trigger
     does.
   - Update `tests/unit/pages/HomePage.test.tsx` or equivalent to assert
     fewer REST calls in `getMockApiCallLog()`.

### Phase 1 closeout evidence

- `evidence/phase1-F3-HTTP-1-u64-cold-logcat.txt` — full first-12s logcat
  with ≤ 30 CapacitorHttp lines.
- `evidence/phase1-F3-HTTP-1-u64-cold-paint-screencap.png` — Home rendered
  at `+3 s` post-launch, all cards with authoritative values.
- `evidence/phase1-F3-CACHE-1-switch-back-summary.txt` — JSON or text
  summary asserting `u64 → c64u → u64` second cold mount issues 0
  enrichment requests.

## Phase 2 — Telnet capability discovery (F3-TELNET-1, F3-TELNET-2)

### Phase 2 acceptance gate

1. Cold-boot Pixel 4 against `u64`:
   - Telnet plugin calls in first 30 s ≤ 15 (one discovery + one health
     probe is acceptable).
   - Telnet connect/disconnect pairs ≤ 2 (one discovery, one health probe).
2. Repeat cold-boot of the same APK against the same device:
   - Telnet plugin calls in first 30 s ≤ 5.
   - Telnet connect/disconnect pairs ≤ 1 (health probe only).
3. Firmware-change simulation (mock `deviceInfo.firmware_version` change):
   - Capability discovery re-runs once.

### Phase 2 work plan

1. **Gate discovery effect on stable cache key (F3-TELNET-1).**
   - In `src/hooks/useTelnetActions.ts:273-306`, change the effect's `enabled`
     condition to `status.isConnected && status.deviceInfo != null &&
     capability.menuKey != null && capabilityCacheKey != null`. The current
     check allows the first run with a partial cache key.
   - Add an assertion (warn-only in development) when the cache key changes
     after a `setCapabilities(snapshot)` — would catch future races.
2. **Persistent capability cache (F3-TELNET-2).**
   - In `src/lib/telnet/telnetCapabilityDiscovery.ts:72`, replace the
     module-scoped `Map` with a `localStorage`-backed cache wrapper. Key
     prefix: `c64u:telnetCapability:`.
   - On `clearTelnetCapabilityCache`, clear both layers.
   - On firmware change for the same `unique_id`, invalidate that device's
     entry.
3. **Optional: ship a default capability map for known firmware.**
   - `src/lib/telnet/builtinCapabilityMaps.ts` containing canned snapshots
     for `Ultimate 64 Elite fw 3.14e` and `C64 Ultimate fw 1.1.0`. On
     cache miss, return the canned snapshot synchronously AND schedule a
     background discovery to validate. If the validation disagrees, log
     `warn` and use the discovered version. This is the only way to drop
     cold-boot discovery to 0 on a fresh install — defer to a Phase 2.5
     follow-up if it requires too much code-time.
4. **Tests.**
   - Unit: discovery runs exactly once per cold mount when `deviceInfo`
     transitions null → populated.
   - Unit: `localStorage` round-trip with a real snapshot.
   - Integration (Pixel 4): cold-boot logcat assertion.

### Phase 2 closeout evidence

- `evidence/phase2-F3-TELNET-1-u64-cold-logcat.txt`
- `evidence/phase2-F3-TELNET-2-u64-repeat-cold-logcat.txt`

## Phase 3 — Polling-pause sweep (F3-HTTP-3, F3-HTTP-4, F3-PAUSE-1, F3-PAUSE-2)

### Phase 3 acceptance gate

1. Pixel 4 30 s slider stress on Home CPU Speed slider against `u64`:
   - `c64-drives` refetches during interaction: 0.
   - `c64-info` refetches during interaction: 0.
   - Saved-device probes: 0 (already locked in by responsiveness2).
2. Pixel 4 mute toggle during a known-pending drives tick:
   - Mute REST write is the next CapacitorHttp call (no drives `GET /v1/drives`
     between tap and write).
3. Capability discovery while a slider is being dragged:
   - No drives or info ticks fire during discovery.

### Phase 3 work plan

1. **`useC64Drives` and `useC64Info` observe pause registry.**
   - In both hooks, replace `refetchInterval: ... ? false : INTERVAL_MS`
     with a callable `refetchInterval` that returns `false` when
     `pollingPauseRegistry.isPollingPaused()` is true.
   - Add `useEffect` subscribers that listen via
     `pollingPauseRegistry.subscribe(...)` and call
     `queryClient.cancelQueries({ queryKey: [...] })` on pause-acquire to
     drop in-flight ticks.
2. **Volume mute toggle acquires the pause (F3-PAUSE-1).**
   - In `src/pages/playFiles/components/VolumeControls.tsx:55-66`, wrap
     `onToggleMute` in a small `useCallback` that acquires a pause, runs
     the mute write, and releases on settle. The actual mutation lives in
     `src/pages/playFiles/hooks/useVolumeOverride.ts` — easier to add the
     handle there so the rule applies to every mute call site.
3. **Capability discovery acquires the pause (F3-PAUSE-2).**
   - In `src/hooks/useTelnetActions.ts:198-247`, wrap the `withTelnetInter
     action` block in `acquirePause / release`.
4. **Tests.**
   - Unit: simulate paused state; `useC64Drives` `refetchInterval` evaluates
     to `false`.
   - Unit: simulate paused state; in-flight drives query is cancelled when
     pause acquired.
   - Unit: mute toggle acquires a pause around the write.

### Phase 3 closeout evidence

- `evidence/phase3-F3-HTTP-3-u64-slider-30s-request-trace.json`
- `evidence/phase3-F3-PAUSE-1-u64-mute-during-poll-logcat.txt`

## Phase 4 — Visibility reconciler and slider pause tail-grace (F3-RESUME-1, F3-PAUSE-3)

### Phase 4 acceptance gate

1. Pixel 4 lock / unlock cycle while Home is foregrounded:
   - 0 `Handling CapacitorHttp request` lines in the next 5 s.
2. Slider commit at a watch-marked time `T`:
   - Pause count at `T + 100 ms`: ≥ 1.
   - Pause count at `T + 300 ms`: 0.
3. The `runDiagnosticsReconciler` and `runPlaybackReconciler` arms still fire
   (no regression to the diagnostics contract).

### Phase 4 work plan

1. **Throttle the resume reconciler (F3-RESUME-1).**
   - In `src/lib/query/c64QueryInvalidation.ts:117-121`,
     `invalidateForVisibilityResume` should:
     - Skip if any of the prefixes was last refetched within 30 s (track a
       small in-memory ledger keyed by prefix).
     - Drop `refetchActiveByPrefix`; rely on
       `invalidateByPrefix` plus React Query's natural refetch-on-mount
       semantics.
   - Keep the `c64-info` invalidation eager so the badge updates after a
     resume; everything else stays stale-on-next-read.
2. **Slider pause tail-grace (F3-PAUSE-3).**
   - In `src/hooks/useDeviceBoundSlider.ts:131-...`, after `commit` resolves,
     schedule a `setTimeout(release, 250)` instead of releasing immediately.
     Clear the timer if the user starts another drag in the meantime
     (which restarts the acquire/release lifecycle).
3. **Tests.**
   - Unit: simulate `visibilitychange` to visible; assert 0 `refetchQueries`
     calls when last refetch was 1 s ago.
   - Unit: simulate visibility resume after 60 s idle; assert
     `c64-info` invalidates.
   - Unit: pause-handle still acquired at commit + 100 ms; released by
     commit + 300 ms.

### Phase 4 closeout evidence

- `evidence/phase4-F3-RESUME-1-u64-lock-unlock-logcat.txt`
- `evidence/phase4-F3-PAUSE-3-u64-slider-pause-trace.json`

## Phase 5 — Background traffic + TelnetSocketPlugin closeups (F3-NAV-1, F3-TELNET-4)

### Phase 5 acceptance gate

1. Pixel 4 with app foregrounded → press `KEYCODE_HOME`:
   - 0 CapacitorHttp lines, 0 Telnet plugin calls in the next 5 s.
2. JVM unit test for `TelnetSocketPlugin.disconnect` catch arm:
   - Resolves with `JSObject()` payload (not bare `resolve()`).

### Phase 5 work plan

1. **Confirm `useScreenActivity` flips fast enough (F3-NAV-1).**
   - Read `src/hooks/useScreenActivity.tsx`. If it subscribes only to
     React Native-style `AppState`, add a `document.visibilitychange`
     subscriber so it flips within one frame of WebView visibility change.
   - On flip to background, cancel `queryClient.cancelQueries({})` for the
     prefixes that own polling.
2. **Fix the disconnect catch arm (F3-TELNET-4).**
   - `android/app/src/main/java/uk/gleissner/c64commander/TelnetSocketPlugin.kt
     :97-106`: replace `call.resolve()` with `call.resolve(JSObject())`.
   - Add `TelnetSocketPluginTest::disconnect emits empty object on caught
     exception`.

### Phase 5 closeout evidence

- `evidence/phase5-F3-NAV-1-u64-backgrounded-logcat.txt`
- `evidence/phase5-F3-TELNET-4-jvm-test-output.txt`

## Phase 6 — Full validation sweep

Run before merging. Re-validate every prior phase's gates plus the repo gates.

1. `npm run lint` — passes (existing `c64scope/coverage` warnings are
   tolerated as before).
2. `npm run test` — passes (~6500 tests).
3. `npm run test:coverage` — passes with ≥ 91 % branch coverage globally.
4. `npm run test:agents` — passes with ≥ 90 % branch coverage in `agents/`.
5. `npm run build` — passes.
6. `npm run cap:build && npm run android:apk` — passes.
7. Fresh APK install on Pixel 4 + cold launch:
   - `TotalTime` ≤ 700 ms (regression budget vs current 606 ms).
   - All cold-boot acceptance gates from Phases 1-5 still pass.
8. Cross-device sweep: each phase's gate captured against both `u64` and
   `c64u`. Document evidence rows in a `IMPLEMENTATION_PLANS.md` table.

## Hypotheses to falsify (not blockers)

Carry these forward and resolve via targeted tests; do not block phase
closure on them.

- **H3-RESUME-1**: Lock/unlock the Pixel screen with the app foregrounded.
  Does the WebView's `visibilitychange` actually fire on Android lock? If
  not, F3-RESUME-1 is a non-issue in practice (but still a code-health
  fix). Capture one logcat to confirm.
- **H3-NAV-1**: After cleanly running `am start` on `MainActivity`, pressing
  `input keyevent KEYCODE_HOME` should background the app reliably. Re-run
  the F3-NAV-1 capture; if 0 CapacitorHttp lines in the next 5 s, the
  observation in `evidence/nav-to-play-2-logcat.txt` was the home-tap
  mis-hitting a tab. Document the finding either way.
- **H3-RT-1**: With Phase 1 done, are F3-HTTP-{3,4} still observable, or
  does the storm reduction alone hide them? Phase 3 is still the right
  fix; this just affects priority urgency.

## Non-negotiables

- Do not silence diagnostics to make badges look healthier.
- Do not weaken assertions or delete tests to make failures pass.
- Do not skip root-cause investigation for warnings/errors introduced by
  these changes.
- Do not claim Pixel validation unless the installed APK was launched and
  the screenshot/logcat evidence was captured after the relevant code
  change.
- Do not declare a phase complete without its acceptance gate's evidence
  captured under `evidence/`.
- Do not regenerate screenshot docs under `docs/img/**`. No `UI_CHANGE`
  is required by this brief.

## Live execution log location

Create `responsiveness3/IMPLEMENTATION_PLANS.md` mirroring the structure of
`responsiveness2/IMPLEMENTATION_PLANS.md`: per-phase status table,
per-finding evidence row, Pixel deploy log. Update continuously.

## Pixel deploy log seed

| When             | APK                                                                    | TotalTime | Notes                              |
| ---------------- | ---------------------------------------------------------------------- | --------- | ---------------------------------- |
| 2026-05-18 17:45 | `c64commander-0.7.9-rc1-debug.apk` (PR #258, pre-responsiveness3 fix) | 606 ms    | Baseline; 95 HTTP / 74 Telnet plugin calls in first 12 s of cold boot against c64u; see `evidence/baseline-u64-cold-logcat-12s.txt`. |
| 2026-05-18 17:48 | same APK                                                              | 572 ms    | Reproduced baseline against c64u (95 HTTP requests, 74 Telnet plugin calls). |

Once Phase 1 ships, append rows here for every cap:build + install.
