# Feature Flags

## 1. Executive Summary

The app already has the foundations of a cross-platform feature flag system, but it is incomplete and inconsistent. `hvsc_enabled` is managed through the Capacitor `FeatureFlags` plugin and a global React provider, while `commoserveEnabled` is stored as a regular app setting, developer mode is handled separately, and Lighting Studio is not gated at all. The result is split persistence, duplicated write logic, and no shared rules for visibility, editability, or rollout.

This document recommends a single authoritative registry file at `src/lib/config/feature-flags.yaml`, compiled into the app bundle and consumed by a single TypeScript resolver. The resolver should keep one stable model for all platforms: registry defaults come from YAML, persisted user overrides come from the existing Capacitor feature flag repository, and developer mode changes only visibility and editability, not the flag value itself. The initial registry should include `hvsc_enabled`, `commoserve_enabled`, and `lighting_studio_enabled`, with a dedicated `Experimental Features` section in Settings as the only user-facing flag surface.

## 2. Current State Analysis

### Existing feature flags

The current feature flag implementation is centered on `src/lib/config/featureFlags.ts`.

- `FEATURE_FLAG_DEFINITIONS` contains only one flag: `hvsc_enabled`.
- The definition contains only `defaultValue`; it does not encode visibility, mutability, grouping, or developer-only semantics.
- `FeatureFlagManager` loads defaults, merges persisted values from a repository, and exposes a snapshot to React consumers.
- `featureFlagManager` is mounted globally through `FeatureFlagsProvider` in `src/App.tsx`.

Runtime persistence already exists on all supported platforms.

- Web uses `src/lib/native/featureFlags.web.ts`, which stores `c64u_feature_flag:<id>` in `localStorage` and `sessionStorage`.
- Android uses `android/app/src/main/java/uk/gleissner/c64commander/FeatureFlagsPlugin.kt`, which stores booleans in DataStore preferences.
- iOS uses `FeatureFlagsPlugin` in `ios/App/App/AppDelegate.swift`, which stores booleans in `UserDefaults`.

### Settings and developer mode today

`src/pages/SettingsPage.tsx` shows the app's current inconsistency most clearly.

- The HVSC section exposes `Enable HVSC downloads` using `useFeatureFlag("hvsc_enabled")`.
- The same component also manually writes `c64u_feature_flag:hvsc_enabled` into `localStorage` and `sessionStorage`, duplicating the repository write path that already exists behind `setFlag`.
- The Online Archive section exposes `CommoServe` through `loadCommoserveEnabled` / `saveCommoserveEnabled` from `src/lib/config/appSettings.ts`, not through the feature flag system.
- HVSC mirror override visibility is currently tied directly to developer mode in `SettingsPage.tsx`, but the flag itself is not.

Developer mode is implemented independently in:

- `src/lib/config/developerModeStore.ts`
- `src/hooks/useDeveloperMode.ts`

Current behavior:

- The About card in `SettingsPage.tsx` enables developer mode after 7 taps within 3 seconds.
- Developer mode is persisted as `c64u_dev_mode_enabled` in `localStorage`.
- Only a small number of settings fragments consult developer mode.
- There is no shared contract that says developer mode controls flag visibility or mutability globally.

### Other feature-like controls outside the current flag system

- `commoserveEnabled` is stored in `src/lib/config/appSettings.ts`, observed through `src/pages/playFiles/hooks/useArchiveClientSettings.ts`, and exported/imported in `src/lib/config/settingsTransfer.ts`.
- Lighting Studio is surfaced through `useLightingStudio` consumers in `HomePage.tsx`, `PlayFilesPage.tsx`, `DisksPage.tsx`, and `LightingStudioDialog.tsx`. There is no feature flag in front of it today.
- Smoke/bootstrap configuration in `src/lib/smoke/smokeMode.ts` already accepts a `featureFlags` object, but it only recognizes ids that appear in `FEATURE_FLAG_DEFINITIONS`.

### Identified inconsistencies and problems

1. Flag metadata is missing.
   `featureFlags.ts` knows only default boolean values. It cannot answer public vs developer-only, hidden vs disabled, or toggleable vs locked.

2. Feature storage is split.
   `hvsc_enabled` uses the feature flag repository, while `commoserveEnabled` uses generic app settings. This means rollout-type features do not have one canonical storage model.

3. Write logic is duplicated.
   `SettingsPage.tsx` writes `hvsc_enabled` through the hook and then writes raw storage again, which creates multiple authoritative paths for the same flag.

4. Developer mode is not integrated with feature semantics.
   It currently unlocks specific UI fragments, not a unified feature policy.

5. There is no central user-facing feature section.
   HVSC lives under `HVSC`, CommoServe lives under `Online Archive`, and Lighting Studio is not represented in Settings at all.

6. Existing tracing and smoke support are only partially aligned.
   The app already records flags in trace context and allows smoke bootstrap to write them, but only for the incomplete registry.

## 3. Configuration Format Decision

### YAML vs JSON

For the authoritative feature registry, YAML is the better fit.

#### YAML advantages

- Better readability for developer-maintained configuration with multiple metadata fields per feature.
- Supports inline comments, which matter for rollout rationale and migration notes.
- Cleaner diffs when adding or reclassifying flags.
- Better grouping ergonomics for sections such as `experimental`.
- Matches existing repository usage patterns for configuration-like assets such as `docs/c64/c64u-openapi.yaml` and GitHub workflow YAML files.

#### JSON advantages

- Native support in the JavaScript toolchain with no loader or transform.
- Easier runtime import if no build-time transformation is added.
- Slightly simpler strict parsing rules.

#### Decision

Use YAML for the source-of-truth file and keep JSON for user-exported runtime settings.

This split fits the current codebase:

- The authoritative registry is developer-authored configuration, so YAML is preferred.
- User import/export in `src/lib/config/settingsTransfer.ts` should remain JSON because it is already a versioned machine-readable payload.
- To keep runtime overhead low, the app should not parse YAML on-device at runtime. The YAML registry should be validated and transformed at build time into the object consumed by `featureFlags.ts`.

### Proposed authoritative file

`src/lib/config/feature-flags.yaml`

This should be the only file where feature definitions are authored. Any generated build artifact is derived from it and is not authoritative.

## 4. Proposed Feature Flag Model

### Formal schema

```yaml
version: 1

groups:
  experimental:
    label: Experimental Features
    description: Unstable or rollout-controlled capabilities.

features:
  - id: hvsc_enabled
    enabled: true
    visible_to_user: true
    user_toggleable: true
    developer_only: false
    group: experimental
    title: HVSC downloads
    description: Show HVSC download and ingest controls on the Play page.

  - id: commoserve_enabled
    enabled: true
    visible_to_user: true
    user_toggleable: true
    developer_only: false
    group: experimental
    title: CommoServe
    description: Show the CommoServe source in Add Items and Online Archive flows.

  - id: lighting_studio_enabled
    enabled: false
    visible_to_user: false
    user_toggleable: false
    developer_only: true
    group: experimental
    title: Lighting Studio
    description: Enable Lighting Studio entry points and dialog access.
```

### Field definitions

- `id`
  Stable snake_case identifier used everywhere in code, persistence, tracing, and settings export/import.

- `enabled`
  Registry default when no explicit user override exists.

- `visible_to_user`
  Whether the feature should appear in Settings when developer mode is off.

- `user_toggleable`
  Whether a non-developer user may change the feature in Settings when it is visible.

- `developer_only`
  Whether the feature is hidden from standard users and only surfaced once developer mode is enabled.

- `group`
  Logical grouping used by Settings for sectioning and future filtering.

- `title`
  Short user-facing label for Settings.

- `description`
  User-facing explanation for the Settings row and future diagnostics surfaces.

### Recommended TypeScript shape after validation

```ts
type FeatureFlagDefinition = {
  id: string;
  enabled: boolean;
  visible_to_user: boolean;
  user_toggleable: boolean;
  developer_only: boolean;
  group?: string;
  title: string;
  description: string;
};
```

### Semantics and invariants

1. `id` is the stable primary key.
   It must never be renamed casually because it is persisted cross-platform and appears in smoke config and trace context.

2. `enabled` means default runtime state, not user override state.
   The registry describes the shipped default. It does not record per-user changes.

3. `disabled` and `hidden` are different:
   - Disabled: the feature row is visible, but the effective feature state is `false`.
   - Hidden: the feature row is not rendered in standard Settings at all.

4. `developer_only: true` means standard users do not see the row.
   Invariant: `developer_only: true` requires `visible_to_user: false`.

5. `user_toggleable: false` means locked for standard users.
   The row may still be shown in standard Settings if `visible_to_user: true`, but the control is disabled.

6. The registry is authoritative for metadata.
   Code outside the resolver must not redefine visibility or mutability rules ad hoc.

7. User overrides are nullable.
   Persisted storage should represent an explicit override only when the user changed a value away from the registry default. If the chosen value matches the default, the override should be removed so future default changes still apply to untouched users.

## 5. Runtime Resolution Model

### Loading model

The resolver should continue to live behind the existing global provider shape in `src/App.tsx`, but the inputs should change.

1. Load the compiled registry definitions generated from `src/lib/config/feature-flags.yaml`.
2. Read persisted user overrides for known ids through the existing `FeatureFlags` repository abstraction.
3. Read developer mode once through `developerModeStore`.
4. Build one resolved snapshot for the entire app.

This keeps the current strengths of the existing system:

- one global `FeatureFlagsProvider`
- one cross-platform persistence plugin
- one trace bridge already present in `TraceContextBridge.tsx`

The repository contract should be tightened so it represents overrides explicitly rather than raw booleans only.

Recommended interface:

```ts
interface FeatureFlagOverrideRepository {
  getAllOverrides(ids: string[]): Promise<Record<string, boolean>>;
  setOverride(id: string, value: boolean | null): Promise<void>;
}
```

`null` means "clear the explicit override and fall back to the registry default". This is the missing piece in the current `FeatureFlagRepository`, which can set booleans but cannot remove redundant stored values.

### Exact precedence rules

For each feature id:

1. Start with the registry definition from YAML.
2. Read the persisted user override, if present.
3. Compute effective enabled state:

```text
effective_enabled = user_override ?? registry.enabled
```

4. Compute effective visibility:

```text
if developer_mode_on:
  visible = true
else:
  visible = registry.visible_to_user
```

5. Compute effective editability:

```text
if developer_mode_on:
  editable = true
else:
  editable = registry.visible_to_user && registry.user_toggleable
```

### Developer mode interaction

Developer mode is a UI and mutability override, not a value override.

- Enabling developer mode does not automatically enable any feature.
- It only changes which flags are visible and whether they can be edited.
- Once developer mode is on, all known feature flags are shown in Settings and can be changed from the same section.

This is the cleanest way to satisfy the requested behavior:

- When developer mode is off, only public user-toggleable features can be modified.
- Hidden features do not appear.
- When developer mode is on, all feature flags become visible and editable.

### Read path

All code that needs a flag should read through the centralized resolver.

Recommended access patterns:

- `useFeatureFlag(id)` for a single resolved feature
- `useFeatureFlags()` for the full snapshot
- helper selectors such as `isFeatureEnabled(snapshot, "hvsc_enabled")`

Direct `localStorage`, `sessionStorage`, `UserDefaults`, or DataStore reads outside the resolver should not happen.

Concrete integration points in the current codebase:

- `src/lib/config/featureFlags.ts`
  becomes the validated registry loader plus resolver.
- `src/hooks/useFeatureFlags.tsx`
  remains the React access layer.
- `src/pages/PlayFilesPage.tsx`
  should consume `commoserve_enabled` and `hvsc_enabled` from the same resolver instead of splitting logic between `useFeatureFlags` and `useArchiveClientSettings`.
- `src/pages/HomePage.tsx`, `src/pages/PlayFilesPage.tsx`, `src/pages/DisksPage.tsx`, and `src/components/lighting/LightingStudioDialog.tsx`
  should all consult `lighting_studio_enabled` through the same resolved hook.

### Write path

All UI writes should go through one service owned by the feature flag manager.

Recommended behavior:

1. Validate that the feature id exists in the registry.
2. Validate whether the current user may edit it.
3. If the new value equals the registry default, clear the persisted override.
4. Otherwise, persist the explicit override through the `FeatureFlags` repository.
5. Emit one updated snapshot to the app.

This removes the current duplicated raw-storage write in `SettingsPage.tsx`.

Concrete write entry point:

- `src/pages/SettingsPage.tsx`
  should become a pure consumer of the unified write API.
- Legacy direct writers such as `saveCommoserveEnabled` should not be used for rollout features once migration is complete.

### Smoke/bootstrap alignment

`src/lib/smoke/smokeMode.ts` should keep its `featureFlags` field, but it should derive valid ids from the same registry source used by the runtime resolver.

Smoke mode should use the same write path as Settings:

- write explicit overrides through the feature flag repository
- refresh the global snapshot once
- avoid parallel bespoke storage logic except where the platform bootstrap path absolutely requires it

## 6. Settings Integration Design

### Dedicated section

Introduce one dedicated Settings section titled `Experimental Features`.

This replaces the current scattering where:

- HVSC lives under `HVSC`
- CommoServe lives under `Online Archive`
- Lighting Studio has no Settings presence

### Which features appear there

The section should list every registry entry whose `group` is `experimental`.

Standard mode:

- show only entries with `visible_to_user: true`

Developer mode:

- show every entry in the registry, including `developer_only` entries

### Row behavior

Each row should be driven from resolved feature metadata, not one-off page logic.

Required behaviors:

- Visible + editable:
  Render a normal toggle.

- Visible + locked:
  Render the row with a disabled toggle and explanatory helper text.

- Hidden:
  Do not render the row when developer mode is off.

- Developer mode on:
  Render all rows and make all toggles interactive.

### Recommended row metadata

Each row should display:

- `title`
- `description`
- current state
- optional badge for `Developer only` when developer mode is on

### Current features mapped into the section

- `hvsc_enabled`
  Moves out of the dedicated HVSC settings area and becomes a standard experimental feature toggle.

- `commoserve_enabled`
  Moves out of the Online Archive area and becomes a standard experimental feature toggle.

- `lighting_studio_enabled`
  New entry. Developer-only initially, with default `false`.

### Recommended implementation mapping

- The existing HVSC section in `SettingsPage.tsx` should keep mirror/base-URL operational controls only.
- The existing Online Archive section should keep host/client/user-agent overrides only.
- Boolean rollout controls for both features should move into `Experimental Features`.
- Lighting Studio should gain its first Settings presence only through `Experimental Features`, not a bespoke extra section.

### What stays outside the section

Non-boolean operational settings are not feature flags and should remain where they are.

Examples:

- HVSC base URL override
- archive host override
- archive client id override
- archive user agent override

These are configuration knobs, not rollout flags.

## 7. Migration Strategy

### Flag inventory to carry forward

#### 1. `hvsc_enabled`

- Keep the existing id exactly as-is.
- Keep the existing cross-platform repository storage.
- Enrich it with registry metadata from YAML.
- Remove the direct raw-storage duplication from `SettingsPage.tsx`.

This is a metadata migration, not a key migration.

#### 2. `commoserve_enabled`

This should become a real feature flag with a stable id of `commoserve_enabled`.

Migration rule:

1. On startup, if no feature override exists for `commoserve_enabled`:
   - read legacy `c64u_commoserve_enabled` from `appSettings.ts`
   - write that value into the feature flag repository as an explicit override only if it differs from the registry default
2. After migration, the runtime read path should use the feature flag resolver, not `loadCommoserveEnabled`
3. `loadCommoserveEnabled` / `saveCommoserveEnabled` remain temporarily as compatibility shims during rollout, then are removed once callers are migrated

#### 3. `lighting_studio_enabled`

- New flag
- No legacy migration data
- Default `false`
- Developer-only at first release of the new registry

### Settings export/import

`src/lib/config/settingsTransfer.ts` should move from per-feature bespoke fields to a dedicated feature flag block.

Recommended next payload shape:

```json
{
  "version": 2,
  "appSettings": {
    "...": "unchanged"
  },
  "featureFlags": {
    "hvsc_enabled": true,
    "commoserve_enabled": false
  },
  "deviceSafety": {
    "...": "unchanged"
  }
}
```

Migration rules:

- Import v1 payloads and map legacy `commoserveEnabled` into `commoserve_enabled`
- Ignore unknown feature ids safely
- Export only explicit user overrides, not the entire default registry

This avoids needing to change the export schema every time a new experimental flag is added.

### Smoke config

`smokeMode.ts` already supports a `featureFlags` object. It should keep that contract, but valid ids must come from the unified registry definition rather than a hand-maintained TypeScript constant.

### Deprecation of legacy patterns

The following patterns should be removed after migration:

- direct flag-specific writes to `localStorage` / `sessionStorage` in page components
- feature toggles stored in `appSettings.ts`
- feature visibility rules expressed directly in `SettingsPage.tsx`

## 8. Broader MVP-Oriented Survey

### Survey guardrails

This broader pass used a stricter filter than the earlier unification design:

- keep core remote-control workflows ungated
- prefer subsystems that are clearly additive, platform-heavy, support-oriented, or niche
- avoid flags that would force a deep architectural split or make a primary route nonsensical

Core workflows that should remain unflagged for an MVP build:

- connection and discovery
- Home machine controls
- basic Play import/playback for Local and C64U sources
- Disks mount/eject flows
- Config browsing and editing
- base Settings and password/host management

### Additional candidates worth flagging

The following areas are strong candidates because they are clearly beyond a minimum viable remote-control app and already have identifiable entry points in code.

#### Diagnostics

The diagnostics stack is extensive and support-oriented rather than essential to core control. It spans:

- `src/components/diagnostics/GlobalDiagnosticsOverlay.tsx`
- `src/components/diagnostics/DiagnosticsDialog.tsx`
- `src/components/UnifiedHealthBadge.tsx`
- `src/lib/diagnostics/`
- `src/lib/tracing/`

Recommendation:

- add `diagnostics_enabled`
- when disabled, keep only a simple connection/health badge and remove overlay entry, health checks, trace/log drill-down, and export/share surfaces

#### Built-in docs

The Docs page is a full primary tab route but is purely static product guidance:

- `src/pages/DocsPage.tsx`
- `src/lib/navigation/tabRoutes.ts`
- `src/components/TabBar.tsx`
- `src/components/SwipeNavigationLayer.tsx`

Recommendation:

- add `docs_enabled`
- when disabled, remove the `Docs` tab and route entirely

#### Device switcher

The multi-device picker is useful, but it is clearly an advanced layer above a single-device controller:

- `src/components/UnifiedHealthBadge.tsx`
- `src/components/diagnostics/ConnectionActionsRegion.tsx`
- `src/lib/savedDevices/store.ts`

Recommendation:

- add `device_switcher_enabled`
- keep the saved-device persistence model intact for now, but hide the badge long-press switcher and diagnostics switch-device affordances when the flag is off

This is lower-risk than trying to flag the entire saved-device subsystem.

#### Snapshot workflows

There are three distinct snapshot-style subsystems that are not required for basic control:

- RAM snapshots:
  - `src/pages/home/dialogs/SaveRamDialog.tsx`
  - `src/pages/home/dialogs/SnapshotManagerDialog.tsx`
  - `src/lib/snapshot/`
- REU snapshots:
  - `src/lib/reu/`
  - `src/pages/HomePage.tsx`
- app-local config snapshots:
  - `src/hooks/useAppConfigState.ts`
  - `src/lib/config/appConfigStore.ts`
  - `src/lib/config/configSnapshotStorage.ts`

Recommendations:

- add `memory_snapshots_enabled` for Save RAM / Load RAM / snapshot manager workflows
- add `reu_snapshots_enabled` for the REU-specific extension on top of memory snapshots
- add `app_config_snapshots_enabled` for local app-config save/load/manage flows while leaving device flash save/load intact

These are strong candidates because they are complex, stateful, and partly platform-dependent, yet hiding them does not break the rest of Home.

#### Streams

UDP stream controls are niche and isolated:

- `src/pages/home/components/StreamStatus.tsx`
- `src/pages/home/hooks/useStreamData.ts`
- `src/lib/config/homeStreams.ts`
- `src/lib/c64api.ts` stream endpoints

Recommendation:

- add `stream_controls_enabled`
- when disabled, hide the entire Streams section on Home

#### Existing archive and lighting candidates

The existing shortlist remains valid after the broader survey:

- `hvsc_enabled`
- `commoserve_enabled`
- `lighting_studio_enabled`

HVSC and CommoServe are optional content sources, while Lighting Studio is a secondary automation/editor surface layered over core lighting-related config.

### Areas reviewed but not recommended for first-wave flagging

- `demo_mode_enabled`
  Not recommended first. Demo mode is deeply integrated into `src/lib/connection/connectionManager.ts` as a first-class connection state, so flagging it is possible but not a low-risk first step.

- `saved_devices_enabled`
  Not recommended first. The saved-device model already underpins host, ports, password metadata, and playback/device attribution. Flagging the UI switcher is much cheaper than flagging the whole persistence model.

- `open_source_licenses_enabled`
  Not recommended. The licenses route is compliance-oriented rather than an optional product capability.

- `coverage_probe_enabled`
  Not relevant here. The coverage probe is already build/test gated and is not a production feature.

- base connection, Config, Disks, and primary playback
  These are core to the app’s value proposition and should remain unflagged for an MVP-capable build.

### Consolidated recommended table

| Internal ID / Property | Public Name | Scope When Enabled | What Gets Hidden or Disabled When Off | Settings Visibility |
| --- | --- | --- | --- | --- |
| `hvsc_enabled` | HVSC downloads | HVSC source, download, ingest, browse, and lifecycle controls on Play | HVSC source and HVSC lifecycle UI are removed; basic Local/C64U playback remains | Everyone |
| `commoserve_enabled` | CommoServe | Online archive source and related Add Items / Online Archive flows | CommoServe source and archive search UI are removed; local and C64U sources remain | Everyone |
| `lighting_studio_enabled` | Lighting Studio | Lighting Studio entry points, dialog, and automation/editor workflows | Lighting Studio launch points and secondary automation/editor surface are removed; regular config-based lighting still works | Developer mode only |
| `diagnostics_enabled` | Diagnostics | Diagnostics overlay, health checks, trace/log drill-down, export/share, and support tooling | Diagnostics overlay and advanced support tooling are removed; a simpler passive connection badge should remain | Developer mode only |
| `docs_enabled` | Built-in docs | `Docs` tab and static in-app documentation route | Docs tab and route are removed; external README/site docs can remain outside the app | Developer mode only |
| `device_switcher_enabled` | Switch device | Badge long-press switcher and diagnostics switch-device workflows | Multi-device picker and switcher UI are hidden; standard single-target connection editing in Settings remains | Developer mode only |
| `memory_snapshots_enabled` | RAM snapshots | Save RAM, Load RAM, and snapshot-manager workflows on Home | RAM snapshot dialogs and manager are removed; machine controls and config editing remain | Developer mode only |
| `reu_snapshots_enabled` | REU snapshots | Save REU, REU snapshot storage, restore, and preload workflows | REU-specific snapshot actions and dialogs are removed; non-REU Home controls remain | Developer mode only |
| `app_config_snapshots_enabled` | App config snapshots | Save/load/revert/manage app-local config snapshots and config snapshot file workflows | Local app-config snapshot workflows are removed; device flash save/load/reset remains | Developer mode only |
| `stream_controls_enabled` | UDP streams | Home-page stream target editing and stream start/stop controls | Streams section is removed from Home; other device controls remain | Developer mode only |

## 9. Risks and Trade-offs

### Complexity vs flexibility

Adding metadata and migration rules is more complex than the current one-boolean registry, but the app already needs those semantics. The complexity is justified because it replaces several competing mechanisms with one explicit model.

### Misconfiguration risk

A bad registry entry could hide or expose the wrong feature. This is why the YAML must be validated at build time, with invariants such as:

- no duplicate ids
- `developer_only: true` implies `visible_to_user: false`
- all referenced groups exist

### Debuggability

The current app already records feature flags in trace context through `TraceContextBridge.tsx`. The unified resolver improves debuggability because every feature now has one resolved value and one source of truth. The remaining improvement to consider during implementation is tagging whether the value came from the default or an explicit override.

### Runtime overhead

Parsing YAML at runtime would be unnecessary overhead. The design avoids that by treating YAML as an authored source that is transformed at build time into a plain runtime object.

### Backward-compatibility cost

`commoserveEnabled` is the main migration risk because it currently lives in settings export/import and in general app settings. That is manageable because the legacy key is simple and boolean.

## 10. Open Questions

None. This document intentionally makes one concrete recommendation set:

- authoritative YAML registry at `src/lib/config/feature-flags.yaml`
- existing plugin-backed persistence as the override store
- developer mode as a visibility/editability override only
- one `Experimental Features` Settings section
- initial managed feature set of `hvsc_enabled`, `commoserve_enabled`, and `lighting_studio_enabled`, with the broader survey above defining the next wave of high-value add-on candidates
