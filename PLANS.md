# Plan

## Classification

- `DOC_ONLY`

## Objective

Extend the feature-flag research with a broader codebase survey of non-MVP, somewhat brittle, or deployment-specific add-on capabilities that are reasonable candidates for feature flags, then fold those recommendations into the existing design document.

## Impact Map

- Documentation:
  - `PLANS.md`
  - `docs/research/feature-flags/feature-flags.md`
- Read-only analysis targets:
  - `src/lib/config/featureFlags.ts`
  - `src/hooks/useFeatureFlags.tsx`
  - `src/lib/config/appSettings.ts`
  - `src/lib/config/developerModeStore.ts`
  - `src/hooks/useDeveloperMode.ts`
  - `src/pages/SettingsPage.tsx`
  - `src/pages/PlayFilesPage.tsx`
  - `src/pages/playFiles/hooks/useArchiveClientSettings.ts`
  - `src/components/TraceContextBridge.tsx`
  - `src/lib/smoke/smokeMode.ts`
  - `src/lib/native/featureFlags.ts`
  - `src/lib/native/featureFlags.web.ts`
  - `android/app/src/main/java/uk/gleissner/c64commander/FeatureFlagsPlugin.kt`
  - `ios/App/App/AppDelegate.swift`

## Findings

- The current feature flag registry in `src/lib/config/featureFlags.ts` contains only `hvsc_enabled` and stores only `defaultValue`.
- Runtime feature flag persistence is already cross-platform through the Capacitor `FeatureFlags` plugin:
  - Android DataStore in `android/app/src/main/java/uk/gleissner/c64commander/FeatureFlagsPlugin.kt`
  - iOS `UserDefaults` in `ios/App/App/AppDelegate.swift`
  - Web `localStorage` / `sessionStorage` in `src/lib/native/featureFlags.web.ts`
- `FeatureFlagsProvider` is already global in `src/App.tsx`, so the app has a natural integration point for a unified resolver.
- `commoserveEnabled` is not in the feature flag system. It lives in general app settings in `src/lib/config/appSettings.ts`, is consumed through `useArchiveClientSettings`, and is exported/imported through `src/lib/config/settingsTransfer.ts`.
- `SettingsPage.tsx` manually writes `hvsc_enabled` to storage after calling the feature flag hook, which duplicates persistence responsibility instead of routing writes through one service.
- Developer mode is isolated in `src/lib/config/developerModeStore.ts` and `src/hooks/useDeveloperMode.ts`; it currently unlocks only specific settings UI fragments and has no formal relationship to feature flag visibility or mutability.
- Lighting Studio is not feature-gated today. Its hooks and dialog are mounted directly from app pages/components.
- Trace capture already records feature flag values via `src/components/TraceContextBridge.tsx`.
- Smoke/bootstrap support already understands `featureFlags` through `src/lib/smoke/smokeMode.ts`, but it is keyed only from the current `FEATURE_FLAG_DEFINITIONS`.
- Broader survey results:
  - strong add-on candidates: diagnostics, built-in docs, device switcher, RAM/REU/app-config snapshot workflows, and stream controls
  - retained existing candidates: HVSC, CommoServe, Lighting Studio
  - explicitly not recommended for first-wave flagging: demo mode, the full saved-device persistence model, open-source licenses, coverage probe, and core connection/config/playback/disk flows

## Task Breakdown

- [x] Read repository guidance and classify the task correctly
- [x] Inspect current feature flag storage, settings storage, and developer mode wiring
- [x] Survey broader routed pages and optional subsystems for non-MVP flag candidates
- [x] Decide the target central configuration format and schema
- [x] Define runtime resolution, visibility, and mutability semantics
- [x] Define Settings integration and migration strategy
- [x] Extend `docs/research/feature-flags/feature-flags.md`
- [x] Add the consolidated feature-flag recommendation table
- [x] Review the document for consistency and remove placeholders

## Validation

- `DOC_ONLY`: verified by document review only
- No build, test, or screenshot steps were run because no executable files changed

## Completion Tracking

- [x] `PLANS.md` reflects the current task
- [x] `docs/research/feature-flags/feature-flags.md` exists
- [x] All required sections are present
- [x] No TODOs or unresolved placeholders remain
- [x] No code changes were made

## Follow-up TODOs

- Introduce `stable` feature group and reclassify existing flags:
  - add `stable` group metadata to `src/lib/config/feature-flags.yaml`
  - reclassify `hvsc_enabled` and `commoserve_enabled` to `stable`
  - keep `lighting_studio_enabled` in `experimental`
  - regenerate `src/lib/config/featureFlagsRegistry.generated.ts`
  - validate compile-time invariants and grouped Settings rendering order (`Stable` before `Experimental`)
  - run tests and verify no regressions
- Make feature flags default to enabled in nearly all tests:
  - create a shared test default where all feature flags are enabled unless a test explicitly covers feature-flag behavior or hidden gated UX
  - minimize per-file ad hoc `useFeatureFlag` mocks by centralizing the default test harness
  - keep explicit opt-out coverage for tests that verify feature gating, visibility, or the feature-flag mechanism itself
