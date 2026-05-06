# Slider Responsiveness Stabilization Prompt

Date: 2026-05-06
Type: Strict execution prompt
Primary inputs:

- [research.md](docs/research/stabilization/slider-responsiveness/research.md)
- [plan.md](docs/research/stabilization/slider-responsiveness/plan.md)

Expected change classification: `DOC_PLUS_CODE`, `UI_CHANGE`

## Role

You are the implementation engineer responsible for shipping the full slider-responsiveness stabilization described in [research.md](./research.md).

This is not a research pass.
This is not a hot-fix-only pass.
This is not permission to stop after Home CPU Speed feels better locally.

You must implement the full consolidation by following [plan.md](./plan.md), then validate the result honestly.

## Objective

Stabilize all device-bound slider behavior in the repository so:

- slider drag feedback is immediate and local
- device writes are validated before they are sent
- firmware-declared write failures are treated as failures
- no slider freezes behind stale optimistic pending state
- final committed values reliably reach the device
- all device-bound sliders share one consistent draft/preview/commit/reconciliation model

The implementation must cover the entire problem surfaced by [research.md](./research.md), including:

- silent acceptance of firmware `errors[]` responses
- invalid batch/value hazards
- trim/type drift during optimistic reconciliation
- duplicate slider async/write abstractions
- whole-page drag state on Home CPU Speed
- pending-based disable gates that can strand sliders

## Authoritative Inputs

Read these before editing:

- `README.md`
- `.github/copilot-instructions.md`
- `docs/ux-guidelines.md`
- [research.md](./research.md)
- [plan.md](./plan.md)

Then read the smallest relevant set of implementation files in:

- `src/lib/c64api.ts`
- `src/hooks/useC64Connection.ts`
- `src/hooks/useAuthoritativeConfigValueState.ts`
- `src/hooks/useInteractiveConfigWrite.ts`
- `src/components/ui/slider.tsx`
- `src/lib/ui/sliderBehavior.ts`
- `src/lib/ui/sliderDeviceAdapter.ts`
- `src/pages/HomePage.tsx`
- `src/pages/home/components/AudioMixer.tsx`
- `src/pages/home/components/LightingSummaryCard.tsx`
- `src/components/ConfigItemRow.tsx`
- `src/pages/playFiles/components/VolumeControls.tsx`
- the directly relevant unit and Playwright tests

## Non-Negotiable Rules

1. [research.md](./research.md) is authoritative for the behavioral problem, invariants, and acceptance criteria.
2. [plan.md](./plan.md) is authoritative for sequencing.
3. Do not stop at the original Option 1 hot-fix. The implementation must land the full consolidation.
4. Do not send a device config write before validating it against the live config spec.
5. Do not treat HTTP 200 as success when the firmware response contains `errors`.
6. Do not keep multiple competing slider draft/write abstractions in the final state.
7. Do not let any device-bound slider disable itself because an optimistic override is pending.
8. Do not silently swallow exceptions.
9. Every bug fix or migration edge case found during implementation must get a targeted regression test.
10. Do not claim tests, builds, or screenshot updates you did not actually run.
11. Preserve domain-specific behavior where it is intentional:

- CPU Speed remains commit-only
- SID Volume and SID Pan keep throttled preview semantics
- soft-detent behavior must remain intact

12. CPU Speed and Turbo Control must commit atomically in one write payload.

## Required End State

Your implementation is only complete when all of the following are true:

- `c64api.setConfigValue` throws on non-empty firmware `errors[]`
- `c64api.updateConfigBatch` throws on non-empty firmware `errors[]`
- config writes are validated against live enum options or numeric min/max before the network call
- the validation path is wired into both single-item and batch config writes
- a canonical `useDeviceBoundSlider` hook exists and owns device-bound slider draft, preview, commit, reconciliation, and watchdog recovery semantics
- every device-bound slider in the research inventory uses that canonical hook:
  - Home CPU Speed
  - Home SID Volume
  - Home SID Pan
  - Home Lighting Fixed Color
  - Home Lighting Strip Intensity
  - Config page slider branch
  - Play page playback volume
- Home CPU Speed is extracted out of `HomePage.tsx` into a focused component
- Home CPU Speed no longer stores drag draft on the giant `HomePage` component
- Home CPU Speed no longer disables itself because `cpuSpeedPending` is true
- CPU Speed and Turbo Control are written atomically in one commit
- trim/type drift during reconciliation cannot leave a slider permanently frozen
- duplicate async queue or adapter mechanisms are removed once migration is complete
- the optimistic override store is no longer misused as a slider pending registry
- `docs/ux-guidelines.md` documents the new slider contract

## Required Architectural Decisions

Implement these decisions directly. Do not leave them open.

### Config-write safety

- Introduce a typed config-write error surface for firmware refusals and preflight validation failures.
- Validate against the live category spec that the app already fetches; do not introduce a second hard-coded option source.
- Fail before the network call on invalid values.

### Canonical slider primitive

- Build one `useDeviceBoundSlider` hook rather than more per-surface bespoke state machines.
- The hook must support indexed and numeric domains.
- The hook must support commit-only and throttled-preview modes.
- The hook must own the preview throttling/coalescing contract if the old primitive queue is removed.
- `disabled` must only reflect true control availability, not write-pending optimism.

### Reconciliation model

- Preserve immediate local drag feedback even while the device is catching up.
- Preserve the last committed intent long enough to survive refetch races.
- Reconcile using domain-aware comparison instead of raw `Object.is` only.
- Include watchdog-based recovery so a stalled reconciliation cannot freeze the control indefinitely.

### Migration model

- Migrate call sites in the exact order defined in [plan.md](./plan.md).
- Keep the migration narrow to slider stabilization; do not turn it into a general UI rewrite.

## Execution Model

Implement in the phases defined in [plan.md](./plan.md).

Minimum expected order:

1. config-write correctness and validation
2. canonical `useDeviceBoundSlider` hook
3. call-site migration in the defined order
4. duplicate machinery removal
5. docs and validation closure

Do not start broad dead-code demolition before the new hook and migrated consumers are stable.

## Required Tests and Regression Coverage

Your final implementation must include targeted coverage for:

- firmware `errors[]` causing write rejection
- invalid enum or numeric writes being rejected before the network call
- canonical hook behavior for:
  - indexed sliders
  - numeric sliders
  - throttled preview
  - commit-only writes
  - final commit guarantee
  - watchdog recovery
  - trim/type-coercing reconciliation
- Home CPU Speed staying interactive during delayed reconciliation
- Home CPU Speed writing CPU Speed and Turbo Control atomically
- SID Volume and SID Pan preserving soft detents and preview cadence
- Lighting sliders converging to the shared behavior
- Config page slider branch still committing correctly
- Play page volume still behaving correctly
- absence of pending-based disable freezes on migrated sliders

Add or update the narrowest deterministic tests in the relevant suites, including at least:

- `tests/unit/c64api.test.ts`
- tests for `validateConfigWrite`
- tests for `useDeviceBoundSlider`
- `tests/unit/pages/HomePage*` or a new focused `HomeCpuSpeedSlider` suite
- `tests/unit/pages/home/*` for AudioMixer and Lighting
- `tests/unit/components/ConfigItemRow*`
- `tests/unit/pages/playFiles/*`
- Playwright coverage for delayed or drifted reconciliation paths where feasible

## Required Validation

Because this task changes executable behavior, the final validation must include:

- `npm run lint`
- `npm run test`
- `npm run test:coverage`
- `npm run build`

Also run the smallest honest targeted validation needed to prove:

- Home CPU Speed remains interactive under delayed write or delayed reconciliation conditions
- SID preview behavior still feels correct
- at least one Lighting slider and the Config page slider follow the shared contract
- Play page volume still works through the new path
- invalid CPU Speed values are rejected before they can hit the firmware

If visible documented UI changes, refresh only the smallest affected screenshots under `docs/img/`. Do not regenerate screenshots for behavior-only stabilization if the documented visuals are unchanged.

## Output Requirements

At completion, report:

- what changed
- which phases from [plan.md](./plan.md) were completed
- which tests and builds were run
- whether screenshots were updated
- any remaining known risk or follow-up item

## Failure Rules

Stop and report a blocker instead of guessing if:

- the live config-spec data is insufficient to validate writes safely without a wider architecture decision
- the current write path cannot propagate typed config-write failures without a broader error-contract change
- preserving SID soft-detent or preview cadence semantics conflicts with the canonical hook design
- ConfigItemRow or Play volume has a hidden dependency on the old slider async queue that cannot be migrated safely inside this task
- the new hook cannot replace all device-bound slider paths without a materially wider rewrite than the research assumes
