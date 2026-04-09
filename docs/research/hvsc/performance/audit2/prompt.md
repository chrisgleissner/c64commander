# HVSC Performance Device-Scale Convergence Prompt

Date: 2026-04-06
Type: Strict execution prompt
Primary input: `docs/research/hvsc/performance/audit/audit.md`
Secondary inputs:
- `PLANS.md`
- `WORKLOG.md`
- `docs/ux-guidelines.md`
Classification: `CODE_CHANGE`

## Mission

Close the evidence-backed remaining HVSC performance work with two non-negotiable outcomes:

1. No user-visible HVSC workflow step may spend more than `2s` on a Pixel 4 without clear in-progress feedback.
2. Large playlists must be fast and usable on a real Pixel 4 at real scale, starting above `5k` items and pushed as far toward `100k` as the live architecture and device storage allow, with measured proof.

The workflow scope is end-to-end:

- download
- ingest
- add to playlist
- filter playlist
- playback start

Clear feedback means one of:

- a processed-count style progress display
- a determinate progress bar
- an indeterminate animated indicator with a truthful stage label

Silence is failure. A hidden background task is failure. A frozen filter field with no visible progress state is failure.

This is not a research pass.
This is not a partial-progress pass.
This is not a scaffold-only pass.
This is not complete until the verified Pixel 4 large-playlist problem is either fixed with measured before/after proof or blocked by external evidence recorded in `PLANS.md` and `WORKLOG.md`.

## Closed Items To Preserve

- `UI-SOURCE-001` is already verified.
  - Evidence: `src/components/FileOriginIcon.tsx`, `src/components/itemSelection/ItemSelectionDialog.tsx`, `tests/unit/components/FileOriginIcon.test.tsx`, `tests/unit/components/itemSelection/ItemSelectionDialog.test.tsx`
- `UI-DOC-002` is already verified.
  - Evidence: `README.md`, `docs/img/app/play/import/01-import-interstitial.png`, `docs/img/app/play/import/02-c64u-file-picker.png`, `docs/img/app/play/import/03-local-file-picker.png`, `docs/img/app/play/import/04-commoserve-search.png`, `docs/img/app/play/import/05-commoserve-results-selected.png`
- `P0.1` through `P1.6` remain landed foundation work.
  - Evidence: `PLANS.md`, `WORKLOG.md`, `package.json`, `playwright/hvscPerfScenarios.spec.ts`, `scripts/run-hvsc-android-benchmark.sh`, `scripts/hvsc/extract-perfetto-metrics.mjs`, `tests/benchmarks/hvscHotPaths.bench.ts`
- The playlist correctness and commit-barrier work remains landed and must be preserved while fixing scale.
  - Evidence: `src/pages/playFiles/playlistRepositorySync.ts`, `src/pages/playFiles/hooks/useQueryFilteredPlaylist.ts`, `src/pages/playFiles/hooks/usePlaybackPersistence.ts`, `tests/unit/playFiles/playlistRepositorySync.test.ts`, `tests/unit/playFiles/useQueryFilteredPlaylist.test.tsx`, `tests/unit/playFiles/useQueryFilteredPlaylist.scale.test.tsx`

Do not reopen or discard this landed work unless the live tree regresses and the regression is recorded with evidence in `PLANS.md` and `WORKLOG.md`.

## Current Live-Tree Findings You Must Treat As Real

1. The Android baseline harness is not yet target-scale for playlist work.
   - Current setup flow still adds only `10_Orbyte.sid`.
   - Evidence: `.maestro/perf-hvsc-baseline.yaml`
2. Current Android filter evidence is subscale and cannot close `T4` or `T6`.
   - The committed Android filter smoke artifact shows `playlistSize: 1`.
   - Evidence: `ci-artifacts/hvsc-performance/android/20260406T021720Z-p2-baseline-v13/smoke/loop-1/c64u-smoke-benchmark-playlist-filter.json`
3. Current Android measurement flows are still operationally broken for target closure.
   - `perf-hvsc-00-playlist-build`, `perf-hvsc-browse-traversal`, and `perf-hvsc-playback` failed in the latest committed run.
   - Evidence: `ci-artifacts/hvsc-performance/android/v13-benchmark.log`
4. The Android summary pipeline still reports only `T1` through `T5`.
   - `T6` and any feedback-visibility contract are not yet summarized.
   - Evidence: `scripts/hvsc/androidPerfSummary.mjs`, `scripts/hvsc/write-android-perf-summary.mjs`, `scripts/hvsc/assert-android-perf-budgets.mjs`
5. Repository-backed filtering exists, but the full playlist still remains canonical in React state.
   - Treat this as an open hypothesis against `T6`, not as closure.
   - Evidence: `src/pages/playFiles/hooks/usePlaylistManager.ts`, `src/pages/playFiles/hooks/usePlaybackPersistence.ts`, `src/pages/playFiles/hooks/useQueryFilteredPlaylist.ts`
6. User-feedback coverage is partial.
   - HVSC install/ingest and add-items import already expose progress surfaces.
   - Playlist filter, large list open, and playback-start do not yet have an explicit measured “feedback within 2s” acceptance contract.
   - Evidence: `src/pages/playFiles/components/HvscControls.tsx`, `src/components/itemSelection/AddItemsProgressOverlay.tsx`, `src/pages/playFiles/hooks/useHvscLibrary.ts`, `src/pages/playFiles/hooks/useQueryFilteredPlaylist.ts`, `src/components/lists/SelectableActionList.tsx`, `src/pages/playFiles/components/PlaylistPanel.tsx`

## Hard Acceptance Targets

### `UX1` Visible feedback contract

For each Pixel 4 workflow stage below, the user must either see a result or see truthful in-progress feedback within `2_000 ms`:

- full HVSC download
- HVSC ingest
- add-to-playlist at large scale
- playlist filter at large scale
- playback start from a filtered result

If a numeric count is available, show it.
If a numeric count is not available, show a stage label plus an indeterminate animation.

### `T1` through `T6`

- `T1`: Download full HVSC from a mock provider throttled to `5 MiB/s`
- `T2`: Ingest all `60,582+` songs
- `T3`: Any single add-items browse traversal step
- `T4`: Filter a large playlist on Pixel 4 under the hard budget, starting with `>= 5,000` items and scaling upward
- `T5`: Playback start from a filtered result on Pixel 4
- `T6`: `100K` playlist items without hot-path dependence on full in-memory hydration or canonical full-array React ownership for query/filter/render behavior

Keep the existing budgets from the audit package unless measured evidence in the live tree requires a stricter interpretation. Do not loosen them.

## Non-Negotiable Execution Rules

1. `PLANS.md` is the source of truth for the current target matrix, current dominant bottleneck, current platform blocker, and current task.
2. `WORKLOG.md` gets a timestamped entry after every meaningful action, validation run, measurement run, keep/discard decision, blocker, or failed attempt.
3. This prompt lives in `audit2/` intentionally. Do not create `audit3/`, alternate artifact roots, or more parallel prompt trees.
4. Preserve the existing artifact layout under `ci-artifacts/hvsc-performance/**`.
5. Do not claim `T1` or `T2` from fixture-mode web summaries where `mode` is `fixture-s1-s11-web` or `archives.baselineArchive` is null.
6. Do not claim Android closure from raw smoke JSON files unless the matching run directory also contains `summary.json`.
7. Do not claim `T4`, `T5`, or `T6` from any Android run where the measured playlist size is `< 5,000`.
8. Do not claim `T6` from synthetic bench tests, hook-scale tests, or repository unit tests alone.
9. Do not claim `UX1` from manual observation alone. Record timestamped evidence in tests, smoke artifacts, traces, or summary output.
10. If code changes, run the smallest honest layer validation plus `npm run test:coverage`, keeping global branch coverage at `>= 91%`.
11. Do not run builds, coverage, or screenshots for ceremony when a subtask is genuinely doc-only.
12. Regenerate screenshots only if a visible documented UI changed.
13. Stop and record a blocker instead of continuing on inference.

## Blocking Rules

- If the real HVSC archive or update cache needed for a full web baseline is unavailable, stop, record the missing path, and do not mark the web baseline task done.
- If no adb-attached Pixel 4 is available, stop, record the blocker, and do not mark Android baseline, `UX1`, `T4`, `T5`, or `T6` done.
- If no reachable real C64U host is available, probe `u64` first, then `c64u`, record the result, and stop rather than faking playback or browse closure.
- If the Android harness cannot build a playlist of at least `5,000` items, fix the harness first. Do not proceed with subscale evidence.
- If Perfetto capture or `trace_processor_shell` extraction degrades, record the degraded status and keep the Android baseline task open unless the blocker is explicitly accepted as external.
- If Maestro measurement flows fail, fix the flow or runtime cause, or record a blocker with logs before moving on.

## Required Read Set Before Acting

Read the smallest relevant set, but at minimum:

- `README.md`
- `.github/copilot-instructions.md`
- `docs/ux-guidelines.md`
- `PLANS.md`
- `WORKLOG.md`
- `docs/research/hvsc/performance/audit/audit.md`
- `docs/research/hvsc/performance/audit/convergence-prompt.md`
- `src/pages/playFiles/hooks/usePlaylistManager.ts`
- `src/pages/playFiles/hooks/usePlaybackPersistence.ts`
- `src/pages/playFiles/hooks/useQueryFilteredPlaylist.ts`
- `src/pages/playFiles/components/PlaylistPanel.tsx`
- `src/components/lists/SelectableActionList.tsx`
- `src/components/itemSelection/AddItemsProgressOverlay.tsx`
- `src/pages/playFiles/hooks/useHvscLibrary.ts`
- `src/pages/playFiles/components/HvscControls.tsx`
- `.maestro/perf-hvsc-baseline.yaml`
- `.maestro/perf-hvsc-browse-traversal.yaml`
- `.maestro/perf-hvsc-filter-high.yaml`
- `.maestro/perf-hvsc-filter-low.yaml`
- `.maestro/perf-hvsc-filter-zero.yaml`
- `.maestro/perf-hvsc-playback.yaml`
- `scripts/run-hvsc-android-benchmark.sh`
- `scripts/hvsc/androidPerfSummary.mjs`
- `scripts/hvsc/write-android-perf-summary.mjs`
- `scripts/hvsc/assert-android-perf-budgets.mjs`

## Open Execution Ledger

### [ ] `HARNESS-ANDROID-SCALE-001` Make the Android perf harness honest for large-playlist and feedback closure

Dependencies: none

Implementation steps:

1. Fix the Android setup and measurement flows so a measured run can build and retain a real large playlist instead of a one-song seed.
2. Ensure the measured filter and playback flows run against the same target-scale playlist.
3. Extend smoke artifacts and summary generation so each measured run records:
   - playlist size used for filter/playback
   - whether visible feedback appeared within `2s`
   - `T6` evidence, not just `T1` through `T5`
4. Keep the current artifact layout under `ci-artifacts/hvsc-performance/android/<run-id>/`.

Relevant implementation surfaces:

- `.maestro/perf-hvsc-baseline.yaml`
- `.maestro/perf-hvsc-browse-traversal.yaml`
- `.maestro/perf-hvsc-filter-high.yaml`
- `.maestro/perf-hvsc-filter-low.yaml`
- `.maestro/perf-hvsc-filter-zero.yaml`
- `.maestro/perf-hvsc-playback.yaml`
- `scripts/run-hvsc-android-benchmark.sh`
- `scripts/hvsc/androidPerfSummary.mjs`
- `scripts/hvsc/write-android-perf-summary.mjs`
- `scripts/hvsc/assert-android-perf-budgets.mjs`

Required validation:

1. Targeted Maestro contract or regression tests for any changed flows
2. Targeted unit tests for changed summary or runner logic
3. If code changes, `npm run test:coverage`, `npm run lint`, and `npm run build`

Required artifact paths:

- `ci-artifacts/hvsc-performance/android/<run-id>/summary.json`
- `ci-artifacts/hvsc-performance/android/<run-id>/smoke/`
- `ci-artifacts/hvsc-performance/android/<run-id>/telemetry/`
- `ci-artifacts/hvsc-performance/android/<run-id>/maestro/`
- `ci-artifacts/hvsc-performance/android/<run-id>/perfetto/hvsc-baseline.pftrace`
- `ci-artifacts/hvsc-performance/android/<run-id>/perfetto/extracted-metrics.json`

Measurable success criteria:

- the harness can produce a measured Android run with playlist size `>= 5,000`
- `summary.json` exists and includes `targetEvidence.T6`
- `summary.json` includes explicit feedback evidence for the long-running user-visible steps
- the measurement flows no longer depend on the single-track `10_Orbyte.sid` baseline for target closure

Explicit failure conditions:

- the measured playlist size remains `< 5,000`
- `summary.json` still omits `T6`
- feedback visibility is still inferred rather than recorded
- the run only proves filter on a one-item or otherwise subscale playlist

Proof required before changing `[ ]` to `[x]`:

- `WORKLOG.md` entry with the exact run id, device id, chosen C64U host, measured playlist size, and pass/fail flow list
- `PLANS.md` updated to state that Android large-playlist measurement is now honest enough to close or fail targets

### [ ] `BASELINE-WEB-002` Capture the first honest full-size Docker web baseline

Dependencies: `HARNESS-ANDROID-SCALE-001`

Implementation steps:

1. Run the full S1-S11 web suite against real archives, not fixture mode.
2. Use the existing harness and artifact location already wired in the repo.
3. Persist the measured summary to the existing nightly artifact path.
4. Copy exact web-side `T1` through `T5` values into `PLANS.md` and `WORKLOG.md`.
5. Do not claim any web-side support for `T6` unless the evidence is from a real high-scale run rather than fixture mode or synthetic bench tests.

Required validation:

1. `npm run test:perf:nightly`
2. `npm run test:perf:assert:web`

Required artifact paths:

- `ci-artifacts/hvsc-performance/web/web-full-nightly.json`
- `ci-artifacts/hvsc-performance/web/web-secondary-nightly.json` if the secondary suite is run

Measurable success criteria:

- `web-full-nightly.json` exists
- `scenarioCoverage` includes `S1` through `S11`
- the run is not fixture-only
- `PLANS.md` records explicit web-side evidence paths for the targets it claims

Explicit failure conditions:

- the output is still fixture mode
- the summary file is missing
- one or more scenarios are absent
- `T6` is claimed from web fixture mode or synthetic scale tests

Proof required before changing `[ ]` to `[x]`:

- `WORKLOG.md` entry with command, archive path, run id, and extracted target values
- `PLANS.md` target table updated with the web evidence path

### [ ] `BASELINE-ANDROID-003` Capture a real Pixel 4 baseline that reproduces the large-playlist problem honestly

Dependencies: `HARNESS-ANDROID-SCALE-001`, `BASELINE-WEB-002`

Implementation steps:

1. Run the Android benchmark runner on the preferred Pixel 4 (`9B0*` first) against a reachable real C64U host.
2. Ensure the measured run contains a real large-playlist workload with `playlistSize >= 5,000`.
3. Capture before-fix evidence for:
   - filter latency
   - playback-start latency
   - feedback visibility delay
   - any memory or jank evidence available from telemetry and Perfetto
4. If the current tree no longer reproduces the issue at `>= 5,000`, increase scale and continue until the current dominant issue appears or measured success is proven.
5. Do not stop at `5,000` if the architecture still degrades materially at higher scales. Push toward `20k`, `60k`, and `100k`.

Required validation:

1. `scripts/run-hvsc-android-benchmark.sh --loops=<n> --warmup=<n>`
2. Any targeted regression tests needed for touched Maestro flows, runner scripts, or Android summary logic
3. If code changes, `npm run test:coverage`, `npm run lint`, and `npm run build`

Required artifact paths:

- `ci-artifacts/hvsc-performance/android/<run-id>/summary.json`
- `ci-artifacts/hvsc-performance/android/<run-id>/smoke/`
- `ci-artifacts/hvsc-performance/android/<run-id>/telemetry/`
- `ci-artifacts/hvsc-performance/android/<run-id>/maestro/`
- `ci-artifacts/hvsc-performance/android/<run-id>/perfetto/hvsc-baseline.pftrace`
- `ci-artifacts/hvsc-performance/android/<run-id>/perfetto/extracted-metrics.json`

Measurable success criteria:

- the run is on a real Pixel 4
- the run is against a real C64U host
- `summary.json` exists and includes `targetEvidence`
- the measured playlist size is recorded and is `>= 5,000`
- any open `T4`, `T5`, `T6`, or `UX1` failure is now reproduced with honest evidence rather than inferred from stale logs

Explicit failure conditions:

- `summary.json` is missing
- the run directory has no Perfetto trace or extracted metrics file
- the measured playlist size is omitted or `< 5,000`
- target values are inferred from raw smoke files without a summary

Proof required before changing `[ ]` to `[x]`:

- `WORKLOG.md` entry with run id, device id, host, measured playlist size, pass/fail flow list, and extracted target values
- `PLANS.md` updated with the Android evidence path and the failing or passing state of `UX1`, `T4`, `T5`, and `T6`

### [ ] `TARGET-MATRIX-004` Build the first honest pass/fail matrix including feedback visibility and large-playlist closure

Dependencies: `BASELINE-WEB-002`, `BASELINE-ANDROID-003`

Implementation steps:

1. Update `PLANS.md` so every target `UX1`, `T1` through `T6` has one of `PASS`, `FAIL`, `PARTIAL`, or `BLOCKED`.
2. Cite the exact web and Android artifact paths for each target.
3. Select one dominant bottleneck based only on measured evidence.
4. Explicitly state whether the dominant issue is:
   - feedback visibility
   - playlist population
   - filter/query latency
   - playback start
   - memory / hydration architecture

Required validation:

1. No new builds or tests unless tracker updates reveal missing evidence
2. Re-run a measurement only if a target would otherwise be based on inference

Required artifact paths:

- `ci-artifacts/hvsc-performance/web/web-full-nightly.json`
- `ci-artifacts/hvsc-performance/android/<run-id>/summary.json`
- any secondary artifact explicitly cited in the matrix

Measurable success criteria:

- no target remains `unmeasured`
- each target cites a real artifact path
- one dominant bottleneck is named with measured evidence

Explicit failure conditions:

- a target is inferred from fixture-mode web results
- a target is inferred from Android raw smoke files without a summary
- `UX1` is omitted
- more than one bottleneck is selected

Proof required before changing `[ ]` to `[x]`:

- `PLANS.md` target matrix shows explicit statuses and evidence paths for `UX1`, `T1` through `T6`
- `WORKLOG.md` records the chosen bottleneck and why it dominates

### [ ] `OPTIMIZE-PLAYLIST-SCALE-005` Fix the dominant large-playlist or feedback bottleneck with measured before/after proof

Dependencies: `TARGET-MATRIX-004`

Implementation steps:

1. Choose the single dominant bottleneck from `TARGET-MATRIX-004`.
2. Make the smallest coherent code change that addresses it.
3. Add a regression or contract test that fails before and passes after.
4. Re-run only the affected web and Android measurements.
5. Keep or discard the change using before/after data.
6. Repeat this cycle until `UX1`, `T4`, `T5`, and `T6` are either passing or formally blocked.

Strong guidance from the live tree:

- Do not assume repository-backed filtering alone closes `T6`.
- The full playlist still remains canonical in React state today.
- If the fix requires moving authoritative playlist ownership or query execution farther out of React, do it.
- Preserve the landed commit-barrier correctness guarantees while changing the scale architecture.

Required validation:

1. Targeted unit or integration tests for the changed surface
2. `npm run test:coverage`
3. `npm run lint`
4. `npm run build`
5. Only the perf runs needed to measure the affected targets

Required artifact paths:

- a new web summary under `ci-artifacts/hvsc-performance/web/` if the change affects web
- a new Android run directory under `ci-artifacts/hvsc-performance/android/` if the change affects Android
- updated `PLANS.md` and `WORKLOG.md` entries with before/after values

Measurable success criteria:

- at least one measured bottleneck cycle is executed
- before/after values are recorded for the affected target metrics
- `UX1` and the relevant large-playlist target either improve measurably or the change is discarded
- a kept change has a dedicated regression or contract test

Explicit failure conditions:

- more than one independent bottleneck is changed at once
- no regression test is added for a kept code change
- there is no before/after measurement data
- the run still uses a subscale playlist while claiming large-playlist closure

Proof required before changing `[ ]` to `[x]`:

- `WORKLOG.md` records each keep/discard decision with measured deltas
- `PLANS.md` updates current target status and the next dominant bottleneck

### [ ] `CI-SCOPE-006` Align quick and nightly CI with the honest implemented scope

Dependencies: `OPTIMIZE-PLAYLIST-SCALE-005`

Implementation steps:

1. Decide whether Android perf remains manual or becomes a CI lane.
2. Update workflow files, scripts, and docs so quick and nightly jobs claim only the scope they really execute.
3. Preserve the existing `ci-artifacts/hvsc-performance/**` artifact layout.
4. Do not let CI text imply that synthetic scale tests or web fixture runs close the Pixel 4 large-playlist problem.

Required validation:

1. Targeted workflow or contract tests for any changed CI scripts
2. If code changes, the normal code-change validation for the touched files

Required artifact paths:

- `.github/workflows/android.yaml`
- `.github/workflows/perf-nightly.yaml`
- any supporting script or contract-test file changed to enforce the new scope

Measurable success criteria:

- quick and nightly CI descriptions match the implemented lanes
- no workflow text claims broader closure than the code provides
- artifact upload paths stay consistent

Explicit failure conditions:

- web-only CI is described as Pixel 4 or multi-platform closure
- synthetic scale tests are described as `T6` closure
- artifact roots are renamed or split without updating all call sites

Proof required before changing `[ ]` to `[x]`:

- `WORKLOG.md` entry describing the chosen CI scope and why
- `PLANS.md` CI status section updated to match the workflows

### [ ] `CLOSE-007` Produce the final convergence record

Dependencies: `CI-SCOPE-006`

Implementation steps:

1. Re-audit the live tree against `docs/research/hvsc/performance/audit/audit.md`.
2. Update the audit or prompt docs only if the live tree changed during execution.
3. Record the final state of each audit gap and each target in `PLANS.md` and `WORKLOG.md`.
4. State explicitly whether the verified Pixel 4 large-playlist issue is:
   - fixed and proven
   - improved but still open
   - blocked externally

Required validation:

1. No new builds or tests unless the final re-audit reveals uncited or stale evidence
2. Re-run only the minimum measurement needed to resolve any last ambiguous target

Required artifact paths:

- `docs/research/hvsc/performance/audit/audit.md`
- `docs/research/hvsc/performance/audit/convergence-prompt.md`
- this prompt: `docs/research/hvsc/performance/audit2/prompt.md`
- final web and Android perf artifact paths cited in the closure record

Measurable success criteria:

- every audit gap is `DONE` or `BLOCKED`
- `UX1` and `T1` through `T6` have explicit final statuses
- `PLANS.md`, `WORKLOG.md`, the audit, and the closure prompt agree

Explicit failure conditions:

- a target remains ambiguous
- the audit and prompt disagree
- the closure record cites non-existent evidence

Proof required before changing `[ ]` to `[x]`:

- final `PLANS.md` target matrix and gap-status table
- final `WORKLOG.md` closure entry with the exact artifact paths

## Dependency Graph

- `HARNESS-ANDROID-SCALE-001` before `BASELINE-WEB-002`
- `HARNESS-ANDROID-SCALE-001` before `BASELINE-ANDROID-003`
- `BASELINE-WEB-002` before `TARGET-MATRIX-004`
- `BASELINE-ANDROID-003` before `TARGET-MATRIX-004`
- `TARGET-MATRIX-004` before `OPTIMIZE-PLAYLIST-SCALE-005`
- `OPTIMIZE-PLAYLIST-SCALE-005` before `CI-SCOPE-006`
- `CI-SCOPE-006` before `CLOSE-007`

## Termination Conditions

- Stop only when every remaining task above is checked with proof, or when an external blocker is fully evidenced in `PLANS.md` and `WORKLOG.md`.
- If a blocker is recorded, stop at that task. Do not skip ahead and do not mark later tasks complete.
- Do not declare success while the Pixel 4 large-playlist problem remains reproduced but unfixed.
