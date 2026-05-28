# Prod-Hardening-5 Worklog

Chronological evidence log for the analysis pass.

## Session start

- Branch: `feat/prod-hardening-4`
- HEAD: `d8625c350d22c22ecf294caba2c623c7a7c50c38`
- Worktree status (pre-analysis, left untouched per concurrency rule):
  - `src/lib/deviceInteraction/deviceInteractionManager.ts` (modified)
  - `src/pages/playFiles/hooks/usePlaybackController.ts` (modified)
  - `tests/unit/playFiles/usePlaybackController.concurrency.test.tsx` (modified)
- Date: 2026-05-28

## Inspection order

The required-read list is consumed top-to-bottom. Each step records the path, why it was
read, and the most important takeaways used elsewhere in the package.

## Required-read pass (chronological)

| # | File | Why | Key takeaway |
| - | ---- | --- | ----------- |
| 1 | `.github/copilot-instructions.md` | repo policy | DOC_ONLY task; do not run build/test ceremony; preserve coverage >=91% on code changes |
| 2 | `CLAUDE.md` | user-private + project policy | Always-on guidance; phase model; FAST_ANDROID_DEPLOY exception not active here |
| 3 | `docs/architecture.md` | runtime layers | Confirms gateway boundaries, query-backed playlist contract, HVSC platform matrix |
| 4 | `docs/features-by-page.md` | feature surface | All routed pages enumerated; cross-page risk map |
| 5 | `docs/research/stabilization/prod-hardening-1/prompt.md` | prior findings PH1-PH15 | All 15 findings inventoried for ledger |
| 6 | `docs/research/stabilization/prod-hardening-2/prompt.md` and research.md | gateway + background-health redesign | Confirms approved boundaries and acceptance criteria |
| 7 | `docs/research/stabilization/prod-hardening-3/prompt.md` and results.md and PLANS.md | second-pass guarantees | All phases marked Done in PLANS; results note HVSC partial-checkpoint follow-up |
| 8 | `docs/research/stabilization/prod-hardening-4/prompt.md`, research.md, results.md, PLANS.md, WORKLOG.md | last completed pass | F1/F2/F3 implemented; cross-device disk-origin proof blocked by c64u outage |

`AGENTS.md` is not present at the repository root; the CLAUDE.md project block restates the same orientation rules.

## Static scans

### Device-call boundary scan (REST/FTP/Telnet/native)

`rg -n "fetch\(|XMLHttpRequest|WebSocket|EventSource" src -g '*.ts' -g '*.tsx'` returns only:

- `src/lib/c64api.ts` ×2 — INSIDE the REST gateway (`request` and `fetchWithTimeout` bodies)
- `src/lib/native/ftpClient.web.ts` — INSIDE the FTP bridge (`withFtpInteraction` wraps callers)
- `src/lib/native/secureStorage.web.ts` — local SecureStorage native bridge (non-device)
- `src/lib/diagnostics/webServerLogs.ts` — local `/api/diagnostics/server-logs` (non-device)
- `src/lib/hvsc/hvscReleaseService.ts`, `src/lib/hvsc/hvscDownload.ts` — HVSC archive CDN/mirror (non-device)
- `src/lib/mock/mockConfig.ts` — Vite-served static config YAML (non-device)
- `src/pages/OpenSourceLicensesPage.tsx` — bundled `THIRD_PARTY_NOTICES.md` (static asset, non-device)

Verdict: zero confirmed device-endpoint bypasses outside the four approved gateways. `connectionManager.ts` no longer has a raw-fetch fallback. `GlobalDiagnosticsOverlay.validateTarget` now uses `api.getInfo(...)`.

### Gateway and scheduler scan

`rg -n "withRestInteraction|withFtpInteraction|withTelnetInteraction|scheduleConfigWrite" src` reports callers only in:

- `src/lib/c64api.ts`, `src/lib/ftp/ftpClient.ts`, `src/lib/telnet/*`, `src/lib/diagnostics/healthCheckEngine.ts`, `src/lib/config/applyConfigFileReference.ts`, `src/lib/config/configWriteThrottle.ts`, `src/hooks/useTelnetActions.ts`, `src/pages/HomePage.tsx` (Telnet helpers).

`InteractionScheduler.cancelAll` and `resetInteractionState` are wired together; `useSavedDeviceSwitching` calls `resetInteractionState("saved-device-switch")` and also cancels TanStack queries.

`__c64uBypassCircuit` survives only as an option type in `c64api.ts` and is no longer set by `healthCheckEngine.ts` for routine probes. `__c64uForceInteractionScheduling` is the test-only forced-scheduling flag.

### High-frequency interaction scan

- `ConfigItemRow.tsx` uses `useDeviceBoundSlider` + `createLatestIntentWriteLane` (PH2-WI-10 done).
- `usePlaybackController.ts` exposes `USER_TRANSPORT_COALESCE_MS = 120` and `scheduleUserSkip` with a debounced flush; auto-advance bypasses coalescing (PH4-F2).
- `PlayFilesPage.tsx:1149-1218` registers the `backgroundAutoSkipDue` listener once with stable ref dependencies (PH4-F3).
- `useDeviceBoundSlider.ts` and `useVolumeOverride.ts` both pause polling during drag and latch the pending intent.
- `useSavedDeviceHealthChecks.ts` keeps the `switchDeviceDialog` 10 s full cycle untouched and runs background maintenance selected-device-only with hidden/suppressed/polling-paused/foreground-switch guards (PH3 done).

### Exception and logging scan

`rg -n "catch\s*\{" src -g '*.ts' -g '*.tsx'` finds 7 bare catches:

- `src/lib/savedDevices/host.ts:11` — URL-parse fallback to default host
- `src/lib/connection/connectionManager.ts:420` — URL-parse fallback for reachability host
- `src/lib/diagnostics/networkSnapshot.ts:42` — URL-parse fallback for diagnostics
- `src/lib/archive/client.ts:41` — Capacitor.isNativePlatform availability check
- `src/lib/hvsc/hvscBrowseIndexStore.ts:886` — Filesystem.stat per-path probe with aggregated warn after the loop
- `src/lib/c64api.ts:253` — URL-parse fallback for reachability tracking
- `src/lib/secureStorage.ts:51` — legacy password JSON parse fallback (returns legacy default)

All 7 are documented intentional fallbacks: URL parse safety, optional-feature detection, or per-path Filesystem probes whose aggregate result is logged. None is a release blocker per the PH1-PH5 exception policy.

Kotlin: `pluginContextOrNull()` in `HvscIngestionPlugin.kt:161` and `FtpClientPlugin.kt:50` swallow `Throwable` to return `null`. They are defensive against Capacitor bridge teardown but are silent — candidate informational finding only.

Production code still emits some `console.warn`/`console.info`:
- `src/lib/connection/connectionManager.ts` smoke-mode-only structured probe events.
- `src/lib/playlistRepository/indexedDbRepository.ts` 5 `console.warn` calls for IndexedDB load failures (still routed through the diagnostics console bridge but visible in raw WebView console).
- `src/lib/diagnostics/logger.ts` is the bridge itself; expected.
- `src/lib/native/safeArea.ts`, `src/lib/native/platform.ts` warn about native-bridge probe failures.
- `src/lib/disks/diskStore.ts` warn about per-device disk library load failures.
- `src/lib/smoke/smokeMode.ts:247` smoke-mode probe report (gated by smoke mode).

Verdict: `console.*` calls outside the diagnostics bridge are bounded, fallback-only, and almost all gated by smoke mode or storage-load failure paths. No production-noise release blocker remains.

### State persistence and stale-result scan

- `applyC64APIRuntimeConfig` is called inside `useSavedDeviceSwitching` after `resetInteractionState`; verification then uses `verifyCurrentConnectionTarget`.
- `playlistRepositorySync.ts` `buildSnapshotKey` derives the key from the serialized payload, including `configRef`, `configOrigin`, `configOverrides`, `durationOverrideMs`, status, source metadata, and added time. PH1-PH8 satisfied.
- `useQueryFilteredPlaylist.ts` gates `memoryFilteredPlaylist` behind `!repositoryReady`; PH1-PH1 satisfied.

### Native and lifecycle scan

- Background auto-skip listener: registered once on `PlayFilesPage.tsx:1149` with stable ref deps; cleanup awaits handle.remove. PH4-F3 satisfied.
- App lifecycle uses web `visibilitychange` for ConnectionController, SafeArea, useAppConfigState, useDeviceBoundSlider, and useSavedDeviceHealthChecks. Capacitor `App.addListener` is only used in `OpenSourceLicensesPage.tsx` for the Android back button. PH4 research §3 still accurate.
- BackgroundExecution plugin: `addListener("backgroundAutoSkipDue", listener)` is exposed and consumed once per mount.

### FTP retry/timeout scan

- `FTP_CONNECT_TIMEOUT_MS = 1_500` in `src/lib/ftp/ftpClient.ts:30`; pass-through to native via `connectTimeoutMs`.
- `FTP_TRANSIENT_RETRY_DELAY_MS = 250` and one-bounded retry inside `withFtpInteraction` (PH4-F1 satisfied).
- `applyFtpConnectPacing(hostScope, ...)` called before each attempt (initial + retry).

## Worktree concurrent edits (left untouched per policy)

```
git diff --stat src/lib/deviceInteraction/deviceInteractionManager.ts src/pages/playFiles/hooks/usePlaybackController.ts tests/unit/playFiles/usePlaybackController.concurrency.test.tsx
 .../deviceInteraction/deviceInteractionManager.ts  |  7 --
 src/pages/playFiles/hooks/usePlaybackController.ts | 15 +++-
 .../usePlaybackController.concurrency.test.tsx     | 88 ++++++++++++++++++++++
 3 files changed, 102 insertions(+), 8 deletions(-)
```

The diff removes the now-unused `ftpCooldownUntil` map (FTP cooldown is replaced by `ftpConnectCooldownUntil` + pacing) and adds an unmount cleanup for `pendingUserSkipRef`. Per CLAUDE.md "Mandatory handling of concurrent changes", these edits are assumed to belong to concurrent work and are left as-is. They are recorded here so the PH5 implementation pass does not duplicate them.

Additional concurrent deletions visible at session end (`git status --short`):

```
 D docs/research/review-15/FEATURE_MODEL.md
 D docs/research/review-15/HANDOVER_PROMPT.md
 D docs/research/review-15/PRODUCTION_READINESS_CONTINUATION_PROMPT.md
 D docs/research/review-15/README.md
 D docs/research/review-15/REVIEW_PROMPT.md
 D docs/research/review-15/review-15.md
 D docs/research/transport-trace-coverage/HANDOVER_PROMPT.md
```

These deletions are outside this DOC_ONLY pass's intended scope (only files under
`docs/research/stabilization/prod-hardening-5/` were created). They are recorded
here under "concurrent edits" and left untouched per CLAUDE.md. The PH5
implementation pass must inspect them at session start and decide whether to land
or revert them as part of PH5-01.

## Hardware probe (informational, not validation)

```
curl --max-time 5 -sS http://u64/v1/info
{ "product": "Ultimate 64 Elite", "firmware_version": "3.14e", "fpga_version": "122", "core_version": "1.4B", ... }

curl --max-time 5 -sS http://c64u/v1/info
curl: (56) Recv failure: Connection reset by peer

adb devices
9B081FFAZ001WX	device
```

- `u64` reachable as Ultimate 64 Elite firmware 3.14e — preferred validation target.
- `c64u` currently unreachable (consistent with the `c64u-flakiness` memory); should be re-probed at implementation time.
- Pixel 4 with serial prefix `9B0` is attached and ready.

The probes above are recorded as evidence of current device availability only; this DOC_ONLY pass does not deploy an APK or perform on-device validation. The implementation prompt requires the next pass to re-probe before claiming validation.

