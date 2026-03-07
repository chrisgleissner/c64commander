# Agentic Test Implementation Plan

## Objective

Deliver a usable autonomous physical testing stack that is:

- Android-first for execution today
- controller-neutral at the architecture boundary
- broader than playback-only scope
- explicit about what is implementable now versus what is blocked on product or lab decisions

## Documentation Baseline

Completed documentation inputs:

- `agentic-feature-surface.md`
- `agentic-coverage-matrix.md`
- `agentic-action-model.md`
- `agentic-oracle-catalog.md`
- `agentic-observability-model.md`
- `agentic-safety-policy.md`
- `agentic-android-runtime-contract.md`
- `agentic-infrastructure-reuse.md`
- `agentic-open-questions.md`
- `agentic-test-architecture.md`
- `c64scope-spec.md`

## Hard Rules

- Keep `c64scope` in a dedicated top-level `c64scope/` folder.
- Do not modify `c64bridge`.
- Do not modify the mobile controller to make `c64scope` work around missing architecture decisions.
- Use existing repo observability and test infrastructure before adding new infrastructure.
- Keep product-validation runs app-first.

## Implementable Work

### Phase 1: `c64scope` Skeleton And Contracts

Deliver:

- MCP server shell
- frozen tool groups
- frozen resources and prompts
- session and artifact schema validation

Exit criteria:

- the server exposes the required tool groups
- a session can be started without inventing wrapper APIs

### Phase 2: Stream, Capture, And Assertion Core

Deliver:

- deterministic C64U stream receiver
- health reporting
- feature extraction
- assertion engine

Exit criteria:

- packet edge cases are covered
- signal-sensitive cases can produce deterministic pass, fail, or inconclusive results

### Phase 3: Artifact And Correlation Pipeline

Deliver:

- timeline recording
- external evidence attachments
- final artifact bundle
- failure classification

Exit criteria:

- a failed run is diagnosable without immediate rerun

### Phase 4: First Physical Regression Slice

Deliver:

- one mixed-format playback case
- full Android runtime evidence for playback and progression
- one deliberate failure case

Exit criteria:

- playback start, A/V signature, dwell, and progression are proven through the app path

### Phase 5: Broader Feature-Surface Expansion

Deliver:

- connection/demo-mode cases
- HVSC lifecycle cases
- disk-management cases
- settings and diagnostics cases
- selected guarded Home and Config cases

Exit criteria:

- coverage grows according to `agentic-coverage-matrix.md`, not ad hoc case selection

## Blocked Or Partially Blocked Work

These areas are documented but must remain separate until the blocker is resolved:

- RAM save/load/clear success contract
- printer and stream-control end-state semantics
- config-category breadth that lacks stable expected behavior
- clock-sync success tolerance
- diagnostics export and settings-transfer completion semantics on Android OS handoff paths
- safe lab namespaces for staged files and destructive cleanup
- whether Device Safety settings may be mutated outside dedicated cases

Source of truth for blockers:

- `agentic-open-questions.md`

## Definition Of Done

Implementation is complete only when:

- the delivered behavior matches `c64scope-spec.md`
- the architecture still matches `agentic-test-architecture.md`
- every implemented case maps back to `agentic-coverage-matrix.md`
- destructive actions obey `agentic-safety-policy.md`
- non-A/V cases use `agentic-oracle-catalog.md`, not playback-only assertions
- existing observability and infrastructure are reused per `agentic-observability-model.md` and `agentic-infrastructure-reuse.md`

## Non-Goal

- iOS physical execution is not part of the current implementation target. The architecture must stay compatible with it, but no current phase may claim iOS physical coverage.
