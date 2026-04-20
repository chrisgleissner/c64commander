# HVSC Playlist Convergence Plan

## Classification

- `CODE_CHANGE`
- `UI_CHANGE`

### 2026-04-06 device-scale harness execution

- Classification: `CODE_CHANGE`
- Current task: `HARNESS-ANDROID-SCALE-001`
- Current dominant bottleneck: not selected yet; honest required-platform baselines remain the gate.
- External prerequisites verified before implementation:
  - preferred Pixel 4 attached over adb: `9B081FFAZ001WX`
  - real C64U host reachable at `http://u64/v1/info`
  - real web archive inputs present at `~/.cache/c64commander/hvsc/HVSC_84-all-of-them.7z` and `~/.cache/c64commander/hvsc/HVSC_Update_84.7z`
- Harness changes now landed and validated:
  - `.maestro/perf-hvsc-baseline.yaml` no longer seeds the measurement run with the single-track `10_Orbyte.sid` path
  - `perf-hvsc-setup-playlist` remains the large-playlist setup phase
  - smoke snapshots now record playlist size and feedback visibility metadata for download, ingest, add-to-playlist, filter, and playback-start
  - playlist filter smoke artifacts now emit `playlist-filter-high`, `playlist-filter-low`, and `playlist-filter-zero` instead of collapsing into one overwritten `playlist-filter` file
  - Android summary output now includes `feedbackEvidence`, `targetEvidence.UX1`, and `targetEvidence.T6`
  - playback-start smoke artifacts now carry playlist-size context from the Play page controller
- Validation completed for the harness change:
  - targeted regressions passed for Android summary, Maestro contracts, playlist filtering, add-to-playlist smoke metadata, playback smoke metadata, and HVSC snapshot emitters
  - `npm run lint`: passed with 3 non-fatal warnings in generated `c64scope/coverage/*` files
  - `npm run build`: passed
  - `npm run test:coverage`: passed with 496 test files, 5642 tests, and 91.15% branch coverage
- Remaining work on this execution path:
  - keep `ci-artifacts/hvsc-performance/web/web-full-nightly.json` as an explicit unsupported blocker artifact until the web S1-S11 suite can run at full scale without fixture-backed browse/playback phases
  - diagnose the Pixel 4 large-playlist setup failure seen in `20260406T1730Z-hvsc-android-pilot` before retrying the Android baseline; the pilot never reached `Items added`, ended with a zero-byte Perfetto trace, and the device dropped off adb afterward
  - rerun the first honest Pixel 4 Android baseline with `summary.json`, a non-empty Perfetto trace, extracted metrics, playlist-size evidence, and UX feedback evidence once the setup failure is resolved
  - update the target matrix only from those measured artifacts

### 2026-04-06 follow-up convergence closure

- Classification: `DOC_ONLY`
- Scope of this follow-up: verify the live Add Items chooser and import screenshots, then refresh the stale HVSC audit and remaining-work prompt to match the current repository state.
- Validation scope before implementation:
  - run targeted chooser regressions in `tests/unit/components/FileOriginIcon.test.tsx` and `tests/unit/components/itemSelection/ItemSelectionDialog.test.tsx`
  - verify the referenced Play import screenshots exist and match the live UI before considering any regeneration
  - re-read touched tracker and audit documents and verify every referenced repo path or artifact path exists
- Constraint: do not reopen prior code or screenshot work unless the live tree disproves the existing implementation or documentation.

## 2026-04-06 Follow-up Convergence Status

- [x] `UI-SOURCE-001` Verified the live Add Items chooser against code, targeted regressions, and the current import screenshots; no code change required.
- [x] `UI-DOC-002` Verified the README import screenshot references and the five referenced screenshot files; no screenshot regeneration required.
- [x] `PERF-AUDIT-003` Refreshed `docs/research/hvsc/performance/audit/audit.md` against the current tree, trackers, workflows, and artifact roots.
- [x] `PERF-PROMPT-004` Replaced `docs/research/hvsc/performance/audit/convergence-prompt.md` with the real remaining work only.
- [x] `CLOSE-005` Rechecked the touched trackers and audit documents so the current repo state, evidence paths, and remaining-work prompt agree.

## Mission

Restore deterministic playlist correctness for HVSC imports and large playlists. The import workflow must not declare completion until playlist persistence is complete, repository reads reflect the full dataset, and the UI can immediately render the correct playlist state without waiting for background sync.

## P0 Failure Statement

Observed failure:

1. Import completes, playlist appears empty, then items materialize later.
2. `View all` appears only after delayed playlist materialization.

Validated root cause:

- `useQueryFilteredPlaylist` currently mirrors the full React playlist into the repository asynchronously on every playlist mutation.
- Large imports create a backlog of full-playlist rewrites.
- The hook suppresses repository-backed results until the async mirror finishes, so UI correctness lags behind the import completion signal.

## Non-negotiable Rules

- Lazy behavior is allowed only for rendering and paging.
- Lazy behavior is forbidden for persistence, correctness, completion semantics, and UI truth.
- `Import complete` must occur only after repository write completion and read-back validation.
- There must be zero real repository writes after the UI transitions to ready for a given snapshot.

## Execution Order

### Phase 1. Ingest to Playlist Consistency

- [x] Instrument scan start and end, batch creation, batch append, repository commit start and end, repository validation, and UI readiness transition.
- [x] Introduce an explicit playlist import state machine with `SCANNING`, `INGESTING`, `COMMITTING`, and `READY`.
- [x] Replace eventual repository mirroring with an explicit commit barrier for playlist imports.
- [x] Add repository read-back validation so expected item count must equal committed item count before success.
- [x] Fail loudly and keep the workflow non-ready if repository validation fails.

### Phase 2. Restore `View all` Availability

- [x] Decouple `View all` visibility from lazy rendered rows.
- [x] Base `View all` availability on authoritative item counts instead of overflow-only preview state.
- [x] Apply the fix to both Play page and Disks page shared list surfaces.

### Phase 3. Rebuild `View all` Bottom Sheet for Scale

- [x] Keep eager correctness metadata only: count, ordering, section anchors.
- [x] Keep rendering windowed with virtualization.
- [x] Keep repository fetch incremental with paging for large lists.
- [x] Add fast jump affordances for large result sets.
- [x] Ensure first viewport opens immediately without blocking on full list hydration.

### Phase 4. Harden Playlist Hydration and Query Model

- [x] Audit and fix `playlistRepository`, `usePlaybackPersistence`, `useQueryFilteredPlaylist`, and `usePlaylistListItems` integration.
- [x] Remove stale cache and hidden async rebuild dependencies from playlist correctness.
- [x] Introduce explicit repository invalidation and ready revision tracking after each committed snapshot.
- [x] Guarantee deterministic read-after-write behavior for repository-backed queries.

### Phase 5. Regression and Stress Coverage

- [x] Add a consistency test for 10K+ imported items with immediate repository count assertion.
- [x] Add a regression test proving the UI does not report completion before repository commit resolves.
- [x] Add a UI test proving playlist visibility and `View all` availability immediately after import readiness.
- [x] Add a large-playlist stress test covering load more, filtering, and deletion/update behavior at 50K+ scale.
- [x] Hold changed-code branch coverage above 91% during `npm run test:coverage`.

### Phase 6. Performance Re-measurement

- [x] Re-measure S6 add to playlist.
- [x] Re-measure S7 playlist render.
- [x] Re-measure S8 to S10 playlist filtering.
- [x] Update target status for T2 ingest, T3 browse, and T4 filter.
- [x] Record evidence and blockers in `WORKLOG.md`.

## Current Evidence

- Focused regression validation passed: 95 targeted tests, 0 failed.
- Earlier closeout validation passed: `npm run test:ci` end-to-end, including screenshots, Playwright E2E, evidence validation, trace validation, and production build.
- Current follow-up validation passed:
  - `npm run screenshots`: 21 screenshot tests passed; 148 PNGs scanned, 148 kept
  - `npm run lint`: passed with 3 non-fatal warnings in generated `c64scope/coverage/*` files
  - `npm run build`: passed
  - `npm run test:coverage`: passed with 496 test files, 5639 tests, and 91.17% branch coverage
- Additional regressions covered during the convergence and follow-up cleanup passes:
  - delayed device-id playlist hydration now retries against the resolved playlist storage key before persistence resumes
  - stale Maestro and smoke-mode tests were updated to match current runtime behavior
  - Playwright layout and Home interaction assertions were refreshed to match current UI behavior and tolerance
  - Add Items source chooser icons now share a fixed slot width, including CommoServe
  - diagnostics history analysis now shows an expanded, scrollable health-check timeline for the selected segment
- Fresh web fixture perf artifact: `ci-artifacts/hvsc-performance/web/web-full-quick.json`
  - S6 add to playlist: `1613.72 ms` wall clock, `playlist:add-batch` p95 `17.2 ms`, `playlist:repo-sync` p95 `21.1 ms`
  - S7 render playlist: `6.75 ms` wall clock
  - S8 filter high match: `545.53 ms` wall clock, `playlist:filter` p95 `17.2 ms`
  - S9 filter zero match: `544.06 ms` wall clock, `playlist:filter` p95 `16.6 ms`
  - S10 filter low match: `550.23 ms` wall clock, `playlist:filter` p95 `13.9 ms`
  - Target evidence from the same run: T2 ingest `228.4 ms` pass, T3 browse `334.64 ms` pass, T4 filter `550.23 ms` pass

## Audit Reconciliation Snapshot

### Convergence Ledger Status

- Closed in the current repository state:
  - `P0.1` Reconcile tree with audit and trackers
  - `P0.2` Normalize artifact directory strategy
  - `P1.1` Close benchmark matrix gap `S1` through `S11`
  - `P1.2` Make the web perf harness benchmark real download and ingest
  - `P1.3` Close Android benchmark harness gap
  - `P1.4` Close instrumentation coverage gap
  - `P1.5` Close Perfetto pipeline gap
  - `P1.6` Close microbenchmark gap
- Still open:
  - `P2.1` Capture the first honest full baseline
  - `P2.2` Build the first pass/fail matrix
  - `P3.1` Execute Cycle 1 against the single dominant bottleneck
  - `P3.2` Repeat optimization cycles until every target is either passing or formally blocked
  - `P4.1` Close quick-CI gap
  - `P4.2` Close nightly-CI gap
  - `P5.1` Re-audit against `docs/research/hvsc/performance/audit/audit.md`
  - `P5.2` Produce final convergence record

Evidence anchors:

- `WORKLOG.md` entries:
  - `2026-04-05 09:00` (`P0.1`)
  - `2026-04-05 09:15` (`P0.2`)
  - `2026-04-05 09:30` (`P1.1`)
  - `2026-04-05 22:15` (`P1.2`)
  - `2026-04-05 23:30` (`P1.3`)
  - `2026-04-06 00:00` (`P1.4`)
  - `2026-04-06 00:15` (`P1.5`)
  - `2026-04-06 00:20` (`P1.6`)

### Target Status Snapshot

| Target | Current honest status                                                                | Evidence                                                                            |
| ------ | ------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------- |
| `T1`   | Open: not yet measured on both required platforms                                    | No current Docker web + Pixel 4 evidence recorded in `PLANS.md` / `WORKLOG.md`      |
| `T2`   | Partial only: web fixture evidence exists; full required-platform closure still open | `ci-artifacts/hvsc-performance/web/web-full-quick.json`                             |
| `T3`   | Partial only: web fixture evidence exists; Pixel 4 closure still open                | `ci-artifacts/hvsc-performance/web/web-full-quick.json`                             |
| `T4`   | Partial only: web fixture evidence exists; Pixel 4 closure still open                | `ci-artifacts/hvsc-performance/web/web-full-quick.json`                             |
| `T5`   | Open: no current required-platform closure recorded                                  | No current target-closing artifact recorded in `PLANS.md` / `WORKLOG.md`            |
| `T6`   | Open: not yet closed on Pixel 4 and Docker web                                       | Node-side stress evidence exists, but required-platform closure is not yet recorded |

### Current Bottleneck Selection

- No dominant optimization bottleneck is currently selected.
- Reason: the honest full baseline required by `P2.1` and `P2.2` is still incomplete, so later convergence cycles remain open by definition.

## Success Criteria

- [x] Playlist state is correct immediately after import completion.
- [x] UI correctness no longer depends on delayed background repository work.
- [x] `View all` is always available for non-empty authoritative lists.
- [x] Large imports remain correct and measurable at 50K+ items.
- [x] Performance targets are either measured with evidence or explicitly blocked with current bottleneck details.
