# Regression Tests Specification

Every fix that lands as a Phase 3 result of this iteration must include
at least one regression test. The rule below restates the project's
mandatory bug-fix regression coverage rule (`CLAUDE.md`) and pins it to
this iteration's expected layers.

## Layers in order of preference

For each fix, prefer the **narrowest** layer that can deterministically
reproduce the bug.

1. **Unit tests (`vitest`)** under `tests/unit/`. Fastest, most
   reliable. Use this layer for:
   - `useDeviceBoundSlider` reconciliation, watchdog, polling-pause
     interaction.
   - `volumeState` reducer, `volumeSync` helpers.
   - `useVolumeOverride` sync-effect branches (with a stubbed
     `useC64ConfigItems`).
   - `usePlaybackController` next/previous/auto-advance branches
     (with stubbed `getC64API`).
   - `backgroundExecutionPolicy` pure functions.
2. **React Testing Library on hooks** under `tests/unit/`. Same as
   above for hooks that need a render cycle.
3. **Android JVM tests** under
   `android/app/src/test/java/uk/gleissner/c64commander/`.
   Use this layer for:
   - `BackgroundExecutionService` runnable scheduling and Doze-edge
     behavior. Existing tests:
     `BackgroundExecutionServiceTest.kt`,
     `BackgroundExecutionPluginTest.kt`. Add narrowly scoped
     additions; do not rewrite.
4. **Playwright** under `playwright/`. Use only if the bug requires
   real DOM events plus real Radix slider behavior. Slower; budget
   accordingly.
5. **Maestro flows** under `.maestro/`. Use only if the bug requires
   real Pixel 4 hardware behavior (touch sequences that the JSDOM
   stack cannot reproduce). Read `docs/testing/maestro.md` first.
   Maestro must not be the **only** layer for a fix; it is the proof
   layer, not the regression layer.

Hardware-only validation does not count as a regression test.

## Per-hypothesis test specifications

For each hypothesis from `root-cause-hypotheses.md`, the regression
test must include the following.

### H1 - Slider snap-back

**Layer**: Vitest unit test on `useDeviceBoundSlider`.

**Test name**: `useDeviceBoundSlider does not render pre-commit
device value while reconciling`.

**Setup**:

- Render the hook with a stable initial device value (e.g. index 10).
- Simulate `onValueChange([15])`, then `onValueCommit([15])`.
- Before the `commit` promise resolves, push a fresh device value of
  10 (the pre-commit value) into the `deviceValue` prop.
- Assert that `sliderValue` is 15 (or null draft + pendingIntent 15),
  never 10, until the `commit` promise resolves and the device value
  is updated to 15.

**Acceptance**: the assertion must fail on `main` (or current branch
head) and pass after the fix.

### H2 - Stuck thumb mid-drag

**Layer**: Vitest unit test on `useDeviceBoundSlider`'s preview
scheduler.

**Test name**: `schedulePreview never blocks subsequent
onValueChange calls`.

**Setup**:

- Mock `preview` to return a promise that resolves after 500 ms.
- Call `onValueChange` 10 times in quick succession (within 200 ms),
  each with a different value.
- Assert that `setDraftSliderValue` was called for every input value
  in order; no input was dropped.

This is a regression for the React state path, not for the actual
frame budget. A separate Playwright test (P-level) reproduces the
visible stall on a real DOM.

### H3 - Mute/unmute glitch

**Layer**: Vitest unit test on `useVolumeOverride.ts` (with
`useC64ConfigItems` and `updateConfigBatch` stubbed).

**Test name**: `rapid mute/unmute taps converge to the latest user
intent within one device echo`.

**Setup**:

- Mount the hook with `isPlaying: true`, `isPaused: false`.
- Tap `handleToggleMute()` 4 times in a row (Mute, Unmute, Mute,
  Unmute).
- Resolve all the stubbed `updateConfigBatch` calls in order, with
  device echoes corresponding to each call.
- Assert: final `volumeState.muted === false`, final
  `lastKnownDeviceVolumeRef.current.muted === false`, and no
  intermediate state where `volumeState.muted === true` after the
  final tap's echo lands.

**Edge case**: also assert that if the second-from-last call fails
(reject), the UI state recovers (mute intent rolls back to the prior
echoed state).

### H4 - Home/Config slider regression

**Layer**: Vitest unit test on `useDeviceBoundSlider`, same as H1.

Same test as H1 covers this. If the soak shows H4 reproduces while
H1 does not (i.e. the snap-back is specific to the override layer),
add a dedicated `useVolumeOverride` test that mirrors H1's assertion
but in the override-layer reducer.

### H5 - Background auto-advance late

**Layers**: Android JVM test on `BackgroundExecutionService.kt`, plus
a Vitest test on the JS side.

**Android JVM test name**:
`BackgroundExecutionService fires dueAt runnable within 1500 ms of
the scheduled time under simulated Doze`.

**Setup**:

- Construct the service with a `Handler` whose `Looper` is the test
  Looper.
- Call `updateDueAt(dueAtMs = SystemClock.elapsedRealtime() + 10_000)`.
- Advance the test scheduler by 10_000 ms.
- Assert that the broadcast `ACTION_AUTO_SKIP_DUE` was sent with
  `EXTRA_FIRED_AT_MS` within 1500 ms of `dueAtMs`.

**Vitest test name**:
`onBackgroundAutoSkipDue listener calls syncPlaybackTimeline exactly
once per native event`.

### H6 - Skip Next / Skip Previous double-fire

**Layer**: Vitest unit test on `usePlaybackController.handleNext`.

**Test name**: `handleNext does not double-advance under rapid user
taps interleaved with auto-advance`.

**Setup**:

- Stub `playItem` to return a promise that resolves after 100 ms.
- Set up an `autoAdvanceGuardRef` with `trackInstanceId = 1`,
  `dueAtMs = Date.now() + 50`.
- Call `handleNext("user")` immediately.
- Wait 60 ms, then call `handleNext("auto", 1)`.
- Assert: `playItem` was called exactly once for the user tap;
  the auto-advance call no-ops because the guard's
  `trackInstanceId` was bumped before it had a chance to fire.

## Coverage gate

After this iteration's fix loop, the project's coverage gate from
`CLAUDE.md` applies unchanged:

- `npm run test:coverage` must report global branch coverage at or
  above 91%.
- Changes under `agents/` must additionally satisfy `npm run
  test:agents` at or above 90% branch coverage.

If the fixes push touched files' coverage down because of new
branches that the existing tests don't exercise, add tests until
the gate is satisfied. Do not skip a test, do not lower the gate.
