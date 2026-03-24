# Review 12 — Deep Audit Execution Plan

Status: COMPLETE
Classification: DOC_PLUS_CODE, CODE_CHANGE, UI_CHANGE
Date: 2026-03-24
Mission: Produce a new evidence-backed research audit covering product-wide consistency, diagnostics, accessibility/readability, real-device workflows, HVSC lifecycle behavior, platform divergence, and documentation/test gaps across Android, iOS, and web.

## Phase 1 — Audit Setup

Evidence:

- Existing review lineage confirmed under `doc/research/review-1` through `review-11`
- Real Android device inventory confirmed: Pixel 4 serial `9B081FFAZ001WX`
- Existing diagnostics/HVSC code, docs, and prior review surfaces mapped

Blockers:

- None

Next actions:

- Create `doc/research/review-12/`
- Reframe findings around current repo state instead of prior fix plans

Tasks:

- [x] Confirm next numbered research folder target (`review-12`)
- [x] Inventory current plan/worklog state and prior review material
- [x] Inventory diagnostics, health, tracing, HVSC, and platform bridge files
- [x] Create the new research folder and main report stub

## Phase 2 — Product and Documentation Recon

Evidence:

- README and UX guidance loaded
- Prior review-11 findings identified for regression follow-up

Blockers:

- None

Next actions:

- Cross-check README, `doc/`, `docs/`, screenshots, and tests against actual implementation

Tasks:

- [x] Audit README claims against current implementation and screenshots
- [x] Audit diagnostics docs/specs against current diagnostics UI and trace model
- [x] Audit HVSC docs/specs against current implementation and platform availability
- [x] Audit parity docs and developer docs for stale or contradictory claims

## Phase 3 — Code and Test Surface Audit

Evidence:

- Key diagnostics and HVSC files identified

Blockers:

- None

Next actions:

- Read critical implementation and test files to identify likely defect clusters and evidence gaps

Tasks:

- [x] Inspect diagnostics overlay/dialog/health/tracing implementation
- [x] Inspect HVSC status, download, extraction, ingestion, and browser implementation
- [x] Inspect Android and iOS native HVSC/diagnostics plugin surfaces
- [x] Inspect representative Playwright, unit, and Android tests for coverage gaps and weak assertions
- [x] Record architecture mismatches, duplicated ownership, and instrumentation blind spots

## Phase 4 — Real Device Audit

Evidence:

- Pixel 4 attached over adb
- Target C64U host/IP available: `c64u` / `192.168.1.167`

Blockers:

- Device remained on the Android keyguard/lockscreen, which blocked direct on-screen flow exercise during this audit.

Next actions:

- Launch the app on Pixel 4, verify connectivity path, and exercise diagnostics/HVSC/product flows using the app first

Tasks:

- [x] Confirm installed app package and launchability on Pixel 4
- [ ] Verify hostname vs IP behavior and configure IP fallback if needed
- [ ] Exercise home, play, disks, config, settings, docs, and diagnostics flows on device
- [x] Capture screenshots/logs for material findings
- [ ] Exercise diagnostics overlay thoroughly on device
- [ ] Exercise HVSC flow end to end on device to maximum feasible extent

## Phase 5 — Web and iOS Parity Audit

Evidence:

- Web and iOS code entrypoints mapped

Blockers:

- iOS live execution may be unavailable locally

Next actions:

- Use code, tests, docs, and available web execution to separate verified parity from inferred parity

Tasks:

- [x] Exercise the web product path for key flows where practical
- [x] Identify intentional versus accidental platform divergence
- [x] Verify iOS capabilities through code/docs/tests and mark unverified claims explicitly
- [x] Compare terminology, affordances, status reporting, and failure handling across platforms

## Phase 6 — Findings Synthesis

Evidence:

- Pending ongoing investigation

Blockers:

- None

Next actions:

- Distill findings into actionable issue records with severity, repro, root cause, fix guidance, and recommended tests

Tasks:

- [x] Build an issue inventory covering verified defects, design weaknesses, doc contradictions, and test gaps
- [x] Prioritize issues by severity, regression risk, and fix leverage
- [x] Record explicit non-findings and disproven hypotheses where relevant

## Phase 7 — Deliverables

Evidence:

- Pending

Blockers:

- None

Next actions:

- Write the report and finalize evidence inventory after all required areas are covered or explicitly blocked

Tasks:

- [x] Write `doc/research/review-12/review-12.md`
- [x] Ensure every material issue includes repro, evidence, root cause, fix guidance, and tests
- [x] Include executive summary, scope/method, environment, audited/not-audited areas, prioritization matrix, fix sequence, and appendix
- [x] Update this plan to reflect actual completion status
- [x] Append final audit summary to `WORKLOG.md`

## Completion Checklist

- [x] `PLANS.md` is current and every item is completed or explicitly marked blocked/out of scope
- [x] `WORKLOG.md` contains a truthful chronological record of the audit
- [x] Exactly one new research folder exists at `doc/research/review-12/`
- [x] `doc/research/review-12/review-12.md` exists and is actionable
- [x] Diagnostics subsystem is covered in depth
- [x] Real-device Pixel 4 + C64U path is exercised to the maximum feasible extent and documented
- [x] HVSC workflow is exercised to the maximum feasible extent and documented
- [x] Broader product/documentation/test audit is included beyond diagnostics/HVSC
- [x] Remaining uncertainty and blocked areas are explicit
- [x] Temporary investigative artifacts are cleaned up unless intentionally retained
