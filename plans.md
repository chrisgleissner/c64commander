# HVSC Architecture Refactor – Cross-Platform, File-System-First Design

## A. Baseline & Guardrails

- [x] Capture current HVSC data flow map (TS + Kotlin) with file references.
- [x] Confirm existing UI entry points and settings that refer to HVSC.
- [x] Record current tests that touch HVSC (unit + Playwright + Android JVM).

### Current HVSC data flow (snapshot)

- UI entry → HVSC sources and API: [src/pages/PlayFilesPage.tsx](src/pages/PlayFilesPage.tsx), [src/pages/MusicPlayerPage.tsx](src/pages/MusicPlayerPage.tsx), [src/lib/hvsc/hvscSource.ts](src/lib/hvsc/hvscSource.ts), [src/lib/hvsc/hvscService.ts](src/lib/hvsc/hvscService.ts)
- Native bridge definition: [src/lib/hvsc/native/hvscIngestion.ts](src/lib/hvsc/native/hvscIngestion.ts)
- Android plugin bridge: [android/app/src/main/java/uk/gleissner/c64commander/HvscIngestionPlugin.kt](android/app/src/main/java/uk/gleissner/c64commander/HvscIngestionPlugin.kt)
- Android ingestion + DB: [android/app/src/main/java/uk/gleissner/c64commander/hvsc/HvscIngestionService.kt](android/app/src/main/java/uk/gleissner/c64commander/hvsc/HvscIngestionService.kt), [android/app/src/main/java/uk/gleissner/c64commander/hvsc/AndroidHvscDatabase.kt](android/app/src/main/java/uk/gleissner/c64commander/hvsc/AndroidHvscDatabase.kt), [android/app/src/main/java/uk/gleissner/c64commander/hvsc/HvscSchema.kt](android/app/src/main/java/uk/gleissner/c64commander/hvsc/HvscSchema.kt)
- Songlength parsing: [src/lib/sid/songlengths.ts](src/lib/sid/songlengths.ts), [android/app/src/main/java/uk/gleissner/c64commander/hvsc/SonglengthsParser.kt](android/app/src/main/java/uk/gleissner/c64commander/hvsc/SonglengthsParser.kt)

### Existing UI entry points referencing HVSC

- Play files install/update + status: [src/pages/PlayFilesPage.tsx](src/pages/PlayFilesPage.tsx)
- HVSC browsing and playback: [src/pages/MusicPlayerPage.tsx](src/pages/MusicPlayerPage.tsx), [src/lib/hvsc/hvscSource.ts](src/lib/hvsc/hvscSource.ts)

### Existing HVSC tests

- Playwright flow coverage: [playwright/hvsc.spec.ts](playwright/hvsc.spec.ts)
- TS songlength parsing: [tests/unit/sid/songlengths.test.ts](tests/unit/sid/songlengths.test.ts)
- Android HVSC tests: [android/app/src/test/java/uk/gleissner/c64commander/hvsc/HvscIngestionServiceTest.kt](android/app/src/test/java/uk/gleissner/c64commander/hvsc/HvscIngestionServiceTest.kt), [android/app/src/test/java/uk/gleissner/c64commander/hvsc/HvscUtilsTest.kt](android/app/src/test/java/uk/gleissner/c64commander/hvsc/HvscUtilsTest.kt)

## B. Plan of Small, Verified Steps (Each step: update code → run relevant tests → commit)

### Step 1: Establish new TS-only HVSC index interface (no behavior change)

- [x] Add `MediaIndex` interface + types under [src/lib/media-index/](src/lib/media-index/).
- [x] Add JSON/flat-file index implementation that reads/writes from app storage.
- [x] Add unit tests for index read/write/query (no callers yet).
- [x] Run `npm run test` (targeted if possible) and commit: "Add TS media index interface".

### Step 2: Wire index behind existing HVSC lookup API (no behavior change)

- [x] Identify current HVSC lookup surface in [src/lib/hvsc/](src/lib/hvsc/).
- [x] Add adapter layer so callers can use `MediaIndex` without changing behavior.
- [x] Keep current Kotlin DB path intact; do not remove.
- [x] Run relevant unit tests and commit: "Wire media index adapter".

### Step 3: Introduce file-system-first HVSC root abstraction

- [x] Add `HvscRootLocator` (TS) to resolve stable, user-discoverable HVSC root path.
- [x] Ensure path is persisted across restarts (config/store).
- [x] Add unit tests for path persistence and default selection.
- [x] Run relevant unit tests and commit: "Add HVSC root locator".

### Step 4: TS-only download + extraction tracking (status model)

- [x] Add TS status model for download/extraction telemetry (time, size, errors).
- [x] Persist status in app storage.
- [x] Add unit tests for status persistence.
- [x] Run relevant unit tests and commit: "Add HVSC status model".

### Step 5: UI status summary + entry point (no new UX flows)

- [x] Update Play Files page with “Download HVSC Library” action and concise status summary.
- [x] Ensure summary persists across restarts.
- [x] Run Playwright tests covering Play Files page and commit: "Add HVSC download summary".

### Step 6: Import interstitial: show HVSC only when available

- [x] Update import flow to include “HVSC Library” option only when extracted.
- [x] Open HVSC root directly in the browser when selected.
- [x] Run Playwright tests for import flow and commit: "Gate HVSC import option".

### Step 7: Move indexing to TS-only file-system scan

- [ ] Implement file-system scan that builds lightweight index from HVSC root.
- [ ] Replace any Kotlin DB dependency for lookups with TS index.
- [ ] Keep Kotlin download/extraction only if unavoidable.
- [ ] Run unit tests and Playwright as needed; commit: "Use TS index for HVSC".

### Step 8: Reduce Kotlin surface area

- [ ] Remove Kotlin DB and ingestion paths no longer used.
- [ ] Keep only background download/extraction if still required.
- [ ] Run Android JVM tests and commit: "Reduce HVSC Kotlin surface".

### Step 9: Docs + validation

- [ ] Update [doc/](doc/) and [README.md](README.md) with new HVSC architecture notes.
- [ ] Run full build (including ./local-build.sh when applicable).
- [ ] Mark all steps complete only when green.

## C. Definition of Done

- [ ] HVSC is a normal local folder with a stable, discoverable root.
- [ ] File system is the single source of truth.
- [ ] TS-only index is lightweight and replaceable.
- [ ] Native Kotlin is minimal and isolated.
- [ ] Download + extraction status summary visible and persisted.
- [ ] Import flow includes HVSC only when available.
- [ ] All tests pass locally and in CI.

## Archived: Previous Test Hardening Plan

## A. Baseline: Current Test & Architecture Inventory

- [x] Inventory existing automated tests (Playwright E2E, Kotlin unit tests, integration tests)
      - Playwright E2E: [playwright/](playwright/) (e.g., playback, disks, settings, layout, demo)
      - Web unit tests: [tests/unit/](tests/unit/) and scattered `*.test.ts` in [src/](src/)
      - Android unit tests: [android/app/src/test/java/uk/gleissner/c64commander/](android/app/src/test/java/uk/gleissner/c64commander/)
      - Integration-like flows: local archive ingestion + HVSC ingestion tests in [tests/unit/](tests/unit/) and Android HVSC test suite
- [x] Identify demo mode vs real device switching mechanisms
      - State machine in [src/lib/connection/connectionManager.ts](src/lib/connection/connectionManager.ts)
      - Discovery triggers in [src/components/ConnectionController.tsx](src/components/ConnectionController.tsx)
      - Manual switch via [src/components/ConnectivityIndicator.tsx](src/components/ConnectivityIndicator.tsx)
- [x] Identify how networking is abstracted (HTTP/FTP clients, endpoints, credentials)
      - REST client in [src/lib/c64api.ts](src/lib/c64api.ts)
      - FTP client in [src/lib/ftp/ftpClient.ts](src/lib/ftp/ftpClient.ts) via native `FtpClient`
      - Runtime base URL + host headers (`X-Password`, `X-C64U-Host`) with proxy support
- [x] Identify how the mock C64U server is started, stopped, and injected
      - `startMockServer`/`stopMockServer` in [src/lib/mock/mockServer.ts](src/lib/mock/mockServer.ts)
      - Injected via `applyC64APIRuntimeConfig` and FTP port override in [src/lib/connection/connectionManager.ts](src/lib/connection/connectionManager.ts)
- [x] Identify how real-device probing is triggered and handled
      - `probeOnce` in [src/lib/connection/connectionManager.ts](src/lib/connection/connectionManager.ts)
      - Triggered by startup/manual/settings/background in [src/components/ConnectionController.tsx](src/components/ConnectionController.tsx)
- [x] Document minimal hooks needed for deterministic testing
      - Control discovery/probes (`discoverConnection`, `probeOnce`), mock server lifecycle, and runtime base URL overrides
      - Deterministic config via `appSettings` + `appConfigStore` events
      - Request routing visibility via existing logging (`addLog`) and test fixtures

## B. Deterministic Connectivity Simulation (Real ↔ Demo ↔ Real)

Goal: tests must simulate ALL transitions without flakiness or unintended side effects.

- [x] Implement deterministic real-device simulator (reachable/unreachable toggle at runtime)
- [x] Implement deterministic fault modes:
      - timeouts
      - connection refused
      - authentication failure
      - slow but bounded responses
- [x] E2E: real device unreachable → enable demo → app fully usable
- [x] E2E: demo enabled → real device becomes reachable (informational only)
- [x] E2E: disable demo → connect to real → core operations succeed
- [x] E2E: switch back to demo → state preserved, no corruption
- [x] Assert correct request routing:
      - demo operations → mock only (except allowed probes)
      - real operations → real simulator only

## C. High-Value Click Paths (Core User Journeys)

Identify and fully cover the most critical and failure-prone flows.

- [x] Enumerate top 10–15 high-value click paths in plans.md, including:
      - first launch / startup connection
      - editing hostname/IP and password triggers immediate probe
      - demo mode enable/disable flows
      - navigation between pages with active state
      - settings changes while playback or mounts are active
- High-value click paths inventory:
      1) Startup discovery → demo interstitial → continue demo
      2) Startup discovery → real connected indicator
      3) Settings: change host/password → Save & Connect → probe
      4) Toggle Automatic Demo Mode on/off in Settings
      5) Navigate tabs while playback active → state preserved
      6) Play page: add local files → play immediately
      7) Play page: add C64U files → play
      8) HVSC: install/update → browse → play
      9) Disks: add local disk → mount to drive → unmount
      10) Disks: add C64U disk → mount to drive → rotate group
      11) FTP browse → mount remote disk image
      12) Config: open categories → update value → save to flash
      13) Settings open while playback active → no disruption
      14) Diagnostics: open dialog → copy/share
      15) Playlist persistence across reload/navigation
- [x] Implement robust Playwright E2E coverage for all identified paths
- [x] Use deterministic waits and state assertions (no arbitrary sleeps)

## D. Playback: ALL Edge Cases and Quick Paths

Playback is a highest-value area and MUST be exhaustively covered.

- [x] Identify ALL playback entry paths, including:
      - play from list
      - play immediately after import
      - play after navigation away and back
      - play after switching demo ↔ real
      - play with missing song length
      - play with known song length
      - play from HVSC browser
      - play after playlist persistence restore
- [x] E2E tests for:
      - rapid play/stop/play sequences
      - skipping tracks quickly
      - progress bar correctness under fast interactions
      - remaining-time correctness
- [x] Assert no silent failures, freezes, or stalled progress
- [x] Verify correct backend target (mock vs real) for every playback action

## E. Disk Operations: Mounting, Unmounting, and Edge Cases

Disk handling is mission-critical and must be airtight.

- [x] Enumerate all disk operation paths:
      - import disk (local + C64U)
      - mount disk to drive
      - unmount disk / eject drive
      - remount to same drive
      - mount to different drive
      - rotate disk within group
      - switch demo ↔ real with mounted disks
- [x] E2E tests for:
      - mount success paths
      - mount failure paths (network, auth, unavailable device)
      - unmount correctness
      - no leaked state after failures
- [x] Assert correct device targeting for every operation
- [x] Verify UI state reflects actual mounted state at all times

## F. Song Lengths & HVSC Ingestion (All Incarnations)

Goal: complete, deterministic coverage of all song length sources and ingestion paths.

- [x] Map existing implementation:
      - parsing locations: [src/lib/sid/songlengths.ts](src/lib/sid/songlengths.ts), [android/app/src/main/java/uk/gleissner/c64commander/hvsc/SonglengthsParser.kt](android/app/src/main/java/uk/gleissner/c64commander/hvsc/SonglengthsParser.kt)
      - key derivation: md5 from SID payload + normalized virtual path
      - DB schema: `duration_seconds` in HVSC song table ([android/app/src/main/java/uk/gleissner/c64commander/hvsc/HvscSchema.kt](android/app/src/main/java/uk/gleissner/c64commander/hvsc/HvscSchema.kt))
      - UI lookup usage: playlist duration/remaining in [src/pages/PlayFilesPage.tsx](src/pages/PlayFilesPage.tsx)
- [x] Kotlin unit tests:
      - songlengths.md5 parsing (edge cases included)
      - songlengths.txt parsing
      - md5/key consistency
- [x] Integration tests:
      - ingest small HVSC fixture into DB
      - verify deterministic rows
      - verify correct lookup
- [x] E2E UI tests:
      - known-length track → correct remaining time
      - missing-length track → correct fallback behavior
- [x] Cover ingestion from:
      - extracted filesystem folder
      - archive (if supported), or isolate archive logic to unit/integration tests

## G. Configuration Visibility and Correctness

Configuration must be visible, correct, and consistent in ALL modes.

- [x] Verify ALL configuration items defined in `C64U-config.yaml` are:
      - visible in demo mode
      - visible in real-device mode
- [x] E2E tests asserting:
      - config visibility does not depend on connection success
      - values are populated correctly in demo and real modes
- [x] Verify switching demo ↔ real does not hide or reset config unintentionally
- [x] Assert “Currently using:” indicators remain correct and up to date

## H. UI Layout Guarantees (Zero Tolerance)

Horizontal overflow is unacceptable under any circumstances.

- [x] Expand layout test harness to:
      - traverse ALL high-value click paths
      - open ALL dialogs, sheets, popovers, and secondary windows
- [x] For each UI state:
      - assert no element exceeds viewport width
      - allowlist only intentional overlays/shadows if needed
- [x] Verify vertical overflow is handled by scrolling, not clipping
- [x] Run layout tests across a minimal but representative viewport matrix:
      - small phone portrait
      - larger phone portrait
      - tablet portrait (if applicable)
      - landscape (if supported)
- [x] Add regression tests for every overflow discovered

## I. CI Stability and Diagnostics

- [x] Eliminate flaky timing assumptions
- [x] Ensure deterministic startup and teardown of simulators
- [x] Upload failure artifacts on CI:
      - Playwright traces
      - screenshots
      - request routing logs
- [x] Keep total runtime reasonable without sacrificing coverage

## J. Definition of Done

- [x] ALL checkboxes checked
- [x] ALL tests pass locally
- [ ] ALL tests pass on CI
- [x] Playback fully covered across all quick paths and edge cases
- [x] Disk mount/unmount fully covered across all paths
- [x] Song length ingestion and lookup fully validated
- [x] All configuration items visible and correct in demo and real modes
- [x] No horizontal overflow in any tested UI state
- [x] Vertical overflow handled correctly via scrolling
