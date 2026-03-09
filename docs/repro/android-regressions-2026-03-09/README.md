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
- `npm run test:coverage` with `90.82%` branch coverage.
- `npm run build`
- Focused Playwright golden-trace refresh and compare pass for:
  - `disk image triggers mount and autostart sequence`
  - `disk image uses DMA autostart when enabled`
  - `prev/next navigates within playlist`
- Full `./build` helper completed successfully.

Additional observations:

- `c64u` resolves locally to `192.168.1.13`.
- Attached Android device `9B081FFAZ001WX` is visible via `adb devices -l`.

## External blockers

### Android device validation

The attached Android device is now available as `9B081FFAZ001WX`, but a real-device regression pass against the live C64U was not executed in this validation slice.

### Android JVM validation

Targeted Android plugin tests were attempted but are currently blocked by local environment/runtime issues:

- Kotlin daemon / incremental tooling rejected JDK version `25.0.1`.
- Robolectric execution later failed with `NoClassDefFoundError` / `ClassReader` before producing a clean signal on the updated plugin tests.

These blockers no longer prevent a full repository build claim, but they still limit native plugin-specific runtime proof beyond the automated coverage and build evidence.

## Remaining work

1. Run targeted Android real-device regression checks on `9B081FFAZ001WX` against the live C64U.
2. Capture device-side screenshots/logs for the proof bundle.
3. Re-run Android JVM plugin tests if deeper native-runtime proof is still required beyond the green `./build` result.
