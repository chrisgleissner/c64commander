# Slider Responsiveness Stabilization Plan

Date: 2026-05-06
Status: Ready for execution
Primary spec: [research.md](./research.md)
Expected change classification: `DOC_PLUS_CODE`, `UI_CHANGE`

## 1. Objective

Implement the full slider-responsiveness stabilization defined by [research.md](./research.md) so every device-bound slider in the app feels immediate, never freezes behind stale pending state, validates writes before sending them, and reconciles safely with live firmware behavior.

The shipped end state must include:

- `c64api` write helpers that fail on firmware-declared write errors
- preflight validation against the live config spec before any slider write is sent
- one canonical `useDeviceBoundSlider` primitive for device-bound slider draft, preview, commit, and reconciliation behavior
- migration of all device-bound slider call sites onto that primitive
- removal of duplicate or dead slider async/write mechanisms
- removal of slider disable predicates that depend on optimistic-override pending state
- docs and tests that lock the new slider contract in place

## 2. Execution Rules

- [research.md](./research.md) is authoritative for the problem statement, design goals, invariants, and acceptance criteria.
- This plan is authoritative for sequencing.
- Do not ship only the original Home CPU Speed hot-fix. The implementation must cover the full consolidation described in the research.
- Do not send config writes that are not validated against the live device option list or numeric range.
- Do not treat HTTP 200 as success when the firmware response contains `errors`.
- Do not keep multiple competing slider draft/write abstractions after the migration lands.
- Do not bind any device-bound slider `disabled` state to the optimistic-override store.
- Do not silently swallow exceptions; surface write and validation failures with context.
- Every bug fix or migration edge case discovered during implementation must get a targeted regression test.
- Final validation must include `npm run lint`, `npm run test`, `npm run test:coverage`, and `npm run build`.
- Global branch coverage must remain `>= 91%`.

## 3. Impact Map

### API and write validation

- `src/lib/c64api.ts`
- `src/lib/config/validateConfigWrite.ts` (new)
- `src/hooks/useC64Connection.ts`
- `tests/unit/c64api.test.ts`
- new tests for config-write validation if needed

### Canonical slider primitive

- `src/hooks/useDeviceBoundSlider.ts` (new)
- `src/components/ui/slider.tsx`
- `src/lib/ui/sliderBehavior.ts`
- `src/lib/ui/sliderDeviceAdapter.ts`

### Slider consumers

- `src/pages/HomePage.tsx`
- `src/pages/home/components/HomeCpuSpeedSlider.tsx` (new)
- `src/pages/home/components/AudioMixer.tsx`
- `src/pages/home/components/LightingSummaryCard.tsx`
- `src/components/ConfigItemRow.tsx`
- `src/pages/playFiles/components/VolumeControls.tsx`
- any small helpers extracted to preserve current behavior, such as CPU Speed to Turbo Control mapping

### Optimistic override and reconciliation

- `src/hooks/useAuthoritativeConfigValueState.ts`
- related write-lane callers if cleanup is needed

### Tests and docs

- targeted unit tests for the new hook and each migrated surface
- affected page/component tests under `tests/unit/`
- Playwright regression coverage for delayed writes and non-freezing sliders
- `docs/ux-guidelines.md`

## 4. Phase Summary

| Phase | Goal | Blocking output |
| --- | --- | --- |
| 0 | Confirm exact affected sliders and current write semantics | implementation scope is explicit and no hot-fix-only drift remains |
| 1 | Fix config-write correctness and validation | invalid or refused writes cannot be treated as success |
| 2 | Land canonical slider hook | one primitive owns device-bound slider state and reconciliation |
| 3 | Migrate slider call sites in safe order | all device-bound sliders share the same contract |
| 4 | Remove dead slider machinery and pending-based disable usage | duplicate abstractions are gone |
| 5 | Document contract and close validation | behavior is locked in by tests and docs |

## 5. Detailed Phases

### Phase 0. Discovery and boundary confirmation

Goal:

- confirm the final slider inventory and current semantics before editing

Read first:

- `README.md`
- `.github/copilot-instructions.md`
- `docs/ux-guidelines.md`
- [research.md](./research.md)
- the implementation files listed in section 3

Deliverables:

- explicit note that this implementation is `DOC_PLUS_CODE` and `UI_CHANGE`
- explicit list of device-bound sliders to migrate:
  - Home CPU Speed
  - Home SID Volume
  - Home SID Pan
  - Home Lighting Fixed Color
  - Home Lighting Strip Intensity
  - Config page slider branch
  - Play page playback volume
- explicit list of purely local sliders that are out of scope for the canonical device-bound hook

Exit criteria:

- no ambiguity remains about which sliders must converge in this pass

### Phase 1. Config-write correctness and preflight validation

Goal:

- make config writes safe, diagnosable, and aligned with firmware semantics before changing slider behavior

Implementation targets:

- update `src/lib/c64api.ts` so `setConfigValue` and `updateConfigBatch` throw when the response `errors` array is non-empty
- introduce a typed write error that includes category, item or payload context, attempted value, and firmware error strings
- add `src/lib/config/validateConfigWrite.ts` to validate:
  - indexed writes against the live option list
  - numeric writes against min/max bounds
- wire validation into `useC64SetConfig` and `useC64UpdateConfigBatch` in `src/hooks/useC64Connection.ts`
- ensure invalid writes never hit the network and surface user-facing error reporting through existing patterns

Required tests:

- `c64api` regression tests for HTTP 200 plus `errors[]`
- validation tests for invalid enum value rejection
- validation tests for out-of-range numeric rejection
- tests proving valid writes still pass through untouched

Exit criteria:

- invalid or refused writes cannot silently create stuck optimistic state

### Phase 2. Canonical `useDeviceBoundSlider` hook

Goal:

- create one device-bound slider primitive that owns draft state, preview cadence, commit behavior, reconciliation, and watchdog recovery

Implementation targets:

- add `src/hooks/useDeviceBoundSlider.ts`
- support both:
  - indexed-option sliders
  - numeric sliders
- support both:
  - `previewMode: "commitOnly"`
  - `previewMode: "throttled"`
- preserve caller-supplied transforms such as SID soft detents
- allow atomic coalesced writes on commit, including CPU Speed plus Turbo Control
- ensure `disabled` only reflects connectivity and true domain constraints, not optimistic pending state
- ensure reconciliation drops draft/override state safely even when type formatting differs or reconciliation stalls
- keep the final commit guaranteed

Required tests:

- hook tests for indexed and numeric behavior
- hook tests for throttled preview coalescing
- hook tests for commit-only behavior
- hook tests for guaranteed final commit
- hook tests for watchdog expiry and recovery
- hook tests for trim-aware and type-coercing reconciliation behavior

Exit criteria:

- the repository has one canonical primitive for every device-bound slider

### Phase 3. Migrate call sites in safe order

Goal:

- move every device-bound slider onto the canonical hook without changing domain-specific UX rules

Implementation order:

1. `HomeCpuSpeedSlider` extracted from `HomePage.tsx`
2. `AudioMixer` SID Volume and SID Pan
3. `LightingSummaryCard` Fixed Color and Strip Intensity
4. `ConfigItemRow` slider branch only
5. `VolumeControls` on the Play page

Implementation targets:

- Home CPU Speed uses `previewMode: "commitOnly"`
- Home CPU Speed coalesces Turbo Control into the same commit payload
- SID sliders keep throttled preview semantics and soft-detent behavior
- Lighting sliders use the same hook instead of bespoke local state and latent pending checks
- Config page slider branch keeps current visible UX while adopting the canonical primitive
- Play volume keeps current preview interval semantics while simplifying onto the shared hook

Required tests:

- focused regression tests per migrated surface
- Home CPU Speed tests for no freeze during delayed reconciliation
- SID tests for preserved soft-detent and preview cadence semantics
- Lighting tests for stable draft and final commit behavior
- Config page tests for local display and final commit consistency
- Play page tests for unchanged control availability and final device value behavior

Exit criteria:

- all device-bound slider surfaces share the same interaction contract

### Phase 4. Remove dead code and duplicate mechanisms

Goal:

- leave one coherent slider architecture behind

Implementation targets:

- delete `src/lib/ui/sliderDeviceAdapter.ts` once fully superseded
- remove async callback props and queue ownership from `src/components/ui/slider.tsx` if the new hook fully absorbs them
- remove `createSliderAsyncQueue` from `src/lib/ui/sliderBehavior.ts` if no longer used
- remove slider-related `isPending(...)` usage and similar pending-derived disable logic from migrated surfaces
- narrow `useAuthoritativeConfigValueState.ts` back to optimistic override responsibility instead of pseudo-write tracking
- rename or split the optimistic override store if needed to match its true responsibility

Required tests:

- regression tests proving no slider relies on pending-based disable gating
- search-backed assertions or targeted test coverage for removed async queue paths where appropriate
- tests proving migrated surfaces still reconcile after navigation, delay, and error cases

Exit criteria:

- no duplicate slider draft/write abstraction remains in production code

### Phase 5. Documentation, validation, and closure

Goal:

- codify the slider contract and finish with full validation

Implementation targets:

- update `docs/ux-guidelines.md` with the slider invariants from the research:
  - immediate local feedback
  - no pending-based disable freeze
  - guaranteed final commit
  - domain-specific preview policy
  - safe reconciliation
  - watchdog recovery
  - local draft ownership
  - validation before device write
- update any directly relevant docs or comments that still describe the old behavior

Required validation:

- `npm run lint`
- `npm run test`
- `npm run test:coverage`
- `npm run build`
- targeted UI validation for at least:
  - Home CPU Speed
  - SID Volume or Pan
  - one Lighting slider
  - Config page slider
  - Play page volume

Screenshot rule:

- update screenshots only if visible documented UI changes; behavior-only slider responsiveness work does not by itself require screenshot refresh

Exit criteria:

- docs, tests, and code all describe one slider contract

## 6. Out of Scope

Do not widen scope beyond the stabilization described in [research.md](./research.md):

- redesigning the visual slider component beyond what the new hook requires
- changing non-device local sliders to use the hook
- unrelated Home page decomposition beyond the pieces needed to extract `HomeCpuSpeedSlider`
- broader config architecture cleanup unrelated to write validation or slider convergence
- any firmware behavior change or server-side workaround outside the client safeguards in this plan

## 7. Final Completion Gate

The implementation is not complete until all of the following are true:

- config writes fail fast on validation errors and firmware-declared write errors
- every device-bound slider in the inventory uses the canonical hook
- no device-bound slider disables itself because of optimistic pending state
- Home CPU Speed no longer freezes and no longer relies on whole-page drag state
- CPU Speed and Turbo Control commit atomically
- duplicate slider queue or adapter machinery is removed
- the slider invariants are documented in `docs/ux-guidelines.md`
- `npm run lint`, `npm run test`, `npm run test:coverage`, and `npm run build` all pass
- branch coverage remains `>= 91%`
