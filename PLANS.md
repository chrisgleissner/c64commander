# HVSC Download + Ingestion Regression Elimination Plan

## Scope

This plan is the authoritative execution tracker for eliminating HVSC ingestion regressions and enforcing low-RAM CI barriers.

## Root Cause Analysis

### Prior crash: OOM on Base64 bridge path

- HVSC archive bytes crossed the Capacitor bridge via `Filesystem.readFile()` as Base64.
- On constrained devices this multiplied memory use (`byte[]` + Base64 string + JS decode copies), causing deterministic heap exhaustion.

### Current crash: `NoClassDefFoundError` for `org.tukaani.xz.LZMA2Options`

- Native ingestion uses `org.apache.commons.compress.archivers.sevenz.SevenZFile`.
- SevenZ decoder requires XZ classes at runtime (`org.tukaani.xz.*`) for LZMA/LZMA2 handling.
- The app had no explicit `org.tukaani:xz` dependency and no shrinker keep rules for SevenZ/XZ classes, creating runtime class resolution risk.

## File-level Changes

- `android/app/build.gradle`
  - Add explicit `implementation "org.tukaani:xz:1.10"`.
  - Add `minifiedDebug` build type (`minifyEnabled true`) so CI can enforce shrinker/runtime checks on a minified variant.
  - Add compile-only annotation deps needed by R8 in the minified variant.
- `android/app/proguard-rules.pro`
  - Add keep rules:
    - `org.tukaani.xz.**`
    - `org.apache.commons.compress.archivers.sevenz.**`
- `android/app/src/test/java/uk/gleissner/c64commander/HvscSevenZipRuntimeTest.kt`
  - Add regression tests:
    - hard runtime class load check (`Class.forName("org.tukaani.xz.LZMA2Options")`)
    - open and enumerate `.7z` fixture using `SevenZFile`
- `android/app/src/test/fixtures/HVSC_LZMA2_tiny.7z`
  - Add tiny deterministic LZMA2 fixture for SevenZ runtime regression tests.
- `android/app/src/main/java/uk/gleissner/c64commander/HvscIngestionPlugin.kt`
  - Add explicit XZ class anchor (`LZMA2Options::class.java`) and runtime guard before SevenZ ingestion.
- `scripts/verify-android-apk-lzma2.sh`
  - Add CI gate script to scan APK DEX payload for:
    - `org.tukaani.xz.LZMA2Options`
    - `org.apache.commons.compress.archivers.sevenz.SevenZFile`
- `.github/workflows/android.yaml`
  - Add dependency graph inspection and dependency insight for XZ.
  - Build `debug` and `minifiedDebug` APKs in CI.
  - Verify required SevenZ/XZ classes are present in APK DEX.
  - Print constrained AVD config readback from `config.ini`.
  - Assert `adb shell getprop ro.config.low_ram` is `true/1` and fail otherwise.
  - Assert startup memory class log exists after Maestro gating.
- `scripts/run-maestro-gating.sh`
  - Enforce low-RAM runtime property check in CI before Maestro run.
  - Include `.maestro/smoke-hvsc-lowram.yaml` in CI flow set.
  - Assert `smoke-hvsc-lowram` appears in Maestro JUnit report.
- `src/lib/hvsc/hvscBridgeGuards.test.ts`
  - Add guard test forbidding direct `Filesystem.readFile(` usage inside `hvscIngestionRuntime.ts`.

## Risk List + Mitigations

- Risk: shrinker strips optional decoder classes.
  - Mitigation: explicit keep rules + minified variant build + APK DEX class scan in CI.
- Risk: missing XZ transitive dependency goes unnoticed.
  - Mitigation: explicit dependency + runtime class-load unit test + dependencyInsight output in CI.
- Risk: constrained emulator profile drifts from intended settings.
  - Mitigation: deterministic `config.ini` rewrite + readback logging + runtime low-ram property assertion.
- Risk: HVSC gating silently excludes low-ram flow.
  - Mitigation: explicit CI flow file list + required flow assertion against Maestro report.

## CI Enforcement

- Runtime class presence in APK DEX is now a hard gate for `debug` and `minifiedDebug` APKs.
- Low-RAM mode (`ro.config.low_ram`) is now a hard gate in Android Maestro CI.
- Low-RAM HVSC Maestro flow is now mandatory in CI report validation.
- Memory class logging from `MainActivity` is now asserted in CI logcat.

## Verification Checklist

### Local reproduction + verification commands

1. `npm ci`
2. `npm run cap:build`
3. `cd android && ./gradlew :app:dependencies --configuration debugRuntimeClasspath`
4. `cd android && ./gradlew :app:dependencyInsight --dependency xz --configuration debugRuntimeClasspath`
5. `cd android && ./gradlew :app:testDebugUnitTest`
6. `cd android && ./gradlew :app:assembleDebug :app:assembleMinifiedDebug`
7. `bash scripts/verify-android-apk-lzma2.sh android/app/build/outputs/apk/debug/*.apk android/app/build/outputs/apk/minifiedDebug/*.apk`
8. `npm run lint`
9. `npm run test`
10. `npm run test:coverage`
11. `npm run build`
12. `./build`

### Expected outputs

- Dependency insight lists `org.tukaani:xz` in `debugRuntimeClasspath`.
- `HvscSevenZipRuntimeTest` passes and `Class.forName("org.tukaani.xz.LZMA2Options")` succeeds.
- APK verification script prints `OK: required SevenZ/XZ runtime classes found` for both APK variants.
- Maestro CI logs show:
  - AVD config values (`hw.ramSize=512`, `vm.heapSize=128`, `hw.cpu.ncore=1`, `hw.device.lowram=yes`)
  - `ro.config.low_ram=true` (or `1`)
  - required flow `smoke-hvsc-lowram` present in report.

## Execution Status

- [x] Add explicit XZ dependency
- [x] Add shrinker keep rules for XZ + SevenZ
- [x] Add runtime class + SevenZ fixture regression tests
- [x] Add APK DEX class verification gate script
- [x] Add CI minified variant build + class checks
- [x] Enforce low-RAM property in Maestro CI
- [x] Require low-RAM HVSC Maestro flow in CI gate
- [x] Add grep-style guard against direct HVSC runtime `Filesystem.readFile`
- [x] Run full verification suite and capture outcomes below

## Verification Evidence

- `npm ci` ✅
- `npm run cap:build` ✅
- `cd android && ./gradlew :app:dependencies --configuration debugRuntimeClasspath` ✅
- `cd android && ./gradlew :app:dependencyInsight --dependency xz --configuration debugRuntimeClasspath` ✅
- `cd android && ./gradlew :app:testDebugUnitTest` ✅ (includes `HvscSevenZipRuntimeTest`)
- `cd android && ./gradlew :app:assembleDebug :app:assembleMinifiedDebug` ✅
- `bash scripts/verify-android-apk-lzma2.sh android/app/build/outputs/apk/debug/*.apk android/app/build/outputs/apk/minifiedDebug/*.apk` ✅
- `npm run lint` ✅
- `npm run test` ✅ (`195` files, `1480` tests passed)
- `npm run test:coverage` ✅ (global branch coverage measured from `coverage/coverage-final.json`: `80.12%`, raw `6841/8538`)
- `npm run build` ✅
- `./build` ✅
