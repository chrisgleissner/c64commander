# Review-15 Handover Prompt

Date: 2026-04-18
Type: execution handoff
Primary source of truth: [review-15.md](review-15.md)

## Role

You are the continuation engineer for the remaining review-15 work in C64 Commander.

This is not a fresh audit.
This is not permission to reopen repository-side backlog that has already been closed.
This is a targeted handoff for the work that still remains after the repo-side review-15 fixes and test-ownership gaps were completed.

## Primary Goal

Close the remaining review-15 follow-ons that still require external execution environments, hardware, Apple-hosted tooling, or deployed-edge verification.

Default assumption:

- repository-side review-15 code and test gaps are already closed
- further code changes are only needed if real-device, CI, or deployed-edge execution reveals a genuine defect

## Read First

Read these before taking action:

- [review-15.md](review-15.md)
- [.github/copilot-instructions.md](../../../.github/copilot-instructions.md)
- [AGENTS.md](../../../AGENTS.md)
- [README.md](../../../README.md)
- [docs/testing/maestro.md](../../testing/maestro.md)
- [docs/testing/physical-device-matrix.md](../../testing/physical-device-matrix.md)

Use these review sections as the active status baseline:

- Section 4: Feature-to-Test Matrix
- Section 5: Risk Register
- Section 6: External Validation Follow-ons
- Section 7: Completeness Report
- Section 9: Execution Worklog, especially `W-09` and `W-10`

## Current Repository Truth

Treat the following as already completed unless current code clearly proves otherwise:

- router-level swipe and page-error recovery assertions
- docs and open-source licenses page ownership tests
- auth-state server-process integration coverage
- build-gated coverage-probe loading
- disk mount/reset convergence tests
- settings-to-runtime safety propagation tests
- diagnostics route round-tripping coverage
- live web-server header matrix coverage

Do not spend time re-closing those items unless you discover a regression introduced after the current `review-15.md` state.

## What Is Still Left

The remaining work is the external validation backlog from Section 6 of [review-15.md](review-15.md).

### F-01: Short-track auto-advance on preferred hardware

- Area: playback transport
- Target platforms: Android and iOS
- Preferred hardware target: `u64`
- Suggested flow: `.maestro/hil-short-track-auto-advance.yaml`
- Goal: prove very short-track auto-advance against the preferred real hardware target

### F-02: Lock-screen playback under battery optimization

- Area: lock-screen playback
- Target platform: Android
- Required handset: Pixel 4
- Suggested flow: `.maestro/perf-background-battery-opt.yaml`
- Goal: prove long-duration background playback under realistic OEM battery policy

### F-03: RAM and SAF persistence recovery

- Area: RAM/SAF persistence
- Target platform: Android
- Required handset: Pixel 4
- Suggested flow: physical-device RAM/SAF recovery execution
- Goal: prove folder revocation and interrupted-write recovery on the preferred phone

### F-04: iOS plugin registry execution

- Area: iOS plugin registry
- Target platform: iOS
- Required environment: simulator or CI on Apple tooling
- Suggested suite: `ios/App/AppTests/NativePluginsRegistrationTests.swift`
- Goal: prove app-hosted registration beyond SwiftPM source validation

### F-05: iOS HVSC lifecycle parity

- Area: iOS HVSC lifecycle parity
- Target platform: iOS
- Required environment: simulator or CI on Apple tooling
- Suggested suite: iOS native HVSC ingest lifecycle suite
- Goal: mirror the already-closed shared/runtime repo work on Apple-hosted execution

### F-06: Deployed-edge header verification

- Area: deployed-edge web headers
- Target platform: Web
- Required environment: deployed or canary edge
- Suggested flow: edge canary or production header probe
- Goal: prove final reverse-proxy header behavior outside the local web server harness

## Device And Environment Rules

### Real-device preference order

1. Probe `http://u64/v1/info` first.
2. Probe `http://c64u/v1/info` second.
3. If `u64` is reachable, use it.
4. Fall back to `c64u` only if `u64` is unreachable.

### Android device preference

1. Prefer the adb-attached Pixel 4.
2. Use another attached device only if the Pixel 4 is unavailable.

### iOS limitation

- This Linux/Kubuntu workspace cannot execute Swift or Apple-hosted iOS validation locally.
- iOS follow-ons must run on CI or a macOS/simulator environment.

## Execution Order

Follow this order unless fresh evidence forces a narrower dependency-first change.

### Phase 0: Reconfirm that repo-side work is still closed

- Re-read [review-15.md](review-15.md) Sections 4-7.
- Re-read any files that changed since the last handoff before editing.
- Only reopen repo-side work if current code or failing execution proves a real regression.

Completion gate:

- active backlog contains only the still-open external items or newly proven regressions

### Phase 1: Close Android physical-device follow-ons

Target items:

- `F-01`
- `F-02`
- `F-03`

Completion gate:

- Android and hardware-dependent claims have Pixel 4 and preferred-target evidence where required
- any newly discovered bug has a root-cause fix plus targeted regression coverage

### Phase 2: Close iOS Apple-hosted follow-ons

Target items:

- `F-04`
- `F-05`

Completion gate:

- iOS coverage claims in [review-15.md](review-15.md) are backed by app-hosted XCTest or simulator/CI evidence, not only source-level validation

### Phase 3: Close deployed-edge web follow-on

Target item:

- `F-06`

Completion gate:

- deployed-edge header behavior is verified outside the local web server test harness

### Phase 4: Reconcile the review

After external validation work:

- update [review-15.md](review-15.md)
- revise Section 4 statuses that changed
- downgrade or close Section 5 risks that are no longer current
- mark completed Section 6 follow-ons as closed or evidenced
- keep Section 7 truthful

Completion gate:

- the review reflects the new evidence instead of the pre-handoff state

## Rules

1. Do not start a new review file.
2. Do not reopen closed repo-side gaps unless current evidence proves regression.
3. If hardware or CI execution reveals a defect, fix the root cause instead of weakening assertions.
4. Every real bug fix still needs a targeted regression test.
5. Do not claim hardware, CI, or deployed-edge evidence you did not actually collect.
6. Keep the remaining work scoped to the follow-ons above, not to a broad new audit.

## Validation Expectations

Choose the smallest honest validation set that matches what you actually changed.

If you only collect external evidence and update docs:

- verify documentation consistency
- update [review-15.md](review-15.md)
- do not run builds or tests for ceremony alone

If external execution uncovers and requires code changes:

- run the relevant targeted tests first
- then finish with the required repo validation for the touched layers, typically:
  - `npm run lint`
  - `npm run test`
  - `npm run test:coverage`
  - `npm run build`
- add `cd android && ./gradlew test` if Android native code changes
- add the smallest honest Playwright or Maestro validation for touched UI/runtime paths

## Success Criteria

You may stop only when one of these is true:

1. All remaining follow-ons in Section 6 of [review-15.md](review-15.md) have been completed with real evidence and the review has been updated.
2. A follow-on is still blocked by unavailable hardware, CI, or deployment context, and the block is documented precisely with the smallest next action required.

## Completion Output

At the end, report:

- which follow-on IDs were completed
- which environments and devices were used
- any code changes made because external validation found a real defect
- which validation commands and external flows were run
- which Section 4, 5, and 6 entries in [review-15.md](review-15.md) changed
