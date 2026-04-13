# Multi-Device Diagnostics Attribution Specification

Date: 2026-04-13
Status: Ready for implementation
Primary predecessor: [diagnostics-device-switching.md](./diagnostics-device-switching.md)
Classification of eventual implementation: `DOC_PLUS_CODE`, `UI_CHANGE`

## 1. Purpose

This document defines how diagnostics evidence must behave now that saved-device switching exists and the app needs device-attributed logs, traces, actions, and related diagnostics records.

It builds directly on [diagnostics-device-switching.md](./diagnostics-device-switching.md).

That earlier document established the high-level semantics that remain correct:

- the badge and Diagnostics header stay current-device only
- non-selected-device health remains in the switch picker
- switching does not auto-clear diagnostics
- diagnostics evidence must stop pretending to be device-agnostic once the app supports multiple saved devices

This specification turns that last point into a concrete implementation contract.

## 2. Document Conventions

The key words `MUST`, `MUST NOT`, `SHOULD`, and `MAY` are normative.

If this document and implementation diverge, implementation is wrong unless the user explicitly approves a spec change.

## 3. Problem Statement

Today the app can switch between saved devices, but diagnostics evidence is still effectively mixed-session evidence.

Observed gaps in the current implementation:

- `TraceContextSnapshot.device` exists, but `TraceEventContextFields` do not persist device identity into each event.
- `TraceContextBridge` currently sets `deviceId` from the verified device `unique_id`, while other fallback paths still set `deviceId: null`, so the meaning of `deviceId` is not stable enough for filtering.
- `LogEntry` has no device attribution at all.
- `ActionSummary` is derived from trace events, but has no device identity of its own.
- `DiagnosticsDialog` can filter by type, contributor, and severity, but not by device.
- the saved-device store has no persisted signal for "this user has previously had multiple devices configured", which is required for the requested visibility rule.

The result is that after one or more switches, the Diagnostics evidence list can contain mixed-device records with no attribution, no stable device filter, and no compact device display model.

## 4. Non-Goals

This specification does not:

- change the badge tap or long-press interaction model
- turn the Diagnostics header into a multi-device summary
- move passive non-selected-device health into Diagnostics
- auto-clear logs or traces on switch
- redesign the switcher, route invalidation, or origin-device playback model
- require historical backfill of old diagnostics records written before attribution lands

## 5. Fixed Semantic Decisions

The implementation MUST preserve all of the following:

- the badge continues to describe only the currently selected device
- the Diagnostics header and connection summary continue to describe only the currently selected device
- the switch picker remains the place for passive non-selected-device health state
- diagnostics evidence remains one chronological activity stream inside Diagnostics
- that single activity stream becomes device-attributed rather than split into separate per-device stores
- switching devices does not reset diagnostics evidence

## 6. Terms

### 6.1 Saved device id

The internal app record id from `SavedDevice.id`.

This is the authoritative diagnostics attribution key for filtering, grouping, and UI resolution.

### 6.2 Saved device display name

The user-facing label resolved from the saved-device naming model.

This is what the Diagnostics filter and details surfaces show.

### 6.3 Verified hardware identity

The actual device identity returned by `/v1/info`, such as `unique_id`, hostname, and product family.

This remains important for mismatch and debugging, but it is not the primary filter key for multi-device diagnostics.

### 6.4 Diagnostics attribution

The metadata attached to a diagnostics record that identifies which saved device the record originated from, plus enough display context to remain understandable if the device is later renamed or deleted.

### 6.5 Attribution UI unlock

The persisted condition that allows device attribution chips and device filters to remain visible even when only one saved device is currently configured.

## 7. Identity Model

### 7.1 Saved-device identity is the primary attribution key

All user-visible diagnostics filtering and compact attribution display MUST key off the saved-device record id, not the verified hardware `unique_id`.

Rationale:

- the user switches between saved devices, not between raw hardware ids
- saved-device ids map cleanly to user-facing names
- the verified hardware `unique_id` may be absent, stale, or mismatch-related
- a filter keyed to verified hardware identity would be confusing in the saved-device UX model

### 7.2 Verified hardware identity remains secondary evidence

Diagnostics attribution SHOULD also retain the latest verified hardware identity snapshot when available:

- verified unique id
- verified hostname
- verified product family

This metadata MUST support debugging and mismatch detail views, but it MUST NOT replace saved-device identity in the main filter model.

### 7.3 Do not overload the current trace `deviceId`

The current trace context field named `deviceId` is not safe to reuse as-is because it is presently populated from the verified device `unique_id` in `TraceContextBridge`.

The implementation MUST make the distinction explicit by either:

- renaming the field to reflect its actual meaning and adding saved-device attribution fields, or
- replacing it with a structured attribution object that separately carries saved-device identity and verified hardware identity

What MUST NOT happen:

- a field named `deviceId` continuing to mean verified hardware identity in one path and saved-device identity in another path

## 8. Data Model Requirements

### 8.1 Shared attribution shape

Every diagnostics artifact that can remain visible after a device switch or appear in diagnostics export MUST support a shared attribution payload with this logical shape:

```ts
type DiagnosticsDeviceAttribution = {
  savedDeviceId: string | null;
  savedDeviceNameSnapshot: string | null;
  savedDeviceHostSnapshot: string | null;
  verifiedUniqueId: string | null;
  verifiedHostname: string | null;
  verifiedProduct: ProductFamilyCode | null;
};
```

Rules:

- `savedDeviceId` is the primary filter key
- `savedDeviceNameSnapshot` is the fallback label when the saved device is later renamed or deleted
- `savedDeviceHostSnapshot` is support context only and MUST NOT become the primary display label
- verified fields are optional debugging context

### 8.2 Minimum coverage scope

The first implementation pass MUST cover all diagnostics records that are currently visible in Diagnostics or exported from it:

- `LogEntry`
- normalized external or server logs that become `LogEntry`
- `TraceEvent`
- derived `ActionSummary`
- diagnostics export and native debug snapshot payloads that include logs, traces, or actions

The implementation SHOULD also extend the same attribution model to other diagnostics stores that survive switching or appear in diagnostics details, including health history, latency samples, and recovery evidence, if those records are not already current-device-only at render time.

### 8.3 Trace event persistence requirement

Each persisted `TraceEvent` MUST carry device attribution at event-write time.

It is not sufficient to derive attribution later from the current selected device because that would corrupt older events after a switch.

### 8.4 Action summary derivation requirement

Each `ActionSummary` MUST expose device attribution derived from its correlated trace events.

If an action spans multiple events with conflicting saved-device attribution, the summary MUST prefer the `action-start` attribution and the implementation MUST log or test against mixed-attribution corruption rather than silently merging devices.

### 8.5 Log write requirement

Every call path that produces a `LogEntry` through `addLog`, `addErrorLog`, or external-log normalization MUST capture device attribution from the current selected saved-device context when the entry is written.

### 8.6 Export requirement

Diagnostics export MUST include raw device attribution metadata even when the UI is currently hiding attribution chips or filters.

The export is support evidence, not a condensed UI surface.

## 9. Visibility Rules

### 9.1 Hide attribution UI for first-time single-device users

If the user currently has exactly one saved device and has never had more than one saved device configured, the Diagnostics UI MUST NOT show:

- device attribution chips or inline device labels in evidence rows
- a device filter section
- device-only active filter chips

### 9.2 Keep attribution UI unlocked after prior multi-device use

If the user has ever had two or more saved devices configured, device attribution UI remains allowed even when the current saved-device count falls back to one.

Rationale:

- the diagnostics evidence stream may still contain historical records from other saved devices
- hiding attribution in that case would make mixed-history evidence harder to interpret

### 9.3 Persist the unlock state

The saved-device persistence layer MUST store a monotonic boolean such as:

```ts
hasEverHadMultipleDevices: boolean;
```

Rules:

- it becomes `true` the first time the user has two or more saved devices
- it does not auto-reset when devices are deleted
- legacy single-device migration initializes it to `false`

## 10. UI Requirements

### 10.1 Filter model

`DiagnosticsDialog` MUST add a device filter dimension keyed by `savedDeviceId` and rendered with saved-device display names.

Filter rules:

- default is `All devices`
- options are derived from attributed evidence present in the current activity stream
- visible labels use the current resolved saved-device name when the device still exists
- if the device no longer exists, use `savedDeviceNameSnapshot`
- if neither exists, fall back to a calm support label such as `Unknown device`

### 10.2 Compact evidence-row display

When attribution UI is unlocked, evidence rows in `DiagnosticsDialog` MUST show the originating saved-device name in the compact metadata line, not as a second block row.

Required display behavior:

- keep device attribution on the same secondary metadata line as timestamp and contributor
- allow truncation and ellipsis in the same way existing compact metadata does
- do not add a large badge stack or second metadata row for routine entries

Preferred pattern:

- `12:34 · REST · Studio64`

### 10.3 Expanded detail display

Expanded or dedicated detail views for logs, traces, and actions MUST show a clearer device field when attribution is available.

Required fields:

- `Device`: saved-device display name
- `Saved device id`: only in debug or export-oriented views, not in the compact list row
- `Verified device`: optional hardware identity fields when relevant for mismatch or deeper debugging

### 10.4 Header behavior remains current-device only

Even after attribution lands, the Diagnostics header, connection details, and badge-adjacent status copy MUST continue to describe only the current selected device.

The attribution feature is for evidence interpretation, not for redefining the page header.

## 11. Store and Context Ownership

### 11.1 Saved-device store

`src/lib/savedDevices/store.ts` remains the source of truth for:

- current selected saved device
- saved-device naming resolution
- persisted `hasEverHadMultipleDevices`

### 11.2 Trace context

`src/lib/tracing/traceContext.ts` and `TraceContextBridge` become the source of truth for current diagnostics attribution context at event-write time.

That context MUST include at least:

- selected saved-device id
- selected saved-device display-name snapshot
- selected saved-device host snapshot
- current verified hardware identity snapshot when available

### 11.3 Logging layer

`src/lib/logging.ts` MUST read attribution from the same diagnostics attribution context used by traces so logs and traces stay aligned during switches.

### 11.4 Derived summaries

`src/lib/diagnostics/actionSummaries.ts` MUST derive attribution from trace events rather than re-reading current selected-device state.

## 12. Implementation Surface

The implementation is expected to touch at least these areas:

- `src/lib/tracing/types.ts`
- `src/lib/tracing/traceContext.ts`
- `src/components/TraceContextBridge.tsx`
- `src/lib/deviceInteraction/deviceStateStore.ts`
- `src/lib/tracing/traceSession.ts`
- `src/lib/logging.ts`
- `src/lib/diagnostics/actionSummaries.ts`
- `src/lib/diagnostics/webServerLogs.ts`
- `src/components/diagnostics/DiagnosticsDialog.tsx`
- `src/lib/savedDevices/store.ts`
- diagnostics export or native debug snapshot modules that serialize logs, traces, or actions

## 13. Migration and Backward Compatibility

The rollout MAY leave older pre-attribution diagnostics records unattributed.

Required compatibility behavior:

- older logs and traces without attribution continue to render
- unattributed legacy rows fall under `All devices`
- legacy rows MUST NOT be incorrectly rewritten to the current selected device
- device filters only match rows whose `savedDeviceId` is known

## 14. Acceptance Criteria

- switching devices no longer makes older diagnostics rows appear device-agnostic
- Diagnostics can filter evidence by saved device using user-facing names
- compact Diagnostics rows show device attribution without adding a second row of chrome
- the device filter and row attribution stay hidden for true single-device users
- the filter and attribution remain available for users who previously had multiple saved devices and later removed devices down to one
- logs, traces, actions, and exports all preserve saved-device attribution across switches and route changes
- verified hardware identity remains available for debugging without replacing saved-device attribution in the main UX

## 15. Validation Expectations for the Eventual Implementation

At minimum, the implementation pass must add or update regression coverage for:

- trace events preserving saved-device attribution across a switch
- logs preserving saved-device attribution across a switch
- action summaries inheriting attribution from trace data
- Diagnostics device filter behavior and label rendering
- single-device attribution UI suppression
- `hasEverHadMultipleDevices` unlocking attribution UI after the device count falls back to one
- legacy unattributed records rendering safely without false attribution
