# HVSC Performance Audit Convergence Prompt

Date: 2026-04-05
Type: Execution convergence prompt
Primary input: `docs/research/hvsc/performance/audit/audit.md`
Classification: `CODE_CHANGE`

## Mission

Converge the HVSC performance program to an honest production-ready state by resolving every issue identified in `docs/research/hvsc/performance/audit/audit.md`.

This is not a research pass.
This is not a partial scaffolding pass.
This is not a “make progress” pass.

This is a convergence pass with hard sequential gating.

You are not done until:

1. every audit gap is either closed with source-backed evidence or blocked by a precisely evidenced external constraint,
2. every target `T1` through `T6` has an explicit measured status,
3. no task in the plan remains unticked,
4. no later task has been started before all earlier tasks are fully completed and ticked off.

## Authoritative Inputs

Read and follow, in this order:

1. `.github/copilot-instructions.md`
2. `AGENTS.md`
3. `README.md`
4. `docs/research/hvsc/performance/audit/audit.md`
5. `docs/research/hvsc/performance/hvsc-performance-research-report-2026-04-05.md`
6. `docs/research/hvsc/performance/hvsc-performance-convergence-prompt-2026-04-05.md`
7. `PLANS.md`
8. `WORKLOG.md`

## Hard Targets

All targets must be measured on the required platforms. A target is not closed by inference.

| ID | Scenario | Hard budget | Platform |
|---|---|---|---|
| `T1` | Download full HVSC from a mock provider throttled to `5 MiB/s` | `< 20 s` | Pixel 4, Docker web |
| `T2` | Ingest all `60,582+` songs | `< 25 s` | Pixel 4, Docker web |
| `T3` | Any single add-items browse traversal step | `< 2 s` worst case | Pixel 4 |
| `T4` | Filter a `60K+` playlist | `< 2 s` worst case | Pixel 4 |
| `T5` | Playback start from filtered result | `< 1 s` | Pixel 4 |
| `T6` | `100K` playlist items without full in-memory hydration | pass/fail | Pixel 4, Docker web |

## Non-Negotiable Execution Rules

### 1. Sequential-only convergence

Tasks must be completed in order.

- Do not skip tasks.
- Do not partially complete a task and move on.
- Do not start a later task because it seems easier.
- Do not defer validation of a task to a later phase.

If a task is blocked:

- stop,
- record the blocker in `PLANS.md` and `WORKLOG.md`,
- explain exactly what is missing,
- do not start the next task until the blocker is resolved or formally accepted as external.

### 2. Checkbox discipline

This file is the execution ledger.

- Every task below starts unchecked.
- A task may be changed to `[x]` only when its completion gate is fully satisfied.
- Every checked task must cite concrete evidence paths in `PLANS.md` and `WORKLOG.md`.
- Never pre-check or “effectively done” a task.

### 3. No optimistic status claims

Do not claim any of the following unless actual evidence exists in the repo:

- target passes
- benchmark lane exists
- Android proof exists
- nightly perf coverage exists
- CI regression protection exists
- architectural bottleneck is resolved

### 4. One optimization cycle at a time

After the benchmark foundation is complete:

- identify one dominant bottleneck,
- implement one coherent optimization cycle,
- remeasure,
- keep or discard,
- then move to the next cycle.

Do not batch multiple major bottleneck fixes before remeasurement.

### 5. Mandatory tracking files

Keep these files current throughout execution:

- `PLANS.md`
- `WORKLOG.md`

`PLANS.md` must reflect:

- current target status
- current dominant bottleneck
- current phase/task
- remaining gaps
- benchmark infrastructure state

`WORKLOG.md` must record:

- every command of consequence
- every measurement run
- every artifact path
- every keep/discard decision
- every blocker

## Required Deliverables

By the end of the full convergence pass, the repo must contain:

1. complete benchmark scenario coverage for the required matrix,
2. measured target status for `T1` through `T6`,
3. Android and web artifact sets in a stable directory layout,
4. CI quick and nightly perf coverage aligned to the honest implemented scope,
5. closed or explicitly blocked audit issues,
6. enough optimization work to either meet the targets or prove why a given target remains blocked.

## Completion Ledger

Do not reorder these tasks.

### Phase 0: Baseline Governance And Reconciliation

- [ ] `P0.1` Reconcile the current tree with the audit and top-level trackers.
  - Required work:
    - compare `docs/research/hvsc/performance/audit/audit.md`, `PLANS.md`, and `WORKLOG.md`
    - record any implemented-but-undocumented HVSC perf assets
    - explicitly call out dirty-worktree files that affect HVSC perf work
  - Completion gate:
    - `PLANS.md` and `WORKLOG.md` both reflect the current known HVSC perf asset set
    - no known HVSC perf asset remains invisible in the top-level trackers

- [ ] `P0.2` Normalize the artifact directory strategy.
  - Required work:
    - choose and implement one canonical perf artifact layout
    - reconcile existing `ci-artifacts/hvsc-performance/**` outputs with the canonical scheme
    - ensure Android, web, traces, summaries, and comparisons have stable homes
  - Completion gate:
    - artifact directories are consistent in scripts and workflows
    - `PLANS.md` documents the actual artifact layout in use

### Phase 1: Benchmark Foundation Closure

- [ ] `P1.1` Close benchmark matrix gap `S1` through `S11`.
  - Required work:
    - define deterministic implementations for all required scenarios
    - cover Pixel 4, Docker web, and the agreed emulator subset honestly
    - encode preconditions, warm-up, run counts, outputs, and failure signatures
  - Completion gate:
    - every scenario from `S1` through `S11` has an executable implementation or an explicitly documented platform-specific inapplicability
    - `PLANS.md` contains a scenario coverage matrix

- [ ] `P1.2` Make the web perf harness benchmark real download and ingest.
  - Required work:
    - remove the current false equivalence where “ready HVSC mock” is treated as download/ingest proof
    - add real web scenarios for:
      - download
      - ingest
      - browse traversal
      - filter
      - playback start
    - preserve the existing narrow secondary lane only if it remains clearly labeled as narrow
  - Completion gate:
    - `T1` and `T2` are actually measured on Docker web
    - the web benchmark suite no longer claims download/ingest coverage without exercising those paths

- [ ] `P1.3` Close Android benchmark harness gap.
  - Required work:
    - turn the existing Android runner into a true measurement pipeline
    - compute scenario metrics from pulled smoke artifacts
    - generate p50/p95 summaries
    - connect metrics to target IDs
  - Completion gate:
    - Android benchmark runs produce structured numeric summaries, not just artifact lists
    - the summaries are sufficient to evaluate `T1` through `T5`

- [ ] `P1.4` Close instrumentation coverage gap.
  - Required work:
    - add the missing app-level timing scopes needed by the report and audit
    - at minimum include:
      - `browse:render`
      - `playlist:add-batch`
      - `playlist:filter`
      - `playlist:repo-sync`
      - `playback:first-audio`
    - ensure export surfaces include the new timings
  - Completion gate:
    - all missing timing scopes from the audit are implemented and test-covered
    - exported benchmark artifacts include the new timing families

- [ ] `P1.5` Close Perfetto pipeline gap.
  - Required work:
    - upgrade trace config to capture decision-grade Android data
    - add any required native trace sections
    - implement trace post-processing
    - extract at least CPU, memory, and jank-relevant metrics where applicable
  - Completion gate:
    - Perfetto traces are not just captured; they are processed into structured metrics
    - `PLANS.md` and `WORKLOG.md` cite the extraction pipeline and output locations

- [ ] `P1.6` Close microbenchmark gap.
  - Required work:
    - add `test:bench`
    - add benchmark files for the critical query/index/storage hot paths
    - define CI-safe thresholds
  - Completion gate:
    - `package.json` contains `test:bench`
    - benchmark files exist
    - CI invokes them

### Phase 2: Honest Baseline Capture

- [ ] `P2.1` Capture the first honest full baseline.
  - Required work:
    - run the complete required benchmark set on Docker web
    - run the complete required benchmark set on Pixel 4 with real U64
    - record the measured status of each target `T1` through `T6`
  - Completion gate:
    - every target has an explicit measured status
    - no target remains “unmeasured”
    - baseline artifacts exist and are linked from `WORKLOG.md`

- [ ] `P2.2` Build the first pass/fail matrix.
  - Required work:
    - summarize current results by target
    - identify the dominant failing bottleneck with evidence
  - Completion gate:
    - `PLANS.md` has a current pass/fail table for `T1` through `T6`
    - one dominant bottleneck is selected for the first optimization cycle

### Phase 3: Bottleneck Convergence Cycles

Run these subtasks as repeated cycles. Each cycle must be fully completed before the next cycle begins.

- [ ] `P3.1` Execute Cycle 1 against the single dominant bottleneck.
  - Required work:
    - choose one bottleneck from the measured baseline
    - make the smallest coherent optimization
    - add regression coverage
    - rerun the affected benchmarks
    - compare before/after
    - keep or discard with data
  - Completion gate:
    - `WORKLOG.md` records before/after values
    - the cycle is either kept or discarded explicitly
    - `PLANS.md` updates the target matrix and next dominant bottleneck

- [ ] `P3.2` Repeat optimization cycles until every target is either passing or formally blocked.
  - Required work:
    - continue single-bottleneck cycles
    - remeasure after every kept or discarded change
    - update CI regression coverage for every real win worth protecting
  - Completion gate:
    - no target remains in an ambiguous state
    - all surviving optimizations have measured justification

### Phase 4: CI Convergence

- [ ] `P4.1` Close quick-CI gap.
  - Required work:
    - ensure the per-build perf lane matches the actually implemented benchmark scope
    - include microbenchmarks
    - include quick wall-clock perf checks
    - fail honestly on real regressions
  - Completion gate:
    - CI quick perf jobs reflect the real implemented benchmark set
    - no placeholder lane is being presented as broader than it is

- [ ] `P4.2` Close nightly-CI gap.
  - Required work:
    - ensure nightly runs the honest deeper perf suite
    - retain artifacts
    - distinguish hard fail from trend-only reporting where appropriate
  - Completion gate:
    - nightly perf coverage exists and matches the actual deep suite
    - artifact retention and result interpretation are documented

### Phase 5: Final Audit Closure

- [ ] `P5.1` Re-audit against `docs/research/hvsc/performance/audit/audit.md`.
  - Required work:
    - revisit every audit gap
    - mark each as closed or externally blocked
    - produce a final closure summary
  - Completion gate:
    - every audit gap has an explicit final status
    - no audit issue is left implied or unstated

- [ ] `P5.2` Produce final convergence record.
  - Required work:
    - summarize final target status
    - summarize closed gaps
    - summarize remaining external blockers, if any
  - Completion gate:
    - `PLANS.md` and `WORKLOG.md` are complete
    - final repo state is honest and internally consistent

## Task Dependency Graph

This dependency graph is mandatory:

- `P0.1` before all other tasks
- `P0.2` before any benchmark or CI work
- `P1.1` before `P1.2`, `P1.3`, `P2.1`
- `P1.2`, `P1.3`, `P1.4`, `P1.5`, `P1.6` before `P2.1`
- `P2.1` before `P2.2`
- `P2.2` before `P3.1`
- `P3.1` before `P3.2`
- `P3.2` before `P4.1`
- `P4.1` before `P4.2`
- `P4.2` before `P5.1`
- `P5.1` before `P5.2`

No exceptions.

## Required Evidence Per Task

Every task must leave all of the following behind:

1. source changes where applicable,
2. tests where applicable,
3. executed command log entries in `WORKLOG.md`,
4. updated status in `PLANS.md`,
5. artifact paths where measurements were captured,
6. a clear statement of whether the task closed a specific audit gap.

If any of the above is missing, the task is not complete and must not be ticked off.

## Blocking Rules

If any of these occur, stop and resolve before moving on:

- benchmark scenario cannot be reproduced deterministically
- target data is missing or inconsistent
- Android device or U64 host is unreachable and the task depends on them
- traces are captured but not parsable
- timing instrumentation is present but not exported
- a CI lane claims coverage broader than what it actually runs
- a “passing” target has only indirect or surrogate evidence

## Quality Bar

A task is complete only when another engineer can inspect the repo and answer all of these with “yes”:

1. Is the task visibly implemented in code or docs?
2. Is the task reflected in `PLANS.md`?
3. Is the task reflected in `WORKLOG.md`?
4. Is the task backed by tests or artifacts where required?
5. Is the task status honest rather than optimistic?
6. Was every prerequisite task already completed first?

If any answer is “no”, the task remains open.

## Final Stop Condition

You may terminate only when one of these is true:

1. all tasks `P0.1` through `P5.2` are checked `[x]`, all targets `T1` through `T6` have final measured status, and all audit issues are closed, or
2. execution is blocked by a verified external constraint and the exact blocker is recorded in `PLANS.md`, `WORKLOG.md`, and the final closure record, with all prior tasks completed and ticked.

Anything else is incomplete.
