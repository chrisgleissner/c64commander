# Coverage Matrix

## Legend

- `Ready`: technically automatable now if the stack uses the app path correctly.
- `Partial`: some app/path/oracle/state pieces exist, but reliable autonomous coverage still has gaps.
- `Blocked`: current repo implementation cannot honestly claim coverage without major stack changes.

## Matrix

| User journey | App/prior-art evidence | Intended tools | Implemented autonomous path today | Current observability | Assertion quality today | Readiness | Main blocking gaps |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Route shell and navigation | `TabBar`, Playwright nav, Maestro smoke-launch | mobile controller + optional `c64scope` session | ADB launch + screenshot + logcat in `c64scope` validation | UI + logcat | Medium | Partial | no real controller integration; runner does not prove route traversal beyond screenshot |
| Connection and demo-mode | connection manager docs/tests, Playwright connection suites | mobile controller + app logs + connection snapshots | direct REST + screenshot | UI + REST + logs | Medium | Partial | no app-attributed control of discovery transitions in current runner |
| Disk list creation from local/C64U | `HomeDiskManager`, `itemSelection.spec.ts`, `diskManagement.spec.ts` | mobile controller; optional `c64bridge` only for secondary state read | not covered by executable agentic runner | UI + persistent library + REST/FTP fallback | Low in current stack | Blocked | current runner never imports through UI; no app-driven executor |
| Disk list execution: mount/eject/rotate | `HomeDiskManager`, `diskManagement.spec.ts` | mobile controller + REST-visible drive state | current runner only queries drives/FTP directly | UI + drive state | Low in current stack | Blocked | bypass by direct drive queries; no test-owned fixture/reset harness |
| Playlist creation from local/C64U | `PlayFilesPage`, `PlaylistPanel`, `itemSelection.spec.ts`, Maestro playlist flow | mobile controller; `c64scope` only if playback needs A/V | not covered by executable agentic runner | UI + playlist persistence + logs | Low in current stack | Blocked | no app-driven runner for add-items flow |
| Playlist execution and queue progression | Play transport code, Playwright transport tests, Maestro playback basics | mobile controller + `c64scope` A/V + app logs | current runner runs PRG directly or captures stream from direct program | A/V exists, but wrong control path | Low | Blocked | current “Play coverage” does not use app transport |
| Locked-screen autoplay continuation | Android background hooks, Maestro `edge-auto-advance-lock`, runtime contract | mobile controller + Android runtime logs + optional `c64scope` | not covered by executable agentic runner | strong potential: UI + `backgroundAutoSkipDue` + logcat | Low in current stack | Partial | missing controller integration for lock/unlock, missing reset and due-at correlation in session model |
| HVSC enablement in Settings | Settings selector + persistence tests | mobile controller | not executed agentically | UI + persisted settings + logs | Medium | Ready | needs controller |
| HVSC download/install/ingest | `useHvscLibrary`, HVSC progress UI, Playwright HVSC, Maestro HVSC ingest | mobile controller + app diagnostics/filesystem + optional `c64scope` only for playback phase | not covered by executable agentic runner | strong app-native progress and cache signals | Medium | Partial | no app-driven executor; shared-lab budget/reset unclear |
| HVSC cache reuse after download | `getHvscCacheStatus`, `ingestCachedHvsc`, Playwright cached-ingest flow | mobile controller + app diagnostics/filesystem | not covered agentically | cache status + summary + status store | Medium | Partial | no state reset between runs; no explicit oracle wiring in current stack |
| Playlist generation from downloaded HVSC songs | HVSC browser + add-items flow + playlist repo | mobile controller + playlist persistence + app logs | not covered agentically | UI + playlist repository | Low | Blocked | no executor for UI browse-to-playlist path |
| End-to-end playback for downloaded/cached HVSC content | Play/HVSC code + Playwright HVSC play flow | mobile controller + `c64scope` A/V + app logs | current runner proves generic direct programs, not downloaded-HVSC playback | A/V + app-side metadata available in theory | Low | Blocked | control-path bypass; no linkage between HVSC-selected item and A/V result |
| Settings diagnostics export | Settings UI + diagnostics export implementation + Playwright/Maestro prior art | mobile controller + filesystem/log evidence | current runner checks app package/shared_prefs only | filesystem + share attempt + diagnostics logs | Low | Partial | OS handoff semantics unresolved; current runner does not exercise export |
| Config browsing/editing | Config page selectors + Playwright config tests | mobile controller + REST round-trip | current runner reads configs directly + screenshots | UI + REST | Medium for browsing, low for editing | Partial | missing app-driven executor and category-specific expected behavior |
| Home quick-config/drives/SID/stream | Home selectors + REST corroboration possible | mobile controller + app diagnostics + secondary REST/state refs | current runner only read-only Home visibility | UI + REST + diagnostics | Low | Partial | destructive budgets and end-state specs incomplete |

## Deep-Dive Findings

### Disk List Creation And Execution

Fact:

- The app supports disk import, grouping, rename, bulk remove, mount/eject, and “View all”.
- Stable selectors: `[data-testid="disk-list"]`, `[data-testid="disk-row"]`, `[data-testid="disk-row-header"]`, `[data-testid="add-disks-overlay"]`, `[data-testid="source-entry-row"]`, `button[aria-label="Disk actions"]`, `button[aria-label="Mount <name>"]`.
- Mount/eject function: `mountDiskToDrive(api, drive, disk, runtimeFile?)` in `src/lib/disks/diskMount.ts`.
- Playwright `diskManagement.spec.ts` covers folder grouping, FTP hierarchy, mounting to both drives, with fixtures in `playwright/fixtures/disks-local/`.
- The current autonomous runner never exercises these through the app. `storage.ts` queries `/v1/drives` and FTP directly.

Observable signals for autonomous testing:

- UI: disk list state, row presence, mount status indicators.
- Persistence: disk library stored per device in local storage.
- REST corroboration: `/v1/drives` can confirm mount state after app action.

Assessment:

- `Blocked` for honest product validation today. All selectors and flows exist. Missing the app-driving executor.

### Playlist Creation And Execution

Fact:

- The app exposes add-items flows from Local, C64U, and HVSC sources, playlist persistence, queryable playlist repository, transport controls, and track-level metadata.
- Stable selectors: `[data-testid="add-items-to-playlist"]`, `[data-testid="playlist-list"]`, `[data-testid="playlist-item"]`, `[data-testid="playlist-type-{category}"]`, `[data-testid="add-items-confirm"]`, `button[aria-label="Clear playlist"]`, `[data-testid="import-option-local"]`, `[data-testid="import-option-c64u"]`, `[data-testid="import-option-hvsc"]`.
- Transport selectors: `[data-testid="playlist-play"]`, `[data-testid="playlist-pause"]`, `[data-testid="playback-current-track"]`, `[data-testid="playback-elapsed"]`, `[data-testid="playback-counters"]`.
- Playwright `playlistControls.spec.ts` covers shuffle, reshuffle, type filters. `itemSelection.spec.ts` covers add-items from multiple sources.
- Maestro `edge-playlist-manipulation.yaml` covers native add-items, playback start, and clear playlist.
- The current autonomous runner instead posts PRGs directly (`/v1/runners:run_prg`) or reads SID registers directly.

Observable signals for autonomous testing:

- UI: playlist item count, current track label, transport state.
- Persistence: playlist persisted in local storage, session storage, IndexedDB.
- A/V: `c64scope` stream capture can verify actual audio/video output.
- App logs: playback traces, item transitions.

Assessment:

- `Blocked` for honest product validation today. All selectors and prior art exist. Missing the app-driving executor.

### Autoplay Continuation With Locked Screen

Fact:

- Android-specific background-execution instrumentation exists in `src/lib/native/backgroundExecution.ts` and `backgroundExecutionManager.ts`.
- Key app signals: `backgroundAutoSkipDue` event with `{ dueAtMs, firedAtMs }`, `autoAdvanceDueAtMs` state in `PlayFilesPage.tsx`, `BackgroundExecution.setDueAtMs()` / `.start()` / `.stop()` API.
- The runtime contract requires proof that the background path was armed, not just that playback later advanced.
- Maestro `edge-auto-advance-lock.yaml` seeds short-duration playlist, starts playback, locks device (`pressKey: Lock`), waits longer than track duration, unlocks (`pressKey: Home`), and verifies exactly one track transition.
- The current autonomous runner does not execute this path.

Observable signals for autonomous testing:

- App: `backgroundAutoSkipDue` events in logcat, `autoAdvanceDueAtMs` state, `cancelAutoAdvance()` callback.
- UI: current track label change after unlock.
- A/V: `c64scope` stream capture can prove audio continued during lock.
- Android: `dumpsys power` for wake lock state.

Assessment:

- `Partial`. The app instrumentation and Maestro prior art are strong. Missing: controller integration for lock/unlock, no case-level device state reset, no due-at correlation in session model.

### HVSC Download Flow

Fact:

- The app exposes:
  - `getHvscStatus()`, `getHvscCacheStatus()`, `checkForHvscUpdates()`, `installOrUpdateHvsc(cancelToken)`, `ingestCachedHvsc(cancelToken)` in `src/lib/hvsc/hvscService.ts`.
  - `addHvscProgressListener(listener)` for `HvscProgressEvent` tracking.
  - `HvscManager.tsx` UI component with download/ingest buttons and progress indicators.
- Playwright `hvsc.spec.ts` covers: not-installed → install → ready flow, install with progress updates, mock server with actual playback.
- Maestro `edge-hvsc-ingest-lifecycle.yaml` covers install/ingest stage sequence.
- Agentic docs classify HVSC as guarded access.
- The executable agentic runner does not execute it.

Observable signals for autonomous testing:

- App: `HvscStatus`, `HvscCacheStatus`, `HvscProgressEvent` via native bridge.
- UI: progress indicators, status text, install/ingest buttons.
- Filesystem: cached archives under `hvsc/cache/` with `.complete.json` markers.

Assessment:

- `Partial`. Strong app-native observability. Blocked by: no app-driven executor, shared-lab budget/reset unclear.

### Cache Reuse After Download

Fact:

- `getHvscCacheStatus()` returns `{ baselineVersion: number | null, updateVersions: number[] }` from `hvscService.ts`.
- `ingestCachedHvsc(cancelToken)` ingests from cache without re-downloading.
- `resolveCachedArchive(prefix, version)` and `parseCachedVersion(prefix, name)` in `hvscDownload.ts` manage cache detection.
- Cache files stored under `hvsc/cache/` with marker files like `hvsc-baseline-{version}.7z.complete.json`.
- Existing Playwright tests mock cache state seeding (`cachedBaselineVersion`, `cachedUpdateVersions`).
- Current reset strategy does not isolate cached state cleanly. HVSC "reset" in `useHvscLibrary` clears summary UI state, not the actual downloaded cache.

Observable signals for autonomous testing:

- App: `HvscCacheStatus` API, `HvscStatus` API.
- Filesystem: presence/absence of `.complete.json` marker files.
- UI: install vs. ingest button states indicate cache availability.

Assessment:

- `Partial`, blocked mainly by state hygiene. Need: explicit separation of summary-reset from cache-clear, cache baseline/update version assertions in session.

### Playlist Generation From Downloaded Songs

Fact:

- The app can browse HVSC via `[data-testid="import-option-hvsc"]` in the add-items dialog.
- Source browsing uses `[data-testid="source-entry-row"]` with folder navigation.
- `[data-testid="add-items-filter"]` allows search, `[data-testid="add-items-selection-count"]` shows count, `[data-testid="add-items-confirm"]` commits.
- Playwright `hvsc.spec.ts` includes `addHvscDemoTrackToPlaylist()` helper that navigates HVSC browser → Demo folder → selects track → confirms.
- Maestro `edge-playlist-manipulation.yaml` covers add-items from C64U source with confirm flow.
- No current executable autonomous case does this.

Observable signals for autonomous testing:

- UI: playlist item count, item labels (should match selected HVSC file names).
- Persistence: playlist repository state in IndexedDB.
- App logs: add-items action traces.

Assessment:

- `Blocked` until the mobile-controller path is real and enforced. All selectors and prior art exist.

### End-To-End Playback Verification For Downloaded And Cached Content

Fact:

- The correct oracle needs:
  - app-selected HVSC item (provable via `[data-testid="playback-current-track"]` and playlist state)
  - playlist/current-item confirmation (provable via `[data-testid="playback-counters"]` and playlist persistence)
  - app action timeline (provable via diagnostics traces and action summaries)
  - `c64scope` A/V verification (provable via stream capture at `239.0.1.65:11001` audio / `239.0.1.64:11000` video)
- Transport state observables: `[data-testid="playlist-play"]`, `[data-testid="playback-elapsed"]`, `[data-testid="playback-remaining"]`.
- Volume state: `[data-testid="volume-mute"]`, `[data-testid="volume-slider"]`.
- The current executable runner instead validates generic direct programs via `c64_program` / `/v1/runners:run_prg`.

Observable signals for autonomous testing:

- UI: current track, elapsed time, transport state.
- A/V: `c64scope` multicast stream capture proves actual hardware output.
- App logs: playback traces, item source provenance.
- REST: `/v1/sid` or status endpoints can corroborate device state.

Assessment:

- `Blocked`. All required signals exist. The gap is that the current runner uses the wrong control path, so it cannot prove that the app initiated the playback of the specific downloaded/cached HVSC content.

## Overall Coverage Conclusion

Inference:

- Many high-value journeys are reachable in the app and already have reusable flow knowledge.
- The current autonomous stack does not reach them because the executable path is not the app path.

