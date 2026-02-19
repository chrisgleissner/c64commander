# Review 4 Rollout Execution Plan

## 1. Scope and Source of Truth
- Primary input: `doc/research/review-4/PRODUCTION_RESEARCH_AUDIT.md`.
- This plan covers all identified issues `C64C-001` through `C64C-110`.
- This plan is execution-oriented: every task and issue is trackable, evidence-backed, and gated.

## 2. Required Reading Before Starting Work
- Any LLM or engineer must read the following files before making changes:
  - `doc/research/review-4/PRODUCTION_RESEARCH_AUDIT.md`
  - `doc/research/review-4/ROLLOUT_EXECUTION_PLAN.md`
  - `doc/research/review-4/rollout-artifacts/README.md`
  - `PLANS.md`
  - `AGENTS.md`
  - `.github/copilot-instructions.md`
- Work must not start until the pre-read is logged in the journal.
- Work must not start unless the pre-read journal row explicitly confirms every file in this list was read.
- Required pre-read journal row fields:
  - reader/owner
  - UTC timestamp
  - files read
  - current phase and first intended task
  - open risks or blockers at start

## 3. Issue Familiarization Reading Map
- Use this map after pre-read to quickly load the right evidence for each issue range.
- Read order for any issue:
  - find issue row in `doc/research/review-4/PRODUCTION_RESEARCH_AUDIT.md`,
  - load matching map row below,
  - read listed artifacts before coding or validating.
- Real-device runtime evidence is in review-4 artifacts captured from the Note 3 session; prioritize those files before inferring behavior from code.

| Issue Scope | Primary Context | Real-Device Logs and Runtime Artifacts | Supporting Metrics and Summaries | Code and Architecture Deep Dive |
|---|---|---|---|---|
| `C64C-001..C64C-015` (startup, bootstrap, early rendering) | `doc/research/review-4/PRODUCTION_RESEARCH_AUDIT.md`, section 5 and section 6 Phase 1/2 | `doc/research/review-4/artifacts/startup-cold/startup-loop-1.logcat.txt`, `doc/research/review-4/artifacts/startup-cold/startup-loop-4.logcat.txt`, `doc/research/review-4/artifacts/startup-derived/cold-1.logcat.txt`, `doc/research/review-4/artifacts/startup-derived/warm-6.logcat.txt` | `doc/research/review-4/metrics/phase1-startup-summary.txt`, `doc/research/review-4/metrics/phase2-startup-warning-counts.txt`, `doc/research/review-4/metrics/phase2-startup-metrics-derived.json`, `doc/research/review-4/metrics/phase2-startup-errors-highlight.txt` | `doc/research/review-4/artifacts/phase10-App.tsx.nl.txt`, `doc/research/review-4/artifacts/phase10-c64api-head.nl.txt` |
| `C64C-003` (cookie/null warning coupling) | `doc/research/review-4/PRODUCTION_RESEARCH_AUDIT.md` issue row `C64C-003` | `doc/research/review-4/artifacts/startup-cold/startup-loop-4.logcat.txt`, `doc/research/review-4/artifacts/startup-derived/warm-6.logcat.txt` | `doc/research/review-4/metrics/phase2-cookie-null-correlation.tsv`, `doc/research/review-4/metrics/phase2-cookie-null-correlation.json`, `doc/research/review-4/metrics/phase2-cookie-set-signals.txt` | `doc/research/review-4/artifacts/phase10-c64api-head.ts.txt` |
| `C64C-016..C64C-070` (network duplication, invalidation, caching) | `doc/research/review-4/PRODUCTION_RESEARCH_AUDIT.md`, section 6 Phase 4 | `doc/research/review-4/artifacts/phase4-trace-sample-navigation-boundaries.json` | `doc/research/review-4/metrics/phase4-duplicate-totals.json`, `doc/research/review-4/metrics/phase4-route-rollup.json`, `doc/research/review-4/metrics/phase4-route-derived.tsv`, `doc/research/review-4/metrics/phase4-home-top-endpoints.tsv` | `doc/research/review-4/artifacts/phase10-App.tsx.nl.txt`, `doc/research/review-4/artifacts/phase10-useC64Connection.nl.txt`, `doc/research/review-4/artifacts/phase10-ConnectionController.nl.txt`, `doc/research/review-4/metrics/phase10-query-invalidation-signals.txt`, `doc/research/review-4/metrics/phase10-cache-query-signals.txt` |
| `C64C-071..C64C-085` (device interaction blockers, rendering/UX evidence gaps) | `doc/research/review-4/PRODUCTION_RESEARCH_AUDIT.md`, section 6 Phase 3/5 | `doc/research/review-4/artifacts/phase3-uidump.xml`, `doc/research/review-4/artifacts/phase3-uidump-after-unlock.xml`, `doc/research/review-4/artifacts/phase5-gfxinfo.txt`, `doc/research/review-4/artifacts/phase5-gfxinfo-head.txt` | `doc/research/review-4/metrics/phase3-keyguard-blocker-summary.txt`, `doc/research/review-4/metrics/phase3-window-focus-after-unlock-attempt.txt`, `doc/research/review-4/metrics/window-focus-keyguard.txt`, `doc/research/review-4/metrics/phase5-gfxinfo-summary.txt` | `doc/research/review-4/artifacts/phase3-tabbar-source.txt`, `doc/research/review-4/artifacts/phase3-common-navigation-subflow.yaml` |
| `C64C-086..C64C-095` (playback/background reliability) | `doc/research/review-4/PRODUCTION_RESEARCH_AUDIT.md`, section 6 Phase 6 | `doc/research/review-4/artifacts/phase8-app-pid-logcat.txt` | `doc/research/review-4/metrics/phase6-bgexec-usage.txt`, `doc/research/review-4/metrics/phase6-playback-bridge-grep.txt`, `doc/research/review-4/metrics/phase6-ios-playback-grep.txt`, `doc/research/review-4/metrics/phase6-ios-background-config-grep.txt` | `doc/research/review-4/artifacts/phase6-BackgroundExecutionService.nl.txt`, `doc/research/review-4/artifacts/phase6-BackgroundExecutionPlugin.nl.txt`, `doc/research/review-4/artifacts/phase6-ios-BackgroundExecutionPlugin.swift.txt`, `doc/research/review-4/artifacts/phase6-backgroundExecution.web.nl.txt`, `doc/research/review-4/artifacts/phase6-useSidPlayer.nl.txt` |
| `C64C-096..C64C-103` (HVSC robustness) | `doc/research/review-4/PRODUCTION_RESEARCH_AUDIT.md`, section 6 Phase 7 | `doc/research/review-4/logs/phase7-android-hvsc-tests.log` | `doc/research/review-4/metrics/phase7-hvsc-test-failure-signals.txt`, `doc/research/review-4/metrics/phase7-hvsc-code-signals.txt`, `doc/research/review-4/metrics/phase7-hvsc-files-android.txt`, `doc/research/review-4/metrics/phase7-hvsc-files-src.txt` | `doc/research/review-4/artifacts/phase7-hvscDownload.ts.txt`, `doc/research/review-4/artifacts/phase7-hvscIngestionRuntime.ts.txt`, `doc/research/review-4/artifacts/phase7-hvscIngestionRuntime-1.nl.txt`, `doc/research/review-4/artifacts/phase7-hvscIngestionRuntime-2.nl.txt`, `doc/research/review-4/artifacts/phase7-hvscIngestionRuntime-3.nl.txt` |
| `C64C-104..C64C-105` (memory/resource profile drift) | `doc/research/review-4/PRODUCTION_RESEARCH_AUDIT.md`, section 6 Phase 8 | `doc/research/review-4/artifacts/phase8-memory-cpu/meminfo-cold-1.txt`, `doc/research/review-4/artifacts/phase8-memory-cpu/meminfo-warm-10.txt`, `doc/research/review-4/artifacts/phase8-gc-logcat.txt` | `doc/research/review-4/metrics/phase8-memory-cpu-summary.json`, `doc/research/review-4/metrics/phase8-memory-cpu-samples.csv`, `doc/research/review-4/metrics/phase8-gc-signals.txt`, `doc/research/review-4/metrics/phase8-app-logcat-signals.txt` | `doc/research/review-4/metrics/phase10-listeners-signals.txt`, `doc/research/review-4/metrics/phase10-timers-signals.txt` |
| `C64C-106..C64C-109` (coverage and CI confidence) | `doc/research/review-4/PRODUCTION_RESEARCH_AUDIT.md`, section 6 Phase 9 | `doc/research/review-4/logs/phase9-test-coverage.log` | `doc/research/review-4/metrics/phase9-coverage-summary-signals.txt` | `doc/research/review-4/artifacts/phase10-c64api-core-retry.nl.txt`, `doc/research/review-4/artifacts/phase10-useC64Connection.ts.txt`, `doc/research/review-4/artifacts/phase6-useSidPlayer.tsx.txt`, `doc/research/review-4/artifacts/phase7-hvscIngestionRuntime.ts.txt` |
| `C64C-110` (connection architecture and concurrency complexity) | `doc/research/review-4/PRODUCTION_RESEARCH_AUDIT.md` issue row `C64C-110` and section 12 | `doc/research/review-4/metrics/phase3-keyguard-blocker-summary.txt` | `doc/research/review-4/metrics/phase10-concurrency-signals.txt`, `doc/research/review-4/metrics/phase10-timers-signals.txt`, `doc/research/review-4/metrics/phase10-listeners-signals.txt`, `doc/research/review-4/metrics/phase10-error-handling-signals.txt` | `doc/research/review-4/artifacts/phase10-connectionManager.nl.txt`, `doc/research/review-4/artifacts/phase10-ConnectionController.nl.txt`, `doc/research/review-4/artifacts/phase10-useC64Connection.nl.txt` |
| Build/deploy/environment provenance (cross-cutting) | `PLANS.md`, `doc/research/review-4/PRODUCTION_RESEARCH_AUDIT.md`, section 2 | `doc/research/review-4/logs/phase1-adb-install-corrected.log`, `doc/research/review-4/logs/phase1-gradle-assembleDebug.log` | `doc/research/review-4/metrics/environment.txt`, `doc/research/review-4/metrics/device-summary-2113b87f.txt`, `doc/research/review-4/metrics/device-getprop-2113b87f.txt`, `doc/research/review-4/metrics/device-list-adb.txt` | `doc/research/review-4/logs/commands-run.md` |

## 4. Operating Mode for Any LLM or Engineer
- Default mode is continue: advance through phases and tasks as far as safely possible in the current session.
- Do not cut corners to preserve momentum.
- If context pressure is detected (low context budget, unclear state, or risk of shallow edits), stop and hand off.
- Stopping is required when quality would degrade; stopping is not failure.
- Before stopping, append a handoff row in the journal with exact next action and blocking context.

## 5. Non-Negotiable Tick-Off Rules
- A task checkbox may be ticked only after all required proof fields are filled.
- An issue checkbox may be ticked only after:
  - linked task(s) are ticked,
  - a journal entry exists,
  - proof artifacts are linked,
  - verification is recorded.
- No phase may be marked complete if any mapped issue remains unticked.
- Every fix must include before/after evidence.

## 6. Proof Requirements Before Tick-Off
- Required proof bundle per task:
  - Change summary (what changed and why).
  - Validation commands and outputs.
  - Before/after metrics or behavior evidence.
  - Linked artifacts under `doc/research/review-4/`.
  - Journal row ID referencing the task.
- Recommended artifact layout:
  - `doc/research/review-4/rollout-artifacts/<phase>/<task>/...`

## 7. Phase Plan and Task Checklists

### Phase 0 - Kickoff and Control Plane
- Objective: establish execution hygiene and evidence discipline.
- [ ] `P0-T1` Create rollout artifact directories and naming conventions.
- [ ] `P0-T2` Seed journal IDs and owners for first execution wave.
- [ ] `P0-T3` Confirm environment reproducibility checklist (device, build, test commands).
- Exit criteria:
  - [ ] Journal contains kickoff baseline entry.
  - [ ] Artifact paths are defined and used.

### Phase 1 - Baseline Reproduction and Instrumentation Guardrails
- Objective: lock reproducible baselines before code changes.
- [ ] `P1-T1` Capture startup/network/memory/playback baseline reruns.
- [ ] `P1-T2` Validate instrumentation completeness for startup, route, and playback milestones.
- [ ] `P1-T3` Freeze baseline KPI sheet for comparison in later phases.
- Exit criteria:
  - [ ] Baseline KPIs recorded.
  - [ ] Evidence links added to journal.

### Phase 2 - Startup, Bootstrap, and Early Rendering Stability
- Issue scope: `C64C-001` to `C64C-015`.
- [ ] `P2-T1` Reduce startup blocking work and first interaction delay (`C64C-001`,`C64C-002`,`C64C-007`,`C64C-012`,`C64C-013`).
- [ ] `P2-T2` Resolve startup plugin and filesystem error churn (`C64C-004`,`C64C-005`,`C64C-006`,`C64C-010`).
- [ ] `P2-T3` Address cookie/null warning flood and logging noise (`C64C-003`,`C64C-011`).
- [ ] `P2-T4` Implement startup payload and motion controls strategy (`C64C-014`,`C64C-015`).
- Exit criteria:
  - [ ] Startup median and variance improved against baseline.
  - [ ] Startup warning density reduced with no hidden failures.

### Phase 3 - Network Efficiency, Caching, and Invalidation Discipline
- Issue scope: `C64C-016` to `C64C-070`.
- [ ] `P3-T1` Implement in-flight dedupe and request budget controls (`C64C-016`,`C64C-022`,`C64C-030`).
- [ ] `P3-T2` Replace broad invalidations with targeted invalidation maps (`C64C-024`,`C64C-025`,`C64C-026`,`C64C-027`,`C64C-029`).
- [ ] `P3-T3` Centralize and rate-govern info/config polling (`C64C-017` to `C64C-023`,`C64C-028`).
- [ ] `P3-T4` Eliminate endpoint-level redundant config polling (`C64C-031` to `C64C-070`).
- Exit criteria:
  - [ ] Duplicate request rate reduced versus baseline.
  - [ ] Route-level call budgets enforced and verified.

### Phase 4 - Device Interaction, Rendering, and UX Harness Hardening
- Issue scope: `C64C-071` to `C64C-085`.
- [ ] `P4-T1` Establish deterministic unlock and app-focus preflight for device automation (`C64C-071`,`C64C-072`,`C64C-085`).
- [ ] `P4-T2` Re-run blocked interaction benchmarks on unlocked device (`C64C-073` to `C64C-080`).
- [ ] `P4-T3` Improve evidence completeness and reproducibility logs (`C64C-081` to `C64C-084`).
- Exit criteria:
  - [ ] All previously blocked interaction scenarios executed end-to-end.
  - [ ] Rendering and latency metrics reflect visible app frames.

### Phase 5 - Playback and Background Reliability Across Platforms
- Issue scope: `C64C-086` to `C64C-095`.
- [ ] `P5-T1` Close iOS and web background execution parity gaps (`C64C-086`,`C64C-087`).
- [ ] `P5-T2` Harden Android background lifecycle, wake lock, and idle policy (`C64C-088`,`C64C-089`,`C64C-093`).
- [ ] `P5-T3` Add native media session and audio focus lifecycle handling (`C64C-090`,`C64C-091`).
- [ ] `P5-T4` Improve error surfacing and legacy playback path isolation (`C64C-092`,`C64C-094`).
- [ ] `P5-T5` Execute lock/unlock playback reliability validation on target device (`C64C-095`).
- Exit criteria:
  - [ ] Playback survives lock/unlock and background transitions.
  - [ ] Cross-platform behavior contracts are explicit and tested.

### Phase 6 - HVSC Download and Ingest Robustness
- Issue scope: `C64C-096` to `C64C-103`.
- [ ] `P6-T1` Stabilize HVSC native test runtime and CI determinism (`C64C-096`).
- [ ] `P6-T2` Remove hard-fail runtime gates and improve fallback capability handling (`C64C-097`).
- [ ] `P6-T3` Reduce archive memory spikes and duplicate allocations (`C64C-098`,`C64C-099`).
- [ ] `P6-T4` Harden ingestion state ownership, error reporting, and listener lifecycle (`C64C-100` to `C64C-103`).
- Exit criteria:
  - [ ] HVSC tests pass reliably.
  - [ ] Large ingest paths are bounded and cancellation-safe.

### Phase 7 - Memory and Runtime Resource Stabilization
- Issue scope: `C64C-104` to `C64C-105`.
- [ ] `P7-T1` Resolve warm-state memory growth regressions (`C64C-104`).
- [ ] `P7-T2` Stabilize thread lifecycle and ownership (`C64C-105`).
- Exit criteria:
  - [ ] Warm-state memory and thread counts remain within defined budgets.

### Phase 8 - Test and CI Confidence Expansion
- Issue scope: `C64C-106` to `C64C-109`.
- [ ] `P8-T1` Raise and enforce branch coverage safety margins (`C64C-106`).
- [ ] `P8-T2` Expand trace comparison branch scenario coverage (`C64C-107`).
- [ ] `P8-T3` Add deterministic HVSC branch and fault-injection tests (`C64C-108`).
- [ ] `P8-T4` Expand playback fallback path coverage (`C64C-109`).
- Exit criteria:
  - [ ] Coverage thresholds and hotspot gates are green and durable.

### Phase 9 - Architecture and Concurrency Simplification
- Issue scope: `C64C-110` plus residual architectural debt from earlier phases.
- [ ] `P9-T1` Simplify connection manager state transitions and sticky-lock semantics (`C64C-110`).
- [ ] `P9-T2` Add transition invariants and stress/property-style validation for state machine behavior.
- Exit criteria:
  - [ ] State transitions are deterministic under stress.

### Phase 10 - Final Verification and Release Readiness
- Objective: prove no regression and close remaining checklist debt.
- [ ] `P10-T1` Full regression pass across unit, integration, E2E, device flows, and HVSC scenarios.
- [ ] `P10-T2` Re-run baseline KPIs and produce final before/after scorecard.
- [ ] `P10-T3` Prepare release readiness summary with explicit known-risk list.
- Exit criteria:
  - [ ] All mapped issues are ticked with proof.
  - [ ] Final summary approved.

## 8. Mandatory Execution Journal (Fill Before Tick-Off)

### Journal Rules
- Add one row per meaningful change set.
- Include exact issue IDs and task IDs.
- Include proof links. No proof link means no checkbox tick.
- Use monotonically increasing journal IDs: `J-YYYYMMDD-###`.
- Keep the journal in real time; update immediately after each meaningful change batch.
- Do not backfill large spans of work at the end of a session.
- Every row must include enough detail for another LLM to continue without re-discovery.

### Change Journal
| Journal ID | Date (UTC) | Owner | Phase-Task | Issue IDs | Change Summary | Validation Commands | Proof Artifacts | Result | Next Step |
|---|---|---|---|---|---|---|---|---|---|
| J-INIT-001 | 2026-02-19 | Unassigned | Plan Creation | C64C-001..C64C-110 | Initial rollout plan created from review-4 audit. | N/A | doc/research/review-4/ROLLOUT_EXECUTION_PLAN.md | Planned | Begin Phase 0 |
| J-INIT-002 | 2026-02-19 | Unassigned | Pre-Read Baseline | Plan-wide | Required reading requirement added to rollout plan. | N/A | doc/research/review-4/ROLLOUT_EXECUTION_PLAN.md | Planned | First executor logs actual pre-read row before task execution |

### Proof Checklist Template (Copy Per Task)
| Task ID | Before Evidence | After Evidence | Automated Tests | Device Validation | Reviewer | Tick Allowed |
|---|---|---|---|---|---|---|
| `<phase-task>` | `<artifact path(s)>` | `<artifact path(s)>` | `<command + output path>` | `<adb/video/log path>` | `<name>` | `No` |

## 9. Issue Closure Register (All Audit Issues)
- Tick the first column only after journal + proof are complete.

| Done | Issue ID | Title | Severity | Effort | Layer | Category | Rollout Phase | Task ID(s) | Journal ID | Proof Artifact(s) |
|---|---|---|---|---|---|---|---|---|---|---|
| [ ] | C64C-001 | Cold startup latency median 2168 ms on Note 3 | High | M | TypeScript | Performance | Phase 2 | P2-T1..P2-T4 |  |  |
| [ ] | C64C-002 | Main-thread startup jank with 96-106 skipped frames | Critical | M | TypeScript | Rendering | Phase 2 | P2-T1..P2-T4 |  |  |
| [ ] | C64C-003 | Capacitor cookie lookups trigger near-1:1 null-string warning flood | High | S | Capacitor bridge | Observability | Phase 2 | P2-T1..P2-T4 |  |  |
| [ ] | C64C-004 | Repeated Filesystem readdir failures at startup | High | S | Capacitor bridge | Reliability | Phase 2 | P2-T1..P2-T4 |  |  |
| [ ] | C64C-005 | Repeated Filesystem readFile missing file errors at startup | High | S | Capacitor bridge | Reliability | Phase 2 | P2-T1..P2-T4 |  |  |
| [ ] | C64C-006 | Diagnostics bridge emits no-listener warnings during startup | Medium | XS | Capacitor bridge | Observability | Phase 2 | P2-T1..P2-T4 |  |  |
| [ ] | C64C-007 | Warm startup request backlog spikes to 49 | High | M | TypeScript | Performance | Phase 2 | P2-T1..P2-T4 |  |  |
| [ ] | C64C-008 | Startup endpoint fetches include config keys before explicit config navigation | Medium | M | Backend API usage | Network | Phase 2 | P2-T1..P2-T4 |  |  |
| [ ] | C64C-009 | Font fetch churn visible in startup traces | Low | S | Device-specific | Performance | Phase 2 | P2-T1..P2-T4 |  |  |
| [ ] | C64C-010 | Startup plugin registration count indicates heavy bridge init | Medium | M | Capacitor bridge | Architecture | Phase 2 | P2-T1..P2-T4 |  |  |
| [ ] | C64C-011 | Observed startup security audit denials in warm loops | Low | S | Device-specific | Observability | Phase 2 | P2-T1..P2-T4 |  |  |
| [ ] | C64C-012 | Cold startup variance up to 174 ms across six runs | Medium | S | TypeScript | Performance | Phase 2 | P2-T1..P2-T4 |  |  |
| [ ] | C64C-013 | First meaningful interaction not directly instrumented | High | M | Observability | Observability | Phase 2 | P2-T1..P2-T4 |  |  |
| [ ] | C64C-014 | Large production JS bundle on constrained device | High | L | Build system | Performance | Phase 2 | P2-T1..P2-T4 |  |  |
| [ ] | C64C-015 | Dynamic animation reduction feature absent beyond CSS media query | Critical | M | TypeScript | Rendering | Phase 2 | P2-T1..P2-T4 |  |  |
| [ ] | C64C-016 | Overall REST duplication rate 78.11 percent | Critical | L | Backend API usage | Network | Phase 3 | P3-T1..P3-T4 |  |  |
| [ ] | C64C-017 | Settings route duplicate rate 88.7 percent | High | M | Backend API usage | Network | Phase 3 | P3-T1..P3-T4 |  |  |
| [ ] | C64C-018 | Config route duplicate rate 80.36 percent | High | M | Backend API usage | Network | Phase 3 | P3-T1..P3-T4 |  |  |
| [ ] | C64C-019 | Home route duplicate rate 78.48 percent | High | M | Backend API usage | Network | Phase 3 | P3-T1..P3-T4 |  |  |
| [ ] | C64C-020 | Disks route duplicate rate 78.51 percent | High | M | Backend API usage | Network | Phase 3 | P3-T1..P3-T4 |  |  |
| [ ] | C64C-021 | Play route duplicate rate 63.51 percent | High | M | Backend API usage | Network | Phase 3 | P3-T1..P3-T4 |  |  |
| [ ] | C64C-022 | Single golden trace burst shows 3730 requests | High | L | Backend API usage | Network | Phase 3 | P3-T1..P3-T4 |  |  |
| [ ] | C64C-023 | GET /v1/info overpolled across all major routes | High | S | Backend API usage | Network | Phase 3 | P3-T1..P3-T4 |  |  |
| [ ] | C64C-024 | Route changes invalidate all c64 queries | High | M | TypeScript | Architecture | Phase 3 | P3-T1..P3-T4 |  |  |
| [ ] | C64C-025 | Visibility change invalidates all c64 queries | High | M | TypeScript | Architecture | Phase 3 | P3-T1..P3-T4 |  |  |
| [ ] | C64C-026 | Connection-change event invalidates all c64 queries | High | S | TypeScript | Network | Phase 3 | P3-T1..P3-T4 |  |  |
| [ ] | C64C-027 | ConnectionController invalidates c64 queries on every state transition | High | S | TypeScript | Network | Phase 3 | P3-T1..P3-T4 |  |  |
| [ ] | C64C-028 | Background rediscovery loop keeps issuing probe traffic | Medium | M | TypeScript | Network | Phase 3 | P3-T1..P3-T4 |  |  |
| [ ] | C64C-029 | Drives query staleTime 10 seconds still refetched via broad invalidation | Medium | S | TypeScript | Architecture | Phase 3 | P3-T1..P3-T4 |  |  |
| [ ] | C64C-030 | No evidence of in-flight request coalescing for identical endpoints | Medium | M | TypeScript | Network | Phase 3 | P3-T1..P3-T4 |  |  |
| [ ] | C64C-031 | Redundant polling pattern for GET /v1/configs/Drive A Settings/Drive | High | S | Backend API usage | Network | Phase 3 | P3-T1..P3-T4 |  |  |
| [ ] | C64C-032 | Redundant polling pattern for GET /v1/configs/Drive A Settings/Drive Bus ID | High | S | Backend API usage | Network | Phase 3 | P3-T1..P3-T4 |  |  |
| [ ] | C64C-033 | Redundant polling pattern for GET /v1/configs/Drive A Settings/Drive Type | High | S | Backend API usage | Network | Phase 3 | P3-T1..P3-T4 |  |  |
| [ ] | C64C-034 | Redundant polling pattern for GET /v1/configs/Drive B Settings/Drive | High | S | Backend API usage | Network | Phase 3 | P3-T1..P3-T4 |  |  |
| [ ] | C64C-035 | Redundant polling pattern for GET /v1/configs/Drive B Settings/Drive Bus ID | High | S | Backend API usage | Network | Phase 3 | P3-T1..P3-T4 |  |  |
| [ ] | C64C-036 | Redundant polling pattern for GET /v1/configs/Drive B Settings/Drive Type | High | S | Backend API usage | Network | Phase 3 | P3-T1..P3-T4 |  |  |
| [ ] | C64C-037 | Redundant polling pattern for GET /v1/configs/SoftIEC Drive Settings/IEC Drive | High | S | Backend API usage | Network | Phase 3 | P3-T1..P3-T4 |  |  |
| [ ] | C64C-038 | Redundant polling pattern for GET /v1/configs/SoftIEC Drive Settings/Soft Drive Bus ID | High | S | Backend API usage | Network | Phase 3 | P3-T1..P3-T4 |  |  |
| [ ] | C64C-039 | Redundant polling pattern for GET /v1/configs/SoftIEC Drive Settings/Default Path | High | S | Backend API usage | Network | Phase 3 | P3-T1..P3-T4 |  |  |
| [ ] | C64C-040 | Redundant polling pattern for GET /v1/configs/U64 Specific Settings/System Mode | High | S | Backend API usage | Network | Phase 3 | P3-T1..P3-T4 |  |  |
| [ ] | C64C-041 | Redundant polling pattern for GET /v1/configs/U64 Specific Settings/Turbo Control | Medium | S | Backend API usage | Network | Phase 3 | P3-T1..P3-T4 |  |  |
| [ ] | C64C-042 | Redundant polling pattern for GET /v1/configs/U64 Specific Settings/CPU Speed | Medium | S | Backend API usage | Network | Phase 3 | P3-T1..P3-T4 |  |  |
| [ ] | C64C-043 | Redundant polling pattern for GET /v1/configs/U64 Specific Settings/Analog Video Mode | Medium | S | Backend API usage | Network | Phase 3 | P3-T1..P3-T4 |  |  |
| [ ] | C64C-044 | Redundant polling pattern for GET /v1/configs/U64 Specific Settings/Digital Video Mode | Medium | S | Backend API usage | Network | Phase 3 | P3-T1..P3-T4 |  |  |
| [ ] | C64C-045 | Redundant polling pattern for GET /v1/configs/U64 Specific Settings/HDMI Scan lines | Medium | S | Backend API usage | Network | Phase 3 | P3-T1..P3-T4 |  |  |
| [ ] | C64C-046 | Redundant polling pattern for GET /v1/configs/LED Strip Settings/LedStrip Mode | Medium | S | Backend API usage | Network | Phase 3 | P3-T1..P3-T4 |  |  |
| [ ] | C64C-047 | Redundant polling pattern for GET /v1/configs/LED Strip Settings/Fixed Color | Medium | S | Backend API usage | Network | Phase 3 | P3-T1..P3-T4 |  |  |
| [ ] | C64C-048 | Redundant polling pattern for GET /v1/configs/LED Strip Settings/Strip Intensity | Medium | S | Backend API usage | Network | Phase 3 | P3-T1..P3-T4 |  |  |
| [ ] | C64C-049 | Redundant polling pattern for GET /v1/configs/LED Strip Settings/LedStrip SID Select | Medium | S | Backend API usage | Network | Phase 3 | P3-T1..P3-T4 |  |  |
| [ ] | C64C-050 | Redundant polling pattern for GET /v1/configs/LED Strip Settings/Color tint | Medium | S | Backend API usage | Network | Phase 3 | P3-T1..P3-T4 |  |  |
| [ ] | C64C-051 | Redundant polling pattern for GET /v1/configs/Printer Settings/IEC printer | Medium | S | Backend API usage | Network | Phase 3 | P3-T1..P3-T4 |  |  |
| [ ] | C64C-052 | Redundant polling pattern for GET /v1/configs/Printer Settings/Bus ID | Medium | S | Backend API usage | Network | Phase 3 | P3-T1..P3-T4 |  |  |
| [ ] | C64C-053 | Redundant polling pattern for GET /v1/configs/Printer Settings/Output file | Medium | S | Backend API usage | Network | Phase 3 | P3-T1..P3-T4 |  |  |
| [ ] | C64C-054 | Redundant polling pattern for GET /v1/configs/Printer Settings/Output type | Medium | S | Backend API usage | Network | Phase 3 | P3-T1..P3-T4 |  |  |
| [ ] | C64C-055 | Redundant polling pattern for GET /v1/configs/Printer Settings/Ink density | Medium | S | Backend API usage | Network | Phase 3 | P3-T1..P3-T4 |  |  |
| [ ] | C64C-056 | Redundant polling pattern for GET /v1/configs/Printer Settings/Page top margin | Medium | S | Backend API usage | Network | Phase 3 | P3-T1..P3-T4 |  |  |
| [ ] | C64C-057 | Redundant polling pattern for GET /v1/configs/Printer Settings/Page height | Medium | S | Backend API usage | Network | Phase 3 | P3-T1..P3-T4 |  |  |
| [ ] | C64C-058 | Redundant polling pattern for GET /v1/configs/Printer Settings/Emulation | Medium | S | Backend API usage | Network | Phase 3 | P3-T1..P3-T4 |  |  |
| [ ] | C64C-059 | Redundant polling pattern for GET /v1/configs/Printer Settings/Commodore charset | Medium | S | Backend API usage | Network | Phase 3 | P3-T1..P3-T4 |  |  |
| [ ] | C64C-060 | Redundant polling pattern for GET /v1/configs/Printer Settings/Epson charset | Medium | S | Backend API usage | Network | Phase 3 | P3-T1..P3-T4 |  |  |
| [ ] | C64C-061 | Redundant polling pattern for GET /v1/configs/Printer Settings/IBM table 2 | Medium | S | Backend API usage | Network | Phase 3 | P3-T1..P3-T4 |  |  |
| [ ] | C64C-062 | Redundant polling pattern for GET /v1/configs/SID Sockets Configuration/SID Socket 1 | Medium | S | Backend API usage | Network | Phase 3 | P3-T1..P3-T4 |  |  |
| [ ] | C64C-063 | Redundant polling pattern for GET /v1/configs/SID Sockets Configuration/SID Socket 2 | Medium | S | Backend API usage | Network | Phase 3 | P3-T1..P3-T4 |  |  |
| [ ] | C64C-064 | Redundant polling pattern for GET /v1/configs/SID Sockets Configuration/SID Detected Socket 1 | Medium | S | Backend API usage | Network | Phase 3 | P3-T1..P3-T4 |  |  |
| [ ] | C64C-065 | Redundant polling pattern for GET /v1/configs/SID Sockets Configuration/SID Detected Socket 2 | Medium | S | Backend API usage | Network | Phase 3 | P3-T1..P3-T4 |  |  |
| [ ] | C64C-066 | Redundant polling pattern for GET /v1/configs/SID Addressing/UltiSID 1 Address | Medium | S | Backend API usage | Network | Phase 3 | P3-T1..P3-T4 |  |  |
| [ ] | C64C-067 | Redundant polling pattern for GET /v1/configs/SID Addressing/UltiSID 2 Address | Medium | S | Backend API usage | Network | Phase 3 | P3-T1..P3-T4 |  |  |
| [ ] | C64C-068 | Redundant polling pattern for GET /v1/configs/Audio Mixer/Vol UltiSid 1 | Medium | S | Backend API usage | Network | Phase 3 | P3-T1..P3-T4 |  |  |
| [ ] | C64C-069 | Redundant polling pattern for GET /v1/configs/Audio Mixer/Vol UltiSid 2 | Medium | S | Backend API usage | Network | Phase 3 | P3-T1..P3-T4 |  |  |
| [ ] | C64C-070 | Redundant polling pattern for GET /v1/configs/Data Streams/Stream VIC to | Medium | S | Backend API usage | Network | Phase 3 | P3-T1..P3-T4 |  |  |
| [ ] | C64C-071 | Keyguard PIN prevents real-device app interaction validation | Critical | S | Device-specific | Reliability | Phase 4 | P4-T1..P4-T3 |  |  |
| [ ] | C64C-072 | NotificationShade retains mCurrentFocus after unlock attempts | High | S | Device-specific | UX | Phase 4 | P4-T1..P4-T3 |  |  |
| [ ] | C64C-073 | Foreground gfx profiling captured with root view visibility 8 | High | S | Device-specific | Rendering | Phase 4 | P4-T1..P4-T3 |  |  |
| [ ] | C64C-074 | No dynamic runtime animation throttling found | High | M | TypeScript | Rendering | Phase 4 | P4-T1..P4-T3 |  |  |
| [ ] | C64C-075 | Extensive framer-motion surface on low-spec target | Medium | M | TypeScript | Performance | Phase 4 | P4-T1..P4-T3 |  |  |
| [ ] | C64C-076 | Device animator scales remain at 1.0 with no app adaptation | Medium | S | Device-specific | Rendering | Phase 4 | P4-T1..P4-T3 |  |  |
| [ ] | C64C-077 | Interactive lag and pressed-state persistence not directly measurable under lock | Medium | S | Device-specific | UX | Phase 4 | P4-T1..P4-T3 |  |  |
| [ ] | C64C-078 | Slider drag latency validation gap on target device | Medium | M | Test gap | Test gap | Phase 4 | P4-T1..P4-T3 |  |  |
| [ ] | C64C-079 | Config expand and collapse latency validation gap | Medium | M | Test gap | Test gap | Phase 4 | P4-T1..P4-T3 |  |  |
| [ ] | C64C-080 | Rapid Config to Disks ping-pong stress not executed end-to-end | Medium | M | Test gap | Test gap | Phase 4 | P4-T1..P4-T3 |  |  |
| [ ] | C64C-081 | Observed lifecycle churn from repeated start pause stop cycles | High | M | Device-specific | Reliability | Phase 4 | P4-T1..P4-T3 |  |  |
| [ ] | C64C-082 | Frame pacing percentile artifacts show unusable 4950 ms bins | Low | XS | Device-specific | Rendering | Phase 4 | P4-T1..P4-T3 |  |  |
| [ ] | C64C-083 | Exploratory UI evidence lacks app-surface screenshots | Low | S | Test gap | Observability | Phase 4 | P4-T1..P4-T3 |  |  |
| [ ] | C64C-084 | Device command chronology is sparse for reproducibility | Low | S | Observability | Observability | Phase 4 | P4-T1..P4-T3 |  |  |
| [ ] | C64C-085 | No deterministic unlock automation path documented | Medium | S | Device-specific | Architecture | Phase 4 | P4-T1..P4-T3 |  |  |
| [ ] | C64C-086 | iOS BackgroundExecution plugin is a complete no-op | Critical | M | Swift | Reliability | Phase 5 | P5-T1..P5-T5 |  |  |
| [ ] | C64C-087 | Web BackgroundExecution fallback is also no-op | Low | XS | Capacitor bridge | Architecture | Phase 5 | P5-T1..P5-T5 |  |  |
| [ ] | C64C-088 | Android wake lock has hard 10-minute timeout | High | M | Kotlin | Reliability | Phase 5 | P5-T1..P5-T5 |  |  |
| [ ] | C64C-089 | Android service idle timeout may stop service after 60 seconds | High | S | Kotlin | Reliability | Phase 5 | P5-T1..P5-T5 |  |  |
| [ ] | C64C-090 | No explicit audio focus handling found in background service path | Critical | L | Kotlin | Reliability | Phase 5 | P5-T1..P5-T5 |  |  |
| [ ] | C64C-091 | No media session configuration evidence in captured native artifacts | High | L | Kotlin | Architecture | Phase 5 | P5-T1..P5-T5 |  |  |
| [ ] | C64C-092 | BackgroundExecution start/stop failures only logged as warn in manager | Medium | S | TypeScript | Observability | Phase 5 | P5-T1..P5-T5 |  |  |
| [ ] | C64C-093 | Due-at watchdog relies on system clock comparisons without monotonic guard | Medium | M | Kotlin | Reliability | Phase 5 | P5-T1..P5-T5 |  |  |
| [ ] | C64C-094 | Deprecated SidPlayerProvider still controls background execution path | Medium | S | TypeScript | Architecture | Phase 5 | P5-T1..P5-T5 |  |  |
| [ ] | C64C-095 | Lock and unlock playback progression not validated on required real device | High | M | Test gap | Test gap | Phase 5 | P5-T1..P5-T5 |  |  |
| [ ] | C64C-096 | HVSC Android unit tests fail with NoClassDefFoundError | Critical | M | CI | Reliability | Phase 6 | P6-T1..P6-T4 |  |  |
| [ ] | C64C-097 | HVSC non-native ingestion path is gated and can hard-fail at runtime | High | M | TypeScript | Reliability | Phase 6 | P6-T1..P6-T4 |  |  |
| [ ] | C64C-098 | HVSC download fallback may materialize full archive buffer in memory | High | L | TypeScript | Memory | Phase 6 | P6-T1..P6-T4 |  |  |
| [ ] | C64C-099 | HVSC guarded read still decodes full base64 archive into Uint8Array | High | M | TypeScript | Memory | Phase 6 | P6-T1..P6-T4 |  |  |
| [ ] | C64C-100 | HVSC cancel token map and active flag are module-global state | Medium | S | TypeScript | Concurrency | Phase 6 | P6-T1..P6-T4 |  |  |
| [ ] | C64C-101 | HVSC cached archive stat failures are downgraded to warnings | Low | XS | TypeScript | Observability | Phase 6 | P6-T1..P6-T4 |  |  |
| [ ] | C64C-102 | HVSC deletion failure summary truncates at first ten paths | Low | S | TypeScript | Observability | Phase 6 | P6-T1..P6-T4 |  |  |
| [ ] | C64C-103 | HVSC native progress listener removal is only in finally path per archive | Medium | S | Capacitor bridge | Reliability | Phase 6 | P6-T1..P6-T4 |  |  |
| [ ] | C64C-104 | Warm memory median PSS is 2.92 percent above cold baseline | Medium | S | TypeScript | Memory | Phase 7 | P7-T1..P7-T2 |  |  |
| [ ] | C64C-105 | Warm thread count rises from cold baseline | Medium | S | TypeScript | Memory | Phase 7 | P7-T1..P7-T2 |  |  |
| [ ] | C64C-106 | Global branch coverage is only marginally above gate | High | M | CI | Test gap | Phase 8 | P8-T1..P8-T4 |  |  |
| [ ] | C64C-107 | playwright trace comparison module branch coverage is low | Medium | S | CI | Test gap | Phase 8 | P8-T1..P8-T4 |  |  |
| [ ] | C64C-108 | hvscIngestionRuntime branch coverage is low for critical path | High | M | CI | Test gap | Phase 8 | P8-T1..P8-T4 |  |  |
| [ ] | C64C-109 | useSidPlayer branch coverage remains low despite playback criticality | Medium | S | CI | Test gap | Phase 8 | P8-T1..P8-T4 |  |  |
| [ ] | C64C-110 | Connection manager sticky lock and discovery complexity increases state-risk | Critical | L | TypeScript | Architecture | Phase 9 | P9-T1..P9-T2 |  |  |

## 10. Phase Completion Gate
- A phase is complete only when all of the following are true:
  - [ ] Every task in the phase is ticked.
  - [ ] Every mapped issue row is ticked.
  - [ ] Every ticked issue has journal and proof links.
  - [ ] Regression checks for that phase are green.

## 11. Handoff Protocol (When Stopping Is Required)
- If continuation would force shortcuts, stop and add a journal row containing:
  - Current phase and last completed task.
  - Exact files changed.
  - Commands run and their outcomes.
  - Remaining risks and next concrete command.
- After handoff logging, do not tick incomplete items.
