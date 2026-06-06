ROLE
You are a highly experienced React, Vite, Capacitor, Android, and hardware-in-the-loop QA/fix engineer. You are fixing concrete production-readiness issues found in C64 Commander prod-hardening-8. Work autonomously, but keep scope limited to the findings listed here.

Repository path:

`/home/chris/dev/c64/c64commander`

## Required Reading
Read these before editing:

1. `.github/copilot-instructions.md`
2. `AGENTS.md`
3. `README.md`
4. `docs/ux-guidelines.md` for UI changes
5. `docs/testing/maestro.md` for Maestro changes
6. `docs/testing/agentic-tests/agentic-safety-policy.md`
7. `docs/research/stabilization/prod-hardening-8/research.md`
8. `docs/research/stabilization/prod-hardening-8/artifacts/artifact-index.txt`

Consult these as needed:

- `src/hooks/useSavedDevices.ts`
- `src/lib/savedDevices/`
- `src/hooks/useSavedDeviceHealthChecks.ts`
- `src/components/UnifiedHealthBadge.tsx`
- `src/hooks/useC64Connection.ts`
- `src/lib/connection/connectionManager.ts`
- `src/pages/SettingsPage.tsx`
- `src/components/diagnostics/GlobalDiagnosticsOverlay.tsx`
- `src/lib/diagnostics/diagnosticsExport.ts`
- `.maestro/local-binary-playback-proof.yaml`
- `scripts/run-maestro.sh`
- `c64scope/src/hilEvidenceRun.ts`
- `c64scope/src/playbackVolumeLatency.ts`

## Required Execution Files
Create and maintain root `PLANS.md` and `WORKLOG.md`.

- `PLANS.md` is the authoritative execution state.
- After creating `PLANS.md`, immediately begin implementation and continue autonomously.
- Record all material actions, commands, failures, evidence paths, and validation results in `WORKLOG.md`.

## Scope Constraints
- Fix only the issues from `prod-hardening-8/research.md` unless a directly related root cause is proven.
- Avoid scope creep.
- Preserve existing app architecture unless a finding requires a targeted change.
- Do not weaken safety/back-off behavior.
- Do not mask errors by hiding diagnostics.
- Do not silence exceptions; log with context or rethrow with context.
- Add deterministic regression coverage for every bug fix.
- Keep C64U safety rules strict: do not run storms, destructive actions, reboot, power cycle, factory reset, flash reset, or rapid repeated mutations on c64u.

## Issue List and Priority Order

### P0
1. `PH8-002`: C64U degraded after app-driven device-switch investigation.
   - Category: SAFETY-BUG.
   - Fix goal: identify and mitigate unsafe switch/discovery/probe behavior, add pacing/back-off/circuit-breaker evidence, and prevent repeated requests against fragile targets.

### P1
2. `PH8-001`: Saved-device switcher cannot switch to reachable c64u.
   - Category: PRODUCT-BUG.
   - Fix goal: selecting a saved c64u profile must use the selected profile's host/ports and reach healthy product/firmware state when `/v1/info` is reachable.

3. `PH8-003`: App reports Healthy while Device/Firmware are `Not available`.
   - Category: PRODUCT-BUG.
   - Fix goal: Healthy state must not imply verified target identity when product/firmware are missing. Display pending/degraded/mismatch state until identity is available or explicitly explain why identity is unavailable.

4. `PH8-006`: Settings Refresh connection accepts overlapping manual discovery clicks.
   - Category: SAFETY-BUG.
   - Fix goal: manual discovery/reconnect actions must be gated, coalesced, or cooldown-protected while one is in flight.

### P2
5. `PH8-004`: Saved-device switcher/status summaries are contradictory or stale.
   - Category: PRODUCT-BUG.
   - Fix goal: row text, badges, selected runtime state, and persisted health summaries must agree.

6. `PH8-005`: Non-selected saved-device product label uses current device product.
   - Category: PRODUCT-BUG.
   - Fix goal: saved-device rows must never borrow product metadata from the currently connected device when rendering another saved profile.

7. `PH8-007`: Diagnostics export has no deterministic automation destination.
   - Category: TESTABILITY-GAP.
   - Fix goal: keep user Share behavior, but add a deterministic test-owned export path or native bridge path usable by Android HIL automation.

8. `PH8-008`: Maestro runner tag selection prevents safe playback proof.
   - Category: TESTABILITY-GAP.
   - Fix goal: explicit include/single-flow selection must be able to run the slow Android regression playback proof without app-state reset when requested.

9. `PH8-009`: Local playback/disk fixture flow is brittle in Android DocumentsUI.
   - Category: TESTABILITY-GAP.
   - Fix goal: make local source selection deterministic on Android 16/Pixel 4 and independent of remembered DocumentsUI folder state.

10. `PH8-010`: c64scope HIL scripts are not artifact-root safe for scoped research runs.
    - Category: TESTABILITY-GAP.
    - Fix goal: all relevant c64scope HIL commands accept an artifact root under the caller's requested directory, and npm script argument forwarding works.

11. `PH8-011`: Scoped logcat capture produced no app logs.
    - Category: TESTABILITY-GAP.
    - Fix goal: HIL log capture must verify it is collecting app logs during the run and preserve a non-empty app/runtime log artifact.

## Required Implementation Approach
1. Reproduce each issue locally where safe.
2. For C64U issues, start with code-level and U64-backed validation. Use c64u only with low-frequency, safe probes and bounded app actions after mitigations are in place.
3. Identify root cause before editing.
4. Implement minimal targeted fixes.
5. Add or update deterministic tests:
   - Unit tests for saved-device summary reconciliation, identity rollup, and display metadata.
   - Unit/component tests for Settings refresh in-flight gating.
   - Tests for diagnostics export deterministic path.
   - Script tests or shell-level checks for Maestro tag selection and c64scope artifact-root/argument behavior.
   - Android/HIL validation where required by repository rules.
6. Update docs only when behavior or harness commands change.
7. Run relevant unit, integration, Android, Maestro, and c64scope validation.
8. Track failures to green; do not skip tests or suppress warnings.

## Verification Matrix
| Finding | Reproduction evidence | Fix commit area | Required test evidence | Remaining risk |
| --- | --- | --- | --- | --- |
| PH8-002 | `research.md` C64U degradation chronology | connection discovery, saved-device health checks, request pacing/back-off | U64 switch/reconnect tests, c64u-safe bounded validation, diagnostics request pacing evidence | C64U hardware may remain externally degraded; document if so |
| PH8-001 | switch logs showing c64u Offline while direct HTTP 200 | saved-device switching, connection state transition | deterministic switch test with IP-backed c64u/U64 profiles | real c64u validation must be low-frequency |
| PH8-003 | startup Healthy with Device/Firmware missing | health rollup, identity display | unit/component test for missing identity not Healthy | none if identity semantics clear |
| PH8-006 | U64 Settings refresh accepted second click | SettingsPage, connection manager in-flight state | test double-click gating/coalescing | ensure no deadlock after failed discovery |
| PH8-004 | switcher contradictory row state | saved-device health summary/reconciliation | tests for row text/badges during Checking/Online/Offline/Mismatch | transient probe states still need clear copy |
| PH8-005 | `U64E · c64u` row | saved-device display metadata | unit/component test for non-selected device label | none |
| PH8-007 | Android chooser after Share all | diagnostics export/native bridge | automated export to deterministic path, artifact contents verified | keep user share unchanged |
| PH8-008 | runner tag log | `scripts/run-maestro.sh` | script test or dry-run showing explicit include overrides default slow exclusion | avoid broad slow default runs |
| PH8-009 | DocumentsUI failure artifacts | Maestro flow and source-selection strategy | Android 16 Pixel deterministic source selection proof for SID/PRG/CRT/D64 fixtures | DocumentsUI OEM differences |
| PH8-010 | c64scope failed wrapper and source hardcoding | c64scope HIL scripts/package scripts | command writes only under requested artifact dir and passes flags | preserve old default behavior |
| PH8-011 | empty logcat artifact | logcat capture command/harness | non-empty logcat verification during app launch/workflow | logs can still be sparse; require explicit marker |

## Validation Requirements
Follow `.github/copilot-instructions.md`:

- For code changes, run targeted tests plus `npm run test:coverage`.
- Maintain at least 91% global branch coverage.
- Verify changed-line/patch coverage where available.
- Run `npm run lint` and `npm run build` for executable changes.
- For Android changes, run the relevant Gradle tests.
- Before completion, deploy the latest built APK to the attached Pixel 4, launch it, and validate the touched feature areas there.
- If Maestro/c64scope scripts are changed, run the fixed commands and preserve artifacts.
- If c64u remains degraded externally, document it as an environment blocker only after proving the app/harness fixes are independently correct and U64 validation is green.

## Termination Criteria
Do not stop until all criteria are satisfied, blocked, or unsafe:

1. `PLANS.md` exists and is current.
2. `WORKLOG.md` contains chronological evidence.
3. All P0/P1 findings are fixed or explicitly converted to external blockers with evidence.
4. All P2 findings are fixed or documented with a narrow follow-up and reason.
5. Regression tests cover each fixed issue.
6. Relevant unit, integration, Android, Maestro, c64scope, build, lint, and coverage commands pass.
7. No new product code warnings/errors are introduced.
8. Latest APK is installed and launched on Pixel 4.
9. Touched feature areas are validated on Pixel 4.
10. Final summary lists exact files changed, commands run, artifacts produced, and any remaining risk.
