# Device Switcher V2 Implementation Prompt

Date: 2026-04-09
Type: Strict execution prompt
Primary inputs:

- [ux-recommendations-2026-04-09.md](./ux-recommendations-2026-04-09.md)
- [plan.md](./plan.md)
- [../device-switch-spec.md](../device-switch-spec.md)

Expected change classification: `DOC_PLUS_CODE`, `UI_CHANGE`

## Role

You are the implementation engineer responsible for shipping device switching v2 end to end.

This is not a research pass.
This is not a brainstorming pass.
This is not a partial scaffold pass.

You must implement the badge long-press device picker described in [ux-recommendations-2026-04-09.md](./ux-recommendations-2026-04-09.md) by following the sequence in [plan.md](./plan.md), then validate the result honestly.

## Objective

Add first-class multi-device switching to C64 Commander so device switching is anchored on the existing badge:

- tap badge -> Diagnostics
- long press badge -> compact `Switch device` picker

The implementation must preserve fast switching, avoid full-config fetches during the switch handshake, keep memory usage bounded across multiple devices, and preserve playback or mount continuity for playlist and disk items imported from another saved device.

## Authoritative Inputs

Read these before editing:

- `README.md`
- `.github/copilot-instructions.md`
- `docs/ux-guidelines.md`
- [ux-recommendations-2026-04-09.md](./ux-recommendations-2026-04-09.md)
- [plan.md](./plan.md)
- [../device-switch-spec.md](../device-switch-spec.md)

Then read the smallest relevant set of implementation files in:

- `src/components/`
- `src/pages/`
- `src/hooks/`
- `src/lib/connection/`
- `src/lib/playback/`
- `src/lib/disks/`
- `src/lib/query/`
- `src/lib/config/`
- `src/lib/diagnostics/`
- `tests/mocks/`
- `tests/android-emulator/helpers/`
- Android native mock-server plugin and related tests
- `docs/testing/agentic-tests/`

## Non-Negotiable Rules

1. The behavior in [ux-recommendations-2026-04-09.md](./ux-recommendations-2026-04-09.md) is the source of truth for switching interaction.
2. The sequence in [plan.md](./plan.md) is the source of truth for implementation order.
3. Preserve tap on the badge -> Diagnostics.
4. Add long press on the badge -> compact `Switch device` picker.
5. Do not reintroduce a persistent Devices switcher section into Diagnostics.
6. Keep picker rows name-first and minimal by default.
7. Do not fetch `c64-all-config` as part of the switch handshake.
8. Do not retain full heavy working sets for multiple devices by default.
9. Do not silently break `ultimate` playlist or disk items imported from another saved device.
10. Do not silently swallow exceptions.
11. Every bug fix or regression discovered during implementation must get a dedicated regression test.
12. Do not claim tests, builds, or screenshot updates you did not actually run.
13. Extend the existing mock layers instead of introducing a disconnected second mock architecture unless you can prove reuse is impossible.

## Required End State

Your implementation is only complete when all of the following are true:

- tap on the badge still opens Diagnostics
- long press on the badge opens the picker when multiple saved devices exist
- the one-device case shows no redundant switching UI
- picker rows are name-first in the healthy idle state
- hostnames, product-family codes, and identity fragments are not rendered by default in healthy picker rows
- selecting a device updates visible identity immediately from local metadata
- `/v1/info` performs the live verification
- only active-route essential data reloads after successful verification
- full config is not fetched during switching
- Diagnostics no longer contains a persistent Devices switcher section
- Settings and Diagnostics overflow still provide the intended management and detail surfaces
- `ultimate` playlist items and disk entries imported from another saved device still work after switching
- when origin and selected devices differ, the app fetches bytes from the origin device and executes the selected device upload path without changing `selectedDeviceId`
- origin-device failure degrades only the affected item, not the entire selected-device connection state
- the mock infrastructure can provision multiple devices at once, each with distinct ports, identity, and filesystem state
- mocks can be started, stopped, restarted, or made unreachable at runtime during a test session
- the per-device switch cache is bounded and does not become a full per-device app-state cache

## Required UX Outcome

The shipped UI must reflect the v2 interaction model exactly:

- badge is the single device-context anchor
- tap means inspect status
- long press means switch device
- picker is a decision-only surface, not a management surface
- Diagnostics is for status and inspection, not primary switching
- Settings remains the CRUD surface

If the older base spec still describes Diagnostics as the primary switching surface, update the docs to match the shipped v2 behavior rather than implementing the outdated interaction.

## Required Mock Infrastructure Outcome

The upgraded test harness must support all of the following:

- multiple concurrent mock devices, not a single implicit server
- per-device request logs so origin and selected device traffic can be asserted separately
- runtime control to start, stop, restart, or disable one device without collapsing the whole harness
- deterministic port assignment or reservation to avoid clashes in multi-device runs
- automation coverage for badge long press and picker-based switching

Reuse the existing layers where applicable:

- `tests/mocks/mockC64Server.ts`
- `tests/android-emulator/helpers/mockC64Server.mjs`
- `src/lib/native/mockC64u.ts`
- `src/lib/native/mockC64u.web.ts`
- Android native `MockC64U` plugin and its tests

## Execution Model

Implement in the phases defined in [plan.md](./plan.md).

Minimum expected order:

1. discovery and alignment
2. saved-device model and migration
3. badge long-press and picker shell
4. switch orchestration and verification
5. diagnostics and settings simplification
6. device-bound collection continuity
7. multi-device mock and harness support
8. reload, cache, and edge behavior
9. validation and documentation closure

Do not jump ahead to cosmetic UI work before the underlying switch model is correct.

## Required Validation

Because this task changes executable behavior, the final validation must include:

- `npm run lint`
- `npm run test`
- `npm run test:coverage`
- `npm run build`

Also run the smallest honest UI validation needed to prove:

- tap on the badge still opens Diagnostics
- long press opens the picker
- picker rows are name-first by default
- picker selection enters `Verifying` and resolves correctly
- Diagnostics no longer shows a persistent Devices section

Also run the smallest honest behavioral validation needed to prove:

- a playlist item imported from saved device A still plays after switching to saved device B
- a disk entry imported from saved device A still mounts after switching to saved device B
- origin-device failures are surfaced as item-level failures without changing the selected device
- two mock devices with different ports and filesystems can run concurrently
- one mock device can be stopped or restarted during the scenario without corrupting the other device state

If visible documented UI changes, refresh only the affected screenshots under `docs/img/`.

## Output Requirements

At completion, report:

- what changed
- which phases from [plan.md](./plan.md) were completed
- which tests and builds were run
- whether screenshots were updated
- any remaining known risk or follow-up item

## Failure Rules

Stop and report a blocker instead of guessing if:

- the current codebase structure cannot support reliable long press without harming ordinary tap behavior
- the migration path cannot preserve existing single-device behavior safely
- the route reload architecture cannot support the required active-route-only refresh model without a deeper redesign
- the current playback or disk execution model cannot support origin-device reacquisition without a broader architectural change
- the existing mock layers cannot be extended to support concurrent independently controlled devices without a larger testing-architecture decision
