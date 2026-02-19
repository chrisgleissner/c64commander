# PLANS: End-to-End Production Readiness Research Audit

## Scope
Deep research-only audit of C64 Commander for performance, reliability, memory, rendering, network efficiency, playback robustness, HVSC ingest resilience, test/CI coverage, and architecture/concurrency risk. No production code edits are permitted.

## Evidence Rules
- Primary runtime evidence must come from Android device `SM_N9005` on serial `2113b87f`.
- User-requested serial `2113B87f` is case-variant; adb resolves only lowercase serial in this environment.
- All adb/logcat/install/instrumentation commands must explicitly include `-s 2113b87f`.
- No evidence from Samsung S21 FE (`R5CRC3ZY9XH`) or emulator is admissible for runtime findings.

## Deliverables
1. `PLANS.md` (this file): authoritative execution state.
2. `doc/research/review-4/PRODUCTION_RESEARCH_AUDIT.md`: full final report with 100+ uniquely identified issues (`C64C-001`+).
3. Supporting raw artifacts under `doc/research/review-4/`:
   - `artifacts/`
   - `logs/`
   - `metrics/`
   - `tables/`
   - `screenshots/`

## Phase Plan

### Phase 1 - Build and Deployment Validation
Status: `in_progress`
- Build latest codebase and Android debug APK.
- Install on `2113b87f`.
- Verify installed version/build identity.
- Determine whether dynamic animation-reduction exists and capture evidence.
- Measure cold start and warm start with timestamps/logcat markers.

### Phase 2 - Startup Performance Profiling
Status: `pending`
- Measure time to first meaningful interaction.
- Measure time to home page interactive.
- Capture startup logcat.
- Identify synchronous startup blockers and bridge initialization weight.
- Detect redundant startup REST traffic.

### Phase 3 - High-Value Interactive Exploration
Status: `pending`
- Derive interaction routes from Playwright + Maestro coverage.
- Execute scripted tap/swipe/navigation loops on device.
- Stress Home/Play/Disks/Config/Settings/Docs.
- Exercise expand/collapse, sliders, repeated tab switching, config/disks ping-pong.
- Observe lag, frame pacing symptoms, pressed-state persistence, delayed overlays, REST bursts.

### Phase 4 - Network and REST Behaviour Analysis
Status: `pending`
- Quantify requests on Config entry, panel expand/collapse, Disks<->Config switching.
- Detect duplicate/idempotent bursts and call rates.
- Evaluate lazy-loading and cache usage effectiveness.

### Phase 5 - Animation and Rendering Analysis
Status: `pending`
- Evaluate collapsible animation lag, slider latency, page transition smoothness.
- Validate dynamic animation reduction behavior (if implemented).
- Record frame pacing indicators and main-thread stall evidence.

### Phase 6 - Music Playback Reliability
Status: `pending`
- Validate autoplay progression behavior.
- Lock/unlock and background reliability checks.
- Assess audio focus, media session, foreground service/wakelock handling.

### Phase 7 - HVSC Download and Ingest Robustness
Status: `pending`
- Observe download/ingest memory pressure.
- Inspect partial download, resume, and concurrency/backpressure behavior.
- Capture OOM/ANR/error patterns where present.

### Phase 8 - Memory and Resource Profiling
Status: `pending`
- Collect heap/native memory, CPU sampling, GC activity across idle and stress scenarios.
- Compare startup/navigation/playback/HVSC ingest footprints.
- Identify leak indicators and repeated listener/subscription buildup.

### Phase 9 - Test Coverage and CI Gaps
Status: `pending`
- Audit unit/integration/E2E/Maestro/native coverage.
- Identify missing real-device lifecycle and stress scenarios.
- Run coverage and map blind spots to production risks.

### Phase 10 - Architecture and Concurrency Audit
Status: `pending`
- Review event/state architecture, lifecycle boundaries, bridge call frequency, render cascades, debounce/throttle correctness.
- Classify systemic risks and coupling hotspots.

### Phase 11 - Consolidation and Prioritization
Status: `pending`
- Produce `PRODUCTION_RESEARCH_AUDIT.md` with:
  - Executive summary, methodology, tooling, environment
  - Phase findings
  - 100+ issues with required fields and evidence
  - Severity/effort matrix, risk heatmap, top-20 remediation candidates
  - Anti-patterns, systemic architecture risks
  - Test expansion and instrumentation recommendations

## Progress Log
- 2026-02-19: Plan initialized for full audit execution.
- 2026-02-19: User requirement updated: place all research findings under `doc/research/review-4/`.
