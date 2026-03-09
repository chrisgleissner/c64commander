# C64 Scope Delivery Prompt

## Purpose

This prompt is for an implementation LLM that must add `c64scope` to this repository without collapsing the broader autonomous-testing design back into a playback-only proof.

## Required Reading

Read these files in order before making architecture or implementation decisions:

1. `agentic-feature-surface.md`
2. `agentic-coverage-matrix.md`
3. `agentic-action-model.md`
4. `agentic-oracle-catalog.md`
5. `agentic-safety-policy.md`
6. `agentic-android-runtime-contract.md`
7. `agentic-observability-model.md`
8. `agentic-infrastructure-reuse.md`
9. `agentic-open-questions.md`
10. `agentic-test-architecture.md`
11. `c64scope-spec.md`
12. `agentic-test-implementation-plan.md`
13. `../../c64/c64u-stream-spec.md`
14. `../../developer.md`

Do not begin implementation until all required reading is done.

## Additional Required Reading By Need

- Read `../../c64/c64u-openapi.yaml` and `../../c64/c64u-ftp.md` before finalizing staging, media-launch, or filesystem assumptions.
- Read `../physical-device-matrix.md` before claiming real-hardware completion.
- Read `../../diagnostics/tracing-spec.md` before changing artifact or timeline semantics.

## Non-Negotiable Constraints

1. Use only three peer MCP servers: the mobile controller, currently `droidmind`, plus `c64bridge`, plus `c64scope`.
2. Do not extend `c64bridge`.
3. Do not extend the mobile controller.
4. Do not duplicate tool ownership already covered by peer servers.
5. Keep `c64scope` in `c64scope/`.
6. Treat C64 Commander as the primary control path under test.
7. Read `agentic-infrastructure-reuse.md` before adding any new infrastructure or artifact type.
8. Respect `agentic-safety-policy.md` before implementing destructive or long-running flows.
9. Do not assume `c64scope` is the only evidence owner for non-A/V features.
10. Current physical execution scope is Android only.

## Operating Rules

1. Preserve the controller-neutral boundary even though the current controller is Android-only.
2. Use the app path for normal media start/stop, queue behavior, disk actions, and settings flows.
3. Use `c64bridge` only for accepted gap-fill, recovery, or calibration.
4. Record meaningful peer-server actions in the `c64scope` timeline.
5. Attach app logs, traces, runtime logs, REST/FTP snapshots, filesystem artifacts, and state refs when they are the correct oracle.
6. If a behavior is blocked by `agentic-open-questions.md`, keep it separate instead of guessing.

## Delivery Sequence

### Phase 1

- Deliver the `c64scope` server skeleton and contract surface.

### Phase 2

- Deliver deterministic stream parsing, capture, and assertion behavior.

### Phase 3

- Deliver artifact correlation with app-native and runtime evidence, not only signal evidence.

### Phase 4

- Deliver one mixed-format Android physical regression with one deliberate failure bundle.

### Phase 5

- Expand beyond playback according to `agentic-coverage-matrix.md`, separating blocked work from ready work.

## What Completion Looks Like

Completion is not:

- a server scaffold
- a playback-only design
- an A/V-only oracle story

Completion is:

- a working `c64scope` server
- an Android physical regression that proves app-driven mixed-format playback
- documentation and implementation that stay aligned with the broader feature surface
- explicit separation of ready work and blocked work
