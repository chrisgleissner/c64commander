# HVSC Implementation Execution Prompt

Use this prompt for the follow-up execution pass that must implement the findings in [production-readiness-audit-2026-04-03.md](/home/chris/dev/c64/c64commander/docs/research/hvsc/production-readiness-audit-2026-04-03.md).

## Prompt

You are a senior Capacitor mobile engineer and cross-platform performance implementer for the C64 Commander application.

This is an IMPLEMENTATION and CONVERGENCE task.

Your job is to take the audited findings in `docs/research/hvsc/production-readiness-audit-2026-04-03.md` and drive the codebase to a genuinely production-ready state for the full HVSC flow across Android, iOS, and Web.

This is not a fresh research pass.
The audit document is the authoritative discovery baseline.
Use it as the implementation contract unless direct source evidence proves it stale or incorrect.

You must implement all feasible aspects of the audit, with special focus on the critical and high-severity items, and you must keep going until the repo reaches a converged state with strong validation evidence.

The required production target is:

- full HVSC archive download
- correct `.7z` decompression
- durable ingestion into the authoritative query store
- selection of some or all of roughly 60,000 songs
- playlists up to 100,000 items
- truly lazy render/materialization and fast filtering/search
- playback against a real Commodore 64 Ultimate
- support on Android, iOS, and Web

Assume the maximum target runtime envelope on all platforms is:

- `512 MiB RAM`
- `2 CPU cores @ 2 GHz`

You must optimize and validate against that budget.

## Authoritative Inputs

Read and follow, in this order:

1. `.github/copilot-instructions.md`
2. `AGENTS.md`
3. `docs/research/hvsc/production-readiness-audit-2026-04-03.md`
4. any code/docs directly referenced by the audit while implementing

Treat the audit issue register, implementation plan, and test-plan sections as the starting execution backlog.

## Mandatory Working Rules

1. You must create and maintain `PLANS.md` as the authoritative execution plan for this implementation pass.
2. You must append timestamped entries to `WORKLOG.md` throughout the task.
3. After updating `PLANS.md`, you must immediately begin implementation and continue autonomously.
4. Do not stop at partial fixes or isolated refactors. Converge the end-to-end system.
5. Do not redo discovery unless you find concrete evidence that the audit is stale.
6. If audit conclusions are stale, record the contradiction in `WORKLOG.md`, update `PLANS.md`, and then adapt implementation accordingly.
7. Preserve user changes and unrelated worktree changes.
8. Never silently swallow exceptions.
9. Every bug fix must add or update regression coverage.
10. Any claim of readiness must be backed by code, tests, logs, traces, measurements, or real-device evidence.

## Primary Implementation Goals

You must close the following issue clusters from the audit:

### Storage, query, and playlist scale

- `HVSC-AUD-001`
- `HVSC-AUD-002`
- `HVSC-AUD-013`
- `HVSC-AUD-014`

This means the runtime must no longer depend on full-array playlist state, full-snapshot persistence, offset-scanned JS query indexes, or `localStorage` as a claimed large-playlist production path.

You must deliver a real large-scale storage and query architecture that is viable within the target memory/CPU envelope on Android, iOS, and Web.

### Ingest durability and platform capability

- `HVSC-AUD-003`
- `HVSC-AUD-006`
- `HVSC-AUD-007`
- `HVSC-AUD-010`

This means:

- transactional or staged ingest semantics
- resumable or explicitly recoverable behavior
- no false-success states after partial ingest
- a Web path that is truly production-capable for full HVSC ingest and playback
- iOS behavior that is not fatally memory-heavy for the target workload

### Hardware and validation convergence

- `HVSC-AUD-004`
- `HVSC-AUD-005`
- `HVSC-AUD-008`
- `HVSC-AUD-011`
- `HVSC-AUD-012`

This means:

- restore trustworthy Android native test execution
- add missing scale/perf coverage above the repository layer
- add enough diagnostics to debug failures in production
- attempt real-device Pixel 4 validation through ADB
- attempt real playback proof against the real C64 Ultimate

### Documentation and parity cleanup

- `HVSC-AUD-009`

## Non-Negotiable Outcome Requirements

By the end of the implementation pass, the codebase should satisfy all of the following unless an external blocker is proven and documented:

1. HVSC ingest uses an authoritative query/store architecture appropriate for each platform.
2. Playlist browse/filter/search/render paths are truly lazy and bounded for 100k items.
3. No ordinary playback state mutation rewrites or rehydrates the full playlist dataset.
4. Deep filtering/searching does not rely on full-array JS scans in the hot path.
5. The Web implementation is a real production path, not a mocked/demo-only path.
6. Large-file ingest behavior is consistent with the `512 MiB RAM` / `2 CPU cores @ 2 GHz` envelope.
7. Ingest failure, interruption, and recovery semantics are explicit and test-covered.
8. The Android native HVSC test lane is green in the supported local/CI environment.
9. Real-device validation is attempted and evidenced.
10. Docs and internal comments match the implemented reality.

## Required Execution Method

Work in phases. Keep `PLANS.md` accurate as you move.

### Phase 1 - Reconcile the audit into an implementation plan

- Read the audit and convert issue IDs into concrete implementation slices.
- Identify dependencies and order of operations.
- Decide which storage/query changes must happen before UI/list work.
- Decide which tests must be introduced before large refactors.

Exit criteria:

- `PLANS.md` contains a real multi-phase implementation plan.
- The plan maps issue IDs to code areas and validation steps.

### Phase 2 - Build the authoritative storage/query foundation

- Replace the current snapshot-style playlist/query architecture with a normalized, incremental, query-driven design.
- Remove or demote non-viable large-playlist fallbacks.
- Ensure Android, iOS, and Web all have equivalent query semantics.
- Prefer indexed storage primitives, SQLite/FTS where appropriate, or equivalent browser-safe indexed querying where SQLite is not available.
- Introduce cursor/keyset semantics where needed.

Exit criteria:

- No full-snapshot repository rewrites in the hot path.
- Querying, paging, filtering, and sorting are driven by the authoritative store.

### Phase 3 - Fix ingest durability and large-archive behavior

- Implement staged or atomic ingest semantics.
- Ensure cancellation and interruption cannot leave misleading success state.
- Make Web and iOS large-archive handling viable under the target envelope.
- Add integrity/recovery behavior where missing.

Exit criteria:

- Ingest is crash-safe or explicitly recoverable.
- Platform-specific large-archive behavior is enforced and tested.

### Phase 4 - Converge the Play page and large-playlist UX path

- Eliminate full-array render, filter, selection, and persistence traps.
- Replace eager recursive add flows with chunked, bounded, cancelable behavior.
- Ensure lazy materialization is real, not cosmetic virtualization over fully-built arrays.
- Keep the UI responsive at target scale.

Exit criteria:

- 100k-item playlist operations use bounded windows and incremental state.
- Filtering and scroll behavior are performant under the target budget.

### Phase 5 - Strengthen diagnostics and failure transparency

- Add enough observability to distinguish download vs extraction vs ingest vs query vs render vs playback failures.
- Add correlation between selected track, playlist item, and playback request.
- Make user-visible errors accurate and recoverable.

Exit criteria:

- Support/engineering can diagnose failures without guesswork.

### Phase 6 - Validate aggressively

- Run the required unit, integration, Playwright, and Android-native tests.
- Run coverage if the repo instructions require it for the touched code.
- Attempt Pixel 4 validation through ADB.
- Attempt real C64 Ultimate playback validation using the repo’s physical-device guidance.
- Capture timings, logs, and artifacts.

Exit criteria:

- Strong automated validation is green.
- Real-device attempts are evidenced.

### Phase 7 - Update docs and close the loop

- Update the audit document only where implementation reality has changed.
- Update stale parity docs/comments.
- Record what is now solved, what remains blocked, and why.

Exit criteria:

- Docs reflect shipped behavior.
- `PLANS.md` and `WORKLOG.md` reflect the actual work performed.

## Required Validation Bar

Use the smallest honest validation set that covers the changed layers, but do not under-test.

At minimum, add or update tests for:

- normalized repository behavior
- cursor/keyset or windowed query behavior
- large playlist persistence/hydration behavior
- large recursive HVSC selection behavior
- Web large-archive/full-HVSC behavior
- iOS large-archive behavior where feasible
- Android native plugin regressions
- Play page render/filter behavior at 10k/50k/100k scales
- ingest interruption and recovery
- playback request correlation and diagnostics

You must add performance-oriented validation where practical.
A repository test alone is not sufficient proof for UI-scale behavior.

## Real-Device Requirements

You must treat hardware validation as first-class.

### Android Pixel 4

- Verify `adb devices -l`
- Build/install if the device is reachable
- Capture logcat during relevant flows
- Attempt:
  - HVSC download
  - HVSC ingest
  - HVSC browse/filter
  - large playlist actions
  - playback initiation

If ADB is still blocked, document the blocker with fresh evidence and continue everything else.

### Commodore 64 Ultimate

- Follow the repo’s expected physical-device workflow
- Validate the real playback path as far as safely possible
- Do not claim success without direct evidence
- If streamed-audio proof is required and not achieved, capture the exact blocker

## Convergence Rules

- Do not stop after fixing only one layer if the end-to-end path is still broken.
- Do not keep legacy architecture alive just to avoid migration work if it blocks the audit goals.
- Do not accept “works in tests” if the real runtime path still violates the target memory/CPU budget.
- Do not claim completion while critical issues remain open without a proven external blocker.
- When a change reveals a new blocker, update `PLANS.md`, log it in `WORKLOG.md`, and continue.

## Deliverables

You must produce all of the following:

1. Updated `PLANS.md`
2. Updated `WORKLOG.md`
3. Production code changes implementing the required behavior
4. Updated tests
5. Any required doc updates
6. Validation evidence in the final report

## Final Response Requirements

When you finish, provide a concise implementation summary with:

- what was implemented
- which audit issues were fully closed
- which issues remain open and why
- what tests were run
- what real-device validation was completed
- the current readiness judgment

Do not claim production readiness unless the evidence truly supports it.
Do not convert this back into a research-only task.
Implement, validate, converge, and finish.
