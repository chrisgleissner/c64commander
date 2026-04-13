# Multi-Device Diagnostics Attribution Delta Plan

Date: 2026-04-13
Status: Ready for implementation
Primary spec: [multi-device-diagnostics-spec.md](./multi-device-diagnostics-spec.md)
Primary predecessor: [diagnostics-device-switching.md](./diagnostics-device-switching.md)
Classification of eventual implementation: `DOC_PLUS_CODE`, `UI_CHANGE`

## 1. Objective

Bring diagnostics into line with saved-device switching by adding device attribution to diagnostics evidence, exposing a device filter by user-facing device name, and keeping the UI calm for single-device users.

This is a delta plan, not a greenfield plan. The current badge, switch picker, and diagnostics header semantics remain intact.

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

- add explicit saved-device attribution fields to trace context and persisted trace events
- keep verified hardware identity separate from saved-device identity
- remove any ambiguous `deviceId` meaning

Exit criteria:

- new trace events persist stable saved-device attribution across switches

### Phase 2. Extend logs and derived action summaries

- add the shared attribution shape to `LogEntry`
- ensure `addLog` and `addErrorLog` write attribution at creation time
- derive `ActionSummary.device` from trace events

Exit criteria:

- logs and action summaries retain correct device attribution after a switch

### Phase 3. Add Diagnostics filter and compact attribution display

- thread device attribution into `EvidenceEntry`
- add the device filter using user-facing device names
- show compact inline device attribution in evidence metadata rows
- show explicit device detail fields in expanded views

Exit criteria:

- Diagnostics can filter and display device attribution without adding bulky row chrome

### Phase 4. Add visibility gating and persistence

- persist `hasEverHadMultipleDevices`
- keep attribution UI hidden for first-time single-device users
- keep it unlocked for prior multi-device users even after device deletion

Exit criteria:

- the requested visibility rule is fully enforced

### Phase 5. Lock regression coverage and export behavior

- update or add focused tests for attribution propagation, filter behavior, and gating
- ensure diagnostics export keeps raw attribution metadata

Exit criteria:

- regressions are caught at the propagation, UI, and export layers

## 5. Validation

Because the eventual implementation changes executable code, the implementation pass must run:

- `npm run lint`
- `npm run test`
- `npm run test:coverage`
- `npm run build`

Targeted regression coverage must include:

- trace attribution surviving a switch
- log attribution surviving a switch
- action-summary attribution derivation
- device filter options using display names
- single-device attribution suppression
- prior-multi-device unlock staying visible with one remaining device
- legacy unattributed rows staying safe and unfiltered rather than misattributed

## 6. Out of Scope

Do not reopen these unless required by compile or test fallout from the attribution work:

- badge long-press switching
- route invalidation strategy
- switch-picker health polling
- the decision to keep the Diagnostics header current-device only
- origin-device playback or disk reacquisition behavior
