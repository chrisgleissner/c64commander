# Device Switcher Specification

Date: 2026-04-09
Status: Draft for implementation
Classification of eventual implementation: `DOC_PLUS_CODE`, `UI_CHANGE`

## 1. Purpose

This document defines the target behavior for multi-device switching in C64 Commander.

The feature allows a user to save multiple C64 Ultimate-family devices and switch between them quickly from anywhere in the app without editing connection fields during routine use.

This specification is fully aligned with the v2 UX direction in `docs/research/device-switcher/v2/ux-recommendations-2026-04-09.md`.

It also defines how existing playlists and disk collections continue to work when some items were originally imported from a different saved C64 device than the one currently selected.

## 2. Document Conventions

The key words `MUST`, `MUST NOT`, `SHOULD`, and `MAY` are normative.

If this document and implementation diverge, implementation is wrong unless the user explicitly approves a spec change.

## 3. Product Goal

The app MUST support fast switching between multiple configured devices while preserving the current top-level information architecture.

Primary user outcome:

- from any main page, routine device switching is initiated by long pressing the unified health badge and then tapping a target device in the picker

Primary system outcome:

- selection feedback appears immediately from local metadata
- live connectivity and identity are then verified with a lightweight request
- full configuration fetches are never part of the switch handshake
- collection items imported from another saved C64 device remain playable or mountable through on-demand reacquisition

## 4. Non-Goals

This feature does not:

- add a new top-level tab
- add a new persistent header control beyond the existing badge
- make Settings the primary switch flow
- make Diagnostics the primary routine switch flow
- keep full multi-device working sets resident in memory
- silently clone complete remote libraries into app-owned local storage
- fetch `c64-all-config` during switching
- redefine the broader diagnostics architecture beyond removing it from the primary switching path

## 5. Fixed Constraints

The implementation MUST preserve all of the following:

- `UnifiedHealthBadge` remains in the shared top-right header
- tapping the badge still opens Diagnostics
- long press on the badge becomes the routine switch entry point when multiple saved devices exist
- no additional persistent header chips are introduced
- host, HTTP port, FTP port, and Telnet port remain configurable per saved device
- deep editing remains secondary to fast switching
- device type remains legible in diagnostics details and settings
- fast switching is the default behavior
- only memory-pressure handling may intentionally reduce retained switch context

## 6. Terms

### 6.1 Saved device

A persisted user-configured device record that contains connection details and last-known identity metadata.

### 6.2 Selected device

The saved device currently chosen by the user. This is the target the app is trying to talk to right now.

### 6.3 Verified device

The identity returned by the most recent successful `/v1/info` probe for the selected device.

### 6.4 Last-known device state

The most recent persisted verified identity and compact status summary for a saved device.

### 6.5 Switch handshake

The minimal sequence required to move from one selected device to another:

1. update local selection
2. project connection settings into runtime config
3. render immediate local metadata
4. verify with `/v1/info`
5. refresh only active-route essential data on success

### 6.6 Origin device

The saved device from which a playlist item or disk entry was originally imported when the item's source is a C64 device-backed `ultimate` path.

### 6.7 Device-bound collection item

A playlist item or disk collection entry whose bytes live on a saved C64 device rather than in app-local storage or the HVSC library.

For this specification, that means an item imported from the `ultimate` source.

## 7. UX Surface Requirements

### 7.1 Unified Health Badge

Component: `UnifiedHealthBadge`

Requirements:

- MUST remain the persistent top-right connectivity indicator
- MUST continue opening Diagnostics when tapped
- MUST open the device picker when long pressed and two or more saved devices exist
- MUST show a badge-safe device label, not the full primary label
- MUST keep the existing health glyph and health wording behavior
- MUST fit the device label within 8 visible characters

Badge label resolution order:

1. verified selected device `shortLabel`
2. selected device `shortLabel`
3. derived badge-safe label
4. canonical product-family code fallback

Examples of valid badge labels:

- `Studio64`
- `LabU64`
- `C64U`

### 7.2 Device Picker

Surface type: decision interstitial

Requirements:

- MUST be invoked from badge long press, not from a persistent Diagnostics section
- MUST be compact and decision-only
- MUST show a vertical list of saved devices
- MUST use name-first rows in the healthy idle state
- MUST NOT include CRUD controls or management actions
- MUST NOT render hostname, product-family code, or unique-id text by default in healthy idle rows
- MUST allow tapping a row to begin switching immediately

Picker title:

- `Switch device`

Picker row content in the healthy idle state:

- device name
- selected indicator when applicable

Allowed additional transient row states:

- `Verifying`
- `Offline`
- `Mismatch`

### 7.3 Diagnostics

Component: `DiagnosticsDialog`

Requirements:

- MUST remain the tap destination from the badge
- MUST NOT contain a persistent Devices switcher section
- MUST remain focused on current device health, current device details, activity, and diagnostics-related secondary actions
- MAY expose `Connection details` and management navigation through overflow actions

### 7.4 Settings

Surface: connection management area on `SettingsPage`

Requirements:

- MUST remain the deep-editing surface for device definitions
- MUST support add, edit, rename, and delete
- MUST allow selecting a saved device
- MUST NOT become the primary routine switching path

## 8. Required User Flows

### 8.1 Routine switch from any main page

1. User long presses `UnifiedHealthBadge`.
2. App opens the `Switch device` picker.
3. User taps a saved device row.
4. App immediately updates selected-device UI from local metadata.
5. App performs `/v1/info` verification in the background.
6. On success, app refreshes only the active-route essential data.
7. On failure, app keeps the selection but presents the target as offline or mismatch as appropriate.

### 8.2 Current status inspection

1. User taps `UnifiedHealthBadge`.
2. App opens `DiagnosticsDialog`.
3. User inspects health, current device details, recent activity, and secondary actions.

### 8.3 Deep editing

1. User opens `SettingsPage`.
2. User adds, edits, renames, or deletes saved devices.
3. Edits affect future switching immediately after persistence.

### 8.4 Offline selection

1. User long presses the badge and selects a saved device.
2. Immediate UI updates to that device's local metadata.
3. `/v1/info` fails.
4. App keeps the selected device active in local state.
5. Badge and relevant detail surfaces show `Offline`.
6. UI retains last-known summary data separately from live verification state.

### 8.5 Mismatch detection

1. User long presses the badge and selects saved device A.
2. `/v1/info` succeeds but returns identity inconsistent with saved device A.
3. App enters `Mismatch`.
4. Diagnostics shows both selected target and actual verified device identity when known.
5. Saved device records remain intact until user resolves the mismatch.

### 8.6 Playback or mount after switching away from the origin device

1. User imports a playlist item or disk entry from saved device A.
2. User switches to saved device B.
3. User tries to play or mount that item while device B remains selected.
4. App resolves the item's persisted origin-device metadata.
5. If selected device B is confidently the same physical device as origin device A, app MAY use the direct device path.
6. Otherwise, app fetches the bytes from origin device A without changing `selectedDeviceId`.
7. App uploads or injects those bytes into currently selected device B using the existing local-upload execution path for that media type.
8. If origin device A is unreachable, mismatched, deleted, or the file is missing, app keeps device B selected and marks the item unavailable with a precise internal reason.

## 9. Data Model

### 9.1 Persisted records

```ts
type ProductFamilyCode = "C64U" | "U64" | "U64E" | "U64E2";

type SavedDevice = {
  id: string;
  nickname: string | null;
  shortLabel: string | null;
  host: string;
  httpPort: number;
  ftpPort: number;
  telnetPort: number;
  lastKnownProduct: ProductFamilyCode | null;
  lastKnownHostname: string | null;
  lastKnownUniqueId: string | null;
  lastSuccessfulConnectionAt: string | null;
  lastUsedAt: string | null;
};

type SavedDeviceState = {
  selectedDeviceId: string;
  devices: SavedDevice[];
};
```

Rules:

- `selectedDeviceId` MUST always refer to an existing saved device after migration completes
- port values MUST remain independently editable per device
- `lastKnown*` fields MUST be updated only from successful verification results

### 9.2 Compact per-device switch summary

```ts
type DeviceSwitchStatus = "connected" | "verifying" | "offline" | "mismatch" | "last-known";

type DeviceSwitchSummary = {
  deviceId: string;
  verifiedAt: string | null;
  lastHealthState: string | null;
  lastConnectivityState: string | null;
  lastProbeSucceededAt: string | null;
  lastProbeFailedAt: string | null;
  lastVerifiedProduct: ProductFamilyCode | null;
  lastVerifiedHostname: string | null;
  lastVerifiedUniqueId: string | null;
};
```

Purpose:

- provide immediate post-switch context without retaining large route-level caches for every device

Restrictions:

- this summary cache MUST stay small and bounded
- it MUST NOT grow into a shadow copy of full per-device app state

### 9.3 Device-bound collection origin metadata

Playlist items and disk entries imported from the `ultimate` source MUST persist hidden origin metadata sufficient to reacquire bytes later from the original device.

Minimum required fields:

```ts
type DeviceBoundContentOrigin = {
  sourceKind: "ultimate";
  originDeviceId: string;
  originDeviceLastKnownUniqueId: string | null;
  originPath: string;
  importedAt: string;
};
```

Rules:

- this metadata MUST be persisted for every playlist item and disk entry imported from a C64 device-backed source
- this metadata MUST NOT be surfaced as source text in normal playlist rows or disk rows
- `originDeviceId` MUST bind to the saved-device record, not to a host string
- `originPath` MUST preserve the device-relative path needed for FTP or direct-device retrieval
- local and HVSC items MUST NOT require origin-device metadata

### 9.4 Unavailability reasons for origin-bound items

When a device-bound collection item cannot be resolved, the implementation MUST preserve the generic user-facing `Unavailable` state while recording a precise internal reason.

Minimum additional reasons:

- `origin-device-unreachable`
- `origin-device-removed`
- `origin-device-mismatch`
- `origin-file-missing`

## 10. Label and Identity Rules

### 10.1 Canonical product-family code

Valid codes:

- `C64U`
- `U64`
- `U64E`
- `U64E2`

Requirements:

- settings saved-device rows MUST show the canonical product-family code
- diagnostics detail MUST show the canonical product-family code
- `Connection details` surfaces MUST show the canonical product-family code
- the badge does not need to show both custom label and product code together
- the picker does not need to show canonical product-family code in healthy idle rows

### 10.2 Primary label

Primary label resolution order:

1. `nickname`
2. verified hostname
3. configured host

This label is used for picker rows, settings rows, and detailed displays.

### 10.3 Badge label

Badge label source: `shortLabel`

Requirements:

- MUST be at most 8 visible characters
- MUST be unique across saved devices after trim and case-fold
- MUST be explicitly user-provided when automatic derivation cannot produce a unique result

Derivation order:

1. explicit `shortLabel`
2. first meaningful token from `nickname` if unique within 8 characters
3. first meaningful token from hostname if unique within 8 characters
4. IPv4 last octet or IPv6 last hextet if unique
5. canonical product-family code fallback

If derivation is not unique:

- app MUST require explicit `shortLabel`
- app MUST NOT silently append numbers or mutate labels heuristically

## 11. Identity Truth Model

### 11.1 Source priority

Identity certainty order:

1. `unique_id` from `/v1/info`
2. `hostname` + `product` from `/v1/info`
3. configured host only

### 11.2 Expected identity

The expected identity for a saved device is derived from:

1. `lastKnownUniqueId`, when present
2. else `lastKnownHostname` + `lastKnownProduct`, when both are present
3. else configured host only

### 11.3 Mismatch rules

- if verified `unique_id` differs from the selected device's expected `unique_id`, the state MUST be `Mismatch`
- if verified `unique_id` matches another saved device, diagnostics SHOULD surface that saved device as the actual connected device
- if `/v1/info` does not expose `unique_id`, mismatch detection MUST fall back to the strongest remaining certainty source
- older firmware without full identity fields MUST degrade gracefully instead of blocking switching

## 12. Switch Status Model

The badge, picker, and relevant detail surfaces MUST derive from a compact status model.

| State        | Meaning                                                          | Typical source                              |
| ------------ | ---------------------------------------------------------------- | ------------------------------------------- |
| `Connected`  | selected device was verified successfully                        | latest `/v1/info` success                   |
| `Verifying`  | switch handshake is in progress                                  | local selection updated, probe not finished |
| `Offline`    | selected device could not be verified                            | latest `/v1/info` failed                    |
| `Mismatch`   | selected target and verified device disagree                     | `/v1/info` identity conflict                |
| `Last known` | stale summary shown while live verification is absent or pending | cached `DeviceSwitchSummary`                |

Rules:

- `Verifying` MUST appear immediately after selection and before probe completion
- `Last known` MAY be shown alongside stale metadata, but MUST NOT be represented as live connectivity
- `Mismatch` takes precedence over `Connected`
- healthy idle picker rows SHOULD remain name-first and minimal

## 13. Switch Algorithm

Function name: `switchToSavedDevice(deviceId)`

Required sequence:

1. validate `deviceId` exists
2. persist `selectedDeviceId`
3. update `lastUsedAt` for the selected device
4. project selected host and ports into the existing runtime connection path
5. update badge, picker state, and relevant details immediately from saved metadata
6. render `DeviceSwitchSummary` for that device as `Last known`, if available
7. mark the selected device as `Verifying`
8. start lightweight verification using `/v1/info`
9. if verification succeeds:
   - update verified identity
   - update `SavedDevice.lastKnownProduct`
   - update `SavedDevice.lastKnownHostname`
   - update `SavedDevice.lastKnownUniqueId`
   - update `SavedDevice.lastSuccessfulConnectionAt`
   - update `DeviceSwitchSummary`
   - resolve final state as `Connected` or `Mismatch`
   - refresh only active-route essential data
10. if verification fails:

- keep `selectedDeviceId`
- update summary failure timestamps
- mark device as `Offline`
- preserve last-known metadata separately from live state

Handshake restrictions:

- the handshake MUST use `/v1/info`
- the handshake MUST NOT fetch the full config tree
- the handshake MUST NOT fetch `c64-all-config`

## 14. Data Reload Rules

### 14.1 Always reload on every switch

- `/v1/info`

### 14.2 Reload only after successful verification

- active-route essential data, as defined below

### 14.3 Never reload as part of the switch handshake

- `c64-all-config`
- full configuration tree
- category trees not required by the visible route
- FTP directory listings not required by the visible route
- source browsers not currently visible

### 14.4 Route reload matrix

After successful verification, reload only the minimum required data for the current route.

### Route `/`

- `c64-info`
- small above-the-fold status data required by Home

### Route `/settings`

- `c64-info`
- connection and status data visible above the fold

### Route `/disks`

- current drive state
- no broad file-browser data

### Route `/config`

- category list
- currently visible category or item only
- never `c64-all-config` on switch

### Route `/play`

- current playback-control device state only
- no source-browser data

### 14.5 Placeholder behavior

If a route already has persisted snapshots:

- app SHOULD show stale placeholder data while revalidating
- app MUST NOT duplicate those snapshots into another per-device in-memory cache layer
- app MUST NOT eagerly fetch origin-device collection bytes during switching

## 15. Cache and Memory Model

### 15.1 Tier 1: fast-switch cache

Contents:

- `DeviceSwitchSummary` only

Purpose:

- render immediate identity and status context after selection

Rules:

- MUST retain the selected device summary
- SHOULD retain only 2 to 3 recent non-selected device summaries
- MUST use LRU eviction for non-selected entries
- MAY be persisted because payload is small

### 15.2 Tier 2: active-route working data

Contents:

- route and query data for the currently selected device only

Examples:

- `c64-info`
- visible drive state
- visible config items
- visible playback control state

Rules:

- MUST be active-route-first
- MUST NOT retain full heavy working sets for multiple devices by default
- MUST be invalidated on switch
- MUST be repopulated only for the currently selected device

### 15.3 Memory pressure behavior

If memory pressure is detected or strongly suspected:

1. evict non-selected Tier 2 route data first
2. evict oldest non-selected Tier 1 summaries next
3. keep selected-device metadata and selected-device summary

Fast switching remains the default behavior. Reduced retention is an exception path, not the design center.

## 16. Collection Continuity Rules

### 16.1 Scope

These rules apply to playlist items and disk collection entries imported from the `ultimate` source.

They exist so device switching does not silently break already-collected content.

### 16.2 Resolution strategy

When a device-bound collection item is played or mounted:

1. app MUST resolve its origin metadata
2. app MUST compare the currently selected device with the origin device
3. if they are confidently the same physical device, app MAY use the direct device path
4. otherwise, app MUST fetch bytes from the origin device and execute the current-device upload path

The origin fetch:

- MUST NOT change `selectedDeviceId`
- MUST NOT present as a device switch in the UI
- MUST use the origin device's own saved host and port settings
- MUST be request-scoped, not a hidden long-lived mirror

### 16.3 Media-specific execution rules

For device-bound items whose selected device differs from their origin device:

- SID, MOD, PRG, and CRT content MUST be fetched from the origin device and then executed through the current device's upload flow
- disk images MUST be fetched from the origin device and then mounted on the current device through the existing upload or mount-upload flow
- implementations MUST NOT assume matching paths exist on the newly selected device

### 16.4 Source transparency rule

Playlist and disk rows remain source-transparent as defined by `docs/ux-guidelines.md`.

Therefore:

- normal rows MUST continue showing generic source icon behavior, not origin-device labels
- detailed diagnostics, item detail, logs, or error text MAY mention the origin device when needed to explain a failure

### 16.5 No eager duplication rule

Switching devices MUST NOT trigger background copying of prior-device collections into app-local storage.

Allowed:

- request-scoped temporary blobs for the active play or mount operation
- short-lived temporary transfer files needed to complete the operation safely

Forbidden by default:

- bulk mirroring of a device library after switch
- automatic permanent duplication of every `ultimate` item into app-local storage

### 16.6 Origin-device identity and alias handling

- if the selected device and origin device have matching verified `unique_id`, the item MAY be treated as local to the selected device even if host strings differ
- if the origin saved-device record now verifies to a different `unique_id`, the item MUST be treated as `origin-device-mismatch`
- host edits or renames to the origin saved-device record MUST NOT break references, because references bind to saved-device id first

### 16.7 Deleting a saved device that still owns collection items

If the user deletes a saved device that is still referenced by playlist items or disk entries:

- settings MUST warn that collection items still reference that device
- deletion MAY proceed if the user confirms
- referenced items MUST remain in their collections
- referenced items MUST become unavailable until rebound, re-imported, or removed
- implementation MUST NOT silently reassign those items to another saved device

### 16.8 Failure handling

If origin resolution fails:

- currently selected device remains selected
- play or mount attempt fails for that item only
- item state becomes `Unavailable`
- detailed error copy SHOULD identify whether the problem was unreachable origin device, missing file, deleted origin device, or origin mismatch

### 16.9 Sequential playback behavior

When playlist progression reaches a device-bound item whose origin differs from the selected device:

- the same origin-resolution and reacquisition rules MUST apply
- failure MUST surface as an ordinary playback failure for that item
- implementation MUST NOT silently switch the selected device in order to continue playback

## 17. In-Flight Work Rules

When switching devices:

- polling or read loops tied to the previous target MUST be cancelled or invalidated
- completed writes from the old target MUST NOT be replayed against the new target
- if a foreground mutation is actively running, the app SHOULD require confirmation before switching

## 18. Persisted vs Non-Persisted Data

### 18.1 Persisted always

- `SavedDevice` records
- `selectedDeviceId`
- selected device host and ports projected into runtime config
- all `SavedDevice.lastKnown*` fields
- `SavedDevice.lastSuccessfulConnectionAt`
- `SavedDevice.lastUsedAt`
- origin metadata for device-bound playlist items and disk entries

### 18.2 Persisted as compact cache

- `DeviceSwitchSummary`

### 18.3 Not automatically persisted for switching

- full per-device config trees
- full per-device FTP listings
- full per-device route query caches
- full duplicated byte copies of device-bound collection items unless the user explicitly performs a local save or import action

## 19. Error and Edge Behavior

### 19.1 Offline target

- keep selection on the chosen device
- badge shows selected badge label with offline state
- picker or relevant detail surfaces show `Offline`
- management surface MUST expose `Edit`

### 19.2 Mismatch

- badge SHOULD use the actual verified device label if the actual device can be resolved confidently
- diagnostics MUST show selected target and verified actual device separately
- saved records remain intact until user action resolves the mismatch

### 19.3 Host edit

- editing host clears verified certainty for that saved device
- next successful `/v1/info` re-establishes identity

### 19.4 Product change

- same `unique_id`: update metadata, no mismatch
- different `unique_id`: mismatch

### 19.5 Unsupported or older firmware

- lack of modern identity fields MUST reduce certainty, not break switching
- diagnostics SHOULD make uncertainty legible without overstating confidence

### 19.6 Origin device offline while target device is healthy

- the selected device remains healthy and selected
- only the affected device-bound item becomes unavailable
- the app MUST NOT collapse this into a generic current-target connection failure

### 19.7 Origin file deleted after import

- the collection item remains in place
- play or mount fails for that item
- precise internal reason becomes `origin-file-missing`

### 19.8 Same physical device saved twice under different hosts

- matching verified `unique_id` MUST win over host-string differences
- direct execution MAY be used when identity confidence is sufficient

### 19.9 Deleting or editing an origin saved-device record

- delete flow behavior is governed by section `16.7`
- edit flow MUST preserve collection references by saved-device id
- if the edited record later verifies to a different physical device, affected items become `origin-device-mismatch`

## 20. Migration

The app currently has single-device connection storage. Initial rollout MUST migrate that storage into the new saved-device model.

Legacy inputs to read:

- single-device host storage
- HTTP port storage if separate
- FTP port storage
- Telnet port storage

Migration steps:

1. derive `host`
2. derive `httpPort`
3. derive `ftpPort`
4. derive `telnetPort`
5. create the first `SavedDevice`
6. derive `nickname` if possible
7. derive `shortLabel` if possible
8. set `selectedDeviceId`
9. continue projecting the selected saved device through the existing runtime config path

Migration requirements:

- migration MUST be idempotent
- migration MUST preserve existing connection behavior for single-device users
- migration failure MUST not silently destroy old connection data

## 21. Likely Implementation Touchpoints

Existing surfaces likely to change:

- `src/components/UnifiedHealthBadge.tsx`
- `src/components/diagnostics/DiagnosticsDialog.tsx`
- `src/components/diagnostics/GlobalDiagnosticsOverlay.tsx`
- `src/pages/SettingsPage.tsx`
- `src/hooks/useHealthState.ts`
- `src/hooks/useC64Connection.ts`
- `src/lib/connection/connectionManager.ts`
- `src/lib/c64api/hostConfig.ts`
- `src/lib/query/c64QueryInvalidation.ts`
- `src/lib/config/appConfigStore.ts`
- `src/lib/diagnostics/healthModel.ts`
- `src/lib/diagnostics/targetDisplayMapper.ts`
- playback item persistence and hydration
- disk library persistence and mount resolution
- current-device upload execution paths for device-bound transfers

New modules likely required:

- saved-device store
- device-switch summary cache
- switch orchestration logic
- badge-label derivation helper
- device picker surface
- origin-device content resolver
- device-bound transfer coordinator

## 22. Acceptance Criteria

The implementation is complete only when all of the following are true:

- badge tap still opens diagnostics
- badge long press opens the picker when multiple saved devices exist
- the one-device case shows no redundant switching UI
- badge device label fits within 8 visible characters
- picker rows are name-first in the healthy idle state
- hostnames, product-family codes, and identity fragments are not rendered by default in healthy picker rows
- settings and diagnostics detail surfaces show canonical product-family codes where appropriate
- selecting a device updates visible identity immediately from local metadata
- live status is then verified using `/v1/info`
- switching never triggers automatic full-config reload
- `c64-all-config` is never part of the switch handshake
- only active-route essential data reloads after successful verification
- per-device switch caching stores only bounded `DeviceSwitchSummary` data
- full per-device working sets are not retained in memory across multiple devices by default
- Diagnostics no longer contains a persistent Devices switcher section
- playlist items and disk entries imported from one saved C64 device still work after switching to another saved C64 device
- when the selected device differs from the item's origin device, the app reacquires bytes from the origin device and executes the current-device upload path
- origin-device reacquisition never changes `selectedDeviceId`
- origin-device failures only fail the affected item, not the entire selected-device connection state
- deleting an origin saved-device record does not silently delete or reassign referenced collection items
- under memory pressure, non-selected route data is evicted before selected-device status data
- offline, mismatch, host-edit, and older-firmware behaviors match this specification

## 23. Explicit Implementation Order

An implementation SHOULD proceed in this order:

1. saved-device data model and migration
2. badge long press and picker shell
3. switch orchestration and `/v1/info` verification
4. diagnostics simplification and settings alignment
5. device-bound collection origin metadata and transfer resolution
6. multi-device mock and harness support
7. active-route reload and invalidation behavior
8. cache bounding and memory-pressure handling
9. regression tests and documentation alignment
