# C64 Commander Reliability Analysis 1

Date: 2026-03-06
Scope: Architectural reliability investigation and deterministic test planning (no production code changes)

## 1. Executive summary

- Issue 1 (volume slider + mute) is most likely a UI/device state desynchronization problem caused by async update ordering and non-throwing failure handling in the volume write path.
- Issue 2 (auto-advance) has partial robustness for background/lock but is constrained by timer/lifecycle behavior and currently applies duration-based auto-advance only to song categories (`sid`, `mod`), not all playable formats.
- Issue 3 (stuck highlight) is implemented with a short timer (`220 ms`) and should clear under normal event-loop progress; indefinite highlights are most plausible when timers are delayed by main-thread stalls/background suspension or when persistent-active semantics are misapplied.
- Issue 4 and Issue 5 (HVSC + low-resource stability) show clear memory pressure risks on non-native ingestion paths: full-buffer download accumulation, zip extraction materialization, and repeated base64 encode/decode overhead.
- Issue 6 (RAM restore) currently writes a full 64 KiB block with a `15 s` timeout and retry-on-failure behavior; this does not satisfy the "chunked transfer" constraint and is a credible cause of restore instability compared with simpler working scripts.

## 2. Description of each issue

### Issue 1: Volume slider and mute state

- Symptom: slider changes occasionally do not match effective audio volume; mute/unmute can become stuck.
- Primary concern: state transitions happen optimistically in UI even when config writes fail or race.

### Issue 2: Playback auto-advance

- Expected: when track duration completes, move to next playlist item.
- Duration rules required: SID via Songlengths/MD5 fallback, otherwise configured duration; non-SID formats also should use configured duration.
- Primary concern: due-timer logic is sensitive to lifecycle and currently only arms for song categories.

### Issue 3: Button highlight state

- Expected: transient tap highlight (~250 ms), except explicit long-running actions.
- Primary concern: timer-based clear can be delayed indefinitely if the JS event loop is blocked/suspended.

### Issue 4: HVSC download and ingestion

- Primary concerns: memory usage, background/lifecycle behavior, cancellation robustness, and archive processing strategy.

### Issue 5: Low-resource device stability

- Target: <1 GB RAM, <=2 cores.
- Primary concerns: burst allocations, base64 expansion, large in-memory snapshots, and long synchronous loops.

### Issue 6: C64U RAM dump and restore

- Constraint: transfer must be chunked.
- Primary concern: app restore path currently uses full-image write semantics and aggressive retry/timeout behavior.

## 3. Exact code locations involved

### Issue 1: Volume/mute path

- UI control wiring:
  - `src/pages/playFiles/components/VolumeControls.tsx:41-67`
  - `src/pages/PlayFilesPage.tsx:989-1001`
- State reducer and sync guard:
  - `src/pages/playFiles/volumeState.ts:15-40`
  - `src/pages/playFiles/playbackGuards.ts:28-37`
- Core hook and async update behavior:
  - `src/pages/playFiles/hooks/useVolumeOverride.ts:266-302` (debounced `setTimeout` update)
  - `src/pages/playFiles/hooks/useVolumeOverride.ts:322-345` (async change + commit)
  - `src/pages/playFiles/hooks/useVolumeOverride.ts:347-374` (mute/unmute)
  - `src/pages/playFiles/hooks/useVolumeOverride.ts:386-431` (sync-back from device values)
  - `src/pages/playFiles/hooks/useVolumeOverride.ts:156-185` (`applyAudioMixerUpdates`, logs but does not rethrow for normal volume/mute contexts)
- Slider async queue:
  - `src/components/ui/slider.tsx:165-180`, `src/components/ui/slider.tsx:230`, `src/components/ui/slider.tsx:240`
  - `src/lib/ui/sliderBehavior.ts:66-117`
- Playback-end restore:
  - `src/pages/PlayFilesPage.tsx:789-799`

### Issue 2: Auto-advance/lifecycle path

- Timeline reconciliation and interval:
  - `src/pages/PlayFilesPage.tsx:546-563`
  - `src/pages/PlayFilesPage.tsx:565-570`
- Background due event hookup:
  - `src/pages/PlayFilesPage.tsx:574-595`
  - `src/lib/native/backgroundExecution.ts:13-50`
- Guard creation and due scheduling:
  - `src/pages/playFiles/hooks/usePlaybackController.ts:293-321`
  - `src/pages/playFiles/hooks/usePlaybackController.ts:509-560`
  - `src/pages/playFiles/hooks/usePlaybackController.ts:473-478` (pause/resume due recompute)
- Duration resolution:
  - `src/pages/playFiles/hooks/usePlaybackController.ts:164-198` (local SID songlength+MD5)
  - `src/pages/playFiles/hooks/usePlaybackController.ts:200-221`, `250-259` (ultimate SID MD5)
  - `src/pages/playFiles/hooks/useSonglengths.ts:426-453`, `482-491`
  - `src/pages/playFiles/playFilesUtils.ts:61` (`isSongCategory` is only `sid`/`mod`)
- Resume triggers:
  - `src/pages/playFiles/hooks/usePlaybackResumeTriggers.ts:9-29`
- Native background implementations:
  - Android: `android/app/src/main/java/uk/gleissner/c64commander/BackgroundExecutionPlugin.kt:30-40`, `94-107`
  - Android service due watchdog: `android/app/src/main/java/uk/gleissner/c64commander/BackgroundExecutionService.kt:367-426`
  - iOS due timer: `ios/App/App/AppDelegate.swift:420-455`
  - Web fallback timer: `src/lib/native/backgroundExecution.web.ts:66-94`

### Issue 3: Button highlight path

- Interaction model:
  - `src/lib/ui/buttonInteraction.ts:13-15`, `34-48`, `55-57`, `71-79`, `82-94`
- Button integration:
  - `src/components/ui/button.tsx:55-58`
- Highlight CSS:
  - `src/index.css:203-206`
- Global registration:
  - `src/App.tsx:195-200`
- Persistent-active usage example:
  - `src/pages/playFiles/components/PlaybackControlsCard.tsx:122`

### Issue 4: HVSC download/ingestion path

- Runtime orchestration:
  - `src/lib/hvsc/hvscIngestionRuntime.ts:169-192` (stale recovery)
  - `src/lib/hvsc/hvscIngestionRuntime.ts:374-607` (non-native ingest core)
  - `src/lib/hvsc/hvscIngestionRuntime.ts:609-712` (native ingest bridge)
  - `src/lib/hvsc/hvscIngestionRuntime.ts:716-947` (install/update)
  - `src/lib/hvsc/hvscIngestionRuntime.ts:951-1114` (cached ingest)
  - `src/lib/hvsc/hvscIngestionRuntime.ts:1118-1137` (cancel)
- Download and archive reads:
  - `src/lib/hvsc/hvscDownload.ts:130-177` (`streamToBuffer` grows dynamic buffer)
  - `src/lib/hvsc/hvscDownload.ts:324-357` (`readArchiveBuffer`, bridge guard)
  - `src/lib/hvsc/hvscDownload.ts:384-546` (download engine)
- Extraction:
  - `src/lib/hvsc/hvscArchiveExtraction.ts:68-130` (zip extraction materializes all files first)
  - `src/lib/hvsc/hvscArchiveExtraction.ts:146-228` (7z iterative processing)
- Filesystem bridge/base64:
  - `src/lib/hvsc/hvscFilesystem.ts:23` (`MAX_BRIDGE_READ_BYTES`)
  - `src/lib/hvsc/hvscFilesystem.ts:31-37`, `306-313`, `338-341` (base64 conversions)
- Large snapshot persistence:
  - `src/lib/hvsc/hvscBrowseIndexStore.ts:35-40`, `283-303`, `337-341`
- UI hook interactions:
  - `src/pages/playFiles/hooks/useHvscLibrary.ts:264-420` (progress listener + throttle)
  - `src/pages/playFiles/hooks/useHvscLibrary.ts:511-710` (install/ingest)
  - `src/pages/playFiles/hooks/useHvscLibrary.ts:712-761` (cancel)
- Android native ingestion:
  - `android/app/src/main/java/uk/gleissner/c64commander/HvscIngestionPlugin.kt:274-438`, `440-578`, `580-723`, `753-757`

### Issue 5: Low-resource stability hotspots

- Non-native HVSC buffering/extraction: `src/lib/hvsc/hvscDownload.ts:130-177`, `src/lib/hvsc/hvscArchiveExtraction.ts:68-130`
- Base64 archive/file writes: `src/lib/hvsc/hvscFilesystem.ts:31-37`, `338-341`
- Large index snapshot serialization: `src/lib/hvsc/hvscBrowseIndexStore.ts:283-303`
- Full-RAM buffer ops: `src/lib/machine/ramOperations.ts:133`, `174-194`, `276-289`
- Existing low-end adaptive logic is UI-motion only: `src/lib/startup/runtimeMotionBudget.ts:79-87`, `111-117`

### Issue 6: RAM dump/restore path

- RAM operations:
  - `src/lib/machine/ramOperations.ts:18-20` (`READ_CHUNK_SIZE_BYTES=0x1000`, `WRITE_CHUNK_SIZE_BYTES=0x10000`)
  - `src/lib/machine/ramOperations.ts:174-194` (`writeFullImage` single full write)
  - `src/lib/machine/ramOperations.ts:276-289` (`loadFullRamImage` calls `writeFullImage`)
  - `src/lib/machine/ramOperations.ts:196-222` (`writeRanges` also uses large write chunk constant)
- Transport and timeout:
  - `src/lib/c64api.ts:36` (`RAM_BLOCK_WRITE_TIMEOUT_MS = 15_000`)
  - `src/lib/c64api.ts:1299-1335` (`writeMemoryBlock` POST binary)
- UI entrypoint:
  - `src/pages/home/hooks/useHomeActions.ts:184-199`
- Reference scripts:
  - `scripts/ram_read.py:8-10`, `23-37`, `46-49` (4 KiB read chunks)
  - `scripts/ram_write.py:34-48`, `71-74` (single 64 KiB write)
  - `scripts/ram_roundtrip_verify.py:20-23`, `77-90` (single write + chunked reads)

## 4. Architecture descriptions

### Volume + mute synchronization

```text
VolumeControls (UI slider/mute)
  -> useVolumeOverride local reducer (index/muted)
    -> debounced scheduleVolumeUpdate (200 ms)
      -> updateConfigBatch.mutateAsync(Audio Mixer)
    -> sync effect re-reads device config values
      -> resolveVolumeSyncDecision(pending UI target, backend index)
```

### Playback auto-advance

```text
playItem()
  -> resolve duration (songlength path -> md5 -> user fallback)
  -> set autoAdvanceGuard { trackInstanceId, dueAtMs }
  -> set native dueAtMs via BackgroundExecution plugin

while playing:
  setInterval(syncPlaybackTimeline, 1000)
  + resume triggers (visibility/focus/pageshow)
  + android backgroundAutoSkipDue event

syncPlaybackTimeline:
  if now >= dueAtMs and guard valid -> handleNext('auto')
```

### HVSC ingestion

```text
PlayFiles HVSC action
  -> hvscIngestionRuntime installOrUpdateHvsc / ingestCachedHvsc
    -> choose ingestion mode:
       native plugin OR non-native JS path

non-native:
  downloadArchive -> Uint8Array buffer
  extractArchiveEntries -> onEntry writeLibraryFile (base64) + index updates
  finalize -> save browse snapshots + reload songlengths

native (Android plugin):
  ingestHvsc(relativeArchivePath)
    stream archive entries -> write files -> batched db upserts
    emit hvscProgress -> JS summary UI
```

### RAM dump/restore

```text
dumpFullRamImage:
  pause -> readMemory 4 KiB chunks -> resume

loadFullRamImage:
  liveness check -> pause -> writeMemoryBlock at 0000 (64 KiB) -> resume
  retry on failure (default attempts=2)
```

## 5. Analysis of existing test coverage

### Unit tests

- Volume reducer/guards are covered:
  - `tests/unit/playFiles/volumeState.test.ts:12-31`
  - `tests/unit/playFiles/playbackGuards.test.ts:45-54`
- Missing for Issue 1:
  - no direct unit tests for `useVolumeOverride` async ordering and mute/unmute race paths.
- Background execution logic has unit tests:
  - `tests/unit/lib/native/backgroundExecution.web.test.ts:80-113`
  - `tests/unit/lib/native/backgroundExecutionManager.test.ts:50-103`
- HVSC runtime/download/extraction have broad unit suites:
  - `tests/unit/hvsc/hvscIngestionRuntime.test.ts:162+`
  - `tests/unit/hvsc/hvscDownload.test.ts:70+`
  - `tests/unit/hvsc/hvscArchiveExtraction.test.ts:132+`
- RAM operations unit-tested:
  - `tests/unit/machine/ramOperations.test.ts:107-129`
  - but tests do not validate chunked restore semantics against device-side constraints.
- Play page integration gap:
  - `tests/unit/pages/PlayFilesPage.test.tsx:11-14` is currently a harness placeholder only.

### Playwright

- Strong playback/volume coverage exists in web context:
  - volume and mute checks: `playwright/playback.spec.ts:315-372`
  - auto-advance and lifecycle reconciliation: `playwright/playback.spec.ts:872-941`
  - lock/unlock progression test exists: `playwright/playback.spec.ts:286-313`
  - button highlight proof exists: `playwright/buttonHighlightProof.spec.ts:8-76`
- Gap: these are not Maestro mobile-device flows and do not guarantee equivalent native mobile lifecycle behavior.

### Android JVM tests

- Background service/plugin behavior covered:
  - `android/app/src/test/java/uk/gleissner/c64commander/BackgroundExecutionServiceTest.kt:223-239`
- HVSC ingestion plugin tests are mostly shape/validation level:
  - `android/app/src/test/java/uk/gleissner/c64commander/HvscIngestionPluginTest.kt:55-139`
- Gap: no long-running ingestion stress with navigation/lock transitions.

### Maestro coverage

- Existing flows are mostly smoke:
  - playback shell only: `.maestro/smoke-playback.yaml:7-16`
  - playlist manipulation happy path: `.maestro/edge-playlist-manipulation.yaml:10-66`
  - heartbeat lock/unlock probe (not auto-advance assertion): `.maestro/smoke-background-execution.yaml:11-55`
  - HVSC controls smoke: `.maestro/smoke-hvsc.yaml:11-31`
  - HVSC lowram single-cycle smoke: `.maestro/smoke-hvsc-lowram.yaml:20-28`
- CI gating currently runs a narrow subset:
  - `scripts/run-maestro-gating.sh:482-487`, `515-519`
- `.maestro/config.yaml:12-17` excludes `slow`, `edge`, `hvsc` by default.

## 6. Failure hypotheses

### Issue 1

- H1: optimistic reducer updates (`dispatchVolume`) can diverge from device state because `applyAudioMixerUpdates` reports errors but does not throw for normal contexts (`Volume`, `Mute`, `Unmute`).
- H2: debounce + async queue ordering (`setTimeout` + microtask commit) allows stale writes to land after a later UI state transition.
- H3: `resolveVolumeSyncDecision` 2500 ms hold can defer corrective sync while backend value differs.

### Issue 2

- H1: auto-advance guard only arms for `isSongCategory` (`sid`, `mod`), so `prg/crt/disk` cannot auto-advance via duration.
- H2: if background execution start fails, foreground continues but background due events are absent during lock/suspend.
- H3: iOS due timer on main queue/background task can be suspended under long idle/lock windows.
- H4: if resume triggers are not delivered after deep idle, overdue guard may not reconcile until user interaction.

### Issue 3

- H1: highlight clear timer is starved by long main-thread tasks (extraction, heavy JSON, large loops), making a short flash appear permanent.
- H2: timers may be paused while app is backgrounded/locked, deferring clear.
- H3: persistent-active semantics may be applied to controls that are not intended long-running actions.

### Issue 4

- H1: non-native ingestion causes high peak memory from combined archive buffer + extraction data + base64 conversion.
- H2: zip extraction path currently accumulates all extracted files before processing.
- H3: when app/page is backgrounded on JS-based ingestion path, timer/task throttling can stall progress.
- H4: repeated snapshot serialization can amplify memory churn on low-end devices.

### Issue 5

- H1: OOM risk from large transient buffers and string conversions.
- H2: CPU starvation from synchronous loops (zip merge, JSON encode/decode, snapshot rebuilds) causes watchdog/timeouts and UI stalls.
- H3: low-end detection currently only adjusts animation, not ingestion/transfer workload.

### Issue 6

- H1: restore path violates chunk-transfer constraint (`WRITE_CHUNK_SIZE_BYTES=0x10000`), increasing failure/crash risk.
- H2: `RAM_BLOCK_WRITE_TIMEOUT_MS=15_000` can trigger mid-transfer timeout; retry immediately issues a second full-image write.
- H3: additional liveness/retry orchestration changes timing versus simple scripts and can expose device firmware edge cases.

## 7. Deterministic reproduction strategies

### Issue 1 (volume/mute desync)

- Preconditions:
  - Mock/real device with stable playback.
  - Debug logging enabled.
- Deterministic steps:
  1. Start playback of a SID item.
  2. Perform rapid slider sweeps (min->max->min) 30 iterations.
  3. Alternate mute/unmute 30 iterations while slider updates continue.
  4. Inject API delay/failure on `/v1/configs/Audio Mixer` for selected iterations.
- Assertions:
  - UI mute label and slider label match latest config values.
  - No stale mute state persists after final unmute.

### Issue 2 (auto-advance lock/idle)

- Preconditions:
  - Playlist with deterministic short durations (e.g., 1200 ms + long second track).
- Deterministic steps:
  1. Start playback of item 1.
  2. Lock device for > due duration, then unlock.
  3. Repeat with extended idle period (5-10 min).
  4. Repeat for `sid`, `mod`, `prg` playlists.
- Assertions:
  - Exactly one transition to next track for each due event.
  - No cascade transitions.
  - `prg/crt/disk` currently expected to fail with existing code; capture as regression target.

### Issue 3 (stuck highlight)

- Preconditions:
  - Build with test probe to expose highlight attribute state.
- Deterministic steps:
  1. Tap same button repeatedly while triggering a CPU-heavy action.
  2. Lock/unlock around tap interactions.
  3. Navigate away/back immediately after tap.
- Assertions:
  - `data-c64-tap-flash` clears within bounded time after UI resumes.

### Issue 4/5 (HVSC + low-resource)

- Preconditions:
  - low-RAM emulator/device profile and normal profile.
- Deterministic steps:
  1. Run repeated install/ingest cycles (baseline + updates) with cancellation at deterministic checkpoints.
  2. Navigate away during extraction stage and return.
  3. Lock/unlock during extraction stage and verify progress continues/catches up.
- Assertions:
  - No crash; ingestion reaches terminal `ready` or explicit `cancelled` state.
  - Progress stage transitions remain monotonic.

### Issue 6 (RAM restore)

- Preconditions:
  - Known RAM image and a device that reproduces instability.
- Deterministic steps:
  1. Run script baseline (`ram_write.py`) and record success latency.
  2. Run app restore path with equivalent image and capture request timing/order.
  3. Repeat under induced network delay (close to timeout threshold).
- Assertions:
  - Compare request count, payload sizes, timeout/retry behavior, and device stability.

## 8. Proposed fixes

### Issue 1

- Make config-write failures explicit to the caller (throw or return failure outcome) and gate reducer transitions on acknowledged writes.
- Introduce a monotonic operation token for mute/unmute + slider writes so only latest operation can mutate UI state.
- Add a post-write readback confirmation path for volume/mute convergence.

### Issue 2

- Extend duration guard to non-song categories using user-configured duration.
- Persist `dueAtMs` and guard metadata so app resume can reconcile even if timers/events were missed.
- Add platform-specific background fallback: when background plugin unavailable, force reconciliation on every resume/focus and after any transport interaction.

### Issue 3

- Add stale highlight sweeper on `visibilitychange`/`focus` and optional max-age enforcement.
- Track highlights centrally (WeakMap) and clear all on route transitions.
- Audit and narrow usage of `data-c64-persistent-active` to truly long-running states only.

### Issue 4/5

- Prefer native ingestion path on mobile; treat non-native path as constrained/debug fallback.
- Refactor zip extraction to stream entry-by-entry (no full extracted list in memory).
- Avoid base64 round-trips for large payloads where binary APIs exist.
- Add explicit ingestion checkpoints and resumable state to survive route/background transitions.

### Issue 6

- Implement chunked RAM restore writes (configurable chunk size, recommended 4-8 KiB initially).
- Raise write timeout or make adaptive per chunk, not per full image.
- Remove implicit full-image retry; retry at chunk granularity with checkpoint resume.

## 9. Proposed Maestro test flows

### New flow set (Maestro-first)

1. `edge-volume-mute-race.yaml`

- Play known SID, loop slider + mute/unmute, assert final unmute state and volume label consistency.
- Tags: `edge`, `slow`, `device`.

2. `edge-auto-advance-lock.yaml`

- Seed short-duration playlist, start track, lock/unlock, assert exactly one next-track transition.
- Tags: `edge`, `device`, `slow`.

3. `edge-auto-advance-format-matrix.yaml`

- Repeat auto-advance checks for `sid`, `mod`, `prg`, `crt` playlists with configured durations.
- Tags: `edge`, `slow`.

4. `edge-button-highlight-timeout.yaml`

- Tap target controls around heavy action and lock/unlock, assert highlight clears.
- Tags: `edge`, `slow`, `device`.

5. `edge-hvsc-ingest-lifecycle.yaml`

- Start HVSC ingest, navigate away/back, lock/unlock, assert progress resumes and terminal state reached.
- Tags: `hvsc`, `edge`, `slow`, `device`.

6. `edge-hvsc-repeat-cancel-resume.yaml`

- Repeated install/ingest cycles with deterministic cancel points and post-cancel status assertions.
- Tags: `hvsc`, `edge`, `slow`.

7. `edge-ram-restore-chunked.yaml`

- Drive RAM dump/restore sequence, verify UI success and no crash/disconnect.
- Tags: `edge`, `device`, `slow`.

### CI strategy for Maestro

- Keep current `ci-critical` smoke gate unchanged for fast CI.
- Add a scheduled/nightly lane for `+edge,+hvsc,+slow` against low-RAM and normal emulator profiles.
- Add real-device periodic lane for lock/unlock and RAM restore flows.

## 10. Risk analysis

- Issue 6 risk: Critical. Can destabilize external hardware during restore.
- Issue 4/5 risk: High. OOM and ingestion stalls on constrained devices.
- Issue 2 risk: High. Silent playback progression failures impact core UX.
- Issue 1 risk: Medium-High. User-facing trust issue in core playback controls.
- Issue 3 risk: Medium. UX degradation, but lower direct data/device risk.

Risk of remediation:

- Volume/auto-advance changes affect central playback state machine; require strict regression tests and trace assertions.
- HVSC memory/path changes affect both native and web behavior; require parity validation.
- RAM restore chunking impacts protocol timing; must validate against real C64U hardware and mock server.

## 11. Performance and memory considerations

- `streamToBuffer` dynamic growth can over-allocate and duplicate memory during expansion (`src/lib/hvsc/hvscDownload.ts:155-177`).
- zip extraction currently stores all extracted entries before processing (`src/lib/hvsc/hvscArchiveExtraction.ts:70-107`), increasing peak memory.
- base64 conversions in filesystem writes add expansion and transient string allocations (`src/lib/hvsc/hvscFilesystem.ts:31-37`, `306-313`, `338-341`).
- browse index snapshot serialization persists large JSON blobs and can spike memory (`src/lib/hvsc/hvscBrowseIndexStore.ts:283-303`).
- full-image RAM writes in one request increase timeout pressure and retry blast radius (`src/lib/machine/ramOperations.ts:174-194`, `src/lib/c64api.ts:36`, `1299-1335`).

Recommendations for low-resource profiles:

- Use smaller bounded chunks for network and file writes.
- Prefer streaming parsers and incremental index updates.
- Avoid repeated full snapshot serialization during active ingestion.
- Add memory telemetry checkpoints in ingestion flows (already partially present in Android plugin via `debugHeapLogging`).
