# HVSC Performance Remaining-Work Convergence Prompt

Date: 2026-04-06
Type: Strict execution prompt
Primary input: `docs/research/hvsc/performance/audit/audit.md`
Classification: `CODE_CHANGE`

## Mission

Close only the evidence-backed remaining HVSC performance work identified in the updated audit. The foundation work is already landed. The remaining gaps are honest baseline capture, target-matrix closure, measured bottleneck cycles, and CI scope alignment.

This is not a research pass.
This is not a rewrite of the already-closed foundation work.
This is not a partial-progress pass.

## Closed Items To Preserve

- `UI-SOURCE-001` is already verified.
  - Evidence: `src/components/FileOriginIcon.tsx`, `src/components/itemSelection/ItemSelectionDialog.tsx`, `tests/unit/components/FileOriginIcon.test.tsx`, `tests/unit/components/itemSelection/ItemSelectionDialog.test.tsx`
- `UI-DOC-002` is already verified.
  - Evidence: `README.md`, `docs/img/app/play/import/01-import-interstitial.png`, `docs/img/app/play/import/02-c64u-file-picker.png`, `docs/img/app/play/import/03-local-file-picker.png`, `docs/img/app/play/import/04-commoserve-search.png`, `docs/img/app/play/import/05-commoserve-results-selected.png`
- `P0.1` through `P1.6` are landed in the live tree.
  - Evidence: `PLANS.md`, `WORKLOG.md`, `package.json`, `playwright/hvscPerfScenarios.spec.ts`, `scripts/run-hvsc-android-benchmark.sh`, `scripts/hvsc/extract-perfetto-metrics.mjs`, `tests/benchmarks/hvscHotPaths.bench.ts`

Do not reopen these tasks unless the live tree regresses and the regression is recorded with evidence in `PLANS.md` and `WORKLOG.md`.

## Current Starting Evidence

- Web quick fixture summary: `ci-artifacts/hvsc-performance/web/web-full-quick.json`
- Android raw run directories: `ci-artifacts/hvsc-performance/android/**`
- Latest committed Android measurement failure log: `ci-artifacts/hvsc-performance/android/v13-benchmark.log`

## Non-Negotiable Execution Rules

1. `PLANS.md` is the source of truth for current target status, current bottleneck, and current task.
2. `WORKLOG.md` gets a timestamped entry after every meaningful action, validation run, measurement run, keep/discard decision, or blocker.
3. Do not create `audit2/`, new artifact roots, or parallel prompt trees.
4. Do not reopen `UI-SOURCE-001`, `UI-DOC-002`, or P0/P1 foundation work unless the live tree disproves the current evidence.
5. Do not claim `T1` or `T2` from fixture-mode web summaries where `mode` is `fixture-s1-s11-web` or `archives.baselineArchive` is null.
6. Do not claim Android closure from raw smoke JSON files unless the matching run directory also contains `summary.json`.
7. If a task changes code, run the smallest honest code validation for the touched layer, including `npm run test:coverage` with branch coverage `>= 91%`.
8. If a task does not change code, do not run builds, coverage, or screenshots for ceremony.
9. Regenerate screenshots only if a visible UI change makes an existing documented image inaccurate.
10. Stop and record a blocker instead of continuing on inference.

## Blocking Rules

- If the real HVSC archive or update cache needed for a full web baseline is unavailable, stop, record the missing path, and do not mark the web baseline task done.
- If no adb-attached Pixel 4 or reachable real C64U host (`u64` first, then `c64u`) is available, stop, record the blocker, and do not mark Android baseline or target-closure tasks done.
- If Perfetto capture or `trace_processor_shell` extraction degrades, record the degraded status and keep the Android baseline task open unless the blocker is explicitly accepted as external.
- If Maestro measurement flows fail, fix the flow or runtime cause, or record a blocker with logs before moving on.

## Open Execution Ledger

### [ ] `BASELINE-WEB-001` Capture the first honest full-size Docker web baseline

Dependencies: none

Implementation steps:

1. Run the full S1-S11 web suite against real archives, not fixture mode.
2. Use the existing harness and artifact location already wired in the repo.
3. Persist the measured summary to the existing nightly artifact path.
4. Copy exact T1-T5 web values into `PLANS.md` and `WORKLOG.md`.

Required tests or measurement runs:

1. `npm run test:perf:nightly`
2. `npm run test:perf:assert:web`

Required artifact paths:

- `ci-artifacts/hvsc-performance/web/web-full-nightly.json`
- `ci-artifacts/hvsc-performance/web/web-secondary-nightly.json` if the secondary suite is run alongside it

Measurable success criteria:

- `web-full-nightly.json` exists
- `scenarioCoverage` includes `S1` through `S11`
- the run is not fixture-only: `archives.baselineArchive` is set or the worklog records the real archive path used
- T1 through T5 have explicit web-side measured values in `PLANS.md`

Explicit failure conditions:

- the output is still fixture mode
- the summary file is missing
- one or more scenarios are absent
- the worklog records a failing run but no blocker

Proof required before changing `[ ]` to `[x]`:

- `WORKLOG.md` entry with command, archive path, run id, and extracted T1-T5 web values
- `PLANS.md` target table updated with the new web evidence path

### [ ] `BASELINE-ANDROID-002` Capture a successful Pixel 4 baseline with normalized summary and Perfetto outputs

Dependencies: `BASELINE-WEB-001`

Implementation steps:

1. Run the existing Android benchmark runner on the preferred adb device (`9B0*` first) against a reachable real C64U host.
2. Keep the current artifact layout under `ci-artifacts/hvsc-performance/android/<run-id>/`.
3. If Maestro measurement flows fail, fix the flow or runtime cause before retrying.
4. Do not mark the task complete until the runner writes the normalized summary and extracted Perfetto metrics.

Required tests or measurement runs:

1. `scripts/run-hvsc-android-benchmark.sh --loops=<n> --warmup=<n>`
2. Any targeted regression tests needed for touched Maestro flows, runner scripts, or Android summary scripts
3. If code changes, `npm run test:coverage`, `npm run lint`, and `npm run build`

Required artifact paths:

- `ci-artifacts/hvsc-performance/android/<run-id>/summary.json`
- `ci-artifacts/hvsc-performance/android/<run-id>/smoke/`
- `ci-artifacts/hvsc-performance/android/<run-id>/telemetry/`
- `ci-artifacts/hvsc-performance/android/<run-id>/maestro/`
- `ci-artifacts/hvsc-performance/android/<run-id>/perfetto/hvsc-baseline.pftrace`
- `ci-artifacts/hvsc-performance/android/<run-id>/perfetto/extracted-metrics.json`

Measurable success criteria:

- the measurement flows complete without unresolved Maestro failures
- `summary.json` exists and includes `targetEvidence`
- `perfettoExtraction` is present in `summary.json`
- the run id and target values are recorded in `PLANS.md`

Explicit failure conditions:

- `summary.json` is missing
- the run directory has no Perfetto trace or extracted metrics file
- Maestro failures are logged but not fixed or blocked
- Android target values are inferred from raw smoke files without a summary

Proof required before changing `[ ]` to `[x]`:

- `WORKLOG.md` entry with the exact run id, device id, chosen C64U host, pass/fail flow list, and target values
- `PLANS.md` target table updated with the Android evidence path

### [ ] `TARGET-MATRIX-003` Build the first honest pass/fail matrix and select the dominant bottleneck

Dependencies: `BASELINE-WEB-001`, `BASELINE-ANDROID-002`

Implementation steps:

1. Update `PLANS.md` so every target `T1` through `T6` has one of `PASS`, `FAIL`, `PARTIAL`, or `BLOCKED`.
2. Cite the exact web and Android artifact paths for each target.
3. Select one dominant bottleneck based on the measured evidence only.
4. Record the reasoning in both `PLANS.md` and `WORKLOG.md`.

Required tests or measurement runs:

1. No new build or test run unless tracker updates reveal missing evidence.
2. Re-run a measurement only if a target would otherwise be based on inference.

Required artifact paths:

- `ci-artifacts/hvsc-performance/web/web-full-nightly.json`
- `ci-artifacts/hvsc-performance/android/<run-id>/summary.json`
- any secondary or supporting artifact explicitly cited in the matrix

Measurable success criteria:

- no target remains `unmeasured`
- each target cites a real artifact path
- one dominant bottleneck is named with measured evidence

Explicit failure conditions:

- a target is inferred from fixture-mode web results
- a target is inferred from Android raw smoke files without a summary
- more than one bottleneck is selected

Proof required before changing `[ ]` to `[x]`:

- `PLANS.md` target matrix shows explicit statuses and evidence paths for `T1` through `T6`
- `WORKLOG.md` records the chosen bottleneck and why it dominates

### [ ] `OPTIMIZE-004` Execute one measured bottleneck cycle

Dependencies: `TARGET-MATRIX-003`

Implementation steps:

1. Choose the single dominant bottleneck from `TARGET-MATRIX-003`.
2. Make the smallest coherent code change that addresses it.
3. Add a regression or contract test that fails before and passes after.
4. Re-run only the affected web and Android measurements.
5. Keep or discard the change using before/after data.

Required tests or measurement runs:

1. Targeted unit or integration tests for the changed surface
2. `npm run test:coverage`
3. `npm run lint`
4. `npm run build`
5. Only the perf runs needed to measure the affected target(s)

Required artifact paths:

- a new web summary under `ci-artifacts/hvsc-performance/web/`
- a new Android run directory under `ci-artifacts/hvsc-performance/android/` if the bottleneck affects Android
- updated `PLANS.md` and `WORKLOG.md` entries with before/after values

Measurable success criteria:

- exactly one bottleneck cycle is executed
- before/after values are recorded for the affected target metrics
- the change is explicitly kept or discarded

Explicit failure conditions:

- more than one independent bottleneck is changed
- no regression test is added for a kept code change
- there is no before/after measurement data

Proof required before changing `[ ]` to `[x]`:

- `WORKLOG.md` records the keep/discard decision with measured deltas
- `PLANS.md` updates the current target status and next dominant bottleneck

### [ ] `CI-SCOPE-005` Align quick and nightly CI with the honest implemented scope

Dependencies: `OPTIMIZE-004`

Implementation steps:

1. Decide whether Android perf remains manual or becomes a CI lane.
2. Update workflow files, scripts, and documentation so quick and nightly jobs claim only the scope they really execute.
3. Preserve the existing `ci-artifacts/hvsc-performance/**` artifact layout.

Required tests or measurement runs:

1. Targeted workflow or contract tests for any changed CI scripts
2. If code changes, the normal code-change validation for the touched files

Required artifact paths:

- `.github/workflows/android.yaml`
- `.github/workflows/perf-nightly.yaml`
- any supporting script or contract-test file changed to enforce the new scope

Measurable success criteria:

- quick and nightly CI descriptions match the implemented lanes
- no workflow or prompt text claims broader coverage than the code provides
- artifact upload paths stay consistent

Explicit failure conditions:

- web-only CI is described as multi-platform closure
- Android CI claims are added without runnable evidence
- artifact roots are renamed or split without updating all call sites

Proof required before changing `[ ]` to `[x]`:

- `WORKLOG.md` entry describing the chosen CI scope and why
- `PLANS.md` CI status section updated to match the workflows

### [ ] `CLOSE-006` Produce the final convergence record

Dependencies: `CI-SCOPE-005`

Implementation steps:

1. Re-audit the live tree against `docs/research/hvsc/performance/audit/audit.md`.
2. Update the audit and this prompt only if the live tree changed during execution.
3. Record the final state of each audit gap and each target in `PLANS.md` and `WORKLOG.md`.

Required tests or measurement runs:

1. No new builds or tests unless the final re-audit reveals uncited or stale evidence.
2. Re-run only the minimum measurement needed to resolve any last ambiguous target.

Required artifact paths:

- `docs/research/hvsc/performance/audit/audit.md`
- `docs/research/hvsc/performance/audit/convergence-prompt.md`
- final web and Android perf artifact paths cited in the closure record

Measurable success criteria:

- every audit gap is `DONE` or `BLOCKED`
- every target `T1` through `T6` has an explicit final status
- `PLANS.md`, `WORKLOG.md`, the audit, and this prompt all agree

Explicit failure conditions:

- a target remains ambiguous
- the audit and prompt disagree
- the closure record cites non-existent evidence

Proof required before changing `[ ]` to `[x]`:

- final `PLANS.md` target matrix and gap-status table
- final `WORKLOG.md` closure entry with the exact artifact paths

## Dependency Graph

- `BASELINE-WEB-001` before `BASELINE-ANDROID-002`
- `BASELINE-ANDROID-002` before `TARGET-MATRIX-003`
- `TARGET-MATRIX-003` before `OPTIMIZE-004`
- `OPTIMIZE-004` before `CI-SCOPE-005`
- `CI-SCOPE-005` before `CLOSE-006`

## Termination Conditions

- Stop only when every remaining task above is checked with proof, or when an external blocker is fully evidenced in `PLANS.md` and `WORKLOG.md`.
- If a blocker is recorded, stop at that task. Do not skip ahead and do not mark later tasks complete.
