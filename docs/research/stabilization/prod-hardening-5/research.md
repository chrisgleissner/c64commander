# Prod-Hardening-5 Research

> Pure analysis pass. No production code was modified. All findings are anchored in
> current code (HEAD `d8625c350d22c22ecf294caba2c623c7a7c50c38` on
> `feat/prod-hardening-4`) and prior-hardening evidence.

## 1. Executive summary

Prod-hardening-1 through prod-hardening-4 closed the structural device-safety,
production-noise, and FTP-resilience gaps. The current code base is in good shape:

- All device traffic flows through the four approved gateways (`withRestInteraction`,
  `withFtpInteraction`, `withTelnetInteraction`, `scheduleConfigWrite`).
- `connectionManager.ts` raw-fetch fallback was removed. `validateTarget` uses the
  REST gateway.
- Background health is selected-device-only with hidden/suppression/polling-paused
  guards; `switchDeviceDialog` 10 s full cycle is untouched.
- FTP transient retry, lowered connect timeout, and per-host connect pacing landed
  in PH4.
- Rapid user Next/Previous coalesce to a single net target launch.
- `backgroundAutoSkipDue` listener is registered once with stable refs.
- Production console noise is bounded (gated by smoke mode or storage failures).

The remaining gaps are not release blockers but a small set of evidence-backed
hardening items that further reduce the chance of stale state, improve test
determinism, and quiet IndexedDB load failures.

Four implementation tasks are admitted to `prompt.md`:

1. `PH5-04-IMPORT-CANCEL-GENERATION` (Medium) — Generation guard so late native FTP/
   SAF results delivered after a saved-device switch cannot mutate the active
   playlist or disk library.
2. `PH5-05-NATIVE-LISTENER-ONCE-PROOF` (Low) — Deterministic add/remove counter test
   that the `backgroundAutoSkipDue` native listener is registered exactly once
   across `isPlaying`/`isPaused` churn and is removed on unmount.
3. `PH5-06-IDB-CONSOLE-WARN-ROUTING` (Low) — Route the five `console.warn` calls in
   `src/lib/playlistRepository/indexedDbRepository.ts` through `addLog("warn", ...)`
   so production WebView consoles stay quiet while structured diagnostics retain
   full context.
4. `PH5-01-CONCURRENT-WORKTREE-LANDING` (Low, process) — Adopt or revert the in-flight
   worktree edits to `deviceInteractionManager.ts`, `usePlaybackController.ts`, and
   `usePlaybackController.concurrency.test.tsx` so PH5 ships a clean repository
   without dangling concurrent work.

Items rejected or deferred (rationale in §6).

## 2. Method

### Repository baseline

- Branch: `feat/prod-hardening-4`
- HEAD: `d8625c350d22c22ecf294caba2c623c7a7c50c38`
- `git status --short` (unchanged during the pass):
  - `M src/lib/deviceInteraction/deviceInteractionManager.ts`
  - `M src/pages/playFiles/hooks/usePlaybackController.ts`
  - `M tests/unit/playFiles/usePlaybackController.concurrency.test.tsx`
- Package version: from `package.json` (current branch builds `c64commander-0.8.5-rc2-debug.apk`).

### Static scans

See `WORKLOG.md` "Static scans" for full command output. Summary:

- Device-call boundary scan: zero device-endpoint `fetch` calls outside the
  approved gateways.
- Gateway/scheduler scan: callers limited to `c64api.ts`, `ftpClient.ts`, `telnet/*`,
  `healthCheckEngine.ts`, `applyConfigFileReference.ts`, `configWriteThrottle.ts`,
  `useTelnetActions.ts`, `HomePage.tsx`.
- High-frequency interaction scan: latest-intent lanes in place on every device-bound
  slider; playback transport coalesces user-initiated skips (auto-advance excluded).
- Exception/logging scan: 7 bare catches in TS, all documented intentional
  fallbacks. 2 Kotlin `Throwable -> null` accessors for Capacitor bridge teardown
  defense.
- State persistence scan: `playlistRepositorySync.buildSnapshotKey` includes all
  persisted item fields. Saved-device switch calls `resetInteractionState` and
  cancels TanStack queries.
- Native and lifecycle scan: `backgroundAutoSkipDue` listener uses stable refs.

### Dynamic / hardware evidence

Hardware probes were performed only to record device availability for the future
implementation pass; no APK was deployed or tested:

- `curl --max-time 5 -sS http://u64/v1/info` → 200 with `Ultimate 64 Elite`,
  firmware `3.14e`. Reachable.
- `curl --max-time 5 -sS http://c64u/v1/info` → `curl: (56) Recv failure: Connection
  reset by peer`. Currently unreachable (consistent with the documented
  `c64u-flakiness` memory).
- `adb devices` → `9B081FFAZ001WX` attached (Pixel 4 with `9B0` prefix).

These probes are evidence of availability only; no validation runs were performed.

## 3. Prior-hardening guarantee audit

See `issue-ledger.md` for the full per-finding table. Top-level verdict:

| Hardening pass | Findings | Verified-fixed | Probably-fixed | Partially-fixed | Open |
| -------------- | -------- | --------------- | -------------- | ---------------- | ---- |
| PH1 | 15 | 11 | 2 | 1 | 1 (HVSC partial-checkpoint deferred) |
| PH2 | 11 work items | 10 | 1 (WI-11 decisional) | 0 | 0 |
| PH3 | 6 phases | 6 | 0 | 0 | 0 |
| PH4 | 3 findings | 3 | 0 | 0 | 0 |

No prior-pass acceptance criterion is currently violated in code.

## 4. Findings (admitted to prompt.md)

### PH5-04-IMPORT-CANCEL-GENERATION

- Severity: Medium.
- Class: Stale-result isolation (priority 5 in the deterministic order).
- Affected files (provisional, implementation may refine):
  - `src/pages/playFiles/handlers/addFileSelections.ts`
  - `src/pages/PlayFilesPage.tsx`
  - `src/hooks/useDiskLibrary.ts` (and Disks page integration)
  - new file or augmentation: a switch-aware abort signal.
- Observed code shape:
  - `addFileSelections` accepts `addItemsAbortControllerRef` and threads
    `abortSignal` into `source.listFilesRecursive`.
  - `PlayFilesPage.tsx:1109` aborts the controller only on user Cancel.
  - `useSavedDeviceSwitching.ts:61` calls `resetInteractionState("saved-device-switch")`
    which causes the FTP gateway to throw `InteractionCancelledError` for queued
    tasks, but does not abort the JS-level `addItemsAbortControllerRef`.
  - No generation guard exists on the playlist or disk-library setters
    (`rg -n "generation|deviceGeneration|switchGeneration"` returns no hits in
    `addFileSelections.ts` or `sourceNavigation/`).
  - Already-resolved native FTP listings or SAF reads completed before the switch
    can still trigger `appendPlayableFile` or `useDiskLibrary.addDisks` because the
    cooperative cancellation point (`throwIfAborted`) sees an un-aborted signal.
- Why it matters to users / device safety:
  - After a saved-device switch from `u64` to `c64u`, an in-flight recursive import
    started against `u64` could continue to enumerate or append items derived from
    `u64`. The user experiences "ghost" items, or worse, items whose backend
    refs target a host no longer selected.
  - Disk-library entries can carry a `device-bound origin` host that does not
    match the active saved device (PH4 architecture is "device-bound origin", which
    is correct only when the entry was created before the switch — adding entries
    *after* the switch from the old device is incorrect).
- Required behavior:
  1. Make `addItemsAbortControllerRef` and the equivalent disk-library abort
     subscribe to the saved-device switch event (or expose a `cancelImportOnSwitch`
     subscription in `useSavedDeviceSwitching`).
  2. Tag each import with a generation token derived from the saved-device id at
     start; refuse to mutate playlist/disk-library state if the active generation
     has changed when a chunk completes.
  3. Treat the resulting abort as a clean cancellation (debug log + the existing
     "Add cancelled" diagnostic), not a production error.
  4. Preserve recursive enumeration, source navigation, SAF/local file features,
     and existing AbortController behavior.
- Regression tests (deterministic, no real hardware):
  - Unit: simulate a recursive import in progress, fire the saved-device switch
    side effect, verify zero post-switch `appendPlayableFile`/`addDisks` calls and
    one classified cancellation log.
  - Unit: same flow with the import already at the final batch — verify that
    pre-switch already-committed items remain.
  - Unit: ensure user Cancel still works independently of saved-device switch.
- Hardware proof: not strictly required (deterministic JS-level proof is enough),
  but PH4 had a witnessed cross-device disk-origin replay against `u64` that can
  be exercised again if `c64u` is reachable.
- Non-regression: no change to source-agnostic Play UI; no change to disk-library
  contract; auto-advance unchanged.

### PH5-05-NATIVE-LISTENER-ONCE-PROOF

- Severity: Low.
- Class: Test uplift on a previously fixed bug (priority 9).
- Affected files: `tests/unit/pages/playFiles/PlayFilesPage.featureFlagContracts.test.ts` or
  a new focused test file under `tests/unit/pages/playFiles/`.
- Observed code shape:
  - `PlayFilesPage.tsx:1149-1218` registers the listener once via the effect's
    stable ref deps `[autoAdvanceGuardRef, handleNextRef, playbackStateRef,
    queueBackgroundDueAtUpdateRef, syncPlaybackTimelineRef]`.
  - PH4 results.md confirmed correct behavior on Pixel 4.
  - No deterministic add/remove counter assertion is currently visible at the
    PlayFilesPage layer (PH4 added behavior tests in usePlaybackController*).
- Why it matters:
  - The PH4 fix is correct; the test layer should pin the contract so a future
    refactor reintroducing volatile deps fails fast.
- Required behavior:
  1. Mount the Play Files page (or a thin harness) with a mocked
     `BackgroundExecution.addListener`/`removeListener` and `onBackgroundAutoSkipDue`.
  2. Drive `isPlaying`/`isPaused`/`currentIndex` transitions.
  3. Assert: `addListener` called exactly once; `removeListener` called only on
     unmount.
- Regression tests: the test itself.
- Hardware proof: none required.
- Non-regression: native event delivery still triggers exactly-once auto-advance.

### PH5-06-IDB-CONSOLE-WARN-ROUTING

- Severity: Low.
- Class: Production diagnostics discipline (priority 8).
- Affected files: `src/lib/playlistRepository/indexedDbRepository.ts`.
- Observed code shape:
  - 5 raw `console.warn(...)` calls (l.173, 265, 275, 287, 298) for IndexedDB
    open/load/schema-mismatch failures.
  - `src/lib/diagnostics/logger.ts` forwards `console.warn` into the structured log
    bridge, but the original console emit still occurs, contributing to WebView
    console noise on Android.
- Why it matters:
  - Production WebView console is monitored via CDP (PH4 evidence channel). Reducing
    raw `console.warn` to `addLog("warn", ...)` keeps diagnostics complete and the
    raw console quiet.
- Required behavior:
  1. Replace the 5 `console.warn(...)` calls with `addLog("warn", ...)` and an
     equivalent details payload.
  2. Preserve all error context (error message, store, version, etc.).
  3. Ensure unit tests asserting log emission still pass; update if they assert the
     specific code path.
- Regression tests:
  - Unit: trigger each IndexedDB failure path with a stub and assert one
    `addLog("warn", ...)` per failure, with the expected context.
- Hardware proof: not required.
- Non-regression: persistence behavior unchanged; only the log channel changes.

### PH5-01-CONCURRENT-WORKTREE-LANDING

- Severity: Low (process).
- Class: Process hygiene; not a code defect.
- Affected files (worktree state at session start):
  - `src/lib/deviceInteraction/deviceInteractionManager.ts` (removes unused
    `ftpCooldownUntil` map; FTP cooldown is now `ftpConnectCooldownUntil` + pacing).
  - `src/pages/playFiles/hooks/usePlaybackController.ts` (adds an unmount cleanup
    for `pendingUserSkipRef`).
  - `tests/unit/playFiles/usePlaybackController.concurrency.test.tsx` (88-line
    addition).
- Observed code shape:
  - Per CLAUDE.md "Mandatory handling of concurrent changes", these were left
    untouched during this analysis pass. They are recorded in `WORKLOG.md`.
  - The implementation pass must decide whether to land them as-is (with their own
    targeted tests) or revert them. PH5 should not silently overwrite them.
- Why it matters:
  - Leaving an in-flight concurrent edit alongside PH5 code changes risks
    inconsistent CI runs and unclear authorship.
- Required behavior:
  1. Confirm whether the concurrent edits are intended (e.g., from another LLM run).
  2. If intended, run the targeted test for the concurrency test file and verify
     coverage; include them in the PH5 commit boundary.
  3. If unintended, revert them in a separate commit explained in `WORKLOG.md`.
- Regression tests: `npm run test --
  tests/unit/playFiles/usePlaybackController.concurrency.test.tsx`.
- Hardware proof: not required.
- Non-regression: see test results.

## 5. Findings deprioritized or deferred

### PH5-02-RESET-CYCLE-ON-RUNTIME-CONFIG-CHANGE

- Severity: Low evidence.
- Reason for deprioritization: `useSavedDeviceSwitching` correctly records the
  verification outcome (`failSavedDeviceVerification`); the badge and toast surface
  the failure. Traffic-derived health from PH3 ensures subsequent failed calls
  update health without an extra probe. No witnessed user-facing defect; revisiting
  this would require a UX decision (auto-revert on failed verification vs. allow
  the user to retry on the new target). Not in PH5 scope.

### PH5-03-OPEN-SOURCE-LICENSES-NATIVE-FETCH

- Severity: Low.
- Reason: Existing 6 unit tests in `tests/unit/pages/OpenSourceLicensesPage.test.tsx`
  cover success, failure, close, and table-rendering cases. PH3/PH4 native deploy
  validated the bundled asset path. No code defect observed.

### PH5-07-KOTLIN-PLUGIN-CONTEXT-FALLBACK

- Severity: Low.
- Reason: Two Kotlin `pluginContextOrNull()` methods catch `Throwable` to return
  `null`. They guard against Capacitor bridge teardown when called outside the
  plugin lifecycle. Logging here on every call would generate noise during normal
  teardown. PH4 research §3 explicitly accepted these as documented defensive
  fallbacks. Not a release blocker.

### PH5-08-PLAY-START-CONNECTION-FIRST-PROOF

- Severity: Low.
- Reason: Ordering is in place; the deterministic spy regression for
  "failed connection ⇒ no unmute" is informational coverage uplift. The existing
  controller tests indirectly cover this through error-path assertions. Not
  blocking.

### HVSC partial browse-index transaction checkpointing

- Severity: Unknown (carried forward from PH3 results.md).
- Reason: PH3 results.md flagged this as a larger follow-up. The investigation
  needs to span `src/lib/hvsc/hvscBrowseIndexStore.ts`, native ingestion paths, and
  recovery semantics. It exceeds the surgical PH5 scope. Recorded here so it is not
  forgotten and can drive a dedicated future hardening pass.

### Migrate `useTelnetActions` default intent from `system` to `user`

- Severity: Low (PH2-WI-11 deferred).
- Reason: HomePage REU/config-file callers already pass `user`. Other callers are
  legitimately background/system. Decision belongs to product priority, not PH5.

## 6. Recommended PH5 task list (final)

In deterministic priority order:

1. PH5-04-IMPORT-CANCEL-GENERATION (Medium).
2. PH5-05-NATIVE-LISTENER-ONCE-PROOF (Low).
3. PH5-06-IDB-CONSOLE-WARN-ROUTING (Low).
4. PH5-01-CONCURRENT-WORKTREE-LANDING (Low, process).

## 7. Explicit non-regression guarantees the implementation pass must preserve

- Approved device-call gateways: REST/FTP/Telnet/scheduleConfigWrite.
- `switchDeviceDialog` 10 s full saved-device health cycle, unchanged in cadence,
  fan-out, and CONFIG pulse.
- Selected-device-only `backgroundMaintenance` with hidden/suppression/polling
  pause/foreground-switch guards.
- Circuit breaker respect on routine probes; no `__c64uBypassCircuit` on health or
  discovery.
- `readmem`/`writemem` cooldown spacing; correct `__c64uIntent` tagging.
- Slider latest-intent coalescing (Home lighting, Config, Play volume, AudioMixer).
- Background auto-skip listener registered exactly once with stable refs.
- FTP transient retry with circuit-breaker respect; per-host connect pacing;
  lowered connect timeout (1500 ms).
- Rapid user Next/Previous coalesce to one net target; auto-advance non-coalesced.
- Device-bound disk origin playback after device switch.
- Disk/page mounted-state reconciliation.
- Exception discipline: no new bare swallow.
- Quiet production startup; no Google Fonts on native.
- Traffic-derived background health.
- Idle app produces zero background fan-out.
- Source-agnostic Play page UI behavior.
- Saved-device switch cancellation isolation (scheduler queues + TanStack queries).
- Playlist repository snapshot key derived from full serialized payload.

## 8. Test and coverage strategy

- All PH5 fixes must include deterministic Vitest regressions.
- For PH5-04 the new tests must run with `vi.useFakeTimers()` where appropriate and
  must not introduce real-time sleeps.
- For PH5-06 the existing IndexedDB tests in `tests/unit/lib/playlistRepository/`
  should be extended; do not add a duplicate test file.
- Global branch coverage must stay >= 91% (PH4 last measured 91.66%).
- Changed-line patch coverage must remain >= 91% for executable TS/TSX changes;
  reuse the local script approach used in PH4 (no repository patch-coverage tool
  was found in PH4).
- Android JVM tests are only required if Android/Kotlin code changes (PH5-07 was
  rejected, so no Kotlin changes are planned).

## 9. Hardware / mobile validation strategy

- The implementation pass must re-probe `http://u64/v1/info` and
  `http://c64u/v1/info` and record exact outcomes.
- Pixel 4 with serial prefix `9B0` should be used.
- Hardware validation for PH5-04 is desirable but not strictly required —
  deterministic unit proof is sufficient because the failure mode is JS-level.
- If `c64u` remains unreachable, record the blocker and proceed against `u64` only.

## 10. Remaining uncertainty

- HVSC partial browse-index transaction checkpointing (PH3 follow-up): the precise
  failure mode and recovery semantics require a dedicated investigation. Not in
  PH5 scope.
- The concurrent worktree edits at HEAD may indicate an in-flight LLM run that PH5
  must coordinate with at landing time. The implementation pass must inspect git
  state before claiming completion.
- `c64u` flakiness (memory `c64u-flakiness`) continues to block intermittent
  cross-device validation. This is firmware-side, not an app defect.
