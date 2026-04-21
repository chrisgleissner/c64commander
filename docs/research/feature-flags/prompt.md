# Feature Flag Unification Implementation Prompt

Date: 2026-04-18
Type: Strict execution prompt
Primary inputs:

- [feature-flags.md](./feature-flags.md)
- [plan.md](./plan.md)

Expected change classification: `DOC_PLUS_CODE`, `UI_CHANGE`

## Role

You are the implementation engineer responsible for shipping the feature-flag unification described in [feature-flags.md](./feature-flags.md).

This is not a research pass.
This is not a partial scaffold pass.
This is not permission to widen the feature inventory.

You must implement the new feature-flag architecture end to end by following [plan.md](./plan.md), then validate the result honestly.

## Objective

Replace the current split feature-toggle behavior with one registry-driven system that works the same way on web, Android, and iOS.

The implementation must:

- use `src/lib/config/feature-flags.yaml` as the only authored feature registry
- compile that YAML into runtime TypeScript data at build time
- resolve effective feature values from registry defaults plus persisted overrides
- let developer mode change visibility and editability only
- move user-facing feature toggles into one `Experimental Features` section in Settings
- migrate `commoserveEnabled` into `commoserve_enabled`
- add `lighting_studio_enabled` as a developer-only feature
- remove ad hoc raw storage writes and bespoke feature gating logic

## Authoritative Inputs

Read these before editing:

- `README.md`
- `.github/copilot-instructions.md`
- `docs/ux-guidelines.md`
- [feature-flags.md](./feature-flags.md)
- [plan.md](./plan.md)

Then read the smallest relevant set of implementation files in:

- `src/lib/config/`
- `src/hooks/useFeatureFlags.tsx`
- `src/lib/native/featureFlags.ts`
- `src/lib/native/featureFlags.web.ts`
- `android/app/src/main/java/uk/gleissner/c64commander/FeatureFlagsPlugin.kt`
- `android/app/src/test/java/uk/gleissner/c64commander/FeatureFlagsPluginTest.kt`
- `ios/App/App/AppDelegate.swift`
- `src/pages/SettingsPage.tsx`
- `src/pages/PlayFilesPage.tsx`
- `src/pages/HomePage.tsx`
- `src/pages/DisksPage.tsx`
- `src/pages/playFiles/hooks/useArchiveClientSettings.ts`
- `src/hooks/useLightingStudio.tsx`
- `src/components/lighting/LightingStudioDialog.tsx`
- `src/components/TraceContextBridge.tsx`
- `src/lib/smoke/smokeMode.ts`
- `src/lib/config/settingsTransfer.ts`
- the directly relevant tests listed in [plan.md](./plan.md)

## Non-Negotiable Rules

1. [feature-flags.md](./feature-flags.md) is the source of truth for behavior.
2. [plan.md](./plan.md) is the source of truth for sequencing.
3. Do not parse YAML dynamically on-device at runtime.
4. Do not leave `FEATURE_FLAG_DEFINITIONS` as a hand-maintained source of truth once the registry lands.
5. Do not keep direct `localStorage` or `sessionStorage` writes in page components for feature flags.
6. Do not make developer mode silently force-enable hidden features.
7. Do not leave `commoserveEnabled` as a first-class rollout setting in `appSettings.ts`.
8. Do not duplicate feature visibility or editability rules in `SettingsPage.tsx`.
9. Do not silently swallow exceptions.
10. Every bug fix or migration edge case discovered during implementation must get a targeted regression test.
11. Do not claim tests, builds, or screenshot updates you did not actually run.
12. Do not implement the broader future-wave candidate flags in section 8 of the spec during this task.

## Required End State

Your implementation is only complete when all of the following are true:

- `src/lib/config/feature-flags.yaml` exists and is the only authored registry
- the YAML is validated and compiled into runtime TypeScript data before the app consumes it
- the registry contains:
  - `hvsc_enabled`
  - `commoserve_enabled`
  - `lighting_studio_enabled`
- the runtime resolver applies:
  - registry defaults
  - persisted overrides
  - developer-mode visibility and editability rules
- the write path clears explicit overrides when the chosen value matches the registry default
- `hvsc_enabled` keeps its existing persisted identity
- `commoserve_enabled` migrates from legacy `commoserveEnabled` storage when no override exists yet
- `lighting_studio_enabled` defaults to off and is developer-only
- Settings has one `Experimental Features` section driven by registry metadata
- the old HVSC raw storage duplication is removed from `SettingsPage.tsx`
- CommoServe archive behavior is driven by the unified feature flag resolver, not `loadCommoserveEnabled`
- Lighting Studio entry points and dialog access are gated by `lighting_studio_enabled`
- smoke mode validates feature ids against the unified registry and applies feature changes through the same persistence path
- trace context receives the unified resolved feature snapshot
- settings export/import use a dedicated `featureFlags` block and export only explicit overrides
- legacy settings import remains compatible

## Required Architectural Decisions

Implement these decisions directly. Do not leave them as open questions.

### Registry compilation

- Use a build-time validation and compilation path, not runtime YAML parsing.
- The generated output may be committed or regenerated as part of build workflows, but it must be reproducible and non-authoritative.
- Validation must fail on duplicate ids, invalid groups, invalid field types, and invalid developer-only visibility combinations.

### Resolver model

- Keep one manager or resolver as the single owner of:
  - effective enabled state
  - visibility
  - editability
  - write semantics
- Developer mode must affect only visibility and editability.
- Effective flag value must resolve as:
  - override if present
  - otherwise registry default

### Persistence model

- The persistence layer must support clearing overrides explicitly.
- Matching-default values must remove the stored override instead of persisting redundant data.
- Platform implementations must stay aligned across web, Android, and iOS.

### Settings model

- The only user-facing feature-toggle surface is `Experimental Features`.
- HVSC mirror and archive host or client overrides remain outside feature flags.
- Developer mode must reveal all known feature rows and make them editable.

### Migration model

- `commoserve_enabled` must migrate from the legacy `appSettings` boolean only when no explicit feature override exists.
- Import v1 settings payloads by mapping legacy `commoserveEnabled` into `commoserve_enabled`.
- Export only explicit feature overrides in the new payload.

## Execution Model

Implement in the phases defined in [plan.md](./plan.md).

Minimum expected order:

1. YAML registry and build-time compilation
2. override repository and resolver semantics
3. legacy migration and settings-transfer convergence
4. Settings UI convergence
5. consumer migration and gating
6. smoke and trace alignment
7. validation and screenshot closure

Do not jump ahead to the Settings UI before the registry and resolver semantics are correct.

## Required Tests and Regression Coverage

Your final implementation must include targeted coverage for:

- registry validation and duplicate-id handling
- resolver precedence between defaults, overrides, and developer mode
- clear-override behavior when a chosen value matches the registry default
- legacy `commoserveEnabled` migration
- v1 settings import compatibility
- v2 settings export/import with explicit overrides only
- Settings rendering in normal mode
- Settings rendering in developer mode
- removal of direct HVSC raw-storage duplication from `SettingsPage.tsx`
- CommoServe gating through the unified flag model
- Lighting Studio hidden by default
- Lighting Studio visible and usable when the feature is enabled
- smoke config alignment with the registry
- trace context alignment with the resolved feature snapshot

Add or update the narrowest deterministic tests in the relevant suites, including:

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
- `android/app/src/test/java/uk/gleissner/c64commander/FeatureFlagsPluginTest.kt` if Android bridge behavior changes

## Required Validation

Because this task changes executable behavior, the final validation must include:

- `npm run lint`
- `npm run test`
- `npm run test:coverage`
- `npm run build`

Also run the smallest honest additional validation needed to prove:

- the `Experimental Features` section renders correctly
- developer mode reveals developer-only features
- Lighting Studio is hidden by default and appears only when enabled
- CommoServe and HVSC visibility still behaves correctly on Play and Settings
- the override-clearing path works across the repository abstraction

Run `cd android && ./gradlew test` if the Android plugin implementation changes in a way that is not already fully covered by the existing web and unit validation.

If visible documented UI changes, refresh only the smallest affected screenshot subsets under:

- `docs/img/app/settings/**`
- `docs/img/app/home/**`
- `docs/img/app/play/**`
- `docs/img/app/disks/**`

## Output Requirements

At completion, report:

- what changed
- which phases from [plan.md](./plan.md) were completed
- which tests and builds were run
- whether screenshots were updated
- any remaining known risk or follow-up item

## Failure Rules

Stop and report a blocker instead of guessing if:

- the current build setup cannot support a reliable build-time YAML compilation path without a wider tooling decision
- the native persistence bridge cannot clear overrides without a broader platform-storage redesign
- the existing settings import/export contract cannot preserve backward compatibility safely
- Lighting Studio is wired deeply enough that gating it would require a much larger architectural split than the spec assumes
- there is a conflict between the spec and current shipped behavior that requires a product decision rather than an engineering decision
