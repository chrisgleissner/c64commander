# PLANS.md — Fuzz Reporting Rework

## Metadata
- **Branch**: fix/resolve-fuzz-errors
- **Date**: 2026-03-05
- **Node**: v24.11.0 / npm 11.6.1
- **Objective**: Rework the fuzz reporting layer for clarity and triage speed, without changing fuzz runner architecture or application logging semantics.

## Architecture Analysis

### Current state

The fuzz system consists of three immutable-architecture files:
- `playwright/fuzz/chaosRunner.fuzz.ts` — runner, issue grouping, session logs, video capture
- `scripts/run-fuzz.mjs` — launcher, shard orchestration, report merging, README generation
- `src/lib/fuzz/fuzzMode.ts` — app-side fuzz contract

Report generation lives entirely in `mergeReports()` inside `run-fuzz.mjs` (lines ~598–638):
- Produces a flat `README.md` with all issues in one section, ordered by total count descending
- Fields: Exception → Message → Top frames → Total → Severity → Platforms → Videos → Screenshots
- No classification into REAL/UNCERTAIN/EXPECTED
- No domain labelling
- No confidence levels
- `fuzz-issue-summary.md` was previously removed and is not currently generated

Classification helpers already exist in `playwright/fuzz/fuzzBackend.ts`:
- `isAlwaysExpectedFuzzBehavior()` — structural always-expected patterns
- `isDeviceOperationFailure()` — device-op failures expected under server absence/fault
- `isBackendFailureLog()` — network-level API failures

Each issue example already carries:
- `lastInteractions` — last N interaction log lines (includes chaos events if near the issue)
- `interactionIndex` — step index at issue time
- `shardIndex` — shard where the issue occurred

Supporting utilities live in `scripts/fuzzReportUtils.mjs`:
- `formatFuzzTimestamp()`, `videoMarkdownLink()`, `sortIssueGroups()`

### New design

Add `scripts/fuzzClassifier.mjs` as the deterministic classification layer.
Update `scripts/fuzzReportUtils.mjs` to add report rendering helpers.
Update `scripts/run-fuzz.mjs` to drive classification and emit the new report structure.

**Architectural rules**:
1. Application log severity (WARN/ERROR) is never modified.
2. Runner architecture files are unchanged.
3. Classification happens only during report generation.
4. Issue grouping signature (exception + normalized message + top frames) is unchanged.
5. Artifact layout is unchanged.

## Classification Rule Design

### Domain classification (deterministic, message-pattern based)

| Domain | Primary signals |
|--------|----------------|
| NETWORK | "C64 API request failed/upload failed", "FTP listing failed", "HTTP 503", "failed to load resource", "network", "service unavailable", "connection", "latency", "Source browse failed" |
| DEVICE_ACTION | HOME_*, AUDIO_ROUTING:, RESET_DRIVES, DRIVE_POWER, DRIVE_CONFIG_UPDATE, SOFT_IEC_CONFIG_UPDATE, RAM_DUMP_FOLDER_SELECT, BROWSE, CONFIG_UPDATE, "RAM operation retry", "resume machine" |
| FILESYSTEM | "RAM dump", "disk", "filesystem", "file", "HVSC paged folder", "HVSC songlengths", "HVSC progress" |
| FUZZ_INFRASTRUCTURE | "DiagnosticsBridge unavailable", "Category config fetch failed", "API device host changed", "C64 API retry scheduled", "Songlengths unavailable", "HVSC filesystem:", "localStorage", "fuzz mode blocked", "Failed to capture initial config", "Failed to fetch category" |
| BACKEND | "backend", "JSON", "parse error", "server", "response", "status code" |
| UI | Top frames referencing component code, DOM interaction failures, click/toggle failures, TypeError in UI context |
| UNKNOWN | None of the above |

### Issue classification (REAL / UNCERTAIN / EXPECTED)

**EXPECTED** (HIGH confidence):
- Domain is FUZZ_INFRASTRUCTURE
- `isAlwaysExpectedFuzzBehavior` patterns (from fuzzBackend.ts)
- Domain is DEVICE_ACTION and chaos event present in lastInteractions
- Domain is NETWORK and chaos event present in lastInteractions
- Severity: errorLog or warnLog only (no crash/freeze)

**EXPECTED** (MEDIUM confidence):
- Domain is DEVICE_ACTION or NETWORK with no chaos event evidence (mock server is always absent)
- Severity: errorLog or warnLog only

**REAL** (HIGH confidence):
- Severity contains crash or freeze
- TypeError in non-expected context
- DOM interaction failure in UI context

**REAL** (MEDIUM confidence):
- Exception contains "TypeError" or "ReferenceError"
- Error pattern not matching any expected paths

**UNCERTAIN** (MEDIUM confidence):
- Domain BACKEND with no direct chaos correlation
- Unrecognised patterns

**UNCERTAIN** (LOW confidence):
- Domain UNKNOWN

### Chaos event detection

Chaos events in `lastInteractions` are detected by action prefix:
- `a=network-offline`
- `a=connection-flap`
- `a=latency-spike`

## Implementation Steps

1. [x] Analyse existing system (chaosRunner.fuzz.ts, run-fuzz.mjs, fuzzBackend.ts, fuzzReportUtils.mjs)
2. [x] Create `scripts/fuzzClassifier.mjs` with domain + classification + confidence logic
3. [x] Update `scripts/fuzzReportUtils.mjs` with `renderReadme()`, `renderSummary()`, `renderIssueEntry()`
4. [x] Update `scripts/run-fuzz.mjs` to drive classification and produce new README structure
5. [x] Add `fuzz-issue-summary.md` generation (compact version)
6. [x] Enrich `fuzz-issue-report.json` with `classificationMeta` per issue group
7. [x] Create `tests/unit/scripts/fuzzClassifier.test.ts` (58 tests)
8. [x] Update `tests/unit/scripts/fuzzReportUtils.test.ts` (31 tests; fixed stale summary test, added renderIssueEntry tests)
9. [x] Update `doc/testing/chaos-fuzz.md`
10. [x] Run `npm run lint && npm run test && npm run build` — all pass

## Testing Strategy

- Unit tests for each classifier function: `classifyDomain`, `classifyIssue`, `hasChaosEvidence`
- Tests cover all domain values, all classification outcomes, and all confidence levels
- Edge cases: empty lastInteractions, missing signature fields, crash/freeze severities
- Integration smoke: README rendering produces correct section headers

## Verification Criteria

1. `npm run test` passes (all unit tests green)
2. `npm run lint` passes
3. `npm run build` succeeds
4. `scripts/fuzzClassifier.mjs` exports deterministic pure functions
5. README.md produced by `mergeReports()` contains: header metadata, classification summary, REAL/UNCERTAIN/EXPECTED sections
6. `fuzz-issue-summary.md` is generated as compact version
7. `fuzz-issue-report.json` retains existing structure and gains `classificationMeta` per group
8. No application log severity changes anywhere in the codebase

## Outcome — 2026-03-05 fuzz iteration

- **Run command**: `FUZZ_RUN_MODE=ci VITE_FUZZ_MODE=1 node scripts/run-fuzz.mjs --fuzz-seed 4242 --fuzz-time-budget 20m --fuzz-concurrency 1 --fuzz-platform android-phone`
- **Run directory**: `test-results/fuzz/run-ci-android-phone-4242-4242/`
- **Observed duration**: 15m 9s
- **Session count**: 3
- **Unique signatures**: 2
- **Classification result**: `REAL=0`, `UNCERTAIN=0`, `EXPECTED=2`

### Triage notes

- No REAL issues were produced.
- No UNCERTAIN issues were produced.
- EXPECTED issues were both network-chaos correlated:
	- `console.error@unknown-dfb60ee5` — service unavailable under induced chaos
	- `app.log.error@unknown-830004cf` — config write queue failed due to upstream network chaos
- No classifier changes required for this run.
- No application defects identified in this iteration.

## Outcome — 2026-03-05 follow-up iterations

- **Detected report integrity defect**: `README.md` contained classifications, but `fuzz-issue-report.json` had `UNCLASSIFIED` entries because the report file was written before `classificationMeta` enrichment and later rewritten from stale parsed content.
- **Fix applied**: `scripts/run-fuzz.mjs`
	- Write `fuzz-issue-report.json` after `classificationMeta` enrichment.
	- Final rewrite now uses in-memory `merged` object (preserves classifications) while updating qualified session stats.
- **Verification result**: JSON now reports explicit classes with `UNCLASSIFIED=0`.

- **Detected classifier gap**: `app.log.error@unknown-3146503a` (`Machine pause/resume failed`) was classified as `UNCERTAIN` despite being a machine control operation failure in fuzz/mock conditions.
- **Fix applied**:
	- `scripts/fuzzClassifier.mjs`: added `Machine pause/resume failed` to `DEVICE_ACTION` message patterns.
	- `tests/unit/scripts/fuzzClassifier.test.ts`: added domain + classification regression tests.
	- `doc/testing/chaos-fuzz.md`: documented machine pause/resume failure classification under `DEVICE_ACTION`.

### Final deterministic run status

- **Run command**: `FUZZ_RUN_MODE=ci VITE_FUZZ_MODE=1 node scripts/run-fuzz.mjs --fuzz-seed 4242 --fuzz-time-budget 20m --fuzz-concurrency 1 --fuzz-platform android-phone`
- **Run directory**: `test-results/fuzz/run-ci-android-phone-4242-4242/`
- **Observed duration**: 15m 12s
- **Session count**: 3
- **Unique signatures**: 4
- **Final classification result**: `REAL=0`, `UNCERTAIN=0`, `EXPECTED=4`, `UNCLASSIFIED=0`

### Final gate checks

- `npm run lint` ✅
- `npm run test` ✅
- `npm run build` ✅
- `npm run test:coverage` ✅ (`% Branch = 90.22`)

## Outcome — 2026-03-05 extended iterations (A/B/C)

- Additional deterministic runs executed with unique IDs:
	- `run-ci-android-phone-4242-4242-itA`
	- `run-ci-android-phone-4242-4242-itB`
	- `run-ci-android-phone-4242-4242-itC`

### Format verification

- All three `README.md` reports include explicit sections:
	- `# REAL Issues`
	- `# UNCERTAIN Issues`
	- `# EXPECTED Issues`
- All three corresponding `fuzz-issue-report.json` files include classification metadata with `UNCLASSIFIED=0`.

### Iteration counts

- **itA**: `REAL=0`, `UNCERTAIN=0`, `EXPECTED=3`
- **itB**: `REAL=0`, `UNCERTAIN=1`, `EXPECTED=3`
- **itC**: `REAL=0`, `UNCERTAIN=0`, `EXPECTED=3`

### Additional classifier fix from iteration B

- UNCERTAIN signature found in `itB`:
	- `Error@Error-Element-is-not-attached-a6ca941e`
	- Message: `Element is not attached`
	- Top frames in `playwright/fuzz/chaosRunner.fuzz.ts`
- Triage result: fuzz-runner interaction artifact (not application defect).
- Fixes:
	- `scripts/fuzzClassifier.mjs`: classify stale-element runner artifacts as `FUZZ_INFRASTRUCTURE`.
	- `tests/unit/scripts/fuzzClassifier.test.ts`: add regression tests for domain and EXPECTED classification.
	- `doc/testing/chaos-fuzz.md`: document stale-element runner artifact classification.

### Post-fix verification

- `itC` confirms the prior UNCERTAIN signature no longer appears as non-expected.
- Quality gates after final changes:
	- `npm run lint` ✅
	- `npm run test` ✅
	- `npm run build` ✅
	- `npm run test:coverage` ✅ (`% Branch = 90.22`)

## Outcome — 2026-03-05 additional loop verification (D/E)

- Additional deterministic runs executed:
	- `run-ci-android-phone-4242-4242-itD`
	- `run-ci-android-phone-4242-4242-itE`

### D/E results

- **itD**: `REAL=0`, `UNCERTAIN=0`, `EXPECTED=2`, `UNCLASSIFIED=0`
- **itE**: `REAL=0`, `UNCERTAIN=0`, `EXPECTED=3`, `UNCLASSIFIED=0`

### Conclusion of loop

- No REAL defects remain.
- No UNCERTAIN issues remain.
- Remaining issues are consistently EXPECTED network-chaos artifacts (`Service Unavailable`, `Config write queue: preceding task failed`, `Drive config update retry`) under intentional `network-offline` / `connection-flap` / `latency-spike` events.
- No log suppression or severity weakening was introduced.
