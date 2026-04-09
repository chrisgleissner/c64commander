# Device Switcher V2 Multi-Phase Plan

Date: 2026-04-09
Status: In execution
Primary UX direction: [ux-recommendations-2026-04-09.md](./docs/research/device-switcher/v2/ux-recommendations-2026-04-09.md)
Base spec: [device-switch-spec.md](./docs/research/device-switcher/device-switch-spec.md)
Expected change classification: `DOC_PLUS_CODE`, `UI_CHANGE`

## Working Rules

- Authoritative source: `docs/research/device-switcher/v2/plan.md`
- Structure and phase ordering below must remain aligned with the authoritative source.
- A task is complete only after its validation checkpoint passes.
- Validation failures block progression to the next task or phase.

## 1. Objective

Implement badge-based device switching so the badge becomes the single device-context anchor:

- tap opens Diagnostics
- long press opens a compact `Switch device` picker

The implementation must preserve fast switching, avoid full-config fetches during the switch handshake, keep memory bounded across multiple devices, and preserve continuity for playlist and disk items imported from another saved device.

## 2. V2 Product Direction

This v2 plan supersedes the earlier diagnostics-embedded switcher direction.

Required UX outcome:

- no persistent Devices switcher section in Diagnostics
- long press on the badge opens a decision-only picker
- picker rows are name-first and minimal by default
- technical details remain in Health, overflow details, and Settings
- Settings remains the CRUD surface

If the base spec and the v2 UX recommendation diverge on the switching interaction, the v2 UX recommendation is authoritative for implementation and the base spec should be updated during documentation closure.

## 3. Execution Rules

- The v2 UX recommendation is authoritative for switching interaction design.
- The sequence in this plan is authoritative for implementation order.
- Preserve badge tap -> Diagnostics behavior.
- Add long press without degrading ordinary tap latency or reliability.
- Do not add a new persistent header control beyond the existing badge.
- Do not add a persistent Devices section back into Diagnostics.
- Do not fetch `c64-all-config` during switching.
- Do not silently break `ultimate` playlist or disk items imported from another saved device.
- Reuse and extend the existing mock and harness layers.
- Every bug fix discovered during implementation must receive a targeted regression test.
- Final validation must include `npm run test:coverage` with global branch coverage `>= 91%`.

## 4. Phase Summary

| Phase | Goal                                                       | Blocking output                                    |
| ----- | ---------------------------------------------------------- | -------------------------------------------------- |
| 0     | Confirm architecture, gesture constraints, and spec deltas | touched files and UX contract identified           |
| 1     | Land saved-device storage and migration                    | persisted multi-device model in place              |
| 2     | Land badge long-press and picker shell                     | picker opens without regressing badge tap          |
| 3     | Land switch orchestration and verification                 | switching works through the picker                 |
| 4     | Land diagnostics/settings simplification                   | Diagnostics no longer owns switching UI            |
| 5     | Land device-bound collection continuity                    | cross-device playlist and disk items still work    |
| 6     | Land multi-device mock and harness support                 | deterministic end-to-end coverage becomes possible |
| 7     | Land reload, cache, and edge behavior                      | switching stays bounded and predictable            |
| 8     | Validation, docs, and screenshots                          | repo is validated and docs are aligned             |

## 5. Detailed Phases

### Phase 0. Discovery and alignment

Goal:

- confirm the touched runtime surfaces and explicitly map the v2 UX changes against the existing diagnostics-first implementation plan

Read first:

- `README.md`
- `.github/copilot-instructions.md`
- `docs/ux-guidelines.md`
- [../device-switch-spec.md](./docs/research/device-switcher/device-switch-spec.md)
- [ux-recommendations-2026-04-09.md](./docs/research/device-switcher/v2/ux-recommendations-2026-04-09.md)

Deliverables:

- explicit list of touched components, hooks, stores, and query invalidation utilities
- explicit note of where the earlier diagnostics-switcher design must be replaced
- explicit confirmation of how long press will be detected on supported platforms and exercised in tests

Execution tasks:

- [x] Read only the minimal implementation files needed to map the current device-switch-related architecture.
- [x] Identify the concrete UI entry points, state stores, persistence layer, route reload logic, diagnostics surfaces, and collection execution paths affected by this feature.
- [x] Record the impact map and gesture/testing contract in `WORKLOG.md`.

Validation checkpoints:

- [x] Touched implementation surfaces are identified without speculative expansion.
- [x] The replacement points for the earlier Diagnostics switcher are explicit.
- [x] Long-press feasibility and test approach are explicit for web and native-supported paths.

Exit criteria:

- implementation impact is narrow enough to proceed without speculative UI churn

### Phase 1. Saved-device model and migration

Goal:

- replace implicit single-device assumptions with a persisted saved-device model

Implementation targets:

- add `SavedDevice` persistence
- add `selectedDeviceId`
- add migration from legacy single-device storage
- add label derivation and uniqueness validation helpers

Execution tasks:

- [ ] Extend persisted device configuration/state types to support multi-device storage.
- [ ] Implement deterministic migration from legacy single-device storage into the new saved-device model.
- [ ] Add label derivation and uniqueness validation helpers for `shortLabel`.
- [ ] Project `selectedDeviceId` through the runtime config path.

Required tests:

- [ ] migration from existing single-device storage
- [ ] idempotent migration behavior
- [ ] uniqueness and length handling for `shortLabel`
- [ ] persisted selection behavior

Validation checkpoints:

- [ ] A single-device user migrates without manual action.
- [ ] `selectedDeviceId` always resolves to an existing saved device after migration.
- [ ] Selected device survives restart.

Exit criteria:

- a single-device user is transparently migrated to one saved device
- selected device state survives app restart

### Phase 2. Badge long-press and picker shell

Goal:

- add the new switching entry point without regressing the existing badge tap behavior

Implementation targets:

- preserve tap on `UnifiedHealthBadge` -> Diagnostics
- add long press on the badge -> `Switch device` picker
- keep the picker decision-only and name-first
- keep default rows minimal: device name plus selection or transient status only
- ensure the one-device case does not surface a redundant switch affordance

Execution tasks:

- [ ] Extend the badge interaction layer to distinguish tap from long press without breaking current tap behavior.
- [ ] Add the `Switch device` decision interstitial and name-first row rendering.
- [ ] Ensure the picker is suppressed when switching is impossible.
- [ ] Wire dismissal behavior for cancel and post-selection.

Required tests:

- [ ] tap still opens Diagnostics
- [ ] long press opens the picker when two or more saved devices exist
- [ ] long press does not regress ordinary tap behavior
- [ ] healthy picker rows do not render hostname, product code, or unique-id text by default
- [ ] picker dismisses cleanly after cancel or selection

Validation checkpoints:

- [ ] Badge tap reliability remains intact.
- [ ] Long press is available only when it adds value.
- [ ] Picker rows remain name-first in healthy idle state.

Exit criteria:

- the badge cleanly supports both intents

### Phase 3. Switch orchestration and verification

Goal:

- reuse or implement `switchToSavedDevice(deviceId)` behind the picker flow

Implementation targets:

- update selected device locally
- project host and ports into runtime connection config
- begin `/v1/info` verification
- update last-known metadata on success
- preserve selection and mark offline or mismatch on failure

Execution tasks:

- [ ] Implement the switch action pipeline behind picker selection.
- [ ] Update runtime connection settings immediately from saved-device metadata.
- [ ] Perform lightweight `/v1/info` verification and persist last-known identity on success.
- [ ] Preserve selection while surfacing offline or mismatch status on failure.

Required tests:

- [ ] successful switch updates selected state before probe completion
- [ ] successful probe updates last-known identity
- [ ] failed probe preserves selection and records offline state
- [ ] handshake never fetches full config

Validation checkpoints:

- [ ] Local selection updates immediately.
- [ ] Success and failure states are persisted deterministically.
- [ ] No `c64-all-config` request is issued during switch.

Exit criteria:

- picker-driven switching works even before broader UI cleanup is finished

### Phase 4. Diagnostics and Settings simplification

Goal:

- remove Diagnostics from the primary switching path and keep it focused on status and inspection

Implementation targets:

- remove the persistent Devices switcher section from Diagnostics
- preserve Health and activity flows
- keep device management actions in Settings and Diagnostics overflow
- keep technical detail surfaces in Health, overflow details, and Settings
- implement the smallest honest discoverability aid for long press if needed

Execution tasks:

- [ ] Remove persistent switching UI from Diagnostics.
- [ ] Preserve Diagnostics health and activity flows.
- [ ] Keep management actions discoverable in the intended secondary surfaces.
- [ ] Verify Settings remains the CRUD source of truth.

Required tests:

- [ ] Diagnostics renders without a Devices section
- [ ] Diagnostics overflow still exposes the intended secondary actions
- [ ] Settings remains the source of truth for add, edit, rename, delete, and select
- [ ] one-device flows remain calm and unchanged except for saved-device migration

Validation checkpoints:

- [ ] Diagnostics no longer carries routine switching UI.
- [ ] Settings still owns device administration.
- [ ] One-device UX remains unchanged except for migration-backed state.

Exit criteria:

- Diagnostics is no longer overloaded with switching UI

### Phase 5. Device-bound collection continuity

Goal:

- ensure playlist items and disk entries imported from one saved device continue to work after switching to another

Implementation targets:

- persist origin-device metadata for `ultimate` playlist and disk items
- resolve origin identity against the selected device
- fetch bytes from the origin device when the selected device differs
- route those bytes through the selected device's existing upload execution path
- keep selected-device state unchanged throughout origin-device transfer

Execution tasks:

- [ ] Persist origin-device metadata on `ultimate` playlist imports.
- [ ] Persist origin-device metadata on `ultimate` disk collection imports.
- [ ] Resolve same-device versus cross-device execution paths without mutating selection.
- [ ] Route cross-device fetches through existing upload execution paths.
- [ ] Surface deterministic unavailable outcomes for origin failures.

Required tests:

- [ ] same-device `ultimate` content still uses the direct path
- [ ] cross-device playback fetches from origin and uploads to target
- [ ] cross-device disk mount fetches from origin and mounts via upload on target
- [ ] origin-device transfer never mutates `selectedDeviceId`
- [ ] origin-device deletion, mismatch, unreachable host, and missing file produce deterministic unavailable outcomes

Validation checkpoints:

- [ ] Playlist continuity is preserved across device switches.
- [ ] Disk continuity is preserved across device switches.
- [ ] Origin failures remain item-scoped and do not degrade global connection state.

Exit criteria:

- device-bound collection items remain usable across picker-based switching

### Phase 6. Multi-device mock and harness support

Goal:

- extend the existing mock infrastructure so end-to-end tests can exercise multiple saved devices and the new long-press entry path deterministically

Implementation targets:

- extend the Node mock server to support multiple independently startable device instances
- preserve per-instance request introspection
- extend emulator and native mock wiring as needed
- ensure test harnesses can simulate picker-based switching and device availability changes

Execution tasks:

- [ ] Extend the Node mock server for concurrent device instances with deterministic port allocation.
- [ ] Preserve per-device request logs and lifecycle controls.
- [ ] Extend web/native/android mock shims to expose the multi-device behavior.
- [ ] Teach the relevant harnesses and UI tests to drive long-press switching and per-device faults.

Required tests:

- [ ] two or more mock devices can run concurrently with distinct ports and identities
- [ ] device request logs remain attributable per instance
- [ ] one device can be stopped or restarted during a live session without corrupting the others
- [ ] long-press flow can be exercised in the relevant UI automation path

Validation checkpoints:

- [ ] Multiple mock devices operate concurrently and independently.
- [ ] Runtime fault injection remains deterministic.
- [ ] UI automation can exercise the long-press switch path.

Exit criteria:

- deterministic multi-device UI and behavior coverage becomes possible

### Phase 7. Reload, cache, and edge behavior

Goal:

- ensure switching remains bounded, precise, and resilient under edge conditions

Implementation targets:

- invalidate prior-device active-route working data
- reload only active-route essential queries after successful verification
- add bounded `DeviceSwitchSummary` retention
- implement offline, mismatch, host-edit, and older-firmware handling
- keep non-selected heavy working sets out of memory by default

Execution tasks:

- [ ] Implement active-route-only invalidation and reload behavior.
- [ ] Add bounded per-device switch summary retention.
- [ ] Implement mismatch, fallback identity, host-edit, and firmware-edge handling.
- [ ] Ensure non-selected heavy data is invalidated and not retained by default.

Required tests:

- [ ] route reload matrix behavior for relevant routes
- [ ] `c64-all-config` not fetched on switch
- [ ] mismatch detection by `unique_id`
- [ ] fallback mismatch behavior without `unique_id`
- [ ] host edit clears verified certainty
- [ ] non-selected working data is invalidated on switch

Validation checkpoints:

- [ ] Switching reloads only the active route’s essential working set.
- [ ] Cache growth remains bounded across saved devices.
- [ ] Edge-state behavior is deterministic and diagnosable.

Exit criteria:

- switching does not create broad stale caches or ambiguous edge behavior

### Phase 8. Validation and documentation closure

Goal:

- bring the implementation to a truthful, reviewable finish

Required validation:

- [ ] `npm run lint`
- [ ] `npm run test`
- [ ] `npm run test:coverage`
- [ ] `npm run build`
- [ ] the smallest honest UI validation for the badge long-press and picker flows

Required UI validation:

- [ ] tap on the badge still opens Diagnostics
- [ ] long press opens the picker
- [ ] picker selection enters `Verifying` and resolves correctly
- [ ] Diagnostics no longer shows a persistent Devices section

Documentation updates:

- [ ] update any product docs affected by the shipped behavior
- [ ] update the base spec if it still describes Diagnostics as the primary switching surface
- [ ] refresh only the smallest screenshot subset needed for the new picker flow and Diagnostics simplification

Validation checkpoints:

- [ ] All required validation commands pass.
- [ ] Global branch coverage remains `>= 91%`.
- [ ] Documentation and screenshots match shipped behavior.

Exit criteria:

- tests and build pass
- global branch coverage remains `>= 91%`
- docs match the shipped behavior
