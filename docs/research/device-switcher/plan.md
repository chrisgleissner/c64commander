# Device Switcher Multi-Phase Plan

Date: 2026-04-09
Status: Ready for execution
Primary spec: [device-switch-spec.md](./device-switch-spec.md)
Expected change classification: `DOC_PLUS_CODE`, `UI_CHANGE`

## 1. Objective

Implement the device switcher defined in [device-switch-spec.md](./device-switch-spec.md) with minimal scope, preserved architecture, bounded memory growth, cross-device collection continuity, and full regression coverage.

## 2. Execution Rules

- The specification is authoritative for behavior.
- This plan is authoritative for sequencing.
- Do not widen scope beyond the spec.
- Do not fetch `c64-all-config` during switching.
- Do not silently break playlist or disk entries imported from another saved C64 device.
- Reuse and extend the existing mock-server layers before inventing a parallel device-switch test harness.
- Every bug found during implementation must receive a targeted regression test.
- Final code validation must include `npm run test:coverage` with global branch coverage `>= 91%`.

## 3. Phase Summary

| Phase | Goal | Blocking output |
| --- | --- | --- |
| 0 | Confirm current architecture and impact map | touched files and query surfaces identified |
| 1 | Land saved-device storage and migration | persisted multi-device model in place |
| 2 | Land switch orchestration and verification | switching works logically without full UI polish |
| 3 | Land device-bound collection origin resolution | prior-device playlist and disk items still work |
| 4 | Land multi-device mock and harness support | deterministic multi-device E2E coverage becomes possible |
| 5 | Land diagnostics and settings UI | user can switch and manage devices |
| 6 | Land route reload, invalidation, and cache bounds | no broad stale multi-device working sets |
| 7 | Land edge-case handling and mismatch behavior | offline, mismatch, and origin failures behave correctly |
| 8 | Validation, docs, and screenshots | repo is validated and docs are aligned |

## 4. Detailed Phases

### Phase 0. Discovery and impact map

Goal:

- confirm the current single-device storage path and all code paths that assume one active device

Read first:

- `README.md`
- `.github/copilot-instructions.md`
- `docs/ux-guidelines.md`
- [device-switch-spec.md](./device-switch-spec.md)
- connection, health, diagnostics, and settings code directly involved

Deliverables:

- explicit list of touched stores, hooks, UI surfaces, and query invalidation utilities
- explicit note of which queries are active-route essential versus not
- explicit map of current mock layers that assume a single device instance

Mock and harness surfaces to inspect during this phase:

- `tests/mocks/mockC64Server.ts`
- `tests/android-emulator/helpers/mockC64Server.mjs`
- `src/lib/native/mockC64u.ts`
- `src/lib/native/mockC64u.web.ts`
- Android native `MockC64U` plugin and its JVM tests
- Playwright mock wiring and Android emulator smoke harnesses
- `docs/testing/agentic-tests/**`

Exit criteria:

- implementation impact is mapped narrowly enough to avoid speculative edits

### Phase 1. Saved-device model and migration

Goal:

- replace implicit single-device assumptions with a persisted saved-device model

Implementation targets:

- add `SavedDevice` persistence
- add `selectedDeviceId`
- add migration from legacy single-device storage
- add label derivation and uniqueness validation helpers

Likely touchpoints:

- app config store
- runtime host config projection
- settings persistence helpers

Required tests:

- migration from existing single-device storage
- idempotent migration behavior
- uniqueness and length handling for `shortLabel`
- persisted selection behavior

Exit criteria:

- a single-device user is transparently migrated to one saved device
- selected device state survives app restart

### Phase 2. Switch orchestration and lightweight verification

Goal:

- implement `switchToSavedDevice(deviceId)` exactly as specified

Implementation targets:

- update selected device locally
- project host and ports into runtime connection config
- begin `/v1/info` verification
- update last-known metadata on success
- preserve selection and mark offline on failure

Required tests:

- successful switch updates selected state before probe completion
- successful probe updates last-known identity
- failed probe preserves selection and records offline state
- handshake never fetches full config

Exit criteria:

- switching logic works without needing the full device-management UI to be perfect

### Phase 3. Device-bound collection origin resolution

Goal:

- ensure playlist items and disk entries imported from one saved C64 device continue to work after switching to another saved C64 device

Implementation targets:

- persist origin-device metadata for `ultimate` playlist and disk items
- add origin-resolution logic that compares selected-device identity with origin-device identity
- fetch bytes from the origin device when the selected device differs
- route those bytes through the selected device's existing upload execution path
- keep selected-device state unchanged throughout origin-device transfer
- preserve source transparency in normal playlist and disk rows

Required tests:

- playback of an `ultimate` item on the same physical device still uses the direct path
- playback of an `ultimate` item on a different selected device fetches from origin and uploads to target
- disk mount of an `ultimate` disk on a different selected device fetches from origin and mounts via upload on target
- origin-device transfer never mutates `selectedDeviceId`
- origin-device deletion, mismatch, unreachable host, and missing file produce deterministic unavailable outcomes

Exit criteria:

- device-bound collection items remain usable across device switches without hidden device re-selection

### Phase 4. Multi-device mock and harness support

Goal:

- extend the existing mock infrastructure so end-to-end tests can exercise multiple saved devices deterministically across web, emulator, and agentic paths

Implementation targets:

- extend the Node mock server to support multiple independently startable device instances, not one implicit singleton
- define a reusable mock device descriptor with at least:
  - product-family or device-type identity
  - hostname
  - unique id
  - HTTP port
  - FTP port
  - Telnet port when relevant
  - independently configurable mocked filesystem content
  - optional fault profile and timing profile
- support per-instance start, stop, restart, reachability toggle, and fault-mode toggle at runtime
- ensure ports are independently assigned or explicitly configurable to avoid clashes in multi-device runs
- preserve request introspection per mock instance so assertions can distinguish origin-device and selected-device traffic
- extend emulator helper infrastructure so external mocks can expose multiple devices, not just one
- document how native mock-server paths and external Node mock-server paths map to the same conceptual multi-device contract

Required tests:

- two or more mock devices can run concurrently with distinct ports and distinct identities
- two devices can expose different filesystem trees without state bleed
- a device can be stopped and restarted during a live test session
- toggling one mock device unreachable does not affect the others
- request logs remain attributable per device instance

Exit criteria:

- Playwright, emulator, and future agentic cases can provision at least two distinct mock devices and manipulate their availability during a run

### Phase 5. Diagnostics and Settings UI

Goal:

- expose switching and device management in the required surfaces

Implementation targets:

- add `Devices` section to diagnostics
- add per-device rows with required texts and statuses
- add `Manage devices`
- update settings connection area for add, edit, rename, delete, and select
- preserve badge tap -> diagnostics behavior

Required tests:

- diagnostics renders device rows correctly
- tapping a device row starts a switch
- badge label uses the compact label rules
- settings management flows persist correctly

UI validation target:

- the smallest honest UI validation that proves the two-tap flow and visible state transitions

Exit criteria:

- routine switching is achievable in 2 taps from any main page

### Phase 6. Route reload, invalidation, and cache bounds

Goal:

- ensure switching refreshes only the necessary data and keeps memory bounded

Implementation targets:

- invalidate prior-device active-route working data
- reload only active-route essential queries after successful verification
- add bounded `DeviceSwitchSummary` retention
- avoid retaining heavy per-device working sets
- avoid eager background copying of device-bound collection bytes after a switch

Required tests:

- route reload matrix behavior for each relevant route
- `c64-all-config` not fetched on switch
- LRU behavior for switch summary retention
- non-selected working data is invalidated on switch

Exit criteria:

- switching does not trigger broad query churn or multi-device cache accumulation

### Phase 7. Edge behavior and conflict handling

Goal:

- make offline, mismatch, host-edit, older-firmware, and origin-device behavior precise and stable

Implementation targets:

- offline state with retry and edit affordances
- mismatch detection using identity priority rules
- certainty reset after host edits
- degraded identity certainty for older firmware
- origin-device alias and same-physical-device handling by `unique_id`
- warning and fallback behavior when deleting a saved device that still owns collection items
- in-flight read invalidation and mutation-switch guardrails
- stop or restart of origin and selected mock devices during a live session

Required tests:

- mismatch detection by `unique_id`
- fallback mismatch behavior without `unique_id`
- host edit clears verified certainty
- in-flight polling invalidation on switch
- deleting an origin saved-device record preserves referenced items while marking them unavailable
- origin-device offline does not downgrade the currently selected device connection state
- mock stop or restart during an active verification or playback attempt produces deterministic failure handling

Exit criteria:

- edge cases behave exactly as defined in the spec

### Phase 8. Validation and documentation closure

Goal:

- bring the implementation to a truthful, reviewable finish

Required validation:

- `npm run lint`
- `npm run test`
- `npm run test:coverage`
- `npm run build`
- smallest honest UI validation for the changed surfaces

Required test-harness validation:

- targeted Playwright or emulator coverage using at least two concurrent mock devices
- at least one runtime availability test where a mock origin device is stopped or made unreachable during the scenario
- native mock-server contract tests updated where native mock behavior changes
- `npm run test:agents` when agentic docs, prompts, or harness code under `agents/` is touched

Agentic coverage requirements:

- extend the agentic infrastructure to support a device inventory containing multiple targets
- support both externally mocked devices and real-device entries in the same case model
- allow a case to declare whether each target is:
  - external mock
  - native demo mock
  - real hardware
- allow a case to start, stop, or disable a mock target during execution when testing failure recovery
- keep app-first validation for real-device runs
- keep controller-neutral contracts so future iOS support is not blocked by Android-only assumptions

Documentation updates:

- update any product docs affected by the shipped behavior
- refresh screenshots only if visible documented UI changes require it

Exit criteria:

- tests and build pass
- global branch coverage remains `>= 91%`
- docs match the shipped behavior

## 5. Suggested Branching

If the work is split across multiple PRs, use this order:

1. storage and migration
2. switch orchestration
3. collection origin resolution
4. mock and harness support
5. diagnostics and settings UI
6. reload and cache behavior
7. edge-case completion and docs

## 6. Definition of Done

The work is done only when:

- all acceptance criteria in [device-switch-spec.md](./device-switch-spec.md) are satisfied
- all required regression tests exist and pass
- no full-config fetch occurs during switching
- prior-device `ultimate` collection items still resolve correctly on another selected device
- the mock infrastructure can model multiple independently controlled devices with distinct identities, ports, and filesystems
- E2E and agentic paths can represent both mocked and real devices in multi-device scenarios
- final validation is completed honestly
- documentation reflects the actual shipped behavior
