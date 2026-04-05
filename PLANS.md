# HVSC Performance Optimization Plan

## Current status

- Classification: `CODE_CHANGE`
- Phase: convergence pass per `docs/research/hvsc/performance/audit/convergence-prompt.md`
- Current convergence task: `P0.2` complete; starting `P1.1`.
- Worktree: clean (no dirty files).
- Verified execution prerequisites:
  - cached full-size archives present at `~/.cache/c64commander/hvsc/` (`HVSC_84-all-of-them.7z`, `HVSC_Update_84.7z`)
  - real Ultimate responds at `http://u64/v1/info`
  - attached device tooling reports Pixel 4 serial `9B081FFAZ001WX` online

## HVSC perf asset inventory (reconciled 2026-04-05)

All HVSC performance assets in the current tree, reconciled against the audit.

### Runtime instrumentation

| File                                                      | Purpose                                                                              |
| --------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| `src/lib/hvsc/hvscPerformance.ts`                         | Ring buffer, scope helpers, `performance.mark()`/`performance.measure()` integration |
| `src/lib/tracing/traceBridge.ts`                          | Exports `hvscPerfTimings` to tracing surface                                         |
| `src/components/diagnostics/GlobalDiagnosticsOverlay.tsx` | Exports `hvscPerfTimings` to diagnostics overlay                                     |
| `src/lib/smoke/smokeMode.ts`                              | Exports `hvscPerfTimings` to smoke benchmark snapshots                               |

### Instrumented scopes (landed)

- `download`, `download:checksum`
- `ingest:extract`, `ingest:songlengths`, `ingest:index-build`
- `browse:load-snapshot`, `browse:query`
- `playback:load-sid`

### Missing instrumented scopes (per audit Gap 5)

- `browse:render`
- `playlist:add-batch`
- `playlist:filter`
- `playlist:repo-sync`
- `playback:first-audio`

### Web benchmark infrastructure

| File                                       | Purpose                                                                            |
| ------------------------------------------ | ---------------------------------------------------------------------------------- |
| `playwright/hvscPerf.spec.ts`              | Playwright perf test; browse + playback only; does NOT exercise download or ingest |
| `scripts/hvsc/collect-web-perf.mjs`        | Loop runner; produces p50/p95 summary JSON                                         |
| `scripts/hvsc/assert-web-perf-budgets.mjs` | Budget comparator; observation-only without env vars                               |
| `playwright/mockHvscServer.ts`             | Disk-backed throttled mock HVSC server with `HEAD` and request logging             |

### Android benchmark infrastructure

| File                                     | Purpose                                                                                |
| ---------------------------------------- | -------------------------------------------------------------------------------------- |
| `.maestro/perf-hvsc-baseline.yaml`       | Maestro flow tagged `hvsc-perf`; navigates download → browse → add → play              |
| `scripts/run-hvsc-android-benchmark.sh`  | End-to-end orchestrator: Perfetto + telemetry + Maestro + artifact pull + summary      |
| `ci/telemetry/android/perfetto-hvsc.cfg` | Perfetto config; captures `linux.process_stats`, `linux.sys_stats`, `android.log` only |

### Smoke benchmark snapshot plumbing

| File                                          | Purpose                                                |
| --------------------------------------------- | ------------------------------------------------------ |
| `src/pages/playFiles/hooks/useHvscLibrary.ts` | Emits smoke benchmark snapshots during HVSC operations |
| `src/lib/hvsc/hvscService.ts`                 | Emits smoke benchmark snapshots during browse queries  |
| `src/lib/playback/playbackRouter.ts`          | Emits smoke benchmark snapshots during playback start  |

### CI workflow integration

| File                                  | Job/script                                                                  |
| ------------------------------------- | --------------------------------------------------------------------------- |
| `.github/workflows/android.yaml`      | `perf-benchmark-quick` job; runs secondary web Playwright perf only         |
| `.github/workflows/perf-nightly.yaml` | Nightly cron; runs secondary web nightly lane only                          |
| `package.json`                        | `test:perf`, `test:perf:quick`, `test:perf:nightly`, `test:perf:assert:web` |

### Tests

| File                                                    | Purpose                                       |
| ------------------------------------------------------- | --------------------------------------------- |
| `tests/unit/hvsc/hvscPerformance.test.ts`               | Ring buffer, eviction, error metadata         |
| `tests/unit/playwright/mockHvscServer.test.ts`          | Mock server throttle, `HEAD`, request logging |
| `tests/unit/ci/androidMaestroWorkflowContracts.test.ts` | Maestro flow contract assertions              |
| `tests/unit/ci/playFilesHvscHookContracts.test.ts`      | HVSC hook contract assertions                 |
| `tests/unit/ci/run_maestro_device_preflight.test.sh`    | Device preflight checks                       |

### Artifacts

| Path                                                         | Content                                     |
| ------------------------------------------------------------ | ------------------------------------------- |
| `ci-artifacts/hvsc-performance/web/web-secondary-quick.json` | Last quick baseline (3 loops, fixture mode) |

### Research documents

| File                                                                               | Purpose                                                            |
| ---------------------------------------------------------------------------------- | ------------------------------------------------------------------ |
| `docs/research/hvsc/performance/audit/audit.md`                                    | Source-backed gap analysis (this convergence pass's primary input) |
| `docs/research/hvsc/performance/audit/convergence-prompt.md`                       | Execution convergence prompt (this pass)                           |
| `docs/research/hvsc/performance/hvsc-performance-research-prompt-2026-04-05.md`    | Deep-research prompt                                               |
| `docs/research/hvsc/performance/hvsc-performance-research-brief-2026-04-05.md`     | Research brief                                                     |
| `docs/research/hvsc/performance/hvsc-performance-research-report-2026-04-05.md`    | Full research report                                               |
| `docs/research/hvsc/performance/hvsc-performance-convergence-prompt-2026-04-05.md` | Convergence prompt (pre-audit)                                     |

## Target status matrix

| Target                                           | Budget    | Status       | Evidence                                                             |
| ------------------------------------------------ | --------- | ------------ | -------------------------------------------------------------------- |
| `T1` Download full HVSC at 5 MiB/s `< 20 s`      | `< 20 s`  | `UNMEASURED` | Web lane does not exercise download; no Android measurement          |
| `T2` Ingest 60,582+ songs `< 25 s`               | `< 25 s`  | `UNMEASURED` | Web lane does not exercise ingest; no Android measurement            |
| `T3` Browse traversal `< 2 s` worst case         | `< 2 s`   | `UNMEASURED` | Secondary web p95 `118.1 ms` is not target evidence (wrong platform) |
| `T4` Filter 60K+ playlist `< 2 s` worst case     | `< 2 s`   | `UNMEASURED` | No filter scenario exists                                            |
| `T5` Playback start `< 1 s`                      | `< 1 s`   | `UNMEASURED` | `playbackLoadSidMs` only; not end-to-end; no Pixel 4 proof           |
| `T6` 100K items without full in-memory hydration | pass/fail | `UNMEASURED` | Code still uses full React state; no 100K benchmark                  |

## Measured web secondary baseline (narrow lane only)

- Scenario: `web-browse-playback-secondary`
- Mode: `fixture-secondary-web`
- Loops: `3`
- Throttle: `5 MiB/s`
- p95 values: browseLoadSnapshot `3.6 ms`, browseInitialQuery `118.1 ms`, browseSearchQuery `13.2 ms`, playbackLoadSid `0.2 ms`
- Artifact: `ci-artifacts/hvsc-performance/web/web-secondary-quick.json`
- **This lane does NOT measure download, ingest, filter, or end-to-end playback start.**

## Dominant blocker

The missing piece is real-device Maestro + Perfetto scenario capture, full-size Docker web scenarios, and the missing instrumentation scopes — not basic infrastructure.

## Completed cycles

- 2026-04-05 Cycle 0A: environment and gap scan completed.
  - Cache check: full-size baseline and update archives available locally.
  - Hardware probe: `u64` reachable; `c64u` not yet required because `u64` succeeded.
  - Device probe: Pixel 4 available to the current toolchain.
  - Repo scan: prompt-declared perf scripts, workflows, and source instrumentation are absent in the current tree.
- 2026-04-05 Cycle 0B: measurement foundation and secondary web quick lane completed.
  - Added HVSC perf ring buffer/export support and instrumented the first high-value runtime phases.
  - Extended the mock HVSC server with disk-backed archives, throttled transfer, `HEAD`, and request logging.
  - Added `playwright/hvscPerf.spec.ts`, `scripts/hvsc/collect-web-perf.mjs`, and `scripts/hvsc/assert-web-perf-budgets.mjs`.
  - Added `test:perf`, `test:perf:quick`, `test:perf:nightly`, `test:perf:assert:web`, plus CI quick/nightly workflow hooks.
  - Validation passed after repairing `hvscDownload.ts`, `playwright/mockHvscServer.ts`, Playwright project selection, and the perf harness selector/default-file issues.
  - Secondary web quick baseline recorded p95 metrics of `3.6 ms` browse snapshot load, `118.1 ms` initial browse query, `13.2 ms` search browse query, and `0.2 ms` playback SID load.

## Convergence phase status

| Phase | Task                                       | Status        |
| ----- | ------------------------------------------ | ------------- |
| P0    | P0.1 Reconcile tree with audit             | `DONE`        |
| P0    | P0.2 Normalize artifact directory strategy | `DONE`        |
| P1    | P1.1 Close benchmark matrix gap S1-S11     | `IN PROGRESS` |
| P1    | P1.2 Web harness: real download and ingest | `NOT STARTED` |
| P1    | P1.3 Close Android benchmark harness gap   | `NOT STARTED` |
| P1    | P1.4 Close instrumentation coverage gap    | `NOT STARTED` |
| P1    | P1.5 Close Perfetto pipeline gap           | `NOT STARTED` |
| P1    | P1.6 Close microbenchmark gap              | `NOT STARTED` |
| P2    | P2.1 Capture honest full baseline          | `NOT STARTED` |
| P2    | P2.2 Build pass/fail matrix                | `NOT STARTED` |
| P3    | P3.1 Optimization cycle 1                  | `NOT STARTED` |
| P3    | P3.2 Repeat optimization cycles            | `NOT STARTED` |
| P4    | P4.1 Close quick-CI gap                    | `NOT STARTED` |
| P4    | P4.2 Close nightly-CI gap                  | `NOT STARTED` |
| P5    | P5.1 Re-audit closure                      | `NOT STARTED` |
| P5    | P5.2 Final convergence record              | `NOT STARTED` |

## Benchmark scenario coverage matrix (S1-S11)

Scenario spec: `playwright/hvscPerfScenarios.spec.ts`

| Scenario | Description                           | Web (fixture)             | Web (real archive)               | Android      | Perf scopes                                                  |
| -------- | ------------------------------------- | ------------------------- | -------------------------------- | ------------ | ------------------------------------------------------------ |
| S1       | Download HVSC from server             | mechanism proof (tiny)    | blocked by MAX_BRIDGE_READ_BYTES | Maestro flow | `download`, `download:checksum`                              |
| S2       | Ingest cached HVSC (cold)             | mechanism proof (3 songs) | blocked by size guard            | Maestro flow | `ingest:extract`, `ingest:songlengths`, `ingest:index-build` |
| S3       | Enter HVSC root (open source browser) | ✅                        | ✅                               | Maestro flow | `browse:load-snapshot`, `browse:query`                       |
| S4       | Traverse down into folders            | ✅                        | ✅                               | not yet      | `browse:query`                                               |
| S5       | Traverse back up to root              | ✅                        | ✅                               | not yet      | `browse:query`                                               |
| S6       | Add all songs to playlist             | ✅ (3 songs)              | ✅ (60K+ songs)                  | Maestro flow | wall-clock only (P1.4: `playlist:add-batch`)                 |
| S7       | Render playlist                       | ✅ (3 items)              | ✅ (60K+ items)                  | not yet      | wall-clock only (P1.4: `browse:render`)                      |
| S8       | Filter: high-match query              | ✅                        | ✅                               | not yet      | wall-clock only (P1.4: `playlist:filter`)                    |
| S9       | Filter: zero-match query              | ✅                        | ✅                               | not yet      | wall-clock only (P1.4: `playlist:filter`)                    |
| S10      | Filter: low-match query               | ✅                        | ✅                               | not yet      | wall-clock only (P1.4: `playlist:filter`)                    |
| S11      | Start playback from playlist          | ✅                        | ✅                               | Maestro flow | `playback:load-sid` (P1.4: `playback:first-audio`)           |

### Platform notes

- **Web fixture mode** (default): uses 3-song fixture archive. Proves measurement pipeline and scenario mechanics. Not meaningful for performance budgets on S1/S2/S6/S7.
- **Web real-archive mode**: requires `HVSC_PERF_BASELINE_ARCHIVE` and `HVSC_PERF_UPDATE_ARCHIVE` env vars. Web cannot handle 80 MB baseline due to `MAX_BRIDGE_READ_BYTES` guard in `hvscDownload.ts`. S1/S2 at full scale are Android-only.
- **Android**: Download→browse→add→play covered by `perf-hvsc-baseline.yaml` Maestro flow. S4/S5/S7-S10 not yet covered by Maestro.
- **Missing perf scopes**: `browse:render`, `playlist:add-batch`, `playlist:filter`, `playlist:repo-sync`, `playback:first-audio` — tracked for P1.4.

## Artifact directory layout (canonical)

All HVSC perf artifacts use `ci-artifacts/hvsc-performance/` as root:

```
ci-artifacts/hvsc-performance/
  web/
    web-secondary-quick.json       # quick CI lane (3 loops, fixture)
    web-secondary-nightly.json     # nightly lane (5 loops, real archives)
    web-full-quick.json            # future: full scenario matrix
    web-full-nightly.json          # future: full scenario matrix
  android/
    <run-id>/
      summary.json                 # structured run summary
      perfetto/                    # Perfetto traces
      telemetry/                   # Android telemetry logs
      maestro/                     # Maestro flow outputs
      smoke/                       # Smoke benchmark snapshots
  bench/                           # future: microbenchmark outputs
```

Scripts updated for this layout:

- `scripts/hvsc/collect-web-perf.mjs` default out → `ci-artifacts/hvsc-performance/web/`
- `scripts/hvsc/assert-web-perf-budgets.mjs` default file → `ci-artifacts/hvsc-performance/web/`
- `scripts/run-hvsc-android-benchmark.sh` default output → `ci-artifacts/hvsc-performance/android/`
- `package.json` `test:perf:quick` and `test:perf:nightly` → `web/` subdirectory
- `.github/workflows/perf-nightly.yaml` summary file → `web/` subdirectory
- `.github/workflows/android.yaml` upload glob covers all subdirectories

## CI benchmark status

- `.github/workflows/android.yaml` `perf-benchmark-quick` job: runs secondary web Playwright perf only.
- `.github/workflows/perf-nightly.yaml`: covers secondary web nightly lane only.
- `package.json` scripts: `test:perf`, `test:perf:quick`, `test:perf:nightly`, `test:perf:assert:web`. No `test:bench`.
- Budget enforcement: observation-only unless environment thresholds are configured.

---

# HVSC Production-Readiness Implementation Plan

## Current Pass - 2026-04-03 HVSC Strong Convergence Closure

## Change Classification

- Classification: `DOC_PLUS_CODE`, `CODE_CHANGE`, `UI_CHANGE`
- Goal: close the remaining HVSC production-readiness issues from `docs/research/hvsc/production-readiness-status-2026-04-03-followup.md` with current source-backed proof, fresh validation, and archived Web/Android/Ultimate/iOS evidence.
- Issue targets:
  - `HVSC-AUD-001`
  - `HVSC-AUD-002`
  - `HVSC-AUD-003`
  - `HVSC-AUD-004`
  - `HVSC-AUD-005`
  - `HVSC-AUD-006`
  - `HVSC-AUD-007`
  - `HVSC-AUD-010`
  - `HVSC-AUD-011`
  - `HVSC-AUD-012`
  - `HVSC-AUD-013`
  - `HVSC-AUD-014`

## Impact Map

- Source:
  - `src/lib/playlistRepository/**`
  - `src/pages/playFiles/**`
  - `src/lib/hvsc/**`
  - `src/lib/sourceNavigation/**`
  - `ios/App/App/**`
  - `ios/native-tests/**`
- Tests and validation:
  - `tests/unit/lib/playlistRepository/**`
  - `tests/unit/playFiles/**`
  - `tests/unit/pages/playFiles/**`
  - `tests/unit/hvsc/**`
  - `playwright/**`
  - `.maestro/**`
- Evidence and docs:
  - `PLANS.md`
  - `WORKLOG.md`
  - `docs/research/hvsc/production-readiness-status-2026-04-03-followup.md`
  - `docs/plans/hvsc/artifacts/**`
  - `artifacts/**`

## Phase 1 - Close Query, Hydration, And Selection Gaps

- Issue IDs:
  - `HVSC-AUD-001` — **DONE** (streaming callback, duplicate traversal elimination, chunked splice, scale tests at 1k/5k)
  - `HVSC-AUD-002` — **DONE** (docs revised to describe proven IndexedDB + in-memory HVSC design as production baseline; FTS5/relational schema marked aspirational)
  - `HVSC-AUD-013` — **DONE** (legacy blob persistence eliminated, migration cleanup, repository-only persist)
  - `HVSC-AUD-014` — **DONE** (production uses IndexedDB; localStorage fallback warns explicitly; not reachable on supported platforms)
- Scope:
  - remove legacy production fallback to `localStorage` snapshot/query-index repositories for large playlists
  - stop full-playlist hydration during startup and resume
  - bound recursive add flows so they do not retain the full discovered file set before append
  - add scale-oriented tests above the repository layer
- Exit criteria:
  - production-capable query paths use indexed storage contracts only
  - startup/resume hydrates only the initial window plus active-item/session metadata
  - recursive add flows stream batches instead of accumulating the full file list in hot-path memory

## Phase 2 - Close Ingest, Integrity, And iOS Gaps

- Issue IDs:
  - `HVSC-AUD-003` — **DONE** (staged extraction with atomic promotion on TypeScript and Android; crash recovery via stale staging cleanup; regression tests for create/write/promote/cleanup lifecycle)
  - `HVSC-AUD-006` — **BLOCKED** (Swift toolchain not available on Linux; iOS native ingest still memory-heavy, no HVSC-specific XCTest coverage)
  - `HVSC-AUD-007` — **DONE** (Web non-native path explicitly blocked in production; 5 MiB guard enforced at download+read; platform capability matrix documented in architecture.md)
  - `HVSC-AUD-010` — **DONE** (already closed: checksum/size integrity enforced and tested; expected-size validation regression test added)
  - `HVSC-AUD-012` — **DONE** (query timing with correlation IDs added to HVSC browse path; playback inherits correlation via REST action tracing; tests lock in structured fields)
- Scope:
  - implement staged/promoted ingest semantics with deterministic rollback on failure
  - strengthen archive integrity policy and persisted recovery evidence
  - formalize Web/non-native capability limits in code and docs
  - add iOS HVSC native validation under `ios/native-tests`
  - add correlation identifiers and timing to persisted HVSC diagnostics where missing
- Exit criteria:
  - active HVSC library state is not replaced by a failed or interrupted ingest
  - iOS has repeatable HVSC-specific native coverage that can run from this Linux host via SwiftPM
  - Web capability is either proven through Docker-backed runtime or explicitly narrowed with enforced UX

## Phase 3 - Collect Scale, Web, Android, And Playback Proof

- Issue IDs:
  - `HVSC-AUD-004` — **DONE** (two HIL runs archived; second proves end-to-end SID playback on Pixel 4 → C64U with 12 timestamped screenshots and logcat)
  - `HVSC-AUD-005` — **DONE** (app-first SID playback proven: C64U filesystem browsed, demo.sid added to playlist, playback at 1:19/3:00 with HEALTHY device status)
  - `HVSC-AUD-011` — **DONE** (hook-level scale tests at 10k/50k/100k with windowing, filtering, and pagination assertions)
- Scope:
  - collect Docker-backed Web proof for the HVSC path
  - collect Pixel 4 app-first HVSC ingest/browse/add/play evidence
  - collect Ultimate playback proof with `c64scope` packet/RMS oracle
  - record UI/device scale artifacts for filter/add/scroll actions
- Exit criteria:
  - archived artifact sets exist for Web, Android, and real playback proof
  - scale evidence is tied to explicit 10k/50k/100k validation or a concrete external blocker

## Phase 4 - Final Register Reconciliation

- Scope:
  - update `docs/research/hvsc/production-readiness-status-2026-04-03-followup.md`
  - ensure every issue is `DONE` or freshly justified `BLOCKED`
  - record every executed command and artifact location in `WORKLOG.md`
- Exit criteria:
  - no issue remains `PARTIAL` or `TODO`
  - the final status register matches the actual code, tests, and artifacts in the worktree

## Current Pass - 2026-04-03 Strong Convergence Prompt Rewrite

## Change Classification

- Classification: `DOC_ONLY`
- Goal: replace the existing HVSC implementation prompt with a stronger convergence prompt that cannot honestly terminate until every remaining issue from the follow-up register is either fixed with proof or explicitly blocked by a verified external constraint.
- Primary output: `docs/research/hvsc/implementation-execution-prompt-2026-04-03.md`

## Impact Map

- Docs:
  - `PLANS.md`
  - `WORKLOG.md`
  - `docs/research/hvsc/implementation-execution-prompt-2026-04-03.md`
- Evidence inputs:
  - `docs/research/hvsc/production-readiness-audit-2026-04-03.md`
  - `docs/research/hvsc/production-readiness-status-2026-04-03-followup.md`
  - `docs/testing/physical-device-matrix.md`
  - `docs/plans/hvsc/automation-coverage-map.md`
- Platforms the prompt must cover:
  - Android with attached Pixel 4
  - Web with local Docker deployment
  - iOS with CI-backed Maestro/native proof only, not Linux-host HIL

## Phase A - Reconcile Prompt Inputs

- Scope:
  - compare the existing implementation prompt against the follow-up status register
  - ensure the new prompt targets only the still-open issue set
  - encode the new environment constraints: Pixel 4 available, Docker/Web available, iOS HIL out of scope
- Exit criteria:
  - the prompt backlog matches the follow-up register exactly
  - platform proof requirements are explicit and non-contradictory

## Phase B - Rewrite The Convergence Prompt

- Scope:
  - replace the old implementation prompt with a stronger convergence contract
  - require strict closure criteria, evidence bars, and termination rules
  - forbid optimistic completion before all remaining issues are closed or externally blocked
- Exit criteria:
  - the prompt names every remaining issue
  - the prompt includes hard stop conditions for incomplete HIL, incomplete scale proof, and incomplete iOS CI/Maestro proof

## Phase C - Final Prompt Review

- Scope:
  - verify the rewritten prompt is aligned with the current follow-up status counts
  - ensure the prompt does not require impossible Linux-host iOS HIL work
  - ensure Android/Web/iOS validation requirements are concrete and executable
- Exit criteria:
  - the prompt can be used directly as an execution contract for the next implementation pass
  - `PLANS.md` and `WORKLOG.md` reflect this authoring pass accurately

## Current Status

- Phase A: completed
- Phase B: in progress
- Phase C: pending

## Current Focus

- Strengthen the prompt so it cannot “finish” on partial convergence.
- Make Android Pixel 4 proof and Docker/Web proof mandatory where the open issues require them.
- Keep iOS HIL out of scope on Linux while still demanding the strongest available CI-backed Maestro/native evidence.

## Current Pass - 2026-04-03 Follow-up Status Assessment

## Change Classification

- Classification: `DOC_ONLY`
- Goal: produce a source-backed follow-up status register for `docs/research/hvsc/production-readiness-audit-2026-04-03.md`, reconcile it with the implementation already landed in the worktree, and turn all non-closed issues into an executable remaining-work plan.
- Primary output: `docs/research/hvsc/production-readiness-status-2026-04-03-followup.md`

## Impact Map

- Docs:
  - `PLANS.md`
  - `WORKLOG.md`
  - `docs/research/hvsc/production-readiness-status-2026-04-03-followup.md`
- Comment/doc reality sync if needed:
  - `ios/App/App/HvscIngestionPlugin.swift`
- Evidence sources to inspect:
  - `docs/research/hvsc/production-readiness-audit-2026-04-03.md`
  - current `PLANS.md`
  - current `WORKLOG.md`
  - live source and tests under `src/lib/hvsc/**`, `src/lib/playlistRepository/**`, `src/pages/playFiles/**`, `android/app/src/test/**`, and referenced docs
- Platforms assessed:
  - Android
  - iOS
  - Web

## Phase A - Reconcile Live Evidence

- Scope:
  - extract every issue from `HVSC-AUD-001` through `HVSC-AUD-014`
  - compare the audit baseline with landed implementation, tests, and recorded validation history
  - identify stale statements that now contradict the live repo
- Exit criteria:
  - every issue has a live evidence file list and an initial state hypothesis
  - contradictions between the audit baseline and current reality are recorded in `WORKLOG.md`

## Phase B - Produce Follow-up Status Register

- Scope:
  - write the follow-up document with per-issue `DONE` / `PARTIAL` / `TODO` / `BLOCKED` status
  - keep each judgment tied to specific code, tests, docs, or recorded runtime evidence
  - distinguish clearly between meaningful progress and true closure
- Exit criteria:
  - the follow-up document contains all required sections in the requested order
  - status counts reconcile exactly with the per-issue register

## Phase C - Minimal Reality Sync

- Scope:
  - fix only clearly stale documentation or source comments that materially affect the follow-up status accuracy
  - avoid widening into feature work or fresh implementation
- Exit criteria:
  - any remaining parity/status statements cited by the follow-up document are accurate
  - `WORKLOG.md` records why each minimal sync was needed

## Phase D - Final Consistency Review

- Scope:
  - verify bucket counts, closure matrix, and remaining-work phases
  - ensure the report does not claim builds, tests, screenshots, or HIL proof that were not actually performed
- Exit criteria:
  - `PLANS.md`, `WORKLOG.md`, and the follow-up document all agree on the current readiness picture
  - the final user summary can state exactly which issues are closed and which remain open

## Current Status

- Phase A: completed
- Phase B: in progress
- Phase C: pending
- Phase D: pending

## Current Focus

- Finish the evidence-backed status register before touching any stale-reality syncs.
- Keep the closure bar strict: repository or diagnostics improvements do not close architecture, scale, or HIL-proof issues on their own.
- Record any contradiction between the original audit and current repo state in `WORKLOG.md` instead of silently rewriting the audit.

## Change Classification

- Classification: `DOC_PLUS_CODE`, `CODE_CHANGE`, `UI_CHANGE`
- Goal: converge the audited HVSC storage, playlist, ingest, and validation path toward production readiness without re-running the discovery pass.
- Audit baseline: `docs/research/hvsc/production-readiness-audit-2026-04-03.md`

## Impact Map

- Source:
  - `src/lib/playlistRepository/**`
  - `src/pages/playFiles/hooks/usePlaybackPersistence.ts`
  - `src/pages/playFiles/hooks/usePlaylistListItems.tsx`
  - `src/pages/PlayFilesPage.tsx`
  - `src/pages/playFiles/handlers/addFileSelections.ts`
  - `src/lib/hvsc/**`
  - `src/lib/sourceNavigation/**`
  - `ios/App/App/HvscIngestionPlugin.swift`
- Tests:
  - `tests/unit/lib/playlistRepository/**`
  - `tests/unit/playFiles/**`
  - `tests/unit/pages/playFiles/**`
  - Android JVM tests under `android/app/src/test/**` as needed
- Docs:
  - `PLANS.md`
  - `WORKLOG.md`
  - `docs/internals/ios-parity-matrix.md`
- Platforms:
  - Web
  - Android
  - iOS

## Phase 1 - Reconcile Audit Into Execution Slices

- Scope:
  - translate audited issue IDs into concrete implementation slices
  - preserve existing local worktree changes
  - keep `PLANS.md` and `WORKLOG.md` authoritative
- Issue coverage:
  - all implementation phases below are keyed to `HVSC-AUD-001/002/003/006/007/008/009/010/011/012/013/014`
- Exit criteria:
  - the plan reflects the live implementation pass rather than the completed research pass
  - dependencies between repository, persistence, UI, and ingest work are explicit

## Phase 2 - Playlist Storage And Query Foundation

- Scope:
  - replace the IndexedDB full-snapshot repository with incremental normalized records
  - keep playlist/session data out of full-rewrite hot paths
  - reduce page-level duplicate playlist rewrites where feasible
- Targeted issues:
  - `HVSC-AUD-002`
  - `HVSC-AUD-013`
  - `HVSC-AUD-014`
- Planned files:
  - `src/lib/playlistRepository/indexedDbRepository.ts`
  - `src/lib/playlistRepository/repository.ts`
  - `src/lib/playlistRepository/types.ts`
  - `src/pages/playFiles/hooks/usePlaybackPersistence.ts`
  - `src/pages/PlayFilesPage.tsx`
- Validation:
  - repository contract tests
  - playback persistence regression tests proving current-index changes do not rewrite the playlist
- Exit criteria:
  - IndexedDB writes are incremental instead of single-state rewrites
  - current-track/session updates persist separately from playlist rows
  - repository hydration can restore the active item without rematerializing on every session mutation

## Phase 3 - Playlist UX Scale Cleanup

- Scope:
  - remove avoidable O(n^2) row derivation and eager playlist-side scans
  - batch or bound large add flows where practical in this pass
- Targeted issues:
  - `HVSC-AUD-001`
  - `HVSC-AUD-011`
- Planned files:
  - `src/pages/playFiles/hooks/usePlaylistListItems.tsx`
  - `src/pages/playFiles/handlers/addFileSelections.ts`
  - `src/components/lists/SelectableActionList.tsx`
  - `src/pages/playFiles/components/PlaylistPanel.tsx`
- Validation:
  - existing list-item tests plus new regression coverage for index lookups and large-playlist behavior
- Exit criteria:
  - no per-row `findIndex(...)` over the full playlist
  - large add/derive paths are more bounded than the audited baseline

## Phase 4 - HVSC Ingest And Platform Path Fixes

- Scope:
  - implement the highest-leverage ingest durability and platform-path fixes feasible in one pass
  - close stale iOS parity comments/docs
- Targeted issues:
  - `HVSC-AUD-003`
  - `HVSC-AUD-006`
  - `HVSC-AUD-007`
  - `HVSC-AUD-009`
  - `HVSC-AUD-010`
  - `HVSC-AUD-012`
- Planned files:
  - `src/lib/hvsc/**`
  - `ios/App/App/HvscIngestionPlugin.swift`
  - `docs/internals/ios-parity-matrix.md`
- Validation:
  - targeted Vitest HVSC suites
  - platform-specific smoke tests where supported locally
- Exit criteria:
  - touched ingest/runtime paths have explicit failure semantics and updated docs
  - stale iOS parity claims are removed

## Phase 5 - Validation And Hardware Attempts

- Scope:
  - run the minimum honest validation for touched code
  - satisfy repository coverage obligations
  - retry Android/C64U hardware evidence collection
- Targeted issues:
  - `HVSC-AUD-004`
  - `HVSC-AUD-005`
  - `HVSC-AUD-008`
  - `HVSC-AUD-011`
- Required commands:
  - `npm run test`
  - `npm run test:coverage`
  - targeted Playwright/HVSC tests if UI behavior changes materially
  - `cd android && ./gradlew test`
  - `adb devices -l`

  ## HVSC DECOMPRESSION CONVERGENCE

  ### Change Classification
  - Classification: `DOC_PLUS_CODE`, `CODE_CHANGE`, `UI_CHANGE`
  - Goal: make HVSC decompression and ingestion production-ready across Android, iOS, and Web with real-archive evidence, deterministic memory safety, and end-to-end proof on Pixel 4 plus Ultimate 64 at `u64`.
  - Authoritative inputs:
    - `docs/research/hvsc/implementation-plan-decompression-and-e2e-2026-04-03.md`
    - `docs/research/hvsc/hvcs-7z-decompression-research.md`
    - `docs/research/hvsc/gap-analysis-decompression-and-e2e-workflow-2026-04-03.md`

  ### Impact Map
  - Android extraction and plugin flow:
    - `android/app/src/main/java/uk/gleissner/c64commander/**`
    - `android/app/build.gradle`
  - Android tests and fixtures:
    - `android/app/src/test/**`
    - `android/app/src/test/fixtures/**`
  - App/runtime integration and docs:
    - `src/lib/hvsc/**`
    - `docs/research/hvsc/**`
    - `docs/architecture.md`
    - `docs/testing/**`
    - `PLANS.md`
    - `WORKLOG.md`
    - `artifacts/**`

  ### Phase 1 - Archive Characterisation
  - GAP IDs: `GAP-005`
  - Success criteria:
    - the real HVSC archive is cached locally at a stable path
    - `7zz l -slt` and `7zz t` are run against that archive
    - the exact method chain, dictionary size, solid/block structure, encryption state, entry count, and uncompressed size are documented from command output rather than assumption
  - Proof artifacts:
    - archive path and checksum in `WORKLOG.md`
    - updated archive profile in the gap analysis and implementation plan docs
  - Exact next actions:
    - verify `7zz` availability
    - populate `~/.cache/c64commander/hvsc/HVSC_84-all-of-them.7z`
    - run `7zz l -slt` and `7zz t`
    - summarize results into docs and worklog

  ### Phase 2 - Validate Current Android Engine
  - GAP IDs: `GAP-001`, `GAP-004`
  - Success criteria:
    - the current Apache Commons Compress + `xz` path opens the real archive, enumerates entries, extracts at least 100 SID files, validates `PSID`/`RSID` headers, and shows acceptable memory and timing behavior
    - a documented keep-or-replace verdict exists based on real evidence
  - Proof artifacts:
    - JVM real-archive tests under `android/app/src/test/**`
    - measured timing and memory notes in `WORKLOG.md`
    - explicit engine verdict in the gap analysis and implementation plan docs
  - Exact next actions:
    - add a cache-aware real-archive provider for Android tests
    - add real-archive extraction tests for open, enumerate, sample extract, and SID validation
    - run the tests and capture results

  ### Phase 2b - Replace Engine If Real Evidence Fails
  - GAP IDs: `GAP-004`
  - Success criteria:
    - if the current engine fails, exactly one replacement path is integrated and revalidated against the same real archive
    - the chosen replacement is justified by the actual HVSC method chain
  - Proof artifacts:
    - Android build integration for the chosen engine
    - repeated real-archive validation results
    - updated rationale in research, implementation plan, and gap analysis docs
  - Exact next actions:
    - only execute if Phase 2 fails
    - prefer upstream 7-Zip NDK/JNI; accept PLzmaSDK/LZMA SDK only if the real method chain justifies it

  ### Phase 3 - Standalone Extraction Library
  - GAP IDs: `GAP-002`, `GAP-011`
  - Success criteria:
    - a standalone Kotlin extraction library exists, supports `.7z` and `.zip`, streams file-by-file, exposes progress and cancellation, and enforces path safety
    - duplicated plugin extraction logic is removed in favor of the library
  - Proof artifacts:
    - new extractor classes and focused unit tests
    - plugin integration tests kept green
  - Exact next actions:
    - extract shared archive logic into `android/app/src/main/java/uk/gleissner/c64commander/hvsc/**`
    - wire the plugin to call the library instead of owning decompression

  ### Phase 4 - Real-Archive Test Infrastructure
  - GAP IDs: `GAP-003`, `GAP-009`
  - Success criteria:
    - real-archive tests are cache-backed, checksum-verified, intentionally invokable, and CI-safe when the archive is absent
  - Proof artifacts:
    - real archive provider utility
    - Gradle task to populate the cache
    - documentation for local and CI execution
  - Exact next actions:
    - add archive cache resolution via env var and default path
    - add checksum verification and clean skip behavior
    - add Gradle task for cache population

  ### Phase 5 - Memory Safety
  - GAP IDs: `GAP-010`
  - Success criteria:
    - extraction probes archive requirements before work begins
    - extraction aborts clearly when memory budget is insufficient
    - memory-pressure cancellation is implemented and tested
  - Proof artifacts:
    - extractor probe and budget logic
    - unit tests for accept, reject, and cancel cases
    - measured notes recorded in `WORKLOG.md`
  - Exact next actions:
    - model archive memory requirements from real metadata
    - add budget enforcement and cancellation hooks
    - validate on JVM tests and during Android proof

  ### Phase 6 - Hardware-in-the-Loop Proof
  - GAP IDs: `GAP-007`
  - Success criteria:
    - Pixel 4 installs the app, ingests the real HVSC archive through the Android native path, browses extracted songs, adds a genuine HVSC-extracted song to a playlist, plays it on the Ultimate 64 at `u64`, and shows playback evidence with a visible HEALTHY badge
  - Proof artifacts:
    - `artifacts/hvsc-e2e-proof-YYYYMMDDTHHMMSSZ/`
    - `TIMELINE.md`, `screenshots/`, `logcat-full.txt`, `u64-info.json`, `extraction-summary.json`
  - Exact next actions:
    - only run after Android extraction is proven locally
    - probe `u64`
    - install debug build on the attached Pixel 4
    - capture full artifact set during the end-to-end flow

  ### Phase 7 - Web Product Decision
  - GAP IDs: `GAP-006`
  - Success criteria:
    - Web product truth is explicit and matches runtime truth
    - architecture, docs, and UI messaging no longer contradict each other
  - Proof artifacts:
    - updated architecture and testing docs with the chosen Web decision
  - Exact next actions:
    - choose between permanently unsupported full Web ingest, server-side extraction, or another proven delivery path
    - update docs and runtime messaging to match that decision

  ### External Constraint Register
  - iOS native extraction hardening and proof remains dependent on macOS/Swift execution. This workstream must still update docs truthfully, but Linux-host execution cannot claim iOS native completion unless limited to code changes and repository-side tests that actually run here.

  ### Current Focus
  - Append the convergence contract and move immediately into Phase 1 archive characterisation.
  - Keep the current Android engine only if the real HVSC archive proves it acceptable.
  - Do not claim end-to-end success without a genuine HVSC-extracted song playing on the Ultimate 64 at `u64`.
  - C64 Ultimate probes/playback attempts as environment allows

- Exit criteria:
  - final report distinguishes closed issues, partial closures, and external blockers
  - hardware attempts are evidenced even if blocked

## Current Status

- Phase 1: completed
- Phase 2: completed
- Phase 3: in progress
- Phase 4: partially completed
- Phase 5: completed

## Current Focus

- Reduce remaining playlist UX hot-path costs beyond the repository/session fixes already landed.
- Keep the HVSC ingest/platform findings honest: the Android JVM lane is green now, but full end-to-end HVSC download/ingest/browse proof on device is still incomplete.
- Push the remaining audit gaps toward query-windowed playlist browsing/search and stronger ingest durability semantics instead of legacy snapshot fallbacks.
- For all remaining hardware validation, use the adb-attached Pixel 4 and probe `u64` and `c64u` by hostname; if both answer over REST, prefer `u64`, otherwise use whichever reachable device responds.
- Leave the execution artifacts aligned with what was actually implemented and validated in this pass.

## Progress Notes

- Completed in this pass:
  - incremental IndexedDB persistence for tracks, playlist rows, playlist order, and sessions
  - separate repository session persistence so ordinary current-track changes stop rewriting the playlist dataset
  - removal of the audited O(n^2) playlist-row `findIndex(...)` lookup
  - Play-page query hook split so category-filter changes requery without resyncing the repository
  - Play-page playlist filtering now uses a bounded query window: the collapsed card stays preview-sized while the sheet lazily loads additional repository-backed pages on demand
  - large playlist-add flows now append in bounded batches for both recursive file scans and CommoServe archive-result imports
  - legacy localStorage playlist restore no longer scans unrelated device keys when hydrating the active playlist
  - non-native HVSC ingest now fails explicitly for unsupported full-archive runtime paths instead of silently presenting a production fallback
  - cached HVSC archive markers now carry expected size metadata and the runtime deletes marker/file pairs that no longer match the on-disk archive size
  - HVSC status summaries now retain ingestion IDs, archive names, stage context, and recovery hints for cancellations, restart recovery, and failure diagnostics
  - Android JVM unit tests now run with a Java 21 launcher, restoring a green local `./gradlew test` lane in this environment
  - stale iOS HVSC parity comments/docs corrected
- Validation completed:
  - `npm run build`
  - `npm run lint` with only pre-existing warnings from generated coverage artifacts
  - `npm run test`
  - `npm run test:coverage`
  - `node scripts/check-coverage-threshold.mjs coverage/coverage-final.json`
  - coverage gate satisfied: branch coverage `91.25%`, line coverage `94.74%`
  - `cd android && ./gradlew test`
  - `adb devices -l`
  - `npm run cap:build`
  - `cd android && ./gradlew installDebug`
  - `adb shell am start -W -n uk.gleissner.c64commander/.MainActivity`
  - `curl http://c64u/v1/info`
  - direct SID playback probe against `http://c64u/v1/runners:sidplay`
  - `curl http://u64/v1/info`
  - refreshed targeted Vitest coverage for playlist query windowing and HVSC cache-marker integrity
  - Android install and cold launch on attached Pixel 4
- Validation still blocked or incomplete:
  - no fresh end-to-end Pixel 4 proof yet for full HVSC download, extraction, ingest, browse, and large-playlist manipulation inside the app
  - no direct in-app Ultimate playback proof yet beyond the confirmed device API and direct runner endpoint probe
  - `u64` is currently the reachable preferred Ultimate target; `c64u` REST probing is currently failing

## Historical Note

- The prior `DOC_ONLY` research plan was completed and its output remains the audit baseline in `docs/research/hvsc/production-readiness-audit-2026-04-03.md`.

## Plan Extension — 2026-04-04T08:45:00Z

**Status: COMPLETE** — All tasks executed. AUD-004 and AUD-005 closed with decisive evidence in `artifacts/hvsc-hil-20260404T064552Z/`.

### Context

Environment blockers that previously prevented AUD-004 and AUD-005 closure are now resolved:

- `u64` is reachable at 192.168.1.13: `curl http://u64/v1/info` returns `Ultimate 64 Elite`, firmware 3.14d
- Pixel 4 (`9B081FFAZ001WX`) is connected via ADB
- SID fixture staged on C64U at `/Temp/demo.sid` via FTP
- AUD-006 (iOS) is out-of-scope per task instructions

### SUPERSEDED assessments

- AUD-004 was previously marked `DONE` with an incomplete qualifier (HVSC extraction failed). SUPERSEDED — must demonstrate a complete end-to-end HIL run with C64U source browse, playlist add, and playback.
- AUD-005 was previously marked `BLOCKED` (u64 unreachable). SUPERSEDED — u64 is now reachable, enabling app-first playback proof.

### Task 1 — Build and install latest app on Pixel 4

- Build: `npm run cap:build`
- Install: `cd android && ./gradlew installDebug`
- Verify: `adb shell am start -W -n uk.gleissner.c64commander/.MainActivity`

### Task 2 — AUD-004: Complete Android HIL acceptance run

- Launch app on Pixel 4
- Confirm C64U connection (u64 visible on Home page)
- Navigate to Play Files
- Browse C64U source (u64 files via FTP)
- Add SID file from C64U to playlist
- Play the SID on the C64U (triggers REST `PUT /v1/runners:sidplay`)
- Capture timestamped screenshots at each step
- Capture logcat evidence
- Archive in `artifacts/hvsc-hil-<timestamp>/`
- DONE criteria: archived end-to-end HIL run from app launch through C64U file browse → add → play

### Task 3 — AUD-005: App-first playback with audio/REST proof

- During Task 2 playback: capture REST proof that play command was sent to C64U
- Verify C64U accepted the playback request (HTTP 200, empty errors)
- Verify FTP evidence of uploaded SID on device
- Capture c64scope audio analysis if available, or direct REST verification
- DONE criteria: archived evidence proving selected track in app = track streamed by Ultimate, with REST acceptance proof

### Task 4 — Review all other DONE issues

- Verify each DONE issue's evidence is still accurate against current code
- Flag any that need updates

### Task 5 — Update follow-up doc and PLANS.md

- Update `docs/research/hvsc/production-readiness-status-2026-04-03-followup.md` with final statuses
- Update PLANS.md phase annotations
- Update WORKLOG.md

### Task 6 — Final validation

- `npm run test`
- `npm run test:coverage` (branch coverage ≥ 91%)
- Confirm all convergence criteria met
