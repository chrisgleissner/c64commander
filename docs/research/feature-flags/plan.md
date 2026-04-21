# Feature Flag Unification Implementation Plan

Date: 2026-04-18
Status: Ready for execution
Primary spec: [feature-flags.md](./feature-flags.md)
Expected change classification: `DOC_PLUS_CODE`, `UI_CHANGE`

## 1. Objective

Implement the registry-driven feature flag system defined in [feature-flags.md](./feature-flags.md) so the app has one authoritative flag model across web, Android, and iOS.

The shipped end state must include:

- one authored registry at `src/lib/config/feature-flags.yaml`
- one validated build-time compilation path from YAML to runtime TypeScript data
- one resolver that combines registry defaults, persisted overrides, and developer-mode visibility rules
- one `Experimental Features` section in Settings
- migrated handling for `hvsc_enabled`, `commoserve_enabled`, and `lighting_studio_enabled`
- unified smoke, trace, and settings import/export alignment with the same registry and override model

## 2. Execution Rules

- [feature-flags.md](./feature-flags.md) is authoritative for behavior and data semantics.
- This plan is authoritative for sequencing.
- Do not widen scope to the broader future-wave candidates in section 8 of the spec.
- Do not parse YAML dynamically on-device at runtime.
- Do not keep ad hoc visibility or editability rules in `SettingsPage.tsx` after the resolver lands.
- Do not preserve direct raw `localStorage` or `sessionStorage` writes outside the platform repository implementation or tightly bounded migration code.
- Developer mode must change visibility and editability only. It must not silently flip feature values.
- Persist explicit overrides only when they differ from registry defaults. Matching-default writes must clear the override.
- Every migration path must be deterministic and idempotent.
- Every bug or regression found during implementation must get a targeted regression test.
- Final validation must include `npm run test:coverage` with global branch coverage `>= 91%`.

## 3. Impact Map

### Registry and runtime model

- `src/lib/config/feature-flags.yaml`
- `src/lib/config/featureFlags.ts`
- `src/hooks/useFeatureFlags.tsx`
- build-time compilation or generation script under `scripts/`

### Native persistence bridge

- `src/lib/native/featureFlags.ts`
- `src/lib/native/featureFlags.web.ts`
- `android/app/src/main/java/uk/gleissner/c64commander/FeatureFlagsPlugin.kt`
- `android/app/src/test/java/uk/gleissner/c64commander/FeatureFlagsPluginTest.kt`
- `ios/App/App/AppDelegate.swift`

### Developer mode and global consumers

- `src/lib/config/developerModeStore.ts`
- `src/hooks/useDeveloperMode.ts`
- `src/components/TraceContextBridge.tsx`
- `src/lib/smoke/smokeMode.ts`

### Settings, migration, and import-export

- `src/pages/SettingsPage.tsx`
- `src/lib/config/appSettings.ts`
- `src/lib/config/settingsTransfer.ts`
- `src/pages/playFiles/hooks/useArchiveClientSettings.ts`

### Feature-gated surfaces

- `src/pages/PlayFilesPage.tsx`
- `src/pages/HomePage.tsx`
- `src/pages/DisksPage.tsx`
- `src/components/lighting/LightingStudioDialog.tsx`
- `src/hooks/useLightingStudio.tsx`

### Primary regression-test surfaces

- `tests/unit/config/featureFlags.test.ts`
- `tests/unit/featureFlags.test.ts`
- `tests/unit/lib/native/featureFlagsWeb.test.ts`
- `tests/unit/lib/config/settingsTransfer.test.ts`
- `tests/unit/lib/config/settingsTransfer.legacy.test.ts`
- `tests/unit/pages/SettingsPage.test.tsx`
- `tests/unit/pages/HomePage.test.tsx`
- `tests/unit/pages/playFiles/PlayFilesPage.navigationGuards.test.ts`
- `tests/unit/playFiles/useArchiveClientSettings.test.tsx`
- `tests/unit/components/lighting/LightingStudioDialog.test.tsx`
- `tests/unit/components/TraceContextBridge.test.tsx`
- `tests/unit/smoke/smokeMode.test.ts`
- `tests/unit/lib/smoke/smokeMode.test.ts`

### Screenshot surfaces to inspect only if visible UI changes

- `docs/img/app/settings/**`
- `docs/img/app/home/**`
- `docs/img/app/play/**`
- `docs/img/app/disks/**`

## 4. Phase Summary

| Phase | Goal | Blocking output |
| --- | --- | --- |
| 0 | Confirm architecture and exact impact map | touched files and validation scope are explicit |
| 1 | Land the YAML registry and compilation path | compiled registry is the only authored definition source |
| 2 | Land override persistence and resolver semantics | runtime supports defaults, overrides, clearing, visibility, and editability |
| 3 | Migrate legacy storage and import-export | `commoserve_enabled` and settings transfer align to the new model |
| 4 | Converge Settings UI on one feature section | `Experimental Features` replaces bespoke flag toggles |
| 5 | Migrate consuming features and gates | HVSC, CommoServe, and Lighting Studio all read one resolver |
| 6 | Align smoke, trace, and diagnostics context | all auxiliary systems consume the same registry and resolved values |
| 7 | Validate, update screenshots only if needed, and close docs | repo is green and user-visible docs stay accurate |

## 5. Detailed Phases

### Phase 0. Discovery and impact map

Goal:

- verify the current flag, settings, developer-mode, smoke, and lighting entry points before editing

Read first:

- `README.md`
- `.github/copilot-instructions.md`
- `docs/ux-guidelines.md`
- [feature-flags.md](./feature-flags.md)
- the directly touched files listed in section 3

Deliverables:

- explicit note that this task is `DOC_PLUS_CODE` and `UI_CHANGE`
- explicit map of current storage keys and migration targets
- explicit list of visible UI surfaces that will change

Exit criteria:

- the implementation path is narrow enough to avoid speculative flags or unrelated settings cleanup

### Phase 1. Registry source of truth and build-time compilation

Goal:

- make `src/lib/config/feature-flags.yaml` the only authored registry

Implementation targets:

- add `src/lib/config/feature-flags.yaml` with the initial `experimental` group and the three required features
- add a build-time compiler or generator under `scripts/` that:
  - reads the YAML
  - validates schema and invariants
  - emits a runtime TypeScript module consumed by `src/lib/config/featureFlags.ts`
- fail fast on:
  - duplicate ids
  - unknown groups
  - invalid field types
  - `developer_only: true` combined with `visible_to_user: true`
- keep the generated output non-authoritative and reproducible

Required tests:

- registry parser and validator unit tests
- regression coverage for invariant failures and duplicate ids

Exit criteria:

- the app runtime no longer depends on hand-maintained flag definitions in TypeScript

### Phase 2. Override repository and resolver unification

Goal:

- replace the current default-plus-boolean model with a resolved feature model

Implementation targets:

- extend the native feature flag bridge so overrides can be cleared explicitly
- update the repository contract to support:
  - bulk reads of known ids
  - setting explicit overrides
  - clearing overrides via `null`
- update `src/lib/config/featureFlags.ts` to:
  - load compiled registry definitions
  - merge persisted overrides
  - apply developer-mode visibility and editability rules
  - expose both effective values and resolved metadata
- update `src/hooks/useFeatureFlags.tsx` so callers can consume:
  - a full resolved snapshot
  - single-flag helpers
  - a manager-owned write path that enforces editability and clears redundant overrides

Required tests:

- resolver precedence tests
- developer-mode visibility and editability tests
- repository clear-override tests on web and Android
- regression test that matching the default removes the persisted override

Exit criteria:

- one resolver owns value, visibility, editability, and write semantics for every known feature id

### Phase 3. Legacy migration and settings transfer convergence

Goal:

- migrate legacy `commoserveEnabled` storage and export/import flows without breaking existing users

Implementation targets:

- add startup migration for `commoserve_enabled`:
  - if no override exists, read legacy `c64u_commoserve_enabled`
  - persist only when it differs from the registry default
- keep `hvsc_enabled` on its existing key path
- introduce the versioned `featureFlags` block in `src/lib/config/settingsTransfer.ts`
- import legacy v1 payloads by mapping `commoserveEnabled` to `commoserve_enabled`
- export only explicit overrides, not full defaults
- keep any temporary compatibility shim narrow and delete callers once migration is complete

Required tests:

- legacy `commoserveEnabled` migration
- idempotent migration behavior
- v1 import compatibility
- v2 export/import of explicit overrides only
- unknown-feature import ignore behavior

Exit criteria:

- settings transfer and persisted feature overrides use one consistent model

### Phase 4. Settings UI convergence

Goal:

- make Settings the single user-facing feature-flag surface

Implementation targets:

- add one `Experimental Features` section driven from registry group metadata
- move `hvsc_enabled` and `commoserve_enabled` toggles out of bespoke sections
- add `lighting_studio_enabled` as a developer-only row
- keep non-flag operational settings in their current sections:
  - HVSC base URL override
  - archive host override
  - archive client id override
  - archive user agent override
- delete the manual `localStorage` and `sessionStorage` HVSC write path from `SettingsPage.tsx`
- show developer-only labeling when developer mode is enabled
- render locked rows correctly if future registry entries need visible-but-not-editable behavior

Required tests:

- section rendering in normal mode
- section rendering in developer mode
- toggle persistence through the unified write path
- regression test proving no direct storage duplication remains in Settings

Exit criteria:

- feature visibility and mutability are entirely data-driven from the registry and resolver

### Phase 5. Consumer migration and gating

Goal:

- move all three initial features onto the unified resolver

Implementation targets:

- migrate CommoServe consumers from `loadCommoserveEnabled` to `commoserve_enabled`
- keep non-feature archive overrides on `appSettings.ts`
- gate Lighting Studio entry points and dialog access through `lighting_studio_enabled`
- keep HVSC consumers on the resolver only, with no fallback raw storage logic
- ensure `PlayFilesPage`, `HomePage`, `DisksPage`, `LightingStudioDialog`, and `useArchiveClientSettings` agree on the same effective values

Required tests:

- Play page behavior with `commoserve_enabled` on and off
- HVSC visibility behavior through the resolved flag model
- Lighting Studio entry-point suppression when the feature is off
- Lighting Studio availability when developer mode exposes and enables the flag

Exit criteria:

- there are no rollout-style booleans left on `appSettings.ts` for the initial three features

### Phase 6. Smoke and trace alignment

Goal:

- ensure smoke bootstrap, tracing, and diagnostics context use the unified registry and resolved snapshot

Implementation targets:

- update `src/lib/smoke/smokeMode.ts` to validate feature ids against the compiled registry
- route smoke feature-flag writes through the same repository or manager path, not bespoke raw storage duplication
- keep trace feature context aligned with the resolved snapshot emitted by the provider
- include enough source information in logs or tests to debug override-versus-default behavior cleanly

Required tests:

- smoke config accepts known ids and ignores or rejects unknown ids as intended
- smoke bootstrap updates the global snapshot exactly once per load path
- trace context receives the unified resolved flag set

Exit criteria:

- auxiliary systems no longer have their own hand-maintained flag key lists or persistence shortcuts

### Phase 7. Validation, screenshots, and closure

Goal:

- finish with honest validation and minimal documentation refresh

Required validation:

- `npm run lint`
- `npm run test`
- `npm run test:coverage`
- `npm run build`

Additional validation to run if implementation breadth requires it:

- `cd android && ./gradlew test`
- the smallest honest UI validation that proves:
  - the new `Experimental Features` section
  - developer-mode-only feature visibility
  - Lighting Studio hidden by default and visible when enabled
  - CommoServe and HVSC source visibility remains correct

Screenshot rule:

- update only the smallest affected subsets under:
  - `docs/img/app/settings/**`
  - `docs/img/app/home/**`
  - `docs/img/app/play/**`
  - `docs/img/app/disks/**`

Exit criteria:

- validation is green
- screenshots were updated only where the visible documented UI actually changed
- the completion summary explains what changed, what was validated, and why broader screenshot refresh was or was not needed

## 6. Out of Scope for This Implementation

Do not include these in the first implementation unless they are required by test or compile fallout:

- the broader future-wave flags from section 8 of [feature-flags.md](./feature-flags.md)
- redesigning developer-mode activation itself
- introducing a second feature section outside `Experimental Features`
- changing non-feature operational settings into registry entries
- general settings-page cleanup unrelated to feature-flag unification
