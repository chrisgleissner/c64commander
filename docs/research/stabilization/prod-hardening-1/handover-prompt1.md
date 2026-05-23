 ROLE

You are an expert Capacitor, Android, iOS, and web app engineer continuing an existing C64 Commander production-hardening implementation.

You are not starting from a clean slate. You are taking over a partially modified working tree. Your first job is to understand, validate, and converge the current diff. Only then continue the remaining production-hardening findings from the original prompt.

The original prompt is in:

docs/research/stabilization/prod-hardening-1/prompt.md

The user referred to this as the lowercase prompt markdown file in:

docs/research/stabilization/prod-hardening-1/

Authoritative constraints from the original prompt still apply unless this follow-up prompt narrows or strengthens them.

CORE OBJECTIVE

Converge C64 Commander toward production readiness without removing, hiding, weakening, narrowing, or downgrading existing features.

Preserve all existing user-visible and device-facing behavior, including Play Files, playlist search and view-all, item selection, local SAF sources, HVSC, CommoServe, Ultimate FTP browsing, disk mount/upload, Telnet controls, REST config reads/writes, saved-device switching, playback, mute/volume handling, background/autoskip behavior, diagnostics, config snapshots, Save/Revert flows, tests, and documented UX affordances.

Performance, noise, and stability fixes must be feature-equivalent. Prefer cancellation, gating, batching, debouncing, coalescing, device scoping, background intent routing, and better scheduling over feature removal.

MANDATORY EXECUTION STATE

Before modifying production code, create or update PLANS.md at the repository root.

PLANS.md is the authoritative execution plan. It must contain:

1. A short current-state summary.
2. A table of tasks with IDs, finding IDs, status, touched files, test requirements, evidence requirements, and residual risk.
3. A section named "Current Diff Triage".
4. A section named "Validation Commands".
5. A section named "Device Evidence".
6. A section named "Completion Gate".

Use only these task states: TODO, DOING, BLOCKED, DONE, DEFERRED.

After creating or updating PLANS.md, immediately begin implementation and continue autonomously until the completion criteria in this prompt are met, or until a genuine blocker is documented with evidence in PLANS.md.

Also create or update WORKLOG.md. Keep it concise. Record command outcomes, evidence files, test failures, fixes, and remaining risk. Do not use WORKLOG.md as a substitute for completing the work.

STARTUP SEQUENCE

Run these steps before changing production code beyond PLANS.md and WORKLOG.md:

1. Read:
   - AGENTS.md
   - .github/copilot-instructions.md
   - docs/research/stabilization/prod-hardening-1/prompt.md
   - docs/research/stabilization/responsiveness2/FINDINGS.md
   - docs/research/stabilization/responsiveness3/FINDINGS.md
   - docs/research/stabilization/responsiveness3/IMPLEMENTATION_PROMPT.md
   - docs/research/stabilization/responsiveness3/HANDOVER_PROMPT.md
   - docs/ux-guidelines.md before any Play Files, playlist, list rendering, or UI/UX change
   - docs/testing/maestro.md before any Maestro flow change

2. Capture current working-tree state:
   - git status --short
   - git diff --stat
   - git diff --check
   - git diff -- src android/app/src/main/java tests android/app/src/test
   - git diff -- c64scope/package-lock.json

3. Classify every existing change as KEEP, REWORK, COMPLETE, or REVERT in PLANS.md.

4. Do not assume the current diff is correct because it contains PH labels. Treat all current changes as untrusted until tests and evidence prove them.

CURRENT DIFF TRIAGE REQUIREMENTS

The current diff appears to have started PH5, PH8, PH9, and PH10. Validate and converge those first before starting lower-priority untouched findings.

1. Audit suspicious unrelated lockfile churn

The diff includes c64scope/package-lock.json peer-flag changes. This appears unrelated to C64 Commander production hardening.

Required action:
- Determine whether this lockfile change is intentional and required.
- If it is unrelated, revert only this file.
- If it is required, document the exact reason in PLANS.md and WORKLOG.md.
- Do not leave unexplained package-lock churn in the final diff.

2. Audit binary diff in playlistRepositorySync.ts

The diff reports src/pages/playFiles/playlistRepositorySync.ts as a binary file.

Required action:
- Inspect the file for NUL bytes, invalid encoding, CRLF churn, or accidental binary pollution.
- Restore it to normal UTF-8 text if needed.
- Make git diff show a readable textual diff.
- Do not continue PH8 until this is corrected or explicitly proven to be a tooling artifact.

3. PH5 exception policy partial implementation

The diff has added logging in several catch paths, including:
- HvscIngestionPlugin.kt cleanup and unregister paths
- ArchiveSelectionView.tsx query preview fallback
- diagnostics logger stringify fallback
- recentTargets sessionStorage fallback
- HVSC browse/media-index parse and filesystem fallbacks
- filesystemMediaIndex parse/filesystem fallbacks
- savedDevices parse fallback

Required action:
- Re-run a fresh catch-block scan over src, android/app/src/main/java, test, and android/app/src/test.
- No empty production catch blocks may remain.
- No production catch block may return null, undefined, fallback data, or an empty value without either logging with context, rethrowing with context, or using a documented low-noise helper.
- Replace any newly introduced console.warn in production code with the repository logging/diagnostics mechanism unless repository policy explicitly allows it.
- Ensure logged errors include useful context and stack traces where available.
- For expected absence, such as first-run missing files, keep logs quiet but make unexpected failures diagnosable.
- Add or fix regression tests for saved-device parse failure, HVSC snapshot parse/read failures, diagnostics logger stringify fallback, and any shared catch-guard helper.
- Add a guardrail test or script for empty catch blocks and obvious silent fallback catches. Keep the allowlist small, explicit, and justified.

4. PH8 playlist repository snapshot key partial implementation

The diff includes tests for snapshot key changes, but the implementation diff is not readable because playlistRepositorySync.ts appears binary.

Required action:
- Make the implementation diff readable first.
- Verify whether the snapshot key is derived from the serialized repository payload or includes every persisted field.
- The key must cover all repository-persisted playlist item and track fields, including configRef, configOrigin, configOverrides, duration/durationOverrideMs, unavailableReason, status, source/origin metadata, sizeBytes, modifiedAt, item order, path, source, song number, and any other serialized fields.
- Prefer deriving the key from a stable canonical serialized payload over maintaining a hand-written partial field list.
- Keep commit coalescing for truly identical snapshots.
- Ensure tests fail on the old implementation.
- Expand tests if current tests miss configOrigin, source/origin metadata, order-only changes, or any serialized field not covered by the current test set.
- Prove unchanged snapshots still short-circuit without repository writes.

5. PH9 FTP interaction keys partial implementation

The diff adds host and port to FtpRequestMeta and passes them from ftpClient list/read/write operations.

Required action:
- Verify every withFtpInteraction caller supplies stable device scope where applicable.
- Do not rely on the fallback "any" for active multi-device or saved-device workflows unless the caller is genuinely device-independent.
- Strengthen tests so cross-host in-flight coalescing is tested concurrently, not only sequentially.
- Add tests for cooldown/backoff isolation across u64 and c64u.
- Preserve same-host same-path coalescing.
- Include host and port in diagnostics and guard records where useful.
- Confirm saved-device switching cannot reuse stale FTP in-flight or cooldown state for the new host.

6. PH10 scheduler queue cancellation partial implementation

The diff adds InteractionCancelledError and cancelAll() to InteractionScheduler, called by resetInteractionState().

Required action:
- Add regression tests proving queued REST, FTP, and Telnet work is rejected on resetInteractionState("saved-device-switch").
- Add tests proving new-device actions proceed normally after reset.
- Add tests proving same-device queued work still respects priority and concurrency.
- Make stale task cancellation classified as cancellation, not a production error.
- Do not claim running native tasks are ignored unless a generation guard or caller-side stale-result guard actually exists. If running tasks cannot be canceled, document that limitation and ensure late results cannot mutate active device state where relevant.
- Add generation guards if existing callers can still apply old-device results after reset.
- Preserve scheduler behavior, priority, backpressure, cooldown, and circuit-breaker semantics.

PHASE GATES

Phase A - Stabilize the current partial diff

Complete all items in CURRENT DIFF TRIAGE REQUIREMENTS before starting untouched original findings.

Exit criteria:
- No unexplained c64scope/package-lock.json change remains.
- playlistRepositorySync.ts produces a readable text diff.
- PH5, PH8, PH9, and PH10 are either complete with tests or explicitly downgraded in PLANS.md with concrete evidence.
- git diff --check passes.
- Targeted tests for touched areas pass.

Phase B - Continue original priority order

After Phase A, continue the original findings in this order unless current evidence proves a different order is required:

1. PH1 - Query-backed playlist filtering must not full-filter React playlist memory on repository-ready query changes.
2. PH12 - Playlist query index and list item construction must avoid full ordered scans and eager full-list object construction where selective/bounded paths are possible.
3. PH13 - Duration edits must avoid per-tick full playlist mutation and unbounded repository commit churn.
4. PH2 - Idle config snapshot must use background intent, cancellation, visibility gating, and user-interaction deferral.
5. PH3 - Background rediscovery must be gated by app visibility and Android background lifecycle.
6. PH4 - Playback start must prove connection before unmute/config reads or writes.
7. PH14 - Recursive import and native file IO need cancellation, stale-result guards, and memory hardening.
8. PH6 - Production log noise must remove default HVSC perf console output and avoid remote Google Fonts/native startup network noise.
9. PH11 - Native smoke config filesystem probing must require explicit test/debug opt-in.
10. PH15 - FTP failure logging must emit one canonical error per failure, not duplicate production errors.
11. PH7 - Complete saved-device switch-back evidence if Phase 0 has not already covered it.

For each finding:
- Verify the issue against current HEAD before changing code.
- If not reproducible, document evidence and mark DEFERRED or DONE as appropriate in PLANS.md.
- If fixing, add a regression test that would fail before the fix.
- Preserve existing features and add a no-regression assertion near the bug test.

PHASE 0 EVIDENCE REFRESH

Run Phase 0 from the original prompt before relying on device assumptions:

- adb devices
- curl --max-time 5 -sS http://u64/v1/info
- curl --max-time 5 -sS http://c64u/v1/info

Use Pixel 4 serial:

9B081FFAZ001WX

Use package:

uk.gleissner.c64commander

Expected Ultimate hosts:

- u64
- c64u

Capture evidence under:

docs/research/stabilization/prod-hardening-1-evidence/

Use short dated filenames.

Required Phase 0 proof:
- Install latest built APK to Pixel 4.
- Cold launch and capture first 12 seconds of logcat.
- Count Capacitor REST requests.
- Repeat cold boot against u64 and c64u where feasible.
- Capture Telnet plugin activity in the same window.
- Switch saved devices u64 -> c64u -> u64.
- Prove no per-item enrichment storms.
- Exercise CPU slider, playback start while muted, lock/unlock, and background/foreground.

If Phase 0 fails, fix that regression before continuing lower-priority findings.

VALIDATION RULES

For any code change:
- Run targeted tests for the changed area.
- Run npm run test:coverage.
- Global branch coverage must be at least 91 percent.
- If Android/Kotlin code changed, run the relevant Android JVM tests.
- If lint/typecheck/build commands are defined by repository policy, run them.
- Run git diff --check before completion.

For any UI-visible change:
- Read docs/ux-guidelines.md first.
- Do not refresh screenshots unless visible documented UI changed.
- Preserve existing UX affordances and actions.

For any Maestro flow change:
- Read docs/testing/maestro.md first.
- Keep flows deterministic and device-safe.

For any device-facing change:
- Prove behavior on Pixel 4 against u64.
- Use c64u when the finding is cross-device, saved-device switching, FTP scoping, or explicitly requires the second host.
- Record exact APK path, app version, Pixel serial, host, command output, and log excerpts.

LOGGING AND DIAGNOSTICS RULES

Do not hide errors to make logs clean.

Clean production logs mean:
- No avoidable fatal errors.
- No unclassified Capacitor errors.
- No silent catches.
- No default debug/perf console spam.
- No duplicate canonical errors for one failure.
- No test-only startup probes in production mode.
- Expected cancellation, first-run absence, and user-aborted operations are classified and low-noise.

Do not use console.* in production app code unless repository policy explicitly permits it and the use is covered by a guardrail allowlist.

REPOSITORY SAFETY RULES

- Do not use broad git reset, git checkout ., git clean, or destructive cleanup.
- Revert only specific files after inspecting them.
- Keep changes narrow and motivated by the original findings.
- Avoid vanity refactors.
- Avoid changing unrelated formatting, lockfiles, generated files, or package metadata.
- Do not weaken assertions, skip tests, or reduce coverage to pass validation.
- Do not suppress diagnostics instead of fixing root causes.
- If a test is wrong, fix it while preserving or strengthening the behavior it was intended to protect.

TERMINATION CRITERIA

Continue autonomously until all of the following are true:

1. PLANS.md lists PH1 through PH15 plus Phase 0, each marked DONE or DEFERRED with evidence.
2. Every code fix has a regression test that would fail on the prior behavior.
3. Every performance/noise fix has a nearby no-regression assertion for the feature it could have weakened.
4. PH5 scan shows no unlogged silent production catches.
5. Production source has no unapproved console.* calls.
6. PH8 snapshot persistence cannot skip commits for metadata-only changes.
7. PH9 and PH10 prove cross-device FTP and queued scheduler work cannot leak stale device state.
8. npm run test:coverage passes with at least 91 percent global branch coverage.
9. Android JVM tests pass if Android code changed.
10. git diff --check passes.
11. Latest APK is built, installed on Pixel 4, launched, and exercised.
12. Evidence files exist under docs/research/stabilization/prod-hardening-1-evidence/.
13. Final summary lists:
    - Changed files
    - Reverted unrelated files
    - Tests and commands run
    - Coverage result
    - APK path
    - Pixel serial
    - Ultimate host or hosts used
    - Evidence files
    - Findings completed
    - Findings deferred and why
    - Residual risk

FINAL RESPONSE FORMAT

When finished, provide a concise engineering summary with:

1. What changed.
2. What was deliberately reverted or left untouched.
3. Findings completed.
4. Tests and validation run.
5. Pixel 4 and Ultimate evidence captured.
6. Remaining risks or deferred items.

Do not include broad implementation commentary. Do not claim completion of device proof unless the evidence file exists and the command actually ran.
