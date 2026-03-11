# Device Interaction Hardening Plan

## Planning Position

This plan is derived from [doc/research/device-interaction/c64u-rest-hang-analysis.md](/home/chris/dev/c64/c64commander/doc/research/device-interaction/c64u-rest-hang-analysis.md).

The current C64 Ultimate firmware should be treated as having a single effective REST control lane. Because of that, I agree with not exposing REST concurrency as a user-facing setting.

Reasoning:

- the firmware-side REST path is effectively single-lane
- higher client-side REST concurrency does not create useful throughput
- extra concurrency increases failure surface, queue interactions, and testing complexity
- the main goal here is stability, not tunability

Plan assumption:

- REST mutation concurrency will be fixed in code to `1`
- any remaining concurrency behavior should be an internal implementation detail, not a user-configurable safety knob

If future firmware proves that a specific read-only path is safely parallelizable, that can be introduced later as an internal policy change. It should still not be exposed as a user preference unless there is strong evidence that the setting is both safe and meaningful.

## Scope

The implementation plan focuses on the smallest set of changes that materially reduce hang risk while preserving correctness:

- one REST mutation lane
- one machine transition at a time
- latest-intent-wins playback write handling
- stale-read suppression for affected playback state
- reduced hot-path reads during playback interactions
- suspension of low-value background reads during active transitions
- targeted tests that prove these behaviors

Broader interaction-layer hardening is included as later phases only where it materially improves correctness without diluting the main stabilization work.

## Phase 0 - Baseline And Inventory

Goal: build a precise implementation map before editing behavior.

Tasks:

- [x] Inventory all REST interaction-manager key paths:
  - `src/lib/deviceInteraction/deviceInteractionManager.ts`
  - related stores, policy helpers, caches, cooldown maps, breaker state, and tracing
- [x] Inventory all playback-side callers that emit hot-path writes or force fresh reads:
  - pause/resume
  - mute/unmute
  - volume slider
  - polling/reconciliation paths
- [x] Identify where `restMaxConcurrency` is configured and where user-facing safety settings currently expose it
- [x] Identify tests covering:
  - interaction scheduling
  - playback volume/mute behavior
  - pause/resume sequencing
  - stale reads or racing writes
- [x] Convert the inventory into a defect-to-file map inside this plan before implementation starts

Acceptance criteria:

- every planned code change has a concrete target file
- every known hang-related risk maps to a remediation task below
- user-visible REST concurrency configuration is identified for removal or internalization

## Phase 1 - Fixed Single-Lane REST Mutation Model

Goal: remove unsafe overlap of mutating REST work.

Tasks:

- [x] Refactor the interaction layer so all mutating REST requests execute with one in-flight operation per device
- [x] Ensure the serialized mutation class includes:
  - `PUT /v1/machine:*`
  - `POST /v1/configs`
  - `PUT /v1/configs/...`
  - runner/start endpoints that mutate machine state
- [x] Remove or internalize user-facing REST concurrency configuration
- [x] Update safety-setting docs/types/UI so users cannot increase REST mutation parallelism
- [x] Add regression tests proving:
  - overlapping mutation requests are serialized
  - repeated user actions do not produce overlapping machine/config mutations

Acceptance criteria:

- no path exists where two mutating REST requests can overlap for the same device
- REST concurrency is no longer a user-facing tuning knob
- tests prove serialization

## Phase 2 - Single-Flight Machine Transitions

Goal: make pause/resume safe under repeated taps and overlapping UI activity.

Tasks:

- [x] Introduce a single-flight guard for pause/resume transitions
- [x] Define deterministic repeated-tap behavior:
  - ignore repeated taps while a transition is active, or
  - collapse to final desired transition state
- [x] Ensure machine transition code cannot interleave with playback mixer writes
- [x] Add tests proving:
  - repeated pause taps do not overlap
  - repeated resume taps do not overlap
  - pause then resume bursts resolve deterministically

Acceptance criteria:

- at most one machine transition is active at a time
- transition behavior under repeated taps is deterministic and test-covered

## Phase 3 - Latest-Intent-Wins Playback Write Lane

Goal: keep slider and mute interactions correct while reducing device load.

Tasks:

- [x] Replace playback-side `immediate: true` write bursts with a dedicated per-resource write lane
- [x] Implement latest-intent-wins semantics for slider-backed playback controls
- [x] Ensure queued but not yet executed intermediate values are superseded by the latest value
- [x] Ensure stale completions from older writes cannot roll back newer local intent
- [x] Apply the same design to mute/unmute if it targets the same logical mixer resource
- [x] Add tests proving:
  - rapid slider bursts end on the final value
  - older writes cannot overwrite newer intent
  - intermediate queued values are dropped when superseded

Acceptance criteria:

- final device-facing value after a burst reflects the latest user intent
- no stale write completion can roll playback state backward
- slider behavior remains responsive under load

## Phase 4 - Stale Read Suppression And Hot-Path Read Reduction

Goal: stop reads from reapplying old state during active playback interaction.

Tasks:

- [x] Remove forced fresh config reads from hot pause/resume/mute/volume paths where possible
- [x] Replace hot-path reads with:
  - local cached mixer state
  - last-known-good playback snapshot
  - deferred reconciliation after transition settle
- [x] Add generation or sequence-based stale-read suppression for affected playback state
- [x] Ensure reads started before a newer local write intent cannot overwrite that newer local state on completion
- [x] Add tests proving:
  - stale GET results cannot roll back newer local playback state
  - read-after-write reconciliation stays deterministic

Acceptance criteria:

- playback control paths no longer force unnecessary config reads in the fragile window
- stale reads cannot make the slider or mute state jump backward

## Phase 5 - Transition Window Protection

Goal: reduce queue depth and prevent background interference during fragile machine-control windows.

Tasks:

- [x] Defer playback mixer writes while a machine transition is active
- [x] Flush only the final coalesced mixer state after transition completion and cooldown
- [x] Suspend low-value background reads during:
  - pause/resume transitions
  - active playback write bursts if needed
- [x] Add endpoint-specific cooldowns for:
  - machine control
  - playback mixer writes
- [x] Add tests proving:
  - background polling does not interfere with active playback control
  - machine transitions flush one final mixer state rather than many intermediate states

Acceptance criteria:

- machine transitions are isolated from slider traffic
- background reads do not increase pressure in the most fragile control window

## Phase 6 - Targeted Correctness Hardening

Goal: fix secondary correctness issues that are worth addressing while touching the interaction layer.

Tasks:

- [x] Audit REST request identity generation
- [x] Ensure request identity includes:
  - method
  - path
  - canonical query parameters
- [x] Ensure query-sensitive GETs never collide in coalescing or caching
- [x] Ensure distinct writes are not transport-coalesced unless explicitly safe and documented
- [x] Add targeted cache invalidation or bypass after related writes
- [x] Add tests proving:
  - same query params in different order normalize identically
  - different query params do not collide
  - write paths do not accidentally coalesce
  - stale cached reads are not reused after invalidating writes

Acceptance criteria:

- no query-sensitive request collision remains
- cached/read-coalesced behavior is semantically correct for touched endpoints

## Phase 7 - Optional Interaction-Layer Hardening

Goal: improve resilience further without expanding the first stabilization patch unnecessarily.

Tasks:

- [x] Evaluate whether scheduler waits currently consume active execution slots in a harmful way
- [x] If warranted, redesign deferred cooldown/backoff waiting so it does not waste scarce worker capacity
- [x] Evaluate circuit-breaker behavior and, if needed, add an explicit cautious recovery state
- [x] Centralize and tighten error classification for breaker decisions
- [x] Add tests only for the hardening that is actually implemented

Acceptance criteria:

- any added complexity is justified by concrete benefits
- this phase does not block shipping the core hang fix unless investigation shows it is required

## Defect Inventory

- [x] Unsafe overlapping mutating REST requests: `src/lib/deviceInteraction/deviceInteractionManager.ts`
- [x] Playback-side immediate config writes under burst interaction: `src/pages/playFiles/hooks/useVolumeOverride.ts`, `src/pages/playFiles/playbackMixerSync.ts`
- [x] Missing single-flight protection for pause/resume: `src/pages/playFiles/hooks/usePlaybackController.ts`, `src/lib/deviceInteraction/machineTransitionCoordinator.ts`
- [x] Hot-path fresh config reads during playback interaction: `src/pages/playFiles/hooks/useVolumeOverride.ts`, `src/hooks/useC64Connection.ts`
- [x] Stale read rollback of newer local intent: `src/pages/playFiles/hooks/useVolumeOverride.ts`, `src/pages/playFiles/playbackMixerSync.ts`
- [x] User-facing REST concurrency setting despite single effective server lane: `src/lib/config/deviceSafetySettings.ts`, `src/lib/config/settingsTransfer.ts`, `src/pages/SettingsPage.tsx`, `README.md`
- [x] Query-sensitive request identity correctness: `src/lib/deviceInteraction/restRequestIdentity.ts`, `src/lib/c64api.ts`
- [x] Cache invalidation gaps after writes: `src/hooks/useC64Connection.ts`, `src/pages/playFiles/hooks/useVolumeOverride.ts`
- [x] Scheduler wait occupancy risk: evaluated in `src/lib/deviceInteraction/deviceInteractionManager.ts`; no redesign required for this patch after narrowing the fragile path to a single serialized mutation lane and deferring background reads before scheduling
- [x] Circuit-breaker recovery-model limitations: evaluated in `src/lib/deviceInteraction/deviceInteractionManager.ts`; centralized classification tightened, explicit cautious recovery state not required for the shipped fix

## Verification Plan

Core verification required before completion:

- [x] Unit tests for serialized mutation scheduling
- [x] Unit tests for single-flight pause/resume
- [x] Unit tests for latest-intent-wins slider/write behavior
- [x] Unit tests for stale-read suppression
- [x] Unit tests for background polling suppression during active transitions
- [x] Unit tests for query-sensitive request identity correctness
- [x] Run targeted Vitest suites during each phase
- [ ] Run `npm run test`
- [ ] Run `npm run test:coverage`
- [ ] Confirm global branch coverage remains at or above 90%

If touched code affects broader app behavior materially:

- [ ] Run `npm run lint`
- [ ] Run any directly relevant Playwright coverage for the changed flows

## Worklog

### 2026-03-11

- Created this phased execution plan from the firmware-backed research note.
- Decided that REST concurrency should not remain user-configurable because the current C64U firmware exposes only one effective REST handler lane.
- Ordered the work so the smallest stability-critical fixes land first, with broader interaction-layer hardening pushed later unless proven necessary.
- Implemented fixed single-lane REST mutation scheduling, canonical request identity normalization, and internalized REST concurrency.
- Added a machine-transition gate plus a latest-intent playback write lane to serialize pause/resume and coalesce mixer writes.
- Replaced hot-path force-refresh reads with cached reconciliation plus stale-read suppression for playback state.
- Added regression coverage for scheduling, playback write coalescing, transition single-flight behavior, canonical request identity, and settings import/export compatibility.
