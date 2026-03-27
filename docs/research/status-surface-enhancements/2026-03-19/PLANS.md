# Status Surface Enhancement — Execution Plan

## Phase 1: Current State Analysis

**Inputs**: Codebase (`healthModel.ts`, `c64Liveness.ts`, `UnifiedHealthBadge.tsx`, `DiagnosticsDialog.tsx`, `connectionManager.ts`, `hostEdit.ts`, `c64api.ts`, `c64u-config.yaml`, `c64u-openapi.yaml`)
**Tasks**:
- [x] Map existing health model (HealthState, ConnectivityState, contributors)
- [x] Map existing liveness check (Jiffy + Raster in `c64Liveness.ts`)
- [x] Map existing badge rendering (`UnifiedHealthBadge.tsx`)
- [x] Map existing diagnostics dialog structure
- [x] Map existing connection management (`connectionManager.ts`, `hostEdit.ts`)
- [x] Map config read/write API surface (`c64api.ts` → `setConfigValue`, `getConfigItem`, `updateConfigBatch`)
- [x] Map LED Strip Intensity config (category: `LED Strip Settings` / `Keyboard Lighting`, item: `Strip Intensity`, range: 0–31)
- [x] Map Audio Mixer config (category: `Audio Mixer`, items: `Vol UltiSid 1/2`, options list with OFF through +6 dB)
**Outputs**: Current state bullets in analysis.md §1
**Completion**: All surfaces mapped, documented as ≤15 bullets — DONE

## Phase 2: Health Check Spec

**Inputs**: Phase 1 outputs, liveness model, REST API spec
**Tasks**:
- [x] Define trigger conditions (manual, auto-on-connect, periodic)
- [x] Define 4-check state machine (REST → Jiffy → Raster → Config Roundtrip)
- [x] Define decision logic including config impact on overall health
- [x] Define timing model with ≤2s budget
- [x] Define compact and expanded UI representations
**Outputs**: Health check spec in analysis.md §2
**Completion**: All 4 checks deterministic, timing bounded, UI defined — DONE

## Phase 3: Config Roundtrip Spec

**Inputs**: Phase 1 config mapping, c64u-config.yaml, API endpoints
**Tasks**:
- [x] Define primary target: LED Strip Settings → Strip Intensity (numeric 0–31)
- [x] Define fallback target: Audio Mixer → Vol UltiSid 1 (option list)
- [x] Define detection logic (attempt category fetch, check for item presence)
- [x] Define mutation algorithm (read → compute V' → write → verify → restore → verify)
- [x] Define safety guarantees (restore-on-failure, ≤2s bound, retry-safe)
- [x] Define UX visibility (LED flicker hint, subtle audio note)
**Outputs**: Config roundtrip spec in analysis.md §3
**Completion**: Primary + fallback fully deterministic, safety proven — DONE

## Phase 4: Connection Management Spec

**Inputs**: Phase 1 connection mapping, `connectionManager.ts`, `hostEdit.ts`
**Tasks**:
- [x] Define reconnect flow (retry current host, inline result display)
- [x] Define change-device flow (editable host+port, pre-validation, commit-on-success)
- [x] Define integration with existing diagnostics dialog
**Outputs**: Connection management spec in analysis.md §4
**Completion**: Both flows fully defined with error handling — DONE

## Phase 5: Feature Brainstorm

**Inputs**: All prior phases, UX guidelines, existing app capabilities
**Tasks**:
- [x] Brainstorm exactly 20 concrete feature extensions
- [x] Each feature: ID, name, 1-sentence description, category
**Outputs**: Feature list in analysis.md §5
**Completion**: Exactly 20 features, no vague ideas — DONE

## Phase 6: Scoring Matrix

**Inputs**: Phase 5 feature list
**Tasks**:
- [x] Score each feature on: User Value (1–5), Implementation Effort (1–5 inverse), Risk (1–5 inverse), Synergy (1–5)
- [x] Compute composite score
- [x] Sort descending
**Outputs**: Scoring matrix in analysis.md §6
**Completion**: All 20 scored, sorted — DONE

## Phase 7: Top 5 Selection

**Inputs**: Phase 6 scored matrix
**Tasks**:
- [x] Select top 5 by composite score
- [x] Justify each selection in 1–2 sentences
**Outputs**: Top 5 in analysis.md §7
**Completion**: Top 5 justified — DONE

## Phase 8: Final Spec Assembly

**Inputs**: All phases
**Tasks**:
- [x] Assemble status surface model
- [x] Document edge cases (9 mandatory cases)
- [x] Add terminology section
- [x] Final review pass for density and correctness
**Outputs**: Complete analysis.md §8–10
**Completion**: Document complete, all termination criteria met — DONE
