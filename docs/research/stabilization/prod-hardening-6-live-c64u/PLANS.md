# Prod Hardening 6 Live C64U Plan

Task classification: **DOC_PLUS_CODE** unless live and static evidence conclusively shows no executable defect.

## Impact Map

- Documentation/evidence: `docs/research/stabilization/prod-hardening-6-live-c64u/`
- Source under review: REST, FTP, Telnet, config writes, saved-device switching, lifecycle, diagnostics, persistence, Android native bridges
- Runtime targets: Pixel 4 over ADB, primary live target `c64u`
- Screenshots: only if visible UI defects are found; no bulk screenshot refresh

## Execution Checklist

- [x] Read repository instructions and project docs.
- [x] Read prior prod-hardening-5 evidence.
- [x] Establish baseline worktree, ADB device, package name, and `c64u` health.
- [ ] Set up logcat and screenshot evidence paths.
- [ ] Build and deploy current app to Pixel 4 for baseline live review.
- [ ] Run minimum live scenario matrix against `c64u` if reachable.
- [x] Perform static request-safety audit of REST, FTP, Telnet, config writes, saved-device switching, lifecycle, diagnostics, and persistence.
- [x] Record every observed issue in `issue-ledger.md`.
- [x] Implement fixes for confirmed P0/P1/P2 defects.
- [x] Add deterministic regression tests for each code fix.
- [ ] Rebuild, redeploy, and repeat relevant live scenarios after fixes.
- [ ] Run final validation: `npm run test`, `npm run lint`, `npm run build`, `npm run cap:build`, `npm run android:apk`, `npm run test:coverage`.
- [ ] Install final APK on Pixel 4, launch, and execute final live scenario matrix.
- [ ] Complete `request-safety-audit.md`, `android-live-results.md`, and `pr-desc.md`.
- [ ] Record final `git status --short`.

## Safety Rules For This Pass

- Use `c64u` only as the primary validation target.
- Use conservative single probes before and after scenarios.
- Stop app-driven traffic immediately if `c64u` shows timeout, reset, or listener-surface failure.
- Do not perform destructive actions: power off, power cycle, clear-memory reboot, flash reset/load, RAM restore, REU restore.
- Do not bypass production gateways for app traffic.

## Current Blockers

- `c64u` REST baseline is unhealthy before app launch: `curl: (56) Recv failure: Connection reset by peer`, while ICMP, FTP TCP, and Telnet TCP are reachable. REST-dependent app validation cannot be claimed until this recovers.

## Continuation After Credit Exhaustion — 2026-05-28T14:39:10+01:00

Resuming after prior LLM ran out of credits. User restarted `c64u`. Fresh post-restart baseline confirmed REST healthy. Continuing from this point.

### Continuation State
- Prior LLM completed: PH6-01 (config write throttle generation), PH6-02 (FTP bridge retry ownership), PH6-03 (lazy Telnet capability discovery) — all static fixes with targeted tests.
- Prior LLM blocked at: final Pixel 4 + c64u live validation — REST was `curl: (56)` before app launch.
- User action: restarted `c64u`.
- Post-restart baseline: REST healthy (`REST_EXIT:0`, product `C64 Ultimate`, firmware `1.1.0`).

### Updated Execution Checklist

- [x] Read and reconcile existing PH6 evidence.
- [x] Append continuation section to PLANS.md and WORKLOG.md.
- [x] Classify full current worktree.
- [x] Re-probe c64u after user restart — REST healthy.
- [ ] Run full test suite: `npm run test`.
- [ ] Run lint: `npm run lint`.
- [ ] Run build: `npm run build`.
- [ ] Run cap:build: `npm run cap:build`.
- [ ] Build APK: `npm run android:apk`.
- [ ] Run test:coverage: `npm run test:coverage`.
- [ ] Install final APK on Pixel 4.
- [ ] Execute final live validation matrix against c64u.
- [ ] Complete all evidence documents.
- [ ] Record final git status.

### Current Blockers

- None at time of continuation — c64u REST healthy, Pixel 4 available.

---

## CONTINUATION 3 — Documentation finalization (2026-05-28)

Resuming after prior session completed all 14 live scenarios. Remaining: documentation completion and commit.

### Tasks

- [x] android-live-results.md: baseline, APK info, full S1–S14 matrix — DONE
- [x] issue-ledger.md: PH6-03, INC-S3 external, INC-TURBO P3, INC-S3-UX P3, PH6-01/02 final status — DONE
- [x] request-safety-audit.md: complete with live evidence — DONE
- [x] pr-desc.md: full PR description — DONE
- [x] PLANS.md: this entry — DONE
- [x] Final npm run test:coverage — DONE (91.66% branches ≥91%)
- [x] Final git commit — PENDING

---

## CONTINUATION 4 — PH6-04 Root Cause, Fix, and Fixed-APK HIL Run (2026-05-28)

Resuming after repeated c64u outages during first live HIL run. Root cause identified and fixed.

### Tasks

- [x] Investigate c64u crash root cause — unconditional CRLF in `healthCheckEngine.ts` line 1046 — DONE
- [x] Reclassify INC-S3 from "external" to P0 app defect (PH6-04) — DONE
- [x] Implement PH6-04 fix: conditional CRLF on `authResult.passwordSent` — DONE
- [x] Add regression tests ("no CRLF without password", "CRLF only when passwordSent") — DONE
- [x] npm run test — 6678 tests pass — DONE
- [x] npm run lint — pass — DONE
- [x] npm run build — pass — DONE
- [x] npm run test:coverage — 91.65% branch ≥91% — DONE
- [x] npm run cap:build — pass — DONE
- [x] cd android && ./gradlew assembleDebug — c64commander-0.7.9-rc1-debug.apk — DONE
- [x] Install fixed APK on Pixel 4 9B081FFAZ001WX — DONE
- [x] Establish pre-HIL baseline for fixed APK run — REST_EXIT:0, FTP_TCP_EXIT:0, TELNET_TCP_EXIT:0 — DONE
- [x] Execute full S1–S14 HIL matrix with fixed APK — all 14 PASS, c64u healthy throughout — DONE
- [x] Save logcat files with -fixed suffix — all 14 saved — DONE
- [x] Update WORKLOG.md — P0 root cause + fixed-run S1-S14 matrix appended — DONE
- [x] Update issue-ledger.md — INC-S3 reclassified, PH6-04 entry added — DONE
- [x] Update android-live-results.md — fixed-run matrix appended — DONE
- [x] Update pr-desc.md — PH6-04 fix added, live validation updated — DONE
- [x] Update PLANS.md — this section — DONE
- [ ] Final git commit — PENDING

### Current Blockers

- None. All evidence complete. Commit pending.
