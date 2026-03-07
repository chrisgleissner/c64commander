# Physical Testing Investigation — Execution Plan

## Status: Complete

All 10 phases completed. Documentation produced under `doc/testing/investigations/physical-tests-2/`.


## Phases

### Phase 1: Repository Mapping — Complete

### Phase 2: c64stream Analysis — Complete

### Phase 3: c64bridge Analysis — Complete

### Phase 4: MCP Reuse Analysis — Complete

### Phase 5: Maestro Capability Analysis — Complete

### Phase 6: Signal Analysis Design — Complete

### Phase 7: Synthetic Program Design — Complete

### Phase 8: Architecture Comparison — Complete

### Phase 9: Recommendation Hardening — Complete

### Phase 10: Deduplication Pass — Complete


## Output Directory

`doc/testing/investigations/physical-tests-2/`

## Produced Documents

## Physical Testing Consolidation Plan

## Status

Complete.

## Objective

Consolidate the prior physical testing investigations into a single, deduplicated, evidence-based architecture for LLM-driven autonomous physical testing of the Android app against a real C64 Ultimate.

## Output Directory

`doc/testing/investigations/physical-tests-summary/`

## Phases

### Phase 1: Map source material
- [x] Inventory both investigation folders
- [x] Inventory companion repositories used by the investigations
- [x] Identify document equivalence and gaps

### Phase 2: Analyse physical-tests
- [x] Read every research document in `doc/testing/investigations/physical-tests/`
- [x] Extract architecture proposals, terminology, and unresolved questions
- [x] Record evidence references for later consolidation

### Phase 3: Analyse physical-tests-2
- [x] Read every research document in `doc/testing/investigations/physical-tests-2/`
- [x] Extract architecture proposals, terminology, and unresolved questions
- [x] Record evidence references for later consolidation

### Phase 4: Compare and reconcile investigations
- [x] Map equivalent documents across both investigations
- [x] Identify duplication and terminology drift
- [x] Identify conflicting conclusions requiring resolution

### Phase 5: Evaluate Android MCP reuse
- [x] Analyse `android-mcp-server`
- [x] Analyse `droidmind`
- [x] Analyse `mobile-mcp`
- [x] Select preferred Android MCP base and required extensions

### Phase 6: Analyse C64 control and observability reuse
- [x] Analyse `c64bridge` MCP architecture
- [x] Analyse `c64stream` stream protocol and implementation surfaces
- [x] Define c64bridge extension strategy using reuse > extend > rewrite

### Phase 7: Design consolidated architecture
- [x] Define top-level system architecture
- [x] Define orchestration model, observability model, and artifact model
- [x] Define deterministic verification and exploratory testing flows

### Phase 8: Produce consolidated document set
- [x] Create summary directory
- [x] Write required summary documents
- [x] Cross-reference instead of duplicating analysis

### Phase 9: Deduplicate and validate
- [x] Remove repeated content across documents
- [x] Verify internal consistency and evidence chains
- [x] Run required validation for documentation-only change set

## Deliverables

- `PHYSICAL_TESTS_RESEARCH.md`
- `ARCHITECTURE.md`
- `ARCHITECTURE_OPTIONS.md`
- `MCP_SERVER_EVALUATION.md`
- `ANDROID_MCP_SERVER_EVALUATION.md`
- `TEST_SIGNAL_STRATEGY.md`
- `SYNTHETIC_PROGRAM_STRATEGY.md`
- `WORK_LOG.md`
- `OPEN_QUESTIONS.md`
