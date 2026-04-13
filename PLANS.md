# Multi-Device Diagnostics Attribution Research Plan

Date: 2026-04-13
Status: Completed
Primary focus: implementation-ready spec, plan, and prompt for device-attributed diagnostics evidence
Expected change classification: `DOC_ONLY`

## Objective

Turn the completed diagnostics-after-device-switching research into an implementation-ready specification for device-attributed diagnostics evidence, including filtering, display, and persistence rules.

## Working Rules

- Build on `docs/research/device-switching-diagnostics/diagnostics-device-switching.md` rather than re-opening its already-decided current-device header semantics.
- Ground all new requirements in the real trace, log, action-summary, diagnostics-dialog, and saved-device store code.
- Keep the outcome implementation-ready and narrowly scoped as a retrofit.
- Treat this task as `DOC_ONLY`; do not modify executable code while producing the design artifacts.

## Phases

### Phase 0. Refresh and classify

Goal:

- re-read the current research doc, plan, and worklog after the follow-up requirement changed the scope

Tasks:

- [x] Refresh `diagnostics-device-switching.md`, `PLANS.md`, and `WORKLOG.md`.
- [x] Reconfirm the task remains `DOC_ONLY` for this turn.
- [x] Identify the required output set: `multi-device-diagnostics-spec.md`, `plan.md`, and `prompt.md`.

Exit criteria:

- the new deliverables and scope are explicit

### Phase 1. Schema and UX archaeology

Goal:

- map the exact code paths that must participate in device attribution

Tasks:

- [x] Inspect trace context, trace event, and action-summary schemas.
- [x] Inspect Diagnostics evidence-list and filter behavior.
- [x] Inspect saved-device persistence for a historical multi-device visibility flag.
- [x] Inspect logging and external-log normalization paths.

Exit criteria:

- the retrofit surface is concrete enough to write a precise spec

### Phase 2. Write implementation-ready documents

Goal:

- produce the final spec, delta plan, and implementation prompt without duplicating unnecessary detail

Tasks:

- [x] Define the attribution identity model and display/filter rules.
- [x] Define the single-device versus prior-multi-device visibility rule.
- [x] Write `multi-device-diagnostics-spec.md`.
- [x] Write `plan.md` referencing the spec.
- [x] Write `prompt.md` referencing the spec and plan.
- [x] Update `WORKLOG.md` and mark this plan complete.

Exit criteria:

- the docs are implementation-ready and grounded in the current codebase

# Diagnostics Device Switching Research Plan

Date: 2026-04-13
Status: Completed
Primary focus: diagnostics semantics after saved-device switching
Expected change classification: `DOC_ONLY`

## Objective

Determine what diagnostics should mean now that the app supports switching between saved devices, without broad refactors to the switching feature or the wider diagnostics subsystem.

## Working Rules

- Ground all conclusions in the existing code, tests, and current docs.
- Treat the badge, switch picker, diagnostics sheet, and persistence layers as separate semantics surfaces unless the implementation proves otherwise.
- Prefer the smallest viable future implementation surface.
- Do not propose full per-device diagnostics partitioning unless the current code cannot support a calmer model.

## Phases

### Phase 0. Plan and classification

Goal:

- establish the task scope and validation expectations

Tasks:

- [x] Review repo instructions, current `PLANS.md`, and current `WORKLOG.md`.
- [x] Classify the task as `DOC_ONLY` unless a blocking correctness fix is required.
- [x] Record the execution plan and keep it authoritative for the task.

Exit criteria:

- research scope is explicit and the plan reflects the work to be completed

### Phase 1. Runtime architecture mapping

Goal:

- map the real ownership boundaries for switching, health state, and diagnostics data

Tasks:

- [x] Inspect saved-device persistence and switching orchestration.
- [x] Inspect badge state derivation and switch-picker health polling.
- [x] Inspect diagnostics overlay/dialog ownership, clear/export behavior, and health-check lifecycle.
- [x] Inspect route invalidation and current-device refresh behavior after switching.

Exit criteria:

- current diagnostics architecture is mapped with concrete code references

### Phase 2. Contract and edge analysis

Goal:

- identify the exact current semantics and the ambiguities introduced by switching

Tasks:

- [x] Determine badge status and badge problem-count semantics.
- [x] Determine switch-dialog health semantics and persistence.
- [x] Determine which diagnostics data persists across switch and app restart.
- [x] Review unit, Playwright, and docs constraints for the current UX contract.
- [x] Analyze switch timing, stale data, and mixed-device race conditions.

Exit criteria:

- current behavior is explicit enough to compare options rigorously

### Phase 3. Recommendation and documentation

Goal:

- choose a minimal, consistent diagnostics model and publish an implementation-ready research document

Tasks:

- [x] Compare global, per-device, reset-on-switch, and hybrid models.
- [x] Select one recommended model and define exact semantics for badge, diagnostics count, switch dialog, reset, and persistence.
- [x] Write the research document under `docs/research/device-switching-diagnostics/`.
- [x] Update `WORKLOG.md` and mark this plan complete.

Exit criteria:

- the research document is complete, opinionated, code-grounded, and ready to drive a later implementation prompt

# Android APK/AAB Size Regression Investigation Plan

Date: 2026-04-11
Status: In execution
Primary focus: Android release size regression between tags `0.7.2` and `0.7.3`
Expected change classification: `DOC_PLUS_CODE`

## Objective

Identify the root cause of the Android APK/AAB size increase introduced in `0.7.3`, remove all unnecessary size growth, and prove any remaining increase is unavoidable without breaking HVSC download, ingest, or real-archive decompression performance.

## Working Rules

- All size claims must be backed by build artifacts, archive listings, or binary inspection output.
- No decompression-path replacement is allowed unless strict equivalence is proven. Initial work is limited to packaging, linkage, stripping, ABI, and dependency optimization around the existing approach.
- Every optimization attempt must be followed by rebuild, size measurement, and real-device validation on the Pixel 4.
- Preserve unrelated existing repository work recorded below.

## Phases

### Phase 0. Baseline setup

Goal:

- establish reproducible investigation scaffolding and preserve evidence

Tasks:

- [ ] Record initial scope, commands, and checkpoints in `WORKLOG.md`.
- [ ] Create isolated worktrees for tags `0.7.2` and `0.7.3`.
- [ ] Confirm Android build prerequisites and connected Pixel 4 availability.

Exit criteria:

- repeatable build environments exist for both tags and current branch

### Phase 1. Release artifact measurement

Goal:

- quantify the actual APK/AAB delta before proposing fixes

Tasks:

- [ ] Build release APK and AAB for `0.7.2`.
- [ ] Build release APK and AAB for `0.7.3`.
- [ ] Record total sizes and per-artifact deltas.

Exit criteria:

- exact before/after size numbers are captured for both tags

### Phase 2. Byte-level attribution

Goal:

- determine which packaged files account for the regression

Tasks:

- [ ] Diff APK contents by compressed and uncompressed size.
- [ ] Diff AAB contents by module and file contribution.
- [ ] Isolate native, asset, and resource contributors.

Exit criteria:

- largest size contributors are ranked with byte counts

### Phase 3. Native library and ABI analysis

Goal:

- verify whether JNI packaging caused the regression

Tasks:

- [ ] Inspect `.so` files for ABI coverage, strip state, and symbol/debug sections.
- [ ] Compare native library counts and sizes across tags.
- [ ] Evaluate safe packaging changes such as ABI splits or narrower bundled ABIs where compatible with release requirements.

Exit criteria:

- native contribution is either confirmed as root cause or ruled out with evidence

### Phase 4. Safe optimizations

Goal:

- remove avoidable size while preserving runtime behavior and performance

Tasks:

- [ ] Implement the smallest safe packaging or native-build optimizations supported by evidence.
- [ ] Rebuild APK/AAB after each change and record deltas.
- [ ] Verify no release-optimization regressions in Gradle/R8/resource shrinking.

Exit criteria:

- all removable Android-specific growth identified by the investigation has been eliminated

### Phase 5. Device validation

Goal:

- prove no regressions on real hardware

Tasks:

- [ ] Install optimized build on Pixel 4.
- [ ] Validate HVSC download.
- [ ] Validate HVSC ingest.
- [ ] Validate real HVSC 7z decompression and capture timing evidence.

Exit criteria:

- functional and performance parity is demonstrated on-device

### Phase 6. Documentation closure

Goal:

- publish evidence, conclusions, and remaining unavoidable cost

Tasks:

- [ ] Write `docs/research/android/apk-size-regression.md` with byte-level breakdown and causal explanation.
- [ ] Summarize before/after measurements and validation evidence.
- [ ] Record any unavoidable residual increase with proof.

Exit criteria:

- investigation findings and implemented fixes are fully documented

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

- [x] Extend persisted device configuration/state types to support multi-device storage.
- [x] Implement deterministic migration from legacy single-device storage into the new saved-device model.
- [x] Add label derivation and uniqueness validation helpers for `shortLabel`.
- [x] Project `selectedDeviceId` through the runtime config path.

Required tests:

- [x] migration from existing single-device storage
- [x] idempotent migration behavior
- [x] uniqueness and length handling for `shortLabel`
- [x] persisted selection behavior

Validation checkpoints:

- [x] A single-device user migrates without manual action.
- [x] `selectedDeviceId` always resolves to an existing saved device after migration.
- [x] Selected device survives restart.

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

- [x] Extend the badge interaction layer to distinguish tap from long press without breaking current tap behavior.
- [x] Add the `Switch device` decision interstitial and name-first row rendering.
- [x] Ensure the picker is suppressed when switching is impossible.
- [x] Wire dismissal behavior for cancel and post-selection.

Required tests:

- [x] tap still opens Diagnostics
- [x] long press opens the picker when two or more saved devices exist
- [x] long press does not regress ordinary tap behavior
- [x] healthy picker rows do not render hostname, product code, or unique-id text by default
- [x] picker dismisses cleanly after cancel or selection

Validation checkpoints:

- [x] Badge tap reliability remains intact.
- [x] Long press is available only when it adds value.
- [x] Picker rows remain name-first in healthy idle state.

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

- [x] Implement the switch action pipeline behind picker selection.
- [x] Update runtime connection settings immediately from saved-device metadata.
- [x] Perform lightweight `/v1/info` verification and persist last-known identity on success.
- [x] Preserve selection while surfacing offline or mismatch status on failure.

Required tests:

- [x] successful switch updates selected state before probe completion
- [x] successful probe updates last-known identity
- [x] failed probe preserves selection and records offline state
- [x] handshake never fetches full config

Validation checkpoints:

- [x] Local selection updates immediately.
- [x] Success and failure states are persisted deterministically.
- [x] No `c64-all-config` request is issued during switch.

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

- [x] Remove persistent switching UI from Diagnostics.
- [x] Preserve Diagnostics health and activity flows.
- [x] Keep management actions discoverable in the intended secondary surfaces.
- [x] Verify Settings remains the CRUD source of truth.

Required tests:

- [x] Diagnostics renders without a Devices section
- [x] Diagnostics overflow still exposes the intended secondary actions
- [x] Settings remains the source of truth for add, edit, rename, delete, and select
- [x] one-device flows remain calm and unchanged except for saved-device migration

Validation checkpoints:

- [x] Diagnostics no longer carries routine switching UI.
- [x] Settings still owns device administration.
- [x] One-device UX remains unchanged except for migration-backed state.

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

- [x] `npm run lint`
- [x] `npm run test`
- [x] `npm run test:coverage`
- [x] `npm run build`
- [x] the smallest honest UI validation for the badge long-press and picker flows

Required UI validation:

- [x] tap on the badge still opens Diagnostics
- [x] long press opens the picker
- [x] picker selection enters `Verifying` and resolves correctly
- [x] Diagnostics no longer shows a persistent Devices section

Documentation updates:

- [x] update any product docs affected by the shipped behavior
- [x] update the base spec if it still describes Diagnostics as the primary switching surface
- [x] refresh only the smallest screenshot subset needed for the new picker flow and Diagnostics simplification

Validation checkpoints:

- [x] All required validation commands pass.
- [x] Global branch coverage remains `>= 91%`.
- [x] Documentation and screenshots match shipped behavior.

Exit criteria:

- tests and build pass
- global branch coverage remains `>= 91%`
- docs match the shipped behavior

## Backlog additions

- Switch device screenshots should use full page-context framing instead of cropping to the popup surface, matching the documented modal/interstitial style used elsewhere.
- Docs section screenshots should use full Docs page-context framing instead of isolated subsection crops, and the full Switch device plus Docs screenshot sets should be regenerated together after framing changes.
- Strengthen web-platform production coverage beyond the current shallow auth/proxy checks.
  Scope:
  - exercise the Docker-backed web route against realistic LAN targets, not just local mock upstreams
  - add regression coverage for real-device host resolution and connectivity using both hostname `c64u` and direct IP targets such as `192.168.1.167`
  - validate the supported web control path end to end, including REST proxying, target selection, connection status, and operator-visible failure reporting
  - keep this work explicitly web-focused; iOS coverage remains structurally constrained by the Linux dev environment and public macOS CI availability
    Motivation:
  - recent local operator testing reported that a locally running web build could not connect to the C64U via either hostname `c64u` or IP `192.168.1.167`
  - this indicates a likely severe regression in the supported self-hosted web path and a mismatch between current coverage and real behavior
