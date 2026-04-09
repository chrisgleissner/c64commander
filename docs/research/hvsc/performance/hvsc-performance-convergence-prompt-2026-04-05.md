# HVSC Performance Convergence Prompt

Date: 2026-04-05
Type: Execution convergence prompt
Input: `docs/research/hvsc/performance/hvsc-performance-research-report-2026-04-05.md`
Classification: CODE_CHANGE

---

## Mission

Iteratively improve the HVSC workflow performance of C64 Commander until **every** non-functional target listed below is met on a **real Pixel 4** connected over ADB against a **real U64 device** (reachable at `u64` or `c64u`). Docker-backed web is the secondary validation target.

This is a convergence task. You are not done until all targets pass on real hardware. There is no fixed scope — the scope is defined by what it takes to reach the targets.

---

## Non-Functional Targets

These are hard pass/fail gates. Every target must be met.

| ID | Scenario | Hard budget | P50 target | Platform |
|----|----------|------------|------------|----------|
| T1 | Download full HVSC from mock provider at 5 MiB/s | < 20 s | < 18 s | Pixel 4, Docker web |
| T2 | Ingest all 60,582+ songs | < 25 s | < 20 s | Pixel 4, Docker web |
| T3 | Any single add-items browse traversal step | < 2 s | < 1 s | Pixel 4 |
| T4 | Filter 60K+ playlist | < 2 s | < 1 s | Pixel 4 |
| T5 | Playback start from filtered result | < 1 s | < 500 ms | Pixel 4 |
| T6 | 100K playlist items without full in-memory hydration | Pass/fail | -- | Pixel 4, Docker web |

---

## Mandatory Tracking Artifacts

You must create and maintain two living documents throughout the entire task:

### `PLANS.md` (in repository root)

This file records the current optimization plan. Update it before each implementation cycle. Structure:

```markdown
# HVSC Performance Optimization Plan

## Current status
<!-- Which targets pass, which fail, what the dominant bottleneck is -->

## Completed cycles
<!-- One entry per completed optimization cycle with measured results -->

## Next cycle
<!-- The single change being attempted next, with rationale from measurement data -->

## Remaining gap
<!-- Which targets still fail and by how much -->

## CI benchmark status
<!-- Current state of benchmark infrastructure -->
```

Rules:
- Update `Current status` after every measurement pass
- Log every completed cycle with before/after metrics
- Never plan more than one cycle ahead
- The `Next cycle` section must cite measured data, not intuition

### `WORKLOG.md` (in repository root)

This file records a chronological, timestamped log of every action taken, measurement captured, and decision made. Structure:

```markdown
# HVSC Performance Worklog

## [YYYY-MM-DD HH:MM] <action title>
<what was done, what was measured, what was decided>
```

Rules:
- One entry per distinct action (measurement, implementation, comparison, decision)
- Include absolute measured values, not just relative improvements
- Include the device and platform for every measurement
- If a change is discarded, record why with data

---

## Execution Model

Follow this loop exactly. Do not skip steps. Do not batch multiple changes before remeasurement.

### Phase 0: Infrastructure Setup (once)

Before any optimization work:

1. **Mock HVSC provider**: Extend `playwright/mockHvscServer.ts` to serve a full-size HVSC fixture from disk at 5 MiB/s throttle. The mock must serve from a cached HVSC archive (check `~/.cache/c64commander/hvsc` and `$HVSC_UPDATE_84_CACHE`). If neither exists, document how to obtain the fixture and block until it is available. The mock must:
   - Serve baseline and update archives
   - Throttle at 5 MiB/s per connection
   - Support `HEAD` for `Content-Length`
   - Log bytes served and timing

2. **App-level instrumentation**: Add structured timing marks using the naming convention from the research report Section 7.1 (`hvsc:perf:<phase>:<event>`). Marks must be:
   - Emitted via `performance.mark()` / `performance.measure()` for web
   - Accumulated in a ring buffer exportable as JSON
   - Capturable by Playwright and Maestro scenarios

3. **Benchmark scenario scripts**: Create deterministic scenario scripts for S1-S11 as defined in the research report Section 6. For Pixel 4, use Maestro. For Docker web, use Playwright. Scripts must:
   - Run each scenario at least 5 times after one warm-up run
   - Capture timing, memory, and jank metrics
   - Output structured JSON results

4. **CI benchmark infrastructure** (detailed below in CI section)

5. **Baseline capture**: Run all scenarios on Pixel 4 + real U64 and Docker web. Persist results. Log everything to `WORKLOG.md`. Record the initial pass/fail state of every target in `PLANS.md`.

### Phase 1-N: Iterative Optimization (repeat until all targets pass)

For each cycle:

1. **Identify**: From the latest measurement data, identify the single dominant bottleneck preventing the most impactful unmet target. Use the bottleneck taxonomy from the research report (B1-B5) and the ranked solution options (B1-O1 through B5-O5).

2. **Plan**: Write the `Next cycle` section in `PLANS.md` citing:
   - Which target this addresses (T1-T6)
   - Which bottleneck this is (B1-B5)
   - Which solution option(s) from the research report
   - What specific code changes are planned
   - Expected impact with reasoning

3. **Implement**: Make the smallest coherent change. Rules:
   - One change per cycle (tightly coupled complementary changes like B3-O1 + B3-O2 may be combined)
   - Add regression tests that fail before and pass after
   - Run `npm run test:coverage` and maintain >= 91% branch coverage
   - Run `npm run lint` and `npm run build`
   - Feature-flag where practical for A/B comparison

4. **Measure**: Re-run the full benchmark suite on the same hardware and workload:
   - Pixel 4 + real U64 for T1-T6
   - Docker web for T1, T2
   - Record every metric to `WORKLOG.md` with timestamps

5. **Compare**: Compare before and after across:
   - Wall-clock duration per scenario
   - Peak RSS/PSS
   - JS heap growth
   - Jank count (for UI scenarios)
   - Items/second (for ingest/add)
   - Query latency percentiles (for browse/filter)

6. **Decide**:
   - **Keep** if it produces > 10% improvement on the target metric or crosses a budget threshold, AND does not regress any other metric by > 5%
   - **Discard** if it regresses other metrics or fails to produce meaningful improvement
   - Record decision with data in `WORKLOG.md`
   - Update `PLANS.md` with new status

7. **Protect**: For kept changes, add CI benchmark regression tests (see CI section)

8. **Repeat**: Return to step 1 until all T1-T6 pass

### Stop conditions

- **Success**: All T1-T6 pass on Pixel 4 + real U64. Log final measurements in `WORKLOG.md`.
- **Structural blocker**: If a target cannot be met without changes that violate platform constraints, stability, or maintainability, document the blocker precisely with data in `PLANS.md` and `WORKLOG.md`, including what would be required to unblock it.

---

## CI Benchmark Infrastructure

Build two tiers of CI benchmarks integrated into the existing GitHub Actions workflows.

### Tier A: Per-Build Benchmark (runs on every push and PR)

**Where**: Add a new job `perf-benchmark-quick` in `.github/workflows/android.yaml`, after the `web-unit` job completes.

**What**: Fast, deterministic microbenchmarks plus short Playwright budget tests.

**Implementation**:

1. **Vitest microbenchmarks** (`test/benchmarks/*.bench.ts`):
   - Browse index query on synthetic 60K-entry dataset
   - Playlist repository query on synthetic 60K-entry dataset
   - Trigram search index query
   - Batch insert throughput
   - JSON snapshot parse (until snapshot is replaced)
   - Each benchmark runs 10 iterations
   - Assert: each must complete within a generous CI-safe bound (3x expected)
   - **Hard-fail on regression**

2. **Playwright budget tests** (`playwright/perf/*.spec.ts`):
   - HVSC browse folder query < 4 s (2x the 2 s budget)
   - HVSC filter 60K+ playlist < 4 s (2x the 2 s budget)
   - HVSC ingest from mock < 50 s (2x the 25 s budget)
   - Use the extended mock HVSC provider with a medium-size fixture (1K songs for quick CI)
   - **Hard-fail if > 2x budget. Warn if > 1.5x budget.**

3. **Run command**: `npm run test:bench && npm run test:perf`

4. **Artifact retention**: On failure, upload timing JSON and Playwright traces to `ci-artifacts/perf/`

**CI job structure** (add to `android.yaml`):

```yaml
perf-benchmark-quick:
  name: Perf | Quick benchmarks
  runs-on: ubuntu-latest
  needs: web-unit

  steps:
    - name: Checkout
      uses: actions/checkout@v4
      with:
        ref: ${{ env.CI_SHA }}

    - name: Setup Node.js
      uses: actions/setup-node@v4
      with:
        node-version: 24
        cache: npm

    - name: Install dependencies
      run: npm ci

    - name: Run microbenchmarks
      run: npm run test:bench

    - name: Install Playwright browsers
      run: npx playwright install --with-deps chromium

    - name: Run Playwright perf budgets
      run: npm run test:perf

    - name: Upload perf artifacts
      if: failure()
      uses: actions/upload-artifact@v4
      with:
        name: perf-quick-artifacts
        path: |
          ci-artifacts/perf/**
          test-results/perf/**
```

### Tier B: Nightly Deep Benchmark (runs before nightly fuzzing)

**Where**: Add a new workflow `.github/workflows/perf-nightly.yaml` that triggers on the same `schedule` as `fuzz.yaml` (cron `0 3 * * *`) but runs before the fuzz job, OR add it as a job dependency in `fuzz.yaml` so it completes before fuzzing starts.

**What**: Full Playwright benchmark suite against a full-size mock HVSC fixture in Docker, with generous budgets.

**Implementation**:

1. **Full-size mock HVSC provider**: Start the mock provider serving the full HVSC archive fixture at 5 MiB/s

2. **Full scenario suite** (S1-S11 on Docker web):
   - S1: Download from mock at 5 MiB/s — assert < 40 s (2x budget)
   - S2: Ingest all songs — assert < 50 s (2x budget)
   - S3-S5: Browse traversal — assert < 4 s per step (2x budget)
   - S6: Add all to playlist — record timing, no hard fail (establish trend)
   - S7: Render 60K+ playlist — assert < 2 s first visible item
   - S8-S10: Filter operations — assert < 4 s (2x budget)
   - S11: Playback start — assert < 2 s (2x budget)
   - Each scenario runs 3 times minimum

3. **Memory and resource budgets**:
   - Docker container limited to 512 MiB RAM, 2 CPUs (matching existing `web.yaml` constraints)
   - Assert no OOM events
   - Record peak memory from Docker telemetry

4. **Telemetry**: Use existing Docker telemetry infrastructure from `web.yaml` (monitor_docker.sh, summarize_metrics.py, render_charts.py)

5. **Regression detection**:
   - **Hard-fail** if any scenario exceeds 2x its target budget
   - **Warn** (GitHub Actions annotation) if any scenario exceeds 1.5x
   - **Trend tracking**: Store timing summaries as artifacts; compare against rolling average of last 5 green runs

6. **Scheduling**: Must complete before nightly fuzzing starts. Either:
   - Schedule at `0 2 * * *` (1 hour before fuzz at `0 3 * * *`), or
   - Add as a `needs` dependency of the fuzz job

**CI job structure** (new file `.github/workflows/perf-nightly.yaml`):

```yaml
name: perf-nightly

on:
  schedule:
    - cron: "0 2 * * *"
  workflow_dispatch:

jobs:
  perf-nightly:
    name: Perf | Nightly deep benchmark
    runs-on: ubuntu-latest
    timeout-minutes: 30

    steps:
      - name: Checkout
        uses: actions/checkout@v4

      - name: Setup Node.js
        uses: actions/setup-node@v4
        with:
          node-version: 24
          cache: npm

      - name: Install dependencies
        run: npm ci

      - name: Install Playwright browsers
        run: npx playwright install --with-deps chromium

      - name: Cache HVSC fixture
        uses: actions/cache@v4
        with:
          path: .cache/hvsc
          key: hvsc-fixture-${{ runner.os }}

      - name: Start Docker telemetry monitor
        # ... (follow web.yaml pattern) ...

      - name: Run nightly perf suite
        run: npm run test:perf:nightly

      - name: Stop Docker telemetry monitor
        if: always()
        # ... (follow web.yaml pattern) ...

      - name: Summarize telemetry
        if: always()
        # ... (follow web.yaml pattern) ...

      - name: Upload perf artifacts
        if: always()
        uses: actions/upload-artifact@v4
        with:
          name: perf-nightly-artifacts
          path: |
            ci-artifacts/perf/**
            test-results/perf/**
```

### CI failure semantics

| Tier | Trigger | Failure action |
|------|---------|---------------|
| Tier A microbenchmarks | Every push/PR | Hard-fail: blocks merge |
| Tier A Playwright budgets | Every push/PR | Hard-fail if > 2x budget |
| Tier B nightly scenarios | Nightly before fuzz | Hard-fail if > 2x budget |
| Tier B trend regression | Nightly | Warn annotation if > 20% regression over 5 runs |

---

## Research Report Reference

All bottleneck IDs, solution options, scenario definitions, instrumentation plans, and grading criteria are defined in:

```
docs/research/hvsc/performance/hvsc-performance-research-report-2026-04-05.md
```

Read this document in full before starting Phase 0. Reference its specific sections:

- **Section 2** (Codebase Archaeology): File inventory and data scale
- **Section 3** (Architecture Map): Current flow diagrams and hotspots
- **Section 4** (Target Budgets): Budget breakdowns
- **Section 6** (Benchmark Scenarios): S1-S11 definitions with preconditions
- **Section 7** (Instrumentation Plan): Timing mark naming, Perfetto configs, SQL queries
- **Section 8** (Artifact Layout): Directory structure for measurement artifacts
- **Section 9** (Bottleneck Taxonomy): B1-B5 with codebase evidence
- **Section 10** (Solution Options): B1-O1 through B5-O5 with grading tables
- **Section 12** (Ranked Options): Top 3 per bottleneck with implementation order
- **Section 13** (Overall Top 3): Cross-bottleneck priority ranking
- **Section 14** (Optimization Loop): The 9-step loop this prompt enforces
- **Section 15** (CI Strategy): Three-tier regression approach
- **Section 16** (Open Questions): Risks that may block progress

The research report's recommended implementation order (from Section 12) is:

1. **B1-O2** (native checksum method) as quick win, then **B1-O1** (native streaming download)
2. **B3-O2** (pre-sorted folder rows) first, then **B3-O1** (IndexedDB browse store), then **B3-O3** (LRU cache)
3. **B2-O2** (batch filesystem writes) then **B2-O3** (pre-sorted index during ingest)
4. **B4-O2** (streaming batch insert) then **B4-O3** (trigram filter index)
5. **B5-O1** (persist metadata at ingest) and **B5-O5** (playback timing marks)

This order is a starting hypothesis. Override it if baseline measurements reveal a different bottleneck ranking.

---

## Hardware and Environment

### Pixel 4 (primary target)
- Connected over ADB
- Android 12+ (verify API level at start)
- App package: `uk.gleissner.c64commander`
- Debug build with WebView debugging enabled
- Perfetto CLI available via `adb shell perfetto`
- Existing telemetry: `ci/telemetry/android/monitor_android.sh`

### Real U64 device
- Reachable at hostname `u64` or `c64u`
- Probe both at `http://u64/v1/info` and `http://c64u/v1/info` at start
- Prefer `u64` if both respond
- Record which host was used in `WORKLOG.md`
- Required for download scenarios (mock provider serves HVSC, U64 is the playback target)

### Docker web (secondary target)
- Build and run using existing `web/Dockerfile`
- Constrain: 512 MiB RAM, 2 CPUs (matching CI)
- Use for T1, T2 validation and all CI benchmark scenarios

---

## Constraints

1. **No shortcuts**: Do not skip measurements, do not guess at bottlenecks, do not batch changes
2. **Data-driven only**: Every decision in `PLANS.md` must cite measured data from `WORKLOG.md`
3. **Regression coverage**: Every kept change must have regression tests (>= 91% branch coverage)
4. **Existing conventions**: Follow `.github/copilot-instructions.md` and `CLAUDE.md`
5. **No dead code**: Remove old paths when they are fully replaced
6. **Honest reporting**: If a measurement fails or produces unexpected results, record it as-is. Do not cherry-pick runs.
7. **One bottleneck at a time**: Do not attempt to fix multiple bottleneck categories in a single cycle

---

## Completion Criteria

The task is complete when:

1. All six targets (T1-T6) pass on Pixel 4 + real U64 with measured evidence in `WORKLOG.md`
2. CI Tier A (per-build) benchmarks are green on the main branch
3. CI Tier B (nightly) benchmarks are green
4. `PLANS.md` shows all targets as PASS with final measurements
5. `WORKLOG.md` contains the complete chronological record of the convergence process
