# Agentic Test Documentation Remediation Plan

## Objective

Address the actionable issues documented in:

- `doc/testing/agentic-tests/agentic-test-review.md`

This plan excludes iOS execution work for now. iOS testing is out of scope on the current Kubuntu-based lab setup because it would require Xcode/macOS tooling.

The remediation must still keep the architecture and documentation mobile-controller-agnostic enough that `droidmind` can later be replaced or complemented by an iOS-capable controller such as `mobile-mcp` without restructuring the whole system.

## Scope

### In scope

- Fix playback-centric under-scoping in the agentic-test docs.
- Add repository-derived feature coverage documentation.
- Define page/feature action models.
- Define non-A/V oracle models.
- Define observability reuse and evidence strategy.
- Define bounded-autonomy and destructive-action safety rules.
- Define Android/runtime-specific contracts.
- Define infrastructure reuse from Playwright, Maestro, Android JVM tests, and in-app diagnostics.
- Separate implementable work from blockers caused by missing product specifications.
- Keep the controller boundary generic enough for future iOS support.

### Out of scope

- Implementing iOS automation or adding an iOS MCP controller now.
- Writing Xcode-based workflows, simulators, or macOS-only test infrastructure.
- Claiming end-to-end iOS physical coverage.

## Phases

### Phase 0. Scope Reset

- [ ] Update `doc/testing/agentic-tests/agentic-test-architecture.md` to distinguish:
  - Android-first remediation work
  - future mobile-controller expansion
  - baseline playback proof vs full feature-surface autonomous coverage
- [ ] Add an explicit statement that current execution scope is Android-only.
- [ ] Add an explicit statement that the control-plane boundary must remain mobile-controller-agnostic so `droidmind` can later be swapped or complemented by `mobile-mcp` or similar.
- [ ] Remove or rewrite any wording that currently implies iOS execution is already covered by the present architecture.

### Phase 1. Repository Feature Inventory

- [ ] Create `doc/testing/agentic-tests/agentic-feature-surface.md`.
- [ ] Document all repository-derived feature areas by route/page:
  - Home
  - Play
  - Disks
  - Config
  - Settings
  - Docs
  - Licenses
  - cross-cutting connection/demo/runtime behaviors
- [ ] Mark high-risk, destructive, asynchronous, background-sensitive, and hardware-coupled features.
- [ ] Add an explicit note that the repository does not currently expose a `Dock` page.

### Phase 2. Coverage Matrix

- [ ] Create `doc/testing/agentic-tests/agentic-coverage-matrix.md`.
- [ ] Map every major repository-derived feature area to:
  - current documentation status
  - testability status
  - required oracle class
  - safety class
  - instrumentation/specification blocker state
- [ ] Ensure no major feature area from the review is omitted silently.

### Phase 3. Action Model

- [ ] Create `doc/testing/agentic-tests/agentic-action-model.md`.
- [ ] Define route discovery and page entry rules.
- [ ] Define dialog/disclosure handling rules.
- [ ] Define conditional-surface discovery rules for feature flags, demo mode, connection state, and device-dependent UI.
- [ ] Define action catalogs for:
  - Home
  - Play
  - Disks
  - Config
  - Settings
  - Docs/Licenses
- [ ] For each page area, document preconditions, postconditions, recovery paths, and escape conditions.

### Phase 4. Oracle Catalog

- [ ] Create `doc/testing/agentic-tests/agentic-oracle-catalog.md`.
- [ ] Define acceptable oracle types:
  - app UI
  - REST-visible state
  - FTP-visible state
  - filesystem-visible state
  - diagnostics/logs/traces
  - RAM/state snapshots
  - C64 A/V output
- [ ] Define primary and fallback oracles for connection/demo-mode behavior.
- [ ] Define primary and fallback oracles for machine control and RAM workflows.
- [ ] Define primary and fallback oracles for playback and mixed-format progression.
- [ ] Define primary and fallback oracles for background playback and lock behavior on Android.
- [ ] Define primary and fallback oracles for HVSC download/install/ingest/cancel/reset flows.
- [ ] Define primary and fallback oracles for disk library, mount/eject, drive config, and Soft IEC flows.
- [ ] Define primary and fallback oracles for Config category edits, clock sync, and audio mixer reset/solo flows.
- [ ] Define primary and fallback oracles for Settings persistence, diagnostics export, settings import/export, and device-safety changes.
- [ ] Explicitly list weak or forbidden oracles that are not sufficient on their own.

### Phase 5. Observability and Evidence Reuse

- [ ] Create `doc/testing/agentic-tests/agentic-observability-model.md`.
- [ ] Document reuse of existing in-app observability:
  - diagnostics logs
  - trace events
  - action summaries
  - diagnostics ZIP export
  - test heartbeat and probe surfaces
- [ ] Document reuse of existing external evidence:
  - Playwright traces/videos/screenshots/golden traces
  - Maestro screenshots and native-flow knowledge
  - Android logcat/plugin logs
  - Android JVM plugin-test assumptions
- [ ] Define how app-side evidence is correlated with `c64scope` evidence.
- [ ] Update `doc/testing/agentic-tests/c64scope-spec.md` so `c64scope` is not implied to be the only meaningful evidence owner.

### Phase 6. Safety and Bounded Autonomy

- [ ] Create `doc/testing/agentic-tests/agentic-safety-policy.md`.
- [ ] Define action classes:
  - read-only
  - guarded mutation
  - destructive mutation
  - prohibited
- [ ] Add explicit limits for:
  - resets/reboots/power-offs
  - RAM save/load/clear operations
  - flash config save/load/reset operations
  - HVSC download/ingest/retry loops
  - stream start/stop loops
  - disk delete and bulk delete actions
  - device-safety mode changes
- [ ] Define cleanup and reset requirements after mutating runs.
- [ ] Update `doc/testing/agentic-tests/agentic-test-architecture.md` to add app-level safety constraints, not only `c64bridge` constraints.

### Phase 7. Android Runtime Contracts

- [ ] Create `doc/testing/agentic-tests/agentic-android-runtime-contract.md`.
- [ ] Document the actual connection/demo state machine from `src/lib/connection/connectionManager.ts`.
- [ ] Document Android-specific background execution expectations from `src/pages/PlayFilesPage.tsx` and `src/lib/native/backgroundExecution.ts`.
- [ ] Document Android-native file/SAF/FTP/plugin constraints that affect autonomous testing.
- [ ] Document what counts as product failure vs lab/runtime failure for Android runs.

### Phase 8. Controller Abstraction for Future iOS Support

- [ ] Update `doc/testing/agentic-tests/agentic-test-architecture.md` to define a generic `mobile controller` role separate from the current `droidmind` implementation.
- [ ] Keep current Android implementation mapped to `droidmind`.
- [ ] Describe controller-owned responsibilities in interface terms rather than Android-tool names where possible:
  - app lifecycle control
  - UI interaction
  - screenshots
  - device logs
  - file staging
  - diagnostics access
- [ ] Add a short compatibility note explaining that a future controller such as `mobile-mcp` could satisfy the same role for iOS if it meets the documented contract.
- [ ] Ensure no remediation doc binds page/action/oracle semantics irreversibly to `droidmind`-specific wording when a controller-neutral description is sufficient.

### Phase 9. Infrastructure Reuse Map

- [ ] Create `doc/testing/agentic-tests/agentic-infrastructure-reuse.md`.
- [ ] Map Playwright suites to reusable oracle and evidence patterns.
- [ ] Map Maestro Android flows to native affordance coverage and edge-case seeds.
- [ ] Map Android JVM plugin tests to native behavior assumptions and failure modes.
- [ ] Update `doc/testing/agentic-tests/c64scope-delivery-prompt.md` so future implementation work must read the reuse map before adding new infrastructure.

### Phase 10. Blockers and Missing Product Specs

- [ ] Create `doc/testing/agentic-tests/agentic-open-questions.md`.
- [ ] Move all unresolved non-iOS behavior questions from the review into explicit blocker entries.
- [ ] For each blocked feature area, classify the blocker as:
  - missing expected behavior
  - missing instrumentation
  - safety-policy decision needed
  - intentional out-of-scope
- [ ] Update `doc/testing/agentic-tests/agentic-test-implementation-plan.md` so directly implementable work is separated cleanly from blocked work.

### Phase 11. Final Synchronization

- [ ] Reconcile `agentic-test-architecture.md`, `c64scope-spec.md`, `agentic-test-implementation-plan.md`, and `c64scope-delivery-prompt.md` with the new inventory, oracle, safety, runtime, and reuse docs.
- [ ] Verify the documentation set no longer implies that mixed-format playback alone represents full autonomous coverage.
- [ ] Verify all non-iOS review issues are either addressed or converted into explicit blockers.

## Issue Coverage Map

### Directly addressed by this plan

- ATR-001 feature surface under-scoped
- ATR-002 A/V-centric oracle model
- ATR-003 missing exploration model
- ATR-005 missing bounded autonomy for destructive/resource-heavy actions
- ATR-006 missing in-app observability integration
- ATR-007 connection/demo-mode contract missing
- ATR-008 long-running workflow contract missing
- ATR-009 config breadth not decomposed
- ATR-010 disk-management oracles and safety missing
- ATR-011 Android background/lock behavior under-specified
- ATR-012 implementation handoff quality too weak
- ATR-013 infrastructure reuse missing
- ATR-014 missing expected-behavior specifications

### Explicitly excluded for now

- ATR-004 iOS execution/control-path gap

Mitigation for future compatibility:

- Keep the controller boundary generic enough that an iOS-capable mobile MCP can later implement the same documented role.

## Success Criteria

- The documentation set is expanded beyond playback-first scope and matches the real repository feature surface.
- Every major non-iOS feature area has a documented action model and oracle model.
- Safety rules exist for destructive and long-running workflows.
- Existing observability and test infrastructure is explicitly reused.
- Android-specific runtime behavior is documented clearly enough for autonomous execution.
- The architecture is Android-first now but controller-neutral enough for future replacement of `droidmind` with a broader mobile controller.
- Remaining unresolved items are explicit blockers, not implicit assumptions.

## Risks

- Risk: The docs may stay too abstract and fail to constrain follow-up implementation.
  - Mitigation: Require concrete deliverables per phase and per feature area.
- Risk: Future edits may accidentally reintroduce Android-specific controller coupling.
  - Mitigation: Keep controller responsibilities documented at an interface/role level first, implementation mapping second.
- Risk: Missing expected-behavior specs may stall documentation updates.
  - Mitigation: Convert unresolved behavior into blocker entries instead of guessing.
- Risk: Safety policies may remain too vague for destructive features.
  - Mitigation: Require explicit allowed/guarded/prohibited classifications and cleanup rules.

## Execution Log

- 2026-03-07: Replaced the completed review plan with a remediation task plan derived from `doc/testing/agentic-tests/agentic-test-review.md`.
- 2026-03-07: Excluded iOS execution work from the active scope while preserving a future mobile-controller abstraction requirement.

## Decisions

- Decision: iOS execution remains out of scope for the current Kubuntu-driven lab.
- Decision: Documentation remediation must still preserve a controller-neutral architecture boundary so `droidmind` is not baked in permanently.
- Decision: The active remediation target is all non-iOS issues from `agentic-test-review.md`.

## Current Status

- Current phase: Remediation planning complete, implementation pending
- Blockers:
  - Some non-iOS expected behaviors still need explicit product clarification before they can be documented as deterministic autonomous test contracts.
