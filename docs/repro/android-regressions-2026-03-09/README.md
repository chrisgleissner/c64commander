# Android regression remediation proof

Date: 2026-03-09
Branch: `test/fix-ios-maestro-tests`
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

- [android/app/src/main/java/uk/gleissner/c64commander/FtpClientPlugin.kt](/home/chris/dev/c64/c64commander/android/app/src/main/java/uk/gleissner/c64commander/FtpClientPlugin.kt) now tries `LIST` first.
- `MLSD` fallback is retained only when LIST is empty or throws.
- Native regression coverage was updated in [android/app/src/test/java/uk/gleissner/c64commander/FtpClientPluginTest.kt](/home/chris/dev/c64/c64commander/android/app/src/test/java/uk/gleissner/c64commander/FtpClientPluginTest.kt).

### 2. Local non-SID binary upload corruption risk

Root cause:

- SID upload already used multipart form transport.
- Other local binary uploads posted raw `Blob` bodies through `fetch`.
- That path was not aligned with the working SID upload route and was the most plausible source of platform-specific binary transport issues.

Fix:

- [src/lib/c64api.ts](/home/chris/dev/c64/c64commander/src/lib/c64api.ts) now converts raw binary upload payloads to `ArrayBuffer` before request dispatch.
- SID upload remains multipart and unchanged.
- Coverage added in [src/lib/c64api.test.ts](/home/chris/dev/c64/c64commander/src/lib/c64api.test.ts).

### 3. HVSC large-archive ingestion failure

Root cause:

- The fallback path in [src/lib/hvsc/hvscDownload.ts](/home/chris/dev/c64/c64commander/src/lib/hvsc/hvscDownload.ts) depended on `readArchiveBuffer()`.
- That helper intentionally rejects reads above the bridge guard threshold.
- Large cached HVSC archives therefore failed on the fallback route.

Fix:

- Added native chunk reads in [android/app/src/main/java/uk/gleissner/c64commander/HvscIngestionPlugin.kt](/home/chris/dev/c64/c64commander/android/app/src/main/java/uk/gleissner/c64commander/HvscIngestionPlugin.kt).
- Exposed the bridge in [src/lib/native/hvscIngestion.ts](/home/chris/dev/c64/c64commander/src/lib/native/hvscIngestion.ts).
- Updated [src/lib/hvsc/hvscDownload.ts](/home/chris/dev/c64/c64commander/src/lib/hvsc/hvscDownload.ts) to assemble large archives from native chunks instead of requesting a guarded whole-file bridge read.
- Added Android coverage in [android/app/src/test/java/uk/gleissner/c64commander/HvscIngestionPluginTest.kt](/home/chris/dev/c64/c64commander/android/app/src/test/java/uk/gleissner/c64commander/HvscIngestionPluginTest.kt).

### 4. Playlist import lost on navigation

Root cause:

- Import progress was owned by the Play page component.
- There was no route confirmation when a user navigated away during active import work.
- Unmounting the page could tear down in-flight import state.

Fix:

- Added a shared navigation-guard registry in [src/lib/navigation/navigationGuards.ts](/home/chris/dev/c64/c64commander/src/lib/navigation/navigationGuards.ts).
- [src/components/TabBar.tsx](/home/chris/dev/c64/c64commander/src/components/TabBar.tsx) now confirms guarded navigation before tab changes.
- [src/pages/PlayFilesPage.tsx](/home/chris/dev/c64/c64commander/src/pages/PlayFilesPage.tsx) registers the guard only while imports are active and also adds `beforeunload` protection.
- Coverage added in [src/lib/navigation/navigationGuards.test.ts](/home/chris/dev/c64/c64commander/src/lib/navigation/navigationGuards.test.ts).

### 5. HVSC import throughput degradation

Root cause:

- Bulk enrichment repeatedly paid fallback resolution cost during songlength processing.
- That cost is avoidable during import because path-based resolution is the primary expected hit.
- Long runs also benefited from cooperative yielding to keep the UI responsive.

Fix:

- Extracted policy into [src/pages/playFiles/songlengthsResolution.ts](/home/chris/dev/c64/c64commander/src/pages/playFiles/songlengthsResolution.ts).
- [src/pages/playFiles/hooks/useSonglengths.ts](/home/chris/dev/c64/c64commander/src/pages/playFiles/hooks/useSonglengths.ts) now supports `allowMd5Fallback` options and yields every 250 items.
- [src/pages/playFiles/handlers/addFileSelections.ts](/home/chris/dev/c64/c64commander/src/pages/playFiles/handlers/addFileSelections.ts) disables MD5 fallback during bulk imports.
- Coverage added in [src/pages/playFiles/songlengthsResolution.test.ts](/home/chris/dev/c64/c64commander/src/pages/playFiles/songlengthsResolution.test.ts).

## Automated proof

Local checks completed successfully:

- Focused Vitest regression set for binary uploads, navigation guards, and songlength resolution.
- `npm run lint`
- `npm run build`
- Focused Playwright route/coverage probe after restarting a stale preview server.
- Isolated coverage run with totals:
  - statements: 91.77
  - branches: 90.86
  - functions: 90.91
  - lines: 91.77

Additional observations:

- `c64u` resolves locally to `192.168.1.13`.
- The repository helper `./build` was still running in the Playwright phase when this proof note was written.

## External blockers

### Android device validation

Real-device validation could not be executed because `adb devices -l` returned no attached devices at validation time.

### Android JVM validation

Targeted Android plugin tests were attempted but are currently blocked by local environment/runtime issues:

- Kotlin daemon / incremental tooling rejected JDK version `25.0.1`.
- Robolectric execution later failed with `NoClassDefFoundError` / `ClassReader` before producing a clean signal on the updated plugin tests.

These blockers prevent a final local Android-native validation claim, but they do not contradict the web/unit/build evidence for the implemented fixes.

## Remaining work

1. Let `./build` complete and record the final pass/fail result.
2. Re-run Android validation when an adb-connected device is available.
3. Re-run Android JVM tests after the local JDK/Robolectric environment is repaired.
