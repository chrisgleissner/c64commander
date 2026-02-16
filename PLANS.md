# iOS CI Workflow Optimization Plan

## Executive Summary

Restructure the iOS Maestro test workflow from a 9-job single-flow matrix to a 4-job grouped matrix, reducing total wall-clock time by eliminating redundant simulator lifecycle operations.

---

## 1. Baseline Analysis

### Current Architecture

| Parameter | Value |
|-----------|-------|
| Total flows (N) | 9 |
| Concurrency limit (P) | 4 macOS jobs |
| Matrix strategy | 1 flow per job |
| Waves required | ceil(9/4) = 3 |

### Current Runtime Model

```
T_current = ceil(N/P) × D
          = ceil(9/4) × D
          = 3 × D
```

Where `D` = per-job duration comprising:
- `O` = per-job overhead (simulator creation, boot, app install, shutdown, delete)
- `F` = actual flow runtime

```
D = O + F
T_current = 3 × (O + F) = 3O + 3F
```

### Observed Timing (from CI logs)

| Phase | Estimated Duration |
|-------|-------------------|
| Simulator creation + boot | 60-120s |
| App install | 10-30s |
| Flow execution | 30-120s |
| Shutdown + delete | 15-30s |
| **Total per job (D)** | ~8-10 minutes |

**Estimated T_current**: ~24-30 minutes (3 waves × 8-10 min)

---

## 2. Proposed Architecture

### Grouped Matrix Strategy

Partition 9 flows into 4 groups (matching P=4 concurrency):

| Group | Flows | Count |
|-------|-------|-------|
| group-1 | ios-smoke-launch, ios-playback-basics, ios-diagnostics-export | 3 |
| group-2 | ios-ftp-browse, ios-local-import | 2 |
| group-3 | ios-secure-storage-persist, ios-import-playback | 2 |
| group-4 | ios-hvsc-browse, ios-config-persistence | 2 |

### Grouped Runtime Model

```
T_grouped = max(O + k_i × F) for all groups i
```

Where `k_i` = number of flows in group i.

Worst case: group-1 with k=3 flows.

```
T_grouped ≈ O + 3F
```

### Savings Analysis

```
Savings = T_current - T_grouped
        = 3O + 3F - O - 3F
        = 2O
```

**Expected savings**: 2 × overhead ≈ 2 × (60-120s + 10-30s + 15-30s) ≈ **3-5 minutes**

More significantly, we reduce from 3 waves to 1 wave:
- All 4 groups run in parallel
- No waiting for subsequent waves
- Deterministic job count (always 4)

---

## 3. Implementation Plan

### 3.1 Workflow Changes (`.github/workflows/ios-ci.yaml`)

#### Matrix Definition

```yaml
strategy:
  fail-fast: false
  matrix:
    group:
      - name: group-1
        flows: "ios-smoke-launch,ios-playback-basics,ios-diagnostics-export"
      - name: group-2
        flows: "ios-ftp-browse,ios-local-import"
      - name: group-3
        flows: "ios-secure-storage-persist,ios-import-playback"
      - name: group-4
        flows: "ios-hvsc-browse,ios-config-persistence"
```

#### Per-Group Job Flow

1. Create and boot simulator (once)
2. Install app (once)
3. For each flow in group:
   - Run Maestro flow
   - Collect artifacts to `artifacts/ios/<flow>/`
   - Record per-flow timing
4. Shutdown and delete simulator (once)
5. Upload group artifacts

### 3.2 Script Changes (`scripts/ci/ios-maestro-run-flow.sh`)

Add `--flows` parameter for comma-separated flow list:

```bash
--flows "flow1,flow2,flow3"  # Multi-flow mode
--flow "single-flow"         # Single-flow mode (backward compatible)
```

When `--flows` is used:
- Accept app already installed (skip install per-flow)
- Record per-flow timing to separate directories
- Produce group-level timing summary

### 3.3 Timing Instrumentation

#### Per-Flow Timing (`artifacts/ios/<flow>/timing.json`)

```json
{
  "flow": "ios-smoke-launch",
  "group": "group-1",
  "startMs": 1708090000000,
  "endMs": 1708090030000,
  "durationMs": 30000,
  "exitCode": 0
}
```

#### Group Timing (`artifacts/ios/_infra/<group>/timing.json`)

```json
{
  "group": "group-1",
  "flows": ["ios-smoke-launch", "ios-playback-basics", "ios-diagnostics-export"],
  "simulator_boot_seconds": 85,
  "app_install_seconds": 15,
  "per_flow_seconds": {
    "ios-smoke-launch": 30,
    "ios-playback-basics": 45,
    "ios-diagnostics-export": 25
  },
  "total_job_seconds": 215,
  "exitCodes": {
    "ios-smoke-launch": 0,
    "ios-playback-basics": 0,
    "ios-diagnostics-export": 0
  }
}
```

---

## 4. Risk Analysis

| Risk | Mitigation |
|------|------------|
| Flow isolation loss | Each flow gets separate artifact directory; failure in one flow doesn't affect others in same group |
| Increased job duration timeout | Increase timeout from 30min to 45min per job |
| Simulator state pollution between flows | App reinstall between flows if needed; flows designed to be independent |
| Artifact naming collision | Use flow name in artifact path, not group name |
| JUnit aggregation complexity | Aggregate job already handles per-flow junit.xml; no changes needed |

---

## 5. Validation Plan

### Pre-Merge Validation

1. **Syntax check**: `actionlint .github/workflows/ios-ci.yaml`
2. **Script check**: `shellcheck scripts/ci/ios-maestro-run-flow.sh`
3. **Local test**: Run modified script locally with `--flows` parameter

### Post-Merge Validation

1. **Timing comparison**: Compare T_grouped vs T_current from CI logs
2. **Artifact integrity**: Verify all 9 flow artifacts present
3. **JUnit merge**: Verify aggregate job produces correct merged report
4. **Rollout gate**: Verify Stage A/B/C behavior unchanged

### Success Criteria

- [ ] All 9 flows execute successfully
- [ ] Total wall-clock time reduced
- [ ] All artifacts present and correctly structured
- [ ] JUnit aggregation works
- [ ] Timing instrumentation produces valid JSON

---

## 6. Rollback Strategy

If issues arise:

1. **Immediate**: Revert the workflow YAML change
2. **Artifact path changes**: Revert script changes
3. **Partial rollback**: Keep timing instrumentation, revert grouping

Rollback is straightforward: the single-flow matrix is preserved as comments in the workflow file.

---

## 7. Mathematical Summary

### Current Model

```
T_current = ceil(N/P) × D
          = ceil(9/4) × (O + F)
          = 3O + 3F
```

### Grouped Model

```
T_grouped = O + max(k_i) × F
          = O + 3F
```

### Improvement

```
ΔT = T_current - T_grouped
   = 3O + 3F - O - 3F
   = 2O

Improvement % = (2O / (3O + 3F)) × 100
```

With O ≈ 2 minutes and F ≈ 1 minute:
```
ΔT = 4 minutes
Improvement % = (4 / 9) × 100 ≈ 44%
```

**Expected wall-clock reduction**: ~25 min → ~15 min (40% improvement)

---

## 8. Implementation Checklist

- [ ] Create PLANS.md (this file)
- [ ] Modify `.github/workflows/ios-ci.yaml` with grouped matrix
- [ ] Modify `scripts/ci/ios-maestro-run-flow.sh` for multi-flow support
- [ ] Add timing instrumentation
- [ ] Verify artifact structure preserved
- [ ] Verify JUnit aggregation works
- [ ] Test locally if possible
- [ ] Commit and observe CI run
