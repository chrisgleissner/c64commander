# Diagnostics, Navigation, and Health Reliability Plan

Status: IN_PROGRESS
Classification: DOC_PLUS_CODE, CODE_CHANGE, UI_CHANGE
Date: 2026-03-23

## Phase 0 - System Discovery and Root Cause Analysis

- [x] Locate REST and FTP execution paths
- [x] Locate diagnostics dialog and auxiliary analytics surfaces
- [x] Compare CPU slider against canonical optimistic slider behavior
- [x] Inspect swipe gesture and runway transition model
- [x] Trace health check execution and global device health derivation
- [x] Record exact root causes in WORKLOG.md

Assumptions

- Existing diagnostics traces remain the canonical event stream for exported evidence.
- Deep links may resolve into the Settings slot as long as the correct diagnostics section initializes immediately.

Risks

- Diagnostics behavior currently exists in both a global overlay and a Settings-local dialog, which can drift unless ownership is unified.
- Deep-link routing can break swipe shell rendering unless path-to-slot resolution is extended carefully.

Verification Criteria

- Root-cause notes identify exact files/functions for REST, FTP, diagnostics UI, CPU slider, swipe, health checks, and global badge state.
- Each problem area A-H has at least one concrete implementation target documented in WORKLOG.md.

## Phase 1 - Diagnostics Data Model and Network Instrumentation

- [ ] Define a strict diagnostics network event schema for REST and FTP
- [ ] Add centralized diagnostics event builders/parsers
- [ ] Instrument REST request/response recording with parsed protocol, hostname, path, query, headers, bodies, status, latency
- [ ] Instrument FTP operations with hostname, command, path, result, latency, payload/error coverage
- [ ] Ensure error paths emit complete events with no missing critical fields
- [ ] Update action summary derivation to consume the strict schema

Assumptions

- Extending the existing trace event payloads is lower-risk than inventing a second persisted diagnostics store.

Risks

- Trace schema changes can break action summary tests, screenshots, and exports if not updated consistently.

Verification Criteria

- REST events always include protocol, method, url, hostname, path, query, latency, status/error.
- FTP events always include hostname, command, path, result, latency, error when present.
- Regression tests cover success and failure event completeness.

## Phase 2 - Diagnostics UI Summary and Rendering

- [ ] Redesign collapsed diagnostics activity summaries to show protocol/method, hostname, path or command, latency
- [ ] Keep expanded details lossless and deterministic
- [ ] Preserve mobile readability without fallback text hacks

Assumptions

- The most useful collapsed line is the first concrete network effect when present, with action names retained as supporting context.

Risks

- Overloading rows with too much text can break compact layouts and screenshot baselines.

Verification Criteria

- Collapsed entries render key network summary fields for REST/FTP-backed actions.
- Expanded rows still expose request/response bodies, headers, previews, and errors.

## Phase 3 - CPU Slider State Model Fix

- [ ] Replace the Home CPU slider draft-state path with the canonical optimistic slider state model
- [ ] Keep interactive preview writes immediate and commit writes deliberate
- [ ] Prevent device refresh from snapping the thumb backward during active drag

Assumptions

- The Play volume slider pattern is the canonical slider behavior for device-backed controls.

Risks

- CPU speed currently has coupled turbo-control side effects that must still run on commit.

Verification Criteria

- CPU slider value remains stable while dragging.
- No transient jump-back occurs when device data refetches during drag/commit.
- Turbo Control auto-adjust still occurs after commit.

## Phase 4 - Swipe Navigation Reimplementation

- [ ] Change commit threshold from fixed px to viewport-relative threshold (~30%)
- [ ] Keep page position following the finger in real time
- [ ] Separate gesture state from navigation transition state
- [ ] Preserve snap-back and completion animations

Assumptions

- Existing runway animation infrastructure is reusable if commit logic and state boundaries are tightened.

Risks

- Gesture changes can regress mouse behavior or conflict with interactive child controls.

Verification Criteria

- Drag progress updates the runway continuously.
- Swipes under threshold snap back.
- Swipes over threshold complete navigation with animation.

## Phase 5 - Diagnostics Navigation and Discoverability

- [ ] Enumerate all diagnostics surfaces
- [ ] Add a visible diagnostics sections index in the diagnostics UI
- [ ] Expose latency, history, config drift, and heat maps through explicit entry points
- [ ] Remove hidden/orphaned diagnostics features

Assumptions

- Analytics popups can remain modal surfaces if they are reachable from a stable index.

Risks

- Existing dialog layout may need minor restructuring to fit the new index without harming compact layouts.

Verification Criteria

- Every diagnostics surface has a visible trigger.
- No diagnostics component remains unreachable from the app UI.

## Phase 6 - Deep Linking Architecture

- [ ] Add stable diagnostics routes for each section
- [ ] Parse route -> diagnostics section on initial load
- [ ] Keep overlay/page state synchronized with route state
- [ ] Ensure close/back behavior is deterministic

Assumptions

- Routing diagnostics through the Settings slot is acceptable if the target section opens immediately and consistently.

Risks

- Multiple diagnostics owners can cause duplicated dialogs or conflicting open state.

Verification Criteria

- Routes like /diagnostics/config-diff and /diagnostics/rest-heatmap open the correct section directly.
- Deep links work on cold load and from in-app navigation.

## Phase 7 - Health Check System Redesign

- [ ] Make the health check result schema explicit and authoritative
- [ ] Ensure CONFIG runs unless explicitly impossible
- [ ] Emit explicit skip reasons for unsupported/blocked probes
- [ ] Persist the latest health check result outside overlay-local component state

Assumptions

- The existing probe order remains valid: REST -> FTP -> CONFIG -> RASTER -> JIFFY.

Risks

- Probe semantics are already used by health history and screenshots, so label/shape changes must be backwards compatible where possible.

Verification Criteria

- CONFIG result is Success, Fail, or Skipped-with-reason, never silently omitted.
- Latest health result is readable by any consumer without opening diagnostics.

## Phase 8 - Global Device Status Consistency

- [ ] Make latest health check result the primary source for overall health state
- [ ] Layer post-check degradations only from newer failures or explicit timeout logic
- [ ] Update the global badge and diagnostics header to use the same source
- [ ] Remove conflicting local derivations

Assumptions

- Trace-derived contributor data remains useful as secondary evidence and post-check degradation input.

Risks

- Existing badge tests assume purely trace-derived health and will need updated fixtures.

Verification Criteria

- Health badge and diagnostics header always show the same state.
- A successful health check updates global health immediately.
- Later failures can degrade health only when newer than the last health check.

## Phase 9 - Documentation Overhaul

- [ ] Update Docs page diagnostics section
- [ ] Document access paths and deep links for each diagnostics section
- [ ] Keep wording concise and technically precise

Assumptions

- In-app docs are the right place for operator guidance; no screenshot updates are needed unless visible docs UI changes materially.

Risks

- Deep links documented in docs must match the actual route table exactly.

Verification Criteria

- Docs page lists diagnostics sections, entry points, and deep-link paths.
- No broken or stale route references remain.

## Phase 10 - Testing and Regression Hardening

- [ ] Add/extend unit tests for diagnostics schema completeness
- [ ] Add/extend UI tests for collapsed summaries and discoverability
- [ ] Add slider regression coverage for no jump-back behavior
- [ ] Add swipe regression coverage for threshold and real-time movement
- [ ] Add health/global status consistency coverage
- [ ] Run lint, targeted unit tests, coverage, and build

Assumptions

- Existing diagnostics, runtime, and swipe unit test suites provide the narrowest deterministic proof points.

Risks

- Coverage must stay at or above the repository branch threshold while avoiding test-only overfitting.

Verification Criteria

- Relevant tests pass locally.
- `npm run test:coverage` passes with >= 91% branch coverage.
- `npm run build` passes.
