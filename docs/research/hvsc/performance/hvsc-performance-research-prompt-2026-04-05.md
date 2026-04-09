# HVSC Performance Research Prompt

Use this prompt for the next research-only pass on HVSC performance. This prompt is intentionally strict so the output stays evidence-driven and implementation-ready.

## Prompt

ROLE

You are a staff-level performance engineer specializing in Capacitor applications across Android, web, and iOS, with deep expertise in Android system tracing, WebView profiling, browser performance tooling, memory analysis, large-list architecture, and iterative measurement-driven optimization.

This is a research and benchmark-design task.
It is not an optimization implementation task.
Do not make product changes except, if absolutely necessary, narrowly scoped measurement or instrumentation changes that are directly required to collect trustworthy performance data.

OBJECTIVE

Create a highly structured research document in `docs/research/hvsc/performance/` that defines how to measure, analyze, and then iteratively improve the HVSC workflow in C64 Commander.

The scope includes:

- HVSC download
- HVSC ingest/index build
- HVSC add-items browsing and traversal
- add-all-to-playlist behavior
- large-playlist interaction and filtering
- playback start latency for filtered HVSC results

The main target platforms are:

- Android on a real ADB-connected Pixel 4 as the primary proof target
- Docker-backed web as the secondary proof target
- iOS as a lower-priority research lane for low-hanging fruit and tooling guidance only

This must be a fact-driven plan.
No hand-waving.
No generic "this may help" language.
Every recommendation must be tied either to codebase evidence, tool capability, or a specific measurement that will validate or falsify it.

NON-FUNCTIONAL TARGETS

Design the research and later optimization loop around these hard targets:

- Download the full HVSC archive from a throttled mock provider at 5 MiB/s in less than 20 seconds.
- Ingest all 60,582+ songs in less than 25 seconds.
- Any add-items traversal step, including moving down into folders or back up to root, must complete in less than 2 seconds worst case, with a practical P50 target below 1 second on the Pixel 4.
- Filtering a very large playlist must complete in less than 2 seconds worst case, ideally below 1 second.
- The architecture must scale to 100,000 playlist items without requiring full in-memory hydration on Pixel 4 or Raspberry Pi Zero 2W-class web targets.

MOCK DATA REQUIREMENT

Do not plan around repeated downloads from the real HVSC host.

Your research output must define a local mock HVSC provider that:

- serves a fixed archive fixture from disk,
- throttles transfer to 5 MiB/s,
- works for both Android and Docker-backed web,
- exposes enough logging and counters to confirm the network is not the bottleneck,
- can be reused for repeated before/after benchmarks.

AUTHORITATIVE INPUTS

Read and use, at minimum, these repository areas:

1. `.github/copilot-instructions.md`
2. `AGENTS.md`
3. `README.md`
4. `docs/testing/maestro.md`
5. `src/lib/hvsc/`
6. `src/pages/playFiles/`
7. `src/lib/playlistRepository/`
8. `playwright/`
9. `.maestro/`
10. `ci/telemetry/android/`
11. existing docs under `docs/research/hvsc/`

Also perform external research on free tools and best practices for:

- Perfetto CLI and Perfetto UI
- Perfetto Trace Processor SQL workflows
- FrameTimeline and Android jank attribution
- Android Studio CPU and memory profiling
- `adb`-based memory and graphics tools
- Chrome DevTools performance and memory profiling
- remote debugging Android WebViews via `chrome://inspect`
- Maestro capabilities and limits for performance testing
- Playwright capabilities and limits for performance assertions
- iOS Instruments and command-line-friendly workflows available free with Xcode

You must use only free tooling.

RESEARCH DELIVERABLES

Produce one main report in `docs/research/hvsc/performance/`. The report must contain all of the following sections.

1. Executive summary
2. Codebase archaeology
3. Current architecture map for download, ingest, browse, add, filter, and playback
4. Measurement goals and target budgets
5. Recommended profiling toolchain by platform and by problem type
6. Exact benchmark scenarios to run on Pixel 4, emulator, and Docker web
7. Required instrumentation plan
8. Artifact plan and directory layout
9. Bottleneck taxonomy
10. For each bottleneck, at least five concrete solution options
11. A grading rubric for those solutions
12. A ranked top three for each bottleneck
13. An overall ranked top three across the whole system
14. A step-by-step iterative optimization loop for later implementation passes
15. CI regression strategy for performance
16. Open questions and validation risks

MEASUREMENT DESIGN REQUIREMENTS

Your plan must separate measurement into layers.

### Layer 1: App-level instrumentation

Define how to add or extend structured timing around:

- archive download start and finish
- cache write
- checksum generation
- archive extraction
- song metadata parsing
- songlength parsing
- browse index build
- add-items open
- folder traversal
- recursive add
- playlist bulk insert
- playlist filter query
- playlist render update
- playback start

Specify naming conventions for timing marks and how the data should be persisted.

### Layer 2: Android system tracing on Pixel 4

Define how to capture Perfetto traces over `adb` for each benchmark scenario.

The plan must cover:

- scheduling and CPU behavior
- process stats and memory counters
- frame/jank analysis with FrameTimeline where supported
- app-visible trace sections for native and UI hotspots
- how to post-process traces with `trace_processor`

Do not stop at "capture a Perfetto trace". Define what to capture, why, and how to extract decision-useful metrics from it.

### Layer 3: Android drill-down profiling

Define when to use Android Studio CPU profiler, Java/Kotlin method tracing, native sampling, heap dumps, and `dumpsys`/`gfxinfo` instead of or in addition to Perfetto.

### Layer 4: Web and Android WebView profiling

Define how to profile:

- Docker-backed web in desktop Chrome
- Capacitor Android WebView via remote debugging

The plan must include:

- flame charts
- long tasks
- layout/rendering work
- memory inspection
- saved performance traces
- when Playwright is sufficient and when it is not

### Layer 5: Automation and reproducibility

Define how Maestro and Playwright should drive the benchmark scenarios.

Important:

- Maestro may drive the real-device flow, but it is not the profiler.
- Playwright may enforce wall-clock budgets and reproducible web flows, but it is not the low-level profiler.

BENCHMARK MATRIX REQUIREMENTS

Define an explicit matrix with at least these targets:

1. Pixel 4 real device, real app, mock HVSC provider, real U64 reachable at hostname `u64`
2. Android emulator fast-turnaround lane with resource constraints roughly comparable to Pixel 4
3. Docker-backed web lane for browser/runtime analysis

For each scenario, define:

- preconditions
- warm-up behavior
- number of runs
- artifact capture
- exact success metrics
- exact failure signatures

SOLUTION ANALYSIS REQUIREMENTS

For each bottleneck you identify, list at least five different solution options.

For each option, grade it on at least:

- expected impact
- confidence
- engineering effort
- risk
- reversibility
- Android benefit
- web benefit
- iOS benefit

Then rank the best three options for that bottleneck and explain why.

After that, produce an overall top-three ranking across all bottlenecks.

ITERATIVE OPTIMIZATION LOOP REQUIREMENTS

You must define a later implementation loop that works like this:

1. capture baseline
2. pick one bottleneck
3. pick one improvement
4. implement it
5. remeasure on the same workload
6. keep it only if the data shows a meaningful win
7. otherwise rework or discard it
8. add regression protection for the win
9. repeat

This loop must explicitly forbid batching multiple major optimizations together before remeasurement.

CI REQUIREMENTS

Your report must define a pragmatic CI strategy that acknowledges limited CI hardware control.

The CI plan must distinguish between:

- what can be asserted in CI with synthetic or reduced-size workloads,
- what can be measured in CI and only trended rather than hard-failed,
- what must remain a Pixel 4 proof step outside CI.

The CI section must include at least:

- repository/query microbench ideas
- Playwright wall-clock budget checks
- Maestro-driven coarse Android flow timing
- artifact retention for failures
- how to avoid flaky absolute-time gates on noisy CI hosts

OUTPUT QUALITY BAR

Your report must be specific enough that another engineer could begin implementing the measurement harness from it immediately.

That means:

- concrete commands where appropriate
- concrete artifact names and directory suggestions
- concrete metric names
- concrete benchmark scenarios
- concrete ranking criteria
- clear separation between measured facts, repo-backed observations, and hypotheses

Do not write a generic performance essay.
Write an execution-grade research document.

STOP CONDITIONS

Do not finish until the report includes:

- a concrete Pixel 4 tracing plan,
- a concrete Docker web profiling plan,
- a throttled mock HVSC provider plan,
- at least five solution options per bottleneck,
- ranking logic and top-three selections,
- a later optimization loop,
- and a CI regression strategy.

If a certain platform or tool cannot be exercised from the current environment, state that precisely, but still document the strongest feasible plan for it.
