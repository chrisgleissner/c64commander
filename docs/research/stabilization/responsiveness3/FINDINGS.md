# FINDINGS — Stabilization Refuel (Responsiveness 3, Stage 1)

Investigation 2026-05-18 on branch `feat/reduce-latency-and-fix-errors2` against
HEAD `d7325920` (PR #258 merged). Evidence under `evidence/`.

Conventions:

- **Confidence: High** = direct code + runtime evidence; **Medium** = direct code,
  runtime evidence indirect; **Low** = code suspicion, runtime evidence pending.
- IDs use the `F3-` prefix to avoid collision with responsiveness2's `F-` IDs.
- File paths and line numbers are accurate as of `d7325920`.

The new findings are clustered around five themes:

1. Cold-boot REST storm extends far beyond what F-HTTP-2 closed (F3-HTTP-1..5).
2. Telnet capability discovery is a noisy, repeatable, single-threaded source of
   bridge-thread contention (F3-TELNET-1..4).
3. The polling-pause registry is wired into only one consumer; everything else
   that polls still races user interaction (F3-PAUSE-1..3).
4. Visibility-resume reconciler replays the cold-boot storm on every WebView
   resume (F3-RESUME-1).
5. App-config snapshot capture pays the storm a second time on first connect
   (F3-CACHE-1).

Plus three smaller items: F3-NAV-1 (saved-device probe on backgrounded app),
F3-LOG-1 (silent-catch audit), F3-ERR-1 (config-cache reset destroys enrichment
on host change).

---

## F3-HTTP-1 (CRITICAL, Confidence: High) — Cold-boot REST storm: 95 sequential CapacitorHttp requests over 11 s before Home reaches steady state

- **Symptom**: After `am force-stop` + `am start` against `c64u` (active saved
  device), the app issues 95 individual `Handling CapacitorHttp request: …`
  lines between `+0.7 s` and `+11.4 s` post-bridge-load, before Home is fully
  populated.
- **Reproduction**: `evidence/baseline-u64-cold-start.txt`, `evidence/baseline-
  u64-cold-logcat-12s.txt` (Pixel 4 `9B081FFAZ001WX`, version 0.7.9-rc1 debug,
  `TotalTime: 606 ms`). Second cold boot (`evidence/baseline-cold-c64u-2-
  logcat.txt`, `TotalTime: 572 ms`) reproduces the same total: 95 REST + 74
  Telnet plugin calls. The reproducibility rules out a one-off race.
- **Breakdown by category** (counted via `grep | awk -F'%2Fconfigs%2F'`):

  | Category | Reads | Comment |
  | --- | --- | --- |
  | U64 Specific Settings | 13 | Home `useC64ConfigItems` + cartridge sub-items |
  | Printer Settings | 12 | One per item in the Printers card |
  | UltiSID Configuration | 9 | One per SID metadata item |
  | SID Sockets Configuration | 9 | One per socket meta |
  | Audio Mixer | 9 | One per volume/pan slot |
  | SID Addressing | 5 | One per address |
  | User Interface Settings | 4 | UISummaryCard |
  | SoftIEC Drive Settings | 4 | DriveCard |
  | Drive A Settings | 4 | DriveCard |
  | Drive B Settings | 4 | DriveCard |
  | Data Streams | 4 | StreamStatus card |
  | C64 and Cartridge Settings | 4 | Home cartridge meta |
  | LED Strip Settings | 2 | F-HTTP-2 already collapsed this |
  | (others) | ~12 | one each |

- **Root cause** (multi-part):
  1. `useC64ConfigItems` (`src/hooks/useC64Connection.ts:309-348`) wraps
     `api.getConfigItems(category, items)`.
  2. `C64API.getConfigItems` (`src/lib/c64api.ts:1248-1343`) fetches the
     category in bulk first, then iterates each requested item and calls
     `hasStructuredConfigMetadata` (`src/lib/c64api.ts:334-358`). If the value
     is a flat string (no `selected`, `options`, `values`, `min`, `max`, etc.),
     the item is added to `itemsNeedingEnrichment` and re-fetched per-key with
     `getConfigItem`.
  3. Both u64 fw 3.14e and c64u fw 1.1.0 return **flat strings** at the
     category level:

     ```bash
     $ curl -sS 'http://c64u/v1/configs/U64%20Specific%20Settings'
     { "U64 Specific Settings": {
         "C64U Model": "Starlight Edition",
         "System Mode": "PAL",
         "CPU Speed": "40",
         …
     }, "errors": [] }
     ```

     The per-item endpoint returns the structured shape that `hasStructuredConfig
     Metadata` accepts:

     ```bash
     $ curl -sS 'http://c64u/v1/configs/U64%20Specific%20Settings/CPU%20Speed'
     { "U64 Specific Settings": {
         "CPU Speed": { "current":"40","values":[…],"default":" 1" }
     }, "errors": [] }
     ```

     So **every Home item** the user can interact with (select / slider) needs
     a separate REST round-trip just to discover its allowed values. This is
     the same root cause as F-HTTP-2 from responsiveness2, but
     responsiveness2 only applied the workaround to `LED Strip Settings` and
     `Keyboard Lighting`.

- **Why not cosmetic**:
  - Per request bridge cost (CapacitorHttp marshalling) is ~100 ms on Pixel 4
    even after the cookie bypass. 95 requests serialize to ~11 s.
  - During this window the user sees Home but the cards above-the-fold (CPU
    Speed slider, Drive cards, Audio Mixer) show partial data until late
    requests land. Touching the CPU Speed slider before ~+9 s either misses
    its `values` enrichment (preview snaps weird) or competes with the storm
    for bridge time.
  - The storm runs even when the user is NOT going to open most of those
    sections — `Printer Settings` enriches every printer key before the user
    ever taps Printers.
- **Code paths**:
  - `src/hooks/useC64Connection.ts:309` `useC64ConfigItems`.
  - `src/lib/c64api.ts:1248-1343` `getConfigItems` enrichment loop (line 1315
    `if (!skipItemEnrichment && missingItems.length > 0)`).
  - `src/lib/c64api.ts:334-358` `hasStructuredConfigMetadata`.
  - `src/pages/HomePage.tsx:119-148` five `useC64ConfigItems` calls on first
    render (U64 Specific, C64 and Cartridge, LED Strip, User Interface,
    Keyboard Lighting). Some pass `HOME_LIGHTING_QUERY_OPTIONS` which set
    `skipEnrichment: true`; others use `VISIBLE_C64_QUERY_OPTIONS` which do
    not.
  - `src/pages/home/hooks/usePrinterData.ts:19`, `src/pages/home/hooks/use
    DriveData.ts:19,26,33`, `src/pages/home/hooks/useStreamData.ts:44`,
    `src/components/disks/HomeDiskManager.tsx:213,219,225` — all use the
    default enrichment path.
- **What a root fix likely requires**:
  - Decide a default-skip policy: render the Home cards with the **flat** value
    (which the category endpoint already returns) and treat enrichment as
    lazy — only fetch per-item metadata when the user actually opens the
    detail editor for that key. The CPU slider needs `values`, but it can
    use a hard-coded SI `[1,2,3,4,6,8,10,12,14,16,20,24,32,40,48,64]` list
    that is itself a stable, well-known capability of `U64 Specific Settings /
    CPU Speed` for the U64. Same for `Audio Mixer / Vol *` (0..6) and
    `Drive {A,B} Settings / Drive Type`.
  - Or persist enriched metadata per `{deviceIdentity, firmwareVersion}` in
    `localStorage` after first discovery — these values change at most once
    per firmware update, never during normal operation.
  - Or expose `__c64uSkipItemEnrichment` from every Home-tier `useC64ConfigItems`
    call by default, and add a separate `enrichConfigKey(category,item)` hook
    that callers invoke lazily.
- **Tests required**:
  - Unit: cold-boot mount of `HomePage` issues ≤ 6 REST calls for `c64u` fw 1.1.0
    (one per category; no per-item enrichment).
  - Unit: when the user opens the Audio Mixer editor, the per-item enrichment
    fires for only the keys the editor needs.
  - Integration (Pixel 4): `am start -W` cold-boot logcat with `c64u` reports
    fewer than 30 total CapacitorHttp lines in the first 5 s.
- **Confidence**: High (live evidence + code).

---

## F3-HTTP-2 (HIGH, Confidence: High) — `useAppConfigState.fetchAllConfig` triggers a second pass over every category at first-connect (snapshot capture)

- **Symptom**: Inside the same cold-boot window, `useAppConfigState` (the hook
  that powers the Revert / Save Config workflow) fires its first-connect
  snapshot capture. `fetchAllConfig` (`src/hooks/useAppConfigState.ts:111-178`)
  iterates `cats.categories` at concurrency 4 and calls `getCategory(category)`
  for every category — including categories the user never opens.
- **Reproduction**: Lines `+0.7 s..+1.7 s` of `evidence/baseline-u64-cold-
  logcat-12s.txt` show category-level fetches for `LED Strip Settings`, `info`,
  `drives`, then a burst of `Drive A`, `Drive B`, `SoftIEC`, `Printer`, `SID
  Sockets`, `UltiSID`, `SID Addressing`, `Audio Mixer`, `Data Streams`, `U64
  Specific Settings`, `C64 and Cartridge`, `LED Strip Settings` (again!),
  `User Interface Settings`. The duplicate `LED Strip Settings` at +1.7 s is
  the snapshot capture racing the home-page `useC64ConfigItems` because both
  observe `status.isConnected` and fire on the same render.
- **Root cause**: `useAppConfigState` (`src/hooks/useAppConfigState.ts:217-260`)
  gates capture on `status.isConnected && !hasCapturedRef.current`. The hook
  is mounted from `HomePageContent`. There is no de-duplication between
  category fetches issued by `useC64ConfigItems` and category fetches issued
  by `fetchAllConfig` — they each go through `api.getCategory`, and although
  the API now reuses its `configCategoryItemsCache` (F-HTTP-2 fix), the cache
  lookup happens only inside `getCachedCategory`, not before the bare
  `getCategory` call inside `fetchAllConfig.readCategorySnapshot`. The
  result is two REST calls per category in the worst case.
- **Why not cosmetic**:
  - Doubles the cold-boot HTTP cost on a path that does not need it. The
    snapshot is only used by the Revert flow; deferring it to first use is
    legal.
  - The duplicate read for LED Strip Settings is visible in the logcat at
    +1.7 s (one call from `useC64ConfigItems`, one from `fetchAllConfig`
    going round the cache).
- **Code paths**:
  - `src/hooks/useAppConfigState.ts:111-178` `fetchAllConfig` (concurrency 4).
  - `src/hooks/useAppConfigState.ts:116-122` `readCategorySnapshot` calls
    `getCachedCategory` before falling through, but the cache is only
    populated after `getConfigItems` has run — at this point `useC64Config
    Items` has only fired for the 5 Home categories, so the other ~13
    categories miss.
  - `src/hooks/useAppConfigState.ts:204-260` mount-time capture trigger.
- **What a root fix likely requires**:
  - Defer snapshot capture until the user requests a Save or first writes a
    config (lazy capture). The Revert button can prompt "capture now" on first
    open if no snapshot exists yet.
  - Or, gate on a debounced "device idle for 3 s after first paint" rather
    than on `status.isConnected`.
  - Or coalesce against the home-page `useC64ConfigItems` queries by hitting
    the React Query cache before the API cache.
- **Tests required**:
  - Unit: `fetchAllConfig` is not invoked from `useAppConfigState` mount until
    the user has interacted with `Save` / `Revert` or after 5 s idle.
  - Integration: cold-boot logcat contains no duplicate `LED Strip Settings`
    REST line in the first 3 s.
- **Confidence**: High.

---

## F3-HTTP-3 (HIGH, Confidence: High) — `useC64Drives` 30 s polling does not consult `pollingPauseRegistry`

- **Symptom hypothesis**: A user dragging the Home CPU slider while a 30 s
  `useC64Drives` refetch tick lands competes with the slider's REST writes for
  the single CapacitorHttp + single-thread bridge. The slider's preview write
  serializes behind `GET /v1/drives` (~60-80 ms bridge cost) plus the four
  drive-config follow-ups that `HomeDiskManager` fans out off the drives
  payload (`src/components/disks/HomeDiskManager.tsx:213-225`).
- **Reproduction**: not exercised live this session; the responsiveness2
  evidence (Phase 4) used `useDeviceBoundSlider` which does acquire the pause,
  but `useC64Drives` ignores the same registry.
- **Root cause**: `useC64Drives` (`src/hooks/useC64Connection.ts:458-474`) sets
  `refetchInterval: !queryActive || diagnosticsSuppressionActive ? false :
  DRIVES_POLL_INTERVAL_MS` (30 000 ms). The check is binary: either polling is
  on, or it isn't. There is no `pollingPauseRegistry.isPollingPaused()` gate.
- **Why not cosmetic**:
  - During a drag, the user's preview writes are visible jitter sources. The
    slider primitive is correct but the transport budget is contended.
  - Drives polling exists primarily so that disk-eject events from the C64
    device surface in the UI, which is a slow event class (seconds). A 30 s
    skipped tick during a 1 s slider drag does not regress UX.
- **Code paths**:
  - `src/hooks/useC64Connection.ts:458-474` `useC64Drives` polling.
  - `src/hooks/useDeviceBoundSlider.ts:131` `acquirePause` on first drag tick.
  - `src/lib/query/c64PollingGovernance.ts:53-82` `pollingPauseRegistry`.
- **What a root fix likely requires**:
  - Mirror the `useSavedDeviceHealthChecks` pattern: subscribe to
    `pollingPauseRegistry` and disable `refetchInterval` while paused.
  - Apply the same fix to `useC64Info`'s `refetchInterval`
    (`src/hooks/useC64Connection.ts:139-143`), which has the same gap.
- **Tests required**:
  - Unit: while `pollingPauseRegistry.isPollingPaused()` is true,
    `useC64Drives` issues 0 fetches over a 60 s wall-clock simulation.
- **Confidence**: High (code-level), Medium (live impact pending hardware
  evidence).

---

## F3-HTTP-4 (HIGH, Confidence: High) — `useC64Info` `/v1/info` polling does not consult `pollingPauseRegistry`

- **Symptom hypothesis**: Same race shape as F3-HTTP-3. `useC64Info` schedules
  its own `refetchInterval` based on `shouldRunScheduledHealthCheck()` and is
  blind to user interaction. While a slider drag is in flight, an info tick
  can land and force a `GET /v1/info` (typically 30-60 ms on LAN + bridge cost).
- **Root cause**: `src/hooks/useC64Connection.ts:139-143` sets `refetchInterval`
  without `pollingPauseRegistry.isPollingPaused()` consultation.
- **Why not cosmetic**:
  - `/v1/info` is read by the badge during steady state; a missed tick is fine.
  - The cost is real: each tick goes through CapacitorHttp serialization.
- **Code paths**: `src/hooks/useC64Connection.ts:111-143`.
- **What a root fix likely requires**: same shape as F3-HTTP-3.
- **Tests required**: same.
- **Confidence**: High (code-level).

---

## F3-HTTP-5 (HIGH, Confidence: High) — CapacitorHttp serializes through a single bridge thread; observed concurrency = 1

- **Symptom**: In `evidence/baseline-u64-cold-logcat-12s.txt`, every `Handling
  CapacitorHttp request: …` line is followed by the next one ~100 ms later,
  even though `Promise.allSettled(missingItems.map(...))` in
  `C64API.getConfigItems` issues them in parallel. Plotting:

  ```
  17:45:35.498 LED Strip Settings
  17:45:35.635 info
  17:45:36.347 drives
  …
  17:45:39.654 Printer Settings/Output file
  17:45:39.761 Printer Settings/Output type
  17:45:39.866 Printer Settings/Ink density
  17:45:39.976 Printer Settings/Page top margin
  ```

  Each ~105 ms apart, which is the bridge-thread throughput, not the network
  RTT (network RTT to c64u is ~5-10 ms; `curl --max-time 4 -sS http://c64u/v1/
  info` returns instantly from the dev host).
- **Root cause**: `CapacitorHttp` on Android marshals JS-side `fetch()` calls
  over JNI to a single background dispatcher thread in the Capacitor plugin,
  then runs them through OkHttp. The dispatcher is documented to be a single
  thread on Android. Promise-level concurrency on the JS side is lost.
- **Why not cosmetic**:
  - Means our cold-boot storm of 78 enrichment requests cannot be parallelised
    on Android via Capacitor regardless of how the caller writes the code.
  - Means the right fix is to **reduce the number of requests**, not to
    parallelise them further.
- **Code paths**:
  - JS side: `src/lib/c64api.ts:1316` `Promise.allSettled`.
  - Native: Capacitor plugin's HTTP dispatcher (vendored; not under our
    control).
- **What a root fix likely requires**:
  - Treat CapacitorHttp throughput as ~10 requests/second. Every cold-boot
    optimisation must reduce request count, not just parallelise them.
  - Optional: route hot config reads around CapacitorHttp via a small native
    HTTP plugin that uses OkHttp on its own thread pool (effectively an
    "HttpClient2" plugin). Only worth it if F3-HTTP-1 and F3-HTTP-2 are not
    enough.
- **Tests required**:
  - Bench: mock 10 sequential `getConfigItem` calls and assert wall-clock cost
    is roughly 10 × per-call bridge cost; this captures the assumption so
    that any future "we made it parallel" claim is verifiable.
- **Confidence**: High (live timestamps).

---

## F3-TELNET-1 (HIGH, Confidence: High) — Telnet capability discovery runs multiple times during cold boot because the cache key changes as `deviceInfo` populates

- **Symptom**: Four full Telnet connect/disconnect cycles in the first 17 s of
  cold boot (`evidence/baseline-u64-cold-logcat-12s.txt`):

  ```
  17:45:36.347 connect 192.168.1.167:23
  17:45:38.937 disconnect
  17:45:38.952 connect
  17:45:43.961 disconnect
  17:45:43.977 connect
  17:45:50.962 disconnect
  17:45:51.004 connect
  ```

  Each cycle issues `connect → read(2000) → send(0x1b[11~) → read(700) ×N →
  disconnect`. The total Telnet plugin call count for the first 12 s is 74.
- **Root cause**: `src/hooks/useTelnetActions.ts:273-306` is a `useEffect` that
  depends on `capabilityCacheKey`. The cache key is built from
  `status.deviceInfo` (`buildTelnetCapabilityCacheKey` in `src/lib/telnet/
  telnetCapabilityDiscovery.ts:87`) which uses `unique_id|hostname|product|
  firmware_version`. Before `/v1/info` returns, `deviceInfo` is `null` and the
  cache key falls back to `host` only. After `/v1/info` completes, the cache
  key changes — and because the new key was never populated, discovery
  re-runs. Subsequent capability cache misses repeat as React renders
  re-evaluate `status.deviceInfo` (which can briefly transition between
  partial shapes).
- **Why not cosmetic**:
  - Adds ~14 s of single-socket Telnet traffic to cold boot, in addition to
    the REST storm.
  - Each capability discovery cycle holds the single Telnet socket open for
    multiple seconds, so the **health-check** TELNET probe (which lives in
    `healthCheckEngine.ts`) blocks behind it. This was the regression that
    responsiveness2 patched by routing capability discovery through
    `withTelnetInteraction` — but that only serializes the two within the
    same `deviceInteractionManager`. The capability discovery still runs
    multiple times.
- **Code paths**:
  - `src/hooks/useTelnetActions.ts:273-306` useEffect.
  - `src/lib/telnet/telnetCapabilityDiscovery.ts:72-93` in-memory `capability
    Cache` Map.
- **What a root fix likely requires**:
  - Gate the discovery effect on `status.isConnected && status.deviceInfo !=
    null` so that the first discovery cycle uses the populated key.
  - Persist the cache to `localStorage` keyed by `unique_id|firmware_version`
    so cold boot reuses the prior run's discovery output (capabilities only
    change on firmware upgrade).
- **Tests required**:
  - Unit: capability discovery runs exactly once per cold mount when
    `deviceInfo` transitions from null → populated → unchanged.
  - Integration (Pixel 4): cold-boot logcat contains exactly 1 Telnet
    connect/disconnect pair during the first 30 s (one capability discovery
    + 0 health probes is also acceptable if the saved-device probe stays
    paused).
- **Confidence**: High.

---

## F3-TELNET-2 (HIGH, Confidence: High) — `capabilityCache` is in-memory only; every app start re-discovers from scratch

- **Symptom**: Cold boot pays at least one full Telnet discovery cycle (~3-5 s
  wall clock) every time. Warm restart (Capacitor activity restart without app
  process kill) avoids it because the Map survives.
- **Root cause**: `src/lib/telnet/telnetCapabilityDiscovery.ts:72`
  `const capabilityCache = new Map<string, TelnetCapabilitySnapshot>();` —
  module-scoped, lost on process kill, never persisted.
- **Why not cosmetic**:
  - Capability discovery is a multi-screen Telnet menu walk. It is the slowest
    deterministic operation in the cold-boot path (~3-5 s).
  - The discovery result is a function of `{firmware version, product type}`
    — invariant for an order of magnitude longer than a session.
- **Code paths**: as above.
- **What a root fix likely requires**:
  - Persist `capabilityCache` to `localStorage` keyed by `unique_id|menuKey|
    firmware_version`. Invalidate on firmware change.
  - Optional: ship a built-in JSON capability map for known firmware versions
    of `Ultimate 64 Elite` and `C64 Ultimate`, used as default until first
    real discovery proves it correct (and the discovery can then run in the
    background after the first interactive frame).
- **Tests required**:
  - Unit: after a fresh process start, the persisted capability snapshot for
    `c64u fw 1.1.0` is loaded without a network round-trip.
- **Confidence**: High.

---

## F3-TELNET-3 (HIGH, Confidence: High) — `TelnetSocketPlugin` uses a single-thread executor; capability discovery serializes against TELNET health-check probe and any user-initiated Telnet action

- **Symptom**: The Kotlin plugin holds `private val executor = Executors.new
  SingleThreadExecutor()`. All plugin method invocations (`connect`, `read`,
  `send`, `disconnect`) submit to that one thread. A second caller cannot run
  in parallel.
- **Root cause**: `android/app/src/main/java/uk/gleissner/c64commander/Telnet
  SocketPlugin.kt:27` literal. Combined with the single `socket: Socket?`
  field (line 36), it is structurally impossible for the plugin to support two
  concurrent Telnet sessions even though `withTelnetInteraction` enforces it
  on the JS side.
- **Why not cosmetic**:
  - Any "we should also run X over Telnet while Y is in flight" optimisation
    will silently fail on Android.
  - User experience consequence: pressing a Telnet-only action (e.g. "Save
    REU snapshot") while capability discovery is still running blocks the
    button until discovery completes.
- **Code paths**:
  - `android/app/src/main/java/uk/gleissner/c64commander/TelnetSocketPlugin.kt
    :27,36-38` (state).
  - `src/lib/deviceInteraction/deviceInteractionManager.ts` `withTelnetInter
    action` already serializes on the JS side.
- **What a root fix likely requires**:
  - Document the contract explicitly. Acceptable today because the JS-side
    `withTelnetInteraction` mirrors the constraint.
  - If concurrency is wanted later (e.g. read-only ANSI scrape while user
    sends a key), refactor the plugin to support multiple `Socket`s keyed
    by a `sessionId` arg; significant work.
- **Tests required**: structural assertion in `TelnetSocketPluginTest.kt`
  that the executor is single-thread and that submitting two `connect()` calls
  back-to-back serialises (i.e. the second observes the first's socket).
- **Confidence**: High (direct code).

---

## F3-TELNET-4 (MEDIUM, Confidence: High) — `disconnect()` resolves `()` (no payload) on caught exception, but `connect/send/read` resolve `JSObject()` — asymmetric success-shape

- **Symptom**: `android/app/src/main/java/uk/gleissner/c64commander/Telnet
  SocketPlugin.kt:97-106`: `disconnect`'s catch arm calls `call.resolve()`,
  not `call.resolve(JSObject())`. Responsiveness2's F-LOG-1 fix changed
  `connect/disconnect/send` success paths to `JSObject()` to avoid the bridge
  bug, but this one remained because the catch arm is the only place left
  that resolves with no payload.
- **Root cause**: code path missed during the F-LOG-1 patch.
- **Why not cosmetic**: in the rare case `disconnect` throws (e.g. I/O closing
  a half-open socket), the bridge logs `File:  - Line 353 - Msg: undefined`
  again, reintroducing the noise floor F-LOG-1 closed.
- **Code paths**: as above.
- **What a root fix likely requires**: replace `call.resolve()` with `call.
  resolve(JSObject())` and add a JVM unit test that drives the catch arm.
- **Tests required**: `TelnetSocketPluginTest.kt::disconnect emits empty
  object payload even when stream close throws`.
- **Confidence**: High (code-level).

---

## F3-PAUSE-1 (HIGH, Confidence: High) — Volume mute toggle does NOT acquire `pollingPauseRegistry`

- **Symptom hypothesis**: Tapping the Play page Mute button while a saved-
  device health-check tick lands (or a `useC64Drives` tick lands) sends the
  mute write through CapacitorHttp behind those reads, so the device-side
  audio mixer write is delayed by the bridge queue depth.
- **Reproduction**: not exercised live this session.
- **Root cause**: `useVolumeOverride` writes via `useC64UpdateConfigBatch`
  but does not acquire a polling pause. `VolumeControls.tsx:43` uses
  `useDeviceBoundSlider` for the slider, which does acquire the pause for
  drag, but the mute button is a separate `Button onClick={onToggleMute}`
  that does not.
- **Why not cosmetic**:
  - User feedback: tapped Mute, audio continues for 100-300 ms while a
    background poll holds the bridge.
- **Code paths**:
  - `src/pages/playFiles/components/VolumeControls.tsx:55-66` Mute button.
  - `src/pages/playFiles/hooks/useVolumeOverride.ts` — search for `applyAudio
    MixerUpdates(... , "Manual")`; no `acquirePause` call.
- **What a root fix likely requires**:
  - Wrap the mute toggle write in a `pollingPauseRegistry.acquirePause()` /
    `release()` envelope so saved-device + drives polling stand down during
    the write.
- **Tests required**:
  - Unit: invoking `onToggleMute` while `useC64Drives` is mid-tick causes the
    drives poll to be skipped and the mute write to be the first REST call
    to the device.
- **Confidence**: High (code-level), Medium (live impact pending evidence).

---

## F3-PAUSE-2 (MEDIUM, Confidence: High) — Telnet capability discovery does not acquire `pollingPauseRegistry`

- **Symptom**: Capability discovery fires from `useTelnetActions` mount effect.
  It does call `withTelnetInteraction`, so it serialises against the saved-
  device TELNET probe inside the device-interaction manager. But it does
  NOT touch `pollingPauseRegistry`, so a slider drag or volume change that
  lands during the ~3-5 s discovery window will compete for the same
  CapacitorHttp dispatcher when its preview writes go through REST.
- **Code paths**:
  - `src/hooks/useTelnetActions.ts:198-247` `loadCapabilities`.
  - `src/lib/deviceInteraction/deviceInteractionManager.ts` `withTelnetInter
    action`.
- **What a root fix likely requires**: take a `pollingPauseRegistry` handle
  while discovery is in flight; release it on completion. This is enough to
  defer the drives poll behind the discovery (which is already happening
  serially today, so this is just making the existing behaviour explicit).
- **Tests required**: unit assertion the handle is acquired and released.
- **Confidence**: High (code-level).

---

## F3-PAUSE-3 (MEDIUM, Confidence: Medium) — `useDeviceBoundSlider` releases the polling pause as soon as `commit` finishes, before the device echoes the value

- **Symptom hypothesis**: The polling pause is released immediately on `commit`
  resolve. If the device-side echo lags behind by 100-300 ms (e.g. firmware
  serialisation through its config tree), and a `useC64Drives` tick was
  queued behind the pause, the tick will fire **before** the next slider
  preview's echo, leaving the slider's pending state visible while the drives
  read is in flight. Visually: thumb sits one step behind the user's last
  release for ~50-150 ms.
- **Reproduction**: not exercised live this session.
- **Root cause**: `src/hooks/useDeviceBoundSlider.ts:131` acquires; the
  release path is in the same hook, fired when commit lane settles. The
  release is tied to the write completing, not to the echo arriving.
- **Why not cosmetic**:
  - Mute / volume slider gestures observe the same shape.
- **Code paths**: `src/hooks/useDeviceBoundSlider.ts:131-200ish` (release
  location TBD; the file is dense — exact line to confirm in stage 2).
- **What a root fix likely requires**:
  - Tail-grace the pause for ~250 ms after `commit` resolves before releasing.
- **Tests required**: unit test asserting the registry's count is still 1 at
  `commit + 100 ms` and 0 at `commit + 300 ms`.
- **Confidence**: Medium (live impact pending evidence).

---

## F3-RESUME-1 (HIGH, Confidence: High) — `runConfigReconciler` replays the cold-boot storm on every WebView resume

- **Symptom**: Every WebView `visibilitychange` → visible transition triggers
  `runConfigReconciler` (`src/App.tsx:84-94`), which calls
  `invalidateForVisibilityResume` in `src/lib/query/c64QueryInvalidation.ts:
  117-121`. That function invalidates AND refetches every active query that
  matches the current route prefix — for `/` that's `c64-info`, `c64-drives`,
  `c64-config-items`. The `c64-config-items` prefix matches all five Home
  config-items queries, each of which triggers a fresh `getConfigItems` call,
  which (because the device returns flat strings) replays the per-item
  enrichment storm.
- **Reproduction**: not exercised live this session — but the same pattern is
  reproduced indirectly by `am start` of a backgrounded app (warm restart
  with no process kill). The warm-restart logcat
  `evidence/baseline-c64u-warm-logcat.txt` shows 0 REST calls, which suggests
  the warm path skips this — but that's because the app was already in the
  foreground; visibility didn't actually change. A real Android background→
  foreground transition would.
- **Root cause**:
  - `src/App.tsx:84-94` `visibilitychange` → `runConfigReconciler`.
  - `src/lib/diagnostics/diagnosticsReconciler.ts:77-125` `runConfigReconciler`
    → `invalidateForVisibilityResume`.
  - `src/lib/query/c64QueryInvalidation.ts:117-121`
    `invalidateByPrefix + refetchActiveByPrefix` for `c64-info`, `c64-drives`,
    `c64-config-items`.
- **Why not cosmetic**:
  - On Android, locking the phone and unlocking it within seconds triggers
    `visibilitychange`. Each unlock pays the full enrichment storm.
- **Code paths**: as above.
- **What a root fix likely requires**:
  - Track the last reconcile time per query prefix; if the last refetch was
    < 30 s ago, skip the prefix.
  - Or change `invalidateForVisibilityResume` to call only `invalidateQueries`
    (mark stale) without `refetchActive`. React Query's next user-driven
    consumer will read the stale data and refetch on demand.
  - Or restrict the invalidation list to `c64-info` only (the badge cares;
    nothing else changes during a screen lock).
- **Tests required**:
  - Unit: dispatching `visibilitychange` to visible state with the current
    pathname `/` issues 0 immediate `getConfigItems` calls.
- **Confidence**: High (code-level).

---

## F3-CACHE-1 (HIGH, Confidence: High) — `C64API.configCategoryItemsCache` is in-memory only and cleared on every host change

- **Symptom**: Switching saved devices (e.g. user picks c64u → u64) resets
  the enriched-options cache (`src/lib/c64api.ts:392-409` `setBaseUrl`,
  `setPassword`, `setDeviceHost` all call `resetRequestReadState`, which
  clears `configCategoryItemsCache`). Cold boot starts with the cache empty
  for the same reason: it's a `Map` on the singleton, lost on process kill.
- **Reproduction**: code-level. Live evidence is the storm itself — if the
  cache survived cold boot we wouldn't need 78 enrichment requests.
- **Root cause**:
  - `src/lib/c64api.ts:382` `private readonly configCategoryItemsCache = new
    Map<…>()`.
  - `src/lib/c64api.ts:534-538` `resetRequestReadState` clears it.
  - `src/lib/c64api.ts:392-409` every host-config setter calls
    `resetRequestReadState`.
- **Why not cosmetic**:
  - Wipes out the entire enrichment work on every device switch, even when
    the new device has the same firmware version. The Revert/Save snapshot
    in `localStorage` lives on past app restarts, but the enriched
    `options/values/min/max` metadata that costs 78 requests to discover
    does not.
- **Code paths**: as above.
- **What a root fix likely requires**:
  - Promote `configCategoryItemsCache` to a `localStorage`-backed object,
    keyed by `unique_id|firmware_version|category`. Persist on every write
    via `rememberConfigCategoryItems`.
  - On `setBaseUrl`, switch the lookup key, do not destroy the map.
- **Tests required**:
  - Unit: after `setBaseUrl(c64uUrl)` followed by `setBaseUrl(u64Url)`,
    subsequent `getConfigItems('U64 Specific Settings', items)` for u64
    populates from the c64u-keyed cache for items present in both, requiring
    0 enrichment requests for those items. (Cache key must NOT cross devices
    unless the firmware ABI is known compatible.)
- **Confidence**: High (code-level).

---

## F3-NAV-1 (MEDIUM, Confidence: Medium) — Saved-device probe traffic continues to fire after `KEYCODE_HOME` while app is backgrounded

- **Symptom**: In `evidence/nav-to-play-2-logcat.txt`, after pressing the
  Android home key (which backgrounded the app), the next 5 s of logcat
  contained 12 CapacitorHttp lines targeted at `192.168.1.167` (the active
  saved device, c64u) and 12 TelnetSocket plugin calls. Categories hit:
  `LED Strip Settings`, `User Interface Settings`, `Drive A Settings (×3)`,
  `Drive B Settings (×3)`, `SoftIEC Drive Settings (×3)`. This is the
  per-item enrichment storm replaying.
- **Reproduction**: pressing `KEYCODE_HOME`, waiting 5 s, captured logcat.
- **Root cause hypothesis**: the WebView keeps running JS for a brief grace
  period after the activity moves to background. The `useScreenActivity`
  hook may not flip to "background" fast enough — or the React Query
  `enabled: queryActive` predicate (`queryActive = screenActive && ...`) is
  evaluating during the visibilitychange grace window where `document.hidden`
  has not yet flipped.
- **Why not cosmetic**:
  - Battery / mobile-data cost during multitasking.
  - The screenshot of the same window confirmed the app was not the front
    app, so this is genuinely backgrounded traffic.
- **Code paths**:
  - `src/hooks/useScreenActivity.tsx` — confirm visibilitychange handling.
  - `src/lib/connection/connectionManager.ts:39` `DiscoveryTrigger` includes
    `"resume"`, suggesting the manager does see pause/resume — check the
    flip latency.
- **What a root fix likely requires**:
  - Cancel in-flight CapacitorHttp requests on `document.hidden=true`.
  - Stop refetch loops within one frame of visibility change.
- **Tests required**:
  - Integration (Pixel 4): `am force-stop` baseline; foreground 5 s;
    `input keyevent KEYCODE_HOME`; assert next 5 s of logcat contains 0
    `Handling CapacitorHttp request` lines.
- **Confidence**: Medium (need to confirm the hypothesis with a clean test).

---

## F3-LOG-1 (LOW, Confidence: Medium) — 36 `} catch { ... }` blocks across `src/**`; most are harmless URL parsers but the pattern is uneven

- **Symptom**: `grep -rnE '} catch \{$|} catch [_e]+ \{$' src/` returns 36 hits.
  Spot-checked sites:
  - `src/hooks/useHealthState.ts:61` — wraps `new URL(url, base)`, returns
    null. Acceptable.
  - `src/lib/secureStorage.ts:51` — wraps reading from secure storage.
    Returns null. Acceptable if the caller treats `null` as "not stored",
    but every caller should be checked.
  - `src/lib/hvsc/hvscBrowseIndexStore.ts:198, 348, 368, 394, 406, 417, 546,
    837` — eight sites in one file. Many wrap JSON parses; most return null.
    Worth a focused audit because HVSC ingestion failure modes have been
    a past pain point.
- **Root cause**: an unwritten convention; project lacks a `no-empty-catch`
  ESLint rule.
- **Why not cosmetic**:
  - F-LOG-1 (responsiveness2) noted: the absence of a `no-console` ESLint
    rule is what allowed the `Msg: undefined` storm to enter the codebase.
    Bare-catch is the next class along the same axis: noise-free failures
    that surface as "feature silently broken" later.
- **What a root fix likely requires**:
  - Add a focused ESLint rule banning `catch { ... }` and `catch (_) { ...
    }` in `src/lib/**`, allowing it only in `src/lib/tracing/**` and `src/
    lib/sid/**` where best-effort parsing is the contract.
  - Audit `hvscBrowseIndexStore.ts` in particular.
- **Tests required**: ESLint config gate.
- **Confidence**: Low (this finding is a code-health concern, not a live
  defect).

---

## Cross-cutting observations

- **The cold-boot REST storm is the single biggest open defect.** F3-HTTP-1
  and F3-CACHE-1 together account for 78 of the 95 cold-boot requests.
  Fixing them collapses the cold-boot window from ~11 s to ~2 s, with
  knock-on improvements to F3-HTTP-2 (snapshot capture no longer races),
  F3-RESUME-1 (resume replays a smaller storm), and F3-PAUSE-{1,2,3}
  (less bridge contention to fight over).
- **CapacitorHttp is a single bridge thread.** F3-HTTP-5 anchors a hard
  constraint: until and unless we route around CapacitorHttp, request count
  is the only knob.
- **TelnetSocketPlugin is single-thread + single-socket.** F3-TELNET-3
  documents the structural limit so future work doesn't waste cycles trying
  to parallelise on top of it.
- **Polling-pause coverage is incomplete.** Three more consumers (volume
  mute, drives polling, info polling) still bypass `pollingPauseRegistry`.

## Open hypotheses (Confidence: Low) — pending live evidence

- **H3-RESUME-1**: If we lock the Pixel screen with the app foregrounded and
  unlock, do all five Home `c64-config-items` queries refetch? F3-RESUME-1
  is built on code reading; a direct logcat capture would confirm.
- **H3-NAV-1**: Does the saved-device probe actually fire while the app is
  backgrounded, or are the 12 reqs in `evidence/nav-to-play-2-logcat.txt`
  actually the home-key tap mis-hitting a tab and re-rendering? Re-run with
  cleaner intent.
- **H3-RT-1**: After fixing F3-HTTP-1, do slider drags still see jitter from
  background polling, or does the storm reduction alone hide F3-HTTP-{3,4}?
