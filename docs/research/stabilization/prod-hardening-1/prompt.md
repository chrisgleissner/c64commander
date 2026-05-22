# PROD_HARDENING_1 - Production hardening review and convergence prompt

Date: 2026-05-22

This document is the handoff for a follow-up LLM session. It is intentionally written as both a review report and an execution prompt. The next session should use it to converge the C64 Commander app toward production readiness with proof on real Android hardware and real C64 Ultimate devices.

Document classification: DOC_ONLY.

Implementation work spawned from this document will be CODE_CHANGE, DOC_PLUS_CODE, or UI_CHANGE depending on the touched files. Follow `.github/copilot-instructions.md` and `AGENTS.md` exactly for validation.

## Non-regression mandate

Production hardening must preserve the existing app. Do not remove, hide, disable, narrow, or downgrade features to make the app faster or quieter. If a feature is slow, make that same feature responsive. If a workflow emits errors, fix the root cause while keeping the workflow available.

This mandate covers all user-visible and device-facing behavior, including Play Files, playlist search and view-all, item selection, local SAF sources, HVSC, CommoServe, Ultimate FTP browsing, disk mount/upload, Telnet controls, REST config reads/writes, saved-device switching, playback, mute/volume handling, background/autoskip behavior, diagnostics, config snapshots, Save/Revert flows, tests, and documented UX affordances.

No fix is accepted if it regresses existing behavior, data persistence, saved settings, diagnostics, cross-device operation, or platform parity. Any intentional behavior change must be called out, justified, covered by regression tests, and proven on the Pixel 4 against real hardware. Prefer feature-equivalent optimizations, cancellation, batching, scoping, debouncing, and better scheduling over feature removal.

## Hardware baseline observed during this review

Use this baseline unless later probes prove it stale.

- Pixel 4 over ADB: serial `9B081FFAZ001WX`
- Android device model: Pixel 4
- Installed package: `uk.gleissner.c64commander`
- Current installed app during review: versionName `0.7.9-rc1`, versionCode `1992`
- Latest local APK during review: `android/app/build/outputs/apk/debug/c64commander-0.7.9-rc1-debug.apk`

Primary Ultimate device:

- Host: `u64`
- Probe: `http://u64/v1/info`
- Product: `Ultimate 64 Elite`
- Firmware: `3.14e`
- FPGA: `122`
- Core: `1.4B`
- Hostname: `Ultimate-64-Elite-F83C87`
- Unique ID: `38C1BA`

Secondary Ultimate device:

- Host: `c64u`
- Probe: `http://c64u/v1/info`
- Product: `C64 Ultimate`
- Firmware: `1.1.0`
- FPGA: `122`
- Core: `1.49`
- Hostname: `c64u`
- Unique ID: `5D4E12`

## Prompt for the next LLM session

You are an expert Capacitor, Android, iOS, and web app engineer. Your task is to converge C64 Commander for production go-live by addressing the findings in this document in priority order while preserving all existing features. You must prove fixes locally with tests and on a real Pixel 4 connected through ADB, with the app talking to the real `u64` and `c64u` Ultimate devices.

Start by reading:

1. `AGENTS.md`
2. `.github/copilot-instructions.md`
3. This document: `docs/research/stabilization/prod-hardening-1/prompt.md`
4. `docs/research/stabilization/responsiveness2/FINDINGS.md`
5. `docs/research/stabilization/responsiveness3/FINDINGS.md`
6. `docs/research/stabilization/responsiveness3/IMPLEMENTATION_PROMPT.md`
7. `docs/research/stabilization/responsiveness3/HANDOVER_PROMPT.md`
8. `docs/ux-guidelines.md` before any UI or playlist UX change
9. `docs/testing/maestro.md` before any Maestro flow change

Then run Phase 0 below before modifying code.

Do not hide errors, weaken tests, or suppress diagnostics to make the app look clean. The production target is that the app performs correctly and does not emit avoidable error, warning, or noisy diagnostic output. Any caught exception must be logged with stack trace and context, or rethrown with context, in line with repository policy.

Do not weaken features to improve performance. Keep feature parity for existing workflows, persistence, item actions, selection behavior, REST/FTP/Telnet capabilities, diagnostics, and platform support. Where this document identifies a potential issue, verify it against current HEAD before changing code; if it is not reproducible, document the evidence rather than making speculative changes.

Every code fix must include a regression test that would fail before the fix. Every code-change task must run `npm run test:coverage` and satisfy at least 91 percent global branch coverage before completion. If Android code changes, run the relevant Android JVM tests. Before completion, build and deploy the latest APK to the Pixel 4, launch it, and prove the touched behavior on device.

Store command output, screenshots if needed, and log excerpts under:

`docs/research/stabilization/prod-hardening-1-evidence/`

Use short, dated filenames. Keep evidence targeted.

## Phase 0 - Evidence refresh before code changes

Purpose: avoid stacking new fixes on stale assumptions. Previous responsiveness iteration evidence left at least one switch-back proof blocked because `c64u` had connection-reset behavior. During this review, `c64u` was reachable, so re-run the existing acceptance evidence first.

Required probes:

```bash
adb devices
curl --max-time 5 -sS http://u64/v1/info
curl --max-time 5 -sS http://c64u/v1/info
```

Required app proof on Pixel 4:

1. Install the latest built APK to `9B081FFAZ001WX`.
2. Launch `uk.gleissner.c64commander`.
3. Capture first 12 seconds of cold-boot logcat and count Capacitor REST requests.
4. Repeat cold boot against both `u64` and `c64u`.
5. Capture Telnet plugin activity during the same window.
6. Switch saved devices `u64 -> c64u -> u64` and prove no per-item enrichment storms.
7. Exercise CPU slider, playback start while muted, lock/unlock, background/foreground.

Target outcomes from previous hardening:

- Cold boot REST request count should stay within the prior budget, about 30 or fewer Capacitor HTTP requests in the first 12 seconds.
- Telnet discovery should not storm.
- Saved-device switching should not enqueue per-item config enrichment reads.
- Playback and slider flows should not emit avoidable errors or warnings.

If Phase 0 fails, fix the regression before moving to lower-priority findings.

## Finding PH1-PLAYLIST-QUERY - Query-backed playlist filtering still does full React memory work

Severity: Critical.

Affected files:

- `src/pages/playFiles/hooks/useQueryFilteredPlaylist.ts`
- `docs/ux-guidelines.md`

Why this matters:

`docs/ux-guidelines.md` requires query-driven playlist filtering and rendering for large local datasets. The current hook still performs full-array React memory work before using the repository-backed query path. This can break responsiveness with large HVSC or local playlist data, especially on Pixel 4.

Observed code shape:

- `useQueryFilteredPlaylist.ts` builds `playlistItemsById = new Map(playlist.map(...))` from the full playlist.
- It computes `memoryFilteredPlaylist = playlist.filter(...matchesPlaylistQuery...)` with `query` in the dependency list.
- This happens even when `repositoryReady` is true and the repository query backend will be used later.
- Fallback code also full-filters after repository query failure.

Expected fix:

1. In the repository-ready path, do not full-filter the React playlist array on each query change.
2. Avoid rebuilding full playlist maps on each query if the repository can return enough data or if a stable index can be maintained separately.
3. Keep memory fallback only for non-repository or explicitly small lists.
4. For large lists, if repository query fails, surface a clear diagnostic state or temporarily retain stale previous results while preserving full search correctness once the repository recovers.
5. Do not remove full-list search, result completeness, sorting, filtering, item actions, or large-list browsing to reduce work.
6. Keep behavior deterministic and testable.

Regression tests:

- Add a unit test proving that when `repositoryReady` is true, changing the query does not call the memory matcher across the full playlist.
- Include a large-list fixture or spy-based test that would fail with the current full-array filter.
- Add a repository-error test proving the large-list path does not fall back to synchronous full React filtering.

Pixel 4 proof:

- Load or simulate a large playlist/HVSC dataset.
- Type several search queries on the Play Files screen.
- Capture responsiveness evidence and relevant logs.
- Prove no avoidable console warnings/errors and no visible input jank.
- If benchmark probes are available, capture the playlist-filter timing and show it stays within budget.

Completion criteria:

- `npm run test:coverage` passes with at least 91 percent branch coverage.
- APK deployed to Pixel 4.
- Play Files search/filter is proven responsive on device.

## Finding PH2-IDLE-CONFIG-SNAPSHOT - Idle config snapshot can perform foreground-priority config sweeps

Severity: High.

Affected files:

- `src/hooks/useAppConfigState.ts`
- `src/lib/c64api.ts`
- Any tests covering app config snapshot behavior

Why this matters:

The app currently schedules an idle config snapshot after connection if no snapshot exists. The fetch path calls all config categories and category items without a background intent or abort signal. It only checks in-flight reads and polling pauses before starting. It does not appear to cancel on app visibility, route changes, or user interaction. On a real Ultimate device, this can create a full REST sweep shortly after launch or while the app is backgrounded.

Observed code shape:

- `fetchAllConfig` calls `api.getCategories()` and then `api.getCategory(category)`.
- The idle capture is scheduled about 5 seconds after connection.
- The gate checks in-flight read requests and `pollingPauseRegistry.isPollingPaused()`.
- The sweep is not marked as background work.
- No explicit app visibility cancellation was observed in this path.

Additional direct evidence from this document's completion launch check:

- After installing `android/app/build/outputs/apk/debug/c64commander-0.7.9-rc1-debug.apk` and cold-launching on Pixel 4 serial `9B081FFAZ001WX`, filtered logcat showed a burst of `/v1/configs/...` requests shortly after startup against the current device IP.
- The burst included `LED Strip Settings`, `U64 Specific Settings`, `C64 and Cartridge Settings`, `User Interface Settings`, both drive settings, `SID Sockets Configuration`, `UltiSID Configuration`, `SID Addressing`, `Audio Mixer`, and `Data Streams`.
- The same launch did not show fatal AndroidRuntime, Capacitor console, TypeError, ReferenceError, or unhandled-error entries in the filtered startup scan.

Expected fix:

1. Split config snapshot fetching into user-initiated and idle/background modes.
2. Idle mode must use background REST intent and an abort signal.
3. Cancel or skip idle capture when the app is hidden, backgrounded, not on a relevant screen, or user interaction begins.
4. Cancel or defer idle capture during playback, sliders, Telnet operations, config writes, or polling pauses.
5. Preserve Save/Revert and config snapshot semantics. If automatic idle capture remains risky, gate, cancel, or defer it; do not remove the workflow unless an equivalent feature is implemented and proven.
6. Preserve diagnostics: if capture is skipped or canceled, make the state understandable without noisy logs.

Regression tests:

- Idle snapshot does not start while `document.hidden` is true.
- Idle snapshot uses background intent.
- Idle snapshot cancels on app visibility change.
- User-initiated snapshot still uses the intended foreground behavior and error reporting.

Pixel 4 proof:

- Cold launch connected to `u64`; background the app before the idle delay expires; wait longer than the delay; prove no config snapshot sweep in logcat.
- Foreground the app; prove any resumed snapshot is rate-limited and does not interfere with CPU slider or playback start.
- Repeat a smoke path against `c64u`.

Completion criteria:

- Targeted tests and coverage pass.
- APK deployed and launched on Pixel 4.
- Logcat proof shows no hidden/background config sweep.

## Finding PH3-BACKGROUND-REDISCOVERY - Connection rediscovery timer lacks app visibility gating

Severity: High.

Affected files:

- `src/components/ConnectionController.tsx`
- Connection discovery tests

Why this matters:

When the app is in demo or offline state, `ConnectionController` schedules background rediscovery probes. This is useful in foreground, but it should not keep probing and logging while Android has backgrounded the app. Hidden/background REST work can create error noise and unnecessary device traffic.

Observed code shape:

- The controller schedules background probes for `DEMO_ACTIVE` and `OFFLINE_NO_DEMO`.
- The timer callback calls `discoverConnection("background")`.
- No app visibility or Android lifecycle gate was observed in that scheduling path.

Expected fix:

1. Cancel rediscovery timers when the app is hidden or backgrounded.
2. Re-arm a rate-limited probe when the app becomes visible again.
3. Preserve the current foreground reconnection behavior.
4. Avoid emitting warnings for expected hidden/background skips.

Regression tests:

- Hidden app state does not schedule rediscovery.
- A scheduled timer is canceled when the app becomes hidden.
- Returning visible schedules at most one rate-limited background probe.

Pixel 4 proof:

- Configure the app into demo/offline state.
- Clear logcat, launch, press Home, wait beyond the rediscovery interval or use a controlled test interval if available.
- Prove no hidden/background discovery REST requests or avoidable errors.
- Foreground the app and prove a single reconnect attempt can run.

Completion criteria:

- Tests and coverage pass.
- APK deployed and launched on Pixel 4.
- Background/foreground logcat proof captured.

## Finding PH4-PLAYBACK-START-UNMUTE - Playback start can unmute before connection proof

Severity: High.

Affected files:

- `src/pages/playFiles/hooks/usePlaybackController.ts`
- `src/pages/playFiles/hooks/useVolumeOverride.ts`
- `tests/unit/playFiles/usePlaybackController.test.tsx`

Why this matters:

Playback start currently calls `ensureUnmuted({ refreshItems: true })` before `ensurePlaybackConnection()`. `ensureUnmuted` can read config items and queue writes. If the app says connected but discovery or readiness has not been proven, the playback flow can fail as a generic playback start error due to mute/config work, rather than a clear connection error. It can also create REST traffic before the playback connection path has established readiness.

Observed code shape:

- `usePlaybackController.ts` calls `ensureUnmuted` before `ensurePlaybackConnection`.
- `ensureUnmuted` with `refreshItems: true` can call `resolveEnabledSidVolumeItems(true)` and config-item reads.
- The unmute write path is not clearly wrapped in the same polling pause discipline as volume slider/toggle flows.
- Existing tests assert the current order and will need to be updated if the order changes.

Expected fix:

1. Ensure playback connection first.
2. Only run unmute work after connection proof succeeds.
3. If connection proof fails, report a connection-specific error and do not attempt unmute reads/writes.
4. Wrap unmute writes in the existing polling pause discipline or document and test why playback write protection is sufficient.
5. Keep mute and volume behavior unchanged for successful starts.

Regression tests:

- Playback connection is attempted before unmute.
- Failed connection does not call `ensureUnmuted`.
- Muted playback start produces the intended unmute write after connection proof.
- Error classification remains specific and user-readable.

Pixel 4 proof:

- Set SID output muted.
- Cold launch and immediately start a SID.
- Prove audio starts unmuted without `Device not ready for requests`, generic playback failure, or unclassified console errors.
- Repeat once against `u64` and once against `c64u`.

Completion criteria:

- Tests and coverage pass.
- APK deployed and launched on Pixel 4.
- Playback start evidence captured.

## Finding PH5-EXCEPTION-POLICY - Silent catches remain in production-relevant code

Severity: Critical release blocker.

Affected files observed during review:

- `android/app/src/main/java/uk/gleissner/c64commander/HvscIngestionPlugin.kt`
- `src/lib/hvsc/hvscBrowseIndexStore.ts`
- `src/lib/savedDevices/store.ts`
- `src/components/itemSelection/ArchiveSelectionView.tsx`
- `src/lib/diagnostics/logger.ts`
- Any other source files found by a fresh catch-block scan

Why this matters:

Repository policy makes silent exception handling a release blocker. Production hardening cannot be complete while caught exceptions are swallowed without context. Some catches may be best-effort cleanup or parse fallback, but they still need explicit handling, logging, or a narrow documented helper that records context without flooding logs.

Observed examples:

- Empty catches around HVSC cleanup and callback unregister logic in `HvscIngestionPlugin.kt`.
- Parse and filesystem fallback catches in `hvscBrowseIndexStore.ts` that return null or fallback values without logging.
- Saved-device JSON parse fallback returns null silently.
- Archive selection preview parser catches and returns an empty string silently.
- Logger JSON stringify fallback returns `String(value)` without recording that serialization failed.

Expected fix:

1. Re-run a catch-block scan over `src`, `android/app/src/main/java`, and test helpers.
2. For every caught exception, either rethrow with context or log with stack trace and relevant identifiers.
3. For expected best-effort cleanup, log at a low-noise warning/debug level with path or operation context.
4. For expected parse fallback, prefer a shared helper that logs once per key/path/session to avoid noisy repeated logs.
5. Add a guardrail: ESLint rule, custom script, or test that fails on empty catch blocks and obvious unlogged fallback catches, with a small explicit allowlist if absolutely necessary.

Regression tests:

- Unit tests around saved-device parse failure logging.
- Unit tests around HVSC browse-index parse/file failure logging or rethrow behavior.
- Android JVM test or targeted Kotlin test for cleanup/unregister logging if feasible.
- Guardrail test/script proving empty catches are not allowed.

Validation:

```bash
rg -n "catch \\{" src android/app/src/main/java test android/app/src/test -S
rg -n "catch \\([^)]*\\) \\{\\s*(return|null|undefined|/\\*|//|\\})" src android/app/src/main/java -S
```

The exact regex can be improved, but completion must include a documented scan result.

Completion criteria:

- No unlogged silent catches remain in production code.
- Tests and coverage pass.
- Android tests pass if Android code changed.
- APK deployed and launched on Pixel 4.
- Logcat smoke run shows no new noisy warnings during normal startup.

## Finding PH6-PRODUCTION-LOG-NOISE - HVSC perf console logs and remote font loading can create production noise

Severity: High.

Affected files:

- `src/pages/playFiles/playlistRepositorySync.ts`
- `src/pages/playFiles/handlers/addFileSelections.ts`
- `src/main.tsx`
- Diagnostics/logging helpers

Why this matters:

The production goal is not just "no fatal errors"; it is also no avoidable warnings, external-network failures, or debug/perf console noise in normal use. Current code still emits HVSC perf `console.info` messages and dynamically injects a Google Fonts stylesheet. On a LAN-first native app, a remote font request can fail offline and produce Chromium/logcat noise. Perf output should be available through diagnostics, not unconditional production console output.

Observed code shape:

- `playlistRepositorySync.ts` emits `[hvsc-perf]` with `console.info`.
- `addFileSelections.ts` emits several `[hvsc-perf]` messages with `console.info`.
- `main.tsx` appends a Google Fonts stylesheet after first paint unless test probes are enabled.

Expected fix:

1. Replace unconditional perf `console.info` calls with gated diagnostics logging.
2. Use a local perf scope or diagnostics flag so developers can enable the data without production noise.
3. Add a no-console guardrail for production app code, with a narrow allowlist if needed.
4. Bundle fonts locally or use system fonts instead of dynamic Google Fonts injection in native production.
5. Preserve typography, startup rendering, web behavior, and developer diagnostics; do not remove useful diagnostic data, only gate it appropriately.

Regression tests:

- Tests proving HVSC import/sync paths do not call `console.info` by default.
- Test or lint guardrail proving production source has no unapproved `console.*` calls.
- If font loading changes, smoke test initial render and typography fallback.

Pixel 4 proof:

- Clear logcat and launch the app.
- Run a representative HVSC import or playlist repository sync.
- Prove no `[hvsc-perf]` console output by default.
- Prove no Google Fonts or external stylesheet network failures.

Completion criteria:

- Tests and coverage pass.
- APK deployed and launched on Pixel 4.
- Logcat proof captured for startup and HVSC action.

## Finding PH7-PRIOR-FIX-EVIDENCE-GAP - Previous switch-back validation should be completed now that c64u is reachable

Severity: High evidence blocker.

Affected files:

- Evidence and docs only unless the rerun exposes a regression
- Previous evidence under `docs/research/stabilization/responsiveness3/evidence/`

Why this matters:

Previous responsiveness work documented that a full `u64 -> c64u -> u64` proof was pending because the `c64u` probe failed with a connection reset. During this review, `c64u` responded successfully. Production go-live should not rely on stale blocked evidence.

Expected work:

1. Re-run the previous saved-device switch proof on current HEAD.
2. Capture exact request counts and Telnet counts.
3. Prove config-enrichment caches prevent per-item storms during switch-back.
4. If the proof fails, fix the regression before addressing lower-priority issues.

Pixel 4 proof:

- Start on `u64`, switch to `c64u`, then switch back to `u64`.
- Capture logcat and any app diagnostic output.
- Record REST request counts by endpoint and Telnet plugin events.
- Confirm no avoidable errors or warnings.

Completion criteria:

- Evidence file added under `docs/research/stabilization/prod-hardening-1-evidence/`.
- If no code changed, no build or tests are required beyond the required APK deployment and device validation.
- If code changed, full code-change validation applies.

## Finding PH8-PLAYLIST-REPOSITORY-SNAPSHOT-KEY - Snapshot key can miss persisted playlist metadata

Severity: Critical.

Affected files:

- `src/pages/playFiles/playlistRepositorySync.ts`
- Playlist repository persistence tests

Why this matters:

Playlist repository commits can be skipped when only persisted metadata changes. That creates a serious data-loss risk after restart or device switch: the UI state can show a playlist item config, duration override, or unavailable reason, while the repository snapshot remains stale because the snapshot key did not change.

Observed code shape:

- `buildSnapshotKey` includes `playlistId`, item count, item id, path, source, song number, status, added time, and index.
- `serializePlaylistToRepository` persists additional fields such as `configRef`, `configOrigin`, `configOverrides`, `durationOverrideMs`, `unavailableReason`, and source/origin metadata.
- `commitPlaylistSnapshot` uses the snapshot key to collapse or skip commits and later marks the repository state as ready with that key.

Expected fix:

1. Include every field that affects serialized repository state in the snapshot key, or derive the key from the serialized payload itself.
2. Preserve all playlist persistence features, including config associations, config overrides, duration overrides, unavailable metadata, source fields, and item order.
3. Keep commit coalescing and skip behavior for truly identical snapshots.
4. Make stale-snapshot diagnostics explicit if a commit fails.

Regression tests:

- Changing only `durationMs` or `durationOverrideMs` changes the snapshot key and persists the updated duration.
- Attaching, removing, or changing `configRef`, `configOrigin`, and `configOverrides` changes the key and persists.
- Changing persisted unavailable/status/source metadata is not skipped by the commit gate.
- An unchanged playlist still avoids redundant commits.

Pixel 4 proof:

- On Pixel 4, attach a config to a playlist item, change duration, restart the app, and verify both values persisted.
- Repeat against at least one representative local or HVSC item and one Ultimate-backed item if feasible.
- Capture repository/log evidence showing the final commit, not a skipped stale snapshot.

Completion criteria:

- Regression tests and coverage pass.
- APK deployed and launched on Pixel 4.
- Persistence proof captured after app restart.

## Finding PH9-FTP-INTERACTION-KEYS-NOT-DEVICE-SCOPED - FTP coalescing and cooldown keys can cross device boundaries

Severity: Critical to High.

Affected files:

- `src/lib/deviceInteraction/deviceInteractionManager.ts`
- FTP source adapter tests
- Saved-device switching tests

Why this matters:

FTP interaction coalescing and cooldown are valuable, but the key currently appears to be operation plus path only. During saved-device switching or parallel work against `u64` and `c64u`, the same path on different hosts can incorrectly share an in-flight operation or cooldown. That can return stale data, delay the new device, or hide a real device-specific failure.

Observed code shape:

- `withFtpInteraction` builds a key from `meta.operation` and `meta.path`.
- `ftpInflight` and `ftpCooldownUntil` use that key.
- `FtpRequestMeta` does not appear to include a host, port, saved-device id, or other stable device scope.

Expected fix:

1. Add a stable device scope to FTP request metadata, such as host plus port plus protocol context, or a saved-device id when available.
2. Include that scope in in-flight, cooldown, backoff, and diagnostic keys.
3. Preserve FTP coalescing for same-device same-path work.
4. Preserve all FTP browsing, import, upload, mount, and directory traversal behavior.
5. Ensure saved-device switching isolates or clears old-device FTP state without weakening caching on the active device.

Regression tests:

- Two same-path FTP list/read/write requests for different hosts must not coalesce.
- Same-host same-path requests can still coalesce.
- A cooldown created for `u64` does not delay or suppress the equivalent path on `c64u`.
- Saved-device switching clears or isolates old-device FTP interaction state.

Pixel 4 proof:

- Browse the FTP root on `u64`, switch to `c64u`, and browse the FTP root there.
- Capture traces/logs proving each host has its own FTP interaction key and request path.
- Confirm no stale root listing, false cooldown, or avoidable error appears.

Completion criteria:

- Targeted tests and coverage pass.
- APK deployed and launched on Pixel 4.
- Cross-device FTP proof captured.

## Finding PH10-SCHEDULER-QUEUES-NOT-CLEARED-ON-DEVICE-SWITCH - Queued interactions can survive a reset

Severity: High.

Affected files:

- `src/lib/deviceInteraction/deviceInteractionManager.ts`
- Connection and saved-device switching tests

Why this matters:

The interaction schedulers provide important prioritization and backpressure, but queued tasks can outlive a device reset if the queue itself is not canceled or guarded by a device generation. That can send old-host REST/FTP/Telnet work after a saved-device switch, or emit late errors from a device the user has already left.

Observed code shape:

- `InteractionScheduler` queues user, system, and background tasks.
- `resetInteractionState` clears caches, in-flight maps, backoff, and circuit state.
- The scheduler does not appear to expose a clear/cancel method, and queued tasks do not appear to carry a device-generation guard.

Expected fix:

1. Add a device-generation or cancellation guard to scheduled tasks, or expose scheduler reset that rejects queued work with a classified cancellation reason.
2. Clear or invalidate queued REST, FTP, and Telnet work when saved-device switching or connection reset occurs.
3. Preserve the scheduler, priorities, backpressure, cooldown, and circuit-breaker behavior.
4. Treat noncancelable native calls explicitly: document, log with context, and ignore stale results if they return after the generation changed.

Regression tests:

- Queued background REST and FTP tasks are rejected or ignored after `resetInteractionState("saved-device-switch")`.
- New-device actions proceed normally after reset.
- Same-device queued work still executes in priority order.
- Stale task rejection is logged as cancellation or diagnostic context, not as an unclassified production error.

Pixel 4 proof:

- Start a REST/FTP-heavy operation, switch `u64 -> c64u`, and capture a request timeline.
- Prove no old-host requests occur after the switch boundary except explicitly documented in-flight native calls that cannot be canceled.
- Confirm the new device remains responsive.

Completion criteria:

- Targeted tests and coverage pass.
- APK deployed and launched on Pixel 4.
- Saved-device switch trace captured.

## Finding PH11-SMOKE-CONFIG-PROBE-IN-PRODUCTION - Native startup can probe a test-only smoke file

Severity: Medium to High.

Affected files:

- `src/lib/smoke/smokeMode.ts`
- Smoke-test setup and native test-probe configuration

Why this matters:

Production native startup should not probe test-only files by default. A Capacitor filesystem stat for missing `c64u-smoke.json` can create avoidable plugin error noise in logcat even if the app-level code treats the missing file as optional.

Observed code shape:

- `shouldReadSmokeConfigFromFilesystem` returns true on native platforms.
- Startup can call `Filesystem.stat` for `c64u-smoke.json`.
- On-device launch evidence has previously shown a Capacitor plugin error for a missing filesystem stat entry.

Expected fix:

1. Read native smoke config from filesystem only when test probes or an explicit debug opt-in are enabled.
2. Preserve emulator and smoke-test behavior by enabling the required flag in those runners.
3. Keep production startup deterministic and free of test-only file probes.
4. Do not hide real Capacitor filesystem errors for production file operations.

Regression tests:

- Production native mode does not call `Filesystem.stat` for `c64u-smoke.json`.
- Test-probe mode still reads the file and applies smoke config.
- Existing smoke tests still pass with their explicit opt-in.

Pixel 4 proof:

- Cold-launch the production APK on Pixel 4.
- Capture filtered logcat showing no `c64u-smoke.json` missing-file or filesystem-stat plugin error.
- Confirm normal startup and connection behavior remain intact.

Completion criteria:

- Targeted tests and coverage pass.
- APK deployed and launched on Pixel 4.
- Startup logcat evidence captured.

## Finding PH12-PLAYLIST-QUERY-INDEX-STILL-SCANS-ORDERED-IDS - Indexed search may still do full ordered scans and eager item construction

Severity: High.

Affected files:

- `src/lib/playlistRepository/queryIndex.ts`
- `src/pages/playFiles/hooks/usePlaylistListItems.tsx`
- `src/components/SelectableActionList.tsx` if item-windowing changes are needed
- Playlist search and list rendering tests

Why this matters:

Repository-backed query search is necessary but not sufficient if the index still scans all ordered ids per query and React still eagerly builds item models for every loaded result. DOM virtualization helps visible rendering, but upstream full-list object creation can still produce jank on Pixel 4 with large HVSC or local datasets.

Observed code shape:

- `queryIndex.ts` builds candidate ids from category/search grams, then iterates the full `orderedIds` list to preserve order.
- `usePlaylistListItems.tsx` builds `playlistIndexById`, calculates HVSC counts by filtering, and constructs `ActionListItem` objects for the full filtered playlist.
- Render counts filter the full item list again.
- `SelectableActionList` uses Virtuoso for view-all, but item objects and closures can already be allocated before virtualization.

Expected fix:

1. Make selective query paths iterate candidate sets where possible while preserving deterministic ordering.
2. Avoid repeated full-list count and map work on every query/render when repository metadata or memoized counters can provide the same answer.
3. Add bounded item-model construction for view-all or large lists, so virtualization is not fed by an eagerly built full React item list.
4. Preserve view-all, search, sorting, filtering, folder headers, selection, item menus, config actions, playback actions, and the alphabet scrollbar.
5. Keep the UX equivalent or better; do not cap results or hide actions to gain speed.

Regression tests:

- A selective query over a large fixture does not iterate the full ordered id list.
- View-all builds a bounded item model window while preserving selection and item actions.
- Folder headers, counts, and sorting remain correct.
- Existing action-menu and config-action tests continue to cover the same features.

Pixel 4 proof:

- Load or simulate a 100k-item playlist/HVSC dataset.
- Type search text, clear it, enter view-all, open item menus, select items, and use config/play actions.
- Capture responsiveness metrics and prove no features disappeared.

Completion criteria:

- Targeted tests and coverage pass.
- APK deployed and launched on Pixel 4.
- Large-list Pixel proof captured.

## Finding PH13-PLAYLIST-DURATION-AND-COMMIT-CHURN - Duration changes can mutate and persist full playlists repeatedly

Severity: High to Medium.

Affected files:

- `src/pages/PlayFilesPage.tsx`
- `src/pages/playFiles/playFilesUtils.ts`
- `src/lib/playback/playlistTotals.ts`
- `src/pages/playFiles/hooks/usePlaybackPersistence.ts`
- Playlist duration and persistence tests

Why this matters:

Global duration override is a feature and must remain. The risk is that dragging a duration slider or changing duration input maps across the full playlist, recalculates totals, and triggers repository snapshot work repeatedly. On large playlists that can create UI jank and commit churn.

Observed code shape:

- Duration slider/input paths call `setPlaylist(prev => applyDurationOverrideToPlaylist(prev, nextDurationMs))`.
- `applyDurationOverrideToPlaylist` maps the entire playlist.
- Playlist totals are recalculated over playlist items.
- Playback persistence commits playlist snapshots after playlist changes when not scanning or already committing.

Expected fix:

1. Preserve global duration override behavior, playlist totals, and per-item/songlength override semantics.
2. Represent global duration as shared state or repository metadata where possible, rather than rewriting every item per slider tick.
3. Debounce or merge repository commits caused by rapid duration input changes while still persisting the final value.
4. Keep current playback duration feedback accurate while the user is editing.
5. Do not remove duration editing or make it a small-list-only feature.

Regression tests:

- Slider/input changes update current playback and totals as before without per-tick full playlist mutation.
- Repository persistence writes the final duration after debounce or commit flush.
- Songlength and per-item durations still take precedence where intended.
- Rapid edits produce one or a small bounded number of commits, not one full snapshot per tick.

Pixel 4 proof:

- Load a large playlist, drag the duration slider, and watch UI responsiveness.
- Capture logs showing bounded commit behavior after settling.
- Restart and verify the final duration state persisted.

Completion criteria:

- Targeted tests and coverage pass.
- APK deployed and launched on Pixel 4.
- Duration-edit Pixel proof captured.

## Finding PH14-RECURSIVE-IMPORT-AND-NATIVE-FILE-IO - Recursive import and native reads need cancellation and memory hardening

Severity: High.

Affected files:

- `src/pages/playFiles/handlers/addFileSelections.ts`
- `src/lib/sourceNavigation/ftpSourceAdapter.ts`
- `src/lib/sourceNavigation/localSourceAdapter.ts`
- `src/lib/disks/diskMount.ts`
- `android/app/src/main/java/uk/gleissner/c64commander/FolderPickerPlugin.kt`
- Import, source navigation, disk mount, and Android JVM tests

Why this matters:

Recursive add/import and native file IO are central features. They must remain available, but they need stronger cancellation and memory behavior. A user can navigate away, cancel, or switch devices while recursive traversal or native reads continue. Whole-file byte arrays plus base64 bridge payloads can also create memory spikes for larger local files.

Observed code shape:

- Recursive add-file collection does not appear to carry a cancellation signal end-to-end.
- FTP recursive traversal accepts an `AbortSignal`, but pending native FTP operations may still continue, and some add-file flows do not pass a signal.
- Local SAF traversal checks cancellation between directory listings, while native `FolderPicker.listChildren` calls are not cancelable.
- `FolderPickerPlugin` reads complete file bytes and returns base64 over the Capacitor bridge.
- `diskMount.ts` wraps local reads in a JavaScript timeout; the timeout does not cancel the native read, and late native results can still arrive.

Expected fix:

1. Thread cancellation through add-item flows, source adapters, repository updates, and native bridges where feasible.
2. When native work cannot be interrupted, tag it with an operation generation and ignore stale results after cancellation, navigation, or device switch.
3. Replace large whole-file bridge reads with streaming/chunked behavior where feasible, or enforce tested size limits with clear UX.
4. Preserve local files, SAF tree browsing, HVSC, CommoServe, Ultimate FTP import, recursive import, disk mount, and upload features.
5. Treat user cancellation as a clean cancellation, not a production error.

Regression tests:

- Canceling recursive import prevents later playlist mutation and logs a classified cancellation.
- Switching devices during recursive FTP import prevents old-device results from mutating active state.
- JS timeout either cancels native work or ignores the late result without noisy errors.
- Large local disk mount/upload behavior is bounded and reports clear UX if a tested limit is exceeded.

Pixel 4 proof:

- Start a recursive import, then cancel, navigate away, and switch device; verify no later playlist mutation or old-host requests.
- Mount a representative local `.d64` or `.d81` from SAF on Pixel 4 and prove no out-of-memory behavior or false timeout.
- Capture logcat showing clean cancellation and no unclassified errors.

Completion criteria:

- Targeted tests and Android JVM tests pass where native code changes.
- Coverage passes.
- APK deployed and launched on Pixel 4.
- Import/cancel and disk-mount proof captured.

## Finding PH15-FTP-DUPLICATE-ERROR-LOGGING - One FTP failure can produce duplicate production errors

Severity: Medium.

Affected files:

- `src/lib/ftp/ftpClient.ts`
- `src/lib/deviceInteraction/deviceInteractionManager.ts`
- FTP diagnostics tests

Why this matters:

The production target is not zero diagnostics; it is accurate, actionable diagnostics without duplicated noise. A single FTP failure appears able to log once inside the FTP client operation and again inside the higher-level interaction manager. Duplicate errors make real failures look worse and complicate Pixel proof.

Observed code shape:

- FTP list/read/write helpers log failures with context.
- `withFtpInteraction` also logs `FTP request failed` for failed FTP operations.
- The two layers may not coordinate a shared failure id or decide which layer owns the canonical user-visible error.

Expected fix:

1. Keep one canonical error record per FTP failure with full operation, path, host/device scope, and stack trace.
2. Preserve lower-level trace data needed for debugging without duplicating user-visible or production error logs.
3. Do not suppress real FTP errors or convert them into silent failures.

Regression tests:

- A simulated FTP list/read/write failure emits exactly one canonical error log.
- The canonical log contains operation, path, host/device scope, and stack trace/context.
- Diagnostic traces still retain enough detail to debug the failure.

Pixel 4 proof:

- Use a controlled FTP failure or unreachable host scenario.
- Capture logcat/app diagnostics proving one classified error, not duplicated noise.
- Confirm normal FTP success behavior is unchanged.

Completion criteria:

- Targeted tests and coverage pass.
- APK deployed and launched on Pixel 4.
- FTP failure logging proof captured.

## Global production hardening guardrails

Apply these across all findings.

1. Preserve every existing feature and workflow unless the user explicitly approves a narrower behavior change.
2. Do not disable logs, catches, tests, traces, UI feedback, item actions, source types, or device operations to hide defects.
3. Fix root causes of warnings and errors.
4. Preserve or improve diagnostics.
5. Keep changes narrow and aligned with existing architecture.
6. Do not refresh screenshots unless visible documented UI changed.
7. For every bug fix, add a regression test that locks in the specific behavior and a nearby no-regression assertion for the preserved feature.
8. For every code change, run `npm run test:coverage` and meet at least 91 percent global branch coverage.
9. For every completed task, install the latest APK on Pixel 4, launch it, and validate the touched behavior on device.
10. Probe `u64` first and fall back to `c64u` only when the specific scenario requires it or `u64` is unreachable.
11. Record exact hardware, APK path, app version, and command outcomes in the completion summary.

## Suggested execution order

1. Phase 0 evidence refresh.
2. PH5 exception policy, because it is a release blocker and prevents trustworthy hardening.
3. PH8 playlist repository snapshot key, because it can silently lose persisted playlist metadata.
4. PH9 and PH10 device-scoped FTP/scheduler invalidation, because stale queued work can cross device boundaries.
5. PH1, PH12, and PH13 playlist responsiveness, because large-list search, view-all, item modeling, duration editing, and repository commits are the highest user-visible performance risks.
6. PH2 and PH3 background/idle network gating, because they can create cold-boot and background REST sweeps.
7. PH4 playback start unmute ordering.
8. PH14 recursive import and native file IO cancellation/memory hardening.
9. PH6, PH11, and PH15 production noise cleanup.
10. PH7 prior evidence gap, unless Phase 0 already completed it.

If a higher-priority phase uncovers a broader regression, stop and converge that regression before continuing.

## Definition of done for the follow-up hardening effort

The follow-up session is complete only when:

- All findings above are fixed, explicitly deferred with a concrete reason, or proven not reproducible on current HEAD.
- Existing features, source types, device workflows, persistence behavior, diagnostics, and documented UX affordances are preserved.
- Regression tests exist for every code fix.
- No-regression tests or device evidence cover the feature behavior that each performance/noise fix could have weakened.
- `npm run test:coverage` passes with at least 91 percent global branch coverage for code changes.
- Android JVM tests pass for Android code changes.
- The latest APK is deployed to Pixel 4.
- The app is launched and validated on Pixel 4 against `u64`.
- Required cross-device proof is captured against `c64u`.
- Logcat evidence shows no avoidable fatal errors, warnings, `AndroidRuntime` crashes, unclassified Capacitor errors, or default HVSC perf console noise in the validated flows.
- The final summary lists changed files, tests/builds run, APK path, Pixel serial, Ultimate host(s), evidence files, and any residual risk.
