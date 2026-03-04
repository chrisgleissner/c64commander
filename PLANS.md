# FUZZ Fix Plan

## Phases and Gates

### Phase 0 - Setup and Baseline

Gate: PLANS.md exists, FUZZ_FIX_LOG.md baseline captured, README inventory recorded.

### Phase 1 - Extraction and Normalization

Gate: issues.json includes all issues from all fuzz README files with source anchors/excerpts.

### Phase 2 - Deduplication and Stable IDs

Gate: deduplicated issues created with stable FUZZ IDs and consolidated registry mapped to all occurrences.

### Phase 3 - Root Cause Mapping (No Fixes)

Gate: each FUZZ issue mapped to exact code path with evidence-backed root-cause hypothesis.

### Phase 4 - Controlled Fix Rollout

Gate: each issue closed one at a time using full fix protocol and proof logged.

### Phase 5 - Re-run and Consistency

Gate: all issues closed, logs complete, commits present, termination conditions satisfied.

## Issue Inventory Status

- README inventory: 16 files
- Raw extracted issues: 474
- Deduplicated issues: 92
- Root-cause mapped: 75/92 direct code matches, 17 pending targeted instrumentation/search

## Current Task Pointer

- Phase 4 controlled rollout, active issue: FUZZ-005 (session.stalled session-timeout/no-action family)

## Risks and Mitigations

- Risk: nondeterministic fuzz traces; Mitigation: build deterministic harnesses per issue.
- Risk: duplicate reports; Mitigation: deterministic fingerprinting across message/stack/path.

## Verification Transcript Pointers

- See .tmp/ci-fuzz/FUZZ_FIX_LOG.md
- Parsed artifacts: .tmp/ci-fuzz/_parsed/issues.json
- Deduplicated artifacts: .tmp/ci-fuzz/_parsed/deduplicated_issues.json
- Root cause mapping: .tmp/ci-fuzz/_parsed/root_cause_mapping.json
