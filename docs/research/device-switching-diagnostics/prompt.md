# Multi-Device Diagnostics Attribution Implementation Prompt

Date: 2026-04-13
Type: Delta implementation prompt
Primary inputs:

- [multi-device-diagnostics-spec.md](./multi-device-diagnostics-spec.md)
- [plan.md](./plan.md)
- [diagnostics-device-switching.md](./diagnostics-device-switching.md)

## Role

You are finishing the diagnostics side of saved-device switching.

Do not redesign switching from scratch.
Do not turn Diagnostics into a multi-device header or switcher surface.

## Objective

Add stable saved-device attribution to diagnostics evidence so logs, traces, actions, and exports can be filtered and understood by device using user-facing saved-device names, while keeping the compact Diagnostics UX calm for single-device users.

## Read First

- `README.md`
- `.github/copilot-instructions.md`
- `docs/ux-guidelines.md`
- `docs/research/device-switching-diagnostics/diagnostics-device-switching.md`
- `docs/research/device-switching-diagnostics/multi-device-diagnostics-spec.md`
- `docs/research/device-switching-diagnostics/plan.md`

Then read the smallest relevant set from:

- `src/lib/savedDevices/store.ts`
- `src/lib/tracing/types.ts`
- `src/lib/tracing/traceContext.ts`
- `src/components/TraceContextBridge.tsx`
- `src/lib/deviceInteraction/deviceStateStore.ts`
- `src/lib/tracing/traceSession.ts`
- `src/lib/logging.ts`
- `src/lib/diagnostics/actionSummaries.ts`
- `src/lib/diagnostics/webServerLogs.ts`
- `src/components/diagnostics/DiagnosticsDialog.tsx`
- diagnostics export and native snapshot modules that serialize logs, traces, or actions
- related unit tests

## Current State To Preserve

These behaviors are already correct and must remain intact unless the spec explicitly changes them:

- the badge and Diagnostics header describe only the current selected device
- the switch picker owns passive non-selected-device health
- switching does not auto-clear diagnostics
- Diagnostics remains one chronological activity stream rather than separate per-device tabs or stores
- badge tap still opens Diagnostics and badge long press still opens the switcher

## Required Changes

### 1. Separate saved-device attribution from verified hardware identity

- use saved-device id as the authoritative diagnostics filter key
- keep verified hardware identity as secondary debugging metadata
- do not leave a field named `deviceId` with ambiguous meaning across different code paths

### 2. Persist attribution at write time

- traces must carry saved-device attribution per event when written
- logs must capture the same attribution when written
- action summaries must derive attribution from trace data rather than current app state
- exports must include raw attribution metadata

### 3. Add the Diagnostics device filter and compact device labels

- add a device filter to `DiagnosticsDialog`
- label options with saved-device display names, not raw ids
- keep row-level attribution compact on the existing metadata line
- show a clearer `Device` field in expanded detail views

### 4. Enforce the visibility gate

- hide attribution chips and the device filter when the user truly has only one configured device and has never had multiple devices
- persist a monotonic saved-device-store flag such as `hasEverHadMultipleDevices`
- keep attribution UI unlocked if the user previously had multiple devices and later removed devices down to one

### 5. Keep compatibility safe

- older unattributed logs and traces must continue to render
- do not rewrite legacy unattributed rows to the current selected device
- if a referenced saved device is deleted, fall back to the stored name snapshot rather than a raw id

## Constraints

### Keep scope tight

- do not redesign the badge, switcher, or route invalidation model
- do not split diagnostics into separate per-device stores
- prefer additive metadata propagation over subsystem rewrites

### UX rules

- compact evidence rows must not grow a second metadata row just for device attribution
- the Diagnostics header remains current-device only
- user-facing labels come from the saved-device naming model, not from raw hardware ids

## Minimum Acceptance Criteria

- logs, traces, actions, and exports preserve saved-device attribution across switches
- Diagnostics can filter by device using saved-device display names
- compact evidence rows show device attribution without degrading tight layouts
- first-time single-device users do not see device attribution UI
- prior multi-device users still see attribution UI even if only one saved device remains
- verified hardware identity remains available for deeper debugging without replacing saved-device attribution in the main UX

## Validation

Run the smallest honest executable validation set required by the repo rules:

- `npm run lint`
- `npm run test`
- `npm run test:coverage`
- `npm run build`

Regression coverage must prove:

- trace attribution survives a switch
- log attribution survives a switch
- action summaries inherit attribution from trace events
- device filters use display names
- single-device attribution suppression works
- prior multi-device unlock works after the saved-device count falls back to one
- legacy unattributed rows remain safe and are not misattributed

## Failure Rule

Stop and report a blocker if another diagnostics evidence store that appears in the UI or export path cannot accept saved-device attribution without a wider architecture change than this spec allows.
