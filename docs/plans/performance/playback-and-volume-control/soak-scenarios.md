# Soak Scenarios

Every scenario below targets one or more hypotheses from
`root-cause-hypotheses.md`. Each is defined by:

- **Where**: the route and the on-screen control(s).
- **Cadence**: the user-gesture rate the agent or test must reproduce.
- **Duration**: how long the scenario must run before its verdict is
  trusted.
- **Oracle**: the machine-checkable signal that decides pass/fail.
- **Stop conditions**: when the agent stops early (and how that maps
  to a verdict).

Scenarios are run by the agent following `agent-prompt.md`. All scenarios
target `u64` (Ultimate 64 Elite at host `u64`) with AUTO safety mode
(resolved to BALANCED). The Pixel 4 stays attached over adb for the
entire run.

## Volume scenarios

### V1 - Play page volume slider snap-back

- **Where**: Play page (`/play`). Add at least one SID item to the
  playlist (HVSC track is fine), start playback, then drag the
  `data-testid="volume-slider"` thumb.
- **Cadence**: 1 drag every 1500-2000 ms, alternating direction.
  Each drag is at least 3 index steps away from the prior settled
  position. After each drag, **release** and wait for the slider to
  settle before the next drag.
- **Duration**: 5 minutes (~150-200 drags).
- **Oracle**: `oracles/slider-snapback.ndjson` row per snap-back
  event:
  ```json
  {
    "tsMs": 1747695600000,
    "scenario": "V1",
    "committedIndex": 12,
     "renderedIndexAfterMs1500": 9,
     "renderedDeltaIndex": -3
   }
   ```
  Plus an explicit `oracles/audio-volume-verification.ndjson` probe at
  the start of the scenario: the runner commits several large slider
  steps on `/play`, captures the live `u64` UDP audio stream during the
  probe, and verifies that the median RMS moves in the same direction as
  the committed slider change by at least the minimum configured delta.
  The runner also appends `oracles/volume-state-trail.ndjson` rows for
  each pre/post-settle observation so the visible slider state can be
  audited for jump-back after each repeated change.
- **Pass**: zero rows in `slider-snapback.ndjson` for this scenario.
  Every `audio-volume-verification.ndjson` row for `V1` must report
  `result: "VERIFIED"`.
- **Stop early**: stop after 3 snap-back events; the bug is reproduced.
  Mark verdict `BUG_REPRODUCED`.

### V2 - Play page volume slider stuck-thumb during fast drag

- **Where**: Play page volume slider.
- **Cadence**: continuous drag with no release for 5 seconds, then 1
  second rest, then repeat. Each drag covers the full slider range
  end-to-end at finger speed comparable to a real user. The agent
  uses `droidmind` continuous swipe semantics.
- **Duration**: 2 minutes (~24 sweep cycles).
- **Oracle**: 60 fps screen recording. Any inter-frame gap >= 100 ms
  with thumb stationary while the recorded pointer is in flight is a
  stuck-thumb event. Recorded in `oracles/slider-stuck.ndjson`.
- **Pass**: zero stuck-thumb events.
- **Stop early**: stop after 3 stuck-thumb events; mark
  `BUG_REPRODUCED`.

### V3 - Home page audio mixer SID volume sliders

- **Where**: Home page (`/home`), the AudioMixer card, each enabled
  SID's `data-testid="home-sid-volume-<key>"` slider.
- **Cadence**: 1 drag every 2 seconds, cycling through every enabled
  SID slider on the page. Each drag at least 3 steps from prior
  settled position. After each drag, release.
- **Duration**: 4 minutes.
- **Oracle**: `oracles/slider-snapback.ndjson` rows with
  `scenario: "V3"`. Same snap-back oracle as V1.
- **Pass**: zero rows.
- **Stop early**: 3 snap-backs.

### V4 - Play page mute/unmute under rapid toggling

- **Where**: Play page, `data-testid="volume-mute"` button.
- **Cadence**: 5 taps per second for 5 seconds, then 5 seconds rest.
  Repeat.
- **Duration**: 90 seconds (≈ 225 taps total).
- **Oracle**: `oracles/mute-glitch.ndjson` row per glitch:
  ```json
  {
    "tsMs": ...,
    "expected": "muted",
    "uiState": "muted",
    "deviceState": "unmuted",
    "delayMs": 1820
  }
  ```
- **Pass**: zero rows, and after the final tap the device state and
  the UI state must converge within 1500 ms.
- **Additional evidence**: `oracles/volume-state-trail.ndjson` logs the
  precise visible mute/slider state after every tap so later jump-back
  can be correlated with the glitch row and the audio-stream evidence.
- **Stop early**: 3 glitches.

## Playback transport scenarios

### P1 - Play, Pause, Resume cycle

- **Where**: Play page transport controls.
- **Cadence**: Play -> wait 4 s -> Pause -> wait 2 s -> Resume ->
  wait 4 s -> Stop. Repeat.
- **Duration**: 5 minutes (~30 cycles).
- **Oracle**:
  - `oracles/transport-events.ndjson` records each control tap and
    the resulting device state echo time.
  - p50 < 150 ms, p95 < 350 ms for tap-to-visible-feedback.
  - Zero "Pause stuck" events (Pause button visible but unresponsive
    for > 2 s).
  - Zero ghost-playback events (Stop fires, but device keeps
    producing audio).
- **Pass**: budget met, zero glitches.

### P2 - Pause/Resume rapid toggling

- **Where**: Play page Pause button.
- **Cadence**: 3 taps per second on the Pause/Resume control for
  10 seconds, then 5 seconds rest. Repeat.
- **Duration**: 60 seconds active toggling (~180 taps).
- **Oracle**: machineTransitionCoordinator must suppress superseded
  transitions and not raise any user-visible error. Final state must
  match the parity of total taps within 2 seconds.
- **Pass**: zero `PLAYBACK_CONTROL` toast errors, zero crashes,
  final-state correctness across all bursts.

### P3 - Skip Next / Skip Previous rapid taps

- **Where**: Play page Next and Previous buttons.
- **Cadence**: Next, Next, Next at 250 ms intervals; wait 5 seconds;
  Previous, Previous at 250 ms intervals; repeat. Playlist must
  contain at least 10 SID tracks. Enable **Repeat** before the burst so
  the playlist remains circular for the full 90-second run.
- **Duration**: 90 seconds.
- **Oracle**: `oracles/transport-events.ndjson` correlates each
  control event with the resulting `trackInstanceId` increment. A
  double-advance for a single tap is a fail row. An auto-advance
  firing for a stale `trackInstanceId` is a fail row.
- **Pass**: zero double-fires; every tap advances by exactly one
  playlist position; auto-advance never fires for a stale instance.

### P4 - Background auto-advance with screen off

- **Where**: Play page. Playlist with at least 6 SID tracks each set to
  a 10-15 second duration (use HVSC tracks with known short
  songlengths, or use the `/play` page's per-item duration override).
- **Cadence**: start playback, immediately `adb shell input keyevent
KEYCODE_POWER` to turn screen off, then `adb shell input keyevent
KEYCODE_HOME` to put app in background.
- **Duration**: 5 full track auto-advances (~90 seconds of wall
  clock).
- **Oracle**:
  - `oracles/background-advance.ndjson` row per scheduled
    auto-advance, with `dueAtMs`, `firedAtMs`, `skewMs`, and
    `result: "fired" | "missed" | "late"`.
  - Pixel 4 `dumpsys power` confirms `mWakefulness=Asleep` at
    scheduled fire time.
  - Logcat shows `BackgroundExecutionService` runnable fire within
    1500 ms of `dueAtMs`.
- **Pass**: at least 95% of scheduled boundaries fire `result:
"fired"` with `skewMs < 1500`. Zero `result: "missed"`. Max
  skew < 3000 ms.

### P5 - Background auto-advance with screen off, long idle

- **Where**: Same as P4 but with a 4-minute idle window between the
  start of playback and the first auto-advance. This intentionally
  pushes into Android Doze territory.
- **Cadence**: load a 4-minute HVSC track, start playback, screen
  off + home. Wait until the auto-advance is scheduled.
- **Duration**: one cycle is ~5 minutes; repeat 3 cycles. Total
  ~15 minutes.
- **Oracle**: same as P4. Verify each Doze fire path uses
  `setExactAndAllowWhileIdle` if the implementation depends on it.
- **Pass**: at least 2 of 3 cycles produce `result: "fired"` with
  `skewMs < 3000`. The third may be `skewMs < 5000` if Doze fires it
  later, but never `missed`.

## Cross-page volume scenario (smoke, not gating)

### V5 - Volume change across Play, Home, Config (smoke)

Not part of the soak gate but useful for the deploy-validation smoke
in Phase 5:

- Open Play page, drag the volume slider to a midpoint, release.
- Navigate to Home, drag the Master Volume slider on AudioMixer to a
  midpoint, release.
- Navigate to Config, find the same Audio Mixer category, drag a
  channel slider, release.
- Navigate back to Play. The Play page must reflect the last
  applied write.

Use this as a sanity check during Phase 5 deploy validation.

## How the agent runs these

The agent in `agent-prompt.md` opens the app on the Pixel 4 over
`droidmind`, navigates to the Play page, and executes scenarios in
the order V1 -> V2 -> V3 -> V4 -> P1 -> P2 -> P3 -> P4 -> P5. Each
scenario writes its artifacts under `runs/<runId>/oracles/` and
appends a summary line to `runs/<runId>/steps.ndjson`. The agent
must not skip a scenario; if a scenario is `BUG_REPRODUCED`, the
agent continues with the next scenario but records the reproducer in
`runs/<runId>/summary.json`.

## Test-mode hooks

The app exposes the following test hooks the scenarios rely on:

- `data-testid="volume-slider"` (Play page volume).
- `data-testid="volume-mute"` (Play page mute button).
- `data-testid="volume-label"` (Play page volume readout).
- `data-testid="home-sid-volume-<key>"` (Home page per-SID volume).
- `data-testid="playback-controls-layout"` (Play page transport
  container).
- `data-testid="playback-current-track"` (current item label).

Any new oracle should reuse these where possible.
