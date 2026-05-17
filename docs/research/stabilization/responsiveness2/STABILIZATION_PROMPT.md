# STABILIZATION_PROMPT — C64 Commander Stage-2 (implementation)

> **Source of truth for the implementation agent.** This prompt was written 2026-05-17 by the Stage-1 investigation. Treat the companion files under `/home/chris/dev/c64/c64commander/docs/research/stabilization/responsiveness2/` (`FINDINGS.md`, `DIAGNOSTICS_ROOT_CAUSE_MATRIX.md`, `RESPONSIVENESS_NOTES.md`, `FEATURE_INVENTORY.md`, `WORKLOG.md`, and `evidence/`) as authoritative input. Do not re-run the investigation; build on it.

## ROLE

You are an expert Android / Capacitor / React / TypeScript / device-reliability engineer. You are responsible for implementing the full stabilization defined here against the C64 Commander codebase, validating it against a real Pixel 4 and against both real C64 hardware targets (`u64` and `c64u`), and shipping the change set with regression tests that lock in the corrected behaviour.

This is not a research pass. Do not redo the investigation. The findings already include concrete file paths, line numbers, and code-level root causes. Use them.

## OBJECTIVE

Make C64 Commander on Android (and shared TS code paths used by web + iOS) genuinely responsive and reliable for the most-used flows:

1. Diagnostics correctly reflect the active device only, with no false-positive degraded states.
2. The cold-boot connection state never claims `OFFLINE` while a healthy REST call to the active device is in-flight or has succeeded.
3. Sliders, volume, mute, playback start/stop/pause work reliably under bounded rapid interaction.
4. Background saved-device probes do not interfere with active-device interaction frames.
5. Boot-time log noise (`Uncaught TypeError ... triggerEvent` and per-Telnet-tick `Msg: undefined`) is eliminated at the source.

Validation must include a deploy of the resulting APK to the attached Pixel 4 and a real-device check against **both** `u64` (Ultimate 64 Elite fw 3.14e at 192.168.1.13) and `c64u` (C64 Ultimate fw 1.1.0 at 192.168.1.167).

## REPOSITORY CONTEXT

- Repo: `/home/chris/dev/c64/c64commander`
- Branch starting point: `feat/reduce-latency-and-fix-errors` (commit `c65aa7a5` as of investigation)
- Active version: 0.7.9-rc1
- Build commands of record (from `package.json`):
  - Unit tests: `npm run test`
  - Coverage gate: `npm run test:coverage` (must be ≥ 91 % branch coverage)
  - Lint: `npm run lint`
  - Web build: `npm run build`
  - Android sync: `npm run cap:build`
  - Android debug APK: `npm run android:apk`
  - Convenience: `./build --install-apk`
- Existing APK on Pixel 4: `android/app/build/outputs/apk/debug/c64commander-0.7.9-rc1-debug.apk` (already installed; you will replace it).
- Pixel 4 adb serial: `9B081FFAZ001WX` (prefix `9B0`).

## CONFIRMED FINDINGS TO FIX

For each item below, the fix requirement is binding. Confidence in the cause is **High** unless noted. See `FINDINGS.md` for full evidence.

### F-DIAG-1 — Saved-device probes contaminate the active device's health rollup

**Required outcome**: a saved-but-inactive device that goes unreachable must NOT degrade the active device's badge.

**Required changes**:
- Add a `deviceId` (or normalized `host`) field to every trace event emitted by `recordTelnetOperation`, the REST request/response recorders (`src/lib/tracing/traceSession.ts` and any callers in `src/lib/c64api*`), and the FTP operation recorder.
- Refactor `deriveRestContributorHealth`, `deriveFtpContributorHealth`, `deriveTelnetContributorHealth`, `deriveAppContributorHealth` (`src/lib/diagnostics/healthModel.ts`) to accept an `activeDeviceId` and filter the event window to events that target the active device. Keep backwards-compatible call sites by routing through a new wrapper that injects the active deviceId from `connectionManager.getSnapshot()` or the device store.
- `useSavedDeviceHealthChecks` (`src/hooks/useSavedDeviceHealthChecks.ts`):
  - Lower inactive-device cycle frequency to 60 s (configurable but defaulted).
  - Per-device result must update only that device's snapshot, not the global rollup.
- Ensure `Last activity` (REST/FTP/TELNET) on the dialog is per-device, not global, when an active device is selected.

**Regression tests**:
- Unit: in `tests/unit/lib/diagnostics/healthModel.test.ts`, add cases where events for `deviceId: "c64u"` are present and assert `deriveRestContributorHealth` / `Telnet` / `Ftp` for `activeDeviceId: "u64"` ignore them.
- Integration: a Vitest scenario simulating a saved device emitting only failures while another saved-device emits only successes; assert the active-device rollup is HEALTHY.

### F-DIAG-2 — REST contributor window asymmetry

**Required outcome**: REST, FTP, TELNET contributor windows use a single, documented policy for trimming around success/failure history.

**Required changes**:
- In `src/lib/diagnostics/healthModel.ts`, replace `restHealthWindowEvents` with the same `trimToLatestSuccess` shape that FTP and Telnet use, OR document why REST must keep failures-since-first-success. The investigation recommends `trimToLatestSuccess` for consistency.
- Update related unit tests; the recovery latency in `RESPONSIVENESS_NOTES.md` (≤ 60 s after 5 successes) must be enforceable.

**Regression tests**:
- Unit: `[fail, fail, success, fail, success]` → REST contributor returns `Healthy` after the latest success (mirroring FTP/TELNET).
- Unit: `[success, fail, fail, fail]` → REST contributor returns `Unhealthy` (3 of 3 since last success).

### F-DIAG-3 — App contributor over-sensitivity

**Required outcome**: a single transient error 4 minutes ago must NOT keep the App contributor in `Degraded`.

**Required changes**:
- In `deriveAppContributorHealth`, replace the integer threshold with a recency-aware rule: e.g. `Degraded` only if ≥ N errors in the last 60 s OR ≥ M cumulative errors in 5 minutes, with N/M chosen to match observed real failure rates. Document the chosen rule inline.

**Regression tests**:
- Unit: 1 error 4 m 30 s ago and 0 errors recently → `Idle` or `Healthy`.
- Unit: 3 errors in last 30 s → `Degraded`.
- Unit: 6 errors in last 30 s → `Unhealthy`.

### F-CONN-1 — `OFFLINE` badge while REST is succeeding

**Required outcome**: the badge must never show `OFFLINE` while a successful REST call to the active device's IP has returned 200 within the last 5 s.

**Required changes**:
- In `src/lib/connection/connectionManager.ts`, add `noteReachable(host: string, source: "rest" | "ftp" | "telnet")` that promotes `OFFLINE_NO_DEMO` or `DISCOVERING` → `REAL_CONNECTED` when a normal RESTful response on the active host is observed.
- In `src/lib/c64api.ts` (or its `c64api/` split), call `noteReachable(activeHost, "rest")` from the response success path of any 2xx REST response to the active device.
- Keep the dedicated `/v1/info` probe in place; it remains the authoritative `DeviceInfo` source — but it should no longer block the badge from turning green.

**Regression tests**:
- Vitest: with a stubbed C64API returning 200 on `/v1/configs/...` and a discovery probe stubbed to never respond, the badge becomes `REAL_CONNECTED` within the first response.

### F-CONN-2 — Warm-restart "Device: Not available" sticks

**Required outcome**: on warm restart, the Home page Device/Firmware meta row must populate when the connection settles, without requiring a manual refresh.

**Required changes**:
- Inspect `src/pages/HomePage.tsx` for the Device/Firmware fields and ensure they consume `connectionManager.getSnapshot().deviceInfo` or the React Query `/v1/info` cache.
- On `REAL_CONNECTED` transition, dispatch a `queryClient.invalidateQueries({ queryKey: ["c64-info"] })` (or equivalent) so warm-restart paths refresh the cache.

**Regression tests**:
- Vitest: simulate `connectionManager` transitioning UNKNOWN → REAL_CONNECTED; assert that the Home meta row updates Device and Firmware within 1 s of the transition.

### F-CONN-3 — Diagnostics header `u64 · Unknown`

**Required outcome**: when the active device's `/v1/info` has succeeded at least once in the current session, the Diagnostics dialog header must display the product label (not `Unknown`).

**Required changes**:
- In `src/components/diagnostics/DiagnosticsDialog.tsx`, fall back to `connectionManager.getSnapshot().deviceInfo.product` (or the React Query `c64-info` cache) when the per-device saved snapshot lacks `product`.

**Regression tests**:
- Unit: rendering DiagnosticsDialog with an empty per-device product but a populated `c64-info` cache shows the cache product.

### F-HTTP-1 — `CapacitorCookies` per-request JNI hop

**Required outcome**: zero `I CapacitorCookies: Getting cookies at:` lines for C64U URLs in steady-state logcat.

**Required changes**:
- Verify `android/app/src/main/assets/capacitor.config.json` after `npm run cap:build` actually sets `"CapacitorCookies": { "enabled": false }`.
- If the per-plugin disable is not honored by the installed Capacitor version, either upgrade Capacitor to a version where it is honored, or remove `@capacitor/cookies` from the Android plugin registration entirely (it is unused — confirm by grep of `CapacitorCookies` usage in `src/`).
- If neither is feasible, document the upstream issue in `capacitor.config.ts` and ensure CapacitorHttp does not call the cookie manager for our URLs (the simplest workaround is a tiny native sub-plugin that does a `URL.openConnection` without cookies for our LAN URLs).

**Regression tests**:
- Vitest: a parse test on `capacitor.config.json` asserts `CapacitorCookies.enabled === false`.
- Pixel 4 smoke (in `scripts/`): 30 s logcat capture during Home-page idle must contain 0 `CapacitorCookies` lines for any C64U URL.

### F-HTTP-2 — Cold-boot LED Strip config-tree storm

**Required outcome**: cold-boot REST calls to LED Strip Settings / Keyboard Lighting are batched. At most 2 calls per category at cold boot.

**Required changes**:
- Use `getConfigItems(category, items)` (already in `src/lib/c64api.ts`) instead of per-item `getConfigItem`. Audit `LightingSummaryCard.tsx`, `HomePage.tsx`, and any other cold-boot consumers.
- Defer Keyboard Lighting until the user opens a section that needs it (lazy chunk).

**Regression tests**:
- Pixel 4 smoke (or a structured CapacitorHttp logcat assertion): cold-boot LED Strip Settings calls ≤ 2.

### F-LOG-1 — `Msg: undefined` log spam

**Required outcome**: a 30 s Home-page session emits 0 `Capacitor/Console: ... Msg: undefined` lines.

**Required changes**:
- Add an ESLint rule that bans `console.log` (and `console.info` of identifier expressions whose value can be `undefined`) in `src/lib/telnet/**` and `src/lib/diagnostics/**`. Allow `console.warn`/`console.error` for the bridge.
- In `src/main.tsx`, install a production-only `console.log` no-op (or route everything through `addLog`).
- Find the culprit: instrument `console.log`/`console.info` in dev mode to capture stack traces when called with `undefined` first arg, OR build with sourcemaps and grep bundled output for line 353 of any chunk likely to log on Telnet ticks (`telnetSession*.js`, `telnetClient.ts`).

**Regression tests**:
- Vitest: ESLint config asserts the rule is present.
- Pixel 4 smoke gate: 30 s Telnet probe activity logs 0 `Msg: undefined` lines.

### F-LOG-2 — `Cannot read properties of undefined (reading 'triggerEvent')` at cold boot

**Required outcome**: cold boot logcat contains 0 `Uncaught TypeError` lines from the Capacitor bridge.

**Required changes**:
- Identify the early consumer of `Capacitor.triggerEvent`. Likely candidates: an `addEventListener` registered at import time before Capacitor is ready. Inspect `src/main.tsx`, `src/lib/diagnostics/logger.ts` (the console bridge installer), `src/lib/native/*Plugin.ts`, and `src/lib/diagnostics/diagnosticsOverlay.ts`.
- Defer the consumer behind `Capacitor.isReady` or behind the `DOMContentLoaded` event, whichever the bridge contract requires.

**Regression tests**:
- Vitest: simulate pre-ready Capacitor bridge and import the suspected modules; assert no synchronous error.

### F-RT-1 — Saved-device probes should yield to user interaction

**Required outcome**: while the user is dragging a slider or interacting with a control, saved-device background probes do not run.

**Required changes**:
- In `src/hooks/useSavedDeviceHealthChecks.ts`, before scheduling `runCycle(false)`, check `pollingPauseRegistry.isPaused()` (add that getter if needed). If paused, skip the tick and reschedule.
- `useDeviceBoundSlider` already acquires a pause on first drag tick. Ensure that pause is also visible to the saved-device scheduler.

**Regression tests**:
- Unit: with `pollingPauseRegistry` reporting paused, `useSavedDeviceHealthChecks` does not invoke its run function until the pause is released.
- Pixel 4 smoke: 30 s of slider drag emits 0 saved-device Telnet/REST probes during the drag interval.

### F-MIME-1 — `MimeMap` long monitor contention at cold boot

**Required outcome**: cold-boot does not log `Long monitor contention with owner ... at libcore.content.type.MimeMap` for > 100 ms.

**Required changes**:
- In `MainActivity.onCreate`, prewarm `MimeMap.getDefault()` off the UI thread (a single background `Thread { MimeMap.getDefault().guessMimeTypeFromExtension("html") }.start()` before the bridge initializes).
- Audit the chunk strategy in `vite.config.ts`; if chunks are still > 250 KB gzip, split.

**Regression tests**:
- Android JVM unit test (`android/app/src/test/...`) that asserts `MainActivity` invokes the prewarm helper.
- Pixel 4 smoke: cold-boot logcat (10 trials) shows MimeMap contention < 100 ms in ≥ 9 trials, or 0 contention lines in ≥ 5 trials.

## HIGH-CONFIDENCE HYPOTHESES TO VERIFY

These were identified during Stage 1 but not fully proven. Verify with a targeted reproduction before fixing; if confirmed, fix at the root.

- **H-VOL-1**: rapid mute/unmute/mute on Play page lands an intermediate state when a refetch races a third toggle. Reproduce by issuing 3 mute toggles within 200 ms each while audio is playing on u64; assert terminal device state matches the user's last toggle.
- **H-VOL-2**: `handleVolumeDraftChange` ignores draft updates when `manualMuteSnapshotRef.current` or `target` is missing. Reproduce by muting, then dragging the slider, then unmuting; assert the unmute restores the dragged-to value, not the pre-mute value.
- **H-PLAY-1**: `handleStop` 3 s reset timeout vs Telnet queue contention emits false "Stop failed" toasts. Reproduce by initiating playback, then issuing Stop while Telnet probes are mid-cycle; if observed, increase the timeout *only* once the root contention is fixed, not as a cosmetic mask.
- **H-RT-2**: App pause/resume during cold boot can leave `DISCOVERING` longer than needed. Reproduce by `am start-stop-start` cycles with 200 ms gaps.

## NON-GOALS

- Do **not** raise diagnostic thresholds, downgrade severity labels, or hide degraded states to make the badge look healthy.
- Do **not** weaken existing tests or change golden traces to make new behaviour pass.
- Do **not** disable `CapacitorHttp` globally; the firmware lacks CORS headers. Only narrow CapacitorHttp's side effects (cookies hop).
- Do **not** replace real-device validation with mocks.
- Do **not** refactor any file purely for size; modularization is allowed only as an outcome of a fix.

## HARD CONSTRAINTS

- Coverage gate: `npm run test:coverage` must report ≥ 91 % branch coverage globally after every phase.
- Lint must remain green (`npm run lint`).
- `npm run build` and `npm run cap:build` must succeed.
- Every bug fix gets a dedicated regression test (per repository policy in `CLAUDE.md`).
- Exceptions must never be silently swallowed; rethrow with context or log at warn/error.
- The `feat/reduce-latency-and-fix-errors` branch is the working branch unless the user instructs otherwise. Commits should be small and atomic per finding ID where possible.
- Do not modify `CapacitorHttp.enabled = true` in `capacitor.config.ts` without prior verification that direct WebView fetch now works against u64 + c64u from Pixel 4. (Per the existing comment, this remains load-bearing.)

## REQUIRED PLANS.md WORKFLOW

- Immediately on starting, create `/home/chris/dev/c64/c64commander/docs/research/stabilization/responsiveness2/IMPLEMENTATION_PLANS.md` (or, if the repository convention demands a different path, write it next to existing `PLANS.md` and cross-link from `responsiveness2/`). The implementation plan must:
  - List each finding to be fixed with status `TODO|IN_PROGRESS|BLOCKED|DONE`.
  - Capture per-finding implementation phases (code, tests, validation).
  - Track Pixel 4 deploy results (APK version, `am start -W TotalTime`, screenshots, logcat highlights).
  - Track u64 + c64u validation outcomes per finding where applicable.
  - Be updated continuously, not as a one-time note.
- After creating the plan, begin implementing immediately. Do not pause for confirmation.
- Continue autonomously until all findings are fixed or explicitly BLOCKED with a documented reason and next action.

## IMPLEMENTATION PHASES

Execute in this order; do not skip ahead. Each phase ends with the listed gate.

### Phase 1 — Diagnostics data integrity (highest leverage)

- Implement F-DIAG-1, F-DIAG-2, F-DIAG-3.
- Phase gate:
  - Unit tests for the new behaviour pass.
  - Coverage ≥ 91 %.
  - On Pixel 4, after deploy, soak the Home page for 60 s with both u64 + c64u saved and powered: badge remains HEALTHY for u64.

### Phase 2 — Connection state truthfulness

- Implement F-CONN-1, F-CONN-2, F-CONN-3.
- Phase gate:
  - Unit + integration tests pass.
  - On Pixel 4: cold-launch screenshot taken at +3 s shows non-OFFLINE badge state (Checking or REAL_CONNECTED) and Device/Firmware fields populated within +5 s; warm-restart same metric.

### Phase 3 — Transport overhead and log noise

- Implement F-HTTP-1, F-HTTP-2, F-LOG-1, F-LOG-2.
- Phase gate:
  - Unit tests pass; ESLint rules added.
  - Pixel 4 logcat smoke: 30 s Home idle emits 0 `CapacitorCookies: Getting cookies at: ... 192.168.1.13` lines; 30 s Telnet activity emits 0 `Msg: undefined` lines; cold-boot emits 0 `Uncaught TypeError ... triggerEvent` lines.
  - Cold-boot LED Strip Settings REST call count ≤ 2.

### Phase 4 — Interaction-aware background scheduling and MimeMap

- Implement F-RT-1, F-MIME-1.
- Phase gate:
  - Unit + JVM tests pass.
  - Pixel 4 logcat during 30 s slider/volume stress shows 0 saved-device probes during interaction; cold-boot MimeMap contention < 100 ms (or absent).

### Phase 5 — Hypothesis verification + fix

- Validate H-VOL-1, H-VOL-2, H-PLAY-1, H-RT-2 on real hardware. Fix at root if confirmed.
- Phase gate: per-hypothesis regression test added.

### Phase 6 — Full validation sweep

- `npm run lint`, `npm run test`, `npm run test:coverage` (≥ 91 %), `npm run build`, `npm run cap:build`, `npm run android:apk`, install on Pixel 4.
- Execute the Pixel 4 + u64 + c64u validation matrix below.
- Update `IMPLEMENTATION_PLANS.md` with all evidence paths.

## TESTING AND VALIDATION PHASES

For each finding:
1. **Failing test first**: introduce a Vitest case that reproduces the symptom against the current code. Confirm it fails.
2. **Minimum fix**: apply the smallest code change that turns the test green.
3. **No-regress sweep**: run `npm run test` for the touched layer, then `npm run lint`.
4. **Coverage check**: `npm run test:coverage` after every phase, not only at the end.
5. **Real-device check**: deploy APK to Pixel 4, exercise the touched flow against u64 then c64u, capture evidence.

## ANDROID PIXEL 4 REAL-DEVICE VALIDATION

Required for every phase that touches Android-observable behaviour.

- Confirm `adb devices` shows `9B081FFAZ001WX device`.
- Build: `npm run cap:build && npm run android:apk`.
- Install: `adb -s 9B081FFAZ001WX install -r android/app/build/outputs/apk/debug/c64commander-*-debug.apk` (uninstall first only if upgrade fails).
- Launch and measure cold start: `adb -s 9B081FFAZ001WX shell am force-stop uk.gleissner.c64commander && adb -s 9B081FFAZ001WX shell am start -W -n uk.gleissner.c64commander/.MainActivity`. Record `TotalTime`.
- Capture logcat: `adb -s 9B081FFAZ001WX logcat -d -t 5000 > evidence/logcat-<finding>-<host>.txt`.
- Screenshot Home: `adb -s 9B081FFAZ001WX shell screencap /sdcard/x.png && adb -s 9B081FFAZ001WX pull /sdcard/x.png evidence/<finding>-<host>-home.png`.
- Open Diagnostics dialog and screenshot once per finding.

## U64 AND C64U VALIDATION

Both must be exercised. **Do not** assume one implies the other.

- u64 (192.168.1.13): Ultimate 64 Elite, firmware 3.14e. Higher-spec hardware, faster Telnet responses.
- c64u (192.168.1.167): C64 Ultimate, firmware 1.1.0. Slightly different REST behaviour observed historically (intermittent /v1/info failures noted in prior PLANS); confirm in current run.

Per finding, run the validation flow twice — once with u64 active and c64u saved, once with c64u active and u64 saved. Saved-device cross-contamination findings (F-DIAG-1) MUST be tested in both configurations.

## IOS AND WEB REGRESSION VALIDATION

- For changes in shared TypeScript (most findings are shared code), run the existing Playwright suite: `npm run test:e2e`.
- For iOS, run `xcodebuild`-equivalent steps if available in CI; otherwise rely on source-level review that the change does not depend on Android-only APIs.
- For web, `npm run build:web-platform && npm run test:web-platform` must remain green.

## DIAGNOSTICS ROOT-CAUSE REQUIREMENTS

- Every fix to a diagnostics rule must be accompanied by an in-code comment explaining the chosen policy (e.g. "REST contributor trims from latest success because <reason>").
- Do **not** mute, downgrade, or hide diagnostic states. The fix is always to compute the correct state.

## RESPONSIVENESS ACCEPTANCE CRITERIA

(Reproduced from `RESPONSIVENESS_NOTES.md` for convenience. The full table lives there.)

- Slider draft latency p95 ≤ 16 ms.
- Preview write coalescing ≤ 6 REST writes per 1 s drag.
- Commit settled latency p95 ≤ 250 ms over 10 commits.
- 0 stale-response rollbacks over 30 trials.
- 100 % terminal-state correctness for rapid mute/unmute/mute triples over 10 trials.

## PLAYBACK / VOLUME / MUTE ACCEPTANCE CRITERIA

(Reproduced from `RESPONSIVENESS_NOTES.md` for convenience.)

- Play from cold app: first audible playback within 5 s of pressing Play (local SID).
- Stop reset success rate ≥ 9 / 10.
- Pause/resume round-trip success rate ≥ 9 / 10.
- Volume restore on Stop: no "could not restore" toast over 9 / 10 trials.
- Auto-advance fires within 1 s of duration end, 9 / 10 trials.

## REQUIRED EVIDENCE

Place all evidence under `/home/chris/dev/c64/c64commander/docs/research/stabilization/responsiveness2/evidence/` with the prefix `phase<N>-<finding-id>-<host>-<artifact>` (e.g. `phase1-F-DIAG-1-u64-diagnostics.png`).

Per finding, minimum evidence set:
- Before/after Pixel 4 logcat capture (`-before.txt`, `-after.txt`).
- Before/after Home page screenshot.
- Diagnostics dialog screenshot when relevant.
- Test result summary (Vitest output) for the new regression test.

Per phase, summary entry in `IMPLEMENTATION_PLANS.md` linking to that evidence.

## TERMINATION CRITERIA

Stop only when **all** of the following are true:

1. Every finding above is either `DONE` with linked evidence or `BLOCKED` with a documented reason and a fallback path.
2. `npm run lint`, `npm run test`, `npm run test:coverage` (≥ 91 % branch), `npm run build`, `npm run cap:build`, `npm run android:apk` all pass.
3. The Pixel 4 has the new APK installed and `am start -W` returns `Status: ok` for `uk.gleissner.c64commander/.MainActivity`.
4. The Pixel 4 cold-boot logcat smoke for `Phase 3` and `Phase 4` gates passes.
5. Both u64 and c64u have been validated for each finding that touches a per-device flow.
6. `IMPLEMENTATION_PLANS.md` lists status, evidence, and validation per finding.

## ANTI-SHORTCUT CONSTRAINTS

- No diagnostic suppression as a fix.
- No test deletions to make a change pass.
- No "increase timeout" fixes without an evidenced root cause that the underlying contention is now unavoidable.
- No silent exception catches (`catch (e) {}`, `catch (e) { return null; }` etc.).
- No removal of saved devices or feature flags to dodge cross-contamination — fix the contamination at the data layer.
- No "rebuild the cookie/HTTP layer from scratch" — bounded fixes only, per finding.

## FALLBACK / ESCALATION

- If F-HTTP-1 cannot be fixed (Capacitor plugin doesn't honour the disable in the installed version): document the upstream issue in `capacitor.config.ts`, file an issue link, and add a logcat smoke gate that at least asserts the cookie hop is below a measured baseline.
- If F-LOG-2 root cause cannot be located within a reasonable effort: defer to a `Promise.resolve().then(...)` wrapping of the Capacitor bridge initializer to push the consumer past the synchronous import phase; lock in the fix with a Vitest case.
- If a Pixel 4 hardware issue blocks validation: document the blocker with the exact adb output and continue with the remaining findings.

## CROSS-LINKS

- `WORKLOG.md` — chronological investigation notes, evidence paths.
- `FINDINGS.md` — full per-finding evidence.
- `DIAGNOSTICS_ROOT_CAUSE_MATRIX.md` — diagnostic-cause table.
- `RESPONSIVENESS_NOTES.md` — responsiveness contract and acceptance criteria.
- `FEATURE_INVENTORY.md` — feature audit and per-feature priority.
- Prior context: `../responsiveness/research.md`, `../responsiveness/plan.md`, and the root `PLANS.md` from 2026-05-13.

End of stabilization prompt. Acknowledge by writing `IMPLEMENTATION_PLANS.md` and starting Phase 1.
