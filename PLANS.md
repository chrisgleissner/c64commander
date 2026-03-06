# PLANS.md — Reliability Architecture Investigation (C64 Commander)

## Metadata
- Date: 2026-03-06
- Investigator: Codex (GPT-5)
- Scope: Reliability analysis and remediation planning only (no production fixes in this task)
- Primary artifact: `doc/testing/investigations/reliability-analysis.md`

## Status Markers
- `TODO` = not started
- `IN_PROGRESS` = actively executing
- `DONE` = completion criteria met

## Numbered Task Plan

1. Repository reconnaissance and instruction alignment
- Status: `DONE`
- Deterministic completion criteria:
  - Confirmed guidance files reviewed (`AGENTS.md`, `.github/copilot-instructions.md`, `README.md`, `doc/testing/maestro.md`).
  - Initial candidate module list captured for all six issues.

2. Build issue-to-module inventory (static mapping pass)
- Status: `IN_PROGRESS`
- Deterministic completion criteria:
  - Each issue (1-6) mapped to concrete source files and primary functions/classes.
  - Unknowns recorded as explicit follow-up probes.

3. Deep dive Issue 1 (volume slider + mute state desynchronization)
- Status: `TODO`
- Deterministic completion criteria:
  - UI controls, state reducer, async update path, and C64 config write path traced end-to-end.
  - Potential race windows and desync points documented with file references.

4. Deep dive Issue 2 (playback auto-advance reliability under idle/lock/background)
- Status: `TODO`
- Deterministic completion criteria:
  - Timer/lifecycle/background execution paths identified for web + native.
  - Songlength vs fallback-duration decision path confirmed.
  - Failure hypotheses for lock/idle scenarios documented.

5. Deep dive Issue 3 (button highlight stuck state)
- Status: `TODO`
- Deterministic completion criteria:
  - Highlight implementation path and timeout/animation cancellation semantics traced.
  - Conditions that can leave persistent highlighted state identified.

6. Deep dive Issue 4 (HVSC download + ingestion reliability/memory)
- Status: `TODO`
- Deterministic completion criteria:
  - Download buffering model, archive extraction model, and ingestion pipeline steps mapped.
  - Background/lifecycle effects and cancellation boundaries documented.
  - Crash/stall hypotheses on low-memory devices documented.

7. Deep dive Issue 5 (low-resource device stability cross-cutting analysis)
- Status: `TODO`
- Deterministic completion criteria:
  - Heavy allocations, long synchronous loops, and large in-memory datasets cataloged.
  - Cross-issue scaling risks for `<1GB RAM / <=2 cores` summarized.

8. Deep dive Issue 6 (C64U RAM dump/restore failure vs working scripts)
- Status: `TODO`
- Deterministic completion criteria:
  - App chunking/order/timing logic compared against scripts in `scripts/`.
  - Plausible root-cause deltas listed with concrete request sequencing differences.

9. Test infrastructure and Maestro coverage analysis
- Status: `TODO`
- Deterministic completion criteria:
  - Existing unit/Playwright/Maestro coverage mapped to each issue.
  - Missing deterministic stress scenarios documented.

10. Deterministic reproduction strategy design (Maestro-first)
- Status: `TODO`
- Deterministic completion criteria:
  - Repro flow proposals for each issue contain exact preconditions, actions, and assertions.
  - Device/emulator vs real-device constraints explicitly documented.

11. Write research document
- Status: `TODO`
- Deterministic completion criteria:
  - `doc/testing/investigations/reliability-analysis.md` created with required sections:
    1) executive summary, 2) issue descriptions, 3) exact code locations, 4) architecture descriptions,
    5) current test coverage, 6) failure hypotheses, 7) deterministic repro strategies,
    8) proposed fixes, 9) proposed Maestro flows, 10) risk analysis, 11) performance/memory considerations.

12. Finalize remediation execution roadmap in this plan
- Status: `TODO`
- Deterministic completion criteria:
  - All numbered tasks marked `DONE`.
  - Work log complete and references research document updates.
  - Future implementation task backlog included with verification gates.

## Work Log

- 2026-03-06T08:25:43+00:00
  - Initialized investigation plan for this task in `PLANS.md`.
  - Confirmed instruction sources and test-doc prerequisites reviewed.
  - Next step: execute Task 2 static mapping and feed findings into `doc/testing/investigations/reliability-analysis.md`.

- 2026-03-06T08:26:10+00:00
  - Reconnaissance commands executed: top-level repo inventory and broad `rg` scans for volume/mute, auto-advance/lifecycle, highlight/button interaction, HVSC ingestion/download, RAM operations, and Maestro flows.
  - Identified primary candidate files:
    - `src/pages/PlayFilesPage.tsx`
    - `src/pages/playFiles/hooks/useVolumeOverride.ts`
    - `src/pages/playFiles/hooks/usePlaybackController.ts`
    - `src/lib/native/backgroundExecution*`
    - `src/lib/hvsc/*` and `android/app/src/main/java/uk/gleissner/c64commander/HvscIngestionPlugin.kt`
    - `src/lib/machine/ramOperations.ts`
    - `scripts/ram_read.py`, `scripts/ram_write.py`, `scripts/ram_roundtrip_verify.py`
    - `.maestro/*.yaml` including `smoke-background-execution.yaml`, `smoke-hvsc-lowram.yaml`, `edge-playlist-manipulation.yaml`.
  - Research document path earmarked: `doc/testing/investigations/reliability-analysis.md`.
