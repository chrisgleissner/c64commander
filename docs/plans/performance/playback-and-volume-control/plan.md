# Playback and Volume Control - Production-Quality Hardening Plan

## Goal

On Android, on a real Pixel 4 (adb serial prefix `9B0`) connected to a real
Ultimate 64 Elite (`u64`) over the local network, C64 Commander must be:

- **Fluent and fast** for every volume change (slider drag, slider tap,
  long-press, keyboard step) on every page that exposes a volume control
  (Play, Home, Config), including the dedicated mute/unmute button on
  the Play page.
- **Bug-free under adversarial cadence**: a multi-minute soak that drives
  the volume slider back and forth at sub-second cadence, interleaving
  mute/unmute taps, must complete with zero user-visible errors and with
  the slider never getting stuck, snapping back to a previous position
  on release, or drifting away from the user's last intent.
- **Proven aligned across UI and hardware audio**: repeated slider writes
  and mute/unmute bursts must keep the visible control state monotonic in
  logs and must produce matching amplitude direction changes on the live
  `u64` audio stream without later jump-back.
- **Reliable for playback transport**: Play, Pause, Resume, Skip Next,
  Skip Previous on the Play page must respond within budget, must not
  double-fire, must not leak audio (no "still playing the previous
  track" state), and must not race the auto-advance machinery.
- **Continuously correct in the background**: when the Pixel 4 screen
  turns off and/or the app is moved to the background while a SID/HVSC
  track is playing, the app must continue to auto-advance to the next
  song at the correct time, surviving Android Doze and WebView throttling.

Iteration 2 of the broader performance program (`../iteration2/`) closed on
whole-app responsiveness and an AUTO safety mode. This iteration narrows
the scope to the **two highest-friction user surfaces that survived
Iteration 2**: volume control and Play-page transport. It is gated, soak-
backed, and proof-of-work-driven, exactly like Iteration 2.

## Why this iteration exists

User-reported residual issues from the Iteration 2 soak runs and from
day-to-day use on real hardware:

1. **Slider snap-back on release.** Dragging the Play-page volume slider
   to a new index sometimes results in the thumb snapping back to the
   previous index after release. Hypothesis: a stale `useC64ConfigItems`
   refetch lands after the commit write but before the device echoes the
   committed value, and the `useDeviceBoundSlider` reconciliation effect
   resets `pendingIntent` to `null` while `draftSliderValue` is already
   null. See `src/hooks/useDeviceBoundSlider.ts:262-267, 374` and
   `src/pages/playFiles/hooks/useVolumeOverride.ts:707-828`.
2. **Slider stuck mid-drag.** While dragging fast, the slider's thumb
   visually stops responding for a fraction of a second, even though
   the user finger is still moving. Hypothesis: the throttled preview
   pipeline (`schedulePreview` -> `flushPreview` -> Capacitor REST round
   trip) blocks the JS main thread long enough to drop a touch frame
   when the device is under load. See
   `src/hooks/useDeviceBoundSlider.ts:189-220`.
3. **Mute/unmute glitch under rapid toggling.** Tapping Mute then
   Unmute several times in succession sometimes leaves the device in
   the "wrong" state (muted on the device, unmuted in the UI, or vice
   versa) for ~1-2 seconds before reconciling. Hypothesis: the
   `lastManualWriteRef` 1500 ms window in
   `src/pages/playFiles/hooks/useVolumeOverride.ts:728-742` interacts
   poorly with the `manualMuteIntentRef` and `pendingVolumeWriteRef`
   refs when the second tap arrives before the first write echoes.
4. **Home/Config slider regressions.** To a lesser degree, the same
   snap-back behavior shows up on the Home page audio mixer SID volume
   sliders (`src/pages/home/SidCard.tsx:136-144`) and on the per-item
   Config sliders. Both routes use `useDeviceBoundSlider` directly,
   without the override layer, so a fix at that layer must benefit both.
5. **Background auto-advance unreliability.** With the Pixel 4 screen
   off and the app backgrounded for >2 minutes, the next-song auto-
   advance sometimes fires several seconds late, or only fires on
   resume. Hypothesis: the `BackgroundExecutionService` alarm fires,
   but the `onBackgroundAutoSkipDue` listener path through the
   Capacitor bridge into the (frozen) WebView is gated until the JS
   runtime wakes up. See
   `android/app/src/main/java/uk/gleissner/c64commander/BackgroundExecutionService.kt`
   and `src/pages/PlayFilesPage.tsx:1078-1099`.
6. **Skip Next / Skip Previous double-fire.** Tapping Next twice in
   rapid succession sometimes starts the second-next track but leaves
   the UI on the next-track row; or both Next and the auto-advance
   guard fire for the same track instance. Hypothesis: the
   `playStartInFlightRef` single-flight guard in
   `src/pages/PlayFilesPage.tsx:311` only protects the play
   call, not the broader transport surface.

All six are hypotheses; the soak in Phase D is what proves or refutes
them. The plan does not try to fix anything before measuring.

## Scope and non-scope

In scope:

- `src/hooks/useDeviceBoundSlider.ts` and its consumers on Play, Home,
  and Config pages.
- `src/pages/playFiles/hooks/useVolumeOverride.ts`, including its
  hardware-sync effect and the `lastManualWriteRef` / `manualMuteIntentRef`
  / `pendingVolumeWriteRef` interaction.
- `src/pages/playFiles/hooks/usePlaybackController.ts` (Play, Pause,
  Resume, Next, Previous, auto-advance).
- `src/pages/PlayFilesPage.tsx` `syncPlaybackTimeline` and its
  resume-trigger wiring.
- `src/pages/playFiles/backgroundExecutionPolicy.ts`,
  `src/lib/native/backgroundExecution.ts`,
  `src/lib/native/backgroundExecutionManager.ts`.
- Android: `BackgroundExecutionService.kt`, `BackgroundExecutionPlugin.kt`.
- Targeted unit + integration tests for every fix.
- Soak harness scripts, agent prompt, proof-of-work schema.

Explicitly out of scope:

- New visual design or new page layout. No re-skin of the Play page
  or the AudioMixer card.
- Replacing the Radix slider primitive or the polling-pause registry.
- Re-architecting `c64api`, the request scheduler, FTP, or Telnet.
- iOS execution. iOS continues to rely on CI; this iteration is
  Android-only, on a real Pixel 4 + real U64.
- Relaxing any existing safety preset, error budget, or coverage
  threshold from prior iterations.
- Adding metrics-only refactors that don't tie back to a soak finding.

## Devices and lab

- **Phone**: Pixel 4 attached over adb, serial prefix `9B0`.
  This iteration **must** run on real hardware; emulator-only evidence
  is rejected.
- **Device**: Ultimate 64 Elite, hostname `u64`. The repo guide
  (`CLAUDE.md`, `AGENTS.md`) requires probing `u64` first. This
  iteration only soaks against `u64` (Balanced preset under AUTO).
  `c64u` is deliberately excluded because its known firmware
  degradation pattern (documented in `../iteration2/plan.md`) would
  conflate slider responsiveness regressions with REST-stall
  regressions. Once `u64` legs are clean, a follow-up iteration can
  add `c64u`.
- **Safety mode**: AUTO (resolved to BALANCED, since the active
  device is `u64`).

## Phases and gates

This iteration is gated. A failing gate is a stop-and-triage signal,
not a threshold-relaxation signal.

### Phase 1 - Code archaeology and root-cause hypotheses

- Read `useDeviceBoundSlider.ts`, `useVolumeOverride.ts`,
  `usePlaybackController.ts`, `PlayFilesPage.tsx`,
  `BackgroundExecutionService.kt`, and `BackgroundExecutionPlugin.kt`
  end-to-end before any change.
- Record concrete, file:line hypotheses in `root-cause-hypotheses.md`.
- Reject hypotheses that cannot be tied to a falsifiable soak signal.

Gate 1: every documented hypothesis maps to at least one soak scenario
in `soak-scenarios.md` and at least one acceptance signal in
`proof-of-work.md`.

### Phase 2 - Build the soak harness and baseline

- Implement the scenario scripts referenced in `soak-scenarios.md`.
- Run a baseline soak against current `main` head (or current branch
  head, whichever the user prefers) for the full duration of
  scenarios V1 + V2 + V3 + V4 + P1 + P2 + P3 + P4, and emit the
  proof-of-work artifact set.
- Mark the baseline as "diagnostic, not gating" - it exists only to
  prove the soak harness works and to record reproducible signatures
  of the residual bugs.

Gate 2: `runs/baseline-<runId>/summary.json` lists at least one
reproduced failure for each of the six hypotheses in Phase 1, or
explicitly marks a hypothesis as "could not reproduce on baseline".
A hypothesis with "could not reproduce" must be either revised or
dropped before Phase 3.

### Phase 3 - Fix loop

For each confirmed bug from Phase 2:

1. Write a regression test that fails on `main` (or current branch
   head) and passes after the fix. The test must be the narrowest
   deterministic test at the touched layer (unit > integration > e2e),
   per the project's mandatory bug-fix regression coverage rule.
2. Implement the minimal change. Do not widen scope. Do not relax a
   safety preset. Do not introduce a new abstraction unless it removes
   a duplicated bug pattern in two or more places.
3. Re-run the relevant scenario from `soak-scenarios.md`. Move on only
   when that scenario passes on the touched device under the soak
   cadence.
4. Commit each fix as a separate, focused commit on the working
   branch.
5. For repeated volume and mute/unmute interactions, preserve two-sided
   proof:
   - logs that emit the precise slider/mute state over time and show no
     jump-back after the user-visible state settles
   - live `u64` audio-stream checks that confirm the audible amplitude
     changes in the same direction as the UX state
6. Extend the playlist-control soak beyond volume alone: frequently skip
   backward/forward and stop/resume songs, and prove every CTA updates
   promptly and consistently in both UI state and live device audio.
   Audio evidence must show the expected transport change within 500 ms
   of the CTA action, without buttons or sliders snapping back to their
   pre-action state.
7. Restore HVSC songlength discovery during the test run so playlists
   sourced from `/USB2/test-data/SID` resolve their real durations from
   `Songlengths.md5` instead of falling back to the 3:00 default. This
   is required so the playback and auto-advance soak timings reflect the
   true track metadata.

Gate 3: every bug from Phase 2 has a regression test, a commit, and
a passing scenario re-run.

### Phase 4 - Full soak

- Execute every scenario from `soak-scenarios.md` in order, on the
  Pixel 4 against `u64`, with AUTO safety mode active.
- The Pixel 4 stays attached over adb for the entire duration.
- For background scenarios (P4, P5), the Pixel 4 screen turns off
  via `adb shell input keyevent KEYCODE_POWER` and the app is moved
  to background with `adb shell input keyevent KEYCODE_HOME` between
  scenario steps. The agent does **not** keep the screen artificially
  awake.
- The agent collects the full artifact set defined in
  `proof-of-work.md`.

Gate 4: all of the following hold for a single end-to-end run, captured
in one `runs/<runId>/` directory:

1. Volume soak (V1-V4) produces zero `user-visible-error` rows in
   `oracles/errors.ndjson`, zero slider snap-back events (per the
   oracle in `proof-of-work.md`), zero stuck-thumb events, 100%
   slider-commit-to-device-echo agreement, and zero Play-page
   audio-verification failures in
   `oracles/audio-volume-verification.ndjson` when the slider is
   moved through large steps.
2. Playback soak (P1-P3) produces zero double-fires of Next or
   Previous, zero stuck Pause buttons, and a tap-to-feedback p95
   under 350 ms.
3. Background auto-advance soak (P4-P5) produces correct auto-
   advance on at least 95% of track boundaries while the screen is
   off, with a worst-case skew of < 1500 ms from the
   `autoAdvanceGuardRef.dueAtMs`.
4. The `c64u` (sic - U64 Elite at host `u64`) REST `/v1/info` probe
   is reachable in under 1000 ms at the end of the run.
5. Coverage gate from `CLAUDE.md` is satisfied: `npm run test:coverage`
   passes with global branch coverage at or above 91%.
6. Lint, build, and `cap:build` all pass.

### Phase 5 - On-device deployment validation

- Deploy the resulting APK to the Pixel 4 per `CLAUDE.md` Phase 5a.
  If installation fails because the existing build blocks the update,
  uninstall `uk.gleissner.c64commander` first.
- Launch the new build on the Pixel 4 and run a 60-second
  smoke-soak: 10 volume changes, 5 mute toggles, 3 next-track skips,
  1 background auto-advance with the screen off.
- Record the on-device validation in `worklog.md`.

Gate 5: the smoke-soak reports zero user-visible errors. If it
doesn't, the iteration does not close.

## Responsiveness budget

These numbers are normative for this iteration. The first three rows
restate Iteration 2's slider budget and tighten it for the dedicated
volume slider, which is the most aggressively used slider in the app.

| Signal | Budget | How measured |
| --- | --- | --- |
| Volume slider drag to first applied write (preview) | p50 < 120 ms, p95 < 250 ms | `volume-preview-send` trace minus drag-start marker |
| Volume slider release to device echo (commit) | p50 < 250 ms, p95 < 600 ms | `volume-commit-send` trace minus `volume-device-echo` trace |
| Mute / Unmute tap to device echo | p50 < 300 ms, p95 < 700 ms | mute/unmute tap timestamp minus mixer-write completion |
| Tap-to-visible-feedback for Play / Pause / Next / Previous | p50 < 150 ms, p95 < 350 ms | screen recording timestamps cross-referenced with `playback-control` trace marker |
| Slider snap-back event count during V1-V4 | 0 | `oracles/slider-snapback.ndjson` |
| Stuck-thumb event count during V1-V4 | 0 | `oracles/slider-stuck.ndjson` |
| Background auto-advance skew (screen off) | p95 < 1500 ms, max < 3000 ms | logcat alarm fire time minus `autoAdvanceGuardRef.dueAtMs` |
| Background auto-advance correctness (screen off) | >= 95% of boundaries | count of correct `handleNext("auto", ...)` calls vs scheduled |
| Visible-error count during full soak | 0 | toast surface + diagnostics "Errors" tab + logcat ERROR from app package |
| Crash / ANR count during full soak | 0 | logcat + `am dumpsys activity` |

## Risk register

| Risk | Mitigation |
| --- | --- |
| Slider snap-back is intermittent and flakes the soak | V1 and V2 run for 5+ minutes at a cadence of one drag per ~1-2 seconds; one reproducible snap-back is enough to fail the gate, so flakes do not hide. |
| Pixel 4 screen-off path is hard to test reliably | P4 / P5 explicitly use `adb shell input keyevent KEYCODE_POWER` and verify `dumpsys power` shows screen off before the scheduled auto-advance fires. |
| Doze-mode + foreground-service interaction breaks late at night | Soak runs at any wall-clock time; AlarmManager guard inside `BackgroundExecutionService.kt` is the canonical mechanism, and `setExactAndAllowWhileIdle` must be used if a Doze-class skew is observed. |
| A "fix" for the slider race introduces a regression in Home or Config | The slider hook is shared; any change to it triggers V3 (Home) and V4 (Config) in addition to V1 / V2. |
| Coverage gate fails because new code path is exercised only on hardware | Each fix must come with a targeted unit test (preferred) or a fast integration test. If hardware is the only way, document why and run agents/tests with `--cov-branch`. |
| Multiple coding agents touch the same files at once | The branch is single-author. If unexpected changes appear in the worktree, follow the `CLAUDE.md` rule: keep them, do not revert. |
| Agent invents a passing summary without artifacts | `proof-of-work.md` makes evidence mandatory and machine-checkable. Reviewer rejects any verdict without artifacts. |

## Exit criteria

All of the following must be true on a single end-to-end run, captured
in one `runs/<runId>/` directory:

1. AUTO safety mode active, resolved to BALANCED.
2. V1, V2, V3, V4, P1, P2, P3, P4, P5 all pass per the gates in
   `soak-scenarios.md`.
3. Responsiveness budget met for every signal above.
4. Zero user-visible errors. Zero crashes. Zero ANRs.
5. `u64` REST `/v1/info` reachable from the Pixel 4 at the end of
   the run, in under 1000 ms.
6. `runs/<runId>/summary.json` passes the `proof-of-work.md`
   checklist.
7. `worklog.md` has a single conclusive entry for this run.
8. Coverage gate satisfied: `npm run test:coverage` at or above 91%
   branch coverage globally.
9. `npm run lint`, `npm run build`, `npm run cap:build` all pass.
10. The resulting APK has been deployed to the attached Pixel 4
    and the on-device smoke-soak from Phase 5 has passed.

Anything less is a fail, and the agent or human running it must say so.

## Document map

| Document | Purpose |
| --- | --- |
| `README.md` | Orientation for human reviewers and agents. |
| `plan.md` | This document. Scope, phases, gates, exit criteria. |
| `root-cause-hypotheses.md` | Falsifiable hypotheses tied to source file:line ranges. Updated as evidence accrues. |
| `soak-scenarios.md` | Concrete fast-user soak scenarios V1-V4 (volume) and P1-P5 (playback), with cadence, oracles, stop conditions. |
| `regression-tests.md` | Specification for the regression tests each fix must add. |
| `proof-of-work.md` | Required artifact schema, file layout, acceptance gates. |
| `agent-prompt.md` | Self-contained prompt for an autonomous agent to drive Phase 2 (baseline soak) and Phase 4 (final soak) on the Pixel 4. |
| `handover-prompt.md` | Self-contained prompt for an agent picking up this iteration mid-flight. |
| `worklog.md` | Append-only chronological log. Agents write here; reviewers read here. |
| `runs/` | Per-run artifact directory (one subdir per `runId`). |
