# PLANS.md - Full Green Gates Execution

## Goal
Achieve green local build, tests, screenshots, and CI for the C64 Commander Android app without skipping or weakening any tests.

## Non-negotiables
- Follow ./build exactly as the authoritative local pipeline.
- Do not disable, skip, or relax any test.
- Fix root causes and re-run affected phases.

## Execution Plan

### 1) Environment Validation
- [x] Capture toolchain versions: `node -v`, `npm -v`, `java -version`, `./android/gradlew --version`.
- [x] Confirm Android SDK + emulator availability (if required): `adb version`, `adb devices` (no devices attached).
- [x] Confirm Playwright dependencies: `npx playwright install` (installed after `--check` failed).
- [x] Confirm Maestro gating command: `npm run maestro:gating` (see `doc/testing/maestro.md`).

### 2) Local Build Phase (Authoritative)
- [x] Run `./build` (default pipeline: install, format, cap build, unit tests, Playwright E2E without screenshots, Android JVM tests, debug APK).
- [x] Verify outputs: `dist/` exists, Android debug APK generated, no errors.

### 3) Test Phases
- [x] Unit tests: `npm test` (already included in `./build`; re-run only if needed after fixes).
- [x] Playwright E2E: `npx playwright test --grep-invert @screenshots` (already included in `./build`).
- [x] Android JVM tests: `cd android && ./gradlew test` (already included in `./build`).
- [ ] Maestro tests: `npm run maestro:gating`.

### 4) Screenshot Regeneration
- [ ] Run `./build --screenshots` to regenerate `doc/img` screenshots.
- [ ] Verify screenshot artifacts are updated and deterministic.

### 5) CI Phase
- [ ] Push changes to the current branch.
- [ ] Trigger CI and confirm all jobs are green.
- [ ] If CI fails, record failure, fix root cause, and rerun the affected phase locally before retriggering CI.

### 6) Completion Gates
- [ ] Local `./build` is green.
- [ ] Unit, Playwright, Android JVM, and Maestro tests are green.
- [ ] Screenshots regenerated and validated.
- [ ] CI pipeline is fully green.

## Failure Handling
- [ ] Record failure details and logs here.
- [x] 2026-02-06: `npx playwright install --check` failed with "unknown option --check". Installed browsers via `npx playwright install`.
- [x] 2026-02-06: `./build` failed during `npm test` with `SecurityError: localStorage is not available for opaque origins` in `tests/unit/c64api.test.ts` and `tests/unit/playFiles/useSonglengthsHook.test.tsx`.
- [x] 2026-02-06: Fixed JSDOM localStorage setup to avoid opaque-origin errors in `tests/setup.ts`.
- [x] 2026-02-06: `./build` failed during `npm test` with `ReferenceError: MouseEvent is not defined` in `tests/setup.ts`.
- [x] 2026-02-06: Added MouseEvent polyfill before PointerEvent in `tests/setup.ts`.
- [x] 2026-02-06: `./build` failed during `npm test` with `FormData.append: Expected value ("Blob {}") to be an instance of Blob` in `tests/unit/c64api.test.ts`.
- [x] 2026-02-06: Avoided overriding Node's global `Blob` to keep `FormData`/`Blob` instances compatible in `tests/setup.ts`.
- [x] 2026-02-06: `./build` failed during Playwright E2E with `debug logging toggle records REST calls` expecting `DEBUG` but UI rendered `DBG` in diagnostics logs.
- [x] 2026-02-06: Updated diagnostics log label to `DEBUG` in `src/pages/SettingsPage.tsx`.
- [x] 2026-02-06: `./build` Playwright E2E failed due to port 4173 already in use. Stopped the blocking process and re-ran.
- [ ] Re-run only the failing phase, then re-run `./build` if required.

## Execution Log
- [x] Environment validation started.
- [x] Local build started.
- [x] Tests started.
- [ ] Screenshots started.
- [ ] CI started.
