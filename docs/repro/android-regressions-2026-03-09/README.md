# Android regression remediation proof

Date: 2026-03-09
Branch: `fix/remote-playback`
Repository: `c64commander`

## Scope

This note records the root cause, fix, and available proof for five Android regression groups:

1. FTP import from a real C64 Ultimate times out during listing.
2. Local Android binary upload/playback mishandles non-SID files such as `d64`, `prg`, and `crt`.
3. HVSC large-archive ingestion fails after download.
4. Playlist import can be lost on in-app navigation.
5. HVSC full-library import throughput degrades over time.

## Root cause and fix summary

### 1. FTP listing timeout against C64U

Root cause:

- Android FTP listing preferred `MLSD`/`MLST` first.
- Real C64U behavior can stall on that capability probe until the plugin timeout expires.
- The timeout was 8000 ms, so each directory browse could block before falling back to LIST.

Fix:

- [android/app/src/main/java/uk/gleissner/c64commander/FtpClientPlugin.kt](android/app/src/main/java/uk/gleissner/c64commander/FtpClientPlugin.kt) now tries `LIST` first.
- `MLSD` fallback is retained only when LIST is empty or throws.
- Native regression coverage was updated in [android/app/src/test/java/uk/gleissner/c64commander/FtpClientPluginTest.kt](android/app/src/test/java/uk/gleissner/c64commander/FtpClientPluginTest.kt).

### 2. Local non-SID binary upload corruption risk

Root cause:

- SID upload already used multipart form transport.
- Other local binary uploads posted raw `Blob` bodies through `fetch`.
- That path was not aligned with the working SID upload route and was the most plausible source of platform-specific binary transport issues.

Fix:

- [src/lib/c64api.ts](src/lib/c64api.ts) now converts raw binary upload payloads to `ArrayBuffer` before request dispatch.
- SID upload remains multipart and unchanged.
- Coverage added in [src/lib/c64api.test.ts](src/lib/c64api.test.ts).

### 3. HVSC large-archive ingestion failure

Root cause:

- The fallback path in [src/lib/hvsc/hvscDownload.ts](src/lib/hvsc/hvscDownload.ts) depended on `readArchiveBuffer()`.
- That helper intentionally rejects reads above the bridge guard threshold.
- Large cached HVSC archives therefore failed on the fallback route.

Fix:

- Added native chunk reads in [android/app/src/main/java/uk/gleissner/c64commander/HvscIngestionPlugin.kt](android/app/src/main/java/uk/gleissner/c64commander/HvscIngestionPlugin.kt).
- Exposed the bridge in [src/lib/native/hvscIngestion.ts](src/lib/native/hvscIngestion.ts).
- Updated [src/lib/hvsc/hvscDownload.ts](src/lib/hvsc/hvscDownload.ts) to assemble large archives from native chunks instead of requesting a guarded whole-file bridge read.
- Added Android coverage in [android/app/src/test/java/uk/gleissner/c64commander/HvscIngestionPluginTest.kt](android/app/src/test/java/uk/gleissner/c64commander/HvscIngestionPluginTest.kt).

### 4. Playlist import lost on navigation

Root cause:

- Import progress was owned by the Play page component.
- There was no route confirmation when a user navigated away during active import work.
- Unmounting the page could tear down in-flight import state.

Fix:

- Added a shared navigation-guard registry in [src/lib/navigation/navigationGuards.ts](src/lib/navigation/navigationGuards.ts).
- [src/App.tsx](src/App.tsx) now installs a router-level blocker so guarded transitions are enforced for all in-app route changes.
- [src/pages/PlayFilesPage.tsx](src/pages/PlayFilesPage.tsx) registers the guard only while imports are active and also adds `beforeunload` protection.
- Coverage added in [src/lib/navigation/navigationGuards.test.ts](src/lib/navigation/navigationGuards.test.ts).

### 5. HVSC import throughput degradation

Root cause:

- Bulk enrichment repeatedly paid fallback resolution cost during songlength processing.
- That cost is avoidable during import because path-based resolution is the primary expected hit.
- Long runs also benefited from cooperative yielding to keep the UI responsive.

Fix:

- Extracted policy into [src/pages/playFiles/songlengthsResolution.ts](src/pages/playFiles/songlengthsResolution.ts).
- [src/pages/playFiles/hooks/useSonglengths.ts](src/pages/playFiles/hooks/useSonglengths.ts) now supports `allowMd5Fallback` options and yields every 250 items.
- [src/pages/playFiles/handlers/addFileSelections.ts](src/pages/playFiles/handlers/addFileSelections.ts) disables MD5 fallback during bulk imports.
- Coverage added in [src/pages/playFiles/songlengthsResolution.test.ts](src/pages/playFiles/songlengthsResolution.test.ts).

## Automated proof

Local checks completed successfully:

- Focused Vitest regression set for binary uploads, navigation guards, and songlength resolution.
- Additional focused regression coverage passed for the native HVSC chunk-read path.
- Additional focused regression coverage passed for autoplay drive reconciliation and lazy config hydration.
- Full Android JVM validation passed under JDK 17 with `./gradlew --no-daemon testDebugUnitTest`.
- `npm run lint`
- `npm run test:coverage` with `90.83%` branch coverage.
- `npm run build`
- Focused Playwright golden-trace refresh and compare pass for:
  - `disk image triggers mount and autostart sequence`
  - `disk image uses DMA autostart when enabled`
  - `prev/next navigates within playlist`
- Full `./build` helper completed successfully.

Additional observations:

- `c64u` resolves locally to `192.168.1.13`.
- Attached Android device `9B0...` is visible via `adb devices -l`.

## Real-device proof

Exploratory Android regression investigations should assume this setup is available:

- Attached Android device over adb.
- Live C64 Ultimate reachable at hostname `c64u`.

Completed on-device validation:

- The app was rebuilt, installed on device `9B081FFAZ001WX`, and launched successfully via adb after the Android receiver-registration compatibility fix.
- Fixture files were refreshed under `/sdcard/Download/C64LocalSource`.
- The handset now resolves `c64u` directly; `adb shell ping -c 1 c64u` succeeds.
- Evidence bundles were written under `test-results/maestro-proof/`.

Attempted on-device validation:

- The earlier `Unable to launch app uk.gleissner.c64commander` Maestro failure no longer reproduces on the current build.
- Post-fix run of `.maestro/real-c64u-ftp-browse.yaml` still ended with a flow assertion, but the captured UI hierarchy shows the app had already reached the remote picker state with `Path: /` visible; report: `test-results/maestro-proof/post-compat-c64u/report.xml`, UI dump: `test-results/maestro-proof/post-compat-c64u/uidump.xml`.
- Post-fix run of `.maestro/local-binary-playback-proof.yaml` still ended with a flow assertion while navigating the Play screen; report: `test-results/maestro-proof/post-compat-local/report.xml`.
- The remaining on-device proof gap is therefore in the Maestro flow selectors, not in the Android startup/runtime path fixed by `BroadcastReceiverCompat`.

## Remaining blocker

### Android proof automation

The remaining real-device limitation is the proof harness rather than the fixed app code:

- The current Maestro flows still depend on brittle tab and picker selectors that do not match the attached handset's current rendered hierarchy.
- Device evidence now shows the app launches, the handset resolves `c64u`, and the C64U browse flow reaches the remote picker UI on-device.
- Android JVM validation is no longer blocked locally once run under JDK 17.

## Remaining work

1. If stricter handset proof is required, harden the Maestro flows against the current Android UI hierarchy and rerun them.
2. Capture additional device-side screenshots only if a future review needs end-to-end visual evidence beyond the existing UI dump and JUnit reports.
