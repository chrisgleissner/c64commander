# Slider Responsiveness Stabilization — Research Plan

## Classification

`DOC_ONLY` — research-only investigation. No source-code changes are made by this task.

## Problem Statement

- The Home page **CPU Speed** slider feels considerably more laggy than the equivalent Config page CPU Speed slider, and sometimes becomes effectively non-responsive indefinitely.
- The Home page **SID Volume / Pan** sliders feel consistently fast.
- We need an evidence-driven explanation, a complete inventory of all slider-like controls in the project, and a stabilization design that can be implemented in a follow-up task.

## Deliverables

1. `PLANS.md` (this file) — authoritative phased plan, kept in sync with progress.
2. `WORKLOG.md` — investigation notes, commands, evidence.
3. `docs/research/stabilization/slider-responsiveness/research.md` — final research document with inventory, root-cause analysis, options, recommendation, validation plan, and acceptance criteria.

No source-code changes. No commits. No branches.

## Phases

| #   | Phase                                                                                                                         | Status | Output / Evidence                                                                                                                                                                                                                                                                   |
| --- | ----------------------------------------------------------------------------------------------------------------------------- | ------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Establish workspace and ground truth (read CLAUDE.md / .github/copilot-instructions.md, AGENTS.md, identify slider primitive) | done   | [src/components/ui/slider.tsx](src/components/ui/slider.tsx); [src/lib/ui/sliderBehavior.ts](src/lib/ui/sliderBehavior.ts); [src/lib/ui/sliderDeviceAdapter.ts](src/lib/ui/sliderDeviceAdapter.ts)                                                                                  |
| 2   | Exhaustive slider inventory (search all `<Slider`, `IonRange`, `type="range"`, slider field paths)                            | done   | All call sites enumerated: HomePage, SidCard via AudioMixer, ConfigItemRow (Config page), VolumeControls (Play page), PlaybackSettingsPanel (duration), LightingSummaryCard, LightingStudioDialog, SettingsPage (notification duration). No Ionic / native range usage found.       |
| 3   | Trace Home page CPU Speed end-to-end (UI → state → commit → REST → reconciliation → re-enable)                                | done   | [src/pages/HomePage.tsx:194-218,748-778,866,894-897,1056-1080](src/pages/HomePage.tsx#L194-L1080); [src/hooks/useInteractiveConfigWrite.ts](src/hooks/useInteractiveConfigWrite.ts); [src/hooks/useAuthoritativeConfigValueState.ts](src/hooks/useAuthoritativeConfigValueState.ts) |
| 4   | Trace Config page CPU Speed end-to-end                                                                                        | done   | [src/pages/ConfigBrowserPage.tsx:268-293,587-604](src/pages/ConfigBrowserPage.tsx#L268-L604); [src/components/ConfigItemRow.tsx:413-491](src/components/ConfigItemRow.tsx#L413-L491); [src/hooks/useC64Connection.ts:359-374](src/hooks/useC64Connection.ts#L359-L374)              |
| 5   | Trace Home page SID slider (Volume / Pan)                                                                                     | done   | [src/pages/home/components/AudioMixer.tsx:177-283,470-528](src/pages/home/components/AudioMixer.tsx#L177-L528); [src/pages/home/SidCard.tsx:233-281](src/pages/home/SidCard.tsx#L233-L281)                                                                                          |
| 6   | Differential analysis (state ownership, disable logic, write path, reconciliation strategy)                                   | done   | Captured in research.md "Behavioural Differences" section.                                                                                                                                                                                                                          |
| 7   | Categorise root-cause candidates by confidence                                                                                | done   | Captured in research.md "Root-Cause Candidates" section.                                                                                                                                                                                                                            |
| 8   | Draft three implementation options (minimal fix, shared hook, config-field-level normalisation)                               | done   | research.md "Implementation Options".                                                                                                                                                                                                                                               |
| 9   | Recommend a preferred approach with rationale and follow-up task list                                                         | done   | research.md "Recommended Approach".                                                                                                                                                                                                                                                 |
| 10  | Define test/validation plan and acceptance criteria                                                                           | done   | research.md "Test And Validation Plan" + "Acceptance Criteria".                                                                                                                                                                                                                     |

## Open Questions

All five questions from the initial draft were resolved by direct REST experimentation against `u64` (fw 3.14e) and `c64u` (fw 1.1.0). See "Empirical Device Findings" in the research document and the second worklog entry for raw transcripts. Resolutions, in short:

1. **Firmware echo format** — bytes-identical on the happy path. **Type drift** (numeric vs string) is the real `Object.is` hazard.
2. **Drag-time CPU Speed previews** — firmware-acceptable but UX-undesirable; CPU Speed is `commitOnly`. SID and Lighting stay `throttled`.
3. **Auto-Turbo-Control batching** — the firmware accepts a single batch payload `{"CPU Speed": ..., "Turbo Control": ...}` atomically (54 ms). We should always batch.
4. **Lighting slider disable pattern** — confirmed as latent dead code (no `setConfigOverride` for those items), so currently inert; clean up in the consolidation pass.
5. **Pending memo** — replace with a write-mutation-bound registry as part of the consolidation; remove its slider call sites.

## Phase 11 — Consolidation research (added 2026-05-06)

| #   | Phase                                                                                                                        | Status | Output / Evidence                                                                      |
| --- | ---------------------------------------------------------------------------------------------------------------------------- | ------ | -------------------------------------------------------------------------------------- |
| 11  | Empirical device probing of `u64` and `c64u` (CPU Speed format, batch behaviour, latency, error-array semantics, type drift) | done   | `WORKLOG.md` empirical findings entry; `research.md` "Empirical Device Findings" table |
| 12  | Identify overengineering / parallel mechanisms                                                                               | done   | `research.md` "Overengineering And Consolidation"                                      |
| 13  | Codify UX-first slider invariants and per-domain interaction style                                                           | done   | `research.md` "UX-First Slider Behaviour Model"                                        |
| 14  | Design `useDeviceBoundSlider` hook + five-step consolidation plan                                                            | done   | `research.md` "Consolidated Implementation Plan"                                       |
| 15  | Update Recommended Approach to consolidation; preserve Option 1 as fallback                                                  | done   | `research.md` "Recommended Approach"                                                   |
| 16  | Extend acceptance criteria (11–16) covering c64api correctness, validator, watchdog, no-pending-disable                      | done   | `research.md` "Updated Acceptance Criteria (consolidation)"                            |

### Empirical hazard discovered (must be flagged for the implementer)

Sending an invalid CPU Speed value inside a `POST /v1/configs` batch took the `u64` device offline for the rest of the session (TCP refused, ICMP ping 100% loss). Implementers must (a) reboot u64 manually before validation, and (b) treat client-side option validation as a release blocker.

## Out of Scope

- Implementation. This task is research-only.
- Refreshing screenshots, running tests, or modifying source code.
- Investigating non-slider responsiveness issues.
- Recovering `u64` (must be done out-of-band before the implementation phase begins).

## Steering TODO — 2026-05-06

- TODO: For Telnet-related work, consult [docs/c64/c64u-telnet.yaml](/home/chris/dev/c64/c64commander/docs/c64/c64u-telnet.yaml) as source of truth before changing behavior or tests, and correct the C64U action label in [tests/unit/telnet/telnetActionExecutor.test.ts](/home/chris/dev/c64/c64commander/tests/unit/telnet/telnetActionExecutor.test.ts) to `Reboot (Clr Mem)`.
