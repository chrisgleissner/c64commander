# Device Switcher V3 Delta Plan

Date: 2026-04-10
Status: Ready for implementation
Primary spec: [../device-switch-spec.md](../device-switch-spec.md)
Classification: `DOC_PLUS_CODE`, `UI_CHANGE`

## 1. Objective

Finish the device switcher by bringing the current implementation into line with the revised spec.

This is a delta plan, not a greenfield plan. The branch already has saved-device switching, badge long press, route-aware query invalidation, and origin-device playback or mount continuity. V3 focuses on the remaining inconsistencies.

## 2. Already Landed

These behaviors already exist and should only be touched when required by the naming-model cleanup:

- saved-device selection and `/v1/info` verification orchestration
- badge long press opening the `Switch device` picker
- route-aware invalidation that excludes `c64-all-config` from switch reloads
- bounded `DeviceSwitchSummary` retention
- origin-device reacquisition for `ultimate` playlist items and disk entries
- Settings-based saved-device CRUD
- Diagnostics no longer owning a persistent switcher section

## 3. Remaining Gaps

### Gap A. Persisted naming model is still split

Current implementation persists `nickname` and `shortLabel` in the saved-device store.

Required end state:

- persist exactly one user-facing label: `name`
- remove persisted `shortLabel`
- stop treating badge text as a separately authored field
- normalize blank names to the current host

Primary files:

- `src/lib/savedDevices/store.ts`
- `src/hooks/useHealthState.ts`
- `src/components/UnifiedHealthBadge.tsx`
- `src/pages/SettingsPage.tsx`

### Gap B. Add and edit flows do not default the device name correctly

Current implementation must preserve the product-derived automatic naming model everywhere the user can leave the name blank.

Required end state:

- add flows keep `name` blank and rely on product-derived automatic naming
- saving with a blank `name` returns the device to the product-derived automatic naming path
- automatic names come from product code and append `-2`, `-3`, and so on for duplicates
- no numbered placeholder is used as the default device name

Primary files:

- `src/pages/SettingsPage.tsx`
- shared device-editor extraction target chosen during implementation

### Gap C. Host and port editors are not field-set consistent

Current Diagnostics connection editing is still a host-and-ports editor, not the same device editor used by Settings.

Required end state:

- every host-and-port editor also edits `name`
- Diagnostics `Connection details` view shows `name` and canonical product code
- Diagnostics `Edit` action opens the same name plus host plus ports editor used by Settings

Primary files:

- `src/components/diagnostics/DiagnosticsDialog.tsx`
- `src/pages/SettingsPage.tsx`
- any extracted shared editor component or hook

### Gap D. Single-device migration must stay narrow

Only one migration path matters for rollout: existing production users without device switching must be migrated from single-device storage into one saved-device record.

Required end state:

- keep the legacy single-device migration path
- do not add compatibility work for interim device-switcher development schemas
- after rollout, a migrated user still sees no switcher UI until they add a second device through the UI

Primary files:

- `src/lib/savedDevices/store.ts`
- raw-storage readers for host and port legacy storage

### Gap E. Tests and fixtures still encode the old naming model

Current tests and Playwright seeds still reference `nickname` and `shortLabel`.

Required end state:

- store, badge, settings, diagnostics, and switching tests assert `name`
- Playwright fixtures and screenshot seeds stop persisting `nickname` and `shortLabel`
- migration tests cover only legacy single-device storage plus the new single-name model

Primary files:

- `tests/unit/lib/savedDevices/store.test.ts`
- `tests/unit/hooks/useSavedDeviceSwitching.test.tsx`
- `tests/unit/components/UnifiedHealthBadge.test.tsx`
- `tests/unit/components/diagnostics/DiagnosticsDialog*.test.tsx`
- `tests/unit/pages/SettingsPage.test.tsx`
- `playwright/screenshots.spec.ts`

## 4. Implementation Sequence

### Phase 1. Consolidate the saved-device schema

- replace `nickname` and `shortLabel` with `name`
- rename `lastKnown*` fields to the spec names only if that can be done without widening scope excessively
- keep the switch-summary and verification behavior intact

Exit criteria:

- all runtime reads use one persisted user-facing label

### Phase 2. Keep only legacy single-device migration

- migrate legacy single-device storage to one saved device on the automatic naming path
- do not spend scope on compatibility for interim unshipped multi-device schemas

Exit criteria:

- existing production users migrate cleanly into one saved device and still see no switcher UI

### Phase 3. Unify the device editor

- extract or centralize the validation and field model for `name`, `host`, `httpPort`, `ftpPort`, `telnetPort`
- use it from Settings
- use it from Diagnostics `Connection details -> Edit`

Exit criteria:

- there is one device-editing model and one validation contract

### Phase 4. Remove badge-label authoring

- delete the Settings `Badge label` field
- badge text derives from `name` and truncates visually only
- picker and settings rows use the full `name`

Exit criteria:

- no persisted badge-only label remains

### Phase 5. Update tests, fixtures, and screenshots

- update unit tests and seeds to the final schema
- add regression coverage for blank-name automatic naming, duplicate suffixing, and single-device invisibility
- refresh only the screenshots affected by the name-field and diagnostics-editor changes

Exit criteria:

- tests prove the naming-model cleanup and editor parity

## 5. Validation

Because this will change executable code, the final implementation pass must run:

- `npm run lint`
- `npm run test`
- `npm run test:coverage`
- `npm run build`

Targeted regression coverage must include:

- legacy single-device migration
- blank-name save restores product-derived automatic naming
- duplicate auto-named devices resolve to suffixed product labels
- badge renders truncated `name` without a separate stored label
- Diagnostics edit uses the same name plus host plus ports editor as Settings
- the device-switcher UI stays hidden when exactly one saved device exists

## 6. Out of Scope for V3

Do not reopen or redesign these unless required by compile or test fallout from the naming cleanup:

- badge long-press switching interaction
- route invalidation strategy for saved-device switching
- origin-device content resolution for playback or disks
- the decision to keep Diagnostics free of a persistent switcher section
