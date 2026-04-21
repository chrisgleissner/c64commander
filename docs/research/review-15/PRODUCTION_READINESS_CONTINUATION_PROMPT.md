# Production Readiness Continuation Prompt

## ROLE

You are the implementation hardening agent for C64 Commander. You are not re-running the audit from scratch. You are continuing from the current repository-derived review at `docs/research/review-15/review-15.md` and closing the remaining production-readiness work.

## PRIMARY GOAL

Reach a truthful Android production-readiness state first.

After the Android-critical and Android-high gaps are closed and validated, continue with the iOS and web follow-up items that the review still marks as weak or absent.

## PRIMARY INPUTS

Read these first:

- `docs/research/review-15/review-15.md`
- `.github/copilot-instructions.md`
- `AGENTS.md`
- `README.md`
- `docs/testing/maestro.md`

Use these review sections as the current source of truth:

- Section 4: Feature-to-Test Matrix
- Section 5: Risk Register
- Section 6: Proposed Test Backlog
- Section 7: Completeness Report

## WHAT IS STILL OUTSTANDING

Treat the following as the active backlog unless current repository evidence proves an item was already completed after the review.

## Android-first blockers

These are the highest-priority items for Android production readiness.

1. `settings__safety_presets`
   - Risk: destructive actions may bypass the intended preset gate or confirmation path.
   - Required closure: add the missing preset-by-action regression matrix.
   - Review anchors: `R-01`, `T-01`.

2. `play__hvsc_lifecycle`
   - Risk: cancel or restart during ingest can leave partial or misleading state.
   - Required closure: add cancel/resume/ready invariants now for the shared pipeline and Android path; keep iOS parity as a follow-on within the same feature if touched.
   - Review anchors: `R-02`, `T-02`.

3. `app__connection_controller`
   - Risk: stale health can remain visible after suspend/resume.
   - Required closure: add the missing integration proof for staleness threshold expiry and re-probe behavior.
   - Review anchors: `R-03`, `T-08`.

4. `diagnostics__share_zip`
   - Risk: string-level redaction tests may still miss archive-level leakage.
   - Required closure: add an end-to-end ZIP audit.
   - Review anchors: `R-04`, `T-03`.

5. `play__playback_transport`
   - Risk: short tracks may skip or double-advance under race conditions.
   - Required closure: add the missing integration race harness and hardware proof on the preferred real-device target order.
   - Review anchors: `R-05`, `T-04`.

6. `play__lock_screen_playback`
   - Risk: Android background execution may still fail under real OEM power policy.
   - Required closure: add Pixel 4 physical-device evidence and any supporting code/test fixes required to make it pass.
   - Review anchors: `R-06`, `T-05`.

7. `disks__mount`
   - Risk: client-mounted state can diverge from device state during reset or rotation races.
   - Required closure: add the missing integration race test and fix the root cause if it fails.
   - Review anchors: `R-07`, `T-06`.

8. `config__edit`
   - Risk: immediate-apply writes can lose the last user value on navigation.
   - Required closure: add the navigation-during-throttle integration test and fix the root cause if it fails.
   - Review anchors: `R-08`, `T-07`.

9. `home__ram_operations`
   - Risk: SAF or REU flows can fail mid-operation and leave partial state.
   - Required closure: add revocation/interrupted-write tests plus Pixel 4 physical proof where required.
   - Review anchors: `R-09`, `T-12`.

## Android evidence gaps that should be closed once the blockers above are stable

These are not all critical, but they still matter for an honest Android readiness claim.

1. `android_native__folder_picker`
   - Add Pixel 4 SAF persistence evidence.

2. `android_native__secure_storage`
   - Add physical-device evidence for password persistence under realistic lifecycle conditions.

3. `android_native__telnet_socket`
   - Add either targeted automation or HIL stress proof for the JS-to-native Telnet path.

4. `android_native__ftp_client`
   - Strengthen evidence that the JS-to-native FTP path behaves correctly on the preferred handset and real hardware target.

5. `android_native__safe_area`
   - Add actual device-flow proof for inset behavior on the preferred handset.

## iOS follow-up after Android

Do not prioritize these ahead of Android readiness unless shared fixes naturally touch them.

1. `ios_native__plugin_registry`
   - Add a real iOS unit target that validates the registered plugin set.
   - Review anchors: `R-10`, `T-10`.

2. `play__hvsc_lifecycle` and `ios_native__hvsc_ingestion`
   - Mirror the missing native HVSC parity work on iOS once the shared pipeline is stable.

## Web follow-up after Android

1. `web_runtime__security_headers`
   - Add snapshot or server-process assertions for the production header matrix.
   - Review anchors: `R-11`, `T-11`.

2. `app__global_diagnostics_overlay`
   - Add route-map and deep-link coverage for all diagnostics URLs, including heatmaps.
   - Review anchors: `R-12`, `T-09`.

## EXECUTION ORDER

Follow this order unless current code forces a narrower dependency-first reordering.

## Phase 0: Reconfirm the backlog against current code

- Re-read `review-15.md` Sections 4-7.
- Verify whether any backlog item has already been implemented since the review was written.
- Do not blindly trust the backlog if current code proves otherwise.

Completion gate:

- Active backlog list is current.
- Any already-fixed item is removed or downgraded with evidence.

## Phase 1: Close Android P0/P1 correctness gaps in code and tests

Target items:

- `T-01`
- `T-02`
- `T-03`
- `T-06`
- `T-07`
- `T-08`

Completion gate:

- The missing tests exist.
- Root-cause fixes are in place where the new tests fail.
- No assertion weakening or test skipping was introduced.

## Phase 2: Close Android physical-device evidence gaps

Target items:

- `T-04`
- `T-05`
- `T-12`
- folder picker / secure storage / telnet / FTP / safe-area Android evidence gaps from the matrix

Device rules:

1. Probe `http://u64/v1/info` first.
2. Probe `http://c64u/v1/info` second.
3. If `u64` is reachable, use it as the preferred hardware target.
4. Fall back to `c64u` only if `u64` is unreachable.
5. Prefer the ADB-attached Pixel 4 when a physical Android device is available.

Completion gate:

- Android hardware-dependent features no longer rely only on non-hardware evidence where HIL is required.
- Pixel 4 and target-hardware evidence is recorded honestly.

## Phase 3: Close iOS follow-up gaps

Target items:

- `T-10`
- any iOS-specific HVSC or plugin-registry parity work uncovered while closing Android/shared issues

Completion gate:

- iOS coverage claims are stronger and more truthful than in the current review.

## Phase 4: Close web follow-up gaps

Target items:

- `T-09`
- `T-11`
- any web integration gaps that remain blocking for truthful parity claims

Completion gate:

- Web claims no longer rely only on logic-unit tests where server-process or route-level coverage is required.

## Phase 5: Reconcile the review document

After implementation work:

- update `docs/research/review-15/review-15.md`
- revise Section 4 coverage statuses changed by the new tests or HIL artifacts
- remove, downgrade, or close risks in Section 5 that are no longer current
- remove or mark completed proposals in Section 6 that were implemented
- keep the completeness report truthful

Completion gate:

- The review reflects the current repository state, not the pre-fix backlog.

## RULES

1. Do not open a new review file.
2. Do not convert this into another broad audit.
3. Fix root causes rather than papering over failures.
4. Every bug fix must add or tighten a regression test.
5. Do not weaken assertions just to make the suite pass.
6. Keep Android as the primary release target until its blockers are genuinely closed.
7. Treat iOS and web as follow-on hardening unless a shared fix naturally improves them.

## VALIDATION

Use the smallest honest executable set for the files you touched, but for any real code change you must finish with the repo-required validation for the touched layers.

Typical minimum for Android-first changes touching app code:

- `npm run lint`
- `npm run test`
- `npm run test:coverage`
- `npm run build`
- `cd android && ./gradlew test`

Add targeted validation when appropriate:

- Playwright for web/shared route and overlay work
- Maestro for Android flows you changed or added
- Android physical-device proof on Pixel 4 when the feature depends on native lifecycle, SAF, background execution, or real hardware behavior

Do not claim validation you did not run.

## SUCCESS CRITERIA

You may stop only when all of the following are true:

1. The Android-critical and Android-high backlog items that are still current have been implemented or explicitly reclassified with evidence.
2. New regression tests exist for each fixed bug or race condition.
3. Android hardware-dependent claims are backed by truthful Pixel 4 and target-hardware evidence where required.
4. iOS and web follow-up items touched during the work are kept truthful and validated for the touched scope.
5. `review-15.md` has been updated to reflect the new repository state.
6. The final state can be described as closer to Android production readiness for concrete, evidence-backed reasons rather than hopeful language.
