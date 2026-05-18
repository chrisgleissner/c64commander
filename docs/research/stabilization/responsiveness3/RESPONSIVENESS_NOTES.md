# RESPONSIVENESS_NOTES (Responsiveness 3)

Specific responsiveness observations and the model used to grade them.

This pass extends `responsiveness2/RESPONSIVENESS_NOTES.md` rather than
replacing it. The responsiveness contract is unchanged.

## What is still correctly implemented (unchanged from responsiveness2)

- `useDeviceBoundSlider` provides immediate local feedback (`draftSliderValue`)
  and pending-intent until device echo, with watchdog clearing.
- `useAuthoritativeConfigValueState` uses trim-and-coerce equality so device
  echoes like `" 4"` clear the override of `4`.
- `createLatestIntentWriteLane` collapses rapid intent to the latest job;
  older waiters complete when the latest job's version reaches `settledVersion`.
- `pollingPauseRegistry` pauses saved-device health checks during user
  interaction (responsiveness2 fix).
- Volume hook tracks `lastManualWriteRef` with a 1500 ms window to ignore
  stale device echoes.

## Where the contract is broken or fragile (delta from responsiveness2)

### R3-NOTE-1 — Cold-boot REST storm violates "Immediate local feedback" because Home renders before the data lands

`useC64ConfigItems` on Home fans out to 78 enrichment requests behind 5
parallel category bulk reads. On a Pixel 4 with c64u, the storm takes 11 s to
clear via CapacitorHttp's single-thread dispatcher. The home page is visible
during this window, but:

- The CPU Speed slider can be dragged before its `values` array is enriched.
  When the user lets go, the commit value snaps to the nearest item the
  slider thinks it can choose from (possibly the flat `"40"` string),
  producing a one-step jitter.
- The Drive cards render placeholder spinners until each `Drive A/B/SoftIEC`
  enrichment lands, ~7-9 s into cold boot.
- The Audio Mixer card's per-volume enrichment (9 reads) doesn't land until
  ~+13 s; before then the volume slider on Home shows authoritative `0`.

**Fix shape**: Default-skip enrichment on the Home hot path and render with
flat values. Lazily enrich a key only when the user opens its detail editor
(LightingStudioDialog, AudioMixer editor, SettingsPage row). Persist
enrichment per `{unique_id, firmware_version}` so the first run of a
firmware version is the only run.

### R3-NOTE-2 — Saved-device cycle is paused, but the other interval-driven consumers race the slider

`useC64Drives` (30 s) and `useC64Info` (HEALTH_CHECK_INTERVAL_MS-based) both
schedule via React Query `refetchInterval` and do **not** observe
`pollingPauseRegistry.isPollingPaused()`. The home CPU slider drag from
responsiveness2 evidence shows 0 saved-device probe traffic during the
interaction window, but a drives or info tick can still land. Each is one
bridge round trip (~80-100 ms on CapacitorHttp).

The volume Mute button on Play page also doesn't acquire a pause — it's a
plain `Button onClick` that goes straight to `applyAudioMixerUpdates` via
`useVolumeOverride`. Tapping Mute while a 30 s drives tick is mid-bridge
delays the mute write.

**Fix shape**: Subscribe `useC64Drives` and `useC64Info` to
`pollingPauseRegistry`. Wrap the mute write in `acquirePause/release`. Take
a pause for the duration of Telnet capability discovery in
`useTelnetActions`.

### R3-NOTE-3 — Polling-pause is released too eagerly

`useDeviceBoundSlider` releases the pause when `commit` resolves. The device
echo can lag the commit by 100-300 ms because the C64U firmware applies
configuration writes asynchronously. A poll tick can fire in that window,
re-reading the *old* value before the echo arrives, which makes the optimistic
override visible for an extra frame.

**Fix shape**: Tail-grace the pause for ~250 ms after commit resolves.

### R3-NOTE-4 — Cold-boot Telnet capability discovery is multi-cycle and unpersisted

Four full Telnet connect/disconnect cycles in the first 17 s of cold boot.
Each cycle takes 3-5 s. The first three are because the cache key
re-evaluates as `deviceInfo` populates from `null` → first partial → final.
The fourth (and any future) cycle is because the cache is in-memory and
never persisted to local storage.

**Fix shape**: Gate the discovery effect on a stable cache key.
`localStorage`-backed persistence keyed by `unique_id|firmware_version`.

### R3-NOTE-5 — Visibility resume replays the storm

`runConfigReconciler` in `src/App.tsx` is the most-defensive end of a chain.
Every WebView resume triggers `invalidateForVisibilityResume` which calls
both `invalidateQueries` and `refetchQueries({type: "active"})` for every
prefix matching the current route. On `/`, that's three prefixes covering
five Home queries, each of which replays the per-item enrichment storm.

**Fix shape**: Drop the `refetchQueries({type: "active"})` step. React
Query's next consumer will read the stale data and refetch on demand. Or
limit to `c64-info`. Or throttle: skip if any of the prefixes was refetched
within 30 s.

### R3-NOTE-6 — `Promise.allSettled` does not actually parallelise on Android Capacitor

Documenting a constraint, not a fix. CapacitorHttp runs one HTTP request at
a time through the bridge. JS-side concurrency primitives like
`Promise.allSettled` are collapsed inside the plugin to single-threaded
execution. Empirically: 95 requests over 11 s ≈ 9 req/s, matching the
single-bridge-thread budget.

**Implication**: Every future cold-boot optimisation must reduce request
count, not increase parallelism. R3-NOTE-1's "default-skip enrichment" is the
right shape; an alternative "make the enrichment requests parallel" would
not work.

## Cold-boot acceptance criteria (proposed for Stage 2)

| Criterion                                                                                                                 | Metric                                                                                | Target                                            |
| ------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------- | ------------------------------------------------- |
| Cold-boot total HTTP requests (Pixel 4, c64u, first 12 s)                                                                 | count of `Handling CapacitorHttp request` lines                                       | ≤ 30 (from current 95)                            |
| Cold-boot time until all Home cards painted with authoritative values                                                     | wall-clock from `am start -W` `TotalTime` baseline to last visible card update         | ≤ 3 s (from current ~11 s)                        |
| Cold-boot Telnet plugin calls (first 30 s)                                                                                | count                                                                                  | ≤ 15 (one capability discovery + ≤ 1 health probe) |
| Repeat cold-boot (no firmware change) Telnet plugin calls                                                                 | count                                                                                  | ≤ 1 (no fresh capability discovery)               |
| Saved-device switch back to a previously-visited device                                                                   | per-item enrichment requests                                                          | 0                                                  |
| `visibilitychange` to visible state (foreground after screen unlock)                                                      | immediate `getConfigItems` REST calls                                                  | 0 within 5 s of resume                            |

## Polling-pause / slider acceptance criteria (proposed for Stage 2)

| Criterion                                                                                          | Metric                                                                          | Target                                  |
| -------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------- | --------------------------------------- |
| `useC64Drives` polling during slider drag                                                          | refetches per 1 s of drag                                                       | 0                                       |
| `useC64Info` polling during slider drag                                                            | refetches per 1 s of drag                                                       | 0                                       |
| Volume mute tap during background polling                                                          | bridge requests issued between tap and audio-mixer write                        | 0                                       |
| Pause registry count after commit                                                                  | pause count at `commit + 100 ms`                                                | ≥ 1                                     |
| Pause registry count after commit + tail-grace                                                     | pause count at `commit + 300 ms`                                                | 0                                       |

## Diagnostics & noise floor acceptance criteria (proposed for Stage 2)

| Criterion                                                                          | Metric                                                            | Target                |
| ---------------------------------------------------------------------------------- | ----------------------------------------------------------------- | --------------------- |
| Backgrounded app traffic after `KEYCODE_HOME`                                       | REST + Telnet plugin calls in next 5 s                            | 0                     |
| Bare-catch sites in `src/lib/**` (excluding tracing/sid)                            | ESLint count                                                       | 0                     |
| `Msg: undefined` lines after `TelnetSocketPlugin.disconnect()` throws (rare path)   | bridge-console emissions                                          | 0                     |
| Cross-device coherence soak (60 s on u64 then switch to c64u then back to u64)      | second u64 cold mount enrichment requests                          | ≤ 6                   |

## Why the cold-boot bucket is now Priority 1

Responsiveness2 deferred most of the cold-boot story to "responsiveness later"
because the badge contract was the urgent thing. With the badge contract
locked in by PR #258, the next thing the user sees on every launch is the
storm itself, not the badge. Until the storm is reduced, every other
optimisation lives in its shadow.
