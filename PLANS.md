# 2026-04-26 Perf Nightly Repair And Expansion

## Classification

- `CODE_CHANGE`
- `DOC_PLUS_CODE`

## Problem Statement

- Repair the failing `perf-nightly` workflow, which currently requests real HVSC baseline/update archives without deterministically provisioning them on a cold CI runner.
- Replace the current narrow nightly behavior with a more useful, idiomatic performance suite for the Capacitor app, centered on measurable HVSC, storage, and web-runtime hot paths rather than sleeps or arbitrary wall-clock padding.
- Keep the existing benchmark lane intact or better, add stable artifacts and thresholds, and validate the final workflow on GitHub Actions with a manual run.

## First Local Hypothesis

- `.github/workflows/perf-nightly.yaml` restores an HVSC cache directory but never calls the existing real-archive provisioning path, while `scripts/hvsc/collect-web-perf.mjs` exits early in real-archive mode unless both baseline and update archives already exist.

## Cheap Disconfirming Check

- Reproduce the failure locally with the workflow-style environment and an empty cache directory. If the script fails with the missing-archive error before Playwright starts, the controlling fault is provisioning rather than browser/runtime execution.

## Candidate CI Provisioning Approaches

| Approach                                                                                                 | Pros                                                                                                                                          | Cons                                                                                                           | Status                                                  |
| -------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------- |
| Reuse `scripts/hvsc/realArchiveCache.mjs` from a new `scripts/hvsc/prepare-perf-archives.mjs` entrypoint | Reuses existing tested download/cache logic, keeps local and CI paths aligned, supports documented env overrides, minimal workflow complexity | Needs orchestration script plus tests and artifact metadata plumbing                                           | `preferred`                                             |
| Inline archive download in `.github/workflows/perf-nightly.yaml`                                         | Fast to wire                                                                                                                                  | Duplicates archive resolution logic, harder to test locally, worse maintainability                             | `rejected unless orchestration reuse fails`             |
| Replace real archives with small committed fixtures for nightly                                          | Deterministic and cheap                                                                                                                       | Violates the current real-archive intent unless justified by upstream instability, reduces realism for nightly | `rejected for nightly; maybe acceptable only for smoke` |

## Execution Plan

1. Reproduce the missing-archive failure locally and record the exact command plus output in `WORKLOG.md`.
2. Map the real-archive contract across workflow env, cache paths, override vars, helper scripts, docs, and tests.
3. Implement deterministic provisioning before `test:perf:nightly` and `test:perf:secondary:nightly`, using explicit cache keys and clear failures.
4. Audit the application’s concrete performance surfaces, then classify each candidate path for smoke, nightly, or later coverage.
5. Expand the perf harness with short/nightly modes, scenario selection, stable artifacts, metadata capture, and useful thresholds.
5a. Apply steering refinement: fix the sporadic post-push CI failure in `playwright/ui.spec.ts` by aligning the home-version expectation with the actual build-version resolver contract, and lock that behavior with a focused regression test.
6. Update package scripts, CI workflow steps, and documentation for local smoke use, nightly invocation, artifacts, cache paths, and deferred hardware/device lanes.
7. Run focused local validation first, then the required repo validation set for code changes, including coverage.
8. Trigger the manual `perf-nightly` workflow on the current branch, watch it to completion, and only close the task after the CI lane passes with useful artifacts.

## Investigation Table

| Candidate performance area                                        | Evidence from code/docs/tests                                                                                                     | User-visible risk                                   | Include in nightly | Proposed measurement method                        | Runtime budget | Threshold or artifact         | Reason                            |
| ----------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------- | ------------------ | -------------------------------------------------- | -------------- | ----------------------------- | --------------------------------- |
| HVSC real-archive baseline/update provisioning                    | `.github/workflows/perf-nightly.yaml`, `scripts/hvsc/collect-web-perf.mjs`, `scripts/hvsc/realArchiveCache.mjs`, repo memory note | Nightly lane fails before any performance work runs | `pending`          | CI orchestration + archive identity artifact       | `pending`      | archive metadata JSON         | First blocker to repair           |
| HVSC import, update apply, index build, browse/query hot paths    | `tests/benchmarks/hvscHotPaths.bench.ts`, HVSC scripts, perf docs                                                                 | Slow ingest and browsing on large libraries         | `pending`          | Node deterministic benchmarks + scenario summaries | `pending`      | JSON summary with percentiles | High-value, CI-safe               |
| Playlist scale operations and persistence                         | code/docs/tests under `src/lib` and pages to inspect                                                                              | Sluggish large playlist UX and hydration            | `pending`          | targeted Node/web measurements                     | `pending`      | per-scenario metrics artifact | Candidate nightly addition        |
| Web runtime measurement around existing Playwright HVSC scenarios | `scripts/hvsc/collect-web-perf.mjs`, Playwright HVSC specs                                                                        | Runtime regressions in browser path                 | `pending`          | repeated Playwright scenario runs with metadata    | `pending`      | JSON + summary text           | Existing harness to strengthen    |
| Android/iOS device lane                                           | existing startup/perf scripts and infra to inspect                                                                                | Platform-specific storage/filesystem regressions    | `later`            | deferred until safe infrastructure confirmed       | `n/a`          | documented deferral           | Do not claim unsupported coverage |

# 2026-04-25 Startup Launch And Asset Convergence

## Classification

- `CODE_CHANGE`
- `UI_CHANGE`
- `DOC_PLUS_CODE`

## Goal

- Converge branding, launch rendering, and validation around `docs/img/c64commander.png` as the single source of truth for variant branding assets and the cold-start launch experience.

## Constraints

- Do not upscale, recompress aggressively, or otherwise degrade `docs/img/c64commander.png`.
- Migrate `variants/variants.yaml` to semantic asset keys only; no `*_svg` schema keys or compatibility layer.
- Replace variant branding assets under `variants/assets/*` with PNG equivalents derived from the source logo.
- Cold-start launch sequence must be deterministic, variant-aware, and skipped on resume.
- Playwright validation is mandatory and must be executed.
- Maestro flows must be added and executed when the environment allows; otherwise the limitation and command must be documented.
- Video output must stay outside tracked paths.
- Final closeout requires builds, tests, screenshots, video generation, and `doc/research/startup-launch/report.md`.

## Ordered TODOs

| ID  | Status    | TODO                                                 | Success criteria                                                                                                                                                                                                                                                       |
| --- | --------- | ---------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | `done`    | Establish authoritative execution records            | `PLANS.md` defines this task, `WORKLOG.md` has an initial timestamped entry, and schema owners plus the source logo properties are recorded.                                                                                                                           |
| 2   | `done`    | Migrate the variant asset schema                     | `variants/variants.yaml`, generator code, generated outputs, and regression tests use `assets.sources.{icon,logo,splash}.{path,format}` only and no `*_svg` keys remain in active code paths.                                                                          |
| 3   | `done`    | Replace variant branding assets with PNGs            | Each variant has `icon.png`, `logo.png`, and `splash.png` derived from `docs/img/c64commander.png`, icons are padded safely, and stale SVG branding assets are removed or detached.                                                                                    |
| 4   | `pending` | Implement the cold-start launch sequence             | Android, iOS, and web render the same premium launch sequence on cold start only, using variant display name, description, and logo with no white flash regressions.                                                                                                   |
| 5   | `pending` | Add automated launch validation                      | Playwright covers fresh-load visibility and transition timing plus SPA non-retrigger behavior, and Maestro cold-start/resume flows are added.                                                                                                                          |
| 6   | `done`    | Generate launch evidence artifacts                   | Profile screenshots exist under `docs/img/app/launch/profiles/{compact,medium,expanded}/`, a launch video exists under an ignored artifact path, and the output paths are logged.                                                                                      |
| 6a  | `done`    | Apply steering refinement for launch evidence        | `artifacts/video/` is ignored, the launch description is centered, and the launch screenshots plus video are re-recorded after the refinement.                                                                                                                         |
| 6b  | `done`    | Apply steering refinement for app-ready canvas color | The post-launch swipe canvas paints the resolved theme background instead of exposing the root launch color, focused Playwright launch coverage guards that regression, and refreshed profile screenshots no longer retain the C64 blue launch canvas behind the page. |
| 7   | `pending` | Validate builds and non-launch regressions           | Relevant tests, coverage, lint, build, Capacitor sync/build validation, and a 7-Zip regression check all pass or have a documented blocking limitation.                                                                                                                |
| 8   | `pending` | Write final report and clean the worktree            | `doc/research/startup-launch/report.md` exists, non-git artifacts stay unstaged, and all task TODOs are marked `done`.                                                                                                                                                 |

# 2026-04-24 Release Size Regression 0.7.7 -> 0.7.8

## Classification

- `CODE_CHANGE`
- `DOC_PLUS_CODE`

## Problem Statement

- Investigate the Android and iOS release-size regression between published tags `0.7.7` and `0.7.8` using the actual GitHub Release artifacts, not local builds.
- Treat the size drop as a severe regression until artifact evidence proves otherwise.
- 7-Zip support is mandatory and release-blocking if missing from Android or iOS artifacts.
- Deliver a fixed prerelease candidate under the `0.7.9-rcN` sequence, validate the published RC artifacts, and identify the exact RC that is safe to promote.

## Current Hypothesis

- A shared packaged payload disappeared from both Android and iOS between `0.7.7` and `0.7.8`, most likely in the Capacitor-bundled web/native dependency path rather than in a platform-only toolchain optimization.
- Because the size drop appears in both APK and IPA, the leading suspicion is missing bundled runtime content such as the 7-Zip dependency, an extraction bridge asset, or another cross-platform web/native payload that should have been copied into both release artifacts.

## Cheap Disconfirming Check

- Download the published `0.7.7` and `0.7.8` APK and IPA assets from GitHub Releases.
- Unpack them into deterministic directories and compare full file inventories, directory sizes, and 7-Zip-related indicators (`7z`, `7zip`, `sevenzip`, `lzma`, `wasm`, `archive`, native libraries, and bridge assets).
- If the missing bytes do not map to removed runtime payload, shift the root-cause search to release workflow artifact selection or packaging mode changes.

## Baseline Evidence Collected

- Current local branch: `fix/bundle-content`
- Current HEAD: `55236960` (`tag: 0.7.8`)
- Published release sizes:
  - Android APK: `0.7.7 = 8,265,019 bytes`, `0.7.8 = 5,790,272 bytes`
  - iOS IPA: `0.7.7 = 6,344,206 bytes`, `0.7.8 = 3,100,332 bytes`
- Remote release metadata confirms both `0.7.7` and `0.7.8` have published Android and iOS assets.
- Tag `0.7.9-rc1` exists in git, but no GitHub release currently exists for that tag.

## Ordered Tasks

1. Download the published `0.7.7` and `0.7.8` Android APK and iOS IPA assets into `artifacts/release-size-investigation/` and record URLs, sizes, checksums, and timestamps.
2. Unpack each artifact into deterministic directories and generate full inventories, native-library inventories, directory-size summaries, extension summaries, and 7-Zip-focused search results.
3. Compare `0.7.7` versus `0.7.8` artifact contents to isolate removed or reduced payload.
4. Diff `0.7.7..0.7.8` source, packaging config, workflows, and scripts to identify the exact causal change.
5. Decide whether the size drop is legitimate optimization or missing required functionality using artifact evidence plus source evidence.
6. Apply the smallest correct fix if runtime payload is missing.
7. Add deterministic release-artifact validation that asserts required packaged dependency presence, including 7-Zip indicators.
8. Run focused local validation plus the required repo validation set for code changes.
9. Create or advance `0.7.9-rcN`, ensure the GitHub release is a prerelease, and validate the published RC Android and iOS artifacts.
10. Write the final report at `doc/research/release-size-regression-0.7.7-to-0.7.8/report.md` and close all tasks only after artifact-backed proof is complete.
11. Steering refinement: keep `c64commander.png` shipped, enforce a hard cap of `<= 256 KiB`, and record which SVG-derived assets drive web icons versus native cold-launch splash assets.

## RC Attempts

| Tag         | Status                | Notes                                                                                                                |
| ----------- | --------------------- | -------------------------------------------------------------------------------------------------------------------- |
| `0.7.9-rc1` | pending investigation | Git tag exists already; no GitHub release currently exists. Must be validated or superseded based on final fix path. |

## Pass/Fail Gate

- PASS only if published RC Android and iOS artifacts both contain the required bundled dependency set, 7-Zip support is present and evidenced, tests pass, the release is marked prerelease, and the artifact contents explain the size change.
- FAIL if either platform remains missing required runtime payload or if the published RC artifacts cannot be proven equivalent to the expected packaged contents.

## Remaining Work

- All investigation, comparison, fix, validation, and RC release verification work remains open.

# 2026-04-24 CI Integrity Recovery

## Classification

- `CODE_CHANGE`
- `DOC_PLUS_CODE`

## Problem Statement

- Restore full CI integrity for the current branch and tagged release flows.
- Current known failure includes `tests/unit/ci/telemetryGateWorkflow.test.ts` and release/tag logic that diverged after variant-aware workflow changes.
- RC tags must create GitHub prereleases while skipping Android artifact publication and Google Play upload.
- Final tags must keep Android artifact upload and Google Play upload intact when signing material is present.

## Failing CI Components

- `tests/unit/ci/telemetryGateWorkflow.test.ts`
- Android tag/release gating in `.github/workflows/android.yaml`
- Variant-aware release artifact handling introduced after the `0.7.7` baseline
- Tagged release semantics across Android, web, and iOS workflows

## Ranked Hypotheses

1. Android RC release creation regressed when release handling moved into variant-aware jobs: the tag-scoped `release-artifacts` job still runs for all tags, but the `Ensure GitHub release exists` step is now gated to stable tags with keystore presence, so RC tags no longer create prereleases.
2. The failing unit test still encodes the intended CI policy, and the workflow is the side that drifted from that policy.
3. Variant support is likely causal for the Android regression because variant matrix jobs now own release creation and artifact attachment, but web and iOS kept unconditional tag-scoped release creation.
4. Any remaining failure beyond the unit test will likely be around release idempotence or tag-format handling rather than telemetry monitoring itself.

## First Local Hypothesis And Cheap Check

- Local hypothesis: `.github/workflows/android.yaml` incorrectly guards GitHub release creation behind the stable-tag artifact gate instead of allowing RC tags to create prereleases.
- Cheap disconfirming check: compare the `release-artifacts` job and its `Ensure GitHub release exists` step against `0.7.7`, then run `tests/unit/ci/telemetryGateWorkflow.test.ts` to confirm the exact contract mismatch.

## Execution Plan

1. Read the failing CI contract test, Android/web/iOS workflows, and helper scripts that resolve build versions and variants.
2. Compare CI workflows, CI tests, and supporting scripts across `0.7.7`, current `main`, and the working tree.
3. Record the regression table below and identify the first commit that introduced the Android RC release regression if history is conclusive.
4. Determine whether the workflow or the test is authoritative using the `0.7.7` baseline and the stated RC/final release policy.
5. Apply the smallest workflow fix that restores RC prerelease creation without weakening stable-tag artifact and Play upload gates.
6. Add or update regression coverage only where needed to lock the intended production behavior.
7. Run focused validation first, then the required repository validation set for code changes.
8. Validate branch CI locally as far as possible, then push incrementing RC tags (`0.7.8-rcN`) until one real GitHub Actions run passes and creates a prerelease without Android uploads.
9. Confirm final-tag logic remains intact and clean up any temporary debugging before closeout.

## Historical Regression Table

| Area                                    | Change                                                                                                                                                | Likely Impact                                                                                                                               | Confidence |
| --------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- | ---------- |
| Android release creation                | `360fdee9` changed `Ensure GitHub release exists` from tag-scoped to stable-tag-only-with-keystore while leaving RC prerelease logic in the step body | RC tags stopped creating GitHub prereleases because the release-creation step never ran for `*-rc*` tags                                    | High       |
| Android artifact upload gating          | `0.7.7` gated Android release artifacts on any tag with keystore; newer workflow tightened artifact, AAB, and Play upload steps to stable tags only   | Stable-only artifact gating is correct, but it cannot also own RC prerelease creation                                                       | High       |
| Variant selection / matrix publish flow | Variant-aware jobs added `variant-selection`, publish matrices, and per-variant artifact names to Android packaging and release attachment            | Variant support is incidental to the RC prerelease bug; the bug came from collapsing release creation and artifact publishing into one path | Medium     |
| CI contract tests                       | `360fdee9` added the failing assertion that the Android artifact-attachment job itself must be stable-tag-only                                        | The test captured the intended stable-only artifact policy but lacked a companion assertion for RC prerelease creation                      | High       |
| Supporting scripts                      | `scripts/resolve-build-version.mjs` and `web.yaml` retained correct tag-aware version semantics                                                       | Supporting scripts are not causal for the Android RC regression                                                                             | High       |

## Root Cause Summary

- Exact failing expectation from `tests/unit/ci/telemetryGateWorkflow.test.ts`:
  - `if: startsWith(github.ref, 'refs/tags/') && !contains(github.ref_name, '-rc')`
  - `    needs: [variant-selection, web-coverage-merge, android-tests, android-packaging]`
- Exact workflow mismatch before the fix:
  - `release-artifacts` was still `if: startsWith(github.ref, 'refs/tags/')`
  - `Ensure GitHub release exists` had been tightened to `if: startsWith(github.ref, 'refs/tags/') && !contains(github.ref_name, '-rc') && env.HAS_KEYSTORE == 'true'`
- Why the mismatch existed:
  - The stable-only artifact policy was applied to the release-creation step without introducing a separate RC prerelease path.
  - That left RC prerelease logic text present inside the step body, but unreachable because the step no longer ran for RC tags.
- Authoritative side:
  - The intended CI policy is authoritative: RC tags must create prereleases and must not upload Android artifacts or Google Play builds.
  - `0.7.7` proves prerelease creation belonged on the tag path, while the new test correctly proves artifact publication must be stable-only.
  - The correct resolution is therefore `C) both diverged from the intended spec`: the workflow lost the RC prerelease path, and the test needed an additional assertion for that path.

## Regression Commit Identification

- First behavior regression: `360fdee9` (`Fix/android test coverage build (#237)`) tightened Android release creation behind the stable-tag artifact gate.
- Earlier baseline behavior in `0.7.7` and `HEAD^` kept `Ensure GitHub release exists` tag-scoped, which allowed RC prerelease creation.
- Variant support is incidental rather than causal for this specific regression; the decisive change was the stable-only guard added to the release-creation step itself.

## Validation Outcome

- Local focused regression: `tests/unit/ci/telemetryGateWorkflow.test.ts` passed after both workflow edits.
- Local validation: `npm run test` passed, `npm run build` passed, and `npm run test:coverage` passed with `91.99%` branch coverage.
- Branch CI passed on corrected commit `8a92f6f67c4935eb8e5a898ceff193efd0503bd0`:
  - Android: run `24907527691`
  - iOS: run `24907527692`
  - Web: run `24907527670`
- RC tag `0.7.8-rc1` failed only in Android run `24906575010` because the new prerelease job lacked a checkout step; the tag and prerelease were deleted before retry.
- RC tag `0.7.8-rc2` passed completely:
  - Android: run `24907532176`
  - iOS: run `24907532188`
  - Web: run `24907532183`
- RC release result for `0.7.8-rc2`:
  - GitHub release exists and is marked `prerelease`
  - Android `Release | Create prerelease` succeeded
  - Android `Release | Attach APK/AAB (${{ matrix.variant }})` was skipped
  - Attached assets contain only `c64commander-0.7.8-rc2-ios.ipa`, which confirms no Android APK/AAB release asset upload occurred for the RC tag

# 2026-04-22 Variant Spec Minimal Patch

## Classification

- `DOC_ONLY`

## Ordered Steps

1. [x] Audit the current variant spec, prompt, and plan documents to identify the exact sections that need minimal amendments.
2. [x] Perform a targeted repository audit for variant-sensitive external endpoints covering default device host resolution, HVSC runtime URLs, and CommoServe runtime URLs; reject speculative additions.
3. [x] Update `docs/research/variants/variant-spec.md` first with only the required schema evolution, endpoint, identifier uniqueness, data-isolation, and generator-validation rules.
4. [x] Update `docs/research/variants/prompt.md` to enforce schema-version awareness, evidence-based endpoint changes, uniqueness validation, variant-safe web isolation, and strict generator validation.
5. [x] Update `docs/research/variants/plan.md` to add endpoint audit gating, schema evolution validation, identifier validation, storage/cache prefix validation, and blocking generator validation checks.
6. [x] Verify the three variant documents are internally consistent, reflect the endpoint audit result, and contain no contradictions.
7. [x] Mark this plan complete in `PLANS.md` after consistency verification finishes.

# 2026-04-22 Minimal Operational Feature Flag Audit

## Classification

- `CODE_CHANGE`
- `DOC_PLUS_CODE`

## Scope And Constraints

- Primary map: `docs/features-by-page.md`
- Authoritative registry: `src/lib/config/feature-flags.yaml`
- Runtime owners under review:
  - `src/pages/HomePage.tsx`
  - `src/pages/PlayFilesPage.tsx`
  - `src/pages/playFiles/hooks/usePlaybackController.ts`
  - `src/lib/native/backgroundExecutionManager.ts`
  - `src/components/disks/HomeDiskManager.tsx`
  - `src/components/diagnostics/GlobalDiagnosticsOverlay.tsx`
  - `src/components/UnifiedHealthBadge.tsx`
  - `src/hooks/useTelnetActions.ts`
- Deliverables:
  - `docs/research/feature-flags/audit.md`
  - `PLANS.md`
  - `WORKLOG.md`
  - feature-flag registry/runtime/tests only if a candidate survives strict evaluation

## Ordered Steps

1. Phase 1: Exhaustive targeted audit
   Files: feature-surface docs plus the owning runtime files for Telnet, background playback, HVSC, disk sync, diagnostics, and saved-device switching.
   Change: trace actual lifecycle control paths, external dependencies, timing sensitivity, and verified tests for each candidate area.
   Verification: `docs/research/feature-flags/audit.md` records exact code locations, dependency shape, risk class, and verified test evidence.

2. Phase 2: Strict evaluation
   Files: `docs/research/feature-flags/audit.md`
   Change: accept only candidates whose OFF state preserves a usable app, isolates non-core failure-prone behavior, has real mitigation value, and maps to a safe degraded mode.
   Verification: each candidate is explicitly marked `ACCEPTED` or `REJECTED` with code-tied reasoning.

3. Phase 3: Flag design for accepted candidates only
   Files: `docs/research/feature-flags/audit.md`, `src/lib/config/feature-flags.yaml` if justified
   Change: define identifier, default, scope, ON/OFF behavior, degraded mode, and mitigated failures; extend existing flags instead of creating overlaps when the behavior already has a flag.
   Verification: every accepted flag has a deterministic OFF path and no overlapping responsibility.

4. Phase 4: Runtime integration
   Files: runtime owners for accepted flags only
   Change: wire the OFF path through real control flow, not UI-only hiding, while preserving existing behavior when enabled.
   Verification: accepted flags gate the full lifecycle of their feature area and leave the app usable when individually disabled.

5. Phase 5: Test enforcement
   Files: targeted unit/integration tests for each accepted flag
   Change: add ON/OFF regressions and keep the default shared test bootstrap in the all-flags-enabled state.
   Verification: at least one OFF-path assertion exists per implemented flag and default test setup still enables all registered flags.

6. Phase 6: Validation and closeout
   Files: `WORKLOG.md`
   Change: record focused validation plus the required repository validation set for code changes.
   Verification: targeted tests pass, `npm run lint` passes, `npm run build` passes, and `npm run test:coverage` passes with global branch coverage at or above 91%.

# 2026-04-22 Feature Flag Semantics Refactor

## Classification

- `CODE_CHANGE`
- `DOC_PLUS_CODE`

## Ordered Steps

1. Phase 1: Static analysis
   Files: `src/lib/config/feature-flags.yaml`, `scripts/compile-feature-flags.mjs`, `src/lib/config/featureFlagsRegistry.generated.ts`, `src/lib/config/featureFlags.ts`, `tests/unit/**`, `docs/research/feature-flags/feature-flags.md`
   Change: identify every schema, compile-time, generated-output, runtime, UI, and documentation reference tied to authored standard-user toggleability.
   Verification: repository search and targeted reads show the controlling path is YAML -> compiler -> generated registry -> runtime resolver -> tests/docs.

2. Phase 2: Schema simplification
   Files: `src/lib/config/feature-flags.yaml`, `docs/research/feature-flags/feature-flags.md`
   Change: keep only `enabled`, `visible_to_user`, and `developer_only` as authored semantics; document that standard-user editability is derived from `visible_to_user && !developer_only`.
   Verification: YAML examples, comments, and documentation are internally consistent and no longer describe authored toggleability as a separate field.

3. Phase 3: Compiler and generated output update
   Files: `scripts/compile-feature-flags.mjs`, `src/lib/config/featureFlagsRegistry.generated.ts`, `tests/unit/scripts/compileFeatureFlags.test.ts`
   Change: keep compile-time validation for `developer_only: true => visible_to_user: false`, emit the reduced feature shape, and lock the minimal emitted shape in tests.
   Verification: compiler tests pass, generated output matches the reduced schema, and the generated registry stays up to date.

4. Phase 4: Runtime resolution update
   Files: `src/lib/config/featureFlags.ts`, `tests/unit/config/featureFlags.test.ts`, `tests/unit/hooks/useFeatureFlags.test.tsx`
   Change: derive standard-user editability from visibility plus non-developer status, without changing developer-mode behavior, defaults, or visibility.
   Verification: runtime tests prove visible public flags are editable, hidden developer-only flags stay hidden and non-editable, and developer mode still exposes everything.

5. Phase 5: Dead reference elimination
   Files: `PLANS.md`, `WORKLOG.md`, `docs/research/feature-flags/feature-flags.md`, `tests/unit/scripts/compileFeatureFlags.test.ts`
   Change: remove stale references to the deleted authored field from plans, worklog, docs, and tests.
   Verification: a repository-wide search for the removed field name returns zero matches.

6. Phase 6: Validation and closeout
   Files: `WORKLOG.md`
   Change: record results for the focused feature-flag checks and the required repository validation set.
   Verification: focused feature-flag tests pass, `npm run lint` passes, `npm run build` passes, and `npm run test:coverage` passes with global branch coverage at or above 91%.

# HVSC Playlist Convergence Plan

## Classification

- `CODE_CHANGE`
- `UI_CHANGE`

### 2026-04-06 device-scale harness execution

- Classification: `CODE_CHANGE`
- Current task: `HARNESS-ANDROID-SCALE-001`
- Current dominant bottleneck: not selected yet; honest required-platform baselines remain the gate.
- External prerequisites verified before implementation:
  - preferred Pixel 4 attached over adb: `9B081FFAZ001WX`
  - real C64U host reachable at `http://u64/v1/info`
  - real web archive inputs present at `~/.cache/c64commander/hvsc/HVSC_84-all-of-them.7z` and `~/.cache/c64commander/hvsc/HVSC_Update_84.7z`
- Harness changes now landed and validated:
  - `.maestro/perf-hvsc-baseline.yaml` no longer seeds the measurement run with the single-track `10_Orbyte.sid` path
  - `perf-hvsc-setup-playlist` remains the large-playlist setup phase
  - smoke snapshots now record playlist size and feedback visibility metadata for download, ingest, add-to-playlist, filter, and playback-start
  - playlist filter smoke artifacts now emit `playlist-filter-high`, `playlist-filter-low`, and `playlist-filter-zero` instead of collapsing into one overwritten `playlist-filter` file
  - Android summary output now includes `feedbackEvidence`, `targetEvidence.UX1`, and `targetEvidence.T6`
  - playback-start smoke artifacts now carry playlist-size context from the Play page controller
- Validation completed for the harness change:
  - targeted regressions passed for Android summary, Maestro contracts, playlist filtering, add-to-playlist smoke metadata, playback smoke metadata, and HVSC snapshot emitters
  - `npm run lint`: passed with 3 non-fatal warnings in generated `c64scope/coverage/*` files
  - `npm run build`: passed
  - `npm run test:coverage`: passed with 496 test files, 5642 tests, and 91.15% branch coverage
- Remaining work on this execution path:
  - keep `ci-artifacts/hvsc-performance/web/web-full-nightly.json` as an explicit unsupported blocker artifact until the web S1-S11 suite can run at full scale without fixture-backed browse/playback phases
  - diagnose the Pixel 4 large-playlist setup failure seen in `20260406T1730Z-hvsc-android-pilot` before retrying the Android baseline; the pilot never reached `Items added`, ended with a zero-byte Perfetto trace, and the device dropped off adb afterward
  - rerun the first honest Pixel 4 Android baseline with `summary.json`, a non-empty Perfetto trace, extracted metrics, playlist-size evidence, and UX feedback evidence once the setup failure is resolved
  - update the target matrix only from those measured artifacts

### 2026-04-06 follow-up convergence closure

- Classification: `DOC_ONLY`
- Scope of this follow-up: verify the live Add Items chooser and import screenshots, then refresh the stale HVSC audit and remaining-work prompt to match the current repository state.
- Validation scope before implementation:
  - run targeted chooser regressions in `tests/unit/components/FileOriginIcon.test.tsx` and `tests/unit/components/itemSelection/ItemSelectionDialog.test.tsx`
  - verify the referenced Play import screenshots exist and match the live UI before considering any regeneration
  - re-read touched tracker and audit documents and verify every referenced repo path or artifact path exists
- Constraint: do not reopen prior code or screenshot work unless the live tree disproves the existing implementation or documentation.

## 2026-04-06 Follow-up Convergence Status

- [x] `UI-SOURCE-001` Verified the live Add Items chooser against code, targeted regressions, and the current import screenshots; no code change required.
- [x] `UI-DOC-002` Verified the README import screenshot references and the five referenced screenshot files; no screenshot regeneration required.
- [x] `PERF-AUDIT-003` Refreshed `docs/research/hvsc/performance/audit/audit.md` against the current tree, trackers, workflows, and artifact roots.
- [x] `PERF-PROMPT-004` Replaced `docs/research/hvsc/performance/audit/convergence-prompt.md` with the real remaining work only.
- [x] `CLOSE-005` Rechecked the touched trackers and audit documents so the current repo state, evidence paths, and remaining-work prompt agree.

## Mission

Restore deterministic playlist correctness for HVSC imports and large playlists. The import workflow must not declare completion until playlist persistence is complete, repository reads reflect the full dataset, and the UI can immediately render the correct playlist state without waiting for background sync.

## P0 Failure Statement

Observed failure:

1. Import completes, playlist appears empty, then items materialize later.
2. `View all` appears only after delayed playlist materialization.

Validated root cause:

- `useQueryFilteredPlaylist` currently mirrors the full React playlist into the repository asynchronously on every playlist mutation.
- Large imports create a backlog of full-playlist rewrites.
- The hook suppresses repository-backed results until the async mirror finishes, so UI correctness lags behind the import completion signal.

## Non-negotiable Rules

- Lazy behavior is allowed only for rendering and paging.
- Lazy behavior is forbidden for persistence, correctness, completion semantics, and UI truth.
- `Import complete` must occur only after repository write completion and read-back validation.
- There must be zero real repository writes after the UI transitions to ready for a given snapshot.

## Execution Order

### Phase 1. Ingest to Playlist Consistency

- [x] Instrument scan start and end, batch creation, batch append, repository commit start and end, repository validation, and UI readiness transition.
- [x] Introduce an explicit playlist import state machine with `SCANNING`, `INGESTING`, `COMMITTING`, and `READY`.
- [x] Replace eventual repository mirroring with an explicit commit barrier for playlist imports.
- [x] Add repository read-back validation so expected item count must equal committed item count before success.
- [x] Fail loudly and keep the workflow non-ready if repository validation fails.

### Phase 2. Restore `View all` Availability

- [x] Decouple `View all` visibility from lazy rendered rows.
- [x] Base `View all` availability on authoritative item counts instead of overflow-only preview state.
- [x] Apply the fix to both Play page and Disks page shared list surfaces.

### Phase 3. Rebuild `View all` Bottom Sheet for Scale

- [x] Keep eager correctness metadata only: count, ordering, section anchors.
- [x] Keep rendering windowed with virtualization.
- [x] Keep repository fetch incremental with paging for large lists.
- [x] Add fast jump affordances for large result sets.
- [x] Ensure first viewport opens immediately without blocking on full list hydration.

### Phase 4. Harden Playlist Hydration and Query Model

- [x] Audit and fix `playlistRepository`, `usePlaybackPersistence`, `useQueryFilteredPlaylist`, and `usePlaylistListItems` integration.
- [x] Remove stale cache and hidden async rebuild dependencies from playlist correctness.
- [x] Introduce explicit repository invalidation and ready revision tracking after each committed snapshot.
- [x] Guarantee deterministic read-after-write behavior for repository-backed queries.

### Phase 5. Regression and Stress Coverage

- [x] Add a consistency test for 10K+ imported items with immediate repository count assertion.
- [x] Add a regression test proving the UI does not report completion before repository commit resolves.
- [x] Add a UI test proving playlist visibility and `View all` availability immediately after import readiness.
- [x] Add a large-playlist stress test covering load more, filtering, and deletion/update behavior at 50K+ scale.
- [x] Hold changed-code branch coverage above 91% during `npm run test:coverage`.

### Phase 6. Performance Re-measurement

- [x] Re-measure S6 add to playlist.
- [x] Re-measure S7 playlist render.
- [x] Re-measure S8 to S10 playlist filtering.
- [x] Update target status for T2 ingest, T3 browse, and T4 filter.
- [x] Record evidence and blockers in `WORKLOG.md`.

## Current Evidence

- Focused regression validation passed: 95 targeted tests, 0 failed.
- Earlier closeout validation passed: `npm run test:ci` end-to-end, including screenshots, Playwright E2E, evidence validation, trace validation, and production build.
- Current follow-up validation passed:
  - `npm run screenshots`: 21 screenshot tests passed; 148 PNGs scanned, 148 kept
  - `npm run lint`: passed with 3 non-fatal warnings in generated `c64scope/coverage/*` files
  - `npm run build`: passed
  - `npm run test:coverage`: passed with 496 test files, 5639 tests, and 91.17% branch coverage
- Additional regressions covered during the convergence and follow-up cleanup passes:
  - delayed device-id playlist hydration now retries against the resolved playlist storage key before persistence resumes
  - stale Maestro and smoke-mode tests were updated to match current runtime behavior
  - Playwright layout and Home interaction assertions were refreshed to match current UI behavior and tolerance
  - Add Items source chooser icons now share a fixed slot width, including CommoServe
  - diagnostics history analysis now shows an expanded, scrollable health-check timeline for the selected segment
- Fresh web fixture perf artifact: `ci-artifacts/hvsc-performance/web/web-full-quick.json`
  - S6 add to playlist: `1613.72 ms` wall clock, `playlist:add-batch` p95 `17.2 ms`, `playlist:repo-sync` p95 `21.1 ms`
  - S7 render playlist: `6.75 ms` wall clock
  - S8 filter high match: `545.53 ms` wall clock, `playlist:filter` p95 `17.2 ms`
  - S9 filter zero match: `544.06 ms` wall clock, `playlist:filter` p95 `16.6 ms`
  - S10 filter low match: `550.23 ms` wall clock, `playlist:filter` p95 `13.9 ms`
  - Target evidence from the same run: T2 ingest `228.4 ms` pass, T3 browse `334.64 ms` pass, T4 filter `550.23 ms` pass

## Audit Reconciliation Snapshot

### Convergence Ledger Status

- Closed in the current repository state:
  - `P0.1` Reconcile tree with audit and trackers
  - `P0.2` Normalize artifact directory strategy
  - `P1.1` Close benchmark matrix gap `S1` through `S11`
  - `P1.2` Make the web perf harness benchmark real download and ingest
  - `P1.3` Close Android benchmark harness gap
  - `P1.4` Close instrumentation coverage gap
  - `P1.5` Close Perfetto pipeline gap
  - `P1.6` Close microbenchmark gap
- Still open:
  - `P2.1` Capture the first honest full baseline
  - `P2.2` Build the first pass/fail matrix
  - `P3.1` Execute Cycle 1 against the single dominant bottleneck
  - `P3.2` Repeat optimization cycles until every target is either passing or formally blocked
  - `P4.1` Close quick-CI gap
  - `P4.2` Close nightly-CI gap
  - `P5.1` Re-audit against `docs/research/hvsc/performance/audit/audit.md`
  - `P5.2` Produce final convergence record

Evidence anchors:

- `WORKLOG.md` entries:
  - `2026-04-05 09:00` (`P0.1`)
  - `2026-04-05 09:15` (`P0.2`)
  - `2026-04-05 09:30` (`P1.1`)
  - `2026-04-05 22:15` (`P1.2`)
  - `2026-04-05 23:30` (`P1.3`)
  - `2026-04-06 00:00` (`P1.4`)
  - `2026-04-06 00:15` (`P1.5`)
  - `2026-04-06 00:20` (`P1.6`)

### Target Status Snapshot

# 2026-04-22 Branding Configuration Research

## Classification

- `DOC_ONLY`

## Scope And Impact Map

- Docs to add or update:
  - `docs/research/branding/branding.md`
  - `PLANS.md`
  - `WORKLOG.md`
- Repository surfaces to inspect:
  - Android: `android/app/build.gradle`, `android/app/src/main/AndroidManifest.xml`, `android/app/src/main/res/**`, generated `android/app/src/main/assets/capacitor.config.json`
  - iOS: `ios/App/App/Info.plist`, `ios/App/App.xcodeproj/project.pbxproj`, `ios/App/App/Assets.xcassets/**`, `ios/App/App/Base.lproj/LaunchScreen.storyboard`, generated `ios/App/App/capacitor.config.json`
  - Web: `index.html`, `public/manifest.webmanifest`, `public/*`, `src/index.css`, `tailwind.config.ts`, `src/hooks/useTheme.ts`, `src/pages/HomePage.tsx`, `public/sw.js`
  - Shared/build/release: `capacitor.config.ts`, `package.json`, `vite.config.ts`, `src/lib/buildVersion.ts`, `src/lib/versionLabel.ts`, `src/lib/buildInfo.ts`, `web/Dockerfile`, `web/server/src/**`, `.github/workflows/android.yaml`, `.github/workflows/ios.yaml`, `.github/workflows/web.yaml`, `.github/workflows/pages.yaml`, `scripts/**`
- Screenshot scope:
  - none; this is research-only and does not change visible UI
- Validation scope:
  - documentation accuracy and internal consistency only; no builds or tests because the task is `DOC_ONLY`

## Phases

- [x] Phase 1: Read repository guidance and classify the task.
      Completion criteria: `README.md`, `.github/copilot-instructions.md`, and the relevant branding/build files have been reviewed; change class and validation scope are explicit.
- [x] Phase 2: Map the current branding state across Android, iOS, web, Capacitor, and CI.
      Completion criteria: app name, identifiers, assets, theming hooks, build-time config, and release/artifact naming locations are evidence-backed.
- [x] Phase 3: Evaluate configuration and private-branding strategy options.
      Completion criteria: platform-native, generated, runtime, hybrid, and CI-driven options are compared; GitHub private fork/branch/repo models are assessed with explicit risks.
- [x] Phase 4: Write the implementation-ready research document.
      Completion criteria: `docs/research/branding/branding.md` contains all required sections, one decisive recommendation, and a precise no-code implementation plan.
- [x] Phase 5: Finalize the execution record.
      Completion criteria: this plan and `WORKLOG.md` reflect the completed phases, validation scope, and final evidence.

| Target | Current honest status                                                                | Evidence                                                                            |
| ------ | ------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------- |
| `T1`   | Open: not yet measured on both required platforms                                    | No current Docker web + Pixel 4 evidence recorded in `PLANS.md` / `WORKLOG.md`      |
| `T2`   | Partial only: web fixture evidence exists; full required-platform closure still open | `ci-artifacts/hvsc-performance/web/web-full-quick.json`                             |
| `T3`   | Partial only: web fixture evidence exists; Pixel 4 closure still open                | `ci-artifacts/hvsc-performance/web/web-full-quick.json`                             |
| `T4`   | Partial only: web fixture evidence exists; Pixel 4 closure still open                | `ci-artifacts/hvsc-performance/web/web-full-quick.json`                             |
| `T5`   | Open: no current required-platform closure recorded                                  | No current target-closing artifact recorded in `PLANS.md` / `WORKLOG.md`            |
| `T6`   | Open: not yet closed on Pixel 4 and Docker web                                       | Node-side stress evidence exists, but required-platform closure is not yet recorded |

### Current Bottleneck Selection

- No dominant optimization bottleneck is currently selected.
- Reason: the honest full baseline required by `P2.1` and `P2.2` is still incomplete, so later convergence cycles remain open by definition.

## Success Criteria

- [x] Playlist state is correct immediately after import completion.
- [x] UI correctness no longer depends on delayed background repository work.
- [x] `View all` is always available for non-empty authoritative lists.
- [x] Large imports remain correct and measurable at 50K+ items.
- [x] Performance targets are either measured with evidence or explicitly blocked with current bottleneck details.
