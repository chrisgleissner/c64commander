# C64 Commander Prod Hardening 8 Research

## Executive Summary
- Build deployed: yes, `android/app/build/outputs/apk/debug/c64commander-0.8.6-rc1-debug.apk`.
- Pixel 4 usable: yes.
- U64 app workflows conclusive: partial; Home, stream start/stop, volume slider, Settings refresh, diagnostics overlay were exercised.
- C64U app workflows conclusive: no; saved-device switching to c64u failed, then c64u degraded.
- Device switching conclusive: yes, failed.
- Playback conclusive: no for app playlist playback; yes for direct c64scope U64 SID playback/volume capture.
- Disk workflow conclusive: no; deterministic fixture import was blocked by automation/file-picker failures.
- Config mutation conclusive: partial; U64 volume/audio mixer mutation and restore completed, broader Config route mutation was not widened after higher-severity failures.
- Diagnostics export conclusive: yes, failed as deterministic export evidence because Share all opened Android chooser only.
- Slider/back-off audit conclusive: partial; U64 app slider and c64scope volume capture passed, c64u slider audit was unsafe after degradation.
- Reconnect/discovery audit conclusive: yes, failed for U64 Settings refresh busy-state gating.
- c64scope capture run: yes, direct U64 playback-volume capture.
- C64U degraded: yes.
- App remained responsive: yes for Pixel/U64; no for C64U control.
- Product findings: 4.
- Safety findings: 2.
- Testability findings: 5.
- Environment blockers: 0.
- Overall verdict: fail.

Verdict reason: PH8-002 is a P0 C64U degradation event, and PH8-001/PH8-003/PH8-006 are P1 production-readiness failures in device switching, identity reporting, and reconnect/discovery gating.

## Prior Evidence Reviewed
Prod-hardening-7 files reviewed: `FINDINGS.md`, `COVERAGE.md`, `DEVICE-LIVENESS.md`, `RAW-OBSERVATIONS.md`, and `ARTIFACTS.md`. The prior run proved build/install/basic liveness only. It did not conclusively exercise saved-device switching, playback, disk mount/eject, config mutation, stream start/stop, slider pacing, reconnect/discovery back-off, deterministic diagnostics export, c64scope capture, or Maestro.

Prod-hardening-8 targeted those exact gaps instead of repeating route smoke coverage.

## Environment
- Repo: `/home/chris/dev/c64/c64commander`.
- Branch: `fix/stabilization`.
- Commit: `95ec058878ff72771912c7828cf22712b5c67fdb`.
- Package manager: npm; lockfiles include `package-lock.json` and `bun.lockb`, but repo scripts use npm.
- Node: `v24.11.0`; npm: `11.6.1`.
- App package: `uk.gleissner.c64commander`.
- App version: `0.8.6-rc1`, versionCode `1988`.
- Pixel: Pixel 4, serial `9B081FFAZ001WX`, Android 16/API 36.
- APK: `android/app/build/outputs/apk/debug/c64commander-0.8.6-rc1-debug.apk`.
- U64 baseline: `u64` and `192.168.1.13` HTTP 200, Ultimate 64 Elite firmware `3.14e`, unique id `38C1BA`.
- C64U baseline: `c64u` and `192.168.1.167` HTTP 200, C64 Ultimate firmware `1.1.0`, unique id `5D4E12`.
- Main artifact index: `docs/research/stabilization/prod-hardening-8/artifacts/artifact-index.txt`.

## Execution Plan Summary
`PLANS.md` classified repository edits as `DOC_ONLY` but required hardware-in-the-loop execution by prompt. The run preserved product code, created prod-hardening-8 artifacts only under the target directory, preferred U64 for higher-risk workflows, and stopped C64U interaction after degradation.

## Device Profile Setup
Initial app state had one saved profile only: `c64u`, selected, with no saved U64 profile. Evidence: `artifacts/logs/cdp-initial-state-20260605T235806.json`.

A test-owned U64 profile was created through the Settings UI using host `192.168.1.13`. After `Save & Connect`, Home showed `U64 HEALTHY`, Device `Ultimate-64-Elite-F83C87`, Firmware `3.14e`. Evidence: `artifacts/logs/profile-setup-u64-20260605T235851.json`, `artifacts/screenshots/profile-home-u64-after-save-1780700351321.png`.

Profile-management issues were confirmed: the non-selected c64u row displayed `U64E · c64u`, and saved-device health summaries retained stale offline/unavailable values after successful U64 connection.

## Build and Deployment
Command:

```bash
./build --skip-install --skip-tests --skip-format --install-apk --device-id 9B081FFAZ001WX
```

Result: exit 0. The app built, installed by streamed install, and launched. Evidence: `artifacts/logs/build-deploy-20260605T235623.txt`, `artifacts/logs/build-deploy-summary-20260605T235623.txt`.

Startup showed `C64U HEALTHY` while Device/Firmware remained `Not available` after the settle window. Evidence: `artifacts/screenshots/startup-20260605T235655.png`, `artifacts/screenshots/startup-settled-20260605T235725.png`.

## Device Liveness Chronology
| Time | Target | Result | Evidence |
| --- | --- | --- | --- |
| 2026-06-05T23:55:48+01:00 | u64 / 192.168.1.13 | HTTP 200 | `artifacts/logs/baseline-liveness-20260605T235548.txt` |
| 2026-06-05T23:55:48+01:00 | c64u / 192.168.1.167 | HTTP 200 | `artifacts/logs/baseline-liveness-20260605T235548.txt` |
| 2026-06-06T00:02:30+01:00 | u64 and c64u | HTTP 200 after switch loop | `artifacts/logs/post-switch-liveness-20260606T000230.txt` |
| 2026-06-06T00:12:37+01:00 | c64u | connection reset, HTTP 000 | `artifacts/logs/c64u-lowfreq-reprobe-20260606T001237.txt` |
| 2026-06-06T00:13:08+01:00 | 192.168.1.167 | connection reset, HTTP 000 | `artifacts/logs/c64u-ip-lowfreq-reprobe-20260606T001308.txt` |
| 2026-06-06T00:14:56+01:00 | u64 | HTTP 200, 0.026s | `artifacts/logs/final-liveness-20260606T001456.txt` |

## Workflow Evidence Matrix
| Workflow | Device | Attempted | Result | Evidence | Finding IDs |
| --- | --- | --- | --- | --- | --- |
| Build/install/launch | Pixel 4 | yes | pass | `build-deploy-20260605T235623.txt` | none |
| Startup identity | c64u profile | yes | fail | `startup-settled-20260605T235725.png` | PH8-003 |
| U64 profile creation | U64 | yes | pass with stale summary issue | `profile-setup-u64-20260605T235851.json` | PH8-004, PH8-005 |
| Saved-device switching | U64/c64u | yes | fail | `device-switch-cdp-rows-20260606T000127.ndjson` | PH8-001, PH8-004 |
| C64U conservative workflows | c64u | yes | fail/unsafe | switch logs and degradation probes | PH8-001, PH8-002 |
| U64 Home | U64 | yes | pass | `u64-home-before-bounded-1780701069573.png` | none |
| U64 stream start/stop | U64 | yes | pass | `u64-bounded-workflows-20260606T001103.ndjson` | none |
| U64 volume slider | U64 | yes | pass | `u64-volume-after-restore-1780701086762.png` | none |
| U64 Settings refresh | U64 | yes | fail | `u64-bounded-workflows-20260606T001103.ndjson` | PH8-006 |
| App playlist playback | U64 | yes | blocked | Maestro logs | PH8-009 |
| Disk mount/eject | U64 | yes | blocked | Maestro/file-picker logs | PH8-009 |
| Diagnostics export | U64/Pixel | yes | fail | `diagnostics-share-after-click-1780701101961.png` | PH8-007 |
| c64scope capture | U64 | yes | pass direct capture; CLI gap | c64scope logs | PH8-010 |
| Logcat capture | Pixel | yes | fail | `logcat-run-20260605T235600.txt` | PH8-011 |

## C64U Safety and Degradation Analysis
C64U was healthy at baseline and after the saved-device switch loop. The app, however, could not select c64u successfully: it reported Offline/Not connected while direct `/v1/info` was still HTTP 200. Later, low-frequency c64u probes by hostname and IP both returned immediate connection resets.

No further c64u mutation, slider, reconnect, playback, disk, stream, or config workflow was attempted after degradation. This is classified as a P0 safety finding because production readiness cannot accept a run where the fragile target degrades after app-driven switching attempts, even though the exact causal mechanism still needs root-cause work.

## Slider and Back-Off Analysis
U64 app volume slider was exercised with five 500 ms changes and five 200 ms changes. UI labels followed requested values and were restored to `0 dB`. Evidence: `artifacts/logs/u64-bounded-workflows-20260606T001103.ndjson`.

c64scope direct U64 playback-volume capture ran 10 volume/mute operations with p95 132 ms, 0 failures, 0 stale writes, and 0 cancellations. Evidence: `artifacts/c64scope/playback-volume-latency-20260606T001333/playback-volume-latency-summary.json`.

C64U slider/back-off audit was unsafe after degradation.

## Reconnect and Discovery Analysis
The U64 Settings `Refresh connection` button was not disabled 100 ms after the first click, and a second click was accepted about 300 ms after the first. Evidence: `artifacts/logs/u64-bounded-workflows-20260606T001103.ndjson`.

Expected: repeated manual discovery/reconnect actions are visibly gated or coalesced while one operation is in flight.

Actual: the UI accepted overlapping refresh intent. This is a safety/back-off concern because the same control pattern would be dangerous on c64u.

## Diagnostics Export Analysis
Diagnostics overlay opened and displayed U64 context. `Share all` was available under the overflow menu, but clicking it opened Android's chooser rather than writing to a deterministic artifact destination. Evidence: `artifacts/screenshots/diagnostics-share-after-click-1780701101961.png`, `artifacts/screenshots/post-u64-bounded-focus-20260606T001155.png`.

This blocks deterministic incident evidence collection in HIL runs and should be fixed with a test-owned export destination or a native bridge path usable by automation.

## c64scope and Agentic Test Analysis
Direct c64scope U64 playback-volume capture passed using `node dist/playbackVolumeLatency.js --host u64 --artifact-dir ...`. The npm script wrapper failed because nested argument passing converted flags to positional args. Evidence: `artifacts/logs/c64scope-playback-volume-latency-20260606T001322.txt`, `artifacts/logs/c64scope-playback-volume-latency-direct-20260606T001333.txt`.

The broader `hil:evidence` path was not run because source inspection showed a hardcoded artifact root under `c64scope/artifacts`, outside the prompt's allowed prod-hardening-8 artifact directory.

Maestro was evaluated without app reset. The runner path could not select the slow tagged playback proof because default exclude tags overrode the include tag. Direct Maestro avoided app reset but failed in DocumentsUI due brittle selector/remembered picker state. Evidence: `artifacts/logs/maestro-local-binary-playback-20260606T000318.txt`, `artifacts/logs/maestro-direct-local-binary-playback-20260606T000342.txt`.

## Findings

### PH8-002: C64U degraded after app-driven device-switch investigation
- Category: SAFETY-BUG.
- Severity: P0.
- Status: confirmed.
- Affected device: Commodore 64 Ultimate, `c64u` / `192.168.1.167`.
- Route/workflow: saved-device switching and subsequent liveness.
- Preconditions: c64u baseline `/v1/info` HTTP 200; c64u direct liveness still HTTP 200 after switch loop.
- Reproduction steps: baseline c64u liveness; create/select U64; switch U64 -> c64u -> U64 -> c64u -> U64; later perform low-frequency c64u `/v1/info` reprobes.
- Expected result: c64u remains reachable or app backs off and preserves target health.
- Actual result: both hostname and IP returned immediate connection reset.
- Frequency: 2/2 final low-frequency probes.
- First observed: 2026-06-06T00:12:37+01:00.
- Last observed: 2026-06-06T00:13:08+01:00.
- Evidence paths: `artifacts/logs/baseline-liveness-20260605T235548.txt`, `artifacts/logs/post-switch-liveness-20260606T000230.txt`, `artifacts/logs/c64u-lowfreq-reprobe-20260606T001237.txt`, `artifacts/logs/c64u-ip-lowfreq-reprobe-20260606T001308.txt`.
- Screenshot paths: switch screenshots under `artifacts/screenshots/switch-c64u-*`.
- Log paths: same as evidence; scoped logcat was empty.
- Diagnostics references: c64u app diagnostics could not be used after switch failure/degradation.
- Safety/back-off relevance: high; fragile target became unreachable.
- Whether testing continued: yes, only against Pixel/U64.
- Suspected area: saved-device switch health probing, discovery retry/pacing, C64U target handling.
- Recommendation: root-cause switch/discovery request pattern and add C64U-safe back-off/circuit-breaker evidence.

### PH8-001: Saved-device switcher cannot switch to reachable c64u
- Category: PRODUCT-BUG.
- Severity: P1.
- Status: confirmed.
- Affected device: c64u.
- Route/workflow: unified health badge saved-device switcher, Home.
- Preconditions: saved c64u and U64 profiles exist; c64u direct `/v1/info` reachable.
- Reproduction steps: open switcher; select c64u; wait; observe app status; compare direct `/v1/info`.
- Expected result: app selects c64u and shows product/firmware/healthy state.
- Actual result: app selected c64u but showed Offline/Not connected while direct c64u liveness returned HTTP 200.
- Frequency: 2/2 c64u selections.
- First observed: 2026-06-06T00:01:27+01:00.
- Last observed: 2026-06-06T00:02:30+01:00.
- Evidence paths: `artifacts/logs/device-switch-cdp-rows-20260606T000127.ndjson`, `artifacts/logs/post-switch-liveness-20260606T000230.txt`.
- Screenshot paths: `artifacts/screenshots/switch-c64u-1-after-1780700496708.png`, `artifacts/screenshots/switch-c64u-2-after-1780700521035.png`.
- Log paths: switch and liveness logs above.
- Diagnostics references: saved-device summaries in switch log.
- Safety/back-off relevance: high; forces repeated switching/probing attempts.
- Whether testing continued: yes, on U64 only after C64U degradation.
- Suspected area: `useSavedDevices`, `useSavedDeviceHealthChecks`, connection discovery state transition after profile switch.
- Recommendation: reproduce with IP-backed c64u profile and verify selected profile, runtime host, health summary, and connection base URL remain coherent.

### PH8-003: App reports Healthy while Device/Firmware are Not available
- Category: PRODUCT-BUG.
- Severity: P1.
- Status: confirmed.
- Affected device: c64u startup profile.
- Route/workflow: Home startup identity.
- Preconditions: app launched with persisted c64u profile.
- Reproduction steps: deploy/launch; wait startup settle; inspect Home.
- Expected result: Healthy state includes reliable product/firmware identity, or identity unknown is reflected as degraded/pending.
- Actual result: badge showed `C64U HEALTHY`; Device and Firmware remained `Not available` after settle.
- Frequency: 2/2 startup screenshots.
- First observed: 2026-06-05T23:56:55+01:00.
- Last observed: 2026-06-05T23:57:25+01:00.
- Evidence paths: `artifacts/screenshots/startup-20260605T235655.png`, `artifacts/screenshots/startup-settled-20260605T235725.png`, `artifacts/logs/cdp-initial-state-20260605T235806.json`.
- Safety/back-off relevance: medium; users cannot trust target identity for hardware control.
- Suspected area: health rollup versus device info enrichment.
- Recommendation: make identity availability part of connection readiness or display a pending/mismatch state.

### PH8-006: Settings Refresh connection accepts overlapping manual discovery clicks
- Category: SAFETY-BUG.
- Severity: P1.
- Status: confirmed.
- Affected device: U64; applies more critically to C64U.
- Route/workflow: Settings connection refresh/reconnect.
- Preconditions: U64 connected and Settings visible.
- Reproduction steps: click Refresh connection; check disabled state after 100 ms; click again around 300 ms.
- Expected result: second click is gated, coalesced, or visibly disabled while discovery is in flight.
- Actual result: button remained enabled and second click was accepted.
- Frequency: 1/1.
- First observed: 2026-06-06T00:11:30+01:00.
- Last observed: 2026-06-06T00:11:30+01:00.
- Evidence paths: `artifacts/logs/u64-bounded-workflows-20260606T001103.ndjson`.
- Screenshot paths: `artifacts/screenshots/u64-settings-before-refresh-1780701089526.png`, `artifacts/screenshots/u64-settings-after-refresh-1780701094453.png`.
- Safety/back-off relevance: high; repeated discovery can become a request storm on fragile c64u.
- Suspected area: `SettingsPage` refresh button state and `discoverConnection` in-flight governance.
- Recommendation: add shared in-flight state/cooldown for manual discovery and regression test double-click gating.

### PH8-004: Saved-device switcher/status summaries are contradictory or stale
- Category: PRODUCT-BUG.
- Severity: P2.
- Status: confirmed.
- Affected device: U64 and c64u.
- Route/workflow: switcher and Settings saved-device list.
- Preconditions: two saved profiles exist.
- Reproduction steps: open switcher; observe row states before/after probes; switch profiles.
- Expected result: selected row summary, online/healthy badges, and persisted health summary agree.
- Actual result: U64 row showed `Offline selection` alongside online/healthy indicators; final U64 summary recorded `Mismatch` while Home showed Healthy.
- Frequency: multiple observations in one switching loop.
- First observed: 2026-06-06T00:00:01+01:00.
- Last observed: 2026-06-06T00:01:27+01:00.
- Evidence paths: `artifacts/logs/device-switch-cdp-20260606T000001.json`, `artifacts/logs/device-switch-cdp-rows-20260606T000127.ndjson`.
- Screenshot paths: `artifacts/screenshots/switcher-open-1780700405972.png`.
- Safety/back-off relevance: medium; misleading health state encourages unsafe retries.
- Suspected area: saved-device health summary reconciliation.
- Recommendation: unify row rendering with current probe outcome and selected runtime state.

### PH8-005: Non-selected saved-device product label uses current device product
- Category: PRODUCT-BUG.
- Severity: P2.
- Status: confirmed.
- Affected device: saved profiles.
- Route/workflow: Settings saved devices.
- Preconditions: c64u saved profile lacks per-device product summary; U64 is selected.
- Reproduction steps: select U64; open Settings saved devices.
- Expected result: c64u row remains `c64u` or shows verified C64U identity only.
- Actual result: c64u row displayed `U64E · c64u`.
- Frequency: repeated in Settings screenshots.
- First observed: 2026-06-05T23:59:03+01:00.
- Last observed: 2026-06-06T00:14:43+01:00.
- Evidence paths: `artifacts/logs/profile-setup-u64-20260605T235851.json`, `artifacts/logs/final-app-navigation-force-20260606T001435.ndjson`.
- Screenshot paths: `artifacts/screenshots/profile-settings-u64-after-save-1780700343924.png`, `artifacts/screenshots/final-settings-force-1780701282478.png`.
- Safety/back-off relevance: medium; wrong hardware identity can lead to unsafe target assumptions.
- Suspected area: saved-device display fallback to current connected product.
- Recommendation: never use current target product as display metadata for another saved profile.

### PH8-007: Diagnostics export has no deterministic automation destination
- Category: TESTABILITY-GAP.
- Severity: P2.
- Status: confirmed.
- Affected device: Pixel 4 app.
- Route/workflow: diagnostics overlay export.
- Preconditions: U64 selected and diagnostics overlay open.
- Reproduction steps: open diagnostics; open overflow; click Share all.
- Expected result: export can be completed to a known test-owned path or native artifact destination.
- Actual result: Android chooser opened; no deterministic destination was provided by the app.
- Frequency: 1/1.
- First observed: 2026-06-06T00:11:39+01:00.
- Last observed: 2026-06-06T00:11:55+01:00.
- Evidence paths: `artifacts/logs/u64-bounded-workflows-20260606T001103.ndjson`.
- Screenshot paths: `artifacts/screenshots/diagnostics-share-after-click-1780701101961.png`, `artifacts/screenshots/post-u64-bounded-focus-20260606T001155.png`.
- Safety/back-off relevance: medium; incident investigation depends on reliable diagnostics capture.
- Suspected area: `diagnosticsExport`, native share/export bridge.
- Recommendation: add deterministic test export path while keeping user share behavior.

### PH8-008: Maestro runner tag selection prevents safe playback proof
- Category: TESTABILITY-GAP.
- Severity: P2.
- Status: confirmed.
- Affected device: Pixel 4 automation.
- Route/workflow: Maestro local binary playback proof.
- Preconditions: fixtures staged; app state preserved using `--skip-app-reset`.
- Reproduction steps: run `scripts/run-maestro.sh --mode tags --tags +android-regression-proof --skip-app-reset`.
- Expected result: requested flow runs or runner exposes an override for slow tagged HIL flows.
- Actual result: runner exited because default exclude tag `slow` filtered out the included flow.
- Frequency: 1/1.
- Evidence paths: `artifacts/logs/maestro-local-binary-playback-20260606T000318.txt`.
- Recommendation: allow explicit include tags or single-flow mode to override default slow exclusion.

### PH8-009: Local playback/disk fixture flow is brittle in Android DocumentsUI
- Category: TESTABILITY-GAP.
- Severity: P2.
- Status: confirmed.
- Affected device: Pixel 4 automation.
- Route/workflow: Play local source, disk fixture add/mount.
- Preconditions: fixtures staged under `/sdcard/Download/C64LocalSource`.
- Reproduction steps: run direct Maestro `local-binary-playback-proof.yaml` without app reset.
- Expected result: flow selects staged local source and adds media fixtures.
- Actual result: flow failed on toolbar assertion while picker opened in remembered `C64Music` folder; manual continue attempts did not complete.
- Frequency: 1/1.
- Evidence paths: `artifacts/logs/maestro-direct-local-binary-playback-20260606T000342.txt`, `artifacts/logs/manual-picker-continue-20260606T000523.txt`, `artifacts/maestro/direct-local-binary-playback/`.
- Screenshot paths: `artifacts/screenshots/manual-picker-after-use-20260606T000523.png`.
- Recommendation: make source selection deterministic on Android 16 and avoid reliance on remembered DocumentsUI state.

### PH8-010: c64scope HIL scripts are not artifact-root safe for scoped research runs
- Category: TESTABILITY-GAP.
- Severity: P2.
- Status: confirmed.
- Affected workflow: c64scope HIL capture.
- Preconditions: prompt requires all prod-hardening-8 artifacts under the target directory.
- Reproduction steps: inspect/run c64scope commands.
- Expected result: all HIL commands accept an artifact root and CLI arguments pass cleanly through npm scripts.
- Actual result: `hil:evidence` hardcodes `c64scope/artifacts`; npm wrapper for playback-volume-latency mispassed flags.
- Frequency: source inspection plus 1/1 failed wrapper run.
- Evidence paths: `artifacts/logs/c64scope-playback-volume-latency-20260606T001322.txt`.
- Recommendation: add artifact-root env/flag to all HIL commands and fix npm argument forwarding.

### PH8-011: Scoped logcat capture produced no app logs
- Category: TESTABILITY-GAP.
- Severity: P2.
- Status: confirmed.
- Affected workflow: Android runtime evidence capture.
- Preconditions: scoped run logcat was started before build/deploy.
- Expected result: logcat artifact contains app runtime logs, crashes, warnings, or at least startup activity.
- Actual result: `logcat-run-20260605T235600.txt` had 0 lines.
- Evidence paths: `artifacts/logs/logcat-run-20260605T235600.txt`, `artifacts/logs/logcat-run-tail-20260606T001457.txt`.
- Recommendation: fix logcat capture command/filter and include verification that it is collecting lines during HIL runs.

## Non-Findings and Rejected Suspicions
- U64 profile creation through app UI worked; direct localStorage editing was not needed.
- U64 Home displayed correct product/firmware after U64 profile creation.
- U64 VIC stream Start/Stop completed through app UI, and no stream was intentionally left running.
- U64 app volume slider restored to `0 dB`; c64scope direct mixer snapshot also restored without stale writes.
- Pixel 4 remained adb-authorized and C64 Commander remained launchable/responsive.
- U64 final liveness remained HTTP 200.

## Final Device State
- Pixel 4: adb `device`, C64 Commander foreground and responsive.
- App route evidence: Home and Settings captured after cleanup.
- U64: `/v1/info` HTTP 200, selected in app, Home/Settings healthy.
- C64U: degraded; no final reprobe after confirmed hostname/IP connection resets to avoid further interaction.
- Playback: app playlist playback was not started by app; c64scope direct SID playback was started for capture, but no documented stop endpoint was found in the REST API surface inspected during the run.
- Streams: U64 VIC stream started and stopped through app UI.
- Disks: no disk mounted by this run.
- Settings restored: volume/mixer restored to original observed value/snapshot.
- Remaining changes: test-owned U64 saved profile remains in app state; product code unchanged.

## Blockers
- Product blocker: saved-device switching cannot select reachable c64u.
- Safety blocker: c64u degraded after the switch investigation.
- Testability blockers: deterministic diagnostics export, Maestro local fixture flow, c64scope artifact root/CLI forwarding, and logcat capture.
- Environment blockers: none classified; C64U degradation is treated as safety/product-readiness until root cause proves otherwise.

## Fix Prompt Input Summary
Fix prompt must include:
- PH8-002 P0 C64U degradation/back-off investigation.
- PH8-001 P1 c64u saved-device switch failure.
- PH8-003 P1 Healthy-without-identity state.
- PH8-006 P1 reconnect/discovery double-click gating.
- PH8-004 and PH8-005 saved-device status/identity consistency.
- PH8-007 deterministic diagnostics export.
- PH8-008 and PH8-009 Maestro playback/disk fixture automation.
- PH8-010 c64scope artifact root and CLI forwarding.
- PH8-011 verified logcat capture.
