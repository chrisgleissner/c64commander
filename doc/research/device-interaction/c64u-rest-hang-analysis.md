# C64 Ultimate REST Interaction Hang Analysis

## Scope

This note investigates why rapid playback interactions from C64 Commander, especially fast mute/resume combined with volume changes, can make a C64 Ultimate become operationally unresponsive. The analysis covers:

- Client-side pacing and load-shedding in `src/lib/deviceInteraction/deviceInteractionManager.ts` and related classes
- Firmware-side REST, config, and machine-control paths in the symlinked `1541ultimate` repository
- Concrete client-side changes required to avoid driving the device into this state

The incident being explained is a hang observed earlier on March 11, 2026 while using the default `Balanced` device guard profile.

## Executive Summary

The highest-confidence root cause is not a single bug in one place. It is an interaction between:

1. A client that still allows overlapping high-cost REST mutations in hot playback paths
2. A firmware REST path that is effectively single-threaded and handles requests synchronously
3. Request handlers that perform blocking config application, temp-file body handling, and direct C64 control work inline in the REST service context

In practice, `Balanced` mode is still too permissive for playback-control traffic. It allows a mutation pattern like this:

- `PUT /v1/machine:pause` or `PUT /v1/machine:resume`
- `POST /v1/configs` for mixer writes
- extra config reads used to reconstruct SID volume state
- more immediate mixer writes from slider movement or mute toggles

Those requests can overlap or arrive back-to-back fast enough that the firmware spends most of its time inside the REST task performing synchronous work. Because the REST service is not isolated from blocking machine/config effectuation, the device can appear fully hung: REST stops responding, telnet/FTP degrade, ping may fail, and even the physical menu button can stop responding.

## Client-Side Findings

### 1. `Balanced` mode limits general concurrency, but not the dangerous mutation pattern

`src/lib/config/deviceSafetySettings.ts` sets `Balanced` to:

- `restMaxConcurrency: 2`
- `ftpMaxConcurrency: 1`

That helps general load, but it does not serialize the mutation classes that matter most here. In `src/lib/deviceInteraction/deviceInteractionManager.ts`, read caching and cooldowns exist mainly for low-cost GET endpoints such as:

- `GET /v1/info`
- `GET /v1/configs`
- `GET /v1/drives`

The manager does not apply comparable endpoint-specific cooldown or deduplication to hot mutation paths such as:

- `PUT /v1/machine:*`
- `POST /v1/configs`
- `PUT /v1/configs/...`

As a result, `Balanced` still permits overlapping mutating REST work against a device that does not appear to tolerate it well.

### 2. Playback-side mixer writes bypass the normal config write throttle

`src/lib/c64api.ts` includes `scheduleConfigWrite()` to slow down config mutations. That protection is used by `setConfigValue()`, `saveConfig()`, `loadConfig()`, and non-immediate batch updates.

The playback path does not use that protection. In `src/pages/playFiles/hooks/useVolumeOverride.ts`, mute/unmute and volume writes call:

`updateConfigBatch.mutateAsync({ category: 'Audio Mixer', updates, immediate: true })`

That `immediate: true` path bypasses the config write throttle completely. The result is that playback controls can generate a high-rate stream of `POST /v1/configs` operations.

### 3. Rapid pause/resume is not single-flight

`src/pages/playFiles/hooks/usePlaybackController.ts` performs pause/resume as a multi-request sequence:

- optional config reads to resolve current SID mixer state
- `api.machinePause()` or `api.machineResume()`
- immediate mixer writes to mute or restore channels

There is no strict single-flight guard around the whole transition. Repeated taps can enqueue overlapping pause/resume sequences while volume writes are also in flight.

### 4. Hot paths add extra config reads

`useVolumeOverride.ts` and `usePlaybackController.ts` call helpers such as:

- `resolveEnabledSidVolumeItems(true)`
- `resolveSidEnablement(true)`

Those force fresh config reads. In `src/lib/c64api.ts`, `getConfigItems()` may expand one logical read into:

- `GET /v1/configs/:category`
- plus per-item `GET /v1/configs/:category/:item` calls

So the playback path does not just emit writes. It can create mixed read/write bursts during the same user gesture.

### 5. Existing logic protects UI state better than device state

The existing debounce/token logic in `useVolumeOverride.ts` helps prevent stale UI updates, but it does not cancel already-issued network writes. Once a stale write has been sent, it still loads the device even if the UI has moved on.

## Firmware-Side Findings

## A. Is the server side single-threaded or multi-threaded?

### Answer

The firmware as a whole is multithreaded, but the REST server path is effectively single-threaded.

### Evidence

`1541ultimate/software/FreeRTOS/Source/FreeRTOSConfig.h` shows a preemptive FreeRTOS system with multiple priority classes:

- `PRIO_MAIN`
- `PRIO_USERIFACE`
- `PRIO_NETSERVICE`
- `PRIO_TCPIP`
- `PRIO_REALTIME`

So the appliance is not globally single-threaded.

However, `1541ultimate/software/network/httpd.cc` creates one HTTP listener task and runs:

- `HTTPServerRunLoop(&srv, Dispatch);`

The visible wrapper does not create per-request worker tasks. Request handling is therefore effectively serialized through the HTTP service loop.

FTP and telnet are different. `1541ultimate/software/network/ftpd.cc` and `1541ultimate/software/network/socket_gui.cc` create per-connection tasks. That makes the HTTP path the important bottleneck here, not the entire firmware.

## B. What could explain the hang?

### 1. Config writes are applied synchronously in the request path

`1541ultimate/software/api/route_configs.cc` applies config updates and then calls `at_close_config()`.

`1541ultimate/software/components/config.cc` routes that to `ConfigStore::effectuate()`, which directly calls `effectuate_settings()` on registered config objects.

That means a REST config write does not just store data. It performs hardware-affecting work inline before the request completes.

### 2. Even mixer writes rewrite hardware state immediately

In `1541ultimate/software/u64/u64_config.cc`, mixer-related effectuation writes the mixer registers directly. Even when the requested change is just a fast SID volume adjustment, the work is synchronous and hardware-touching.

So a stream of small `POST /v1/configs` requests is still a stream of immediate hardware reconfiguration operations.

### 3. Pause/resume runs blocking C64 control work inline

`1541ultimate/software/api/route_machine.cc` routes machine pause/resume to subsystem commands.

`1541ultimate/software/infra/subsys.cc` executes subsystem commands inline in the caller context while holding subsystem serialization.

`1541ultimate/software/io/c64/c64_subsys.cc` maps those commands to `C64::stop(false)` and `C64::resume()`.

`1541ultimate/software/io/c64/c64.cc` contains busy waits and hardware polling loops in these paths. This is exactly the kind of work that should not overlap with additional machine-control or config-mutation traffic.

### 4. `POST /v1/configs` also adds temp-file churn

`1541ultimate/software/api/attachment_writer.h` shows that request bodies are first written to `/Temp/`, then read back and parsed.

So every immediate batch config write also incurs temporary file I/O and body buffering overhead before config effectuation even starts.

That is a poor fit for high-frequency UI-driven mutations.

### 5. The scheduler priorities make starvation plausible

In `FreeRTOSConfig.h`, `PRIO_NETSERVICE` is above `PRIO_MAIN` and `PRIO_USERIFACE`.

That does not prove one exact starvation path, but it does explain why a busy network-service task can make the box look dead from the outside while lower-priority UI work falls behind. Combined with blocking C64 control work and subsystem locking, this matches the observed symptom that the physical menu button can stop responding too.

## C. Most likely failure mechanism

The most plausible mechanism is:

1. The app emits overlapping machine-control and mixer-config mutations.
2. The HTTP service loop processes them serially, but each one can block for a meaningful amount of time.
3. Pause/resume requests enter C64 control paths that already include busy waits and hardware polling.
4. Mixer writes use `POST /v1/configs`, which adds temp-file handling and immediate config effectuation.
5. Extra read traffic in the same gesture extends queue depth and service time.
6. Continued user interaction keeps the queue non-empty, so the device spends sustained time in a high-priority network service path.
7. Other services and UI responsiveness collapse enough that the device appears fully hung.

This analysis supports a client-driven overload/stall scenario much more strongly than a pure network transport bug.

## Why `Balanced` Mode Was Not Enough

The default guard profile reduces generic pressure, but it misses the actual hazard:

- It allows two REST operations in flight.
- It does not treat machine control as a special serialized class.
- It does not treat playback-side config writes as a special serialized class.
- It allows playback mixer writes to bypass the normal write throttle.
- It does not suppress fresh config reads during an active transition.

For this device, that is enough to produce unsafe request patterns even though the profile sounds conservative.

## Required Client-Side Changes

The prompt from the separate client-side review contains two kinds of recommendations:

- changes that are directly required to stop the observed C64U hang class
- broader interaction-layer hardening that is useful, but is not the shortest path to a simple and stable fix for this incident

Those need to be separated. Otherwise the remediation plan becomes too large and risks obscuring the few controls that matter most for this device.

### 1. Changes that are directly required to avoid hangs

These are the minimum client changes that should be treated as required for this device.

#### 1.1 Serialize all mutating REST requests to one in-flight operation per device

Do not allow overlap between:

- `PUT /v1/machine:*`
- `POST /v1/configs`
- `PUT /v1/configs/...`
- any runner/start endpoint that changes machine state

This should be enforced in `deviceInteractionManager.ts`, not left to individual hooks.

The practical rule is simple: treat the C64U REST API as a single-lane mutation surface.

#### 1.2 Make pause/resume single-flight

If pause or resume is already in progress:

- ignore repeated taps, or
- collapse them into one final desired state

Do not allow a second pause/resume transition to start while the first one is unresolved.

For this device, this is not an optional UX refinement. It is a stability requirement.

#### 1.3 Replace playback-side immediate writes with a latest-intent-wins channel

The current playback path bypasses the config write throttle with `immediate: true`. That should stop.

More importantly, the replacement should not just be "send fewer writes". It must guarantee final-intent correctness for slider-like controls.

Playback volume and mute writes should therefore use a dedicated per-resource write lane with:

- strict serialization for that logical target
- latest-intent-wins supersession of queued but not yet executed values
- stale completion suppression so an older write cannot roll back a newer user choice
- one final applied value after a burst, not a replay of every intermediate slider position

This is the most important extension prompted by the separate review. The earlier document already recommended coalescing and deferral, but the stronger requirement is that the write path must explicitly preserve newest intent.

#### 1.4 Block or defer slider traffic during machine transitions

Volume changes should not be sent while a pause/resume machine transition is executing.

Queue only the final desired volume state and flush it after:

1. the machine transition completes
2. a short cooldown expires

This avoids interleaving `machine:*` control with mixer mutations in the device's most fragile window.

#### 1.5 Stop forcing fresh config reads inside hot control paths

Do not call fresh `getConfigItems()` reads as part of every mute/resume path unless there is no alternative.

Prefer:

- local cached mixer state
- last-known-good playback snapshot
- deferred reconciliation after the transition settles

The separate review is directionally correct that stale reads can cause UI rollback. That matters here, but the simpler fix is not "more complex transport-wide reconciliation everywhere". The first fix is to remove forced hot-path reads from the fragile sequence.

#### 1.6 Suppress stale read responses from rolling back local playback state

For slider-backed playback state, stale reads that complete after a newer local intent should be ignored.

A simple generation or sequence rule per logical control is sufficient:

- each local write intent advances a generation
- reads started before that generation cannot overwrite the newer local state when they complete

This should be applied narrowly to the affected playback/mixer state paths rather than turned into a complicated global state model.

#### 1.7 Suspend low-value background reads while playback control is active

During a pause/resume/mute/volume transition window, suppress or defer:

- periodic info refresh
- config refresh
- other non-essential polling

This lowers queue depth and reduces the chance that a recovery-critical control request waits behind background traffic.

#### 1.8 Add explicit cooldowns for dangerous endpoints

Suggested starting points:

- machine pause/resume/menu/reset: 500 ms to 1000 ms minimum spacing
- playback mixer writes: 250 ms to 400 ms minimum spacing, with coalescing-to-latest
- no background config/info refresh during an active playback transition window

These numbers should be tuned from device testing, but the current effective spacing is too small.

#### 1.9 Prefer one coalesced mixer update after machine transition completion

For pause:

1. issue `machine:pause`
2. wait for completion
3. apply one coalesced mixer mute batch

For resume:

1. issue `machine:resume`
2. wait for completion
3. wait for a short cooldown
4. apply one coalesced mixer restore batch

Do not interleave slider-driven writes in the middle of those sequences.

### 2. Changes that are good hardening, but are not the main hang fix

The separate client-side review also raises several valid concerns. Most are real engineering issues. They are just not equally central to the observed C64U hang.

#### 2.1 Fix REST request identity so query-sensitive requests never collide

This is a real correctness issue and should be fixed.

Request identity should include:

- method
- canonical path
- canonicalized query parameters

Equivalent query strings with different parameter order should normalize to the same identity. Semantically different queries must never collide.

This matters for correctness and future safety, especially for endpoints such as memory read/write APIs. It is worth fixing even though it is probably not the direct cause of the mute/resume hang.

#### 2.2 Do not coalesce writes unless it is explicitly safe

The default rule for writes should be:

- no transport-level coalescing of distinct writes

The only intentional exception should be a documented per-resource latest-intent-wins channel for specific slider-like controls, where the semantics are known and tested.

#### 2.3 Add deliberate cache invalidation after related writes

Time-based expiry alone is weak where a known write invalidates a known read.

For the affected playback/config endpoints, writes should invalidate or bypass related cached GET results. This is useful for correctness and to reduce stale-state reapplication.

#### 2.4 If the scheduler is redesigned, avoid sleeping inside occupied execution slots

The separate review is reasonable to flag cooldown/backoff waits that consume scarce scheduler slots.

That can distort fairness and responsiveness. It is worth improving if the interaction manager is being refactored anyway.

However, this is still secondary to the core mutation-lane fix. Even a perfect scheduler will not save the device if the client keeps sending overlapping machine-control and config mutations.

#### 2.5 A stronger circuit breaker is useful, but not the primary fix for this incident

A half-open probe state, narrower error classification, and better recovery control are good hardening.

They help with failure storms and recovery after the device is already sick.

They do not remove the main overload cause identified here, which is the client generating unsafe mutation sequences while the device is healthy but fragile.

#### 2.6 Better tests are required

The separate review is correct that concurrency and burst-behaviour coverage needs to be stronger.

At minimum, tests should lock in:

- serialized machine/control mutations
- latest-intent-wins for slider-like writes
- stale-read suppression after local writes
- no background polling interference during active playback transitions
- no accidental query-sensitive GET coalescing

### 3. Simplicity guideline

Because the device is fragile, the safest design is not the most abstract design. It is the smallest design that guarantees:

- one mutation lane
- one transition at a time
- latest-intent-wins for bursty slider writes
- stale-read suppression for the affected UI state
- no background interference during active playback control

That is the simplest client architecture that matches the server-side evidence.

## Direct Answers

### a) Is the server side single-threaded or multi-threaded?

It is both, depending on scope:

- The firmware overall is multithreaded FreeRTOS.
- The REST server path is effectively single-threaded from the client’s perspective, because requests are handled through one HTTP service loop and execute synchronously.

For client design, the practical answer is: treat the REST API as a single-lane control surface.

### b) What could explain the hang?

The best explanation is a client-driven overload of a synchronous REST path:

- overlapping pause/resume and config mutations
- hot-path config reads mixed into the same gesture
- synchronous config effectuation
- synchronous C64 stop/resume work
- temp-file body handling for `POST /v1/configs`
- sustained service time in a higher-priority network task

That combination can make the whole device appear dead, including UI responsiveness.

### c) Which concrete changes are required on the client side to avoid hangs?

The minimum required changes are:

1. serialize all mutating REST requests to one in-flight operation per device
2. make pause/resume single-flight
3. replace playback-side immediate writes with a per-resource latest-intent-wins write lane
4. suppress stale write completions and stale reads from rolling back newer local playback intent
5. defer volume writes while machine transitions are active
6. remove forced fresh config reads from hot playback-control paths
7. suppress background polling during active playback transitions
8. add endpoint-specific cooldowns for machine-control and mixer endpoints

Separately, the client should also fix query-sensitive request identity, write/cache correctness, and the breaker/scheduler hardening issues. Those are valid and should be done, but they are secondary to the hang-prevention set above.

Without those changes, `Balanced` mode will remain vulnerable to this class of stall.

## Evidence Base

Client-side files reviewed:

- `src/lib/deviceInteraction/deviceInteractionManager.ts`
- `src/lib/deviceInteraction/deviceStateStore.ts`
- `src/lib/config/deviceSafetySettings.ts`
- `src/lib/c64api.ts`
- `src/lib/config/configWriteThrottle.ts`
- `src/pages/playFiles/hooks/useVolumeOverride.ts`
- `src/pages/playFiles/hooks/usePlaybackController.ts`
- `src/pages/home/hooks/useConfigActions.ts`
- `src/pages/home/components/AudioMixer.tsx`
- `tests/unit/playFiles/volumeMuteRace.test.ts`
- `tests/unit/playFiles/usePlaybackController.test.tsx`
- `doc/testing/investigations/interactions1/verification-notes.md`

Firmware-side files reviewed:

- `1541ultimate/software/network/httpd.cc`
- `1541ultimate/software/network/ftpd.cc`
- `1541ultimate/software/network/socket_gui.cc`
- `1541ultimate/software/api/route_configs.cc`
- `1541ultimate/software/api/route_machine.cc`
- `1541ultimate/software/api/attachment_writer.h`
- `1541ultimate/software/components/config.cc`
- `1541ultimate/software/infra/subsys.cc`
- `1541ultimate/software/FreeRTOS/Source/FreeRTOSConfig.h`
- `1541ultimate/software/u64/u64_config.cc`
- `1541ultimate/software/io/c64/c64.cc`
- `1541ultimate/software/io/c64/c64_subsys.cc`
- `1541ultimate/software/filetypes/filetype_sid.cc`

## Confidence and Limits

Confidence is high that the client is currently capable of generating a request pattern the firmware handles poorly.

Confidence is also high that the REST path is effectively single-lane and synchronous in the ways that matter here.

What is not proven from static analysis alone is one exact terminal lockup point inside the firmware. A live trace on the device would be needed to distinguish between:

- subsystem lock contention
- long hardware polling paths
- temp-file or filesystem stalls
- secondary effects on other services

That uncertainty does not change the client-side conclusion. The client must stop overlapping these mutations if it wants to keep the device responsive.
