# Root-Cause Hypotheses

Each hypothesis is a **falsifiable claim** about a specific code path, with
a file:line citation and a soak signal that should reproduce or refute it.
Hypotheses are not facts. Phase 2 of `plan.md` exists to confirm or kill
each one before Phase 3 begins.

If a hypothesis cannot be reproduced on baseline, mark it `[REFUTED]`,
keep the entry, and update the linked scenario to either tighten the
trigger or be deleted.

## H1 - Slider snap-back on release (Play, Home, Config)

### Symptom

User drags the volume slider to a new index, releases. The thumb settles
at the new index for ~200-500 ms, then snaps back to the previous index.
A subsequent device read eventually settles it back to the user's intent.

### Hypothesised cause

`useDeviceBoundSlider` reconciliation logic:

```
src/hooks/useDeviceBoundSlider.ts:262-267
  useEffect(() => {
    if (pendingIntent && equals(deviceValue, pendingIntent.value)) {
      setPendingIntent(null);
      clearWatchdogTimer();
    }
  }, [clearWatchdogTimer, deviceValue, equals, pendingIntent]);

src/hooks/useDeviceBoundSlider.ts:374
  const sliderValue = draftSliderValue ?? pendingIntent?.sliderValue ?? deviceSliderValue;
```

The displayed value falls back to `deviceSliderValue` when both
`draftSliderValue` and `pendingIntent` are null. If the device's
React Query cache still holds the **pre-commit** value (because the
post-commit refetch is still in flight, or because polling was paused
during the drag and the cached value is stale), then on the brief
window between "commit fires" and "device echoes new value", the
slider can render the pre-commit value.

Compounding factor on the Play page: `useVolumeOverride.ts:707-828`
runs its own sync effect that calls `dispatchVolume({ type: "sync", ... })`
with the most-common active index across enabled SIDs. If those SIDs
echo the new value at slightly different times, the most-common
calculation can transiently produce the old value.

### Soak signal

Scenario V1 (Play) and V3 (Home). Oracle: cross-check `volume-commit-send`
trace event payload against `volume-device-echo` trace event payload
within the same `trackInstanceId` / `selectedDeviceId` scope. Snap-back
fires when the rendered `data-testid="volume-slider"` value transitions
from the committed value back to a different value within 1500 ms after
the commit, while no new user gesture was recorded.

### Falsification

If V1 + V3 produce zero snap-back events on baseline, this hypothesis
is REFUTED.

## H2 - Stuck thumb mid-drag

### Symptom

While dragging the Play-page volume slider fast (>3 events/sec), the
thumb visually stops responding for a fraction of a second even though
the finger is still moving on the screen.

### Hypothesised cause

`useDeviceBoundSlider.ts:189-220` schedules a preview write whenever
the user crosses the throttle interval (default 200 ms,
`DEFAULT_VOLUME_SLIDER_PREVIEW_INTERVAL_MS`). `flushPreview` is
synchronous on the JS side but produces a microtask-chain through
`updateConfigBatch.mutateAsync`. If the device round-trip + React Query
state update + React re-render exceeds the frame budget, the next
pointermove event is delayed, causing the visible stall.

Compounding factor: `pollingPauseRegistry.acquirePause()` is acquired
on the first drag tick (`useDeviceBoundSlider.ts:131-134`) but the
React Query cache invalidation from a previous unmute / mute write
may still be running.

### Soak signal

Scenario V2. Oracle: pointermove-to-thumb-update latency from screen
recording at 60 fps. Any single frame gap > 100 ms during a drag is a
stuck-thumb event.

### Falsification

If V2 produces a stuck-thumb count of zero on baseline at the soak
cadence, REFUTE.

## H3 - Mute/unmute glitch under rapid toggling

### Symptom

Tap Mute, then Unmute, then Mute, then Unmute within ~2 seconds.
Sometimes the device ends up muted while the UI says Unmute is
available, or vice versa. The state corrects itself within 1-2 seconds.

### Hypothesised cause

Three interacting refs in `useVolumeOverride.ts`:

```
src/pages/playFiles/hooks/useVolumeOverride.ts:123, 124, 128-131
  lastManualWriteRef = useRef<{ index; muted; setAtMs } | null>(null);
  manualMuteIntentRef = useRef(false);
  pendingVolumeWriteRef = useRef<PlaybackSyncIntent | null>(null);
```

The hardware sync effect at lines 707-828 gates on `lastManualWriteRef`
within a 1500 ms window:

```
src/pages/playFiles/hooks/useVolumeOverride.ts:728-742
  if (lastManualWrite && Date.now() - lastManualWrite.setAtMs < 1500) {
    const deviceMuted = activeIndices.length === 0;
    if (deviceMuted === lastManualWrite.muted) { ... }
    else { return; }
  }
```

If the user taps Mute-then-Unmute within < 1500 ms, the second tap
replaces `lastManualWriteRef` before the first device echo is observed.
The sync effect now ignores any device state that doesn't match the
**second** tap, which means an in-flight first-tap echo gets ignored
forever. The pendingVolumeWriteRef is only cleared on match, leaving
a deferred sync that never lands until the user touches the slider
again.

### Soak signal

Scenario V4. Oracle: every Mute/Unmute tap must produce a corresponding
`volume-device-echo` trace within 1000 ms with matching `muted`. Any
gap > 1500 ms or any echo that never lands is a glitch event.

### Falsification

If V4 produces zero glitches at 5 toggles per second for 60 seconds,
REFUTE.

## H4 - Home/Config slider regressions track H1

### Symptom

Home page AudioMixer SID volume sliders and Config page sliders show
the same snap-back as the Play page volume slider.

### Hypothesised cause

Same root as H1. Home (`src/pages/home/SidCard.tsx:136-144`) and Config
sliders use `useDeviceBoundSlider` directly. They do not have the
`useVolumeOverride` layer, so they are the cleanest probe for the
hook-level race.

### Soak signal

Scenario V3 (Home). The Home page does not have a Mute button; only the
slider. If V1 produces snap-back but V3 does not, the snap-back is
inside the override layer, not the slider hook. If both produce
snap-back, the fix must land in `useDeviceBoundSlider`.

### Falsification

If V3 is clean while V1 is not, redirect H4 to `useVolumeOverride`
only.

## H5 - Background auto-advance late or missing with screen off

### Symptom

Pixel 4 screen off, app backgrounded, current SID/HVSC track playing.
At the scheduled `autoAdvanceGuardRef.dueAtMs`, the next track should
start. Observed: sometimes the next track starts 5-15 seconds late, or
only after the user wakes the screen and brings the app foreground.

### Hypothesised cause

`BackgroundExecutionService.kt` schedules a Handler-based runnable (or
in some code paths an AlarmManager exact alarm) for `dueAtMs`. When
Doze fires, the Handler's `postDelayed` is no longer guaranteed to run
at the wall-clock time. The plugin broadcasts `backgroundAutoSkipDue`,
which the WebView listener (`onBackgroundAutoSkipDue`) catches and
calls `syncPlaybackTimeline()`. But if the WebView is frozen by
Android, the listener fires only after the WebView resumes - which is
often only after the screen wakes.

Compounding factor: `usePlaybackResumeTriggers` only fires on
`visibilitychange`, `focus`, and `pageshow`. None of those fire while
the screen stays off, so the only fallback is the native event.

### Soak signal

Scenario P4. Oracle: schedule a short SID (e.g. 10 s duration), put
the screen off, observe that `handleNext("auto", ...)` is called
within `dueAtMs + 1500 ms`. Sample logcat for
`BackgroundExecutionService` runnable fire times and compare to the
wall-clock `dueAtMs`.

### Falsification

If P4 reports >= 95% on-time auto-advances at 10s tracks for 5
minutes, REFUTE.

## H6 - Skip Next / Skip Previous double-fire

### Symptom

Tap Next, tap Next again ~150 ms later, sometimes the playlist
advances by 2; sometimes the UI freezes for a second before catching
up; sometimes the auto-advance guard fires for a stale `trackInstanceId`.

### Hypothesised cause

`playStartInFlightRef` in `src/pages/PlayFilesPage.tsx:311` only
guards `handlePlay`, not `handleNext` / `handlePrevious`. The
`enqueuePlayTransition` lane serialises transitions, but each tap
already updates `setIsPaused(false)` synchronously before its slot in
the queue, which makes the UI state look "ahead" of reality.

`autoAdvanceGuardRef.userCancelled` is set on `cancelAutoAdvance()`,
but the auto-advance race-check is on `trackInstanceId` (line 991-993 in
`usePlaybackController.ts`). If a user-triggered next bumps the
instance ID **after** the auto-advance has already begun executing
(but before its async work returns), both can land.

### Soak signal

Scenario P3. Oracle: count `handleNext` invocations and compare to
the user-gesture count + the auto-advance count. Any double-advance
within < 2 seconds is a fire.

### Falsification

If P3 produces zero double-fires at 1 tap per 250 ms for 60 seconds,
REFUTE.

## Cross-cutting concerns

These are not standalone hypotheses but factors to keep in mind during
triage:

- **`polling-pause-tail-grace`** (250 ms in
  `useDeviceBoundSlider.ts:103`): the tail grace exists to let the
  React Query refetch complete before re-allowing polling. If it is
  too short, the device-echo refetch may miss the new value. If too
  long, multiple sliders can starve polling.
- **`STOP_MACHINE_TIMEOUT_MS = 6000`**
  (`usePlaybackController.ts:223`): Stop transport waits up to 6 s
  for the device to acknowledge. If a Pause is racing a Stop, the
  user can experience a "frozen" Pause button for that window.
- **`machineTransitionCoordinatorRef`**: serialises pause/resume
  requests by target. Two rapid Pause taps superseded each other,
  which is correct behavior; but the surface area is wider than
  documented in `usePlaybackController.ts` and worth confirming on
  P2.
