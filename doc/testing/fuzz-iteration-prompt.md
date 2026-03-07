# Fuzz Iteration Agent Prompt

## Purpose

This is a ready-to-execute agent briefing for running a local fuzz test, analysing the
classified output, fixing genuine defects found, and iterating until no REAL issues remain.

---

## Background

A new classification and reporting layer has just been implemented on branch
`fix/resolve-fuzz-errors`:

- `scripts/fuzzClassifier.mjs` — deterministic REAL / UNCERTAIN / EXPECTED classifier
- `scripts/fuzzReportUtils.mjs` — report renderers (`renderReadme`, `renderSummary`,
  `renderIssueEntry`)
- `scripts/run-fuzz.mjs` — updated to drive classification and emit the structured README

The README.md produced by a fuzz run now contains three sections in order:

```
# REAL Issues
# UNCERTAIN Issues
# EXPECTED Issues
```

Each issue entry lists: Message → Domain → Confidence → Exception → Total → Severity →
Platforms → Top frames → Explanation → Videos → Screenshots → Shards.

A compact `fuzz-issue-summary.md` (REAL + UNCERTAIN IDs only) is also written alongside
`fuzz-issue-report.json`.

The classifier rules are:

| Classification | Confidence | Conditions                                                                     |
| -------------- | ---------- | ------------------------------------------------------------------------------ |
| EXPECTED       | HIGH       | Domain is FUZZ_INFRASTRUCTURE                                                  |
| EXPECTED       | HIGH       | `isAlwaysExpectedFuzzBehavior` pattern matches                                 |
| EXPECTED       | HIGH       | Domain DEVICE_ACTION or NETWORK + chaos event in lastInteractions              |
| EXPECTED       | MEDIUM     | Domain DEVICE_ACTION or NETWORK, no chaos evidence (mock server always absent) |
| REAL           | HIGH       | Severity contains crash or freeze                                              |
| REAL           | MEDIUM     | Exception is TypeError or ReferenceError in non-expected context               |
| UNCERTAIN      | MEDIUM     | Domain BACKEND, no direct chaos correlation                                    |
| UNCERTAIN      | LOW        | Domain UNKNOWN                                                                 |

Chaos events are detected in `lastInteractions` by the prefix `a=network-offline`,
`a=connection-flap`, or `a=latency-spike`.

---

## Step 1 — Run a 20-minute fuzz test (mirrors CI)

CI uses the following command (5-minute budget, fixed seed, concurrency 1, android-phone
platform, `FUZZ_RUN_MODE=ci`):

```bash
FUZZ_RUN_MODE=ci VITE_FUZZ_MODE=1 \
  node scripts/run-fuzz.mjs \
    --fuzz-seed 4242 \
    --fuzz-time-budget 20m \
    --fuzz-concurrency 1 \
    --fuzz-platform android-phone
```

Wait for completion. The run directory will be:

```
test-results/fuzz/run-ci-android-phone-4242-<runId>/
  README.md
  fuzz-issue-summary.md
  fuzz-issue-report.json
  sessions/
  screenshots/
  videos/
```

---

## Step 2 — Analyse the README.md

Read `test-results/fuzz/run-ci-android-phone-4242-*/README.md`.

### 2a — Verify EXPECTED classification is working

All of the following patterns must appear in the `# EXPECTED Issues` section:

- Network-offline / connection-flap / latency-spike errors (C64 API request failed, FTP
  listing failed, HTTP 503, service unavailable, connection refused, upload failed)
- All items where Domain is `FUZZ_INFRASTRUCTURE` (DiagnosticsBridge unavailable, category
  config fetch, HVSC entries, localStorage, fuzz mode blocked, API device host changed)
- Device-operation failures that occurred under an active chaos event (HOME\_\*, AUDIO_ROUTING,
  RESET_DRIVES, etc.)

If any of these appear in `# REAL` or `# UNCERTAIN`, that is a classifier bug — fix
`scripts/fuzzClassifier.mjs` and re-run the tests (`npm run test`), then re-run the fuzz.

### 2b — Audit REAL issues

For each issue in `# REAL Issues`:

1. Read the Message, Top frames, Exception, and Explanation fields.
2. Read the corresponding session log(s) in `sessions/` to get the full event sequence.
3. Determine whether the issue is a genuine application defect (crash, unhandled rejection,
   broken UI state) or a classifier false positive.
   - If it is a **genuine defect**: categorise, file against the source component, and
     proceed to Step 3.
   - If it is a **classifier false positive**: fix the classifier rule in
     `scripts/fuzzClassifier.mjs`, ensure the corresponding unit test in
     `tests/unit/scripts/fuzzClassifier.test.ts` covers the corrected case, and re-verify.

### 2c — Triage UNCERTAIN issues

For each issue in `# UNCERTAIN Issues`:

1. Use the same session-log analysis as above.
2. Promote to REAL (add a classifier rule that makes the pattern REAL) if the analysis shows
   a genuine defect.
3. Promote to EXPECTED (add a classifier rule) if the issue is provably caused by fuzz
   infrastructure absence or chaos events and no functional defect exists.
4. Leave UNCERTAIN only if truly ambiguous after full investigation — document reasoning.

---

## Step 3 — Fix genuine defects

For each genuine defect identified in Step 2:

1. Find the root cause in the application source. Do not suppress, swallow, or weaken
   error handling. Do not change log levels to hide the error.
2. Implement the fix.
3. Run full validation:

   ```bash
   npm run lint
   npm run test
   npm run build
   ```

   All three must pass before re-running the fuzz.

4. Return to Step 1 and run again with the same seed and 20-minute budget.

---

## Step 4 — Iterate until clean

Repeat Steps 1–3 until all of the following are true:

- `# REAL Issues` section is empty **or** every remaining REAL entry is a documented
  known false positive with an open classifier fix tracked in PLANS.md.
- Every UNCERTAIN entry has been triaged and either resolved, reclassified, or documented
  with explicit reasoning.
- `npm run test:coverage` passes with global branch coverage ≥ 90%.

---

## Mandatory constraints

These are non-negotiable throughout the cycle:

1. **Never weaken log severity.** Do not change WARN → DEBUG or ERROR → WARN to suppress
   an issue from appearing in fuzz output.
2. **Never suppress errors.** Do not add `catch` blocks that swallow exceptions silently.
   Every caught exception must be logged (WARN/ERROR + stack trace + context) or rethrown.
3. **Never reclassify to hide.** If a pattern is genuinely REAL, do not add a classifier
   rule that moves it to EXPECTED without first confirming the underlying defect is fixed.
4. **Fix root causes.** Do not add try/catch around failing code as the sole fix.
5. **Keep the repo buildable.** Every intermediate commit must pass lint, test, and build.
6. **No dead code.** Do not leave commented-out blocks or unused variables.

---

## Completion checklist

Before declaring work complete:

- [ ] `# REAL Issues` is empty or all entries are documented false positives.
- [ ] All UNCERTAIN entries are triaged with decision recorded.
- [ ] `npm run lint` passes.
- [ ] `npm run test` passes (all tests green).
- [ ] `npm run test:coverage` shows ≥ 90% branch coverage.
- [ ] `npm run build` succeeds.
- [ ] PLANS.md updated with outcome section noting the final fuzz run result and any
      classifier rules added.
- [ ] `doc/testing/chaos-fuzz.md` updated if any classifier rule changed.

---

## Relevant source files

| File                                         | Purpose                                                  |
| -------------------------------------------- | -------------------------------------------------------- |
| `scripts/fuzzClassifier.mjs`                 | Classification rules (edit this to fix false positives)  |
| `scripts/fuzzReportUtils.mjs`                | Report renderers                                         |
| `scripts/run-fuzz.mjs`                       | Fuzz launcher and report merger                          |
| `playwright/fuzz/chaosRunner.fuzz.ts`        | Issue grouping, session log format (read-only)           |
| `playwright/fuzz/fuzzBackend.ts`             | `isAlwaysExpectedFuzzBehavior`, referenced by classifier |
| `tests/unit/scripts/fuzzClassifier.test.ts`  | Unit tests for classifier (keep green)                   |
| `tests/unit/scripts/fuzzReportUtils.test.ts` | Unit tests for renderers (keep green)                    |
| `doc/testing/chaos-fuzz.md`                  | Reference docs for the fuzz system                       |
| `PLANS.md`                                   | Execution plan (update when done)                        |
