# Device Switcher Implementation Prompt

Date: 2026-04-09
Type: Strict execution prompt
Primary inputs:

- [device-switch-spec.md](./device-switch-spec.md)
- [plan.md](./plan.md)

Expected change classification: `DOC_PLUS_CODE`, `UI_CHANGE`

## Role

You are the implementation engineer responsible for shipping the device switcher end to end.

This is not a research pass.
This is not a brainstorming pass.
This is not a partial scaffold pass.

You must implement the feature described in [device-switch-spec.md](./device-switch-spec.md) by following the sequence in [plan.md](./plan.md), then validate the result honestly.

## Objective

Add first-class multi-device switching to C64 Commander so a user can switch between saved devices in 2 taps from any main page through the existing health badge and diagnostics flow.

The implementation must preserve fast switching, avoid full-config fetches during the switch handshake, keep memory usage bounded across multiple devices, and preserve playback or mount continuity for playlist and disk items that were imported from a different saved C64 device.

You must also extend the existing mock and agentic-test infrastructure so these scenarios can be validated end to end with multiple independently configurable devices.

## Authoritative Inputs

Read these before editing:

- `README.md`
- `.github/copilot-instructions.md`
- `docs/ux-guidelines.md`
- [device-switch-spec.md](./device-switch-spec.md)
- [plan.md](./plan.md)

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

1. The behavior in [device-switch-spec.md](./device-switch-spec.md) is the source of truth.
2. The sequence in [plan.md](./plan.md) is the source of truth for implementation order.
3. Do not add a new top-level tab.
4. Do not move switching controls into the shared header beyond the existing badge.
5. Do not fetch `c64-all-config` as part of the switch handshake.
6. Do not retain full heavy working sets for multiple devices by default.
7. Do not silently break `ultimate` playlist or disk items that were imported from another saved device.
8. Do not silently swallow exceptions.
9. Every bug fix or regression discovered during implementation must get a dedicated regression test.
10. Do not claim tests, builds, or screenshot updates you did not actually run.
11. Extend the existing mock layers instead of introducing a disconnected second mock architecture unless you can prove reuse is impossible.

## Required End State

Your implementation is only complete when all of the following are true:

- a saved device can be selected from diagnostics in 2 taps from any main page
- badge tap still opens diagnostics
- the badge shows a unique compact label of at most 8 visible characters
- diagnostics and settings show canonical product-family codes
- selecting a device updates visible identity immediately from local metadata
- `/v1/info` performs the live verification
- only active-route essential data reloads after successful verification
- full config is not fetched during switching
- `ultimate` playlist items and disk entries imported from another saved device still work after switching
- when origin and selected devices differ, the app fetches bytes from the origin device and executes the selected device upload path without changing `selectedDeviceId`
- origin-device failure degrades only the affected item, not the entire selected-device connection state
- the mock infrastructure can provision multiple devices at once, each with distinct ports, identity, and filesystem state
- mocks can be started, stopped, restarted, or made unreachable at runtime during a test session
- multi-device agentic cases can target both mocked and real devices in one run model
- offline, mismatch, host-edit, and older-firmware behavior matches the spec
- the per-device switch cache is bounded and does not become a full per-device app-state cache

## Required Mock Infrastructure Outcome

The upgraded test harness must support all of the following:

- multiple concurrent mock devices, not a single implicit server
- a reusable mock device descriptor that can vary:
  - device type or product-family identity
  - hostname
  - unique id
  - HTTP port
  - FTP port
  - Telnet port when relevant
  - filesystem contents
  - timing or fault behavior
- per-device request logs so origin and selected device traffic can be asserted separately
- runtime control to start, stop, restart, or disable one device without collapsing the whole harness
- deterministic port assignment or reservation to avoid clashes in multi-device runs

Reuse the existing layers where applicable:

- `tests/mocks/mockC64Server.ts`
- `tests/android-emulator/helpers/mockC64Server.mjs`
- `src/lib/native/mockC64u.ts`
- `src/lib/native/mockC64u.web.ts`
- Android native `MockC64U` plugin and its tests

## Required Agentic-Test Outcome

Extend the agentic infrastructure so a case can declare a device inventory containing multiple targets with explicit target kind:

- external mock
- native demo mock
- real hardware

Each case must be able to state:

- which target is initially selected
- which target owns an imported playlist or disk item
- which target becomes unavailable during the run
- whether the case is fully mocked, mixed mocked plus real, or fully real

Do not make the agentic design Android-only at the contract level. Android remains the current execution platform, but the target-inventory model must stay controller-neutral.

## Execution Model

Implement in the phases defined in [plan.md](./plan.md).

Minimum expected order:

1. saved-device model and migration
2. switch orchestration and verification
3. device-bound collection origin resolution
4. multi-device mock and harness support
5. diagnostics and settings UI
6. route reload and cache bounds
7. edge behavior and conflict handling
8. validation and documentation closure

Do not jump ahead to cosmetic UI work before the underlying switch model is correct.

## Required Validation

Because this task changes executable behavior, the final validation must include:

- `npm run lint`
- `npm run test`
- `npm run test:coverage`
- `npm run build`

Also run the smallest honest UI validation needed to prove:

- the 2-tap switch flow
- immediate local label update
- verification state transition
- no visible regression in diagnostics or settings switching surfaces

Also run the smallest honest behavioral validation needed to prove:

- a playlist item imported from saved device A still plays after switching to saved device B
- a disk entry imported from saved device A still mounts after switching to saved device B
- origin-device failures are surfaced as item-level failures without changing the selected device
- two mock devices with different ports and filesystems can run concurrently
- one mock device can be stopped or restarted during the scenario without corrupting the other device state

Also validate the expanded agentic path:

- multi-device case definitions support mocked and real targets
- the agentic harness can represent an origin device distinct from the currently selected device
- mock target lifecycle controls are expressible in the case model without resorting to out-of-band manual steps

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

- the current codebase structure contradicts the spec in a way that requires a product decision
- the migration path cannot preserve existing single-device behavior safely
- the route reload architecture cannot support the required active-route-only refresh model without a deeper redesign
- the current playback or disk execution model cannot support origin-device reacquisition without a broader architectural change
- the existing mock layers cannot be extended to support concurrent independently controlled devices without a larger testing-architecture decision
