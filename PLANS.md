# C64 Commander Prod Hardening 8 Fix Plan

## Objective
Fix the confirmed prod-hardening-8 production-readiness findings in priority order, without widening scope beyond the issues documented in `docs/research/stabilization/prod-hardening-8/research.md`.

## Classification
- Repository file-change classification: `DOC_PLUS_CODE`.
- Visible app classification: `UI_CHANGE` for health/status copy, saved-device rows, and Settings refresh gating.
- Runtime platforms: web, Android, and iOS shared React behavior; Android is the only locally buildable/deployable native target.
- Screenshots: refresh only if documented screenshots become inaccurate. Current expectation is no docs screenshot refresh unless visible documented surfaces materially change.

## Impact Map
- Source: saved-device storage/health checks, connection manager, connection hooks, health rollup, Settings connection UI, diagnostics export, native bridge if needed.
- Tests: focused Vitest/component tests for connection/saved-device behavior and diagnostics export; shell/script tests for Maestro and c64scope harness changes.
- Scripts: `scripts/run-maestro.sh`, c64scope npm scripts and HIL entrypoints, Android logcat/HIL helpers as needed.
- Maestro: `.maestro/local-binary-playback-proof.yaml` only if needed for PH8-009.
- Docs: update test/harness docs only where command behavior changes.
- Hardware validation: prefer U64 for app/HIL proof; use c64u only for bounded low-frequency read-only probes after mitigations are present.

## Safety Constraints
- Do not run storms, destructive actions, reboot, power cycle, factory reset, flash reset, rapid repeated mutations, or blind retries on c64u.
- Treat c64u as fragile until proven healthy; probe `u64` first, then `c64u` only with safe bounded `/v1/info` checks.
- Do not weaken back-off, safety gating, or diagnostics visibility.
- Every caught exception must log with context or rethrow with context.
- Add deterministic regression coverage for every fixed issue.

## Finding Plan
| Finding | Plan | Status |
| --- | --- | --- |
| PH8-002 | Root-cause switch/discovery probe behavior; add pacing/back-off/circuit breaker evidence for fragile targets. | implemented; focused tests passed |
| PH8-001 | Ensure saved-device selection applies the selected host/ports and reconciles runtime health from `/v1/info`. | implemented; focused tests passed |
| PH8-003 | Prevent Healthy from implying verified identity while product/firmware are unavailable. | implemented; focused tests passed |
| PH8-006 | Gate/coalesce Settings manual refresh while discovery is in flight and after failures. | implemented; focused tests passed |
| PH8-004 | Reconcile saved-device row text, badges, selected runtime state, and persisted summaries. | implemented; focused tests passed |
| PH8-005 | Remove current-device product metadata bleed from non-selected saved-device rows. | implemented; focused tests passed |
| PH8-007 | Add deterministic diagnostics export path for automation while keeping Share behavior. | implemented; focused tests passed |
| PH8-008 | Allow explicit Maestro include/single-flow selection to override default slow exclusion without app reset. | implemented; contract tests passed |
| PH8-009 | Make Android local fixture source selection deterministic independent of remembered DocumentsUI state. | implemented; Pixel Maestro proof passed |
| PH8-010 | Make c64scope HIL artifact roots caller-controlled and fix npm argument forwarding. | implemented; c64scope tests passed |
| PH8-011 | Ensure HIL logcat capture verifies and preserves non-empty app/runtime logs. | implemented; c64scope tests passed |

## Validation Plan
- Run targeted tests for each touched subsystem as fixes land.
- Run `npm run lint`, `npm run test`, `npm run test:coverage`, and `npm run build` before completion.
- Confirm global branch coverage remains at least 91%.
- Verify changed-line/patch coverage using available local coverage artifacts or CI/Codecov evidence if local tooling is unavailable.
- Run relevant script dry-runs/tests for Maestro and c64scope command behavior.
- For Android/native changes, run relevant Gradle tests.
- Build and deploy the latest debug APK to Pixel 4 `9B0...` when present, launch it, and validate touched feature areas.

## Current Execution Notes
- Required reading completed for `.github/copilot-instructions.md`, `AGENTS.md`, `README.md`, UX guidelines, Maestro docs, agentic safety policy, PH8 research, and artifact index.
- Existing `PLANS.md` and `WORKLOG.md` were from the PH8 research pass and are being repurposed for the PH8 fix pass.
- Initial worktree already contained modified `PLANS.md`/`WORKLOG.md`, untracked prod-hardening artifacts, and unrelated `org/`; preserve them.
- Implementation is complete for PH8-001 through PH8-011. PH8-009 now includes an Android SAF persisted-grant reset path plus DocumentsUI breadcrumb recovery for no-reset local playback proof runs; Pixel Maestro proof passed. Final broad `npm run lint`, `npm run test`, and `npm run test:coverage` have passed with `91.71%` global branch coverage. Remaining active work: final build, c64scope validation rerun, changed-line coverage recomputation, final normal APK deploy, and on-device validation.

## Continuation 2026-06-06
- Status: continuation execution started.
- Remaining required steps:
  - [ ] Final normal web build with test probes disabled.
  - [ ] Final `npm run scope:check` and `npm run scope:test:coverage`.
  - [ ] Recompute changed-line patch coverage against current live diff.
  - [ ] Build/install latest normal debug APK to Pixel 4.
  - [ ] Perform final on-device validations and liveness probes under `docs/research/stabilization/prod-hardening-8/artifacts/post-fix/final-device-validation/`.
- Validation safety requirements from this continuation:
  - Continue preferring U64 for HIL and app validation.
  - Skip or bound C64U checks to read-only `/v1/info` probes after U64 checks.
