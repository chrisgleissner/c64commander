# HVSC Strong Convergence Execution Prompt

Use this prompt for the next implementation pass that must close the remaining HVSC production-readiness gaps in the current codebase.

## Prompt

ROLE

You are a senior Capacitor mobile engineer, cross-platform storage/query implementer, performance engineer, and production-readiness closer for the C64 Commander application.

This is a CONVERGENCE task.
It is not a fresh research pass.
It is not a partial implementation pass.
It is not a status-only pass.

OBJECTIVE

Use the current follow-up register and live codebase to drive every remaining HVSC production-readiness issue to verified closure.

You may not end this task with any remaining issue still at `PARTIAL` or `TODO`.

The only acceptable end states are:

- every remaining issue is fixed and can be marked `DONE` with source-backed proof, or
- an issue is newly proven `BLOCKED` by a concrete external constraint that cannot be removed inside the repo, with fresh evidence captured in artifacts and documentation

Anything else means the task is not complete.

AUTHORITATIVE INPUTS

Read and follow, in this order:

1. `.github/copilot-instructions.md`
2. `AGENTS.md`
3. `docs/research/hvsc/production-readiness-audit-2026-04-03.md`
4. `docs/research/hvsc/production-readiness-status-2026-04-03-followup.md`
5. `docs/testing/physical-device-matrix.md`
6. `docs/plans/hvsc/automation-coverage-map.md`
7. `PLANS.md`
8. `WORKLOG.md`
9. current code and tests
10. any docs/scripts/artifacts directly referenced by the files above

The follow-up status document is the current closure baseline.
Treat it as the authoritative issue register for this pass.

CURRENT ISSUE SET TO CLOSE

The following issues are not yet closed and must be driven to `DONE` or a newly proven `BLOCKED` state:

- `HVSC-AUD-001`
- `HVSC-AUD-002`
- `HVSC-AUD-003`
- `HVSC-AUD-004`
- `HVSC-AUD-005`
- `HVSC-AUD-006`
- `HVSC-AUD-007`
- `HVSC-AUD-010`
- `HVSC-AUD-011`
- `HVSC-AUD-012`
- `HVSC-AUD-013`
- `HVSC-AUD-014`

The following issues are already closed and must not regress:

- `HVSC-AUD-008`
- `HVSC-AUD-009`

EXECUTION ENVIRONMENT FACTS

These environment facts are authoritative for this pass:

- Android Pixel 4 is accessible and must be used for Android HIL validation.
- Web deployment via Docker is available and must be used for Web proof, not just mocked browser paths.
- iOS physical HIL is out of scope from this Linux host.
- iOS still remains in scope for production readiness and must be proven as far as possible through CI-capable evidence:
  - Maestro flows that run on CI
  - iOS simulator/native test coverage where available
  - any required source-level/native test additions needed to close the remaining iOS issue(s)

Do not treat “no local iOS HIL” as permission to leave the iOS issue partially solved.
Use the strongest available repo-native CI/simulator/Maestro proof and add missing native coverage where required.

MANDATORY WORKING RULES

1. Maintain `PLANS.md` as the authoritative execution plan throughout the pass.
2. Append timestamped entries to `WORKLOG.md` continuously.
3. Start implementation immediately after updating `PLANS.md`; do not stop at planning.
4. Preserve unrelated user or concurrent worktree changes.
5. Never silently swallow exceptions.
6. Every bug fix must add or update precise regression coverage.
7. Every performance/scalability fix must add or update a scale-oriented proof layer above pure repository correctness when the issue demands it.
8. Every closure claim must be backed by current code, tests, metrics, logs, screenshots, traces, or hardware artifacts.
9. If a prior audit or follow-up statement is stale, record the contradiction in `WORKLOG.md` and update the status document explicitly. Do not silently drift past it.
10. You must update `docs/research/hvsc/production-readiness-status-2026-04-03-followup.md` during the pass so the issue register reflects the final outcome.

HARD TERMINATION RULE

You are not allowed to declare completion while any of the following is true:

1. Any remaining issue is still honestly `PARTIAL` or `TODO`.
2. Android Pixel 4 HIL evidence is missing for the flows required by `HVSC-AUD-004` and `HVSC-AUD-005`.
3. Web proof still relies only on mocked Playwright coverage instead of a real Docker-backed runtime path.
4. `HVSC-AUD-006` still lacks the strongest feasible iOS proof available from the repo and CI-capable lanes.
5. UI/device scale proof is still absent for issues that explicitly require it.
6. The follow-up status document has not been updated to reflect the new final state.

If any one of those remains true, keep working.

STRICT CLOSURE PRINCIPLES

- A repository/storage improvement does not close a Play-page or UI-scale issue unless the real UI path is fixed and validated.
- A code change does not close a hardware-validation issue unless the required device artifacts exist.
- A guardrail or error message does not close a platform-capability issue if the production path is still missing.
- Better diagnostics do not close transactional ingest semantics unless recovery behavior itself is fixed.
- A mocked web path does not close the Web production-path issue.
- “iOS HIL unavailable here” does not close the iOS issue; it only narrows the type of proof you must collect.

PRIMARY OUTCOME REQUIREMENTS

By the end of the pass, the codebase must satisfy all of the following, or the task must continue:

1. HVSC browse/filter/search and large-playlist query paths use an authoritative indexed query architecture on all supported platforms.
2. Playlist render/filter/persistence/hydration behavior is truly windowed and bounded for 100k items.
3. No ordinary playback/session/query mutation rewrites or rehydrates the full playlist dataset.
4. Recursive/add flows do not eagerly retain the entire discovered file set in the hot path.
5. Ingest semantics are staged, transactional enough, or otherwise deterministically recoverable with explicit tested guarantees.
6. Web is proven as a real production-capable HVSC path through Docker-backed execution, not just mocked tests.
7. iOS is proven as strongly as this environment allows through CI-capable Maestro/native/simulator evidence and required native test additions.
8. Android Pixel 4 proof exists for the required HVSC ingest/browse/add/play path.
9. Real Ultimate playback proof exists with streamed-audio evidence meeting the repo’s stated oracle.
10. The final follow-up status document can honestly mark every issue `DONE` or `BLOCKED`, with no residual `PARTIAL`/`TODO`.

REQUIRED EXECUTION MODEL

Work in phases and keep `PLANS.md` accurate.

### Phase 1 - Convert The Follow-up Register Into A Closure Plan

- Reconcile every non-closed issue against the current codebase.
- Group the issues into execution slices with explicit dependencies.
- Identify which issues can only close after Android/Web/iOS proof is collected.
- Define the artifact set required for each issue to become `DONE`.

Exit criteria:

- `PLANS.md` maps every non-closed issue to a concrete implementation slice and validation plan.
- No remaining issue is left as an abstract backlog item.

### Phase 2 - Converge Storage, Query, Hydration, And List Materialization

This phase must close:

- `HVSC-AUD-001`
- `HVSC-AUD-002`
- `HVSC-AUD-013`
- `HVSC-AUD-014`

Required outcomes:

- authoritative indexed query contract for playlist and HVSC browse/search
- no full-playlist hot-path hydration
- no JS snapshot/query-index production path for large-playlist claims
- bounded recursive/add behavior
- explicit capability gating for unsupported storage/runtime fallbacks

Exit criteria:

- the affected issues can honestly be reclassified to `DONE` or a proven `BLOCKED`
- new scale-oriented tests exist above the repository layer

### Phase 3 - Converge Ingest Durability, Platform Contracts, And Observability

This phase must close:

- `HVSC-AUD-003`
- `HVSC-AUD-006`
- `HVSC-AUD-007`
- `HVSC-AUD-010`
- `HVSC-AUD-012`

Required outcomes:

- staged or otherwise deterministically recoverable ingest semantics
- explicit archive integrity policy
- explicit Web/non-native support contract with enforced behavior
- strongest feasible iOS native/CI evidence for ingest correctness and memory behavior
- cross-stage diagnostics sufficient for production support and HIL triage

Exit criteria:

- the affected issues can honestly be reclassified to `DONE` or a proven `BLOCKED`
- the new behavior is covered by regression and diagnostics tests

### Phase 4 - Close UI Scale And Real-Device Proof

This phase must close:

- `HVSC-AUD-004`
- `HVSC-AUD-005`
- `HVSC-AUD-011`

Required outcomes:

- Android Pixel 4 app-first HVSC run with archived artifacts
- real Ultimate playback proof with audio oracle evidence
- UI/device scale proof for the relevant large-list actions
- Web runtime proof on Docker-backed deployment for the HVSC path

Exit criteria:

- the affected issues can honestly be reclassified to `DONE` or a proven `BLOCKED`
- artifacts exist on disk and are referenced in the updated follow-up status document

### Phase 5 - Final Closure Reconciliation

- Update `docs/research/hvsc/production-readiness-status-2026-04-03-followup.md`.
- Reassess every issue ID from `HVSC-AUD-001` through `HVSC-AUD-014`.
- Do not leave any issue in `PARTIAL` or `TODO`.
- If an issue is `BLOCKED`, include the exact fresh blocker evidence and explain why the repo-side work is otherwise complete.

Exit criteria:

- the follow-up register shows only `DONE` and, if unavoidable, freshly justified `BLOCKED`
- the final completion summary can name the artifact/evidence set for each previously open issue

MANDATORY VALIDATION BAR

You must run the smallest honest validation that closes each issue, but you must not under-test. Required proof layers include:

### Code And Unit Layers

- repository/query contract tests
- hydration/session regression tests
- recursive-selection/add-flow scale regressions
- ingest interruption/recovery tests
- archive integrity/recovery tests
- diagnostics payload/correlation tests
- iOS native/simulator tests where needed to close `HVSC-AUD-006`

### UI And Integration Layers

- Play-page windowing/filter/render tests at meaningful scales
- HVSC browse/import/playback integration tests
- Web runtime validation against Docker deployment
- Maestro flows where native app behavior must be proven beyond pure unit tests

### Performance And Scale Layers

- 10k/50k/100k playlist-scale assertions where appropriate
- measured latency or bounded-allocation proof for the fixed hot paths
- device-level scale evidence on the Pixel 4 for the relevant flows

### Android HIL Requirements

You must use the Pixel 4 and collect fresh evidence for:

- app install and launch
- HVSC download or cache reuse
- HVSC ingest completion
- HVSC browse/filter/add
- playlist persistence if relevant
- playback initiation
- logcat capture
- screenshots/timeline evidence

### Ultimate Playback Requirements

You must follow `docs/testing/physical-device-matrix.md` and `docs/plans/hvsc/automation-coverage-map.md`.

Playback cannot be claimed closed without:

- app-first track selection evidence
- current-track UI evidence
- selected-track correlation evidence
- `c64scope` audio analysis or equivalent repo-defined oracle artifact
- `packetCount > 0`
- `RMS >= 0.005`

### Web Requirements

You must prove the Web path through a real Docker-backed deployment, not only through mocked Playwright runs.

At minimum, the proof must cover:

- startup/access to the deployed app
- HVSC path entry
- the relevant ingest/browse/filter/add/play path that corresponds to the issues being closed
- any platform limits or explicit capability gating if a fully equivalent path is still impossible

### iOS Requirements

iOS physical HIL is not available from this Linux host, but `HVSC-AUD-006` still must be closed with the strongest possible proof.

You must therefore:

- add or update iOS-native or simulator-capable HVSC tests where needed
- use CI-capable Maestro flows for iOS wherever they can prove the app path
- update CI-facing docs/config/tests as needed so the iOS proof lane is real and repeatable
- document exactly what iOS evidence was used to justify closure

You may not leave `HVSC-AUD-006` open merely because local physical iOS execution is unavailable.

REQUIRED OUTPUT ARTIFACTS

During and after the pass, you must maintain:

1. `PLANS.md`
2. `WORKLOG.md`
3. `docs/research/hvsc/production-readiness-status-2026-04-03-followup.md`
4. any new or updated tests
5. any required HIL/Web/CI artifacts under the appropriate repo locations

FINAL COMPLETION TEST

You may declare the task complete only if all of the following are true:

1. Every previously non-closed issue is now `DONE` or a freshly justified `BLOCKED`.
2. The updated follow-up document contains no `PARTIAL` or `TODO` statuses.
3. Android Pixel 4 proof exists for the required HVSC app path.
4. Web Docker-backed proof exists for the required Web path.
5. Real Ultimate playback proof exists with the repo’s audio oracle.
6. iOS has been proven as strongly as possible via CI-capable Maestro/native evidence and no longer remains an unresolved repo-side gap.
7. All code/test/doc changes needed for closure are committed in the worktree.

If any of those is false, continue working.

FINAL RESPONSE REQUIREMENTS

When the task is finally complete, the response must include:

- final status of every issue ID
- explicit list of newly closed issues
- any issue marked `BLOCKED` with exact blocker evidence
- commands/tests/HIL runs executed
- artifact locations for Android, Web, Ultimate playback, and iOS proof
- whether the HVSC system is now honestly production-ready

Do not claim convergence if even one remaining issue still lacks closure proof.
