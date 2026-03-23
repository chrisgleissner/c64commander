# Review 11 — Live Device and HVSC Workflow Audit

**Date:** 2026-03-23
**Scope:** Live-device functional audit on Pixel 4 (Android 13, app v0.6.4-rc8) with C64 Ultimate firmware 1.1.0 at `192.168.1.167`; cross-platform gap analysis; diagnostics subsystem deep analysis; HVSC end-to-end workflow
**Method:** Device instrumentation via ADB and DroidMind, source code tracing of all affected paths, screenshot capture and analysis, REST API probing against live device

---

## Quick Stats

| Metric                             | Value                          |
| ---------------------------------- | ------------------------------ |
| Device                             | Pixel 4 (Android 13)           |
| App version                        | 0.6.4-rc8-60266                |
| C64U firmware                      | 1.1.0                          |
| C64U host                          | 192.168.1.167                  |
| HVSC archive size (baseline-84.7z) | 71.3 MB                        |
| HVSC download time (LAN)           | ~4 seconds                     |
| HVSC extraction result             | FAILED — offsetBytes rejection |
| Diagnostics entry cap              | 8 entries (hard-coded)         |
| Trace retention window             | 30 minutes                     |
| REST polling interval (observed)   | ~1.5 seconds                   |

---

## Issue Index

Issues are tagged with:

- **ID**: `R11-NNN`
- **Severity**: `Critical` / `High` / `Medium` / `Low`
- **Effort**: `S` (< 1 day) · `M` (1–3 days) · `L` (3–7 days)
- **Impact**: correctness / reliability / UX / discoverability / maintainability

---

## A — HVSC Workflow

### R11-001 · Critical · Effort S · Impact: correctness, data loss

**HVSC extraction fails unconditionally on Android with "offsetBytes must be >= 0"**

The HVSC baseline archive downloads successfully (71.3 MB in ~4 s over LAN) but extraction always fails immediately after with the error displayed as a red status line: "Extraction error / offsetBytes must be >= 0".

Root cause trace:

1. `hvscDownload.ts` `readArchiveBuffer()` calls `HvscIngestion.readArchiveChunk({ relativeArchivePath, offsetBytes: 0, lengthBytes: ... })` where `offsetBytes` starts at `0`.
2. The Capacitor bridge serializes the call payload as a JSON object. The Kotlin plugin at `HvscIngestionPlugin.kt:845` calls `call.getLong("offsetBytes")`. When JavaScript passes a JS `number` (not a Java `Long`), `getLong` returns `null` in Capacitor's JSObject API, yielding the default `-1L`.
3. The guard at line 852 (`if (offsetBytes < 0L)`) triggers, and the call is rejected with "offsetBytes must be >= 0".
4. No chunks are ever read; the extraction loop in `hvscDownload.ts:360–377` never completes; the error propagates up as an `Error` and is displayed in the HVSC status row.

The value `0` (the correct starting offset) is never received by the native side because `getLong("offsetBytes")` does not accept a JSON integer passed as a JS number when the value happens to be zero — or the JSON serialization path omits the field when it is falsy.

Observed device behavior:

- HVSC status shows "HVSC download failed / Extraction error / offsetBytes must be >= 0" in red immediately after download completes.
- Tapping "Download HVSC" again re-downloads and fails identically.
- The downloaded `.7z` file is left in app storage but cannot be read.

Files:

- `src/lib/hvsc/hvscDownload.ts` (line 361)
- `android/app/src/main/java/uk/gleissner/c64commander/HvscIngestionPlugin.kt` (lines 845, 852–853)
- `src/lib/native/hvscIngestion.ts` (line 86)

Expected: `offsetBytes: 0` is passed, received by Kotlin as `0L`, extraction proceeds chunk by chunk.
Actual: `call.getLong("offsetBytes")` returns `null` (→ `-1L`), triggering the rejection guard.

---

### R11-002 · High · Effort S · Impact: correctness, misleading UX

**"Ingest HVSC" button incorrectly enabled after extraction failure**

After the extraction failure described in R11-001, the "Ingest HVSC" button remains enabled (not grayed out). The enable condition in `useHvscLibrary.ts:664–665` is:

```typescript
const hvscHasCache =
  Boolean(hvscCacheBaseline) || hvscCacheUpdates.length > 0 || hvscStatusSummary.download.status === "success";
```

Because `download.status === "success"` (download did complete), `hvscHasCache` is `true`, and `hvscCanIngest = hvscAvailable && hvscHasCache && !hvscUpdating` evaluates to `true`. The "Ingest HVSC" button is shown as tappable even though the archive was never successfully extracted. Tapping it will attempt ingestion from a missing or incomplete local HVSC database.

Files:

- `src/pages/playFiles/hooks/useHvscLibrary.ts` (lines 664–665, 841)
- `src/pages/playFiles/components/HvscControls.tsx` (line 113)

Expected: button is disabled when `extraction.status !== "success"`.
Actual: button is enabled based on download status alone.

---

### R11-003 · High · Effort M · Impact: reliability

**HVSC has no iOS equivalent native plugin — iOS path is silently blocked**

`src/lib/native/hvscIngestion.ts` wraps the `HvscIngestionPlugin` Capacitor plugin. No Swift/Objective-C plugin exists under `ios/`. A search for `*Hvsc*` under `ios/` returns no results. The web fallback path in `readArchiveBuffer` (`Filesystem.readFile`) blocks large archives (> `MAX_BRIDGE_READ_BYTES`) with a thrown error: "HVSC bridge read blocked for large archive". Any iOS user who attempts to download and ingest HVSC will fail at the same point.

`shouldUseNativeDownload()` gating means this failure occurs silently at extraction — the download completes successfully.

Files:

- `src/lib/hvsc/hvscDownload.ts` (line 395)
- `src/lib/native/hvscIngestion.ts`

Expected: documented limitation or graceful disabled state on iOS.
Actual: download succeeds, extraction silently fails at "bridge read blocked" error.

---

## B — Diagnostics Display and Instrumentation

### R11-004 · High · Effort S · Impact: discoverability, diagnostics quality

**All REST actions appear as opaque "rest.get" with no URL context in diagnostics**

`src/lib/c64api.ts:580` wraps every request:

```typescript
runWithImplicitAction(`rest.${method.toLowerCase()}`, async (action) => ...)
```

This produces action names like `rest.get` and `rest.put` for every REST call regardless of path. The diagnostics activity list shows only these generic names. An operator looking at the diagnostics dialog after a failed operation cannot determine which endpoint was involved without expanding every entry individually.

During live device testing, the diagnostics activity list showed four identical "rest.get" entries with timestamps 21:23:31–36. There was no indication of which paths were polled, which succeeded, or which failed.

Files:

- `src/lib/c64api.ts` (line 580)
- `src/lib/diagnostics/actionSummaries.ts`

Expected: action summaries include at least hostname, method, and path in the collapsed row.
Actual: collapsed rows show only "rest.get" with a generic success/failure count.

---

### R11-005 · Medium · Effort S · Impact: diagnostics quality

**Diagnostics dialog hard-caps at 8 entries; live updates not visible after initial load**

`DiagnosticsDialog.tsx:1023`:

```typescript
const displayEntries = filteredEntries.slice(0, 8);
```

During live testing with ~1.5 s REST polling, the diagnostics dialog was open for ~2 minutes. The displayed entries did not update visually; the same 4 entries with timestamps 21:23:31–36 remained pinned. The `GlobalDiagnosticsOverlay` does register a `c64u-traces-updated` listener and calls `setTraceEvents(getTraceEvents())`, but the filter + slice path appears to prevent new entries from displacing older ones already captured in the filtered view.

The 8-entry cap means any session with sustained polling fills the view immediately and the operator cannot scroll to see more recent events.

Files:

- `src/components/diagnostics/DiagnosticsDialog.tsx` (line 1023)
- `src/components/diagnostics/GlobalDiagnosticsOverlay.tsx` (lines 150–154)

Expected: diagnostics list scrolls to new entries or shows most recent N entries as polling continues.
Actual: 8-entry view appears frozen; older entries are not displaced by newer ones.

---

### R11-006 · Medium · Effort S · Impact: diagnostics completeness

**ConfigDriftView and HeatMapPopup not reachable without scrolling deep into the diagnostics dialog**

From the WORKLOG root-cause notes (problem area C):

- `ConfigDriftView` and `HeatMapPopup` exist under `src/components/diagnostics/` but require scrolling past the main activity list to reach the sub-section links.
- There is no sections index at the top of the dialog.
- During live testing, the Config Drift and Heat Map surfaces were not visible in the top half of the diagnostics dialog without deliberate scrolling.

This is documented in PLANS.md Phase 5 as a known gap but not yet resolved.

Files:

- `src/components/diagnostics/DiagnosticsDialog.tsx`
- `src/components/diagnostics/ConfigDriftView.tsx`
- `src/components/diagnostics/HeatMapPopup.tsx`

---

## C — Health State

### R11-007 · High · Effort M · Impact: correctness, operator confusion

**Health badge defaults to trace-derived UNHEALTHY on every cold launch; requires explicit health check to show HEALTHY**

`useHealthState.ts` has a two-path derivation:

1. If `healthCheckState.latestResult` is populated (set by `setHealthCheckStateSnapshot`): health badge uses probe outcomes from the last explicit health check run.
2. If `latestResult` is null (initial state on cold launch): health badge uses `rollUpHealth(contributors, connectivity)` over raw trace events.

On cold launch, REST polling begins immediately. The poll-derived REST events accumulate failures (connection probing, 404s from incorrect paths, backoff retries). `deriveRestContributorHealth(traceEvents)` counts recent failures and returns `Unhealthy`. The badge shows UNHEALTHY within seconds of first launch.

Observed during live testing: the badge showed UNHEALTHY for ~30 seconds after launch. After opening diagnostics and tapping "Run Health Check", the badge changed to HEALTHY. The actual device was reachable throughout.

`latestResult` is not persisted across sessions. On every cold launch, the trace-derived path runs until the user explicitly triggers a health check.

Files:

- `src/hooks/useHealthState.ts` (lines 53–116)
- `src/lib/diagnostics/healthCheckState.ts`

Expected: badge initializes to a neutral/unknown state; first successful REST poll updates it to Healthy.
Actual: badge initializes to UNHEALTHY from noisy early trace failures; requires user action to correct.

---

### R11-008 · Medium · Effort M · Impact: correctness

**Health badge and diagnostics header can show different states simultaneously**

When `latestResult` is populated, `useHealthState` returns the health check's `overallHealth`. The `DiagnosticsDialog` also reads `lastHealthCheckResult` from the same `healthCheckState` store. These should be consistent. However, if a new trace-derived degradation occurs after the last health check (e.g., a transient FTP failure), `useHealthState` does not re-derive from traces while `latestResult` is still set — the badge stays at the last health check result while the diagnostics header may reflect the newer failure through separate trace-display paths.

This is the inverse of the pre-R11-007 problem: the badge can show HEALTHY while recent FTP errors visible in the activity list suggest a current problem.

Files:

- `src/hooks/useHealthState.ts`
- `src/lib/diagnostics/healthCheckState.ts`

---

## D — Playback and REST

### R11-009 · Medium · Effort S · Impact: UX, error clarity

**SID playback fails silently with HTTP 404 for files on USB storage**

During live testing, tapping a SID file from the HVSC browse list attempted playback via the REST API. The device showed a toast: "Playback failed HTTP 404:". The file path was `/USB2/test-data/SID/...` — a path accessible via FTP but not registered as a valid REST playback endpoint.

The error message "Playback failed HTTP 404:" is truncated (trailing colon, empty detail). The UX does not distinguish "file exists on FTP but not playable via REST" from "file not found anywhere".

Files:

- `src/pages/playFiles/` (playback dispatch logic)
- REST API endpoint: `/v1/machine/run` or equivalent

Expected: clear error distinguishing "FTP-accessible but REST endpoint not found" from generic 404.
Actual: generic "Playback failed HTTP 404:" toast.

---

## E — Cross-Platform Gaps

### R11-010 · High · Effort L · Impact: feature parity

**HVSC is completely non-functional on iOS (no native plugin)**

As noted in R11-003, there is no iOS Swift plugin implementing `readArchiveChunk`. The `shouldUseNativeDownload()` guard controls whether the native path is attempted; on iOS this returns false, and the code falls through to a `Filesystem.readFile` call that throws for archives above `MAX_BRIDGE_READ_BYTES`. Since HVSC baseline archives are ~71 MB, the threshold is always exceeded.

The HVSC feature flag `hvsc_enabled` defaults to `true`, so the HVSC controls appear in the iOS UI but fail silently during extraction.

There is no in-app indication to iOS users that HVSC is not supported. The feature flag infrastructure (`src/lib/config/featureFlags.ts`) does not include a platform-specific default for `hvsc_enabled`.

Files:

- `src/lib/config/featureFlags.ts`
- `src/lib/hvsc/hvscDownload.ts` (lines 355–396)

---

### R11-011 · Low · Effort S · Impact: discoverability

**Web platform: HVSC download is blocked — not surfaced to user**

On web (non-Capacitor), `isHvscBridgeAvailable()` returns `false`. The "Download HVSC" button is disabled without explanation. A user loading the app in a browser sees the HVSC section with a grayed-out download button and no explanatory text.

Files:

- `src/pages/playFiles/components/HvscControls.tsx`
- `src/lib/native/hvscIngestion.ts`

---

## F — Navigation and UX

### R11-012 · Medium · Effort S · Impact: UX, operator trust

**Health badge shows UNHEALTHY during early polling creating a misleading first impression**

Described fully in R11-007. From a pure UX perspective: the first visible state of the badge on a working device+connection is UNHEALTHY. An operator who does not know about the diagnostics health check workflow will assume something is wrong. The badge corrects itself only after an explicit user action.

The correct UX would be a neutral "connecting" or "unknown" state during the initial polling window, transitioning to HEALTHY once the first clean REST response is received.

---

### R11-013 · Low · Effort S · Impact: UX

**Swipe navigation threshold is correctly viewport-relative (30%) — no issue**

`useSwipeGesture.ts` has both `SWIPE_COMMIT_THRESHOLD_PX = 40` and `SWIPE_COMMIT_THRESHOLD_RATIO = 0.3`. The `resolveSwipeCommitThresholdPx` function uses the ratio when a container width is provided. The WORKLOG documented the 40px fixed value as a problem, but the ratio-based path was already implemented. During live device testing, swipe navigation between tabs felt responsive and committed at approximately the correct viewport fraction. No regression was observed.

Files:

- `src/hooks/useSwipeGesture.ts`

---

## G — Documentation

### R11-014 · Low · Effort S · Impact: accuracy

**DocsPage does not list diagnostics sections or deep-link paths**

`src/pages/DocsPage.tsx` references diagnostics conceptually but does not enumerate:

- Latency analysis popup
- Health history popup
- Config drift view
- REST heat map
- FTP heat map

No deep-link routes are documented in-app (e.g., `/diagnostics/config-drift`, `/diagnostics/heatmap/rest`). The deep-link routing infrastructure exists in `GlobalDiagnosticsOverlay.tsx` (`resolveDiagnosticsPanelFromPath`) but is not discoverable from the docs page.

This is tracked in PLANS.md Phase 6 and Phase 9 but not yet implemented.

Files:

- `src/pages/DocsPage.tsx`
- `src/components/diagnostics/GlobalDiagnosticsOverlay.tsx` (lines 93–102)

---

## 1. HVSC Workflow Deep Analysis

### Download phase

The download is handled by `hvscDownload.ts` → `downloadHvscBaseline()`. It fetches `https://hvsc.brona.dk/HVSC/` to discover the latest archive URL, then streams the `.7z` file to the Capacitor filesystem. On LAN, the 71.3 MB baseline-84.7z downloaded in approximately 4 seconds. Progress reporting was visible (percentage counter in the HVSC section). The download phase is functionally correct.

### Extraction phase (FAILED)

After download completion, `readArchiveBuffer()` is called. Because `statSize > MAX_BRIDGE_READ_BYTES`, and `shouldUseNativeDownload()` is `true` on Android, it enters the native chunk-read loop. The loop calls `HvscIngestion.readArchiveChunk({ relativeArchivePath, offsetBytes: 0, lengthBytes: N })`.

The Capacitor bridge serializes the call. On the Kotlin side, `call.getLong("offsetBytes")` returns `null` when the value is `0` (a JSON integer). The Kotlin fallback returns `-1L`. The guard fires. The call is rejected.

The error message "offsetBytes must be >= 0" propagates through the JS bridge, is caught in `hvscDownload.ts`, and is set as `hvscErrorMessage`. The UI renders it as a red status string.

### Post-failure state

After failure:

- `download.status` remains `"success"` (download did complete).
- `extraction.status` is set to `"failed"`.
- `hvscHasCache` evaluates to `true` because of `download.status === "success"`.
- "Ingest HVSC" button becomes enabled (R11-002).
- Re-tapping "Download HVSC" re-downloads the full archive from scratch, fails identically.

### Fix direction

The fix for R11-001 is to ensure `offsetBytes: 0` is passed as a value the Kotlin bridge can read. Two candidates:

1. In the JS call site, cast `offsetBytes` explicitly: pass `offsetBytes: Number(offsetBytes)` to confirm it is not undefined or null. If the problem is that the Capacitor bridge is silently dropping a field with value `0` (falsy JSON coercion), wrap it: `offsetBytes: offsetBytes === 0 ? 1 : offsetBytes` would be wrong — instead, the fix is to ensure the Kotlin side uses `call.getValue("offsetBytes")` or reads the raw JSON integer rather than `call.getLong()` with its null-default behavior.
2. In Kotlin, change `val offsetBytes = call.getLong("offsetBytes") ?: -1L` to `val offsetBytes = call.getObject()?.getLong("offsetBytes") ?: null` with explicit null check, or use `call.data?.getLong("offsetBytes")` to access the raw JSObject.

The safest fix: change the Kotlin guard to distinguish "field absent" from "field equals zero". If `offsetBytes` is null in the JSON (field absent), reject with "offsetBytes is required". If it equals 0, proceed normally.

---

## 2. Cross-Platform Gap Matrix

| Feature                | Android                             | iOS                              | Web                          |
| ---------------------- | ----------------------------------- | -------------------------------- | ---------------------------- |
| HVSC download          | Works                               | Works (download only)            | Blocked (bridge unavailable) |
| HVSC extraction        | FAILS (R11-001)                     | FAILS silently (R11-003/R11-010) | N/A                          |
| HVSC ingest            | N/A (extraction prerequisite fails) | N/A                              | N/A                          |
| Health check           | Works                               | Works (CI only)                  | Works                        |
| REST API control       | Works                               | Works                            | Works                        |
| FTP file browser       | Works                               | Works                            | Works                        |
| SID playback via REST  | Works (with 404 edge case R11-009)  | Works                            | Works                        |
| Config diff            | Works                               | Works                            | Works                        |
| Diagnostics deep links | Works                               | Not verified                     | Works                        |
| Swipe navigation       | Works (ratio-based threshold)       | Works                            | N/A                          |

---

## 3. Performance Observations

| Area                      | Observation                                                                                   |
| ------------------------- | --------------------------------------------------------------------------------------------- |
| REST polling              | ~1.5 s interval; generates ~40 trace events per minute; fills 8-entry diagnostics cap quickly |
| HVSC download             | 71.3 MB in ~4 s on LAN (~18 MB/s); acceptable                                                 |
| App launch to first paint | Not measured precisely; connection badge UNHEALTHY within ~2 s of launch                      |
| Health check run time     | Not precisely measured; completed within ~5 s                                                 |
| Config page load          | Instantaneous on LAN; all 21 config sections rendered without pagination                      |

The sustained REST polling rate means the trace store accumulates events rapidly. The 30-minute retention window (`RETENTION_WINDOW_MS`) and 8-entry display cap together create a situation where the diagnostics view is always full but always stale from the operator's perspective.

---

## 4. UX Observations from Screenshots

Screenshots in `doc/img/app/play/sections/04-hvsc.png` show the HVSC section in its ready state (Download + Ingest buttons, progress bar). The actual device-observed failure state (red error text) is not reflected in any screenshot in the image corpus.

Key UX gaps observed on device:

- No neutral "connecting..." initial badge state.
- No in-app platform warning for iOS HVSC limitation.
- Diagnostics activity labels ("rest.get") provide no actionable context.
- After HVSC extraction failure, "Ingest HVSC" remaining enabled is confusing; no recovery path is shown.
- The "Playback failed HTTP 404:" toast includes a trailing colon with empty body — string formatting bug in error composition.

---

## 5. Consolidated Issue List

| ID      | Severity | Effort | Area        | Title                                                |
| ------- | -------- | ------ | ----------- | ---------------------------------------------------- |
| R11-001 | Critical | S      | HVSC        | Extraction fails: offsetBytes rejection              |
| R11-002 | High     | S      | HVSC        | Ingest button enabled after extraction failure       |
| R11-003 | High     | M      | HVSC/iOS    | iOS has no native plugin; extraction silently fails  |
| R11-004 | High     | S      | Diagnostics | All REST actions opaque "rest.get" in activity list  |
| R11-005 | Medium   | S      | Diagnostics | 8-entry cap + frozen live update in dialog           |
| R11-006 | Medium   | S      | Diagnostics | Config Drift and Heat Map not discoverable           |
| R11-007 | High     | M      | Health      | Cold-launch badge shows UNHEALTHY on working device  |
| R11-008 | Medium   | M      | Health      | Badge and diagnostics header can diverge post-check  |
| R11-009 | Medium   | S      | Playback    | SID 404 error message truncated and context-free     |
| R11-010 | High     | L      | iOS         | HVSC feature enabled but non-functional on iOS       |
| R11-011 | Low      | S      | Web         | HVSC download blocked with no explanation            |
| R11-012 | Medium   | S      | UX          | UNHEALTHY badge on first launch misleads operators   |
| R11-013 | Low      | —      | Swipe       | Swipe threshold already viewport-relative — no issue |
| R11-014 | Low      | S      | Docs        | DocsPage missing diagnostics sections and deep links |

---

## 6. Phased Execution Plan

### Phase 1 — Critical fixes (unblock HVSC on Android)

- Fix R11-001: correct the `offsetBytes` type contract between JS and Kotlin in `HvscIngestionPlugin.kt` and/or `hvscIngestion.ts`.
- Fix R11-002: gate "Ingest HVSC" on `extraction.status === "success"` not `download.status === "success"`.

### Phase 2 — Health state correctness

- Fix R11-007: introduce a neutral initial health state; do not drive the badge from trace failures before the first successful REST response is confirmed.
- Fix R11-008: document or resolve the post-health-check badge/header divergence path.

### Phase 3 — Diagnostics quality

- Fix R11-004: add hostname, method, and path to collapsed action summary rows.
- Fix R11-005: revisit display cap and live-update behavior in the diagnostics dialog.
- Fix R11-006: add a sections index to the top of the diagnostics dialog.

### Phase 4 — Platform parity and documentation

- Fix R11-003/R11-010: add iOS native plugin to reach feature parity with Android.
- Fix R11-009: improve playback error messages to distinguish REST 404 from file-not-found.
- Fix R11-011: add explanatory text when HVSC download is blocked on web.
- Fix R11-014: update DocsPage with diagnostics sections and deep-link paths.

---

## 7. Termination Criteria

This review is complete when:

1. HVSC baseline download + extraction completes successfully on a physical Android device (Pixel 4).
2. HVSC ingest button is disabled in all states where extraction has not succeeded.
3. Health badge shows a neutral/connecting state on cold launch and transitions to HEALTHY after first successful REST poll without requiring a manual health check.
4. Collapsed diagnostics activity rows show at minimum: method, hostname, and path for REST actions.
5. iOS users enjoy full HVSC support, just as on Android.
6. DocsPage lists all reachable diagnostics sections and their deep-link paths.
7. `npm run test:coverage` passes with >= 91% branch coverage.
8. `npm run build` passes.
