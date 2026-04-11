# Device Switcher V3 Implementation Prompt

Date: 2026-04-10
Type: Delta implementation prompt
Primary inputs:

- [../device-switch-spec.md](../device-switch-spec.md)
- [plan.md](./plan.md)

## Role

You are finishing the device switcher that is already mostly implemented.

Do not rebuild the feature from scratch.
Do not re-open already-landed architecture unless the naming cleanup forces a narrow follow-on change.

## Objective

Bring the current implementation into line with the revised spec by eliminating the split `nickname + shortLabel` model and replacing it with one user-facing device `name` that is available everywhere host and port settings are edited.

## Read First

- `README.md`
- `.github/copilot-instructions.md`
- `docs/ux-guidelines.md`
- `docs/research/device-switcher/device-switch-spec.md`
- `docs/research/device-switcher/v3/plan.md`

Then read the smallest relevant set from:

- `src/lib/savedDevices/store.ts`
- `src/hooks/useSavedDeviceSwitching.ts`
- `src/hooks/useHealthState.ts`
- `src/components/UnifiedHealthBadge.tsx`
- `src/components/diagnostics/DiagnosticsDialog.tsx`
- `src/pages/SettingsPage.tsx`
- `src/lib/c64api/hostConfig.ts`
- `src/lib/ftp/ftpConfig.ts`
- `src/lib/telnet/telnetConfig.ts`
- related unit tests and Playwright seeds

## Current State To Preserve

These behaviors are already correct and should remain intact:

- badge tap opens Diagnostics
- badge long press opens the switch picker when multiple saved devices exist
- switch orchestration uses `/v1/info`
- saved-device switch invalidation stays route-aware and does not fetch `c64-all-config`
- origin-device playlist and disk continuity already exists
- Diagnostics does not have a persistent devices switcher section
- the device-switcher remains invisible when a user has only one saved device

## Required Changes

### 1. Collapse the naming model to one persisted field

- replace `SavedDevice.nickname` and `SavedDevice.shortLabel` with `SavedDevice.name`
- update all helpers and selectors to use `name`
- badge text must come from `name` and visual truncation only
- remove persisted badge-label validation and authoring

### 2. Default the device name from product type

- add-device flows must initialize devices on the automatic naming path
- a blank or whitespace-only `name` submitted from any device editor must restore automatic product-derived naming
- automatic names must come from the detected product type, with duplicate suffixes such as `C64U-2` and `C64U-3`
- do not use `Device N` as the default name
- do not silently replace a user-authored custom name with product code or another derived label

### 3. Keep migration scope narrow

- continue supporting migration from legacy single-device host and port storage
- do not add compatibility work for interim unshipped device-switcher storage formats
- a migrated production user must end up with exactly one saved device and no visible switcher UI until they add another device through the UI

### 4. Use one shared device editor everywhere

- every editor that changes host or ports must also edit `name`
- Diagnostics `Connection details` must show `name` and canonical product code
- Diagnostics `Edit` must use the same device-editing model as Settings for:
  - `name`
  - `host`
  - `httpPort`
  - `ftpPort`
  - `telnetPort`

### 5. Update tests and seeds

- update unit tests to the final `name` model
- add regression coverage for blank-name automatic naming, duplicate suffixing, and single-device invisibility
- update Playwright seeds and screenshot fixtures that still serialize `nickname` and `shortLabel`

## Constraints

### Keep scope tight

- do not redesign switching, query invalidation, or origin-device playback unless required by the schema change
- prefer direct refactors over new subsystems
- preserve the existing badge long-press interaction and Diagnostics surface structure

### Naming rules

- there is exactly one user-editable device label: `name`
- `host` is the only persisted network-target field and may itself be either a hostname or an IP address
- custom `name` values must remain unique after trim and case-fold against the final rendered display labels

## Minimum Acceptance Criteria

- there is no persisted `shortLabel` for saved devices
- Settings no longer exposes a separate badge-label field
- new devices default to product-derived automatic names
- blank name submissions restore product-derived automatic names
- badge text is derived from `name` only and truncates visually for fit
- picker rows use the full `name`
- Diagnostics `Connection details -> Edit` exposes the same name plus host plus ports editor as Settings
- existing production users still migrate from the legacy single-device app into one saved device
- the device-switcher UI remains hidden until the user has added a second device through the UI

## Validation

Run the smallest honest executable validation set required by the repo rules:

- `npm run lint`
- `npm run test`
- `npm run test:coverage`
- `npm run build`

Regression coverage must prove:

- legacy single-device migration still works
- blank-name save restores product-derived automatic naming
- duplicate auto-named devices show suffixed product labels
- badge renders from `name` without a second stored label
- Diagnostics and Settings share the same device editor behavior
- the device-switcher stays hidden with one saved device and appears only after a second device is added

## Failure Rule

Stop and report a blocker if the codebase contains another active host-and-port editor outside Settings and Diagnostics, because that would widen the required field-set parity work.
