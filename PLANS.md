# PLANS.md — C64 Commander Final Bug-Free Proof (Pixel 4)

## Identity (verified this session 2026-06-26T06:30Z)

- Branch: `test/full-cta-coverage-2`
- Git SHA: `fe212a590b2c43af52958522441cd808722e2b8b` (HEAD; PR #295 merged — RAM snapshot restore fix + full CTA coverage tests)
- Working tree at session start: only `docs/testing/agentic-tests/full-cta-coverage/prompt4.md` untracked. Otherwise CLEAN.
- **Built + installed APK (this session): `0.9.0-rc1`, versionCode `2036`, SHA-256 `bc3b825622c74baa23aaee4547ae9f050ded01b33001423c5ee9b4630fbd9cc3`** — freshly built from HEAD. Replaces stale WIP `0.8.9-b8687` (vc 2047, a superseded off-history commit). Required `adb uninstall` first (downgrade vc 2036<2047).
- Signature short: `d39d81d2`. firstInstallTime/lastUpdateTime: `2026-06-26 07:29:37`.
- Variant: **FULL C64 Commander** (`uk.gleissner.c64commander`), NOT the stripped C64U Remote variant.
- Pixel 4: `9B081FFAZ001WX`, Android 16 / SDK 36, 1080x2280 @ 440dpi.
- C64 target `c64u` (192.168.1.167): ICMP up at session start (1.1ms). HTTP probe pending.
- `u64` (192.168.1.13): ICMP up (0.5ms). FALLBACK ONLY; never C64U pass evidence.

## Artifact root

`c64scope/artifacts/final-bugfree-20260626T062957Z-pixel4-c64u-fe212a59/`

## Gates passed so far

- `npm run scope:check`: 55 files / 361 tests PASS (exit 0).
- APK build from HEAD: exit 0 (`c64commander-0.9.0-rc1-debug.apk`).
- Install: `Success` (after uninstall of stale WIP).

## Key framing — S1 is a FIRMWARE defect

`S1-C64U-FIRMWARE-TCP-WEDGE-ON-IDLE-RECONNECT`: the c64u's embedded (lwIP) TCP stack
intermittently and permanently wedges on the first request after a multi-minute idle
(all TCP services dead, ICMP alive, recover only on power-cycle). This is a **device
firmware defect**, not an app bug. The earlier `http.keepAlive=false` "fix" was WRONG and
was REVERTED (confirmed: no keepAlive override in `android/app/src/main/`). The app can
only reduce trigger frequency (warm connection reuse + `restMaxConcurrency` semaphore,
firmware-aware device-safety profile). Per completion gate 13, this is "external and
unfixable in-app" — it does NOT count as an open app defect, provided the app degrades
gracefully (accurate degraded badge, no crash, no false OK, no stale optimistic UI).

## Active phase

**Phase F — fixes implemented + verified.** THREE app fixes landed this session (working tree,
uncommitted, on the cascade-cut build `0.9.0-rc1-fe212` SHA 56ec881f, installed + connected):

1. **Health-poll self-halt** (`src/hooks/useC64Connection.ts`): refetchInterval no longer returns
   a time-based `false` (which permanently tore down React Query's interval → badge stuck UNHEALTHY
   ~13 min); coalescing moved into queryFn. Verified: typecheck + JS tests green; on-device health
   polling continues (drives/info polls, badge HEALTHY) without navigation.
2. **Songlengths read no-timeout** (FtpClientPlugin.kt readFile streaming + `timeoutMs:0` + byte
   progress events + cancelRead; ftpClient.ts/.web.ts/native + addFileSelections 6 MiB cap + scan
   progress + abort): the 5.1 MiB read now runs to completion (durations resolved, e.g.
   12th_Sector=03:11). Verified: tsc + 140 JS tests + Kotlin FtpClientPluginTest green.
3. **FTP cascade cut** (FtpClientPlugin.kt resolveListing): do NOT cascade LIST→MLSD→NLST after a
   SocketTimeoutException (3→1 PASV cycles on a struggling firmware). Kotlin test
   `listDirectoryDoesNotCascadeToMlsdOrNlstOnTimeout` green.

**Key learning (2 power-cycles this session):** the c64u fw-1.1.0 wedge on SID-add is triggered by
the songlengths DISCOVERY's burst of FTP directory listings (amplified 3× by the fallback cascade),
NOT the read timeout. The cascade cut reduces churn; **c64u-no-wedge is NOT guaranteed on fw-1.1.0
(firmware-limited)** and was deliberately NOT re-tested on-device (avoid power-cycle #3). Real cure =
firmware (u64's 3.14x fixed this FTP class). See defects/S2-PLAY-SID-ADD-AUTO-SONGLENGTHS-FTP-WEDGE.md.

## Active route / overlay / flow

- Route: /docs (HEALTHY). Playlist holds 3 test SIDs (cleanup later). Drive A No-disk.
- Overlay: none
- Flow: awaiting fork (fix a v2), then rebuild + HIL verify both fixes

## Blocker list

- (soft) c64u firmware FTP/TCP-wedge risk — external. AVOID re-triggering (user: "don't make power-cycles a habit"). The fix-a goal is to never truncate/wedge the FTP again.

## Next action

See `docs/testing/agentic-tests/full-cta-coverage/handover9.md` for the exact continuation plan.
Top item: Disks mount/eject (S1, HTTP-safe mount, GENTLE FTP browse to select one disk). Then
locked-screen auto-advance, filtering, negative-path connect, lifecycle lock/rotate, variant checks.
**Critical rule:** never burst FTP listings on c64u (fw-1.1.0 wedges; 2 power-cycles this session).
3 fixes are in the working tree (uncommitted, unit-verified): health-poll, songlengths no-timeout,
FTP cascade cut. Reports: final-bugfree-report.md (NOT BUGFREE-PROVEN), cleanup-report-final.md.

## Execution plan (priority order)

1. **[DONE]** Setup: state files, artifact root, scope:check, build+install HEAD APK.
2. Baseline: launch, prove green C64U / device c64u / fw / Drive A ON No-disk; CDP forward; logcat.
3. S1-safe Disks baseline (Drive A ON / No disk mounted; Drive B captured) — only under S1 preconditions.
4. High-value flows: Play add/play/transport/auto-advance (incl. locked-screen); Disks import/mount/eject/swap/filter; playlist & disk filtering.
5. CDP console/network/exception sweep across all routes + overlays; keypad parity; touch parity.
6. Config / Settings / Diagnostics / Device Switcher / Docs/Licenses deep dives.
7. Lifecycle, performance, reliability reps, background playback.
8. Cleanup + restore all mutated state; final bug-free report + ledgers.

## Remaining counts (live estimate)

- Routes: 6 main + overlays (Diagnostics, Device Switcher, mount sheet, source chooser, native picker).
- CTA: ~290 prior discovery baseline; fresh per-route enumeration this run.
- High-value flows: 9 families (A–I in prompt).
- Negative paths / lifecycle / reliability: per prompt matrices.

## Exact next action

Launch `0.9.0-rc1` via DroidMind `android-app start`; capture baseline screenshot + hierarchy;
run direct c64u HTTP health probe (infra); if not green C64U, app-driven Save-and-Connect
host c64u / pwd / 80 / 21 / 23; set CDP forward for console/network observability.

---

## Archive — prior sessions (append-only history)

Per the repo convention (`docs/agentic/LESSONS.md`), root `PLANS.md` is repurposed
**append-only** across runs: the live working state stays at the top of this file and
superseded sessions are preserved below rather than overwritten. The active session's
state is the section above; earlier sessions follow newest-first.

### Session 2026-06-25 — Exhaustive Bug Hunt (Pixel 4)

- Branch: `test/full-cta-coverage`
- Git SHA: `b86877f43589954a9d415f0dfe8b2b7debb890b4` (HEAD)
- Working tree: CLEAN at session start.
- **Installed APK (this session): `0.8.9-b8687`, versionCode `2047`, SHA-256 `f052b0b1f6d1ddbc9ef0a9ff2627be3fba1a1a72cf38d77b1c992290e86dd593`** — freshly built from HEAD, replaces the stale `0.8.9-cf84d` that predated the S1/S2/C1/C2/C3 fixes.
- HEAD product-code delta vs cf84d (the bugs' fixes, now under test): `UnifiedHealthBadge.tsx`, `HomeDiskManager.tsx`, `c64api.ts`, `DriveManager.tsx`.
- Installed app: **FULL C64 Commander** (`uk.gleissner.c64commander`), NOT the stripped C64U Remote variant.
- Pixel 4: `9B081FFAZ001WX`, Android 16 / SDK 36, 1080x2280 @ 440dpi.
- C64 target `c64u` (192.168.1.167): **HTTP 200 in ~0.15s — web stack UP/HEALTHY**. The blocker that stopped handover5–8 (c64u down) is CLEARED. C64U-dependent flows are now EXECUTABLE.
- `u64` (192.168.1.13): FORBIDDEN for closure.
- UI: WebView app. DOM/console/network via **CDP** (`scripts/bughunt-cdp.mjs`). Product input via **DroidMind**. adb/curl = infra only.
- Artifact root: `c64scope/artifacts/bughunt-20260625T164637Z-pixel4-c64u-b86877f43589/`
- Gates: `npm run scope:check` 55 files / 361 tests PASS; APK build `BUILD SUCCESSFUL`; install `Success`.

**Active phase — COMPLETE (2026-06-25).** Session delivered the headline result: the months-long S1 catastrophic c64u wedge was reproduced, **root-caused (HttpURLConnection keep-alive reusing a stale idle socket), fixed (`http.keepAlive=false` in MainActivity), and verified on-device (A/B).** Plus a breadth bug hunt (6-route CDP error sweep, keypad parity, Config/Settings/Disks/Docs/Diagnostics/Switcher, lifecycle, perf) and cleanup. See `bug-hunt-report.md`, `cleanup-report-bughunt.md`, `defects/S1-ROOTCAUSE-*.md`, `defects/S4-*.md`. _(Note: the `http.keepAlive=false` change was later REVERTED — the wedge is a c64u firmware defect, not client connection reuse; see the live session above.)_

Gates: scope:check PASS, lint+tsc PASS, Kotlin MainActivityTest PASS, APK build OK. Working tree dirty with the fix (uncommitted; no commit requested). Device left clean/healthy.

Prior discovery baseline (515e2 run): 290 CTAs — Home 106, Play 24, Disks 40, Config 28, Settings 74, Docs 18.

## Ralph loop iteration #142 (2026-07-17, Claude/Opus)

- Branch `fix/hardening4`, HEAD `8fb53a71` "Improved manual", working tree CLEAN at startup.
- Source label `0.9.2-8fb53`. Installed APK `0.9.2-rc1-8d512` (commit `8d5127b9`, ancestor of HEAD).
  `git diff 8d5127b9..HEAD -- src/ android/app/src/` = EMPTY → no Android product-code delta;
  delta is docs/manuals, CI telemetry scripts, manual-build tooling, radix caret dep bumps only.
  **Installed APK is product-equivalent to HEAD for the Android app** → current-build claim valid
  without rebuild (recorded per PIXEL 4 BUILD identity rule).
- Peers: droidmind callable (product driver), c64scope callable, c64bridge callable, mobile-mcp callable.
- Hardware: **c64u HEALTHY** (192.168.1.167, `/v1/info` HTTP 200 in 0.009s). u64 up but slow (2.7s).
  c64u is primary target and available → exercise a c64u-safe interactive family.
- Capacity checkpoint: Ralph Robin claude usable (5h 64% left, weekly 66%) → >=40% band: min 8 / target 12-20 actions.
- Previous verdict (#141, stale digest branch): BUG-074 FIXED on u64; c64u follow-up pending.
- Selected probe family: **Config interactive-write family on c64u** (/config Audio Mixer:
  SOLO toggle [DISCOVERED, never exercised], slider drag + short-drag re-test [BUG DEFECT_OPEN],
  Refresh regression, a select/dropdown write with REST read-back, adversarial route-change-return).
  Advances DISCOVERED/DEFECT_OPEN ledger rows on now-healthy primary hardware.
- Stop criteria: exhaust visible SAFE_TO_EXERCISE Audio Mixer controls (each multi-rep), >=1 adversarial
  transition, mandatory logcat + Diagnostics-export sweep, restore mixer to 0 dB baseline, then hand off.
- Baseline for restore: docs/agentic/artifacts/iter142/audio-mixer-baseline.json (all Vol 0 dB / drives OFF).
- Primary TODO: exercise Audio Mixer SOLO + slider commit + one select write on c64u with REST read-back.

## Ralph loop iteration #143 (2026-07-17, Codex) — c64u recovery and constrained Audio Mixer SOLO probe

- Codex capacity is usable (weekly 65%); the >=40% action target applied. droidmind drove 14 meaningful product actions; mobile-mcp supplied read-only UI evidence.
- Identity: branch `fix/hardening4`, HEAD `8fb53a71`, source `0.9.2-8fb53`; installed `0.9.2-rc1-8d512` is product-equivalent (`git diff 8d5127b9..HEAD -- src android/app/src` empty).
- c64u (`192.168.1.167`, C64 Ultimate fw 1.2.0) is healthy after the pack. Final direct `/v1/info` was HTTP 200 with no errors; final Diagnostics export is Healthy/Online, problemCount 0.
- Found **BUG-075**: after a transient Pixel Wi-Fi roam, Settings retained a red host-unreachable error even after app HTTP success, Refresh, and health check established Connected/Healthy state.
- Audio Mixer SOLO enable/restore was completed. Each state made one successful four-field `POST /v1/configs`; restore returned all affected channels to `0 dB`, then broad category read-back GETs ran.
- Safety stop: do not widen Audio Mixer writes in this loop. The group POST/fan-out is disproportionate immediately after recovery; device state is restored. This does not claim a cure for the firmware TCP-wedge defect.
- Next: fix and regression-test BUG-075 in `SettingsPage`, build/deploy, and repeat the Pixel failure-to-recovery path.

## Ralph loop iteration #144 (2026-07-17, kilo) — BUG-075 narrow fix + HIL

- One coherent CTA family: Settings recovery state. kilo capacity is usable; the >=40% action target applied. Three product actions met the band (intentionally narrow: bogus-host Save, Refresh, restore-Save). droidmind supplied the UI evidence; mobile-mcp and c64scope were not required.
- Identity: branch `fix/hardening4`, HEAD `8fb53a71`, source `0.9.2-8fb53`. Rebuilt debug APK `android/app/build/outputs/apk/debug/c64commander-0.9.2-8fb53-debug.apk` and installed on Pixel 4 `9B081FFAZ001WX`; `get_app_info` confirms version `0.9.2-8fb53` matches HEAD source. No identity drift.
- c64u (`192.168.1.167`, C64 Ultimate fw 1.2.0) stayed reachable throughout; direct `/v1/info` HTTP 200 before and after the pack.
- Fix in `src/pages/SettingsPage.tsx`: `handleSaveConnection` clears `hostnameError` after a confirmed successful `switchSavedDevice` (line 737). `handleRefreshConnection` clears both `hostnameError` and `reachabilitySuggestion` after `discoverConnection("manual")` resolves (line 822-823). Clear is gated on **confirmed reachability**, not on draft edits, so the stale state only goes away when the device is verifiably reachable again.
- Regression test `clears a previously-set unreachable-host error once manual refresh recovers the device (BUG-075)` in `tests/unit/pages/SettingsPage.test.tsx` fails before the Refresh-path fix and passes after it. Full SettingsPage suite 92/92; full Vitest suite 8648/8648 across 707 files (~224s). `npm run lint` clean. `tsc --noEmit` clean.
- Pixel HIL on the same device: bogus `192.168.1.250` host → Save & Connect produced the inline `couldn’t reach` error (screenshot `iter144/screenshots/01-bug075-error-shown.png`). Refresh (no field edit) cleared the error while "Connected to http://192.168.1.167" header stayed healthy (`02-bug075-error-cleared-after-refresh.png`). Restored correct host and Save & Connect — error stayed cleared (`03-bug075-save-success.png`). `adb logcat -d -t 200` clean of app-level `FATAL`/`ANR`/`StrictMode`/`crash`/`exception`.
- Docs updated: `docs/agentic/BUGS_FOUND.md` (BUG-075 status → FIXED + current-build Pixel-HIL validated #144), `docs/agentic/STATE_DIGEST.md` (#144 entry), `docs/agentic/CTA_LEDGER.md` (BUG-075 row → EXERCISED_CLEAN_FIXED).
- Verdict: **FIXED + current-build Pixel-HIL validated** for BUG-075. Next: resume remaining Audio Mixer controls in a separate fresh pack; do not propose another BUG-075 pass.
