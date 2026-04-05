# HVSC Performance Audit

Date: 2026-04-05
Classification: `DOC_ONLY`
Status: Source-backed gap analysis

## Scope

This audit reviews:

- `docs/research/hvsc/performance/hvsc-performance-research-prompt-2026-04-05.md`
- `docs/research/hvsc/performance/hvsc-performance-research-brief-2026-04-05.md`
- `docs/research/hvsc/performance/hvsc-performance-research-report-2026-04-05.md`
- `docs/research/hvsc/performance/hvsc-performance-convergence-prompt-2026-04-05.md`
- top-level `PLANS.md`
- top-level `WORKLOG.md`
- the current repository implementation, tests, scripts, Maestro flows, and workflows relevant to HVSC performance

Audit rule used for status attribution:

- If work is described in the performance docs, `PLANS.md`, or `WORKLOG.md`, it counts as planned or recorded.
- If work is also visible in the current codebase, it counts as implemented.
- If work has measured artifacts or explicit recorded results, it counts as evidenced.
- If work is absent from the performance docs, absent from `PLANS.md` and `WORKLOG.md`, and not visible in code, it is treated as not done.

Important note:

- The worktree was dirty during this audit. `.maestro/perf-hvsc-baseline.yaml` and `tests/unit/ci/androidMaestroWorkflowContracts.test.ts` had local modifications. This audit credits them only as present in the current tree, not as historically validated or fully documented work.

## Executive Summary

The HVSC performance effort is materially started, but it is not close to production closure.

What is clearly done:

- The research package is complete. The prompt, brief, full report, and convergence prompt all exist.
- A first measurement foundation has landed in code:
  - app-level HVSC perf timing ring buffer
  - first timing scopes for download, checksum, ingest subphases, browse snapshot load/query, and playback SID load
  - export hooks through trace bridge, diagnostics export, and smoke benchmark snapshots
  - a throttled disk-backed mock HVSC server with `HEAD` support and request logging
  - one secondary web Playwright perf scenario
  - basic CI entry points for that secondary web lane
- One measured baseline exists, and it is explicitly limited:
  - secondary web quick lane only
  - browse snapshot/query and playback SID-load only

What is not done:

- No target `T1` through `T6` is closed.
- No real Pixel 4 plus real U64 pass/fail matrix exists.
- No full `S1` through `S11` scenario implementation exists.
- No microbenchmark lane (`test:bench`) exists.
- No Perfetto post-processing pipeline or SQL metric extraction exists.
- No native Android trace sections (`android.os.Trace`) exist.
- No performance optimization cycle has actually landed against the top bottlenecks. The core hot paths described in the research report are still structurally unchanged.

Bottom line:

- Research: done.
- Measurement scaffolding: partial.
- Secondary web measurement: partial, narrow, and real but incomplete.
- Android measurement harness: partial and under-documented.
- CI regression infrastructure: partial.
- Budget closure and production proof: not done.
- Performance optimization against the identified bottlenecks: not done.

## Current Completion State

| Area | Status | Audit conclusion |
|---|---|---|
| Research documents | `DONE` | All four performance documents exist and are internally coherent. |
| Planning/worklog tracking | `PARTIAL` | Core web perf work is recorded, but some Android perf scaffolding exists in code without matching `PLANS.md` or `WORKLOG.md` coverage. |
| App-level perf timing core | `DONE` | `src/lib/hvsc/hvscPerformance.ts` exists and is tested. |
| First-pass HVSC timing instrumentation | `PARTIAL` | Several important scopes exist, but the report-required coverage is incomplete. |
| Mock HVSC provider | `DONE` | Disk-backed archives, throttle, `HEAD`, and request logging exist. |
| Web benchmark automation | `PARTIAL` | Only a single browse/playback secondary-web scenario exists. |
| Android benchmark automation | `PARTIAL` | A Maestro flow, smoke snapshot plumbing, Perfetto config, and a runner script exist, but they are not equivalent to the required scenario matrix or metric pipeline. |
| Perfetto capture pipeline | `PARTIAL` | Capture scaffolding exists, but not the required trace richness, SQL extraction, or decision-grade metrics. |
| CI quick perf lane | `PARTIAL` | Implemented only for the narrow secondary web lane. |
| CI nightly perf lane | `PARTIAL` | Implemented only for the narrow secondary web lane. |
| Microbenchmarks | `NOT DONE` | No `test:bench`, no `test/benchmarks/*.bench.ts`. |
| Artifact layout from the report/prompt | `NOT DONE` | Actual outputs go to `ci-artifacts/hvsc-performance/**`; the report/prompt layout is not implemented. |
| Production budget proof for `T1`-`T6` | `NOT DONE` | No target is proven passing. |
| Optimization of bottlenecks `B1`-`B5` | `NOT DONE` | The bottleneck descriptions still match the live code. |

## Confirmed Landed Work

### 1. Research package exists and is usable

The following documents are present and complete:

- `docs/research/hvsc/performance/hvsc-performance-research-prompt-2026-04-05.md`
- `docs/research/hvsc/performance/hvsc-performance-research-brief-2026-04-05.md`
- `docs/research/hvsc/performance/hvsc-performance-research-report-2026-04-05.md`
- `docs/research/hvsc/performance/hvsc-performance-convergence-prompt-2026-04-05.md`

This part is done. The repo has an execution-grade research package.

### 2. App-level HVSC timing infrastructure is landed

Confirmed in code:

- `src/lib/hvsc/hvscPerformance.ts`
  - ring buffer
  - `beginHvscPerfScope`
  - `endHvscPerfScope`
  - `runWithHvscPerfScope`
  - `performance.mark()` / `performance.measure()` integration
- tests exist in `tests/unit/hvsc/hvscPerformance.test.ts`

Confirmed export surfaces:

- `src/lib/tracing/traceBridge.ts`
- `src/components/diagnostics/GlobalDiagnosticsOverlay.tsx`
- `src/lib/smoke/smokeMode.ts`

This is real implemented infrastructure, not just planning.

### 3. First-pass instrumentation is landed

Confirmed implemented scopes include:

- `download`
- `download:checksum`
- `ingest:extract`
- `ingest:songlengths`
- `ingest:index-build`
- `browse:load-snapshot`
- `browse:query`
- `playback:load-sid`

Confirmed in:

- `src/lib/hvsc/hvscDownload.ts`
- `src/lib/hvsc/hvscIngestionRuntime.ts`
- `src/lib/hvsc/hvscBrowseIndexStore.ts`
- `src/lib/hvsc/hvscService.ts`

This matches the first measurement-foundation pass recorded in `PLANS.md` and `WORKLOG.md`.

### 4. Mock HVSC benchmark server is landed

Confirmed in `playwright/mockHvscServer.ts`:

- archive serving from disk when archive paths are supplied
- fallback synthetic archive creation
- bandwidth throttling
- `HEAD` support
- request logging with bytes sent and duration

This is consistent with the convergence prompt's first infrastructure requirement.

### 5. Secondary web perf harness exists

Confirmed in:

- `playwright/hvscPerf.spec.ts`
- `scripts/hvsc/collect-web-perf.mjs`
- `scripts/hvsc/assert-web-perf-budgets.mjs`
- `package.json`
- `.github/workflows/android.yaml`
- `.github/workflows/perf-nightly.yaml`

Measured evidence is also recorded in:

- `PLANS.md`
- `WORKLOG.md`

Recorded measured p95s:

- browse snapshot load: `3.6 ms`
- initial browse query: `118.1 ms`
- search browse query: `13.2 ms`
- playback SID load: `0.2 ms`

This is the only clearly evidenced benchmark lane in the repo today.

### 6. Additional Android perf scaffolding exists in code

The repo contains more Android-oriented perf scaffolding than `PLANS.md` and `WORKLOG.md` currently acknowledge:

- `.maestro/perf-hvsc-baseline.yaml`
- `scripts/run-hvsc-android-benchmark.sh`
- `ci/telemetry/android/perfetto-hvsc.cfg`
- smoke benchmark snapshots emitted by:
  - `src/pages/playFiles/hooks/useHvscLibrary.ts`
  - `src/lib/hvsc/hvscService.ts`
  - `src/lib/playback/playbackRouter.ts`

This work is real enough to credit as partial implementation, but it is not yet enough to credit as completed benchmark coverage.

## Major Gaps

## Gap 1: The benchmark matrix in the report and convergence prompt is not implemented

The report defines `S1` through `S11`. The convergence prompt requires deterministic scenario scripts for `S1` through `S11` with warm-up, repeated runs, structured results, and multi-platform coverage.

What exists:

- one Playwright scenario in `playwright/hvscPerf.spec.ts`
- one Maestro flow in `.maestro/perf-hvsc-baseline.yaml`

What is missing:

- no full `S1` through `S11` scenario suite
- no scenario-level loop orchestration on Android
- no scenario-by-scenario success/failure signatures
- no distinct per-scenario artifact directories
- no documented emulator lane for perf execution
- no Docker web suite that actually runs the full scenario matrix

Audit conclusion:

- This requirement is only partially started.

## Gap 2: The current web perf harness does not benchmark download or ingest

This is one of the most important findings.

The convergence prompt and report prioritize:

- `T1`: full HVSC download from a 5 MiB/s mock provider
- `T2`: full ingest of 60,582+ songs

But `playwright/hvscPerf.spec.ts` does not perform download or ingest. It calls `installReadyHvscMock`, which injects an already-installed, already-ready HVSC mock into the page. The scenario then opens HVSC browse, filters, selects a song, and starts playback.

Implications:

- `test:perf:quick` does not measure `T1`.
- `test:perf:quick` does not measure `T2`.
- `test:perf:nightly` also does not measure `T1` or `T2`, even when real archive paths are supplied.
- The real archive files can be present on the mock server without ever being exercised by the test.

Audit conclusion:

- The existing web perf lane is valid as a narrow browse/playback timing lane.
- It must not be treated as download or ingest proof.

## Gap 3: Android perf capture exists only as scaffolding, not as a closed measurement system

There is meaningful Android groundwork:

- `.maestro/perf-hvsc-baseline.yaml`
- `scripts/run-hvsc-android-benchmark.sh`
- `ci/telemetry/android/perfetto-hvsc.cfg`
- smoke benchmark snapshots

But the current Android setup is still incomplete in several decisive ways.

What is missing:

- no evidence in `PLANS.md` or `WORKLOG.md` of an actual completed Android perf run using this harness
- no quantified pass/fail output for `T1` through `T6`
- no per-scenario metric extraction from the pulled smoke artifacts
- no p50/p95/p99 Android summary generation
- no jank extraction
- no CPU scheduling analysis
- no trace SQL post-processing
- no automatic compare-before-after step

The runner script currently:

- launches telemetry capture
- launches a Perfetto capture
- runs a tagged Maestro flow
- pulls smoke benchmark JSON files
- writes a summary that only lists artifact files and high-level metadata

It does not:

- calculate target metrics
- compare them to budgets
- produce quantiles
- extract decision-grade numbers from the Perfetto trace

Audit conclusion:

- Android performance automation is present, but it is not production-grade measurement yet.

## Gap 4: Perfetto support is much thinner than the report requires

The report requires Perfetto as the primary Android tracing system, including:

- scheduling
- CPU behavior
- process stats
- memory counters
- FrameTimeline for jank
- app-visible trace sections
- SQL extraction through Trace Processor

What exists:

- `scripts/run-hvsc-android-benchmark.sh` calls `adb shell perfetto`
- `ci/telemetry/android/perfetto-hvsc.cfg` exists

What the current config captures:

- `linux.process_stats`
- `linux.sys_stats`
- `android.log`

What is missing from the current implementation:

- no `sched` or richer ftrace categories
- no explicit FrameTimeline capture
- no trace-processor SQL scripts
- no extracted metrics from traces
- no stored SQL outputs
- no automated jank analysis
- no correlation pipeline between app timings and Perfetto slices

What is also missing in code:

- no `android.os.Trace`
- no `Trace.beginSection` / `Trace.endSection`

Audit conclusion:

- Perfetto capture has been started, but the report's required Perfetto workflow is not implemented.

## Gap 5: Instrumentation coverage is still incomplete

The report's naming plan includes additional phases such as:

- `browse:render`
- `playlist:add-batch`
- `playlist:filter`
- `playlist:repo-sync`
- `playback:first-audio`

Those are not present in the current codebase.

What this means:

- add-all-to-playlist cannot yet be properly broken down
- large-playlist filter timing is not instrumented at the app layer as required
- repository-sync cost is not directly measured
- playback-start is not separated from "SID bytes loaded"
- first-audio latency is still not measured

Audit conclusion:

- The instrumentation foundation is useful, but it does not yet cover the most important unsolved target areas.

## Gap 6: The CI perf implementation is materially narrower than the convergence prompt requires

The convergence prompt defines:

- Tier A per-build microbenchmarks plus Playwright budgets
- Tier B nightly deep benchmark

What exists:

- `perf-benchmark-quick` job in `.github/workflows/android.yaml`
- `perf-nightly.yaml`
- `test:perf`, `test:perf:quick`, `test:perf:nightly`, `test:perf:assert:web`

What is missing:

- no `test:bench`
- no `test/benchmarks/*.bench.ts`
- no hard-failing microbenchmark lane
- no broad Playwright perf suite
- no per-scenario CI artifact tree
- no `ci-artifacts/perf/**`
- no nightly scenario sweep over `S1` through `S11`
- no CI coverage for Android Maestro perf scenarios

Additional weakness:

- current web perf budget enforcement is optional and environment-driven
- when no budget env vars are supplied, the assert script exits successfully and reports observation-only mode

Audit conclusion:

- CI perf regression protection is only lightly started.

## Gap 7: None of the architectural bottlenecks `B1` through `B5` has been performance-optimized yet

The most important audit question is not whether instrumentation exists. It is whether the code still looks like the bottleneck descriptions in the report.

It does.

### `B1` Download to cache: still unresolved

The report says download still materializes large buffers and pays bridge overhead.

That is still true in the current code:

- `src/lib/hvsc/hvscDownload.ts`
  - `streamToBuffer`
  - full-buffer checksum path via `computeArchiveChecksumMd5`
  - archive bytes can still be fully materialized and hashed in JS-visible memory

There is no native streaming checksum pipeline and no binary bridge redesign.

### `B2` Ingest pipeline: still unresolved

The report says ingest is dominated by per-file writes and base64 overhead on the non-native path.

That remains true:

- `src/lib/hvsc/hvscIngestionRuntime.ts`
  - non-native path still reads archive buffers and extracts in JS
- `src/lib/hvsc/hvscFilesystem.ts`
  - writes still route through `Filesystem.writeFile`
- the report's proposed batched or indexed ingest redesign is not landed

There is instrumentation here, but not the optimization.

### `B3` Browse storage and traversal: still unresolved

The report says browse remains snapshot-heavy and JS-centric.

That remains true:

- `src/lib/hvsc/hvscBrowseIndexStore.ts`
  - persists `hvsc-browse-index-v1.json`
  - serializes with `JSON.stringify`
  - reads the snapshot back from storage
- `src/lib/hvsc/hvscService.ts`
  - still sorts folders and songs in JS
  - still rebuilds or verifies snapshot-heavy state

The report's top-ranked browse fix, replacing the JSON snapshot with an indexed store, is not implemented.

### `B4` Playlist add and filter architecture: still unresolved

The report says the canonical playlist still lives fully in React state and gets reserialized into the repository.

That remains true:

- `src/pages/playFiles/hooks/usePlaylistManager.ts`
  - playlist is still `useState<PlaylistItem[]>([])`
- `src/pages/playFiles/handlers/addFileSelections.ts`
  - appends via `setPlaylist((prev) => [...prev, ...resolvedItems])`
- `src/pages/playFiles/hooks/useQueryFilteredPlaylist.ts`
  - serializes the full playlist into repository records
  - calls `replacePlaylistItems` for the full playlist
  - queries repository results back into React-visible arrays

The report's recommendation to make the repository authoritative and eliminate full in-memory hydration is not implemented.

### `B5` Playback start latency: still unresolved

The report says playback still pays base64 bridge and on-demand metadata costs.

That remains true:

- `src/lib/hvsc/hvscFilesystem.ts`
  - reads SID bytes through `readFileWithSizeGuard`
  - returns `dataBase64`
- `src/lib/hvsc/hvscSource.ts`
  - decodes `song.dataBase64`
- there is no native file-path playback path
- there is no first-audio timing mark

Audit conclusion:

- The repo has measurement scaffolding for the current architecture.
- The repo does not yet contain the major performance architecture changes proposed by the report.

## Target Closure Matrix

| Target | Required proof | Current status | Why it is not closed |
|---|---|---|---|
| `T1` Download full HVSC at 5 MiB/s in `< 20 s` | Real measured download benchmark on Pixel 4 and Docker web | `NOT DONE` | Existing measured web lane does not perform download. No Android measured result recorded. |
| `T2` Ingest 60,582+ songs in `< 25 s` | Real measured ingest benchmark on Pixel 4 and Docker web | `NOT DONE` | Existing measured web lane does not perform ingest. No Android measured result recorded. |
| `T3` Browse traversal `< 2 s` worst case on Pixel 4 | Real-device measured traversal timings | `NOT DONE` | Only secondary web query timings exist. No Pixel 4 evidence. |
| `T4` Filter 60K+ playlist `< 2 s` worst case on Pixel 4 | Large-playlist filter benchmark with measured timings | `NOT DONE` | No filter perf harness exists. No app-level filter timing scopes exist. |
| `T5` Playback start `< 1 s` on Pixel 4 | End-to-end playback-start timing from filtered result | `NOT DONE` | Existing metric is `playbackLoadSidMs`, not full playback start or first audio. No Pixel 4 quantified proof. |
| `T6` 100K playlist items without full in-memory hydration | Architecture and benchmark proof | `NOT DONE` | Code still keeps full playlist in React state; no 100K perf benchmark exists. |

## Documentation Drift Findings

The current tree contains Android-related perf scaffolding that `PLANS.md` and `WORKLOG.md` do not fully reflect:

- `.maestro/perf-hvsc-baseline.yaml`
- `scripts/run-hvsc-android-benchmark.sh`
- `ci/telemetry/android/perfetto-hvsc.cfg`
- smoke benchmark snapshot plumbing

This creates two problems:

- the top-level status record understates what has been scaffolded
- the undocumented scaffolding also has no recorded evidence, so it is easy to over-credit it informally

Audit conclusion:

- `PLANS.md` and `WORKLOG.md` should be reconciled with the current Android perf tree before the next cycle starts.

## What Has Actually Been Achieved So Far

This is the strict audit-grade answer to "how much has already been done."

Completed:

- performance research package
- first HVSC perf timing framework
- first instrumentation pass on selected hot paths
- export of timings through tracing, diagnostics, and smoke snapshots
- mock HVSC server capable of disk-backed throttled archive serving
- one secondary web perf scenario
- one narrow measured web baseline
- first CI jobs for that narrow web lane

Partially completed:

- Android perf automation
- Perfetto capture integration
- CI perf regression infrastructure
- benchmark scenario automation
- artifact collection
- budget assertion

Not completed:

- any target closure `T1` through `T6`
- complete `S1` through `S11` scenario suite
- microbenchmarks
- Perfetto SQL analysis
- native Android trace sections
- large-playlist filter benchmarks
- 100K no-full-hydration proof
- any of the major architecture improvements identified by the report

## Minimum Honest Next-Step Backlog

To move from partial scaffolding to production-grade closure, the next work must do all of the following:

1. Turn the existing Android perf harness into a real metric pipeline.
   - parse smoke benchmark snapshots
   - calculate p50/p95
   - enforce per-target budgets
   - record results in `PLANS.md` and `WORKLOG.md`

2. Implement real `S1` and `S2` benchmarks.
   - actual download
   - actual ingest
   - both on Docker web and Pixel 4

3. Add the missing app-level timing scopes.
   - `playlist:add-batch`
   - `playlist:filter`
   - `playlist:repo-sync`
   - `browse:render`
   - `playback:first-audio`

4. Upgrade Perfetto from capture-only to analysis-capable.
   - richer trace config
   - trace-processor SQL
   - extracted CPU, memory, and jank metrics

5. Add the missing CI microbench lane.
   - `test:bench`
   - benchmark files
   - artifact retention under a stable perf path

6. Start actual optimization cycles against the live bottlenecks.
   - browse snapshot architecture
   - download/checksum pipeline
   - ingest write path
   - playlist authority model
   - playback bridge path

## Final Verdict

The HVSC performance effort has completed the research phase and has begun the measurement-foundation phase. It has not yet reached the optimization phase in any meaningful production-closing sense.

The repo today contains:

- strong research
- useful instrumentation
- a real but narrow secondary web benchmark
- partial Android benchmark scaffolding

The repo does not yet contain:

- complete benchmark coverage
- complete real-device evidence
- closed targets
- the architecture changes required to meet the targets

The honest production audit result is therefore:

- performance research: complete
- performance measurement foundation: partially complete
- production performance proof: incomplete
- production performance optimization: not yet done
