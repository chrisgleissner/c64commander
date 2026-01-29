# Android emulator test structure review

## Current test layout (observed)

### Playwright (E2E)
- Top-level folder: [playwright/](../../playwright)
- Contents: spec files (`*.spec.ts`), helper utilities, fixtures, and coverage/evidence tooling.
- Evidence output: `test-results/evidence/playwright/...`

### Unit + integration
- Folder: [tests/](../../tests)
  - [tests/unit/](../../tests/unit) — Vitest unit specs
  - [tests/helpers/](../../tests/helpers) — unit test helpers
  - [tests/mocks/](../../tests/mocks) — unit test mocks
  - [tests/setup.ts](../../tests/setup.ts) — unit test bootstrap

### Playwright fixtures
- Folder: [playwright/fixtures/](../../playwright/fixtures)

### Android runtime + JVM tests
- Folder: [android/app/src/test/](../../android/app/src/test) — JVM unit tests
- Fixtures: [android/app/src/test/fixtures/](../../android/app/src/test/fixtures)

### Scripts and tooling
- Android emulator smoke entrypoint: [scripts/smoke-android-emulator.sh](../../scripts/smoke-android-emulator.sh)
- Maestro flows: [.maestro/](../../.maestro)
- Build orchestration: [local-build.sh](../../local-build.sh)

## Assessment: consistency and tradeoffs

### What’s good
- **Top-level Playwright folder is standard.** Playwright’s own docs and many repos keep a dedicated `playwright/` folder.
- **Unit tests are separated in `tests/`**, which is common and predictable for Vitest/Jest.
- **Android JVM tests live under `android/`** where Gradle expects them.
- **Fixtures live near their consumers** (Playwright fixtures under `playwright/fixtures`, JVM fixtures under `android/app/src/test/fixtures`).

### Potential inconsistencies
- **Two top-level test roots** (`playwright/` and `tests/`) can feel fragmented without a clear guideline.
- **Android emulator tests currently live only as a script**, not alongside other tests.
- **Evidence paths differ by runner** (Playwright vs emulator). This is good separation but needs explicit documentation and validation rules.

## Android emulator test layout (Maestro)

Keep `playwright/` as-is (it’s standard), keep `tests/` for Vitest unit tests, and use Maestro flows under `.maestro/` for emulator smoke tests.

Required structure:

```
/.maestro/
  config.yaml              # Maestro configuration with output paths and retry settings
  smoke-launch.yaml        # Basic app launch and navigation smoke test
  smoke-file-picker.yaml   # File picker integration test
  smoke-playback.yaml      # Playback UI readiness test
  smoke-local-playback.yaml # Local file source playback test
  smoke-hvsc.yaml          # HVSC (High Voltage SID Collection) source test
  subflows/
    launch-and-wait.yaml   # Reusable app launch subflow
    common-navigation.yaml # Reusable navigation verification subflow
```

### Why this works
- **Idiomatic Maestro usage**: flows are YAML, subflows are reusable and non-runnable.
- **Simple entrypoint**: the shell runner stays in `scripts/` and invokes `maestro test .maestro`.
- **Clear boundaries**: `.maestro/` holds UI logic only; shell/Node scripts handle setup and evidence projection.

## Evidence alignment

Continue to separate evidence by runner with a two-phase model:
- Raw Maestro output: `test-results/maestro/...`
- Curated evidence: `test-results/evidence/maestro/...`

This avoids collisions and allows different capture formats while keeping a single evidence root.

## Actionable extension plan

1. Add a new flow under `.maestro/` with a descriptive name.
2. Use subflows for shared navigation or launch steps.
3. Ensure each flow takes screenshots for evidence.
4. Update [doc/developer.md](../developer.md) if the flow adds new prerequisites.

## New test flows (Android device-sourced songs)

Added flows specifically targeting playback from Android device local storage:

- **smoke-local-playback.yaml**: Tests the "This device" source selection flow, verifying local file picker integration and navigation back to the playlist.
- **smoke-hvsc.yaml**: Tests the HVSC (High Voltage SID Collection) source selection flow for browsing the C64 music library.

These flows complement the existing smoke tests by specifically targeting high-value user workflows around local file playback and HVSC library browsing, which are critical differentiators for the Android app experience.

## Summary

Playwright remains web-only, Vitest remains under `tests/`, and Android emulator smoke tests are now Maestro flows in `.maestro/`. This keeps UI automation idiomatic, avoids custom harnesses, and integrates with the two-phase evidence pipeline.
