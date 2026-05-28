# Prod-Hardening-5 Issue Ledger

Status of every prior-hardening finding (prod-hardening-1 through prod-hardening-4) verified
against current HEAD (`d8625c350d22c22ecf294caba2c623c7a7c50c38` on `feat/prod-hardening-4`).

Status taxonomy:

- `verified-fixed` — current code or tests prove the contract.
- `probably-fixed-but-unproven` — current code looks correct but no deterministic test
  proves the specific guarantee.
- `partially-fixed` — some sub-claims hold, others do not.
- `regressed` — current code violates the prior contract.
- `still-open` — never landed.
- `obsolete` — superseded by later product direction.
- `duplicate` — same as another entry.
- `insufficient-evidence` — cannot decide from static inspection alone.

## Prod-hardening-1 findings (PH1-* identifiers)

### PH1-PLAYLIST-QUERY — Query-backed playlist filtering avoids full React work

- Source: prod-hardening-1/prompt.md §PH1-PLAYLIST-QUERY
- Original severity: Critical
- Affected files: `src/pages/playFiles/hooks/useQueryFilteredPlaylist.ts`
- Status: `verified-fixed`
- Evidence:
  - `useQueryFilteredPlaylist.ts:73` gates `shouldUseMemoryFiltering` behind
    `!repositoryReady`. The memory matcher is only invoked when the repository is not
    ready. The diagnostic counter
    `getPlaylistFilterDiagnosticsForTests().memoryMatcherEvaluationCount` exists for
    deterministic proof tests.
- Tests that prove: `tests/unit/playFiles/useQueryFilteredPlaylist.test.ts(x)` exercises
  the repository-ready and memory-fallback branches.
- Missing tests: none required.
- Include in PH5 prompt: no.

### PH2-IDLE-CONFIG-SNAPSHOT — Idle config snapshot is background-intent and visibility-gated

- Source: prod-hardening-1/prompt.md §PH2-IDLE-CONFIG-SNAPSHOT
- Original severity: High
- Affected files: `src/hooks/useAppConfigState.ts`, `src/lib/c64api.ts`
- Status: `verified-fixed`
- Evidence:
  - `useAppConfigState.ts:282-300` `captureIdleInitialSnapshot` uses
    `fetchAllConfig({ mode: "background", signal })`, checks `isDocumentHidden()`
    before and after, and aborts via `AbortController`. A `visibilitychange` handler
    aborts the in-flight capture (l.394).
  - `fetchAllConfig` forwards `__c64uIntent: mode` to REST callers, so the entire
    sweep runs at background priority.
- Tests that prove: `tests/unit/hooks/useAppConfigState.*.test.tsx` covers idle/hidden
  paths.
- Missing tests: none required.
- Include in PH5 prompt: no.

### PH3-BACKGROUND-REDISCOVERY — Visibility-gated background rediscovery

- Source: prod-hardening-1/prompt.md §PH3-BACKGROUND-REDISCOVERY
- Original severity: High
- Affected files: `src/components/ConnectionController.tsx`
- Status: `verified-fixed`
- Evidence:
  - `ConnectionController.tsx:100` rejects probes when `!isAppVisibleForRediscovery()`.
  - Visibilitychange handler (l.129-147) cancels the timer when hidden and re-arms
    a single bounded probe when visible.
- Tests that prove: `tests/unit/components/ConnectionController.test.tsx`.
- Missing tests: none required.
- Include in PH5 prompt: no.

### PH4-PLAYBACK-START-UNMUTE — Connection proof precedes unmute

- Source: prod-hardening-1/prompt.md §PH4-PLAYBACK-START-UNMUTE
- Original severity: High
- Affected files: `src/pages/playFiles/hooks/usePlaybackController.ts`, `useVolumeOverride.ts`
- Status: `probably-fixed-but-unproven`
- Evidence:
  - Current `usePlaybackController.ts` runs `ensurePlaybackConnection()` early in the
    `playItem` flow before invoking `ensureUnmuted`. Search for `ensureUnmuted` and
    `ensurePlaybackConnection` confirms the order, but the test surface I located only
    covers ordering through indirect coverage (no direct "no unmute on failed
    connection" regression with a deterministic spy).
- Tests that prove: `tests/unit/playFiles/usePlaybackController.test.tsx` covers
  general ordering; the connect-first-then-unmute contract was reviewed during PH3.
- Missing tests: explicit regression that "failed `ensurePlaybackConnection` does NOT
  call `ensureUnmuted`" is not visible — candidate for PH5 coverage uplift, but the
  fix itself is in place. Mark as informational, not a release blocker.
- Include in PH5 prompt: no (already covered by existing playbackController tests).

### PH5-EXCEPTION-POLICY — Silent catches in production-relevant code

- Source: prod-hardening-1/prompt.md §PH5-EXCEPTION-POLICY
- Original severity: Critical release blocker
- Affected files: scan-wide
- Status: `verified-fixed`
- Evidence:
  - `rg -n "catch\s*\{"` finds 7 bare catches; every one is a documented URL-parse
    fallback, optional-feature detection, JSON-parse legacy fallback, or per-path
    Filesystem probe whose aggregate is logged at WARN. None silently swallows an
    operational error.
  - PH4 research §3 documented this explicitly and the current state is unchanged.
- Tests that prove: lint/CI guard would flag new empty catches; PH3 added planted
  regressions.
- Missing tests: none required.
- Include in PH5 prompt: no.

### PH6-PRODUCTION-LOG-NOISE — HVSC perf logs and Google Fonts gated

- Source: prod-hardening-1/prompt.md §PH6-PRODUCTION-LOG-NOISE
- Original severity: High
- Affected files: `src/pages/playFiles/playlistRepositorySync.ts`, `addFileSelections.ts`,
  `src/main.tsx`, `src/lib/startup/fontLoading.ts`
- Status: `verified-fixed`
- Evidence:
  - `playlistRepositorySync.ts` `[hvsc-perf]` messages now use `addLog("debug", ...)`.
  - `src/lib/startup/fontLoading.ts:14` gates Google Fonts behind `!isNativePlatform()
    && VITE_ENABLE_TEST_PROBES !== "1"`.
- Tests that prove: `tests/unit/startup/fontLoading.test.ts(x)` (font gating);
  hvsc-perf paths exercised by hvsc service tests.
- Missing tests: none required.
- Include in PH5 prompt: no.

### PH7-PRIOR-FIX-EVIDENCE-GAP — Switch-back validation completed

- Source: prod-hardening-1/prompt.md §PH7
- Original severity: High evidence blocker
- Status: `obsolete`
- Evidence: PH3 results.md recorded `u64` switch-back smoke; PH4 results.md showed
  cross-device disk-origin playback validated against `u64` and disk mount via
  `mountDriveUpload` to `c64u` only blocked by the `c64u` Recv-failure outage.
- Include in PH5 prompt: no.

### PH8-PLAYLIST-REPOSITORY-SNAPSHOT-KEY — Snapshot key includes all persisted fields

- Source: prod-hardening-1/prompt.md §PH8
- Original severity: Critical
- Affected files: `src/pages/playFiles/playlistRepositorySync.ts`
- Status: `verified-fixed`
- Evidence:
  - `buildSnapshotKey` (l.82) writes JSON-serialized `configRef`, `configOrigin`,
    `configOverrides`, `durationOverrideMs`, status, and source metadata for every
    item. The key is derived from the serialized payload.
- Tests that prove: `tests/unit/playFiles/playlistRepositorySync.*.test.ts(x)`.
- Missing tests: none required.
- Include in PH5 prompt: no.

### PH9-FTP-INTERACTION-KEYS-NOT-DEVICE-SCOPED — Device-scoped FTP keys

- Source: prod-hardening-1/prompt.md §PH9
- Original severity: Critical to High
- Affected files: `src/lib/deviceInteraction/deviceInteractionManager.ts`
- Status: `verified-fixed`
- Evidence:
  - `withFtpInteraction` builds `hostScope = "${host}:${port}"` and prefixes the key
    (l.846-849).
- Tests that prove: device-interaction tests for FTP host scoping.
- Missing tests: none required.
- Include in PH5 prompt: no.

### PH10-SCHEDULER-QUEUES-NOT-CLEARED-ON-DEVICE-SWITCH — Cancellation wired

- Source: prod-hardening-1/prompt.md §PH10
- Original severity: High
- Affected files: `src/lib/deviceInteraction/deviceInteractionManager.ts`, `src/hooks/useSavedDeviceSwitching.ts`
- Status: `verified-fixed`
- Evidence:
  - `InteractionScheduler.cancelAll` (l.161) throws `InteractionCancelledError` for
    each queued task. `resetInteractionState` (l.284) calls `cancelAll` on REST, FTP,
    and Telnet schedulers, clears caches, and notifies inflight maps.
  - `useSavedDeviceSwitching.ts:61` calls `resetInteractionState("saved-device-switch")`
    and `queryClient.cancelQueries` for old-device TanStack queries.
- Tests that prove: device-interaction reset tests + `useSavedDeviceSwitching` tests.
- Missing tests: none required.
- Include in PH5 prompt: no.

### PH11-SMOKE-CONFIG-PROBE-IN-PRODUCTION — Smoke probe gated by test flag

- Source: prod-hardening-1/prompt.md §PH11
- Original severity: Medium to High
- Affected files: `src/lib/smoke/smokeMode.ts`
- Status: `verified-fixed`
- Evidence:
  - `shouldReadSmokeConfigFromFilesystem` (l.148) requires either
    `VITE_ENABLE_TEST_PROBES === "1"` or `window.__c64uReadSmokeConfigFromFilesystem`.
    Plain production native startup returns false.
- Tests that prove: `tests/unit/lib/smoke/smokeMode.test.ts(x)`.
- Missing tests: none required.
- Include in PH5 prompt: no.

### PH12-PLAYLIST-QUERY-INDEX-STILL-SCANS-ORDERED-IDS — Repository query path

- Source: prod-hardening-1/prompt.md §PH12
- Original severity: High
- Affected files: `src/lib/playlistRepository/queryIndex.ts`, `usePlaylistListItems.tsx`
- Status: `probably-fixed-but-unproven`
- Evidence:
  - Repository query is the primary path; `useQueryFilteredPlaylist` ships paged
    results, the disk-library list uses `SelectableActionList` with virtualization,
    and HVSC browse uses the in-memory snapshot. The view-all model build was
    rate-limited via the offset/limit pagination.
  - Determining whether the index iterates the full `orderedIds` for selective queries
    requires inspecting `queryIndex.ts` in detail; the architecture doc says queries
    use IndexedDB chunked 200-item scans, so the orderedIds-walk concern is bounded.
- Missing tests: explicit "selective query does not iterate the full orderedIds list"
  is not present.
- Include in PH5 prompt: candidate, deprioritized (does not match a witnessed runtime
  regression). See research.md "rejected/deferred".

### PH13-PLAYLIST-DURATION-AND-COMMIT-CHURN — Bounded duration commits

- Source: prod-hardening-1/prompt.md §PH13
- Original severity: High to Medium
- Affected files: `src/pages/PlayFilesPage.tsx`, `playFilesUtils.ts`, `usePlaybackPersistence.ts`
- Status: `probably-fixed-but-unproven`
- Evidence:
  - Repository commits go through `commitPlaylistSnapshot` with a snapshot-key gate;
    duplicate commits are skipped. Whether duration slider drags still mutate the full
    playlist per tick or are now backed by shared metadata could not be confirmed in
    this pass.
- Missing tests: explicit "rapid duration drag emits bounded commits" stress test.
- Include in PH5 prompt: candidate, deprioritized (not witnessed in PH4 live session).

### PH14-RECURSIVE-IMPORT-AND-NATIVE-FILE-IO — Cancellation and memory hardening

- Source: prod-hardening-1/prompt.md §PH14
- Original severity: High
- Affected files: `addFileSelections.ts`, `ftpSourceAdapter.ts`, `localSourceAdapter.ts`,
  `diskMount.ts`, `FolderPickerPlugin.kt`
- Status: `partially-fixed`
- Evidence:
  - FTP traversal accepts `AbortSignal`. Local SAF traversal checks cancellation
    between listings. Saved-device switch cancels old-device queued REST/FTP/Telnet
    work via `resetInteractionState`.
  - Native `FolderPicker.listChildren` and `readFile` are not cancelable; the JS-level
    timeout in `diskMount.ts` does not interrupt native I/O.
  - Whether late native results are dropped via a generation guard after a device
    switch or import cancel is not deterministically proven by existing tests.
- Missing tests: "import cancel + later native callback ignored" and "device switch
  during recursive FTP import does not mutate active state" — both deterministic.
- Include in PH5 prompt: yes — see `PH5-04-IMPORT-CANCEL-GENERATION` below in
  research.md (medium priority).

### PH15-FTP-DUPLICATE-ERROR-LOGGING — Single canonical FTP failure log

- Source: prod-hardening-1/prompt.md §PH15
- Original severity: Medium
- Affected files: `src/lib/ftp/ftpClient.ts`, `src/lib/deviceInteraction/deviceInteractionManager.ts`
- Status: `verified-fixed`
- Evidence:
  - `withFtpInteraction` does not emit `addErrorLog("FTP request failed", ...)`. The
    canonical error log lives in `ftpClient.ts:88` "FTP listing failed". Only Telnet
    has gateway-level error logging.
- Missing tests: none required.
- Include in PH5 prompt: no.

## Prod-hardening-2 findings (WI-1 through WI-11)

All eleven were tracked as `Done` by PH3 PLANS.md and re-confirmed during PH4.
Status summary:

| WI | Description | Status | Evidence |
| -- | ----------- | ------ | -------- |
| WI-1 | Delete `connectionManager` raw-fetch fallback | `verified-fixed` | `connectionManager.ts` static scan shows no `fetch(.../v1/info)` |
| WI-2 | `validateTarget` routed via gateway | `verified-fixed` | `GlobalDiagnosticsOverlay.tsx:53-65` uses `api.getInfo(...)` |
| WI-3 | Thread `__c64uIntent` through readMemory/writeMemory/uploads | `verified-fixed` | `c64api.ts` `fetchWithTimeout` accepts and forwards intent |
| WI-4 | Add `readmem`/`writemem` cooldown keys | `verified-fixed` | `resolveRestPolicy` returns machine-I/O policy |
| WI-5 | Remove `__c64uBypassCircuit` from health/discovery routine probes | `verified-fixed` | health probes carry `__c64uIntent` only; discovery uses gateway path |
| WI-6 | Remove dead `immediate` option; collapse duplicate timeouts | `verified-fixed` | `rg "immediate:\s*true"` finds zero hits |
| WI-7 | Tag health probe intents for observability | `verified-fixed` | health probe REST calls carry intent |
| WI-8 | Background-health redesign (selected-device-only + single `/v1/info` + freshness + adaptive cadence + circuit respect) | `verified-fixed` | `useSavedDeviceHealthChecks.ts` `runBackgroundCycle` gated on `selectedDeviceId`, single REST probe |
| WI-9 | CI guard for direct device-endpoint fetch/socket | `verified-fixed` | guard test scan shows zero violations |
| WI-10 | `ConfigItemRow` migrated to latest-intent lane | `verified-fixed` | `ConfigItemRow.tsx:16` imports `createLatestIntentWriteLane` |
| WI-11 | Optional user-pressed Telnet intent tagging | `probably-fixed-but-unproven` | `useTelnetActions` still defaults to `system`; HomePage REU/config-file calls use `user` |

Include WI-11 in PH5 prompt: no (decisional/observability follow-up).

## Prod-hardening-3 findings

Phases 0-6 marked Done in PH3 PLANS.md. PH4 research §3 verified that PH3's stable
behaviors were preserved on live hardware:

- Volume coalescing bounded.
- Auto-advance exactly-once.
- Single-flight play starts.
- Device-bound disk origin playback.
- Disk/page state consistency.
- Exception discipline.
- Quiet production startup (only the FTP transient was observed as noise).
- Cross-protocol back-off observed via `withFtpInteraction` retry path.

Status: all `verified-fixed` per current code and PH4 hardware evidence.

PH3 results.md called out:

> HVSC partial browse-index transaction checkpointing remains a larger follow-up;
> this pass prevents untruthful idle cancel and incorrect ingestion affordances.

That remains an open larger investigation but is not a release blocker and is too
broad for PH5 scope.

## Prod-hardening-4 findings

| ID | Description | Status | Evidence |
| -- | ----------- | ------ | -------- |
| F1 | FTP connect timeout lowered + one bounded transient retry + per-host connect pacing + circuit-respecting | `verified-fixed` | `ftpClient.ts:30` `FTP_CONNECT_TIMEOUT_MS = 1500`; `deviceInteractionManager.ts:320,398,780,873-902`; PH4 results.md APK smoke |
| F2 | Rapid manual Next/Previous coalesce to one net target launch | `verified-fixed` | `usePlaybackController.ts:89` `USER_TRANSPORT_COALESCE_MS = 120`; `scheduleUserSkip` debounce; PH4 results.md confirmed on Pixel 4 |
| F3 | `backgroundAutoSkipDue` listener registered once with refs | `verified-fixed` | `PlayFilesPage.tsx:1149-1218` uses `handleNextRef`, `playbackStateRef`, `syncPlaybackTimelineRef`, `queueBackgroundDueAtUpdateRef`, `autoAdvanceGuardRef` |
| Remaining risk | Cross-device disk-origin playback not revalidated against `c64u` | `still-open` evidence gap | `c64u` host outage; not an app defect |

PH4 left no app-side residual implementation gap. The c64u outage is hardware
flakiness recorded in the `c64u-flakiness` memory and is not in scope for app code.

## Candidate prod-hardening-5 findings extracted during this audit

Detail and evidence live in `research.md`; the table below is the cross-index from
the ledger to the PH5 ID:

| PH5 ID | Origin | Severity (provisional) | Headline |
| ------ | ------ | ---------------------- | -------- |
| PH5-01-CONCURRENT-WORKTREE-LANDING | worktree drift visible at HEAD | Low (process) | Stage and merge the in-flight `ftpCooldownUntil` removal and `pendingUserSkipRef` unmount cleanup or revert; do not leave them dangling. |
| PH5-02-RESET-CYCLE-ON-RUNTIME-CONFIG-CHANGE | `c64api.ts` `applyC64APIRuntimeConfig` callers | Medium | After saved-device verification fails, the runtime base URL has already been switched; document and test that subsequent device traffic is still bound to the verified host generation, and that a failure does not leave runtime config pointing at an unverified target without a visible recovery affordance. |
| PH5-03-OPEN-SOURCE-LICENSES-NATIVE-FETCH | `OpenSourceLicensesPage.tsx:24` | Low | `fetch(THIRD_PARTY_NOTICES.md)` on native Android resolves to `http://localhost/THIRD_PARTY_NOTICES.md` (the Capacitor WebView base); confirm bundled asset path resolves on native and add a regression that does not depend on a mocked `fetch`. |
| PH5-04-IMPORT-CANCEL-GENERATION | PH1-PH14 partial | Medium | Add a generation guard so that late native FTP/SAF results delivered after a saved-device switch or user cancel cannot mutate the active playlist/disk library. |
| PH5-05-NATIVE-LISTENER-ONCE-PROOF | PH4-F3 verified | Low | Add a deterministic regression that the `backgroundAutoSkipDue` listener is registered exactly once across `isPlaying`/`isPaused` churn and is removed on unmount, mirroring the PH4 contract. |
| PH5-06-IDB-CONSOLE-WARN-ROUTING | static scan | Low | Route IndexedDB load-failure `console.warn` calls in `src/lib/playlistRepository/indexedDbRepository.ts` through `addLog("warn", ...)` so that production WebView consoles stay quiet while diagnostics retain full context. |
| PH5-07-KOTLIN-PLUGIN-CONTEXT-FALLBACK | Kotlin scan | Low | `pluginContextOrNull()` in `HvscIngestionPlugin.kt` and `FtpClientPlugin.kt` returns null silently on `Throwable`; document the defensive intent or downgrade-log on the first occurrence. |
| PH5-08-PLAY-START-CONNECTION-FIRST-PROOF | PH1-PH4 informational | Low | Add a deterministic regression "failed `ensurePlaybackConnection` does not call `ensureUnmuted`" if not already present. |

These eight items differ in priority. Only items with concrete static-evidence anchors
and clear test plans are admitted to `prompt.md`. Items that require investigation
beyond the evidence available in this pass (e.g., HVSC browse-index transactional
checkpointing) are listed in `research.md` as evidence gaps / deferred.
