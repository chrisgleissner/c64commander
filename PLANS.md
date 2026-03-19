# Lighting Studio Redesign

Status: IN PROGRESS
Classification: DOC_PLUS_CODE, UI_CHANGE
Specs:

- `doc/diagnostics/diagnostics-ux-redesign.md`
- `doc/diagnostics/diagnostics-ux-extension-1.md`

## Execution Status

| ID  | Task                                                                                      | Phase | Dependencies                          | Status      | Notes                                                                                                                                     |
| --- | ----------------------------------------------------------------------------------------- | ----- | ------------------------------------- | ----------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| T1  | Read required repo rules and diagnostics specs                                            | 1     | none                                  | completed   | `README.md`, `.github/copilot-instructions.md`, `doc/ux-guidelines.md`, redesign spec, extension spec                                     |
| T2  | Map current diagnostics implementation and identify gaps/conflicts                        | 1     | T1                                    | completed   | Identified missing recovery evidence, missing config-drift/config heat-map entry points, partial latency capture, and export/history gaps |
| T3  | Refactor overlay state foundation for strict stack invariants and state restoration       | 1     | T2                                    | completed   | Preserved single analytic popup slot and parent overlay state through popup usage                                                         |
| T4  | Enforce diagnostics overlay + inline disclosure + single analytic popup interaction model | 2     | T3                                    | completed   | Kept config drift as in-overlay secondary detail view and analytic popups above diagnostics only                                          |
| T5  | Implement connection actions region behavior and recovery-first defaults                  | 3     | T4                                    | completed   | `Demo` now enters recovery-first mode; retry and switch remain inline                                                                     |
| T6  | Implement recovery evidence emission for reconnect and target switching                   | 4     | T5                                    | completed   | Added action tracing, REST recovery probes, recovery evidence store, and explicit failure logging                                         |
| T7  | Harden deterministic health-check execution and result recording                          | 5     | T6                                    | completed   | Removed random run ids while retaining strict sequential probe execution                                                                  |
| T8  | Implement latency analysis filters and popup semantics                                    | 6     | T7                                    | completed   | Latency samples now populate from traced REST/FTP responses                                                                               |
| T9  | Implement health history chart behaviors and event overlays                               | 7     | T7                                    | completed   | Added zoom/pan controls and recovery event overlays                                                                                       |
| T10 | Implement secondary detail views for device detail and health-check detail                | 8     | T7                                    | completed   | Added dedicated health-check detail view and wired it into overlay secondary-detail navigation                                            |
| T11 | Complete config drift and shared heat-map behaviors                                       | 9     | T7                                    | completed   | Added config drift entry point and config heat-map entry point using shared popup                                                         |
| T12 | Enrich diagnostics export with recovery and health evidence                               | 10    | T6, T7, T9, T11                       | completed   | Added supplemental export payload with health snapshot, last health check, latency, history, and recovery evidence                        |
| T13 | UX hardening across compact/medium/expanded profiles                                      | 11    | T4, T5, T8, T9, T11                   | in_progress | Compact diagnostics overlay entry and popup layering now validated in Playwright; screenshot refresh still pending                        |
| T14 | Add regression tests for all changed flows and modules                                    | 12    | T4, T5, T6, T7, T8, T9, T10, T11, T12 | in_progress | Added diagnostics unit/component regression tests plus a passing Playwright diagnostics flow; broader E2E expansion still pending         |
| T15 | Run validation, inspect screenshots, and close remaining gaps                             | 12    | T14                                   | in_progress | Coverage blocker resolved, targeted diagnostics E2E passes, build/eslint/prettier pass; screenshot refresh and broader E2E still pending  |

## Phased Plan

### PHASE 1 - Architecture Alignment

- Map existing overlay structure to Chapter 5 interaction layers.
- Map current summary and stream behavior to Chapter 6 summary-first model.
- Identify conflicts in popup ownership, state restoration, recovery context, and evidence persistence.
- Refactor foundations before feature expansion.

### PHASE 2 - Interaction Layer Enforcement

- Implement strict layering model:
  - diagnostics overlay
  - inline disclosure
  - nested analytic popup
- Enforce stack invariants and popup replacement behavior.
- Implement deterministic back/escape/focus restoration.

### PHASE 3 - Connection Actions (Chapter 7, 8)

- Implement `Retry connection` as a direct summary-region action.
- Implement `Switch device` as inline disclosure.
- Enforce validation-first switching, busy states, and inline feedback.
- Preserve overlay, filters, stream, and expanded state during recovery.

### PHASE 4 - Recovery Evidence (Chapter 9)

- Emit `Action` and `Problem` entries for reconnect/switch attempts and failures.
- Map contributors correctly.
- Preserve root-cause continuity for `Investigate now`.

### PHASE 5 - Deterministic Health Check System (Chapter 10, 11)

- Enforce strict sequential probes: `REST -> JIFFY -> RASTER -> CONFIG -> FTP`.
- Keep one recorded pass per trigger with no retries or parallelism.
- Implement and verify skip semantics, full result recording, and latency snapshot capture.
- Ensure CONFIG roundtrip uses preferred targets and records semantic vs transport failures correctly.

### PHASE 6 - Latency Analysis (Chapter 12)

- Implement trailing-window percentile tracking and deterministic filtering.
- Implement nested latency popup with multi-line chart and checkbox filtering.
- Preserve parent overlay state and make empty/sparse states explicit.

### PHASE 7 - Health History (Chapter 13)

- Maintain ring buffer max 500.
- Implement popup visualization with zoom/pan controls.
- Overlay failures, reconnects, switches, and config roundtrip failures when available.

### PHASE 8 - Secondary Detail Views (Chapter 14)

- Implement firmware / FPGA / core / uptime detail view from overall health.
- Present dense health-check result detail without polluting the summary.

### PHASE 9 - Config Drift + Heat Maps (Chapter 15)

- Implement runtime vs persisted drift diff view.
- Reuse one shared heat-map system for `REST`, `FTP`, and `CONFIG`.
- Support count vs latency mode and cell-detail overlay.

### PHASE 10 - Export Enrichment (Chapter 16)

- Extend existing export paths with recovery evidence, latency stats, history, and drift.
- Keep filtered export aligned with current stream filters.

### PHASE 11 - UX Hardening

- Validate recovery vs investigation clarity.
- Ensure visible health and connectivity at all times.
- Enforce one clear path to root cause and compact-safe layout behavior.

### PHASE 12 - Testing + Verification

- Add unit, integration, and E2E tests for all specified diagnostics flows.
- Refresh only the screenshot subset made inaccurate by visible UI changes.
- Run full required validation and resolve all failures before completion.

## Deterministic Dependency Graph

- Foundation:
  - T1 -> T2 -> T3 -> T4
- Recovery:
  - T4 -> T5 -> T6
- Health system:
  - T6 -> T7
- Analytics:
  - T7 -> T8
  - T7 -> T9
  - T7 -> T10
  - T7 -> T11
- Export:
  - T6 + T7 + T9 + T11 -> T12
- Hardening and validation:
  - T4 + T5 + T8 + T9 + T11 -> T13
  - T4..T12 -> T14 -> T15

## Impact Map

- UI:
  - `src/components/diagnostics/`
- Diagnostics domain logic:
  - `src/lib/diagnostics/`
- Hooks / overlay integration:
  - `src/hooks/`
  - overlay invocation state and connection state integration
- Tests:
  - `src/**/*.test.ts?(x)`
  - `playwright/`
- Docs and evidence:
  - `PLANS.md`
  - screenshot folders under `doc/img/` only if visible documented diagnostics UI changed and existing images become inaccurate

## Risk Register

| Risk                                                                                         | Impact | Mitigation                                                                                | Status    |
| -------------------------------------------------------------------------------------------- | ------ | ----------------------------------------------------------------------------------------- | --------- |
| Existing diagnostics test changes in worktree conflict with implementation                   | Medium | Read before editing touched files, avoid reverting unrelated changes, patch narrowly      | active    |
| Popup layering may already violate Chapter 5 focus/back invariants                           | High   | Centralize popup ownership and preserve invoker refs/overlay state                        | active    |
| Recovery actions currently succeed/fail without emitting diagnostics evidence                | High   | Add explicit evidence recording and regression tests before final validation              | mitigated |
| Health-check engine currently uses non-deterministic run ids and may mis-attribute failures  | High   | Remove randomness from recorded output where required and align contributor mapping/tests | mitigated |
| Latency/history/heat-map views may not preserve parent overlay context                       | High   | Keep popup-local state separate and verify with component/E2E tests                       | active    |
| UI overflow on compact layouts                                                               | High   | Run targeted layout tests and screenshot checks for diagnostics surfaces                  | active    |
| Export schema drift from new diagnostics payloads                                            | Medium | Extend export tests and verify filtered/share-all behavior                                | active    |
| Full repo coverage and CI are blocked by unrelated existing disk-manager timeout failures    | High   | Keep timing-sensitive tests deterministic in test env and harden slow coverage cases      | mitigated |
| Diagnostics toolbar config-drift path may regress at runtime despite passing component tests | High   | Cover with Playwright and keep explicit import wiring in `DiagnosticsDialog`              | mitigated |

## Verification Strategy

- Unit and integration:
  - diagnostics domain logic (`healthCheckEngine`, `latencyTracker`, `healthHistory`, `configDrift`, `heatMapData`, export helpers)
  - diagnostics component tests for layering, recovery flows, filters, and state restoration
- E2E:
  - diagnostics overlay open/close and back behavior
  - retry connection and switch device flows
  - latency popup filters and reset
  - heat map popup and cell detail
  - config drift view
  - health history popup
- Layout verification:
  - compact, medium, expanded diagnostics surfaces
  - no mid-word wrap, clipped labels, or viewport overflow
- Required command validation before completion:
  - `npm run lint`
  - `npm run test`
  - `npm run test:coverage`
  - `npm run build`
  - `npm run test:e2e`
- Screenshot verification:
  - update only the minimal diagnostics screenshot subset if the visible documented diagnostics UI changed

## Completion Criteria

- All extension chapters 5 through 17 implemented with no known gaps.
- Stack invariants, summary-first ordering, and recovery flows conform to spec.
- Deterministic health-check behavior with no retries, no parallelism, and explicit skip reasons.
- Recovery and failure paths emit diagnosable evidence and no silent failures remain.
- Filters, scroll position, and expanded rows persist across recovery, popup open/close, and device switching.
- Unit + integration + E2E coverage added for recovery, health checks, popup layering, latency filters, heat maps, and config drift.
- New/changed diagnostics modules meet the requested high coverage and repo-wide branch coverage is at least 91%.
- Required validation is green.

## Current Validation Snapshot

- Passed:
  - targeted Vitest diagnostics suites for dialog, connection-actions behavior, recovery-evidence store, latency tracker, health history, health check engine, config drift, and heat-map data
  - targeted Vitest regressions for `GlobalDiagnosticsOverlay` and `DiagnosticsDialog`
  - targeted Playwright diagnostics overlay flow in `playwright/homeDiagnosticsOverlay.spec.ts`
  - scoped `eslint` on changed diagnostics files
  - scoped `prettier --check` on changed files
  - `npm run build`
- In progress / blocked:
  - full repo `npm run test:coverage` has been rerun after timeout hardening; machine-readable summary extraction is still being verified separately
  - full repo `npm run lint` did not return a clean terminal completion in this environment; replaced with successful scoped eslint plus scoped prettier checks
  - full repo `npm run test:e2e` is not green because it hit an unrelated failure in `playwright/audioMixer.spec.ts` before the diagnostics slice completed
  - diagnostics screenshots not refreshed

# Light Feature Extended Research Plan

Status: In progress
Classification: DOC_ONLY
Deliverable:

- `doc/light-feature-extended-research.md`

## Execution Status

| ID  | Task                                                                                 | Phase | Dependencies | Status    | Notes                                                                                                                                                                                                                                          |
| --- | ------------------------------------------------------------------------------------ | ----- | ------------ | --------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| L1  | Read repo rules and relevant UX/context docs                                         | 1     | none         | completed | Read `README.md`, `.github/copilot-instructions.md`, `doc/ux-guidelines.md`, and `doc/display-profiles.md`                                                                                                                                     |
| L2  | Audit implemented light-related UI, config hooks, REST surfaces, and device fixtures | 1     | L1           | completed | Confirmed Home quick controls, Config fallback exposure, REST config-only control path, interactive slider write behavior, and firmware/device drift across `c64u` and `u64e` fixtures                                                         |
| L3  | Produce capability matrix with hard constraints, soft constraints, and unknowns      | 1     | L2           | completed | Enumerated current parameters, variant-specific fields, device-vs-app responsibilities, transport pacing, and explicit unknowns with no silent assumptions                                                                                     |
| L4  | Generate broad divergent idea space with at least 20 distinct concepts               | 2     | L3           | completed | Final set spans scene application, split-surface composition, event/status signaling, source/context mapping, scheduling, safeguards, explainability, and macro/script models; 6 of 20 are directly aligned to the prompt inspiration signals  |
| L5  | Score every idea across the full evaluation matrix and compute weighted totals       | 3     | L4           | completed | Weighted model finalized: strongest scores favor connection-state ambient feedback, paired-surface composition, saved profiles, startup-safe automation, and source-context mapping                                                            |
| L6  | Select exactly 5 contenders and explicitly reject all others                         | 4     | L5           | completed | Selected: `Connection Sentinel`, `Surface Split Composer`, `Profile Library`, `Quiet Launch`, and `Source Identity Map`; rejected higher-overlap concepts such as `Surface Roles Presets` and narrower concepts such as `Config Snapshot Glow` |
| L7  | Design UX integration for each selected feature under current app navigation limits  | 5     | L6           | completed | Final UX model uses a single secondary `Lighting Studio` surface, lightweight Home summary chips, and contextual Play/Disks cues without adding a new tab or deeper workflow branch                                                            |
| L8  | Define unified lighting model with deterministic priority resolution                 | 6     | L7           | completed | Unified model now covers capability discovery, profiles, rules, overrides, locks, and optional script macros with one deterministic resolver                                                                                                   |
| L9  | Write final consolidated research document and verify internal consistency           | 7     | L8           | completed | Wrote `doc/light-feature-extended-research.md` and performed a final placeholder/integrity pass                                                                                                                                                |

## Phase Notes

- Phase 1 focus:
  - enumerate current lighting capabilities across Home, Config, REST config endpoints, and versioned device fixtures
  - capture control-path timing behavior from config write throttling and interactive write lanes
  - separate hard constraints, soft constraints, and explicit unknowns
- Phase 1 findings snapshot:
  - current app control is entirely config-backed; there is no dedicated lighting runtime API or streaming channel
  - the main current light surface is the Home page pair of quick cards for case and keyboard lighting, while Config remains the raw-category fallback
  - device-native modes handle animation and SID-reactive behavior; the app only selects modes and parameters
  - current transport behavior supports coarse discrete updates and slider previews, not frame-level app-driven animation
  - capability drift exists across device/firmware fixtures: legacy raw RGB fields, newer named-color/tint patterns, optional strip type/length, and keyboard lighting only on the `c64u/3.14` fixture in-tree
- Phase 2 focus:
  - maximize divergence before feasibility pruning
  - span multiple interaction models, input signals, automation levels, temporal behaviors, and UI surfaces
- Phase 2 completion snapshot:
  - generated 20 distinct concepts
  - kept direct derivations from the optional inspiration signals to 30% of the set
  - maintained low-, medium-, and high-complexity coverage instead of clustering around one implementation shape
- Phase 3 focus:
  - use a deterministic weighted model across uniqueness, value, viability, complexity, UX cost, duplication risk, performance, and signal availability
- Phase 3 result snapshot:
  - highest-scoring concepts cluster around features that can operate with existing app/device signals and discrete config writes
  - lowest-scoring concepts are script-heavy, rule-heavy, or sequence-heavy ideas that would overrun current UX and transport constraints
- Phase 4 focus:
  - select exactly 5 candidates
  - reject every non-selected concept explicitly
- Phase 4 selection snapshot:
  - selected features balance foundation, reuse, contextual automation, and startup safety
  - only one selected concept is directly aligned to the optional inspiration signals, keeping the final set broader than the prompt examples
- Phase 5 focus:
  - integrate selected features without adding a new tab or deep navigation branch
  - prefer contextual, progressive, and mode-based surfaces over structural expansion
- Phase 5 result snapshot:
  - advanced lighting is centralized in one secondary `Lighting Studio` surface
  - Home remains a quick-control entry point rather than becoming a dense orchestration screen
  - contextual surfaces are limited to lightweight chips or banners where the automation is relevant
- Phase 6 focus:
  - define a single control model that avoids fragmented authority across manual, automated, event, and scripted layers
- Phase 6 result snapshot:
  - profiles are the base layer
  - rules, overrides, and locks resolve through one priority chain
  - hardware-only strip topology remains outside the reusable Light feature model
- Phase 7 result snapshot:
  - final document includes capability analysis, idea space, evaluation matrix, top-five convergence, UX integration, unified model, and recommendations
- Validation note:
  - `DOC_ONLY` task; no builds, tests, or screenshot refreshes are required unless the scope changes beyond documentation

# Lighting Studio Implementation Plan

Status: Implemented
Classification: DOC_PLUS_CODE, UI_CHANGE
Specs:

- `doc/internals/lighting-studio.md`
- `doc/research/light-feature-extended-research.md`

## Execution Status

| ID   | Task                                                                                                        | Phase | Dependencies                               | Status      | Notes                                                                                                                                                                                                                      |
| ---- | ----------------------------------------------------------------------------------------------------------- | ----- | ------------------------------------------ | ----------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| LS1  | Read specs and repo rules for the touched surfaces                                                          | 1     | none                                       | completed   | Read `README.md`, `.github/copilot-instructions.md`, `doc/ux-guidelines.md`, `doc/internals/display-profiles.md`, `doc/internals/lighting-studio.md`, and `doc/research/light-feature-extended-research.md` before editing |
| LS2  | Audit current lighting implementation, Home integration points, Config fallbacks, and device write paths    | 1     | LS1                                        | completed   | Mapped `HomePage`, `LightingSummaryCard`, config hooks, write throttling, Home/Play/Disks entry points, and route-bound source ownership                                                                                   |
| LS3  | Define the domain model for capabilities, profiles, rules, locks, and Circadian Palette location resolution | 1     | LS2                                        | completed   | Added typed lighting domain modules for capabilities, profiles, resolver ownership, source cues, and circadian outputs with deterministic precedence                                                                       |
| LS4  | Define persistence strategy for profiles, automations, Circadian Palette settings, and last-resolved state  | 1     | LS3                                        | completed   | Persisted profiles, automation settings, compatibility metadata, active profile, and last-resolved location in the studio store                                                                                            |
| LS4A | Define the standalone solar-calculation module boundary and API                                             | 1     | LS3                                        | completed   | Shipped standalone `suncalc`-backed solar helpers with typed inputs/outputs, offline location resolution, phase helpers, and polar fallback handling                                                                       |
| LS5  | Implement shared lighting resolver and write-emission layer                                                 | 2     | LS3, LS4                                   | completed   | Resolver now owns preview, manual lock, Quiet Launch, connection sentinel, source identity, circadian overlays, and batched config writes                                                                                  |
| LS6  | Implement `Lighting Studio` surface and Home entry points                                                   | 2     | LS5                                        | completed   | Added the secondary studio surface plus Home entry chips; compact layout was reworked to avoid horizontal clipping and to keep copy concise across display profiles                                                        |
| LS7  | Implement `Profile Library` flows                                                                           | 2     | LS6                                        | completed   | Apply, save current, duplicate, rename, delete, pin, and compatibility badges all ship with bundled/saved profile handling                                                                                                 |
| LS8  | Implement `Surface Split Composer`                                                                          | 2     | LS6, LS7                                   | completed   | Added linked, mirrored, and independent editing, presets, case-only fallback, and an interactive C64 mockup editor with case/key selection and mixed-light visualization                                                   |
| LS9  | Implement `Connection Sentinel`                                                                             | 2     | LS5, LS7                                   | completed   | Ambient and critical connection states resolve through the shared automation layer with profile-backed mappings                                                                                                            |
| LS10 | Implement `Quiet Launch`                                                                                    | 2     | LS5, LS7                                   | completed   | Startup-safe conservative handoff is implemented with deterministic timeout and manual-change exit behavior                                                                                                                |
| LS11 | Implement `Source Identity Map` and contextual Play/Disks cues                                              | 2     | LS5, LS7                                   | completed   | Play and Disks now expose contextual source cues while respecting mixed-source ownership and idle fallback                                                                                                                 |
| LS12 | Implement `Circadian Palette` with location permission, manual lat/lon, and bundled city-list fallback      | 2     | LS5, LS7, LS4A                             | completed   | Device permission, manual coordinates, and bundled city fallback all work offline with visible fallback schedule state                                                                                                     |
| LS13 | Implement `Context Lens`, Home summary chips, and manual lock/pause affordances                             | 2     | LS9, LS10, LS11, LS12                      | completed   | Explainability, Home chips, and lock/pause controls now ship with the automation stack                                                                                                                                     |
| LS14 | Add unit tests for the lighting domain and Circadian calculations                                           | 3     | LS5, LS9, LS10, LS11, LS12                 | completed   | Added resolver, capability normalization, store, city lookup, source-cue suppression, and solar/circadian regression coverage                                                                                              |
| LS15 | Add component tests for `Lighting Studio`, Home chips, and permission-denied fallback flows                 | 3     | LS6, LS7, LS8, LS12, LS13                  | completed   | Added component tests for validation, city search, denied location, compact-safe mockup focus switching, and case-only fallback rendering                                                                                  |
| LS16 | Add E2E coverage for the end-to-end lighting workflows                                                      | 3     | LS6, LS7, LS8, LS9, LS10, LS11, LS12, LS13 | completed   | Added Playwright coverage for profile workflows, contextual cues, circadian fallback, denied location, and screenshot capture flows                                                                                        |
| LS17 | Refresh docs and minimal screenshots for changed visible UI                                                 | 4     | LS6, LS7, LS8, LS9, LS10, LS11, LS12, LS13 | completed   | Updated docs plus targeted screenshots, including `05-lighting-studio.png` with a white perimeter border and new studio feature captures (`05`-`08`)                                                                       |
| LS18 | Run full validation and close gaps until green                                                              | 4     | LS14, LS15, LS16, LS17                     | in_progress | `npm run test`, `npm run test:coverage`, `npm run build`, targeted Playwright slices, and build-script screenshot capture are green; final `npm run test:e2e:ci` rerun is in flight                                        |

## Impact Map

- Source files:
  - lighting domain and persistence modules under `src/lib/` and `src/hooks/`
  - standalone solar module under `src/lib/` with no UI or persistence coupling
  - Home lighting entry surfaces under `src/pages/` and `src/pages/home/`
  - new `Lighting Studio` UI under `src/components/` or `src/pages/` as appropriate
  - Play and Disks contextual cues where source-driven automation is shown
- Tests:
  - unit and component tests under `src/**` and `tests/unit/**`
  - Playwright coverage under `playwright/`
  - if native permission-specific Maestro coverage is added, follow `doc/testing/maestro.md`
- Docs:
  - `doc/internals/lighting-studio.md`
  - minimal README or `doc/` updates only if user-visible documentation needs to reflect the shipped feature
- Screenshots:
  - targeted Home and lighting-studio screenshot subset under `doc/img/`, including the compact bordered studio overview and section-specific captures for compose, automation, and context lens

## Verification Strategy

- Unit and integration:
  - capability normalization across newer named-color and legacy RGB devices
  - profile persistence and compatibility-badge behavior
  - priority resolution across preview, lock, Quiet Launch, Source Identity Map, Circadian Palette, and Connection Sentinel
  - standalone solar module import and pure-function behavior
  - strict typed coordinate input and city input handling
  - case-insensitive city lookup against the curated bundled city set
  - unknown-city fail-fast behavior
  - resolved output normalization from the solar module
  - Circadian solar-boundary calculation
  - Circadian phase mapping: `night`, `dawn`, `day`, `sunset`
  - optional phase-progress normalization `0.0-1.0`
  - Circadian fallback schedule when solar events are unavailable
  - location-source selection priority: device permission, manual lat/lon, city fallback
  - manual lock and `Context Lens` resolution output
- Component:
  - `Lighting Studio` layout and section structure across supported capabilities
  - Home summary chips and `Why this look?` affordance
  - permission-denied location flow
  - manual latitude/longitude validation
  - bundled city search and selection
  - unsupported-field hiding and case-only fallback
- E2E:
  - open `Lighting Studio` from Home and apply a saved profile
  - save, rename, duplicate, delete, and pin a profile
  - split composer preset and independent per-surface edit flow
  - source-context cue on Play or Disks
  - connection-state automation state change
  - Circadian setup with denied location permission and manual lat/lon or city fallback
  - Circadian fallback schedule visibility for an invalid or unsatisfied solar calculation path
- Required command validation before completion:
  - `npm run lint`
  - `npm run test`
  - `npm run test:coverage`
  - `npm run build`
  - `npm run test:e2e`

## Completion Criteria

- `Lighting Studio` ships as a secondary surface with no new primary navigation destination.
- All six required features from `doc/internals/lighting-studio.md` are implemented:
  - `Surface Split Composer`
  - `Profile Library`
  - `Connection Sentinel`
  - `Quiet Launch`
  - `Source Identity Map`
  - `Circadian Palette`
- `Circadian Palette` supports:
  - granted location permission
  - manual latitude/longitude entry
  - searchable app-bundled city fallback
  - deterministic solar-boundary calculation
  - visible fallback schedule state when solar events cannot be resolved
- A single standalone solar module exists with these properties:
  - uses `suncalc`
  - works fully offline
  - has no network calls, no global state, and no side effects
  - resolves either `{ lat, lon }` or `{ city }`
  - uses a curated internal city map of roughly `10-30` major cities maximum
  - returns strict typed normalized sun-time results and circadian phase output
- One unified resolver owns profile, rule, preview, lock, and fallback resolution with no ambiguous control path.
- Unsupported lighting fields are hidden or normalized cleanly instead of producing dead UI.
- Unit, component, and E2E coverage exists for the new lighting workflows and the repo-wide branch-coverage gate remains at least 91%.
- Required validation is green.

# Open TODOs

- Remove all code related to generating / updating the files beneath `artifacts/` from the codebase.
- Move `page-headers` and `swipe-transitions` from `artifacts/` to `doc/img/app/details/` so all screenshots stay together and `revert-identical-pngs.mjs` can be simplified back to covering only `doc/img/app`. ✅ Done: folders moved, spec paths updated, script simplified.
