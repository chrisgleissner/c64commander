# PLANS.md — Fuzz Defect Elimination Plan

## Metadata
- **Branch**: fix/resolve-fuzz-errors
- **Base (main)**: 7d729b58d89b
- **HEAD at plan creation**: 967a4d23b89c962225501b417d6c6fcf0364dc7a
- **Date**: 2026-03-04
- **Node**: v24.11.0 / npm 11.6.1

## Authoritative Fuzz Artifact Sources

| Directory | Run ID | Type |
|-----------|--------|------|
| `.tmp/ci-fuzz/fuzz-deterministic-artifacts/` | 4242 | Deterministic |
| `.tmp/ci-fuzz/fuzz-deterministic-artifacts (1)/` | 4242 | Deterministic |
| `.tmp/ci-fuzz/fuzz-deterministic-artifacts (2)/` | 4242 | Deterministic |
| `.tmp/ci-fuzz/fuzz-deterministic-artifacts (3)/` | 4242 | Deterministic |
| `.tmp/ci-fuzz/fuzz-test-artifacts/` | 22654225266 | CI Android |
| `.tmp/ci-fuzz/fuzz-test-artifacts (1)/` | 22654225266 | CI Android |
| `.tmp/ci-fuzz/fuzz-test-artifacts (2)/` | 22607476207 | CI Android |
| `.tmp/ci-fuzz/fuzz-test-artifacts (3)/` | 22568614276 | CI Android |

All README.md files under these directories are authoritative.

## Deterministic Test Commands

```bash
npm run lint
npm run test
npm run build
```

Coverage check (required pre-completion):
```bash
npm run test:coverage
```

## Fingerprint Algorithm for Deduplication

Issues are deduplicated by:
1. Message pattern (normalized: strip URLs, numbers, hashes)
2. Exception type (app.log.error, app.log.warn, console.warning, session.stalled)
3. Exact message text (primary key)

Two issues with the same `Exception` + normalized `Message` are the same FUZZ-###.

## Phases

### PHASE 0 — SETUP AND BASELINE
- [x] Create PLANS.md
- [x] Create `.tmp/ci-fuzz/FUZZ_FIX_LOG.md`
- [x] Create `.tmp/ci-fuzz/LOGGING_AUDIT.md`
- [x] Enumerate all README.md files under `.tmp/ci-fuzz`
- [x] Record baseline state

### PHASE 1 — BRANCH-TO-MAIN DIFF AND LOGGING AUDIT
- [x] Fetch origin main
- [x] Generate patch `.tmp/ci-fuzz/_audit/current_vs_main.patch`
- [x] Identify all logging-related changes
- [x] Populate LOGGING_AUDIT.md
- [ ] Revert inappropriate logging suppression
- [ ] Commit reverts

### PHASE 2 — ISSUE EXTRACTION AND NORMALIZATION
- [ ] Parse all README.md files
- [ ] Extract issues.json
- [ ] Validate parsing

### PHASE 3 — DEDUPLICATION AND STABLE IDS
- [ ] Deduplicate by message signature
- [ ] Assign FUZZ-001…FUZZ-NNN stable IDs
- [ ] Generate CONSOLIDATED_FUZZ_ISSUES.md

### PHASE 4 — ROOT CAUSE MAPPING (NO FIXES YET)
- [ ] Map every FUZZ-### to code paths
- [ ] Update registry with evidence

### PHASE 5 — CONTROLLED FIX ROLLOUT
Priority order: crashes > unhandled exceptions > data corruption > functional > performance > cosmetic

- [ ] FUZZ-001 through FUZZ-NNN — fix one by one

### PHASE 6 — GLOBAL RECHECK AND PROOF COMPLETENESS
- [ ] Re-run parsing and dedup
- [ ] Verify every FUZZ-### has pre/post evidence, commit, test
- [ ] Ensure branch coverage ≥ 90%

## Root Cause Categories

### CAT-A: Connectivity failure errors (device/network unreachable)
Operations that fail because the C64U is temporarily unreachable.
Fix: `isRecoverableConnectivityError` in `uiErrors.ts` (KEEP as correct reclassification).
Evidence: IoT devices frequently become transiently unreachable; toast shown to user; classification is bounded and explicit.

### CAT-B: Optional capability absent
DiagnosticsBridge, songlengths, HVSC — these are optional features that may not be installed or configured.
Fix: Reclassify from warn/error to info (KEEP with evidence below).

### CAT-C: Expected startup-time degradation
Initial config snapshot, first-run states.
Fix: Reclassify to debug (KEEP with evidence).

### CAT-D: HVSC not configured
HVSC paged listing fallback, songlength bootstrap — expected when HVSC not set up.
Fix: Reclassify to info (CHANGE from prior agent's debug).

### CAT-E: Informational state change
API device host changed — normal initialization event.
Fix: Reclassify from warn to info (KEEP).

### CAT-F: Suppression violations to revert
`C64 API retry scheduled after idle failure`: must remain warn — important diagnostic.
`Category config fetch failed; falling back to item fetches`: must remain warn — marks degraded state.
Fix: REVERT these to warn.

### CAT-G: Silent catch violations to fix
`useC64Connection.ts` and `useAppConfigState.ts` silently drop per-category fetch exceptions.
Fix: Add debug-level logs.
