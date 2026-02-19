# Feature - Test Coverage Matrix

Legend: `Yes` = present and observed in repository/logs, `Partial` = present but coverage signal is weak or blocked, `No` = not evidenced in this review run.

| Feature area | Unit (Vitest) | Playwright E2E | Maestro | Android JVM tests | Notes / gaps |
| --- | --- | --- | --- | --- | --- |
| App startup and shell | Yes (`tests/unit/*`, startup scripts) | Yes (`playwright/ui.spec.ts`, `playwright/coverageProbes.spec.ts`) | Yes (`.maestro/smoke-launch.yaml`) | Partial | Startup baseline metrics captured on Android emulator; no iOS startup benchmark in this run. |
| Connection discovery lifecycle | Yes (`tests/unit/connection/connectionManager.test.ts`) | Yes (`playwright/connectionSimulation.spec.ts`, `playwright/demoMode.spec.ts`) | Partial (`probe-health`, edge offline flows exist) | Partial | Android JVM layer currently failing due toolchain incompatibility. |
| REST API client behavior | Yes (`tests/unit/c64api.test.ts`, `tests/unit/c64apiSidUpload.test.ts`) | Yes (multiple interaction specs) | Indirect | Partial | Strong JS coverage; native JVM proxy/plugin test signal currently degraded. |
| FTP browse/read | Yes (`tests/unit/lib/ftp/ftpClient.test.ts`, `tests/unit/lib/native/ftpClient.web.test.ts`) | Yes (`playwright/ftpPerformance.spec.ts`, selection specs) | Yes (`.maestro/ios-ftp-browse.yaml`) | Partial (`FtpClientPluginTest.kt` exists) | JVM failures block reliable native regression signal. |
| HVSC download/ingest | Yes (broad `tests/unit/hvsc/*.test.ts`) | Yes (`playwright/hvsc.spec.ts`) | Yes (`.maestro/smoke-hvsc*.yaml`, `ios-hvsc-browse`) | Partial (`HvscIngestionPluginTest.kt`, `HvscSevenZipRuntimeTest.kt`) | Runtime core is well-tested in JS; native test execution unstable on local JDK 25. |
| Playback/playlist controls | Yes (`tests/unit/playback*.test.ts`, repositories) | Yes (`playwright/playback*.spec.ts`, `playlistControls.spec.ts`) | Yes (`smoke-playback`, `ios-playback-basics`) | N/A | Good multi-layer coverage; timing waits in some E2E tests may induce flakiness. |
| Disk management/mounting | Yes (`tests/unit/components/disks/*`, `tests/unit/diskMount.test.ts`) | Yes (`playwright/diskManagement.spec.ts`) | Partial (mounted/local smoke variants exist) | N/A | UI-heavy logic has many tests but remains high-complexity surface. |
| Settings/config persistence | Yes (`tests/unit/config/*`, `settingsTransfer`) | Yes (`playwright/settingsConnection.spec.ts`, `homeConfigManagement.spec.ts`) | Yes (`edge-config-persistence`, `ios-config-persistence`) | Partial (`FeatureFlagsPluginTest.kt`, `SecureStoragePluginTest.kt`) | Native secure-storage JVM tests currently affected by toolchain failure. |
| Diagnostics/tracing | Yes (`tests/unit/diagnostics/*`, tracing unit tests) | Yes (`playwright/settingsDiagnostics.spec.ts`, `homeDiagnosticsOverlay.spec.ts`, `verifyUserTracing.spec.ts`) | Yes (`ios-diagnostics-export`) | Partial (`DiagnosticsBridgePluginTest.kt`) | Broad surface exists; Android JVM instability reduces confidence in native bridge regressions. |
| Web Docker auth/proxy distribution | Yes (`tests/unit/web/webServer.test.ts`) | Partial (`playwright/webPlatformAuth.spec.ts` targeted run mixed results) | Indirect (Docker path via Android Maestro in docs) | N/A | `web/server/src/index.ts` branch coverage is low (58.1%); targeted Playwright run had deterministic viewport failures in another suite. |

## Coverage gate snapshot
- Global `test:coverage` result: `82.05%` branch coverage (passes 82% threshold with minimal margin).
- Highest concern: branch undercoverage in `web/server/src/index.ts` (58.10%).
