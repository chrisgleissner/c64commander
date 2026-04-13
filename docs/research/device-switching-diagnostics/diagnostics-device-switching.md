# Diagnostics Semantics After Device Switching

Date: 2026-04-13
Status: Final research
Classification: `DOC_ONLY`

## Executive decision

The recommended model is a hybrid:

- Keep the top-right badge strictly about the currently selected device.
- Keep the Diagnostics sheet strictly anchored on the currently selected device for its header and manual health-check surface.
- Keep non-selected-device health in the switch dialog only, backed by the existing persisted saved-device summaries plus the existing passive per-device polling while the dialog is open.
- Do not reset diagnostics automatically on device switch.
- Keep logs, traces, action summaries, and exported diagnostics app-global until the codebase has real device tagging for those records.

This fits the current implementation better than any full global or full per-device redesign. It also avoids the two biggest UX failures introduced by switching: misleading aggregated counts and surprising state loss.

## Scope and inputs reviewed

Primary code paths reviewed:

- `src/components/UnifiedHealthBadge.tsx`
- `src/hooks/useHealthState.ts`
- `src/hooks/useSavedDeviceHealthChecks.ts`
- `src/hooks/useSavedDeviceSwitching.ts`
- `src/hooks/useC64Connection.ts`
- `src/hooks/useConnectionState.ts`
- `src/components/diagnostics/GlobalDiagnosticsOverlay.tsx`
- `src/components/diagnostics/DiagnosticsDialog.tsx`
- `src/lib/diagnostics/healthCheckState.ts`
- `src/lib/diagnostics/healthCheckEngine.ts`
- `src/lib/diagnostics/healthHistory.ts`
- `src/lib/diagnostics/healthModel.ts`
- `src/lib/diagnostics/diagnosticsOverlay.ts`
- `src/lib/diagnostics/diagnosticsOverlayState.ts`
- `src/lib/diagnostics/diagnosticsActivity.ts`
- `src/lib/query/c64QueryInvalidation.ts`
- `src/lib/savedDevices/store.ts`
- `src/lib/logging.ts`
- `src/lib/tracing/traceSession.ts`
- `src/lib/connection/connectionManager.ts`

Tests and docs reviewed:

- `tests/unit/components/UnifiedHealthBadge.test.tsx`
- `tests/unit/hooks/useSavedDeviceHealthChecks.test.tsx`
- `tests/unit/hooks/useSavedDeviceSwitching.test.tsx`
- `tests/unit/query/c64QueryInvalidation.test.ts`
- `tests/unit/components/diagnostics/DiagnosticsDialog.savedDeviceSwitch.test.tsx`
- `playwright/homeDiagnosticsOverlay.spec.ts`
- `docs/features-by-page.md`
- `docs/developer.md`
- `docs/research/device-switcher/v2/ux-recommendations-2026-04-09.md`

## A. Current-state architecture

### Architecture summary

The current implementation is not one clean diagnostics model. It is a mix of three scopes:

1. Selected-device health state
   - Owned by `src/lib/diagnostics/healthCheckState.ts` and consumed by `src/hooks/useHealthState.ts`.
   - Rendered in the badge and the Diagnostics header.
   - Updated by full health checks through `runHealthCheck()` in `src/lib/diagnostics/healthCheckEngine.ts`.

2. Per-device switcher health state
   - Owned by `src/hooks/useSavedDeviceHealthChecks.ts`.
   - Rendered only inside `src/components/UnifiedHealthBadge.tsx` when the switch sheet is open.
   - Passive, concurrent, and temporary. It is not the same store as the badge/Diagnostics health store.

3. App-global diagnostics evidence
   - Logs from `src/lib/logging.ts`.
   - Traces from `src/lib/tracing/traceSession.ts`.
   - Health history from `src/lib/diagnostics/healthHistory.ts`.
   - Diagnostics activity counters from `src/lib/diagnostics/diagnosticsActivity.ts`.
   - Export and clear behavior from `src/components/diagnostics/GlobalDiagnosticsOverlay.tsx`.

This means diagnostics are currently mixed:

- the status surfaces are mostly current-device scoped
- the switch dialog is multi-device scoped
- the evidence stores are app-global

### Relevant modules and their roles

| Module                                                    | Role                                                                                                               | Effective scope today                                                        |
| --------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------- |
| `src/lib/savedDevices/store.ts`                           | Saved-device persistence, selection, verification summaries, runtime statuses                                      | Per-device persisted summary plus runtime per-device status                  |
| `src/hooks/useSavedDeviceSwitching.ts`                    | Applies selected device locally, rewires ports/base URL, verifies via `/v1/info`, invalidates active-route queries | Selected device switch orchestration                                         |
| `src/hooks/useSavedDeviceHealthChecks.ts`                 | Passive 10s health polling for all saved devices while picker is open                                              | Per-device temporary picker state                                            |
| `src/hooks/useHealthState.ts`                             | Builds `OverallHealthState` from connection state, global health-check result, and traces                          | Selected device plus app-global traces                                       |
| `src/components/UnifiedHealthBadge.tsx`                   | Badge rendering, tap-to-Diagnostics, long-press switch sheet                                                       | Badge: selected device; sheet: multi-device                                  |
| `src/components/diagnostics/GlobalDiagnosticsOverlay.tsx` | Diagnostics open/close, clear, export, seeded test state, health-check execution                                   | App-global overlay                                                           |
| `src/components/diagnostics/DiagnosticsDialog.tsx`        | Current-device header, run health check button, health detail, activity and overflow actions                       | Selected-device header plus app-global evidence                              |
| `src/lib/diagnostics/healthCheckState.ts`                 | Global latest health-check result and probe lifecycle states                                                       | One global selected-device health snapshot                                   |
| `src/lib/diagnostics/healthCheckEngine.ts`                | Runs full or passive health checks, updates global state, writes health history                                    | Full checks: global selected-device; passive checks: returned to caller only |
| `src/lib/logging.ts`                                      | Local persisted logs (`localStorage`)                                                                              | App-global                                                                   |
| `src/lib/tracing/traceSession.ts`                         | In-memory trace buffer with session persistence across navigation                                                  | App-global session                                                           |
| `src/lib/diagnostics/healthHistory.ts`                    | Ring buffer of health runs                                                                                         | App-global session                                                           |
| `src/lib/query/c64QueryInvalidation.ts`                   | Active-route-specific invalidation after switch                                                                    | Route-specific refresh after selected-device change                          |

### Data flow today

1. The user long-presses the badge.
2. `UnifiedHealthBadge` opens the switch sheet and enables `useSavedDeviceHealthChecks(savedDevices.devices, true)`.
3. The hook runs `runHealthCheckForTarget(..., { mode: "passive" })` for each saved device every 10 seconds while the sheet is open.
4. The user taps a different device row.
5. `useSavedDeviceSwitching` immediately calls `selectSavedDevice(deviceId)`, rewires FTP/Telnet ports, updates the base URL, then verifies the active target via `verifyCurrentConnectionTarget()`.
6. On success, `completeSavedDeviceVerification()` persists summary fields and `invalidateForSavedDeviceSwitch()` refetches the current route's active queries.
7. Separately, the badge and Diagnostics header keep reading `useHealthState()`, which uses one global `healthCheckState.latestResult` plus global trace history.

### Where device identity enters the picture

- Saved-device identity enters through `src/lib/savedDevices/store.ts`.
- Selected device identity is resolved in `useHealthState()` from `savedDevices.selectedDeviceId` and `buildSavedDevicePrimaryLabel()`.
- Verified device identity is stored in `verifiedByDeviceId` and in persisted `summaries` in `store.ts`.
- The badge label and Diagnostics header both use selected-device naming.
- Logs, traces, and action summaries do not have stable saved-device IDs. They are app-global records with partial target context only.

### Where badge state comes from

- `UnifiedHealthBadge` calls `useHealthState()`.
- `useHealthState()` first prefers `healthCheckState.latestResult` from `src/lib/diagnostics/healthCheckState.ts`.
- If no latest result exists, it falls back to trace-derived contributor health from `src/lib/diagnostics/healthModel.ts`.
- Before the first successful REST response, it forces the badge to `Idle` rather than deriving failure from early noise.

### Where switch-dialog health state comes from

- `UnifiedHealthBadge` also calls `useSavedDeviceHealthChecks()`.
- Each row reads `healthByDeviceId[device.id]`.
- Row state is separate from the badge state.
- `CONFIG` is intentionally skipped in passive mode with the reason `Skipped: passive switcher checks do not modify device config` in `healthCheckEngine.ts`.

### Platform-specific behavior relevant to semantics

- Android and iOS can mirror native diagnostics into JS through the deferred diagnostics bridges started from `App.tsx`, but this changes evidence volume rather than badge or switch semantics.
- Web, Android, and iOS all use the same React badge, switch sheet, and Diagnostics dialog components, so the core semantics should stay identical across platforms.
- Share/export transport differs by platform, but that does not justify different badge or switch behavior.

### Whether diagnostics are global, implicit, accidental, mixed, or clearly scoped today

They are mixed and partly accidental:

- clearly current-device: selected-device label, Diagnostics header, manual health check intent, active-route refresh after switch
- clearly multi-device: switch sheet live health and saved-device verification summaries
- clearly app-global: logs, traces, action summaries, health history, diagnostics clear/export
- accidental mismatch: the selected-device label can change before the global health result changes, which can temporarily pair the new device label with the old device's latest health result

## B. Current-state semantics table

| Concern                                                  | Current behavior                                                                                                                                                                            | Code source(s)                                                                                                                                                                                     | User-visible effect                                               | Problem introduced by device switching                                                                                                                                                                            | Severity |
| -------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------- |
| Top-right badge healthy/error state                      | Derived from `useHealthState()`, which prefers the single global `healthCheckState.latestResult` and otherwise falls back to trace-derived contributor health                               | `src/hooks/useHealthState.ts`, `src/lib/diagnostics/healthCheckState.ts`, `src/lib/diagnostics/healthModel.ts`, `src/components/UnifiedHealthBadge.tsx`                                            | Badge looks like a current-device status surface                  | After switching, the selected-device label updates immediately, but the health result is not keyed to device identity, so the badge can momentarily show the previous device's health under the new device's name | High     |
| Top-right badge error count                              | `problemCount` comes from failed probes in `latestResult`, or from trace-derived failures if there is no latest result                                                                      | `src/hooks/useHealthState.ts`, `src/lib/diagnostics/healthModel.ts`                                                                                                                                | Count feels like current-device problems                          | Count does not include other saved devices, which is good, but the stale-result mismatch means the count can belong to the previous selected device right after a switch                                          | High     |
| Diagnostics while viewing one selected device            | Diagnostics header shows current-device label, current-device state, and a manual `Run health check` button; evidence list uses app-global logs/traces/actions                              | `src/components/diagnostics/DiagnosticsDialog.tsx`, `src/components/diagnostics/GlobalDiagnosticsOverlay.tsx`                                                                                      | Header feels device-specific, list feels like recent app activity | The header implies per-device scope while evidence remains global, so a multi-device session can mix events without explicit scoping                                                                              | Medium   |
| Diagnostics while switch dialog is open                  | Switch sheet shows every saved device with passive health, status label, and per-row expandable probe detail; Diagnostics sheet remains separate                                            | `src/components/UnifiedHealthBadge.tsx`, `src/hooks/useSavedDeviceHealthChecks.ts`                                                                                                                 | Multi-device health is visible only inside the switch sheet       | This is calm and appropriate, but it creates a second health semantics layer that does not feed the badge or Diagnostics sheet                                                                                    | Low      |
| Background vs foreground health meaning                  | Foreground badge/Diagnostics read the selected-device/global health state; background picker checks are passive and temporary                                                               | `src/hooks/useHealthState.ts`, `src/hooks/useSavedDeviceHealthChecks.ts`, `src/lib/diagnostics/healthCheckEngine.ts`                                                                               | Users can see live per-device checks while picker is open         | Background non-selected-device failures do not escalate anywhere after the picker closes except as saved-device summary state                                                                                     | Medium   |
| Switching to another device                              | Selection changes immediately, then `/v1/info` verification runs, then current-route queries are invalidated/refetched on success only                                                      | `src/hooks/useSavedDeviceSwitching.ts`, `src/lib/connection/connectionManager.ts`, `src/lib/query/c64QueryInvalidation.ts`                                                                         | Switching feels fast and route-aware                              | Health and evidence surfaces lag behind selection semantics because only route queries are invalidated, not the global health snapshot                                                                            | High     |
| Stale health data                                        | Switch rows show relative `Last check` time but do not classify staleness explicitly; global health snapshot has `staleAfterMs` state but no device match enforcement in `useHealthState()` | `src/components/UnifiedHealthBadge.tsx`, `src/lib/diagnostics/healthCheckState.ts`, `src/hooks/useHealthState.ts`                                                                                  | Users see ages but not a strong stale indicator                   | The selected-device badge can show stale previous-device health, and non-selected devices show last-known state without a clear stale boundary                                                                    | Medium   |
| Failed checks for non-selected devices                   | Stored as passive picker results while open and as saved-device summary/runtime status (`offline`, `mismatch`, `last-known`)                                                                | `src/hooks/useSavedDeviceHealthChecks.ts`, `src/lib/savedDevices/store.ts`                                                                                                                         | Non-selected problems appear in the picker                        | There is no badge-level summary of another device failing, which is good for calm design, but current docs do not state this explicitly                                                                           | Low      |
| Reset semantics                                          | Device switch does not clear logs, traces, health history, or the global health snapshot; `Clear all` clears app-global diagnostics stores only                                             | `src/hooks/useSavedDeviceSwitching.ts`, `src/components/diagnostics/GlobalDiagnosticsOverlay.tsx`, `src/lib/logging.ts`, `src/lib/tracing/traceSession.ts`, `src/lib/diagnostics/healthHistory.ts` | Diagnostics survive switching until explicitly cleared            | This avoids surprising resets, but it also means mixed-device evidence can accumulate in one session                                                                                                              | Medium   |
| Persistence across app restart                           | Saved-device summaries persist via `localStorage`; logs persist via `localStorage`; traces only persist via `sessionStorage`; health history and health-check state do not persist          | `src/lib/savedDevices/store.ts`, `src/lib/logging.ts`, `src/lib/tracing/traceSession.ts`, `src/lib/diagnostics/healthHistory.ts`, `src/lib/diagnostics/healthCheckState.ts`                        | Some diagnostics survive restart, some do not                     | Persistence scope is inconsistent and not obviously device-scoped, so users can infer more continuity than exists                                                                                                 | Medium   |
| Page refresh behavior after switch                       | Active-route queries invalidate and refetch; `/config` intentionally excludes `c64-all-config`                                                                                              | `src/lib/query/c64QueryInvalidation.ts`, `tests/unit/query/c64QueryInvalidation.test.ts`                                                                                                           | Route content updates without full reloading                      | Page data updates cleanly, but badge/global health state is not refreshed with the same route-aware discipline                                                                                                    | Medium   |
| Timing/race behavior around switch + health-check update | Token checks protect switcher polling cycles, but the global latest health result is not tied to selected device ID                                                                         | `src/hooks/useSavedDeviceHealthChecks.ts`, `src/hooks/useSavedDeviceSwitching.ts`, `src/hooks/useHealthState.ts`                                                                                   | Switch sheet mostly avoids stale row updates                      | The highest-risk race is the badge/header pairing a new selected device label with the old device's health result until a new full run or trace fallback replaces it                                              | High     |

## C. Option comparison

### Options considered

| Option                                                                                                      | Description                                                                                                                                                                       | Badge semantics                             | Diagnostics-view semantics                                                                                      | Switch-dialog semantics                                                                                    | Pros                                                                                                                             | Cons                                                                                                                                                     | User confusion risk | Implementation complexity | Regression risk | Compatibility with current architecture                                              | Required code touch surface                                                                                  | Recommendation score |
| ----------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------- | --------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------- | ------------------------- | --------------- | ------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------ | -------------------- |
| Global diagnostics across all devices                                                                       | Aggregate all saved-device failures into one global status model                                                                                                                  | Badge reflects all devices                  | Diagnostics shows all devices' issues in one place                                                              | Picker becomes a detail view of the global aggregate                                                       | Easy to explain in purely technical terms                                                                                        | Violates current badge mental model, creates misleading counts, hides which device is actually selected                                                  | High                | Medium                    | High            | Poor. Current code does not aggregate logs/traces/health by saved device cleanly     | Badge derivation, switcher summaries, dialog copy, clear/export, likely new registry                         | 2/10                 |
| Per-device diagnostics                                                                                      | Every diagnostics store and view becomes device-scoped and persists independently                                                                                                 | Badge reflects selected device only         | Diagnostics fully filters to selected device and preserves distinct history per device                          | Picker can drill into each device                                                                          | Conceptually clean if fully implemented                                                                                          | Requires tagging logs, traces, actions, health history, exports, and clear semantics per device; current app does not have stable device IDs on evidence | Medium              | High                      | High            | Poor to medium. Requires larger redesign of evidence ownership                       | Logging, tracing, action summaries, exports, clear flow, history, overlay, switch orchestration              | 5/10                 |
| Per-device diagnostics that reset on switch                                                                 | Selected device gets isolated diagnostics, but switching clears or resets current diagnostics context                                                                             | Badge reflects selected device only         | Diagnostics starts fresh on each switch                                                                         | Picker remains per-device                                                                                  | Avoids mixed-device evidence                                                                                                     | Surprising data loss, breaks support workflows, and conflicts with current explicit `Clear all` model                                                    | High                | Medium                    | High            | Medium at best. Current stores can be cleared, but the behavior would feel arbitrary | Switch orchestration, overlay clear behavior, history/log/trace reset hooks, tests                           | 3/10                 |
| Hybrid: current-device status surfaces plus persisted per-device switcher summaries and app-global evidence | Keep badge and Diagnostics header strictly current-device; keep non-selected-device health only in switcher; keep logs/traces/actions app-global until real device tagging exists | Badge reflects current selected device only | Diagnostics header and manual health checks are current-device; evidence stays app-global with explicit wording | Picker remains the multi-device health surface with live passive checks and persisted last-known summaries | Minimal change, calm, consistent with current badge and V2 switcher UX, avoids misleading aggregate counts, avoids forced resets | Still leaves mixed-scope evidence in Diagnostics until later refinement                                                                                  | Low to medium       | Low                       | Low to medium   | Strong. Matches current architecture with minimal semantic adjustments               | `useHealthState`, `healthCheckState/Engine`, `DiagnosticsDialog`, possibly small copy and metadata additions | 9/10                 |

### Why the hybrid option wins

It is the only option that fits all hard constraints:

- minimal invasiveness
- compatibility with the shipped long-press switcher
- calm badge semantics
- no misleading aggregated counts
- no automatic destructive reset

It also respects the repo's existing architecture instead of pretending it already has per-device evidence partitioning when it does not.

### Platform fit summary

| Option                                                          | Platform fit (Android / iOS / Web)                                                                                                           |
| --------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| Global diagnostics across all devices                           | Weak. It would create the same badge ambiguity everywhere and would be especially noisy on mobile quick-glance surfaces                      |
| Per-device diagnostics                                          | Mixed. Conceptually portable, but the current evidence stores and native log bridges are not yet partitioned by saved-device identity        |
| Per-device diagnostics with reset-on-switch                     | Weak. The reset surprise would feel worse on mobile and would make support/export flows inconsistent across platforms                        |
| Hybrid current-device status plus per-device switcher summaries | Strong. It preserves one badge mental model across Android, iOS, and web while keeping multi-device health in the intentional switch surface |

## D. Edge-case analysis

### Selected device healthy, another configured device failing

Recommended behavior:

- badge stays healthy for the selected device
- badge count stays current-device only
- failing non-selected device appears only in the switch dialog with `Offline`, `Mismatch`, or failed-probe detail

Why:

- this preserves fast recognition of the selected device and avoids badge counts that mix unrelated devices

### Selected device failing, another healthy

Recommended behavior:

- badge shows the selected device failing immediately
- switch dialog shows the other device as healthy if checked
- no special cross-device comparison is needed outside the picker

Why:

- the user's current work target should dominate the glanceable status surface

### Health checks still running in the dialog while a switch occurs

Current code already uses cycle tokens and abort controllers in `useSavedDeviceHealthChecks.ts`.

Recommended behavior:

- keep that model
- do not let picker health results rewrite badge semantics
- after switch success, schedule or require a selected-device health refresh before the badge trusts the latest full result again

### Stale health result shown for a device not checked recently

Current code only shows relative age.

Recommended behavior:

- treat non-selected-device state as `last known` when it is not fresh
- show age in the picker and, if implemented later, add a stale hint rather than pretending freshness

Why:

- stale but explicit is calmer than false precision

### App startup before any fresh health checks

Current code already holds the badge at `Idle` until the first successful REST response.

Recommended behavior:

- keep that
- do not surface other devices at startup outside the picker

Why:

- startup should not open with aggregated saved-device anxiety

### Device removed, renamed, or unreachable

Current code already persists selected-device changes and summary LRU handling in `store.ts`.

Recommended behavior:

- removal or rename should update picker labels and summaries only
- unreachable non-selected devices stay in picker state, not badge state

Why:

- unreachable secondary devices are maintenance context, not primary task context

### Rapid repeated switching

Current risk:

- route invalidation is disciplined, but global health state can lag selection

Recommended behavior:

- keep current route invalidation
- make badge/Diagnostics health ignore a latest result that does not belong to the current selected device

Why:

- this removes the most visible cross-device race without re-architecting the switcher

### Dialog opened and closed repeatedly

Current behavior:

- picker polling exists only while open
- saved-device summaries persist separately

Recommended behavior:

- keep that split
- when reopened, show last-known status immediately and refresh in the background

Why:

- this is fast, calm, and matches mobile quick-glance behavior

### Badge count derived from mixed-device state

This is the key failure mode to avoid.

Recommended behavior:

- never aggregate saved-device failures into the badge count
- never reuse a prior device's latest result after selection changes without validating target identity

### Diagnostics reset hiding relevant information

Recommended behavior:

- no reset on switch
- keep explicit `Clear all` as the only destructive reset

Why:

- automatic reset is surprising and erases support evidence during troubleshooting

### Cross-platform timing differences in Capacitor/web

The UI semantics are shared React surfaces across Android, iOS, and web. Platform-specific bridges mainly affect log mirroring and sharing, not badge or switcher ownership.

Recommended behavior:

- keep semantics identical across platforms
- let only share/export transport remain platform-specific

### Race conditions between selection changes and arriving health-check results

Current switcher polling already guards against stale row updates.

Current global selected-device health does not.

Recommended behavior:

- attach selected-device identity metadata to the global full health result or clear the selected-device result on switch until a new one is available

Why:

- this is the smallest safe fix to the most visible inconsistency

## E. Recommendation

### Chosen model

Use a hybrid model:

- current-device badge and Diagnostics header
- per-device persisted saved-device summaries plus live passive checks in the switch dialog
- no automatic diagnostics reset on switch
- app-global evidence stores until explicit device tagging exists

### Exact semantics

#### Badge

- Meaning: `current selected device status only`
- Label: selected saved-device primary label from `buildSavedDevicePrimaryLabel()` when available
- Health glyph: selected device only
- Diagnostics count: selected-device problem count only
- Non-selected saved devices: never contribute to badge glyph or count
- Default glanceable state outside the dialog: the selected device only

#### Diagnostics count

- Must remain current-device only
- Must never be global across saved devices
- Must not survive a switch as if it belongs to the newly selected device

#### Diagnostics sheet

- Header and `Run health check`: selected device only
- Connection details: selected device only
- Manage devices: still routes to Settings, unchanged
- Logs, traces, actions, health history: keep app-global for now, but describe them as app diagnostics evidence rather than per-device history

#### Non-selected-device failures

- Surface them only in the switch dialog
- Use the existing saved-device runtime status and persisted summary model:
  - `Verifying`
  - `Offline`
  - `Mismatch`
  - `Last known` / relative last-check age

This is the calmest place for them because it is an intentional, multi-device surface.

#### Persistence across switching

- Saved-device summaries persist, bounded by the existing LRU logic in `store.ts`
- App-global logs persist until cleared or storage/session limits evict them
- No automatic switch-triggered wipe

#### Reset behavior on device switch

- Nothing resets automatically on switch
- Do not clear logs, traces, health history, or action summaries on switch
- Only explicit `Clear all` clears diagnostics evidence

#### Switch dialog

- Keep the current structure: compact chooser, per-row status, per-row expandable probe detail, 10-second refresh while open
- Treat it as the only multi-device diagnostics surface
- Show stale/last-known semantics explicitly through status wording and last-check age rather than badge escalation

#### Stale data

- Selected-device badge should not show a previous device's result after selection changes
- Non-selected-device rows can show last-known state, but that state should remain visually secondary to the selected row and include age

### Why this recommendation is correct

It best satisfies the required UX principles:

- Progressive disclosure: multi-device health appears only in the switch dialog
- Calm design: no global cross-device alarm badge
- Consistency: the badge remains the current-device anchor
- Low cognitive overhead: selected device and other devices are not conflated
- Fast recognition: the selected device is always obvious in the badge and Diagnostics header
- Avoidance of misleading aggregated counts: current-device-only badge solves this directly
- Avoidance of surprising state resets: explicit `Clear all` remains the only destructive action
- Safe behavior under stale data: last-known state stays in the picker, not in the badge
- Mobile fit: quick glance on the badge, intentional multi-device scan in the picker

## F. Minimal implementation guidance

This task does not require implementation now, but if approved later, the smallest safe change set is narrow.

### Smallest likely modules to change

1. `src/lib/diagnostics/healthCheckState.ts`
   - add selected-device identity metadata to the global latest result, or store the active device ID alongside it

2. `src/lib/diagnostics/healthCheckEngine.ts`
   - write that selected-device identity when full `runHealthCheck()` completes
   - keep passive `runHealthCheckForTarget(..., { mode: "passive" })` unchanged for the switcher

3. `src/hooks/useHealthState.ts`
   - ignore or treat as stale any global latest result that does not match `savedDevices.selectedDeviceId`

4. `src/hooks/useSavedDeviceSwitching.ts`
   - on switch, either clear the selected-device latest health result until the next matching run completes or trigger a lightweight selected-device refresh path

5. `src/components/diagnostics/DiagnosticsDialog.tsx`
   - optional: add small wording that the header is current-device status while the evidence list is app diagnostics evidence
   - optional: add a stale indicator when no current-device-matching health result is available

### Safest ownership boundary

The safest boundary is:

- keep `savedDevices/store.ts` as the owner of per-device persisted switch summaries
- keep `useSavedDeviceHealthChecks.ts` as the owner of temporary switcher polling
- keep the global health-check state as selected-device-only, not multi-device

Do not move logs/traces/actions into `savedDevices/store.ts`. That would be a broader subsystem rewrite.

### What should remain unchanged

- badge tap opens Diagnostics
- badge long press opens the switch dialog
- switch dialog 10-second passive refresh behavior
- route-aware invalidation after successful switch
- persisted saved-device summaries and runtime statuses
- explicit `Clear all` behavior as the only destructive reset

### Tests needed if implemented later

1. Unit: `useHealthState` ignores a latest full health result whose device ID does not match the selected device
2. Unit: switching devices clears or invalidates the selected-device health snapshot until a matching result arrives
3. Unit: badge count stays at current-device scope even when another saved device is failing in the switcher
4. Unit: Diagnostics header shows stale/pending state rather than reusing a previous device's result after switch
5. Playwright: switch from healthy device A to failing device B and confirm the badge does not show A's result under B's label

### Highest-risk regression points

- badge flicker or unnecessary `Idle` fallback during rapid switching
- over-eager clearing that erases useful diagnostics evidence
- accidentally feeding non-selected-device picker results into badge semantics
- route invalidation and connection verification timing races

### Suggested implementation order

1. Tag the global selected-device health result with selected-device identity
2. Gate `useHealthState()` on that identity
3. Decide whether switch should clear the selected-device health snapshot or trigger a replacement full run
4. Add small Diagnostics wording/stale-state treatment if still needed after the state fix
5. Add the switch-race regression tests

## Assumptions and uncertainties

- The repo currently documents Diagnostics as local-app data in `docs/features-by-page.md`, which matches logs/traces/actions but not the device-specific feel of the Diagnostics header.
- Logs and traces contain partial host/path context but not a stable saved-device ID, so true per-device evidence partitioning would be materially broader than this task allows.
- The existing saved-device summary LRU keeps the selected device plus up to three non-selected devices. That bounded persistence is already a reasonable fit for switcher semantics.
- The biggest correctness ambiguity in the current code is the unkeyed global `latestResult`, not the switcher polling itself.

## Final conclusion

Diagnostics should not become global-across-all-devices and should not reset on every switch.

The right model for the current codebase is:

- current-device badge
- current-device Diagnostics header and health-check action
- non-selected-device health only in the switch dialog
- persisted per-device switch summaries
- app-global evidence until the app gains true device-tagged diagnostics records

That is the calmest, most intuitive, and least invasive path that is genuinely compatible with what the code already ships.
