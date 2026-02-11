# C64 Commander Stabilization Plan

## Scope Summary
End-to-end fixes for UI interaction highlights, network reliability after idle, RAM load correctness, joystick swap 400s, drive path truncation UX, soft IEC error messaging, HVSC download/ingest crash resilience, playback lifecycle hardening, and song-lengths UI compaction. Includes deterministic verification (unit/integration/E2E/Maestro where feasible) and evidence logging.

## Assumptions And Constraints
- Repository source and test tooling are available locally (`npm`, Playwright, Android SDK/Emulator, Maestro).
- Emulator/device availability may limit hardware-coupled reproduction; when hardware is unavailable, deterministic mocks will be used.
- Existing repository modifications are preserved; only targeted changes for this scope are made.
- No test weakening/skips; root causes are fixed.
- `PLANS.md` is updated continuously as tasks complete and as new subtasks are discovered.

## Ordered Task List
- [ ] 1. Baseline and instrumentation setup
- [ ] 2. Fix pervasive button highlight persistence (A)
- [ ] 3. Fix network idle reliability and host unreachable handling (B)
- [ ] 4. Fix RAM load correctness against verified scripts (C)
- [ ] 5. Fix joystick swap HTTP 400 request shape/mapping (D)
- [ ] 6. Implement drive mount truncation rules (E1/E2)
- [ ] 7. Suppress persistent non-actionable soft IEC error state (F)
- [ ] 8. Reproduce and fix HVSC download/ingest crash + resilience (G)
- [ ] 9. Harden playback pause/resume/replay/lock-screen lifecycle (H)
- [ ] 10. Compact song lengths UI block while preserving required info (I)
- [ ] 11. Full verification sweep and evidence capture

---

## Task 1: Baseline And Instrumentation Setup
### Reproduction Steps
- Run baseline quality gate (`npm run lint`, `npm run test`, `npm run test:e2e`) and capture failures.
- Build Android app and run on emulator.
- Capture Logcat baseline for app tags/errors.

### Implementation Notes
- Identify affected shared UI controls/components and network stack modules.
- Add or extend structured logging scaffolding needed for B/G/H (correlation id, endpoint, timing, retries, idle state).

### Verification Steps
- Baseline command outputs captured in this document.
- Logging emits required context for representative failing network call.

---

## Task 2: Pervasive Button Highlight Persistence (A)
### Reproduction Steps
- Reproduce sticky highlight on representative pages: Home controls, Machine control pause/resume, Play controls, HVSC controls.
- Observe persistence after >500 ms on stateless controls.

### Implementation Notes
- Locate shared button/toggle styling/state behavior.
- Implement a single interaction model:
  - Stateless: transient pressed feedback only.
  - Toggle/stateful: visual active state bound only to control state.
- Remove focus/tap artifact bleed-through causing persistent highlight.

### Verification Steps
- Add Playwright tests asserting no persistent highlight for stateless buttons after 500 ms.
- Add tests asserting toggle highlight follows state only.
- Manual/emulator spot-check across listed pages.

---

## Task 3: Network Idle Reliability And Host Unreachable (B)
### Reproduction Steps
- Reproduce idle period (10-30s), then trigger request and observe failures/freeze.
- If hardware unavailable, use deterministic mock server with delayed/drop/keep-alive scenarios.

### Implementation Notes
- Audit request lifecycle, timeout/abort, retries, stale connection handling, and idempotency-aware retry policy.
- Ensure async boundaries keep UI responsive.
- Emit structured logs: method/endpoint/correlation id/timing/retry count/error class/message/idle state.

### Verification Steps
- Add deterministic tests for idle+first request and retry behavior.
- Validate no UI freeze under simulated delayed responses.
- Emulator/manual verification of recovery on first request after idle.

---

## Task 4: RAM Load Correctness Against Scripts (C)
### Reproduction Steps
- Identify verified script(s) in `scripts/` for RAM write/load path.
- Compare app request sequence/chunking/pacing vs scripts.

### Implementation Notes
- Align app load implementation with script-defined endpoint order/chunk sizing/delays/validation.
- Add explicit failure logging for RAM load steps.

### Verification Steps
- Add deterministic tests for request sequence + chunk payloads.
- Hardware/manual protocol recorded if direct integration available.

---

## Task 5: Joystick Swap HTTP 400 (D)
### Reproduction Steps
- Reproduce toggle and capture request/response details (status/body).

### Implementation Notes
- Correct endpoint/payload mapping and validation.
- Ensure optimistic UI state rolls back on failure with actionable error.

### Verification Steps
- Add unit/integration test asserting exact request shape for joystick swap.
- Confirm successful toggle in emulator/mock flow.

---

## Task 6: Drive Mount Truncation Rules (E1/E2)
### Reproduction Steps
- Reproduce truncation cases in constrained mount field and Drive A display.

### Implementation Notes
- E1: dynamically show filename when full path width does not fit.
- E2: preserve prefix + full filename, elide middle segments with `...`.
- Use rendered width measurement (no hardcoded char limits).

### Verification Steps
- Add unit tests for truncation helpers with width-constrained scenarios.
- Add component tests for both display contexts.

---

## Task 7: Soft IEC Persistent Service Error Message (F)
### Reproduction Steps
- Trace source/state that emits persistent “service error reported”.
- Determine actionable vs baseline status.

### Implementation Notes
- Gate message rendering to actionable conditions only.
- Provide less alarming passive indicator/details where relevant.

### Verification Steps
- Add tests for message visibility conditions.
- Manual validation that actionable errors still surface.

---

## Task 8: HVSC Download/Ingest Crash + Resilience (G)
### Reproduction Steps
- Build local mock HVSC server using cached real `.7z` archive (gitignored path).
- Run emulator + Maestro flow: download then ingest; collect Logcat with stack traces.
- Reproduce crash and restart state behavior.

### Implementation Notes
- Fix root causes (streaming/memory/file IO/progress persistence/state restoration/native bridge as applicable).
- Persist progress and reconcile state after restart.
- Add deterministic test hooks/config for mock server URL.
- Implement feature flag fallback only if stability remains unresolved after conclusive attempt.

### Verification Steps
- Integration tests against mock server for download+ingest.
- Maestro flow passes without crash.
- Restart after interruption shows correct recoverable state.

---

## Task 9: Playback Lifecycle Hardening (H)
### Reproduction Steps
- Reproduce long-pause resume timeout, replay-after-stop failure, lock-screen end-of-track stuck state.

### Implementation Notes
- Audit and harden playback state machine transitions and lifecycle event reconciliation.
- Ensure mixer settings reapply idempotently and resume ignores stale timeout assumptions.
- Ensure auto-advance and UI synchronization across lock/unlock/background transitions.

### Verification Steps
- Add state machine unit tests.
- Add integration tests with controlled timers/mock responses.
- Add Maestro lock/unlock end-of-track flow if feasible.

---

## Task 10: Song Lengths UI Compaction (I)
### Reproduction Steps
- Inspect current verbose block and wasted-space behavior.

### Implementation Notes
- Redesign to compact 1-2 line layout with required metadata (path+filename, entry count, size KB) and change action.
- Apply same path-elision rule (start + `...` + full filename).

### Verification Steps
- Update/add component tests for content visibility and compact layout behavior.
- Manual check in emulator and web.

---

## Task 11: Full Verification Sweep And Evidence Capture
### Reproduction Steps
- Execute full quality gates and platform validations after all fixes.

### Implementation Notes
- Run: lint, unit, e2e, build, Android tests, selected Maestro flows.
- Summarize outcomes and any residual risks explicitly.

### Verification Steps
- All required commands pass.
- Evidence captured below.

---

## Root Cause And Fix Log
- Pending.

## Done Evidence
- Pending.
