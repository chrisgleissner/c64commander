# HVSC Workflow Convergence Prompt

ROLE

You are a senior Android + TypeScript reliability engineer fixing a real HVSC workflow bug in C64 Commander at `/home/chris/dev/c64/c64commander`.

This is not a paper exercise. You must converge the actual product to a state where the end-to-end HVSC workflow is proven with:

1. CI-safe regression coverage that can run in GitHub Actions.
2. Local hardware-in-the-loop proof on a real adb-visible Pixel 4 and a real C64U.

You must follow `AGENTS.md` and `.github/copilot-instructions.md` first.

You MUST create and maintain `PLANS.md` and `WORKLOG.md` at the repository root.

- `PLANS.md` is the authoritative execution plan.
- `WORKLOG.md` is a timestamped evidence log of commands, observations, failures, retries, and validation artifacts.

Create both files first, then continue autonomously until the task reaches a real terminal state: `COMPLETE`, `FAILED`, or `BLOCKED`.

MISSION

Fix HVSC so the full product workflow is reliable on real hardware:

1. Download HVSC from a real remote HVSC source.
2. Reuse cached archives when present.
3. Ingest HVSC into the real native/runtime index or DB actually used by the app.
4. Browse HVSC through the same source-browser interaction model used for C64U browsing.
5. Add HVSC content into the playlist.
6. Preserve duration and subsong metadata through playlist import and playback.
7. Play an HVSC-sourced song on the real C64U.
8. Verify real streamed audio from the C64U using the C64U audio stream, not UI state alone.
9. Prove large-scale behavior remains usable for at least 60k playlist entries, including shuffle.

CURRENT REPO REALITY YOU MUST ACCOUNT FOR

Do not invent a clean-room narrative. Work from the actual repo:

- `playwright/hvsc.spec.ts` currently uses `window.__hvscMock__` and a fake HVSC server. That is useful prior art, but it does not prove the native Android ingestion/runtime path.
- `.maestro/smoke-hvsc.yaml` currently proves only a thin native smoke path: HVSC controls are visible and browsing can open. It does not prove the full download -> ingest -> playlist -> playback chain.
- `.maestro/edge-hvsc-ingest-lifecycle.yaml` and `.maestro/edge-hvsc-repeat-cancel-resume.yaml` exercise progress text and restart behavior, but not C64U playback success.
- `docs/testing/physical-device-matrix.md` currently requires HVSC ingest evidence, but not full HVSC playback verification on real hardware.
- `docs/research/playback-hvsc-research.md` already identifies relevant risk areas:
  - mocked HVSC tests are not enough for native confidence
  - duration/subsong metadata can be dropped across the HVSC browse/import/play path
  - HVSC ingestion is memory-sensitive
  - large-scale behavior and observability are incomplete
- `c64scope` already has real stream-capture primitives and existing audio proof thresholds:
  - `c64scope/src/hilEvidenceRun.ts`
  - `c64scope/src/validation/cases/playback.ts`
  - `c64scope/src/validation/cases/exploratoryPlayback.ts`
  - current non-silent audio proof uses RMS thresholds around `>= 0.005`

Your job is to fix the product and the proof stack so success is real and diagnosable.

HARD COMPLETION GATE

The task is complete only if ALL of the following are true:

1. The code fix is implemented.
2. Dedicated regression tests were added or strengthened for every root cause you fixed.
3. All required CI-safe validation passes.
4. Real HIL validation passes on a real Pixel 4 and a real C64U.
5. The HIL run proves the full app-first workflow through real C64U streamed-audio verification.
6. Evidence artifacts are saved and referenced in `WORKLOG.md`.

If any item above is missing, the task is not complete.

If adb hardware or the real C64U is unavailable, the task must end as `BLOCKED`, not `COMPLETE`.

NON-NEGOTIABLES

- Do not stop at static analysis.
- Do not claim success from mocks, emulators, or mocked web-only ingestion paths.
- Do not treat `window.__hvscMock__` as proof for the critical path.
- Do not treat a fake `.7z` payload or a ZIP mislabeled as `.7z` as proof for the native path.
- Do not weaken tests to make them pass.
- Do not skip failing tests.
- Do not silently swallow exceptions.
- Do not claim real-device success unless you actually ran it on an adb-visible physical Pixel 4 attached to this machine.
- Do not accept a generic Android device or emulator as substitute proof.
- Do not call the task complete if the HIL run did not verify streamed audio from the real C64U.
- Do not use direct `c64bridge` playback control as proof that the app path works. App-first execution is mandatory.

REQUIRED EXECUTION MODEL

Phase 1: Read before acting

Read only the smallest relevant set first:

1. `README.md`
2. `.github/copilot-instructions.md`
3. `AGENTS.md`
4. `docs/ux-guidelines.md`
5. `docs/testing/maestro.md`
6. `docs/testing/physical-device-matrix.md`
7. `docs/research/playback-hvsc-research.md`
8. `docs/testing/agentic-tests/agentic-oracle-catalog.md`
9. `docs/testing/agentic-tests/agentic-infrastructure-reuse.md`
10. `docs/c64/c64u-stream-spec.md`
11. `src/lib/hvsc/*`
12. `src/lib/sourceNavigation/hvscSourceAdapter.ts`
13. `src/pages/playFiles/handlers/addFileSelections.ts`
14. `src/pages/playFiles/hooks/usePlaybackController.ts`
15. `src/pages/playFiles/hooks/usePlaybackPersistence.ts`
16. `src/pages/PlayFilesPage.tsx`
17. `src/components/itemSelection/ItemSelectionDialog.tsx`
18. `src/lib/playlistRepository/*`
19. `android/app/src/main/java/uk/gleissner/c64commander/HvscIngestionPlugin.kt`
20. `tests/unit/hvsc/*`
21. `playwright/hvsc.spec.ts`
22. `.maestro/smoke-hvsc.yaml`
23. `.maestro/edge-hvsc-ingest-lifecycle.yaml`
24. `.maestro/edge-hvsc-repeat-cancel-resume.yaml`
25. `c64scope/src/hilEvidenceRun.ts`
26. `c64scope/src/validation/cases/playback.ts`
27. `c64scope/src/validation/cases/exploratoryPlayback.ts`

Phase 2: Classify honestly

This task is a `CODE_CHANGE`.

If you also update docs or test prompts, treat it as `DOC_PLUS_CODE`, but do not use that to reduce validation scope.

Phase 3: Map impact before editing

Before changing code, explicitly map:

- the real ingestion source of truth
- the browse/query path used by HVSC selection
- where duration/subsong metadata enters and where it can be dropped
- what currently proves only web/mock behavior
- what currently proves native behavior
- what currently proves real hardware playback

Phase 4: Implement with minimal coherent scope

Fix the smallest set of code paths that makes the real workflow reliable and testable.

Phase 5: Validate in two tracks

You must pass both:

- Track A: CI-safe validation
- Track B: local HIL validation on the real Pixel 4 and real C64U

Phase 6: Report precisely

Completion output must state whether the result is `COMPLETE`, `FAILED`, or `BLOCKED`.

If HIL did not run and pass, the result is not `COMPLETE`.

LIKELY ROOT-CAUSE AREAS TO INVESTIGATE FIRST

- The native Android plugin may ingest HVSC into SQLite, but the JS selection/import path may still be reading from a different store or fallback index.
- HVSC browse/import may preserve only file path/title while dropping duration, MD5, or subsong metadata needed by playback.
- HVSC query/browse may still materialize large arrays in JS or React where a paged/query-backed contract is required.
- Playlist persistence/query/shuffle may degrade catastrophically at 60k+ entries if repository operations are O(n) in the wrong place.
- Existing tests may be green while proving only mock/web behavior, not the native runtime or real-device behavior.
- Playback proof may currently stop at “button changed to Stop” rather than proving streamed audio from the C64U.

PRODUCT ACCEPTANCE CRITERIA

You must satisfy all of these:

- HVSC install works from a real remote archive.
- Cache reuse works and avoids unnecessary redownload on the warm path.
- Ingest produces the real queryable source of truth used by HVSC browsing/import.
- The HVSC browser follows the same source-browser interaction contract as C64U browsing:
  - source chosen first
  - scoped browsing
  - `Root`, `Up`, `Refresh`
  - no playback controls inside selection
  - query-backed large lists
- Importing from HVSC into the playlist preserves:
  - duration
  - subsong metadata
  - enough source metadata for correct playback routing
- Playing an HVSC song sends the correct payload to the C64U and uses the correct song length behavior.
- At least one large HVSC playlist of `>= 60000` entries is usable for:
  - import completion
  - persistence/load
  - filter/query
  - view-all
  - shuffle
- The final proof includes real streamed audio from the C64U while the app-initiated HVSC song is playing.

MANDATORY ORACLE POLICY

Use at least three oracle classes for the real hardware proof:

1. UI
2. Diagnostics/logs or REST-visible state
3. A/V signal via `c64scope`

For the playback verdict, A/V signal is mandatory.

Forbidden as sole proof:

- “Stop” button visible
- playlist row highlighted
- playback request logged
- mock server request shape
- local audio on the host machine

Primary playback proof must include:

- app-driven playback action timeline
- real C64U audio stream capture
- non-silent audio confirmation from `c64scope`
- correlation to the selected HVSC track and run artifacts

CI-SAFE VALIDATION REQUIREMENTS

These must pass before you even consider the HIL run sufficient:

1. Static + repo validation

- `npm run lint`
- `npm run test`
- `npm run test:coverage`
- `npm run build`
- `cd android && ./gradlew test`
- if `agents/` changed: `npm run test:agents`

Coverage gate:

- global branch coverage must remain `>= 91%`
- if `agents/` changed, agents branch coverage must remain `>= 90%`

2. Required CI-safe test strengthening

Add or strengthen dedicated regression coverage for:

- HVSC source adapter metadata preservation
- add-items HVSC import path preserving duration/subsong/source metadata
- playback controller or routing honoring HVSC-provided duration and subsong data
- query-backed HVSC folder browsing without full-folder materialization
- playlist repository behavior at `>= 60000` entries including shuffle
- native plugin ingest behavior with real archive fixtures
- failure classification and retry behavior for cache reuse / ingest / update if that is part of the fix

3. Required browser/integration coverage

Use Playwright for what Playwright is good at, but do not pretend it proves native ingest.

You must:

- keep or improve `playwright/hvsc.spec.ts` for web/runtime prior art
- clearly separate mock/web tests from native/runtime proof
- add targeted browser regression only for behavior that genuinely belongs in CI-safe browser coverage

4. Required native/Android CI-safe coverage

Strengthen Android-native proof that can run on CI without the physical lab:

- `HvscIngestionPlugin` realistic archive ingest tests
- update/deletion handling
- songlength import
- representative metadata rows
- a regression that fails before your fix and passes after it

If you add or change Maestro flows, they must remain CI-safe and deterministic. Do not bloat the CI lane with flaky full-hardware assumptions.

LOCAL HIL VALIDATION REQUIREMENTS

This track is mandatory and cannot be replaced by emulator evidence.

Preflight

You must capture and record:

- exact `adb devices -l` output
- Pixel model proof via `adb -s <serial> shell getprop ro.product.model`
- Android version via `adb -s <serial> shell getprop ro.build.version.release`
- package presence / install version
- real C64U reachability from the current environment

If no physical adb device is attached, or the attached device is not a real Pixel 4, stop and report `BLOCKED` with the exact command output.

If the C64U is unavailable, stop and report `BLOCKED`.

HIL must pass in three runs:

1. Run A: cold path

- clear app state
- clear HVSC app cache/state as needed for a true cold run
- start from no installed HVSC state
- download HVSC from the real remote source
- ingest to completion
- browse HVSC through the app UI
- add a known song with known duration/subsong behavior
- play it on the real C64U
- verify in-app duration/subsong state
- verify real C64U audio stream is non-silent during playback
- stop playback or reset machine and verify the audio stream returns to silence or the app returns to an expected terminal state

2. Run B: warm cache-reuse path

- do not delete the downloaded HVSC archive cache
- restart from a state that should reuse cache
- prove that the app reuses cache instead of doing a full redownload
- repeat browse -> import -> play -> streamed-audio verification

3. Run C: large-scale playlist path

- create or load an HVSC-backed playlist containing at least `60000` entries
- this may be the whole library or repeated partial imports, but the final playlist size must be `>= 60000`
- prove:
  - playlist import completes
  - playlist reload/persistence is intact
  - query/filter remains usable
  - view-all remains usable
  - shuffle operates correctly
- then play at least one entry from that large HVSC playlist and verify real streamed audio again

Reliability rule:

- A single lucky pass is not enough.
- Runs A and B must both pass end-to-end.
- Run C must pass the scalability criteria.

HIL AUDIO/STREAM PROOF REQUIREMENTS

Use `c64scope` as the authoritative A/V evidence path.

You must capture C64U audio stream evidence for playback, not just video or UI.

Minimum stream proof per playback run:

- audio stream packets captured from the real C64U
- packet count `> 0`
- non-silent playback window with RMS meeting or exceeding the existing `c64scope` proof threshold (`>= 0.005` unless you update `c64scope` and justify a different threshold with regression coverage)
- track-correlated timing: stream capture must clearly correspond to the app playback action

Preferred stronger proof:

- pre-play silence baseline
- transition to sustained non-silent audio after app playback starts
- optional post-stop silence recovery proof

Do not call playback successful if the app UI says “playing” but the C64U stream remains silent.

HIL ARTIFACT CONTRACT

Save all artifacts and reference them in `WORKLOG.md`.

At minimum collect:

- `adb devices -l` output
- Pixel 4 model/version proof
- exact commands run
- app screenshots at key milestones
- screen recording if available
- logcat for the full run
- app logs / diagnostics / traces
- HIL session summary
- C64U playback request evidence
- `c64scope` stream analysis artifacts:
  - audio analysis JSON
  - audio packets capture
  - metadata JSON
  - any associated video analysis if captured

Use stable repo-local artifact paths. Prefer:

- CI-safe validation logs under `docs/plans/hvsc/artifacts/<timestamp>/ci/`
- HIL artifacts under `docs/plans/hvsc/artifacts/<timestamp>/hil/`

If you reuse `c64scope/artifacts/`, mirror or cross-reference the final paths from `WORKLOG.md`.

IMPLEMENTATION GUIDANCE

- Prefer one real source of truth for HVSC browse/import.
- If the native-ingested DB is the right source of truth, make the app actually use it.
- Preserve the UX contract from `docs/ux-guidelines.md`.
- Keep large-list behavior query-backed and virtualized where appropriate.
- Preserve deterministic diagnostics.
- Fix root causes, not symptoms.
- If trace semantics change, update golden traces instead of weakening assertions.
- Update docs only when behavior, validation workflow, or operator expectations materially changed.

STRONG FAILURE DISCIPLINE

If you hit a failure:

- record the exact failing step
- record the exact command
- record the exact error output
- identify whether the fault is:
  - app
  - native plugin
  - test
  - environment
  - observability
  - determinism
- add or strengthen regression coverage before retrying when the root cause is in product code

Do not mask failures behind broader retries.

Retries are allowed only when:

- a transient device or network issue is strongly evidenced
- you preserved the original failing artifacts
- the retry reason is logged in `WORKLOG.md`

COMPLETION OUTPUT

Your final output must include:

- terminal state: `COMPLETE`, `FAILED`, or `BLOCKED`
- root cause
- files changed
- tests run
- coverage result
- CI-safe validation summary
- HIL validation summary for Run A, Run B, and Run C
- physical-device evidence summary
- streamed-audio evidence summary
- remaining risks

If real Pixel 4 + real C64U proof was not run and passed, say explicitly:

`Task is not complete.`
