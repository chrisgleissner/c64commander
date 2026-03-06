# PLANS.md - Reliability Architecture Investigation (C64 Commander)

## Metadata

- Date: 2026-03-06
- Investigator: Codex (GPT-5)
- Scope: Reliability analysis, code-path mapping, test-infrastructure analysis, deterministic reproduction planning
- Primary research artifact: `doc/testing/investigations/reliability-analysis.md`

## Status Markers

- `TODO` = not started
- `IN_PROGRESS` = active
- `DONE` = completion criteria met

## Numbered Task Plan

1. Repository reconnaissance and instruction alignment

- Status: `DONE`
- Deterministic completion criteria:
  - Reviewed repository agent/testing instructions and Maestro strategy docs.
  - Captured candidate module list for all six reliability issues.

2. Build issue-to-module inventory (static mapping)

- Status: `DONE`
- Deterministic completion criteria:
  - Issues 1-6 mapped to concrete files/functions.
  - Unknowns either resolved or explicitly documented in research hypotheses.

3. Deep dive Issue 1 (volume slider + mute state)

- Status: `DONE`
- Deterministic completion criteria:
  - UI controls, reducer, async queue, config-write path traced end-to-end.
  - Desync/race windows documented in research artifact.

4. Deep dive Issue 2 (auto-advance under lock/idle)

- Status: `DONE`
- Deterministic completion criteria:
  - Timeline guard, due scheduling, resume triggers, native background plugins traced.
  - Songlength and fallback-duration behavior verified.

5. Deep dive Issue 3 (button highlight persistence)

- Status: `DONE`
- Deterministic completion criteria:
  - Highlight attribute + timeout model traced.
  - Conditions for delayed/stuck visual state documented.

6. Deep dive Issue 4 (HVSC download + ingestion)

- Status: `DONE`
- Deterministic completion criteria:
  - Download buffering model, extraction model, ingestion orchestration traced.
  - Native vs non-native lifecycle and cancellation boundaries documented.

7. Deep dive Issue 5 (low-resource stability)

- Status: `DONE`
- Deterministic completion criteria:
  - Heavy allocation and synchronous processing hotspots cataloged.
  - Cross-issue low-RAM/low-CPU risk profile documented.

8. Deep dive Issue 6 (RAM dump/restore vs scripts)

- Status: `DONE`
- Deterministic completion criteria:
  - App restore request size/order/timeout/retry behavior compared against scripts.
  - Constraint gap (chunked transfer requirement) documented.

9. Test infrastructure and Maestro coverage analysis

- Status: `DONE`
- Deterministic completion criteria:
  - Unit, Playwright, Android JVM, and Maestro coverage mapped per issue.
  - CI gating behavior and default Maestro tag filtering analyzed.

10. Deterministic reproduction strategy design (Maestro-first)

- Status: `DONE`
- Deterministic completion criteria:
  - Reproduction designs prepared for issues 1-6 with preconditions/actions/assertions.
  - Device/emulator constraints included.

11. Write research document

- Status: `DONE`
- Deterministic completion criteria:
  - `doc/testing/investigations/reliability-analysis.md` created.
  - Contains all required sections (1-11) from task request.

12. Generate remediation execution roadmap

- Status: `DONE`
- Deterministic completion criteria:
  - Prioritized remediation proposals and Maestro flow additions documented.
  - Risk and performance considerations documented.

13. Verify artifact completeness

- Status: `DONE`
- Deterministic completion criteria:
  - Research artifact exists at required path.
  - All investigation tasks in this plan are marked `DONE`.
  - Work log references research artifact updates.

## Future remediation backlog (planned, not executed in this investigation)

- Implement strict volume-write state convergence in `useVolumeOverride` (operation token + readback confirmation).
- Extend auto-advance duration guard to non-song categories using configured duration.
- Add stale-highlight sweeper on lifecycle resume and route transitions.
- Refactor non-native zip ingestion to true streaming (avoid full extracted-file list).
- Reduce base64 overhead for large HVSC archive operations where native binary APIs are available.
- Implement chunked RAM restore (4-8 KiB default) with chunk-level retry and adaptive timeout.
- Add Maestro edge flows for volume/mute race, lock/idle auto-advance, HVSC lifecycle stress, RAM restore verification.

## Work Log

- 2026-03-06T08:25:43+00:00
  - Initialized investigation plan in `PLANS.md`.
  - Confirmed investigation scope and required final artifact path.

- 2026-03-06T08:26:10+00:00
  - Ran reconnaissance across repo and identified primary modules for playback, HVSC, background execution, RAM operations, and Maestro flows.
  - Earmarked final research output: `doc/testing/investigations/reliability-analysis.md`.

- 2026-03-06T08:28:00+00:00
  - Verified required policy/docs context: `.github/copilot-instructions.md`, `doc/testing/maestro.md`, `.maestro/config.yaml`.
  - Confirmed `doc/testing/investigations` directory did not exist and would need creation.

- 2026-03-06T08:30:00+00:00
  - Completed detailed Issue 1 mapping:
    - `src/pages/playFiles/hooks/useVolumeOverride.ts`
    - `src/pages/playFiles/components/VolumeControls.tsx`
    - `src/components/ui/slider.tsx`, `src/lib/ui/sliderBehavior.ts`
    - `src/pages/playFiles/volumeState.ts`, `src/pages/playFiles/playbackGuards.ts`.
  - Captured race/desync candidates for research doc.

- 2026-03-06T08:31:30+00:00
  - Completed Issue 2 playback/auto-advance lifecycle mapping:
    - `src/pages/PlayFilesPage.tsx` timeline reconciliation and due handling.
    - `src/pages/playFiles/hooks/usePlaybackController.ts` duration + guard logic.
    - Native bridge stack: background execution JS + Android + iOS plugins/services.
  - Verified category guard uses `isSongCategory` (`sid|mod`) only.

- 2026-03-06T08:32:30+00:00
  - Completed Issue 3 highlight model mapping:
    - `src/lib/ui/buttonInteraction.ts`, `src/components/ui/button.tsx`, `src/index.css`, `src/App.tsx`.
  - Noted timer-based clear behavior and persistent-active bypass path.

- 2026-03-06T08:33:30+00:00
  - Completed Issue 4/5 HVSC and low-resource mapping:
    - `src/lib/hvsc/hvscIngestionRuntime.ts`, `hvscDownload.ts`, `hvscArchiveExtraction.ts`, `hvscFilesystem.ts`, `hvscBrowseIndexStore.ts`.
    - `src/pages/playFiles/hooks/useHvscLibrary.ts` UI/runtime interaction.
    - Android ingestion implementation in `HvscIngestionPlugin.kt`.
  - Identified memory-heavy patterns (full buffers, zip materialization, base64 conversions, snapshot serialization).

- 2026-03-06T08:34:30+00:00
  - Completed Issue 6 RAM mapping and script comparison:
    - `src/lib/machine/ramOperations.ts`, `src/lib/c64api.ts`, `src/pages/home/hooks/useHomeActions.ts`.
    - `scripts/ram_read.py`, `scripts/ram_write.py`, `scripts/ram_roundtrip_verify.py`.
  - Confirmed app restore path uses full 64 KiB write size and 15s API timeout.

- 2026-03-06T08:35:30+00:00
  - Completed test infrastructure coverage analysis:
    - Unit tests (volume/guards/background/HVSC/RAM).
    - Playwright reliability coverage (`playwright/playback.spec.ts`, `playwright/buttonHighlightProof.spec.ts`, etc.).
    - Maestro coverage and CI gating (`.maestro/*`, `scripts/run-maestro-gating.sh`).
  - Documented Maestro gaps for requested stress scenarios.

- 2026-03-06T08:36:45+00:00
  - Authored full research artifact: `doc/testing/investigations/reliability-analysis.md`.
  - Added executive summary, exact code locations, architecture descriptions, coverage analysis, hypotheses, deterministic repro strategies, proposed fixes, proposed Maestro flows, risk and performance sections.

- 2026-03-06T08:37:28+00:00
  - Finalized `PLANS.md` statuses and verification gate.
  - Marked all investigation tasks complete and recorded remediation backlog for follow-on implementation phase.
