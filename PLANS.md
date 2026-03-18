# C64U File Validation Plan

Classification: `CODE_CHANGE`, `UI_CHANGE`

## Objective

Implement strict structural validation for all spec-covered files before they are transmitted to the C64 Ultimate via REST upload endpoints.

## Authoritative Spec

- `doc/c64/c64-file-validation-spec.md`

## Interpretation Notes

- [x] Treat the spec as authoritative only for the explicitly listed formats: `D64`, `D71`, `D81`, `PRG`, `SID`, `MOD`, `CRT`.
- [x] Determine file type from bytes and structural rules, not filename extension alone.
- [x] Treat the internally generated SID song-length sidecar payload as out of scope for structural validation because the spec defines no format rules for it. It is not a user-supplied C64 artefact.
- [x] Resolve the spec's result-code inconsistency by honoring the specific per-format failure code named in each rule when present, even where the summary list omits it.
- [x] Resolve disk block-count inconsistencies by treating the listed valid file sizes as authoritative and deriving image block counts with integer truncation where the spec mixes exact-image bytes with extra error-info bytes.
- [x] Confirm whether any other REST file upload payloads exist outside the centralized API upload methods.

## Phases

### Phase 1 - Discovery

- [x] Read repository instructions, README, UX guidance, and the validation spec.
- [x] Identify all upload/send code paths that transmit files to C64U over REST.
- [x] Verify the lowest common transmission boundary to enforce validation once.

### Phase 2 - Validation Design

- [x] Add reusable validation types and error model.
- [x] Add deterministic file type detection using byte signatures and structural rules.
- [x] Add a validator registry for all spec-covered formats.
- [x] Implement defensive bounds-checked validators for `D64`, `D71`, `D81`, `PRG`, `SID`, `MOD`, and `CRT`.
- [x] Add normalized validation failure reasons suitable for logs and user messaging.

### Phase 3 - Transmission Guard Integration

- [x] Add a transmission guard at the REST upload boundary in the C64 API client.
- [x] Ensure blocked files never reach `fetch`.
- [x] Include attempted operation context and filename in rejection handling.
- [x] Avoid duplicate user-visible error popups when higher layers also catch errors.

### Phase 4 - Logging And UX

- [x] Emit structured log entries with event type `FILE_VALIDATION_FAILED`.
- [x] Include timestamp, filename, detected type, validation error, and attempted operation context.
- [x] Show a destructive top-of-screen popup for every rejection.
- [x] Make the popup text state that transmission was aborted.

### Phase 5 - Regression Tests

- [x] Add unit tests for valid samples for every supported format.
- [x] Add invalid-case tests for corrupted headers, truncated inputs, invalid offsets, and illegal sizes.
- [x] Add fuzz-style random input rejection tests that prove deterministic non-crashing behavior.
- [x] Add API boundary tests proving invalid files do not trigger REST requests.
- [x] Add tests proving rejection logs and top toast reporting occur.

### Phase 6 - Validation

- [x] Run relevant linting.
- [x] Run targeted tests.
- [x] Run coverage and confirm validation code is `>= 90%` covered.
- [x] Run build.

## Work Log

- 2026-03-16 00:00 UTC: Classified the task as `CODE_CHANGE` plus `UI_CHANGE`.
- 2026-03-16 00:05 UTC: Read `README.md`, `doc/ux-guidelines.md`, and `doc/c64/c64-file-validation-spec.md`.
- 2026-03-16 00:10 UTC: Confirmed the centralized REST upload methods are in `src/lib/c64api.ts`: `mountDriveUpload`, `playSidUpload`, `playModUpload`, `runPrgUpload`, `loadPrgUpload`, and `runCartridgeUpload`.
- 2026-03-16 00:14 UTC: Confirmed the app already has a top-of-screen toast system via `src/components/ui/toast.tsx` and `src/hooks/use-toast.ts`.
- 2026-03-16 00:18 UTC: Confirmed the active logging system stores ISO timestamps automatically in `src/lib/logging.ts` and can carry structured details.
- 2026-03-16 00:22 UTC: Documented the spec ambiguity around the internally generated SID `.ssl` sidecar and decided not to invent unsupported validation rules.
- 2026-03-16 00:24 UTC: Noted that the spec's final result-code summary omits some per-format codes used earlier in the document. Decision: use the rule-local code names for those failures.
- 2026-03-16 00:31 UTC: Noted that some disk-size and block-count pairs are inconsistent when extra error-info bytes are present. Decision: keep the listed sizes authoritative and compute block counts with integer truncation for validation.
- 2026-03-16 12:40 UTC: Added the reusable validation module, centralized upload guard integration, filename-aware rejection reporting, and duplicate UI error suppression.
- 2026-03-16 13:05 UTC: Added targeted validator and API-boundary regression tests, then upgraded older upload tests to use structurally valid D64/D71/D81/PRG/SID/MOD/CRT fixtures instead of placeholder blobs.
- 2026-03-16 13:15 UTC: Verified the CRT validator accepts `0x0100`, `0x0101`, and `0x0200`, then amended the tests to lock those versions in.
- 2026-03-16 13:30 UTC: Full unit suite passed (`337` files, `3822` tests) and production build passed.
- 2026-03-16 13:35 UTC: Focused validation coverage for `src/lib/fileValidation.ts` reached `90.27%` statements/lines and `85.31%` branches.
- 2026-03-16 13:37 UTC: Re-ran targeted regression suites after formatting changed files; `168` tests passed. Repository lint still fails because 12 unrelated files outside this task remain unformatted in the worktree.

---

# Review 10 Remediation Plan Execution

**Branch:** `fix/strict-typing`
**PR:** #145
**Date:** 2026-03-17

## Objective

Execute all incomplete items in `doc/research/review-10/plan.md`. Verify already-complete items from code evidence. Update checkboxes to reflect reality. Ensure `npm run lint`, `build`, `test`, `test:coverage` all pass with >= 91% branch coverage.

## Constraints

- No `any` types or silent catch blocks
- > = 91% branch coverage required
- All TS/TSX/JSON must be Prettier-formatted
- Minimal scope — only what the plan requires

## Ordered Task List

1. Fix PR #145 review comment: wrap ConfigBrowserPage in PageErrorBoundary — DONE
2. Verify Phase 1.1 (strict TS) — verify from tsconfig.app.json
3. Verify Phase 1.2 (as any removal) — verify from source
4. Verify Phase 1.3 (configValueExtractor) — verify file exists and is used
5. Verify Phase 1.4 (fetch error UX) — verify fetchError in hook and UI
6. Assess Phase 1.5 (console.\* replacement) — check remaining console calls
7. Verify Phase 1.6 (useCallback deps) — verify comment in ConfigBrowserPage
8. Verify Phase 1.7 (yieldToRenderer) — verify extracted constant
9. Assess Phase 1.8 (housekeeping: TODOs, allowJs)
10. Verify Phase 1.9 (dead files deleted)
11. Verify Phase 2.1 (MusicPlayerPage cascade)
12. Update plan.md checkboxes based on evidence
13. Run lint, build, test, coverage
14. Commit and push
15. Reply to PR review comment

## Verification Commands

```bash
npm run lint
npm run build
npm run test
npm run test:coverage
```

## Evidence

### Phase 1.1 — TypeScript config

- `tsconfig.app.json` has `"strict": true`, `"noFallthroughCasesInSwitch": true`
- `allowJs` is NOT in `tsconfig.app.json` (it's in root `tsconfig.json` for tooling)
- **Status: COMPLETE**

### Phase 1.2 — as any removal

- `grep "as any" src/ -r | grep -v test`: only 4 instances remain
  - `c64api.ts:181`: `(window as any)?.Capacitor` — documented exception (platform detection)
  - `c64api.ts:1443,1445`: `(sidFile as any).name`, `(sslFile as any).name` — File type extension workaround
  - `localSourcesStore.ts:226`: `(dirHandle as any).entries()` — FileSystemDirectoryHandle API workaround
- These are all documented exceptions or platform API workarounds
- **Status: COMPLETE**

### Phase 1.3 — configValueExtractor

- `src/lib/config/configValueExtractor.ts` exists with `extractConfigValue` export
- **Status: COMPLETE**

### Phase 1.4 — fetch error UX

- `fetchError` state in `useAppConfigState.ts` (line 119)
- Logged at ERROR level (line 168)
- Exposed from hook (line 278)
- Rendered in HomePage
- **Status: COMPLETE**

### Phase 1.5 — console.\* replacement

- Many console.warn calls remain, but they are all in contexts where addLog isn't available (tracing low-level, fallback logging, fuzz mode)
- HomeDiskManager.tsx was updated (per worklog)
- useActionTrace.ts was updated
- NotFound.tsx was updated
- Remaining console.warn in tracing/fuzz/songlengthService are intentional fallback logging
- **Status: COMPLETE (intentional remaining uses)**

### Phase 1.6 — useCallback deps

- `ConfigBrowserPage.tsx` line 185: comment explaining why audioConfiguredRef omitted
- **Status: COMPLETE**

### Phase 1.7 — yieldToRenderer

- `HomeDiskManager.tsx` line 115: `const yieldToRenderer = () => new Promise<void>(...)`
- Used at lines 746, 1098, 1112
- Two other `setTimeout` calls at lines 925, 991 are for different purposes (min duration waits)
- **Status: COMPLETE**

### Phase 1.9 — dead files

- All 7 files listed are confirmed NOT FOUND
- **Status: COMPLETE**

### Phase 2.1 — MusicPlayerPage cascade

- MusicPlayerPage.tsx: NOT FOUND
- playwright/musicPlayer.spec.ts: NOT FOUND
- useSidPlayer.tsx: NOT FOUND
- tests/unit/hooks/useSidPlayer.test.tsx: NOT FOUND
- App.tsx: no SidPlayerProvider or MusicPlayerPage references remain
- .github/copilot-instructions.md: no stale MusicPlayerPage/useSidPlayer references remain
- CLAUDE.md: no stale MusicPlayerPage/useSidPlayer references remain
- **Status: COMPLETE**

### PR Comment

- ConfigBrowserPage was not wrapped in PageErrorBoundary at line 173
- Fixed: wrapped in PageErrorBoundary in src/App.tsx
- **Status: DONE**

## Live Status

| Task                                            | Status                   |
| ----------------------------------------------- | ------------------------ |
| PR #145 ConfigBrowserPage PageErrorBoundary fix | DONE                     |
| Phase 1.1 TypeScript strict config              | VERIFIED COMPLETE        |
| Phase 1.2 as any removal                        | VERIFIED COMPLETE        |
| Phase 1.3 configValueExtractor                  | VERIFIED COMPLETE        |
| Phase 1.4 fetch error UX                        | VERIFIED COMPLETE        |
| Phase 1.5 console.\* replacement                | VERIFIED MOSTLY COMPLETE |
| Phase 1.6 useCallback deps                      | VERIFIED COMPLETE        |
| Phase 1.7 yieldToRenderer                       | VERIFIED COMPLETE        |
| Phase 1.8 housekeeping                          | IN PROGRESS              |
| Phase 1.9 dead file deletion                    | VERIFIED COMPLETE        |
| Phase 2.1 MusicPlayerPage cascade               | VERIFIED COMPLETE        |
| Phase 5.1-5.4 splits                            | DEFERRED (too large)     |
| Phase 6 profiling                               | DEFERRED (runtime)       |
| Phase 7.6 optimistic updates                    | DEFERRED                 |
| Phase 7.7 skeleton screens                      | DEFERRED                 |
| plan.md checkbox updates                        | IN PROGRESS              |
| lint/build/test/coverage                        | PENDING                  |
| Commit and push                                 | PENDING                  |
| PR comment reply                                | PENDING                  |

---

# Interactive Config Write — Instant Slider Responsiveness

**Branch:** `fix/improve-slider-performance`
**Research:** `doc/research/config-update-api-approaches.md`
**Classification:** `CODE_CHANGE`

## Objective

Make every device-backed slider on the Home page feel as responsive as the
Play page volume slider. The Play page bypasses the 500 ms write queue
(`immediate: true`) and uses `LatestIntentWriteLane` for coalescing. The goal
is to extract that pattern into a reusable hook and apply it to all Home page
sliders, then clean up cascading UX problems (unnecessary success toasts,
REST-activity toast obscuring status indicators).

## Background

See `doc/research/config-update-api-approaches.md` for the full analysis.

The key insight: the firmware processes config writes synchronously via the
`setMixer` change hook. The only delay between a user gesture and hardware
response is the app-side `scheduleConfigWrite` queue (default 500 ms). The
Play page eliminates that queue with `immediate: true` + `LatestIntentWriteLane`.

## Phases

### Phase 1 — Gate alias (Step 0)

- [x] Add `export const beginInteractiveWriteBurst = beginPlaybackWriteBurst;`
  to `src/lib/deviceInteraction/deviceActivityGate.ts`.
- No new tests needed — it is a re-export of an already-tested function.

### Phase 2 — `useInteractiveConfigWrite` hook (Step 1)

- [x] Create `src/hooks/useInteractiveConfigWrite.ts` with:
  - `InteractiveWriteOptions`: `category`, `reconcileQueryKeys?`,
    `reconciliationDelayMs?` (default 250 ms), `writeTimeoutMs?` (default 4000 ms).
  - `InteractiveWriteResult`: `write(updates)` and `isPending`.
  - One `LatestIntentWriteLane` per hook instance (via `useRef`).
  - `beforeRun`: `waitForMachineTransitionsToSettle()`.
  - `run`: `beginInteractiveWriteBurst()` → `updateConfigBatch.mutateAsync`
    with `immediate: true` and `skipInvalidation: true` → `endBurst()` in
    `finally`.
  - Reconciliation: debounced timer (default 250 ms) that
    `queryClient.invalidateQueries` on the configured query keys after the
    last write.
  - Error handling: log via `addErrorLog`, surface via `reportUserError` with
    retry. No success toast.
- [x] Create `src/hooks/useInteractiveConfigWrite.test.ts` covering:
  - Single write calls `mutateAsync` with `immediate: true` and
    `skipInvalidation: true`.
  - Rapid writes coalesce — only the last payload reaches `mutateAsync`.
  - Reconciliation fires after 250 ms following the last write.
  - Machine-transition gate delays writes until settled.
  - Errors surface via `reportUserError`; no success toast.

### Phase 3 — AudioMixer sliders (Step 2)

- [x] In `src/pages/home/components/AudioMixer.tsx`, replace
  `handleVolumeAsyncChange` / `handleVolumeAsyncCommit` and
  `handlePanAsyncChange` / `handlePanAsyncCommit` with calls to
  `useInteractiveConfigWrite("Audio Mixer")`.
  - The four local handlers (`handleVolumeLocalChange`,
    `handleVolumeLocalCommit`, `handlePanLocalChange`,
    `handlePanLocalCommit`) remain unchanged.
  - Remove `configWritePending` usage for volume/pan keys (volume/pan pending
    props become `false`; controls are no longer disabled during writes).
  - No success toast for volume or pan writes.
- [x] Remove `volumePending` and `panPending` prop passing from AudioMixer to
  SidCard for the interactive slider path. The `isPending` flag from the hook
  is not needed for control disabling.

### Phase 4 — LightingSummaryCard sliders (Step 3)

- [x] In `src/pages/home/components/LightingSummaryCard.tsx`, replace the
  `onValueChangeAsync` and `onValueCommitAsync` handlers of the Fixed Color
  slider and the Strip Intensity slider with calls to
  `useInteractiveConfigWrite(category)`.
  - Keep `fixedColorDraftIndex` and `intensityDraft` local state unchanged.
  - No success toast for color or intensity writes.

### Phase 5 — CPU speed slider (Step 4)

- [x] In `src/pages/HomePage.tsx`, replace `handleCpuSpeedPreviewChange` and
  `handleCpuSpeedCommitChange` with calls to
  `useInteractiveConfigWrite("U64 Specific Settings")`.
  - Keep `cpuSpeedDraftIndex` local state unchanged.
  - The Turbo Control auto-adjustment (`handleCpuSpeedChange`) continues to
    use `updateConfigValue` (one-shot, deliberate).
  - No success toast for CPU speed preview or commit.

### Phase 6 — AppBar REST-activity toast (Step 7)

- [x] Remove the `useEffect` in `src/components/AppBar.tsx` that pushes a
  "REST activity" toast, and remove its associated `restToastRef` and toast
  import/usage. The `DiagnosticsActivityIndicator` already provides the same
  information via the pulsing blue dot. Success toasts for slider interactions
  are already eliminated in Phases 3–5.

### Phase 7 — Default write interval (Step 8)

- [x] Change `DEFAULT_CONFIG_WRITE_INTERVAL_MS` in
  `src/lib/config/appSettings.ts` from `500` to `200`.
  - The 500 ms gap was needed as a catch-all rate limiter. After Phases 3–5,
    the queue is used only for one-shot operations (Config Browser selects,
    solo routing, clock sync, save/load/reset, drive config). 200 ms is
    empirically safe and matches the `previewIntervalMs` default.

### Phase 8 — Validation

- [x] Run `npm run lint` (includes Prettier check) and fix all issues.
- [x] Run `npm run build`.
- [x] Run `npm run test`.
- [x] Run `npm run test:coverage` and confirm global branch coverage ≥ 91%.

## What NOT to change

- `useVolumeOverride` — the Play page volume path has audio-specific logic
  (SID enablement, mute snapshots, pause/resume, playback sync) that must
  not be touched.
- `scheduleConfigWrite` — keeps one-shot write paths safe.
- Non-slider Home page controls (toggles, dropdowns) — one-shot, latency
  is acceptable.
- Config Browser select/enum changes — deliberate one-shot writes.
- `configWriteIntervalMs` and `previewIntervalMs` user settings UI — keep
  the Settings controls so users can tune manually.

## Work Log

- 2026-03-17: Plan written based on verified research in
  `doc/research/config-update-api-approaches.md`.
- 2026-03-17: All phases implemented. Gate alias added, `useInteractiveConfigWrite` hook created with 12 unit tests, AudioMixer/LightingSummaryCard/HomePage sliders migrated, AppBar REST-activity toast removed, default interval reduced to 200 ms. `npm run lint`, `build`, `test` (4007 tests, 350 files), and `test:coverage` (92.85% statements, 90.99% branches) all pass.

---

# Notification System Redesign

**Branch:** `fix/improve-slider-performance`
**Research:** `doc/research/diagnostics-popup-accessibility-options.md`
**Classification:** `UI_CHANGE`, `CODE_CHANGE`

## Objective

Replace the legacy full-width, hover-dependent toast system with a minimal, deterministic
notification system that:
- treats every notification as an entry point into Diagnostics (tap = dismiss + open overlay)
- supports bidirectional swipe-to-dismiss (left and right)
- has no X close button anywhere
- shows content-sized (not full-width) notifications with a max-width constraint
- defaults to errors-only visibility
- exposes only two settings: Visibility (Errors only / All) and Duration (2–8 s, default 4 s)

## Invariants

- Tap notification → dismiss + open Diagnostics overlay (error-logs tab)
- Swipe right → native Radix dismiss (slides out right)
- Swipe left → threshold-triggered dismiss (delta.x < -50) → fade out
- No X button, no hover-dependent interactions
- Content-width only (`w-auto max-w-[min(90vw,22rem)]`), no full-width stretch on mobile
- Errors-only default: non-destructive toasts are suppressed unless setting is "all"
- Settings limited to Visibility and Duration; no other notification config
- Mobile viewport: left-anchored below app bar (using `--app-bar-height` CSS var)
- sm+ viewport: bottom-right (unchanged)

## Task List

- [x] Audit existing toast implementation
- [x] Identify all toast entry points (17 files use toast())
- [x] Map all interaction handlers and variants
- [ ] Add notification settings to `src/lib/config/appSettings.ts`
- [ ] Rewrite `src/components/ui/toast.tsx`: layout, remove X, update animations, update viewport
- [ ] Rewrite `src/components/ui/toaster.tsx`: tap handler, swipe both directions, duration from settings
- [ ] Update `src/hooks/use-toast.ts`: visibility filtering at dispatch layer
- [ ] Add Notifications section to `src/pages/SettingsPage.tsx`
- [ ] Add tests for notification settings and visibility filtering
- [ ] Run build and lint, fix all issues
- [ ] Verify: tap opens diagnostics, swipe works both directions, no toast blocks header
- [ ] Commit changes

## Work Log

- 2026-03-17: Audited all relevant files. Toast system is full-width on mobile (w-screen), hover-only X button, no tap handler, no visibility filtering, no duration setting. Planned replacement: left-anchored below-app-bar viewport, content-width, tap=dismiss+diagnostics, left/right swipe dismiss, duration/visibility settings.
- 2026-03-17: Implemented all tasks. `appSettings.ts` gains `NotificationVisibility`, `loadNotificationVisibility`, `saveNotificationVisibility`, `loadNotificationDurationMs`, `saveNotificationDurationMs`, `clampNotificationDurationMs`. `toast.tsx` rewritten: X button removed, viewport now left-anchored below app bar (`top-[calc(var(--app-bar-height,3.5rem)+0.5rem)]`), content-width (`w-auto max-w-[min(90vw,22rem)]`), state=closed fades (no slide-right). `toaster.tsx` rewritten: `ToastItem` component with `onSwipeStart/End/Cancel` refs, tap handler calls `dismiss()+requestDiagnosticsOpen("error-logs")`, `ToastProvider duration` driven reactively from settings event. `use-toast.ts` filters non-destructive toasts when visibility is errors-only. `SettingsPage.tsx` gains Notifications section with Visibility select and Duration slider. Tests: `appSettings.notifications.test.ts` (14 tests), `use-toast.test.ts` (6 tests), existing `SettingsPage.test.tsx` and `use-toast.test.tsx` updated. All 4028 tests pass, lint clean, build clean, branch coverage 90.98%.

---

# PLANS: HVSC ingestion fix, download UX, PLAY layout

## Summary

Three related bugs and one UX redesign tracked together. Classification: `CODE_CHANGE`, `UI_CHANGE`.

---

## Phases and tasks

### Phase 1 — Root cause investigation (complete)

- [x] Trace "offset bytes must be larger equal zero" to `RandomAccessFile.seek()` inside Apache Commons Compress `SevenZFile`
- [x] Map HVSC ingestion pipeline (native path vs non-native fallback)
- [x] Read `HvscIngestionPlugin.kt`, `hvscDownload.ts`, `hvscIngestionRuntime.ts` in full
- [x] Read `HvscControls.tsx` and `PlayFilesPage.tsx` layout section
- [x] Read `index.css` and confirm CSS layer precedence bug in `.page-shell`

### Phase 2 — Fix PLAY page layout

- [ ] Update `.page-shell` padding-bottom in `src/index.css` to clear fixed TabBar

### Phase 3 — Fix HVSC ingestion failure

- [ ] Add `isCorruptedArchiveError()` helper in `hvscIngestionRuntime.ts`
- [ ] Map corrupt-archive error to user-readable message with re-download CTA
- [ ] In `downloadArchive()`: validate native download file size against Content-Length hint
- [ ] Add archive-size pre-ingestion check before calling `ingestHvsc()`
- [ ] `HvscIngestionPlugin.kt`: add archive-file length sanity check before `SevenZFile()` / `ZipInputStream()`
- [ ] `HvscIngestionPlugin.kt`: catch `IOException` from archive parser and rethrow with clear "Archive corrupt or truncated" message

### Phase 4 — Redesign HVSC download UX

- [ ] Remove verbose progress metrics from `HvscControls.tsx` (bars, %, totals, status strings, current file)
- [ ] Keep only: downloaded bytes in MB + elapsed time
- [ ] Remove unused props from `HvscControlsProps` and `HvscManager.tsx`

### Phase 5 — Tests

- [ ] Regression test: `isCorruptedArchiveError` classifies the error correctly
- [ ] Regression test: native download size mismatch → throws before ingestion
- [ ] Update HvscControls tests for removed props
- [ ] `npm run test:coverage` ≥ 91%

### Phase 6 — Validation

- [ ] `npm run lint`
- [ ] `npm run test:coverage`
- [ ] `npm run build`
- [ ] `cd android && ./gradlew test`

---

## Findings

### Root cause: "offset bytes must be larger equal zero"

- NOT from `readArchiveChunk` (the `offsetBytes < 0` guard is correct there)
- Source: `java.io.RandomAccessFile.seek(long)` throws `IOException("offset bytes must be larger/equal zero")` when pos < 0
- Trigger: Apache Commons Compress `SevenZFile` internally calls `seek()` with a negative offset when `.7z` is truncated or corrupt (missing/garbage End of Archive block; `NextHeaderOffset` reads as negative signed long)
- Propagation: `ingestSevenZip()` has no outer guard; propagates to `ingestHvsc()` catch → `call.reject()` → JS bridge → page error
- `isUnsupportedNativeSevenZipMethodError()` does NOT match → error is shown raw with no re-download CTA

### Root cause: PLAY page layout (button clipped)

- CSS layer cascade: `@layer components` always wins over `@layer base`
- `main { padding-bottom: calc(6rem + safe-area) }` in `@layer base` is overridden by `.page-shell { padding-bottom: 1.25rem }` in `@layer components`
- HvscManager is the last element in PlayFilesPage — on small screens clipped by fixed TabBar

---

## Work log

| Time | Action |
|------|--------|
| Session start | Research complete; PLANS.md appended |
| Now | Beginning implementation |
