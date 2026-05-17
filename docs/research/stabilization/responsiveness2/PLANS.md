# PLANS — Stabilization Refuel (Stage 1: Investigation)

Date: 2026-05-17
Repository: c64commander
Branch: feat/reduce-latency-and-fix-errors
Handoff directory (mandatory): `/home/chris/dev/c64/c64commander/docs/research/stabilization/responsiveness2`

## Scope

Investigation-only stage. Discover root causes of:

- Android responsiveness issues on Pixel 4.
- Slider behaviour: rapid changes, stale rollbacks, finger-lag, write storms.
- Play page volume and mute reliability.
- Playback start/stop/pause reliability.
- Diagnostics correctness (no false negatives, no degraded states hiding real or fake failures).
- u64 + c64u compatibility differences (Ultimate 64 Elite fw 3.14e vs C64 Ultimate fw 1.1.0).
- Cross-platform regression risk for shared TS code (iOS source-level only, web).

## Non-goals (binding)

- No production code fixes in this stage.
- No diagnostics suppression / label downgrades / threshold loosening.
- No test weakening.
- No firmware updates, factory resets, or persistent device-side changes.

## Device targets

- Android: Pixel 4, adb serial `9B081FFAZ001WX` (`9B0` prefix confirmed via `adb devices`).
- C64 hardware:
  - `u64` → 192.168.1.13, Ultimate 64 Elite, fw 3.14e, fpga 122, core 1.4B, unique_id `38C1BA`. REST `/v1/info` 15 ms from dev host.
  - `c64u` → 192.168.1.167, C64 Ultimate, fw 1.1.0, fpga 122, core 1.49, unique_id `5D4E12`. REST `/v1/info` 10 ms from dev host.

## Risk controls

- Bounded slider/volume stress only; stop and preserve evidence if a device shows instability.
- No destructive REST/Telnet calls (no resets, no flash operations, no config writes that leave persistent state changes; restore any test-time config changes).
- Capture before/after diagnostics state; never clear or mutate device state silently.

## Investigation tasks

| # | Task                                                                       | Status      | Evidence                                                     |
| - | -------------------------------------------------------------------------- | ----------- | ------------------------------------------------------------ |
| 1 | Scaffold handoff docs                                                      | DONE        | this file, WORKLOG.md                                        |
| 2 | Probe u64 + c64u via REST                                                  | DONE        | evidence/commands-host-probe.txt                             |
| 3 | Inspect slider stack (`useDeviceBoundSlider`, write lane, throttle)        | DONE        | WORKLOG.md, FINDINGS.md F-RT-1                               |
| 4 | Inspect Play page volume + mute (`VolumeControls`, `useVolumeOverride`)    | DONE        | WORKLOG.md, FEATURE_INVENTORY.md                             |
| 5 | Inspect playback start/stop/pause (`usePlaybackController`)                | DONE        | WORKLOG.md, FEATURE_INVENTORY.md, H-PLAY-1 hypothesis        |
| 6 | Inspect diagnostics engine + degradation rules                             | DONE        | FINDINGS.md F-DIAG-1..3, MATRIX D-1..D-3                     |
| 7 | Inspect connection/savedDevices for host resolution + recovery             | DONE        | FINDINGS.md F-CONN-1..3                                      |
| 8 | Inspect Telnet + REST transport sequencing/coalescing                      | DONE        | FINDINGS.md F-HTTP-1..2, F-LOG-1..2                          |
| 9 | Deploy newest APK to Pixel 4 (already installed v0.7.9-rc1)                | DONE        | dumpsys versionName=0.7.9-rc1; cold start TotalTime 643 ms   |
| 10 | Bounded interaction stress against u64 with logcat capture                | DONE        | evidence/logcat-coldstart-u64.txt, logcat-slider-stress.txt, home-*.png, diagnostics-dialog.png |
| 11 | Bounded interaction stress against c64u with logcat capture               | BLOCKED     | u64 was the active device during this session; c64u stress requires switching device (deferred to Stage 2 validation matrix). Background c64u probes were nonetheless observed and feed F-DIAG-1. |
| 12 | Write FEATURE_INVENTORY.md                                                | DONE        | FEATURE_INVENTORY.md                                         |
| 13 | Write DIAGNOSTICS_ROOT_CAUSE_MATRIX.md                                    | DONE        | DIAGNOSTICS_ROOT_CAUSE_MATRIX.md                             |
| 14 | Write RESPONSIVENESS_NOTES.md                                             | DONE        | RESPONSIVENESS_NOTES.md                                      |
| 15 | Write FINDINGS.md (consolidated)                                          | DONE        | FINDINGS.md                                                  |
| 16 | Write STABILIZATION_PROMPT.md (execution-ready handoff)                   | DONE        | STABILIZATION_PROMPT.md                                      |

## Suspected issue areas (pre-investigation hypotheses)

| Area                                | Hypothesis                                                                                                   | Source of suspicion                                                                  |
| ----------------------------------- | ------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------ |
| `c64api.ts` size + monolith         | 2168-line file mixes transport / config / playback / disks; hot read path likely re-derives constants.       | wc -l + prior research                                                               |
| `healthCheckEngine.ts` (1857 lines) | Probe activity contributes to degradation history; older failures may continue to win in contributor window. | Prior PLANS.md root cause: bundle `0648`/`0658`.                                     |
| `usePlaybackController.ts` (1117)   | Playback start/stop may share state with volume/mute; mute may be conflated with volume==0.                  | useVolumeOverride exists separately (908 lines), implying earlier conflation issues. |
| `useDeviceBoundSlider`              | Out-of-order responses may overwrite optimistic state; depends on `useAuthoritativeConfigValueState` equality. | Prior research R-RT (optimistic override store equality).                          |
| `CapacitorHttp` enabled             | Per-request JNI hop; partial AbortController support; defeats keepalive.                                     | capacitor.config.ts comment + prior research R-HTTP-1.                              |
| `connectionManager.ts` host probe   | bare `u64` mDNS unreachable on Android; saved-device IPs may be required for stable connection.              | Prior research R-RT-2; live probe required.                                          |
| Diagnostics degraded persistence    | Older aborted probes still dominate exported state after successful probes.                                  | Prior PLANS root cause already noted.                                                |

## Confirmed findings

See `FINDINGS.md`. Summary of confirmed (Confidence: High) findings:

- F-DIAG-1: saved-device 10 s probes contaminate active device's contributor windows (no deviceId on trace events).
- F-DIAG-2: REST contributor window uses `firstSuccessIndex` trim, vs FTP/TELNET `findLastIndex(isSuccess)` — asymmetric recovery latency.
- F-DIAG-3: App contributor goes Degraded on a single error in the 5-min window.
- F-CONN-1: OFFLINE badge persists ~10–15 s after launch despite healthy REST traffic.
- F-CONN-2: Home page Device/Firmware row sticks at "Not available" on warm restart even when badge is HEALTHY.
- F-CONN-3: Diagnostics dialog header shows `u64 · Unknown` while badge shows `u64 3.14e`.
- F-HTTP-1: CapacitorCookies plugin still emits per-request "Getting cookies at:" hop despite `enabled: false` in `capacitor.config.ts`.
- F-HTTP-2: 9+ sequential CapacitorHttp calls for LED Strip / Keyboard Lighting at cold boot.
- F-LOG-1: `Msg: undefined` log spam on every Telnet send/read tick.
- F-LOG-2: `Uncaught TypeError: Cannot read properties of undefined (reading 'triggerEvent')` at cold boot.
- F-MIME-1: MimeMap long monitor contention ~370 ms during chunk load.

Open hypotheses (Confidence: Low–Medium, to be verified at Stage 2): H-VOL-1, H-VOL-2, H-PLAY-1, H-RT-2.

## Unresolved questions

- Does Play page mute toggle use a separate "mute" semantic or volume==0? If conflated, mute+unmute can overwrite real volume.
- Are volume/mute writes coalesced with the slider write lane, or do they bypass it?
- Does the diagnostics contributor window weight recent successes adequately on c64u, where REST `/v1/info` historically had intermittent failures?
- Are there shared TS code paths whose fixes would regress iOS without iOS CI catching them?

## Evidence locations

- `evidence/commands-host-probe.txt` — REST `/v1/info` probe transcripts
- `evidence/logcat-*.txt` — captured during bounded stress
- `evidence/code-notes-*.md` — annotated code excerpts when needed

## Termination criteria

- All investigation tasks DONE or BLOCKED with documented reason.
- All required handoff docs exist under `responsiveness2/`.
- `STABILIZATION_PROMPT.md` is execution-ready with concrete file paths, confirmed findings, hypotheses, and acceptance criteria.

## Cross-link to prior work

- Prior investigation: [responsiveness/](../responsiveness/) (R-HTTP-1, R-MOD-*, R-BUN-*, R-RT-* IDs).
- Prior root PLANS.md (root of repo) details 2026-05-13 stabilization findings still relevant.
