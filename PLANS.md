# PLANS - Production Stabilization: Device Health, Diagnostics, HESC Progress, Play Volume (2026-05-13)

## Classification

- Classification: `DOC_PLUS_CODE` and `UI_CHANGE`.
- Scope: diagnostics export analysis, saved-device health/status stability, diagnostics clear isolation, health-check recovery, HESC progress reporting, Play volume/mute responsiveness, stale REST invalidation, and a dedicated playback latency harness.
- Validation target: focused unit/integration coverage first, then repository validation for touched layers, then Android APK deploy/install evidence if the final code path requires device validation.

## Execution Plan

- [completed] Analyze all three exported diagnostics bundles and extract timestamps, device identities, health/connectivity lifecycles, config probe activity, LED-heartbeat evidence, state transitions, clear events, REST failures/retries/cancellations, and playback/volume events.
- [completed] Trace the owning code paths for switch-device health checks, diagnostics clearing, status derivation, shared request infrastructure, HESC progress plumbing, and Play volume/mute control.
- [completed] Implement the smallest safe fixes for the confirmed root causes without broad refactors.
- [completed] Add or update focused regression tests for status stability, foreground/background probe separation, connectivity recovery, HESC progress phases, Play volume target-state behavior, and stale-request invalidation.
- [completed] Add a dedicated playback volume/mute latency test or harness with repeatable metrics/evidence output.
- [completed] Run the smallest honest validation set for touched layers, then full required validation for the final change set, and record exact results.

## Diagnostics Bundles Under Review

- `/home/chris/Downloads/c64commander-diagnostics-all-2026-05-13-0648-08Z`
- `/home/chris/Downloads/c64commander-diagnostics-all-2026-05-13-0658-27Z`
- `/home/chris/Downloads/c64commander-diagnostics-all-2026-05-13-0714-37Z`

## Initial Findings

- Each diagnostics bundle contains `actions`, `error-logs`, `logs`, `supplemental`, and `traces` JSON exports.
- `package.json` already provides the required validation surfaces for this task: `npm run lint`, `npm run test`, `npm run test:coverage`, `npm run build`, Playwright suites, and Android build helpers.
- Prior repository work already touched saved-device health checks, health-check contexts, and switch-device behavior; this stabilization pass must verify whether the current regressions come from remaining shared-state/request-lifecycle defects rather than reintroducing those earlier fixes.

## Diagnostics Conclusions

- Bundle `0648` ended `Degraded` despite recent successful REST and FTP activity because historical TELNET probe failures remained in the contributor window after newer success.
- Bundle `0658` confirmed the same contributor-health defect more clearly: older aborted TELNET failures still dominated exported status even after the last TELNET probe succeeded.
- Bundle `0714` showed the harder app-internal recovery defect: healthy-device probes were failing inside the app with `Device not ready for requests` and later `Failed to fetch`, consistent with system recovery traffic being blocked by the app's own `ERROR` readiness gate.
- Play HVSC progress had a direct code mismatch: `database_insertion` was already treated as ingest/index state in shared preparation logic, but the Play hook still omitted it from visible phase/progress handling.
- Play volume writes had a concrete readback-latency path: preview writes could still trigger reconciliation reads or suppress the final commit readback when a commit matched an in-flight preview.

## Diagnostics Evidence

### Bundle `0648` (`/home/chris/Downloads/c64commander-diagnostics-all-2026-05-13-0648-08Z`)

- Device names seen: `u64`, `c64u`.
- Final snapshot: `state=Degraded`, `connectivity=Online`, `host=192.168.1.13`, `connectedDeviceLabel=u64`.
- Primary exported problem: `Health check TELNET probe failed`, cause hint `Aborted`.
- Last successful transport evidence was newer than the exported degraded status:
  - last REST activity `GET /v1/info` result `200` at `1778654878162`
  - last FTP activity `list /` result `success` at `1778654878232`
  - last TELNET activity `Health check TELNET probe` result `failure` at `1778654858058`
- Connectivity lifecycle evidence:
  - `2026-05-13T06:46:10.957Z` host change to `192.168.1.13`
  - immediate `rest.get /v1/info` failures with `Device not ready for requests`
  - later successful REST and FTP activity without recovery of exported contributor state
- Config probe / LED-heartbeat evidence:
  - early foreground probe activity hit `GET /v1/configs/LED Strip Settings` and related LED config reads
  - no diagnostics `clear` events were exported in this bundle
- Failure classification evidence:
  - repeated `Device not ready for requests`
  - repeated `Health check REST probe failed` warnings tied to readiness blocking
  - final degraded status was still driven by aborted TELNET history rather than current successful REST/FTP evidence

### Bundle `0658` (`/home/chris/Downloads/c64commander-diagnostics-all-2026-05-13-0658-27Z`)

- Device name seen: `u64`.
- Final snapshot: `state=Degraded`, `connectivity=Online`, `host=192.168.1.13`, `connectedDeviceLabel=u64`.
- Primary exported problem remained `Health check TELNET probe failed`, cause hint `Aborted`.
- Exported current evidence contradicted the degraded status:
  - last REST activity `GET /v1/machine:readmem` result `200` at `1778655449749`
  - last FTP activity `list /` result `success` at `1778655446654`
  - last TELNET activity `Health check TELNET probe` result `success` at `1778655450969`
- Connectivity lifecycle evidence:
  - alternating Telnet connections to `192.168.1.13` and `192.168.1.167` during probe activity
  - foreground UI still showed `Connected to u64, system degraded, 4 problems`
- Play / HVSC evidence:
  - `2026-05-13T06:57:26.065Z` `HVSC preparation state transition` `unknown -> NOT_PRESENT`
  - cache-directory warnings were present but unrelated to device status derivation
- Cancellation evidence:
  - `2026-05-13T06:57:29.720Z` and `2026-05-13T06:57:29.953Z` `Telnet request failed` with `error=Aborted`, `actionId=health-check`
- Conclusion supported by this bundle:
  - older aborted TELNET failures continued to dominate contributor state even after newer TELNET success and healthy REST/FTP evidence existed

### Bundle `0714` (`/home/chris/Downloads/c64commander-diagnostics-all-2026-05-13-0714-37Z`)

- Device name seen: `u64` in the exported snapshot, but failing requests targeted `http://192.168.1.167/...`, showing stale/alternate host activity in the failing path.
- Final snapshot: `state=Unhealthy`, `connectivity=Online`, `host=192.168.1.13`, `connectedDeviceLabel=u64`.
- Primary exported problem: `REST health check failed`, cause `REST timed out after 3000ms`.
- Connectivity degradation evidence:
  - `2026-05-13T07:13:46.136Z` first exported `Failed to fetch` / `Host unreachable`
  - repeated `C64 API request failed` entries against `http://192.168.1.167/v1/configs/LED Strip Settings/...`
  - error traces moved through `BUSY` and `ERROR` device states while later requests continued to fail
- This bundle matches the app-internal degradation hypothesis:
  - healthy-device communication ceased inside the app without requiring a device-side failure export
  - failures were consistent with shared readiness/cancellation state blocking recovery probes rather than the device being permanently offline

### Cross-bundle conclusions

- Missing information was repeatedly being interpreted as negative evidence.
- Aborted/superseded TELNET probe history was sticky enough to keep devices degraded after newer success.
- Readiness blocking (`Device not ready for requests`) and stale host activity could poison the system recovery path until app restart.
- No exported diagnostics bundle showed a legitimate reason for `Clear All` to reset live device state, reinforcing the state-separation fix.

## Files Inspected

- `PLANS.md`
- `package.json`
- diagnostics bundles under `/home/chris/Downloads/c64commander-diagnostics-all-2026-05-13-*`
- `src/components/diagnostics/GlobalDiagnosticsOverlay.tsx`
- `src/lib/diagnostics/healthModel.ts`
- `src/hooks/useHealthState.ts`
- `src/lib/diagnostics/healthCheckEngine.ts`
- `src/lib/deviceInteraction/deviceInteractionManager.ts`
- `src/lib/c64api.ts`
- `src/lib/connection/connectionManager.ts`
- `src/pages/playFiles/hooks/useHvscLibrary.ts`
- `src/lib/hvsc/hvscPreparationState.ts`
- `src/pages/playFiles/hooks/useVolumeOverride.ts`
- `src/pages/playFiles/hooks/usePlayFilesVolumeBindings.ts`
- `c64scope/src/playbackVolumeLatency.ts`
- `c64scope/src/playbackVolumeLatencyMetrics.ts`
- `c64scope/tests/playbackVolumeLatency.test.ts`
- `docs/testing/playback-volume-latency.md`
- nearby unit tests for diagnostics, health checks, device interaction, HVSC progress, and Play volume

## Hypotheses In Progress

- Confirmed: FTP/TELNET contributor windows were treating expected cancellation/supersession noise as lasting degradation evidence after newer transport success.
- Confirmed: explicit system recovery probes needed an opt-in lane through the `ERROR` readiness guard so healthy devices can self-heal without app restart.
- Confirmed: Play HVSC progress had a local phase-mapping gap for `database_insertion`.
- Confirmed: Play volume preview/commit handling needed to preserve the final commit readback without adding redundant preview reconciliation traffic.

## Changes Made

- Created this stabilization plan section and made it the active execution record for the current task.
- Stopped Diagnostics Clear All from resetting the shared health snapshot.
- Trimmed FTP/TELNET contributor windows to the latest success and ignored expected cancellation/supersession failures when deriving contributor health and primary problems.
- Added an explicit recovery-probe lane so system REST probes can bypass the poisoned `ERROR` readiness gate when intentionally healing the connection.
- Propagated that recovery-lane intent through `C64API`, diagnostics REST probes, and connection-manager probe paths.
- Mapped HVSC `database_insertion` into visible indexing progress so late-stage ingest progress no longer falls back to the wrong phase.
- Prevented Play volume preview writes from scheduling reconciliation reads, while still forcing a single readback when the final commit matches an in-flight preview.
- Added a dedicated `c64scope` playback-volume latency harness that:
  - uploads and starts a SID on real hardware
  - issues the same `Audio Mixer` REST writes used by Play volume/mute control
  - captures UDP audio from `u64`/`c64u`
  - measures mute latency from audio-stream evidence and falls back to direct device read-back for non-silent volume steps when the stream cannot separate them reliably

## Tests Added Or Updated

- `tests/unit/components/diagnostics/GlobalDiagnosticsOverlay.test.tsx`: verifies Clear All preserves the last known shared health state.
- `tests/unit/lib/diagnostics/healthModel.test.ts`: verifies aborted TELNET failures no longer keep status degraded once newer success exists.
- `tests/unit/lib/deviceInteraction/deviceInteractionManager.test.ts`: verifies explicit system recovery probes can run while the device state is `ERROR`.
- `tests/unit/lib/diagnostics/healthCheckEngine.test.ts`: verifies diagnostic REST probes carry the recovery-lane flag.
- `tests/unit/playFiles/useHvscLibrary.progress.test.tsx`: verifies `database_insertion` is surfaced as indexing progress.
- `tests/unit/playFiles/useVolumeOverride.test.tsx`: verifies preview writes skip reconciliation reads and the final commit still triggers a single readback.
- `c64scope/tests/playbackVolumeLatency.test.ts`: verifies request-to-effect latency extraction and summary statistics for the dedicated playback-volume harness.

## Verification Evidence

- Focused diagnostics/status suites passed: `tests/unit/lib/diagnostics/healthModel.test.ts` and `tests/unit/components/diagnostics/GlobalDiagnosticsOverlay.test.tsx` with `110 passed, 0 failed`.
- Focused recovery suites passed: `tests/unit/lib/deviceInteraction/deviceInteractionManager.test.ts` and `tests/unit/lib/diagnostics/healthCheckEngine.test.ts` with `101 passed, 0 failed`.
- Focused Play/HVSC suites passed: `tests/unit/playFiles/useHvscLibrary.progress.test.tsx`, `tests/unit/playFiles/useVolumeOverride.test.tsx`, and `tests/unit/playFiles/useVolumeOverride.transition.test.tsx` with `41 passed, 0 failed`.
- Dedicated playback latency harness unit test passed: `cd c64scope && npx vitest run tests/playbackVolumeLatency.test.ts`.
- `c64scope` build passed: `cd c64scope && npm run build`.
- Dedicated real-device latency harness passed on `u64`: `npm run scope:hil:playback-volume-latency`.
  - artifact: `c64scope/artifacts/playback-volume-latency/20260513T081615Z-u64/playback-volume-latency-summary.json`
  - summary: `count=10`, `min=0ms`, `median=109ms`, `p90=115ms`, `p95=125ms`, `max=125ms`, `failures=0`, `staleWrites=0`, `cancellations=0`
  - mute transitions were measured from audio-stream evidence (`0-2ms` in this run)
  - non-silent volume transitions were confirmed by direct device read-back because the low-amplitude demo SID did not produce a robust enough stream delta for all steps
- `npm run scope:test:coverage` passed after excluding the hardware-only `c64scope` runner from coverage accounting; final `c64scope` coverage summary reported `lines=96.05%`, `branches=90.70%`, `functions=99.05%`, `statements=96.05%`.
- `npm run lint` passed. Non-blocking warnings remained in generated `c64scope/coverage/*.js` helper files.
- `npm run build` passed.
- Root repository `env -u VITE_DEBUG_DEVICE_SWITCH_SOAK_JSON npm run test:coverage` passed on the clean rerun.
  - merged JSON: `.cov-unit/merged/coverage-final.json`
  - report outputs: `coverage/coverage-final.json`, `coverage/lcov.info`, `coverage/lcov-report/`
  - final summary: `statements=94.09%`, `branches=91.79%`, `functions=90.61%`, `lines=94.09%`
- `./build --skip-tests --install-apk` passed after the final code changes and installed the current debug APK to device `9B081FFAZ001WX`.

## Remaining Risks

- The task spans shared request/state infrastructure plus user-facing UI behavior, so any fix that is too global risks regressions across Home, Play, Diagnostics, and saved-device switching.
- The diagnostics exports may reveal multiple distinct defects rather than one shared root cause; changes must stay narrowly scoped per confirmed path.
- The playback latency harness currently needs direct device read-back fallback for non-silent volume changes on the bundled demo SID; mute transitions are still measured directly from audio-stream evidence.

# PLANS - Android Real-Device Performance Stabilization (2026-05-11)

## Current Phase

- Phase 2: real-device measurement complete, bottlenecks ranked, and a conservative implementation plan is ready.

## Classification

- Classification: `DOC_ONLY` unless narrow measurement-only instrumentation becomes necessary.
- Scope: investigation, real-device measurement attempts, analysis, and a conservative implementation plan for UX responsiveness with Android as the primary target.

## Concrete TODO List

- [completed] Map concrete code paths for diagnostics, device switching, health checks, config I/O, Telnet, and request scheduling.
- [completed] Inventory existing timing, tracing, logging, and metrics surfaces that can support measurement without invasive code changes.
- [completed] Define a measurement strategy covering immediate UI response, remote request timing, reconciliation timing, and failure timing.
- [completed] Attempt Android real-device measurements against `c64u` and `u64`, recording availability and instability.
- [completed] Analyze Diagnostics dialog open cost, device switch latency, Telnet instability boundaries, and queue/backpressure behavior.
- [completed] Produce a staged implementation plan with acceptance criteria, rollback strategy, and verification commands.
- [completed] Produce a concrete regression and verification plan with metric thresholds.
- [completed] Amend the active PR description so it clearly summarizes the performance improvements that actually landed in this branch, separate from investigation-only artifacts.

## Investigation Findings

- The main diagnostics control surface is not a standalone route; it is centered on `GlobalDiagnosticsOverlay` plus `DiagnosticsDialog`, backed by `healthCheckEngine`, trace-session storage, and latency tracking.
- Existing measurement-capable surfaces already present in the repo include:
  - rolling request latency tracking in `src/lib/diagnostics/latencyTracker.ts`
  - trace events with device/platform/lifecycle context in `src/lib/tracing/traceSession.ts`
  - saved-device switch timing metrics in `src/lib/savedDevices/savedDeviceSwitchMetrics.ts`
  - health-check probe timing and progress in `src/lib/diagnostics/healthCheckEngine.ts`
- Device switching is orchestrated in `src/hooks/useSavedDeviceSwitching.ts`, including selection timing, runtime host update, query cancellation, verification, and post-switch invalidation.
- Saved-device parallel health polling is implemented in `src/hooks/useSavedDeviceHealthChecks.ts` on a 10 s interval and can run in visible or background contexts.
- Request pressure and concurrency are actively controlled in `src/lib/deviceInteraction/deviceInteractionManager.ts` via separate REST/FTP/Telnet schedulers, cooldowns, backoff, and circuit-breaker state.
- Real Android measurement separated two different failure classes that had previously been conflated:
  - Android bare-hostname resolution causes multi-second switch verification stalls.
  - `c64u` is currently REST-unhealthy in this lab state even when the network path itself is reachable.
- Direct Pixel 4 transport probes show that `u64` network latency is already low on the target device:
  - REST `/v1/info`: 27-33 ms over 10 samples.
  - Config read `/v1/configs/U64 Specific Settings/CPU Speed`: 31-36 ms over 10 samples.
  - Telnet port connect: 14-24 ms over 5 samples.
- `c64u` currently accepts Telnet TCP connects in 15-22 ms but resets REST `/v1/info` in 17-161 ms, which makes it a device-service availability problem rather than a generic Android network problem.
- Diagnostics open latency could not be measured directly without adding new executable instrumentation. The current evidence is a code-path proxy:
  - `GlobalDiagnosticsOverlay` eagerly rebuilds logs, errors, traces, action summaries, export payloads, and health-history snapshots.
  - `DiagnosticsDialog` eagerly assembles, sorts, filters, and paginates a unified evidence list from logs, traces, and action summaries.
  - `runDiagnosticsReconciler` and `runPlaybackReconciler` are triggered when the overlay opens.

## Measurement Approach

- Prefer existing in-app timing sources over new instrumentation:
  - saved-device switch attempt metrics for selection and verification latency
  - trace-session timestamps for REST/FTP/Telnet request start and completion
  - health-check probe durations for Diagnostics and background maintenance
  - Android `adb logcat` and on-device interaction timing only where app-native traces are insufficient
- Use real Android hardware as primary execution target.
- Probe `http://u64/v1/info` first, then `http://c64u/v1/info`, and continue with `u64` if `c64u` is unavailable or unstable.
- Capture measurements per operation with explicit device hostname attribution and success/failure state.

## Measurement Results

- Saved-device switch soak on the Pixel 4 with bare hostnames (`docs/plans/performance/iteration1/switch-soak-real-android.json`):
  - 10/10 transitions failed.
  - `p50 = 14317 ms`, `p90 = 14397 ms`, `max = 14445 ms`.
  - The slow legs were predominantly `c64u -> u64`, matching Android hostname-resolution failure around `u64`.
- Saved-device switch soak on the Pixel 4 with IP-based saved devices (`docs/plans/performance/iteration1/switch-soak-real-android-ip.json`):
  - `u64` legs recovered to fast-path timings with `p50 = 140 ms`, `p90 = 176 ms`, `max = 226 ms`.
  - The remaining 5 failures were all `u64 -> c64u` offline outcomes, which isolates `c64u` REST unavailability from switch orchestration cost.
- Android-shell transport probes from the same Pixel 4:
  - `u64` REST `/v1/info`: 27-33 ms.
  - `u64` config read: 31-36 ms.
  - `u64` Telnet connect: 14-24 ms.
  - `c64u` REST `/v1/info`: failed with curl exit 56 in 17-161 ms.
  - `c64u` Telnet connect: 15-22 ms.
- Startup baseline artifact (`docs/plans/performance/iteration1/startup-baseline/startup-baseline.json`) reported `TTFSC p50 = 615 ms`, `p95 = 703 ms`, but it was collected from a probe build that auto-launched the device-switch lab. It is useful only as a lower-bound startup sanity check, not as a production baseline.

## Risks

- `c64u` may become unavailable mid-session, especially for REST-backed scenarios, which can obscure app regressions if measurements are not attributed per device and per transport.
- Existing diagnostics timing surfaces are stronger for network and switch timing than for immediate local UI response, so any direct Diagnostics-open timing should be introduced only as a single narrow marker, not as broad new tracing.
- The startup artifact gathered in this session is contaminated by the probe build and must not be used as the post-fix acceptance baseline.

## Candidate Fix Directions

- Ranked bottlenecks:
  1. Android bare-hostname resolution in saved-device switching and verification.
  2. Foreground switch/diagnostics work competing with background saved-device health polling and reconciliation.
  3. Diagnostics overlay eager data assembly/render work.
  4. `c64u` REST instability in the lab environment.
  5. Telnet transport itself is not currently a measured bottleneck.
- Stage 1: eliminate Android hostname stalls without redesign.
  - Prefer a verified IP or last-known-good resolved host for Android saved-device verification before retrying the raw bare hostname.
  - Surface a narrow Android-only warning when a saved device uses a bare hostname and no verified IP is available.
  - Acceptance target: on real Android, healthy-device switch verification `p50 < 250 ms`, `p95 < 500 ms`, and no 14 s hostname stalls.
- Stage 2: reduce foreground/background interference.
  - Suspend or defer background saved-device health cycles while a foreground device switch verification is active.
  - Avoid starting extra reconciliation work on Diagnostics open until the initial visible surface is mounted.
  - Acceptance target: no overlapping health cycle should extend a measured switch leg beyond the direct transport envelope by more than a small constant factor.
- Stage 3: make Diagnostics pay for work only when the user asks for it.
  - Snapshot logs/traces/history on open.
  - Lazily derive action summaries and evidence lists only while the overlay is open.
  - Keep the initial visible activity page small and defer deeper derivation to explicit expansion or pagination.
  - Acceptance target: after adding one narrow open-to-first-visible marker, Diagnostics open `p50 < 250 ms`, `p95 < 400 ms` on the Pixel 4 with representative trace volume.
- Stage 4: treat `c64u` hardware instability as a separate validation axis.
  - Do not broaden transport or scheduler refactors until the app still misses targets against a healthy `u64` after Stages 1-3.

## Explicit Non-Goals

- No broad refactors.
- No architectural redesign.
- No speculative cleanup or abstraction changes.
- No change that increases request pressure on real hardware.
- No change that weakens diagnostics fidelity or swallows errors.

## Open Questions

- Which minimal persisted host-resolution hint is least invasive for Android saved devices: last-known-good IP, last-resolved IP, or Android-only canonical host replacement.
- Whether background saved-device health polling should pause only during switch verification or also while Diagnostics is open.
- Whether Diagnostics needs a one-line timing marker in production code, or whether Playwright/adb observation is sufficient after lazy derivation lands.

# PLANS - Device Switch Health, Config Pulse, Warning Dedup, README Coverage (2026-05-11)

## Classification

- Classification: `DOC_PLUS_CODE` and `UI_CHANGE`.
- Scope: switch-device health polling/pulse policy, warning noise from health/config fallback/readiness gates, device-switch handoff responsiveness/readiness isolation, README Home screenshot references, and focused regression tests.
- Validation target: focused Vitest slices first, then `npm run lint`, `npm run test:coverage`, `npm run build`, Android APK build/deploy to Pixel 4, and hardware/HIL evidence where reachable.

## Initial Investigation Checklist

- [x] Read `README.md`, `.github/copilot-instructions.md`, and `docs/ux-guidelines.md`.
- [x] Inspect existing `PLANS.md` and `WORKLOG.md` before editing.
- [x] Inspect README Home screenshot references and `docs/img/app/home/**`.
- [x] Inspect Switch Device bottom sheet in `src/components/UnifiedHealthBadge.tsx`.
- [x] Inspect saved-device health polling lifecycle in `src/hooks/useSavedDeviceHealthChecks.ts`.
- [x] Inspect health-check service/API in `src/lib/diagnostics/healthCheckEngine.ts`.
- [x] Locate `"Skipped: passive mode disables CONFIG pulse"` source in health-check target mode handling.
- [x] Locate `"Device not ready for requests"` guard in `src/lib/deviceInteraction/deviceInteractionManager.ts`.
- [x] Inspect device readiness model in `src/lib/deviceInteraction/deviceStateStore.ts`.
- [x] Inspect device-switch cancellation/query invalidation in `src/hooks/useSavedDeviceSwitching.ts` and `src/lib/query/c64QueryInvalidation.ts`.
- [x] Inspect category/config fallback fan-out in `src/lib/c64api.ts`.
- [x] Inspect existing tests for saved-device health, switching, health checks, c64api config fallback, and README screenshot layout.

## Verified Findings

- README Home currently references `docs/img/app/home/00-overview-light.png` as `Home overview (Light)`, but that file is the C64 Commander intro/logo screen.
- The actual light top Home screenshot already exists at `docs/img/app/home/sections/01-system-info-to-cpu-ram.png`; dark top is `docs/img/app/home/01-overview-dark.png`.
- Switch Device UI lives in `src/components/UnifiedHealthBadge.tsx`; it opens on long press/context menu and calls `refreshAll()` once when opened.
- `useSavedDeviceHealthChecks` also runs when the picker is closed because `UnifiedHealthBadge` passes `enabled=canSwitchDevices`; it currently always calls `runHealthCheckForTarget(..., { mode: "passive" })`.
- `runHealthCheckForTarget` supports only `mode: "full" | "passive"`, and passive mode skips CONFIG with reason `Skipped: passive mode disables CONFIG pulse`.
- The CONFIG pulse is the only health subprobe that writes via `setConfigValue`; REST/JIFFY/RASTER/FTP/TELNET are read/connect probes.
- The readiness guard is `shouldBlockForState` in `deviceInteractionManager.ts`; it blocks non-allowed REST calls while state is `UNKNOWN`, `DISCOVERING`, or `ERROR` with message `"Device not ready for requests"`.
- `deviceStateStore.ts` uses one global selected-device readiness model; switching hosts can leave state in `DISCOVERING`/`BUSY` until connection/request transitions settle.
- `useSavedDeviceSwitching` selects the target immediately, updates runtime host, waits for `verifyCurrentConnectionTarget`, then invalidates and refetches active route queries; heavy config reads can therefore start during the handoff.
- `C64API.getConfigItems` logs `"Category config fetch failed; falling back to item fetches"` and fans out per-item fetches for every requested item after most category failures, including deterministic readiness gate failures.

## Working Fix Direction

1. Replace/augment fragile health-check `mode` with explicit health-check context:
   - `switch-device-dialog`: visible CONFIG pulse allowed.
   - `background-maintenance`: read-only only.
   - `manual-diagnostics`: visible CONFIG pulse allowed for the existing diagnostics health check behavior.
2. Pass picker-open context into `useSavedDeviceHealthChecks`; closed/cold polling stays read-only, open picker polling uses switch-device dialog context.
3. Keep last-known per-device health result visible while a new cycle is pending; do not collapse pending/cancelled checks to offline.
4. Make switch selection close the sheet promptly after the target runtime host is applied; defer route query invalidation/refetch until verification settles so Home can become interactive quickly.
5. Reset interaction guard state on saved-device switch so stale backoff/circuit/busy state does not poison the target generation.
6. Stop deterministic item-fallback fan-out when category fetch failed with `"Device not ready for requests"`; keep fallback for HTTP/server/partial category failures where item reads can still succeed.
7. Add README screenshot validation coverage for intro, light top, dark top, and full Home page section coverage.

## Termination Criteria

- README Home table references intro, light top, dark top, and sections `01` through `05`, and all referenced files exist.
- Switch-device dialog health checks can run CONFIG pulse; closed/background saved-device checks cannot.
- Duplicate passive/config-pulse warnings are not emitted for one device/cycle, and expected switch cancellation is not promoted to warning spam.
- Device switch handoff is generation-safe enough for the UI to close promptly and leave quick actions enabled from last-known/active connection state while verification continues.
- Config fallback does not create a burst of deterministic `"Device not ready for requests"` item failures.
- Focused regression tests pass, coverage remains >= 91% branch, and HIL/deploy evidence is recorded in `WORKLOG.md`.

## Completion Status

- Implemented README screenshot coverage, explicit health-check contexts, switch-dialog pulse policy, background read-only health checks, switch handoff responsiveness changes, readiness-gated config fallback suppression, and expected-cancellation health-model filtering.
- Added focused regression coverage for README references, switch-dialog/background CONFIG pulse policy, warning/cancellation handling, device-switch handoff, readiness guard behavior, saved-device query cancellation, config fallback suppression, and health-model cancellation classification.
- TODO: stabilize the `c64u` TELNET health probe against intermittent empty-read/banner timing, and preserve TELNET/FTP/REST transport calls as contributor-filterable Diagnostics evidence so failed calls remain visible in the Diagnostics filter.
- Steering follow-up completed: the TELNET health probe now emits `telnet-operation` Diagnostics traces on success/failure, TELNET trace titles are transport-specific, contributor filtering finds TELNET traces in Diagnostics, and the probe now tolerates the slower `c64u` empty-read/banner timing budget.
- Validation completed:
  - focused Vitest regression slice passed.
  - focused TELNET diagnostics regressions passed.
  - `npm run lint` passed after Prettier-only cleanup of two test files.
  - `npm run test:coverage` passed with global branch coverage `91.86%`.
  - `npm run build` passed.
  - current steering pass: `npm run lint` passed.
  - current steering pass: `env -u VITE_DEBUG_DEVICE_SWITCH_SOAK_JSON npm run test:coverage` passed with global branch coverage `91.84%` after clearing a stale soak env that incorrectly auto-routed `App` into the switch lab.
  - current steering pass: `npm run build` passed.
  - current steering pass: `npm run cap:build` and `npm run android:apk` passed, then Pixel 4 `9B081FFAZ001WX` was reinstalled with `c64commander-0.7.9-rc1-debug.apk` and relaunched to the Home screen.
  - targeted Switch Device screenshot refresh passed.
  - `npm run cap:build` passed.
  - `npm run android:apk` passed.
- Pixel 4 deploy completed after uninstalling the newer installed package that blocked the debug APK as a version downgrade.
- Pixel 4 HIL switch timing evidence:
  - `c64u -> u64` sheet closed in `1147 ms`.
  - `u64 -> c64u` sheet closed in `1314 ms`.
  - Home route remained visible and Reset/Reboot quick actions were not disabled after each switch.
- Residual HIL blocker: the local `c64u` host pings but resets `/v1/info`, so a clean two-healthy-device REST proof and physical visible-pulse observation were not completed in this session. Details are recorded in `WORKLOG.md`.

# PLANS - Saved-Device Health Regression Fix (2026-05-10)

## Classification

- Classification: `CODE_CHANGE`.
- Scope: saved-device switcher health handoff and closed-switcher passive polling only.

## Verified Findings

- `src/hooks/useSavedDeviceHealthChecks.ts` still calls `runHealthCheckForTarget(..., { mode: "full" })` for always-on multi-device polling.
- `src/lib/diagnostics/healthCheckEngine.ts` already supports `mode: "passive"` and skips the CONFIG pulse without calling `setConfigValue` in that mode.
- `src/hooks/useSavedDeviceSwitching.ts` calls `selectSavedDevice(deviceId)` before verification resolves.
- `src/components/UnifiedHealthBadge.tsx` derives switcher row selection directly from `savedDevices.selectedDeviceId`, so an in-flight switch immediately reclassifies the tapped row as selected while verification is still pending.
- `src/hooks/useHealthState.ts` still reads an unkeyed global `healthCheckState.latestResult`; only touch this if the narrower switcher-row fix proves insufficient.

## Working Fix Direction

1. Change automatic saved-device polling to passive mode so closed-switcher checks stay read-only.
2. Keep the switcher row rendering anchored to the pre-switch selected device until the in-flight switch settles, so pending verification does not collapse row state into `Offline` during the handoff.
3. Add focused regressions for passive polling, retained last-known row state during reruns/superseded cycles, and the open-switcher selection handoff.

## Implemented Changes

- Updated `src/hooks/useSavedDeviceHealthChecks.ts` to call `runHealthCheckForTarget(..., { mode: "passive" })` and documented why the always-on poller must stay read-only.
- Updated `src/components/UnifiedHealthBadge.tsx` to keep switcher row selection anchored to the pre-switch device while a switch is still in flight, and to force the tapped target row into `Verifying` instead of letting runtime status collapse it to `Offline` mid-handoff.
- Updated focused regressions in `tests/unit/hooks/useSavedDeviceHealthChecks.test.tsx`, `tests/unit/lib/diagnostics/healthCheckEngine.test.ts`, and `tests/unit/components/UnifiedHealthBadge.test.tsx`.

## Focused Validation Status

- Passed: targeted unit tests for `useSavedDeviceHealthChecks`, `healthCheckEngine`, and `UnifiedHealthBadge`.

## Repository Validation Status

- `npm run lint`: failed for unrelated pre-existing formatting drift in `src/hooks/useAppConfigState.ts`, `src/lib/diagnostics/healthCheckEngine.ts`, `src/pages/HomePage.tsx`, `tests/unit/hooks/useAppConfigState.test.tsx`, and `tests/unit/pages/HomePage.test.tsx`.
- `npm run test`: passed.
- `npm run test:coverage`: passed. Coverage summary: statements `94.22%`, branches `91.84%`, functions `90.50%`, lines `94.22%`.
- `npm run build`: passed.

## Android Deploy Status

- `npm run cap:build && npm run android:apk`: passed.
- Installed `android/app/build/outputs/apk/debug/c64commander-0.7.9-rc1-debug.apk` to Pixel 4 `9B081FFAZ001WX` with `adb install -r`: passed.
- Relaunched `uk.gleissner.c64commander` and confirmed `topResumedActivity=uk.gleissner.c64commander/.MainActivity`.
- On-device evidence captured under `.tmp/android-check/`:
  - `pixel4-unlocked.png`: app foregrounded on Home.
  - `pixel4-switcher-attempt.png`: switcher opens from a long press on the top-right badge.
  - `pixel4-switch-tap-1.png` / `pixel4-switch-tap-2.png` / `pixel4-switch-tap-3.png`: tap on the non-selected device keeps the old row marked `Selected` while the tapped row shows `Verifying`.
- Hardware blocker for a stronger device-side proof: both saved devices were already in an offline last-known state, and direct probes to `http://u64/v1/info` and `http://c64u/v1/info` both failed with `Recv failure: Connection reset by peer`. That prevents a discriminating live healthy-vs-offline handoff proof on this hardware state.

## Validation Target

- Focused unit tests for `useSavedDeviceHealthChecks`, `healthCheckEngine`, and `UnifiedHealthBadge` immediately after the first edit.
- Then run: `npm run lint`, `npm run test`, `npm run test:coverage`, and `npm run build`.
- Attempt latest APK deploy to the attached Pixel 4 before completion, or record the concrete blocker.

# PLANS - Diagnostics And Coverage Fixes (2026-05-10)

## Classification

- Classification: `CODE_CHANGE`.
- Scope: targeted fixes only for Telnet health checks, saved-device editing, switch-device passive polling, inline-warning deduplication, Home config revert result reporting, and Android JaCoCo coverage generation.

## Execution Order

1. Reproduce and map the current code paths for each reported bug.
2. Inspect `vivipi/scripts/u64_connection_test.py` and `vivipi/scripts/u64_telnet.py` to derive the exact Telnet probe semantics.
3. Inspect `/home/chris/Downloads/c64commander-diagnostics-all-2026-05-10-1802-27Z` and record only verified findings.
4. Update the Telnet health-check path to match ViViPi semantics without changing interactive Telnet behavior.
5. Separate saved-device name fallback display logic from editable draft state.
6. Ensure switch-device bottom-sheet polling includes the config check and does not emit duplicate inline warnings.
7. Improve Home config revert result classification and post-reset verification messaging.
8. Repair Android Tests + Coverage so JaCoCo XML exists at the Codecov upload path.
9. Add focused regression tests for each fixed slice.
10. Run targeted validation, then repository-required coverage validation, then Android coverage generation verification.
11. Attempt APK deploy to the attached Pixel 4 unless blocked by environment/hardware.

## Initial Verified Findings

- The raw diagnostics bundle exists and contains `actions`, `error-logs`, `logs`, `supplemental`, and `traces` JSON exports.
- `vivipi/scripts/u64_connection_test.py` delegates Telnet probing to `vivipi/scripts/u64_telnet.py`.
- `vivipi/scripts/u64_telnet.py` uses a direct TCP connect via `socket.create_connection((host, port), timeout=2)`, sets a short idle read timeout, optionally authenticates only when a password prompt is observed, and otherwise treats connection/open-session behavior as the probe basis.
- Likely C64 Commander anchors are:
  - Telnet health-check engine: `src/lib/diagnostics/healthCheckEngine.ts`
  - Native Android Telnet boundary: `android/app/src/main/java/uk/gleissner/c64commander/TelnetSocketPlugin.kt`
  - Saved-device editor state: `src/lib/savedDevices/deviceEditor.ts`
  - Saved-device display fallback: `src/lib/savedDevices/store.ts`
  - Switch-device polling hooks: `src/hooks/useSavedDeviceHealthChecks.tsx`, `src/hooks/useSavedDeviceSwitching.tsx`
  - Home revert flow: `src/pages/HomePage.tsx`, `src/lib/config/configWriteThrottle.ts`
  - Android coverage workflow/config: `.github/workflows/android.yaml`, `android/app/build.gradle`, `scripts/verify-coverage-artifacts.mjs`

## Working Hypotheses

- Telnet health-check failures are caused by C64 Commander using a stricter health-check action than ViViPi, likely waiting for a full Telnet interaction or using a mismatched timeout path rather than a successful TCP open / minimal prompt probe.
- The edit-connection name field bug is caused by the editable input being derived from a persisted display fallback instead of a raw draft state.
- Switch-device passive polling is reusing a passive health-check mode intended for low-impact background checks, and that mode is suppressing config checks while also surfacing duplicate warnings from both parent and child sources.
- Home revert currently treats `Connection reset` as a generic failure, even when the device may apply the config and reset the socket before acknowledgment; verification needs to classify that outcome explicitly.
- Android coverage CI is failing because the expected JaCoCo XML is not being generated at, or verified before upload from, `android/app/build/reports/jacoco/jacocoTestReport/jacocoTestReport.xml`.

## Focused Validation Plan

- After the first substantive Telnet edit, run the narrowest Telnet probe unit tests before widening scope.
- After each additional slice, run the nearest tests for that slice before moving on.
- Final validation must include TypeScript checks, relevant Vitest slices, `npm run test:coverage`, Android unit/coverage generation, and an existence check for the JaCoCo XML report.

## Completion Conditions

- All five reported bugs are fixed with focused regression coverage.
- `PLANS.md` and `WORKLOG.md` accurately reflect the work.
- The diagnostics findings used for decisions are explicitly recorded.
- The Android coverage XML is generated where Codecov expects it, or the workflow is updated to the real generated path with local proof.
- Any hardware-dependent behavior not verified locally is explicitly called out.

# PLANS - Production-Readiness Test Architecture

## Current Objective

Create a repository-specific production-readiness test architecture and implement the highest-value missing tests proving that C64 Commander stays stable, responsive, connected, and device-safe under repeated realistic user pressure.

Mandatory deliverables:

- `PLANS.md` as the authoritative execution log.
- `docs/testing/test-architecture.md` as the status quo test landscape and release-readiness architecture.
- Implemented and executed tests for request pacing/burst protection, repeated slider pressure, repeated checkbox pressure, recovery/partial connectivity, and discovery/demo correctness where feasible.

## Constraints

- No commits.
- Preserve unrelated/concurrent worktree changes.
- Follow `.github/copilot-instructions.md`, then `AGENTS.md`, then the task prompt.
- Classification: `DOC_PLUS_CODE`.
- For code changes, run `npm run test:coverage` before completion and keep global branch coverage >= 91%.
- Do not disable tests, weaken assertions, add arbitrary sleeps, or hide failures.
- Extend existing runners; do not create overlapping harnesses.
- Do not overload real C64U hardware from CI-safe tests.
- Web Playwright, Android emulator, and physical Android + C64U evidence remain distinct.
- Before completion, attempt latest APK deploy to attached Pixel 4 or document adb/hardware blocker.

## Repository Facts Discovered

- Read `README.md`, `.github/copilot-instructions.md`, `docs/ux-guidelines.md`, and all mandatory testing docs named in the prompt.
- `package.json` confirms key commands: `npm run test`, `npm run test:coverage`, `npm run test:e2e`, `npm run test:e2e:ci`, `npm run fuzz`, `npm run android:apk`, `npm run maestro:gating`, startup gates, and `scope:*`.
- `playwright.config.ts` confirms E2E runs Vite preview with `VITE_ENABLE_TEST_PROBES=1`; project names emulate Android phone/tablet but remain web-only.
- Test roots:
  - `tests/unit` and `src/**/*.test.*`: Vitest unit/integration.
  - `playwright`: web E2E, screenshots, fuzz, traces, evidence.
  - `tests/contract`: REST/FTP/Telnet contract, SAFE/STRESS, matrix, breakpoint, replay.
  - `.maestro`: native UI smoke/edge flows.
  - `android/app/src/test`: Android JVM tests.
  - `tests/android-emulator`: ADB/emulator specs.
- Contract breakpoint support already exists under `tests/contract/lib/breakpoint*.ts` and `tests/contract/scenarios/rest/breakpointSidVolume.ts`.
- Production request-safety primitives already exist:
  - `src/hooks/useDeviceBoundSlider.ts`
  - `src/hooks/useInteractiveConfigWrite.ts`
  - `src/lib/deviceInteraction/latestIntentWriteLane.ts`
  - `src/lib/config/configWriteThrottle.ts`
- `useAppConfigState` had a production recovery bug: its snapshot effect depended on `isSnapshotLoading`, so setting loading could clean up the active capture and prevent retry/recovery after transient config failure.
- Unit/integration: `npm run test`, targeted `npx vitest run <files>`, no hardware.
- Contract: `npx tsc -p tests/contract/tsconfig.json`, then `node tests/contract/dist/run.js --config ...`; real C64U for SAFE/STRESS.
- Playwright E2E: `npm run test:e2e` or targeted `npx playwright test`; web Vite preview only.
- Structured interaction soak: no separate runner; correct CI-safe location is Playwright. Added `playwright/structuredInteractionSoak.spec.ts`.
- Performance/startup: `test:perf*`, `startup:baseline`, `startup:gate`, `startup:gate:hvsc`.
- Maestro/native: `.maestro`, `scripts/run-maestro-gating.sh`, build helper `--test-maestro-*`.
- Android JVM/instrumentation: `cd android && ./gradlew testDebugUnitTest jacocoTestReport`; connected tests through `./build --android-tests`.
- Physical HIL: physical-device matrix and agentic docs; app-first with droidmind/c64scope/c64bridge roles.

## Gap Analysis

- Home CPU Speed slider had low-level coalescing code but no release-blocking repeated-pressure test.
- Checkbox/config writes were serialized but only covered by small tests, not sustained toggle-style bursts and final-state convergence.
- Partial config recovery tests did not prove a failed full snapshot could recover after reconnect.
- Discovery tests existed but needed the slow-success-before-deadline boundary.

## Designed And Implemented Tests

1. `configWriteThrottle spaces a sustained checkbox-style burst and preserves the final intended state`
   - Layer/location: Vitest, `tests/unit/configWriteThrottle.test.ts`.
   - Covers: repeated checkbox-like writes, serialization, pacing, final-state convergence.
2. `LatestIntentWriteLane settles a sustained slider-like burst with first write plus final intent only`
   - Layer/location: Vitest, `tests/unit/lib/deviceInteraction/latestIntentWriteLane.test.ts`.
   - Covers: rapid slider commits, bounded in-flight, final intent wins.
   - Safety: no network, deterministic promise gate.
3. `useDeviceBoundSlider keeps local response immediate and bounds throttled preview requests during a sustained drag`
   - Layer/location: Vitest, `tests/unit/hooks/useDeviceBoundSlider.test.ts`.
   - Covers: 100 drag updates, immediate local display, bounded preview writes, final commit.
   - Safety: no network, fake timers.
   - Safety: mocked API.
4. `connectionManager waits for a slow successful startup probe inside the deadline instead of entering demo`
   - Layer/location: Vitest, `tests/unit/connection/connectionManager.startup.test.ts`.
   - Covers: slow real device prevents premature demo fallback.
   - Safety: mocked fetch, fake timers.
5. `Home CPU slider and checkbox pressure remains responsive, connected, and request-bounded`
   - Layer/location: Playwright web structured soak, `playwright/structuredInteractionSoak.spec.ts`.

## Implementation Plan

- [x] Read mandatory docs and inspect actual repo infrastructure.
- [x] Record test design before coding.
- [x] Create `docs/testing/test-architecture.md`.
- [x] Implement CI-safe low-level pacing/coalescing tests.
- [x] Implement deterministic repeated slider structured soak coverage.
- [x] Implement deterministic repeated checkbox structured soak coverage.
- [x] Implement partial config recovery coverage.
- [x] Implement discovery/demo timing boundary coverage.

## Commands And Results

- Result: passed, 1 test, 36.8s.
- Artifacts: standard Playwright output under `test-results/playwright` and `playwright-report`.
- `npm run lint`
  - Task-owned files needing formatting: `playwright/structuredInteractionSoak.spec.ts`, `tests/unit/connection/connectionManager.startup.test.ts`, and `docs/testing/test-architecture.md`.
- `npx prettier --write playwright/structuredInteractionSoak.spec.ts tests/unit/connection/connectionManager.startup.test.ts docs/testing/test-architecture.md`
- `npm run lint`
- `npx prettier --write src/lib/diagnostics/healthCheckEngine.ts src/pages/home/components/HomeCpuSpeedSlider.tsx tests/unit/maestro/maestroFlowContracts.test.ts`
  - Result: passed; mechanical formatting only to unblock repository-wide validation.
  - Final result: passed.
  - Included Prettier check, ESLint, display-profile breakpoint guard, variant output check, and feature-flag registry check.
- `npm run test:coverage`
  - Result: passed.
  - Final coverage: statements 94.27%, branches 91.91%, functions 90.44%, lines 94.27%.
  - Branch coverage satisfies the repository's >=91% gate.
- `npm run cap:build`
  - Result: passed.
  - Purpose: production web build plus Capacitor asset sync before APK assembly.
  - Notes: Vite reported existing browser-externalization/dynamic-import chunk warnings; Capacitor iOS sync reported missing CocoaPods/xcodebuild on this Linux host. Command exited 0.
- `npm run android:apk`
  - Result: passed.
  - Purpose: assemble a current debug APK after Capacitor sync.
  - Runtime: Gradle reported `BUILD SUCCESSFUL in 43s`.
- `find android/app/build/outputs/apk -type f -name '*.apk' ...`
  - Result: newest APK is `android/app/build/outputs/apk/debug/c64commander-0.7.9-rc1-debug.apk`.
- `adb devices`
  - Result: preferred Pixel 4 attached as `9B081FFAZ001WX`.
- `curl -sS --max-time 3 http://u64/v1/info`
  - Result: passed; selected `u64`, product `Ultimate 64 Elite`, firmware `3.14e`, no reported errors.
- `curl -sS --max-time 3 http://c64u/v1/info`
  - Result: timed out after 3002ms; not selected.
- `adb -s 9B081FFAZ001WX install -r android/app/build/outputs/apk/debug/c64commander-0.7.9-rc1-debug.apk`
  - Result: passed, `Success`; uninstall/retry was not needed.
- `adb -s 9B081FFAZ001WX shell monkey -p uk.gleissner.c64commander 1`
  - Result: launched the app.
- `adb -s 9B081FFAZ001WX shell dumpsys window ...`
  - Result: `uk.gleissner.c64commander/.MainActivity` foregrounded after dismissing the notification/lock shade.
- `adb ... screencap`
  - Result: captured evidence under `test-results/android-device/`:
    - `pixel4-home-after-launch.png`
    - `pixel4-home-top-after-recovery.png`
    - `pixel4-home-top-20s-later.png`
    - `pixel4-config-after-health-mismatch.png`
- `adb -s 9B081FFAZ001WX logcat -d -t 1000 ... > test-results/android-device/pixel4-logcat-health.txt`
  - Result: captured 168 filtered log lines.
  - Evidence: repeated native `GET http://192.168.1.13/v1/info`, config/RAM REST calls, and `Capacitor: Host unreachable` entries while the UI showed `U64 UNHEALTHY`.
- `curl -v --max-time 5 http://c64u/v1/info`
  - Continuation result: passed; `c64u` resolved to `192.168.1.167`, product `C64 Ultimate`, firmware `1.1.0`, no reported errors.
- `adb -s 9B081FFAZ001WX shell pm clear uk.gleissner.c64commander && adb -s 9B081FFAZ001WX shell monkey -p uk.gleissner.c64commander 1`
  - Result: passed; reset the app to the default `c64u` saved device and relaunched.
- `adb ... screencap/logcat`
  - Result: captured `test-results/android-device/pixel4-c64u-after-clear-launch.png` and `pixel4-c64u-after-clear-launch-logcat.txt`.
  - Evidence: native `CapacitorHttp` requests to `http://c64u/...` and Telnet connections to `c64u:23`; UI still showed `C64U UNHEALTHY`, proving the prior blocker on the requested host.
- `npx vitest run tests/unit/lib/diagnostics/healthModel.test.ts tests/unit/lib/c64api.test.ts tests/unit/c64api.branches.test.ts`
  - Result: passed, 3 files, 178 tests, 3.24s.
  - Purpose: regression coverage for expected optional metadata misses not poisoning health and missing categories not creating item-probe storms.
- `npx vitest run tests/unit/lib/diagnostics/healthModel.test.ts`
  - Continuation result: passed, 87 tests, 1.57s.
  - Purpose: regression coverage for ignoring pre-connection REST/app gating failures after recovery.
- `PATH="/home/chris/.maestro/bin:$PATH" MAESTRO_DRIVER_STARTUP_TIMEOUT=60000 scripts/run-maestro.sh --mode tags --tags +cpu-slider --device-id 9B081FFAZ001WX --apk-path android/app/build/outputs/apk/debug/c64commander-0.7.9-rc1-debug.apk --output-dir test-results/maestro/pixel4-c64u-cpu-slider-smoke --c64u-target real --c64u-host c64u`
  - Result: failed before execution because the wrapper's default `slow`/`edge` exclusions filtered the `cpu-slider` flow.
  - Follow-up: direct flow execution used after smoke config was written.
- `maestro test --udid 9B081FFAZ001WX ... .maestro/edge-home-cpu-speed-latency.yaml`
  - Result: failed; evidence showed the CPU Speed slider is disabled/non-movable on the required `c64u` firmware, with `aria-disabled="true"` and only a single visible CPU Speed value. This is a hardware/firmware capability blocker for CPU-specific HIL on this target, not a passing CPU soak.
- `node scripts/run-pixel4-c64u-soak.mjs`
  - Result: partial execution only.
  - Verified before hardware loss: Pixel 4 launched against `c64u`, host `/v1/info` initially passed, app reported `C64U HEALTHY`, Home CPU Speed was recorded as firmware-blocked/single-option, and the LED-intensity slider key-driven path reached the checkbox phase.
  - Failure: the first coordinate/DOM-click checkbox attempts did not complete, and subsequent host probes showed `c64u` became unreachable at the network layer before a complete PASS run could be produced.
  - Artifacts: `test-results/android-device/pixel4-c64u-soak-results.json`, `pixel4-c64u-after-host-timeout.png`, `pixel4-c64u-soak-failed*.png`.
- `for i in $(seq 1 12); do curl --max-time 5 http://c64u/v1/info; sleep 10; done`
  - Result: failed all 12 low-rate probes. `c64u` resolved to `192.168.1.167`, but connect failed with "Couldn't connect to server".
- `ping -c 3 -W 2 c64u`
  - Result: failed; `Destination Host Unreachable`.
- `ip neigh show 192.168.1.167`
  - Result: `FAILED`; ARP could not resolve the C64U.
- `npx vitest run tests/unit/lib/diagnostics/healthModel.test.ts tests/unit/lib/c64api.test.ts tests/unit/c64api.branches.test.ts tests/unit/hooks/useAppConfigState.test.tsx tests/unit/hooks/useDeviceBoundSlider.test.ts tests/unit/lib/deviceInteraction/latestIntentWriteLane.test.ts tests/unit/configWriteThrottle.test.ts tests/unit/connection/connectionManager.startup.test.ts tests/unit/pages/home/components/homeCpuSpeedSliderProbe.test.ts`
  - Result: passed, 9 files, 222 tests, 6.07s.
- `npm run lint`
  - Result: passed after applying Prettier to five dirty TypeScript/TSX files.
- `node scripts/compile-feature-flags.mjs`
  - Result: regenerated `src/lib/config/featureFlagsRegistry.generated.ts` after the feature flag registry check found it out of date.
- `npm run lint`
  - Final result: passed.
- `PLAYWRIGHT_DEVICES=phone npx playwright test playwright/structuredInteractionSoak.spec.ts --project=android-phone`
  - Result: passed, 1 test, 41.0s.
- `npm run test:coverage`
  - Result: interrupted by the execution environment after 36/37 coverage shards completed; no final summary was produced by that invocation.
- Manual completion of the missing coverage shard using the repository harness arguments, then `npx nyc merge` and `npx nyc report`
  - Result: passed. Coverage summary: statements 94.27%, branches 91.89%, functions 90.45%, lines 94.27%.
- Final `curl -sS --max-time 5 http://c64u/v1/info && ip neigh show 192.168.1.167`
  - Result: failed; `c64u` still unreachable and ARP remained `FAILED`.

## Blockers

- Required real C64U host `c64u` is currently offline/unreachable. Verified failures: `curl http://c64u/v1/info`, `ping c64u`, and ARP for `192.168.1.167`.
- The requested Home CPU Speed HIL slider cannot be exercised on the required `c64u` firmware because the app exposes it as a disabled/single-option control on that target.
- A complete Pixel 4 + `c64u` button/checkbox/slider soak PASS artifact was not produced before the target became unreachable.
- Physical A/V HIL was not executed; no c64scope evidence was collected.
- Contract STRESS/breakpoint tests were not run against `c64u` after it became unreachable.

## Remaining Risks

- Playwright web success does not prove native Android WebView, `CapacitorHttp`, LAN DNS/routing, background/foreground lifecycle, or real C64U safety.
- Contract STRESS/breakpoint harness exists but was not run against hardware in this phase.
- Partial connectivity UI semantics beyond hook-level recovery still need a Playwright degraded mock scenario and deeper HIL diagnostics.
- `scripts/run-pixel4-c64u-soak.mjs` is implemented for the required HIL path, but its full PASS run is blocked until `c64u` is reachable again.
- Existing unrelated worktree changes may still affect full lint/build/coverage results.

## Release Readiness Classification

- Classification target: `READY`.
- Current classification is `BLOCKED BY HARDWARE`.
- `READY` cannot be claimed while the required host `c64u` is unreachable and the complete Pixel 4 + real C64U soak has not passed.
- User continuation requirement: complete the work, not merely document blockers. Real-device proof must use the attached Pixel 4 speaking to the real C64U available as hostname `c64u`.
- Prior blocker to resolve: current APK on Pixel 4 rendered config data from `u64` but health stayed `U64 UNHEALTHY`.
- Additional blockers to clear or explicitly run: physical Android repeated interaction soak, health online proof, relevant CI-safe regression tests, and release readiness reclassification to `READY`.
- Continuation finding: after clearing Pixel 4 app data, the app selected `c64u` and native logcat showed `CapacitorHttp` requests to `http://c64u/...` plus Telnet connections to `c64u:23`, but the badge still showed `C64U UNHEALTHY`.
- Continuation root cause: tolerated optional config metadata misses from Home startup were recorded as diagnostics REST/app failures, causing a false unhealthy badge even though the device was reachable and config-backed UI populated.
- Continuation fix: mark expected missing optional config metadata requests as expected trace failures, exclude expected failures from health rollup, and stop probing per-item metadata when the whole config category returns HTTP 404.
- Continuation second finding: after that fix, the badge still counted stale startup `Device not ready for requests` traces that occurred before the first successful REST response.
- Continuation second fix: REST health now evaluates the current window from the first successful REST response onward, and App health ignores pre-connection request-gating errors after recovery.
- Continuation HIL result: Pixel 4 did show `C64U HEALTHY` against `c64u` after the health fixes, with screenshot evidence in `test-results/android-device/pixel4-c64u-healthy-after-fix.png`.
- Continuation HIL blocker: `c64u` later became unreachable at the network layer, preventing a complete physical soak PASS and preventing a truthful `READY` classification.

## Final Completion Checklist

- [x] `PLANS.md` reflects current executed work.
- [x] `docs/testing/test-architecture.md` exists and is repo-specific.
- [x] Architecture distinguishes Playwright web, fuzz, contract, Maestro, Android runtime, and physical HIL roles.
- [x] Device-safety and REST burst-protection testing is documented and implemented.
- [x] At least one deterministic structured interaction soak test exists.
- [x] Repeated slider, repeated checkbox, partial config recovery, and discovery/demo gaps are covered where feasible.
- [x] Exact targeted commands/results are recorded.
- [x] Broad validation commands/results are recorded.
- [x] APK deploy/install/launch result is recorded.
- [x] Release-readiness classification is recorded.
- [ ] Complete Pixel 4 + `c64u` repeated slider/checkbox/button HIL soak passes.
- [ ] `c64u` is reachable and online at final classification time.
- [ ] Physical HIL/c64scope evidence exists for A/V-sensitive release blockers.
- [x] No unnecessary runners or overlapping test categories were added.
- [x] No broad unrelated refactors were made.
- [x] No commits were made.

---

# PLANS — Telnet-dependent feature gating (parallel task)

> This section tracks the Telnet feature-gating work and is intentionally appended below
> the production-readiness section above. The two tasks share the worktree; per
> `CLAUDE.md`, concurrent changes are preserved.

## Current Objective

Hide non-essential, user-facing Telnet-dependent functionality behind explicit feature flags so the app feels stable by default. Health check and diagnostics remain exempt because they help users detect instability.

## Final shape

Feature flags added/renamed (all `enabled: false`, `visible_to_user: true`, `developer_only: false`, `group: experimental`):

- `home_telnet_config_actions_enabled` (renamed from `home_advanced_config_actions_enabled`).
- `home_telnet_drive_actions_enabled` (drive cards Telnet footer).
- `home_telnet_printer_actions_enabled` (printer card Telnet footer).
- `home_telnet_power_cycle_enabled` (Power Cycle quick action).
- `home_telnet_clear_ram_reboot_enabled` (Reboot (Clr Mem) quick action).

Code-shape changes follow-up (this iteration):

- `Reboot (Clr Mem)` is **Telnet-only**. The slow REST fallback was removed.
- `deviceControl.rebootFull`, `deviceControl.powerCycle`, `describePowerCycleFallback`, the `REST_FALLBACK_FULL_REBOOT` transport, the `POWER_CYCLE_FALLBACK_ENDPOINTS` constant, and the `clearRamAndRebootImpl` injection point have all been removed from `src/lib/deviceControl/deviceControl.ts` since they are now unused.
- The Quick Actions overflow dropdown (`home-machine-overflow-*`) was removed from `MachineControls`. Extras now render inline as standard quick action cards. The prop is renamed `overflowActions` → `extraActions`.
- HomePage gates `Reboot (Clr Mem)` on `home_telnet_clear_ram_reboot_enabled && telnet.isAvailable && support === "supported"`, mirroring how Power Cycle is gated.

## Telnet-dependent surfaces gated

1. Power Cycle quick action.
2. Reboot (Clr Mem) quick action (Telnet-only — no REST fallback).
3. Drive cards Telnet footer.
4. Printer card Telnet footer.
5. Config grid `Save (file)`, `Load (file)`, `Clear Flash`.

## Surfaces deliberately not gated

- Reboot (REST-only) and other essential machine controls.
- DiagnosticsDialog Telnet activity rows / health-check probes.
- Settings Telnet port input.

## Verification

- `node scripts/compile-feature-flags.mjs --check` ✓
- `node scripts/generate-variant.mjs --check` ✓
- `npx prettier --write` on touched files ✓
- `npx vitest run tests/unit/featureFlags.test.ts tests/unit/pages/HomePage.test.tsx tests/unit/pages/HomePage.ramActions.test.tsx tests/unit/pages/SettingsPage.test.tsx tests/unit/pages/home/components/MachineControls.test.tsx tests/unit/lib/deviceControl/deviceControl.test.ts` — 125/125 passed.
- `npx vitest run tests/unit/pages/home/useHomeActions.test.tsx tests/unit/ramOperations.test.ts` — 26/26 passed (no impact from `clearRamAndReboot` removal in deviceControl).
- `npx tsc -p tsconfig.app.json --noEmit` shows only pre-existing errors (unchanged before vs after these edits).

## Open Questions / Risks

- Reboot (Clr Mem) is now Telnet-only. If Telnet is offline or the device is uncapable, the action is hidden and the user must rely on the standard `Reboot` (REST keep-RAM) action.
- `deviceControl.powerCycle` and `deviceControl.rebootFull` removal also drops the unused `clearRamAndRebootImpl` dependency injection. `clearRamAndReboot` itself remains exported from `@/lib/machine/ramOperations` (still used by `useHomeActions`).

# PLANS - Iteration 3: Restore E2E Android pipeline (2026-05-21)

## Objective

Restore the broken E2E Android test pipeline by fixing the regression introduced in `6dc4813d (Implement AUTO device safety mode)` that crashes `npx playwright test --list` with `TypeError: Cannot read properties of undefined (reading 'VITE_DEBUG_SAVED_DEVICES_JSON')` at `src/lib/savedDevices/store.ts:350`.

## Constraints

- Minimal, scoped fix that does not regress any of the 6516 existing unit tests.
- Preserve the existing AUTO device safety mode behavior on Android, iOS, and web.
- Preserve the existing `VITE_DEBUG_SAVED_DEVICES_JSON` bootstrap behavior for dev/test builds.
- Add a regression test that fails before the fix and passes after it.

## Investigation Checklist

- [completed] Read the original crash trace and identify the throwing line.
- [completed] Trace the eager module-init call chain that drags `savedDevices/store` into Node-side TypeScript loaders: `playwright spec -> playFilesUtils -> playbackRouter -> c64api -> deviceInteractionManager (module init: loadDeviceSafetyConfig) -> deviceSafetySettings -> store`.
- [completed] Find the safe `import.meta.env` access pattern already used elsewhere (`src/lib/fuzz/fuzzMode.ts`).
- [completed] Verify with `npx tsx -e ...` that the unsafe access reproduces the exact error message and that the new safe access does not.

## Prioritized Bug Hypotheses

1. `createDebugBootstrapDevices()` accesses `import.meta.env.VITE_DEBUG_SAVED_DEVICES_JSON` without guarding for `import.meta.env` being undefined. Confirmed root cause.

## Execution Phases

- [completed] Phase 1 - Baseline: ran `npm run test` (6516/6516 pass) before any code change.
- [completed] Phase 2 - Investigation: traced eager module-init chain and confirmed root cause via `tsx` reproduction.
- [completed] Phase 3 - Fix: replaced direct `import.meta.env.X` access with a defensive `readDebugSavedDevicesEnv()` helper that probes `import.meta` and `import.meta.env` before reading the variable.
- [completed] Phase 4 - Regression coverage: added two tests in `tests/unit/lib/savedDevices/store.test.ts` (functional smoke + source-contract).
- [completed] Phase 5 - Cross-platform sanity: type-check passes; lint passes; prettier passes.
- [completed] Phase 6 - Final verification: full unit-test suite re-run (see Status).

## Acceptance Criteria

- The `npx playwright test --list --project=android-phone` invocation no longer crashes at module init (verified locally via `tsx` reproduction).
- All 6516 existing unit tests continue to pass.
- A regression test asserts the safe `typeof import.meta` guard remains in place.
- A functional test asserts the store loads with no debug-bootstrap env set.

## Current Status

- Fix applied to `src/lib/savedDevices/store.ts`.
- Two new tests added in `tests/unit/lib/savedDevices/store.test.ts`.
- All 20 store tests pass; all 487 tests in the related directories pass.

## Task List

- [x] Reproduce the crash mode with `tsx` (which, like ts-node/esbuild, does not inject `import.meta.env`).
- [x] Add safe `readDebugSavedDevicesEnv` helper.
- [x] Add regression test for the safe pattern.
- [x] Add functional test that proves no crash with missing env.
- [x] Re-run full unit-test suite.
