# Android MVP Production Readiness Plan (feat/iOS-PORT)

## Execution Mode
- Plan-execute-verify only.
- Priority order enforced; medium/low work blocked until high blockers pass gates.
- No silent exception handling in touched paths.
- Every code change must include automated test coverage updates.

## Status Legend
- [ ] Not started
- [~] In progress
- [x] Completed
- [!] Blocked

## Step 0 — Baseline and Safety Harness

### Goals
- Establish deterministic baseline before behavioral changes.
- Capture known-red list and required-vs-informational CI gate inventory.
- Map every remediation priority to concrete automated artifacts.

### Baseline Command Matrix
| Gate | Command | Baseline status | Evidence |
|---|---|---|---|
| Lint | `npm run lint` | [ ] Pending | |
| Unit/Integration | `npm run test` | [ ] Pending | |
| Build | `npm run build` | [ ] Pending | |
| Playwright E2E | `npm run test:e2e` | [ ] Pending | |
| Android JVM tests | `cd android && ./gradlew test` | [ ] Pending | |
| Android emulator suite | `node tests/android-emulator/run.mjs` | [ ] Pending | |
| Maestro Android gating | `bash scripts/run-maestro-gating.sh --skip-build` | [ ] Pending | |
| Golden trace validation | `npm run validate:traces` | [ ] Pending | |

### CI Matrix Classification (current repo)
- [~] Gathered workflow inventory from `.github/workflows/*.yaml`.
- [ ] Classified each required gate as merge-blocking or informational.
- [ ] Added explicit mapping for missing required gates and policy gaps.

### Priority-to-Test Artifact Map
| Priority | Finding | Primary modules | Required artifacts | Current status |
|---|---|---|---|---|
| P1 High | Background service restart/lifetime safety | `BackgroundExecutionService.kt` | Android JVM + emulator/Maestro lock/background lifecycle | [ ] |
| P2 High | Lock-screen/background flow not CI-enforced | `.maestro/config.yaml`, `scripts/run-maestro-gating.sh` | Required Maestro lock/background + HVSC in CI | [ ] |
| P3 High | Restore does not rehydrate native due-time | `usePlaybackPersistence.ts`, `PlayFilesPage.tsx` | Unit + integration + emulator restore regression | [ ] |
| P4 Medium-High | Source navigation stale async race | `useSourceNavigator.ts` | Unit out-of-order + integration churn tests | [ ] |
| P5 Medium | Config write queue swallows errors | `configWriteThrottle.ts` | Unit failure-path assertions (surface/log/rethrow) | [ ] |
| P6 Medium | Inconsistent observability | HVSC stores + source adapters | Unit log envelope/asserted fields | [ ] |
| P7 Medium | Song length propagation reliability | `playbackRouter.ts`, playback controller | Unit matrix + integration next-track timing + traces | [ ] |
| P8 Medium | HVSC ingest memory pressure/resilience | HVSC ingestion modules | Unit ENOSPC/IO/cancel-restart + stress lane | [ ] |
| P9 Medium | Missing Android native background tests | `android/app/src/test/java`, emulator specs | JVM lifecycle contract + emulator process/lock/network paths | [ ] |
| P10 Medium | iOS parity gaps | `NativePlugins.swift`, `Info.plist`, `AppDelegate.swift`, `ios-ci.yaml` | iOS smoke assertions + parity matrix docs | [ ] |
| P11 Low-Medium | Empty catches in Gradle | Android Gradle files | Catch remediation + sanity test/log validation | [ ] |
| P12 Low | Oversized files/modularity risk | Large TSX/API files | Characterization tests before split | [ ] |

### Step 0 Evidence Log
- Initial discovery:
  - Existing `.maestro/config.yaml` excludes `hvsc` by default.
  - `scripts/run-maestro-gating.sh` uses `--include-tags=ci-critical` on CI.
  - Android workflow includes `android-maestro`, `android-tests`, web test/build lanes; explicit lock/HVSC required assertions not yet verified.

### Step 0 Exit Checklist
- [ ] Known-red list documented.
- [ ] CI required/informational matrix documented.
- [ ] No behavior change applied.

---

## Step 1 — Enforce Critical CI Gates First (P2)
- [ ] Make lock/background Maestro flow required in CI.
- [ ] Promote HVSC Maestro flows to required.
- [ ] Add CI assertions that critical Maestro flows executed.
- [ ] Guard against accidental excludes of critical tags.

## Step 2 — High Blocker: Background Service Lifetime Safety (P1)
- [ ] Define lifecycle contract (idle/active/restart).
- [ ] Bound wake lock/service lifetime deterministically.
- [ ] Validate process-death restart and explicit user stop semantics.
- [ ] Align JS/native transitions and add JVM + emulator tests.

## Step 3 — High Blocker: Restore Rehydrates Native Due-Time (P3)
- [ ] Atomically restore track-instance guard + due-time.
- [ ] Rearm/clear native due-time deterministically across restore paths.
- [ ] Add unit + integration + emulator restore regression tests.

## Step 4 — High Blocker: Locked-Screen Reliability Enforcement
- [ ] Add lock/unlock assertions in Maestro flow.
- [ ] Add negative-path network interruption checks.
- [ ] Remove optional masking steps from critical flow.

## Step 5 — Source Navigation Race (P4)
- [ ] Token-gate async updates in `useSourceNavigator.ts`.
- [ ] Add out-of-order unit tests and rapid-churn integration tests.

## Step 6 — Error Propagation and Observability (P5/P6/P11)
- [ ] Replace swallowed catches with rethrow/logging.
- [ ] Standardize structured logging context and source-kind envelopes.
- [ ] Add tests for surfaced errors and logging payloads.

## Step 7 — Song Length Propagation Contract (P7)
- [ ] Define deterministic duration behavior across source kinds.
- [ ] Add fallback semantics and observability events.
- [ ] Add unit matrix + integration timing tests; update golden traces if changed.

## Step 8 — HVSC Ingestion Resource Pressure (P8)
- [ ] Reduce peak memory and validate cleanup/idempotent restart.
- [ ] Add failure-path tests (ENOSPC, IO, cancel/restart).
- [ ] Add/verify stress lane and Maestro HVSC gating for release path.

## Step 9 — Expand Native + Emulator Coverage (P9)
- [ ] Add JVM tests for service/plugin lifecycle contracts.
- [ ] Expand emulator matrix: start/stop, bg/fg, lock/unlock, network disruption, kill/restore.

## Step 10 — iOS Forward-Looking Hardening (P10)
- [ ] Document Android vs iOS background parity matrix.
- [ ] Add lightweight iOS smoke assertions and CI artifact checks.

## Step 11 — Large-File Refactor Risk Reduction (P12)
- [ ] Refactor only while touching targeted oversized files.
- [ ] Add characterization tests before split.

## Final Validation Gate
- [ ] `npm run lint`
- [ ] `npm run test`
- [ ] `npm run build`
- [ ] `npm run test:e2e`
- [ ] `cd android && ./gradlew test`
- [ ] Android emulator suite
- [ ] Maestro required suite (lock/background/HVSC)
- [ ] Golden trace validation (if applicable)

## Final Readiness Report (to be completed at end)
- [ ] Closed findings by priority
- [ ] Remaining accepted risks with rationale + owner
- [ ] Test evidence references
- [ ] Explicit Android go/no-go recommendation
