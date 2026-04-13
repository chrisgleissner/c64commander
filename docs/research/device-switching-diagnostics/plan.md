# Multi-Device Diagnostics Attribution Delta Plan

Date: 2026-04-13
Status: Ready for implementation
Primary spec: [multi-device-diagnostics-spec.md](./multi-device-diagnostics-spec.md)
Primary predecessor: [diagnostics-device-switching.md](./diagnostics-device-switching.md)
Classification of eventual implementation: `DOC_PLUS_CODE`, `UI_CHANGE`

## 1. Objective

Bring diagnostics into line with saved-device switching by adding device attribution to diagnostics evidence, exposing a device filter by user-facing device name, and keeping the UI calm for single-device users.

This is a delta plan, not a greenfield plan. The current badge, switch picker, and diagnostics header semantics remain intact.

This plan is the authoritative execution checklist for the implementation pass.
Every box below MUST be ticked explicitly during implementation.
No box may be marked complete until the code, tests, and any directly dependent follow-on edits for that item are actually finished.

## 1.1 Convergence Rules

- Treat unchecked boxes as unresolved work, not optional suggestions.
- Tick boxes in place in this file as work is completed.
- Do not mark a phase complete while any box inside that phase remains unchecked.
- Do not claim the task is complete while any box in Sections 4, 5, or 6 remains unchecked.
- If blocked, leave the relevant box unchecked and add a short blocker note directly under that phase instead of silently narrowing scope.

## 2. Already Landed

These behaviors are already correct and should remain intact:

- the badge and Diagnostics header are current-device only
- the switch picker owns passive non-selected-device health
- switching does not auto-clear diagnostics
- traces already have a shared trace context snapshot
- saved-device naming resolution already exists and is user-facing

## 3. Remaining Gaps

### Gap A. Trace device identity is semantically ambiguous

Current implementation uses trace device context, but `deviceId` does not yet mean a stable saved-device id.

Required end state:

- diagnostics attribution has explicit saved-device fields
- verified hardware identity remains separate support metadata
- persisted trace events carry attribution at write time

Primary files:

- `src/lib/tracing/types.ts`
- `src/lib/tracing/traceContext.ts`
- `src/components/TraceContextBridge.tsx`
- `src/lib/tracing/traceSession.ts`
- `src/lib/deviceInteraction/deviceStateStore.ts`

### Gap B. Logs are still untagged

Current `LogEntry` records do not capture device attribution.

Required end state:

- local app logs capture the selected saved-device attribution when written
- normalized external logs can preserve or accept the same attribution shape
- exports keep the raw metadata

Primary files:

- `src/lib/logging.ts`
- `src/lib/diagnostics/webServerLogs.ts`
- diagnostics export modules

### Gap C. Action summaries and evidence rows cannot filter by device

Current `ActionSummary` records and Diagnostics evidence entries have no device field.

Required end state:

- action summaries derive attribution from trace events
- Diagnostics evidence entries carry device attribution for logs, traces, and actions
- `DiagnosticsDialog` adds a device filter keyed by saved-device id and labeled by display name

Primary files:

- `src/lib/diagnostics/actionSummaries.ts`
- `src/components/diagnostics/DiagnosticsDialog.tsx`

### Gap D. The visibility rule for prior multi-device users is missing

Current saved-device persistence does not remember whether the user has ever had multiple devices configured.

Required end state:

- persisted `hasEverHadMultipleDevices` or equivalent monotonic flag
- attribution chips and device filter stay hidden for true single-device users
- attribution UI remains unlocked after the user previously had multiple devices and later removed devices down to one

Primary files:

- `src/lib/savedDevices/store.ts`
- `src/components/diagnostics/DiagnosticsDialog.tsx`

### Gap E. Test and export coverage do not yet lock the new semantics

Current tests cover diagnostics behavior without per-device attribution.

Required end state:

- unit coverage for attribution propagation and device-filter semantics
- export coverage for raw attribution metadata
- UI coverage for the single-device suppression rule

Primary files:

- diagnostics unit tests under `tests/unit/`
- any export or snapshot regression tests

## 4. Implementation Sequence

### Phase 1. Define and propagate shared attribution context

- [x] Add explicit saved-device attribution fields to trace context.
- [x] Persist attribution onto new trace events at write time.
- [x] Keep verified hardware identity separate from saved-device identity.
- [x] Remove or rename any ambiguous `deviceId` meaning so one field cannot mean two identities.
- [x] Add regression coverage proving new trace events keep the original saved-device attribution after a switch.

Exit criteria:

- new trace events persist stable saved-device attribution across switches

### Phase 2. Extend logs and derived action summaries

- [x] Add the shared attribution shape to `LogEntry`.
- [x] Ensure `addLog` and `addErrorLog` write attribution at creation time.
- [x] Preserve or normalize attribution for external or server logs where applicable.
- [x] Derive `ActionSummary.device` from trace events rather than current app state.
- [x] Add regression coverage proving logs and action summaries keep the correct saved-device attribution across a switch.

Exit criteria:

- logs and action summaries retain correct device attribution after a switch

### Phase 3. Add Diagnostics filter and compact attribution display

- [x] Thread device attribution into `EvidenceEntry` for logs, traces, and actions.
- [x] Add the device filter keyed by saved-device id.
- [x] Render device filter labels with user-facing saved-device display names.
- [x] Show compact inline device attribution on the existing evidence metadata line.
- [x] Show explicit device detail fields in expanded views without redefining the Diagnostics header.
- [x] Add regression coverage for device filtering and compact device-label rendering.

Exit criteria:

- Diagnostics can filter and display device attribution without adding bulky row chrome

### Phase 4. Add visibility gating and persistence

- [x] Persist `hasEverHadMultipleDevices` or an equivalent monotonic unlock flag in the saved-device store.
- [x] Keep attribution UI hidden for first-time single-device users.
- [x] Keep attribution UI unlocked for prior multi-device users even after device deletion reduces the count to one.
- [x] Ensure deleted or renamed devices still render a stable fallback label from stored attribution snapshots.
- [x] Add regression coverage for the true-single-device and prior-multi-device cases.

Exit criteria:

- the requested visibility rule is fully enforced

### Phase 5. Lock regression coverage and export behavior

- [x] Update or add focused tests for attribution propagation, filter behavior, and visibility gating.
- [x] Ensure diagnostics export keeps raw attribution metadata even when UI attribution is hidden.
- [x] Ensure legacy unattributed rows remain safe and are never rewritten to the current device.
- [x] Confirm native snapshot or diagnostics-export paths preserve the new attribution fields.

Exit criteria:

- regressions are caught at the propagation, UI, and export layers

## 5. Validation

Because the eventual implementation changes executable code, the implementation pass must run:

- [x] `npm run lint`
- [x] `npm run test`
- [x] `npm run test:coverage`
- [x] `npm run build`

Targeted regression coverage must include:

- [x] trace attribution surviving a switch
- [x] log attribution surviving a switch
- [x] action-summary attribution derivation
- [x] device filter options using display names
- [x] single-device attribution suppression
- [x] prior-multi-device unlock staying visible with one remaining device
- [x] legacy unattributed rows staying safe and unfiltered rather than misattributed

## 6. Out of Scope

Do not reopen these unless required by compile or test fallout from the attribution work:

- [x] badge long-press switching remains unchanged
- [x] route invalidation strategy remains unchanged
- [x] switch-picker health polling remains unchanged
- [x] the Diagnostics header remains current-device only
- [x] origin-device playback or disk reacquisition behavior remains unchanged

## 7. Final Completion Gate

The implementation is not converged until all of the following are true:

- [x] Every box in Sections 4, 5, and 6 is checked.
- [x] The shipped behavior matches the acceptance criteria in [multi-device-diagnostics-spec.md](./multi-device-diagnostics-spec.md).
- [x] No ambiguous saved-device versus verified-device identity field remains in the diagnostics path.
- [x] The final summary can state exactly which regression tests prove attribution propagation, filtering, and visibility gating.
