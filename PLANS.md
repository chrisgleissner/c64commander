# Play Menu Volume Control / Mute Logic Investigation Plan

Classification: `CODE_CHANGE`, `UI_CHANGE`

## Objective

Permanently fix Play menu mute/unmute behavior across Android, iOS, and Web so mute/unmute UI and audio transitions complete within 300 ms and remain stable for at least 6 seconds, with regression protection and hardware-in-the-loop proof against a real Android device and real C64 Ultimate (`C64U`).

## Phase 1 - Evidence Collection

- [x] Inspect `.tmp/play-volume-control` artifacts.
- [x] Classify event types from actions, traces, logs, and error logs.
- [x] Measure timestamps and event burst density.
- [x] Detect duplicate event emissions.
- [x] Identify UI vs audio vs network vs device events.
- [x] Build a timeline of the mute action.
- [x] Add the reconstructed timeline diagram below.

## Phase 2 - Event Trace Analysis

- [x] Determine why more than 100 events were generated from a single mute action.
- [x] Identify redundant events.
- [x] Identify cascade triggers.
- [x] Identify every event that modifies volume.
- [x] Identify every event that modifies mute state.
- [x] Identify every event that re-enables playback.
- [x] Document feedback loops, delayed handlers, and races.

## Phase 3 - Root Cause Identification

- [x] Determine why mute occurs briefly.
- [x] Determine why playback resumes unexpectedly.
- [x] Determine why the slider reaches -42 dB later instead of atomically.
- [x] Determine why final mute occurs after about 6 seconds.
- [x] Document exact root cause(s) and affected components.

## Phase 4 - Architecture Fix Design

- [x] Define a single authoritative mute/volume state model.
- [x] Design atomic mute/unmute transitions.
- [x] Eliminate recursive or competing state updates.
- [x] Define authoritative event flow between UI, player, and device sync.
- [x] Add the target event flow diagram below.

## Phase 5 - Implementation

- [x] Implement the minimal deterministic fix.
- [x] Remove redundant listeners, loops, and duplicate state updates.
- [ ] Preserve cross-platform behavior for Android, iOS, and Web.
- [ ] Keep public behavior compatible except for the bug fix.

## Phase 6 - Instrumentation

- [ ] Add timestamped diagnostics for mute/unmute requests.
- [ ] Add source-tagged state transition logging.
- [ ] Add audio pipeline action logging.
- [ ] Add latency measurement capture for UI and audio transitions.
- [ ] Ensure instrumentation is usable in automated and HIL tests.

## Phase 7 - Hardware-in-the-Loop Test Framework

- [ ] Identify existing Android/HIL test harness capabilities in the repo.
- [ ] Implement automated HIL mute/unmute workflow using a real Android device and `C64U`.
- [ ] Start playback of a real stream.
- [ ] Trigger mute and unmute through the app UI.
- [ ] Capture signal evidence and UI timing evidence.
- [ ] Assert mute and unmute latency budgets.

## Phase 8 - Latency Verification

- [ ] Measure mute latency.
- [ ] Measure unmute latency.
- [ ] Measure UI state update latency.
- [ ] Measure pipeline latency.
- [ ] Record results in this file.

## Phase 9 - Stability Verification

- [ ] Observe mute stability for at least 6 seconds.
- [ ] Observe unmute stability for at least 6 seconds.
- [ ] Verify no unexpected state flips or audio leakage.
- [ ] Repeat across multiple runs.
- [ ] Record stability evidence in this file.

## Phase 10 - Regression Protection

- [x] Add or update focused regression tests for the root cause.
- [ ] Add assertions preventing event storms.
- [ ] Add assertions preserving UI/audio synchronization.
- [ ] Run relevant validation suites including coverage.

## Timeline Diagram

```text
T+0 ms     user click `Mute`
T+1 ms     automatic read burst starts (`GET /v1/configs/Audio Mixer`)
T+349 ms   SID sockets/addressing enrichment reads still in progress
T+542 ms   first mute write starts (`POST /v1/configs` -> `-42 dB`)
T+756 ms   mute write returns 200
T+967 ms   after write, reconciliation read burst starts again
T+2451 ms  unsolicited unmute write starts (`POST /v1/configs` -> `0 dB`)
T+3411 ms  redundant unmute write repeats
T+4272 ms  redundant unmute write repeats
T+7249 ms  later write burst repeats, leaving final delayed mute reconciliation

Observed storm in first 8 s after one click:
- 607 trace events
- 107 actions
- 101 REST GETs
- 6 REST POSTs total in the captured window
- only 1 user action
```

## Target Event Flow Diagram

```text
User Mute click
	-> set manual mute intent immediately
	-> set UI button=Unmute and slider=-42 dB immediately
	-> send one audio-mixer mute write
	-> ignore stale device reads that still report active volume
	-> accept only muted confirmation from device sync

User Unmute click
	-> clear manual mute intent immediately
	-> set UI button=Mute and slider=previous index / 0 dB immediately
	-> send one audio-mixer unmute write
	-> ignore stale muted device reads during write propagation
	-> accept only unmuted confirmation from device sync
```

## Latency Results

Pending validation.

## Stability Results

Pending validation.

## Risk Register

- The bug may involve multiple feedback paths across UI state, audio engine state, and device synchronization.
- Existing diagnostics may be too noisy to separate source-of-truth transitions from derived updates.
- HIL timing proof depends on stable Android device connectivity and live C64U streaming.

## Root Cause Notes

- A single mute click produced `1` user action, `101` automatic GETs, and repeated automatic POST writes.
- `useC64ConfigItems` expands one logical refetch into a category read plus per-item enrichment reads, so each reconciliation cycle fans out into many REST events.
- `handleToggleMute` force-refreshed Audio Mixer and SID config before sending the mute write, adding roughly 540 ms of avoidable pre-write latency.
- The first write correctly sent `-42 dB`, but later internal writes sent `0 dB` without any second user action.
- Those unsolicited `0 dB` writes came from app-side stale-state correction paths using the previous volume index as an authoritative target after the manual mute request.
- The prior implementation used one mutable `volumeMuted` state for both user intent and device readback, allowing stale reads and internal correction paths to clear manual mute and reassert `0 dB`.
- Once the manual mute snapshot was cleared by an unsolicited unmute path, later device sync could finally drive the slider to the physical mute value, which matches the user's observed delayed `-42 dB` jump.

## Work Log

- 2026-03-15 00:00 UTC: Replaced the stale unrelated plan with a dedicated execution plan for the Play menu mute/unmute defect. Next: classify trace artifacts and reconstruct the mute timeline from `.tmp/play-volume-control`.
- 2026-03-15 00:00 UTC: Classified the trace burst. In the 8-second mute window there were 607 trace events and 107 action summaries, of which 101 were `rest.get` and 6 were `rest.post`. Only one user action (`click volume-mute`) was recorded.
- 2026-03-15 00:00 UTC: Confirmed the event storm source. Each `useC64ConfigItems` reconciliation expands into a category fetch plus per-item enrichment fetches, and `schedulePlaybackReconciliation()` retriggers three such query groups for Audio Mixer, SID Sockets, and SID Addressing.
- 2026-03-15 00:00 UTC: Confirmed the write oscillation. The initial POST writes `-42 dB`, but later automatic POSTs write `0 dB` back to the same mixer items without any second user action, which explains the brief mute followed by unexpected audio resume.
- 2026-03-15 00:00 UTC: Implemented the core fix in `useVolumeOverride`: manual mute is now an explicit authoritative intent, UI mute/unmute state updates immediately, the toggle path no longer force-refreshes before writing, internal writes are blocked while manual mute is active, and muted sync now preserves the explicit mute index instead of reverting to the pre-mute index.
- 2026-03-15 00:00 UTC: Added focused regression coverage in `src/pages/playFiles/volumeSync.test.ts` to lock in the rule that stale active-volume readback must not override manual mute intent.
