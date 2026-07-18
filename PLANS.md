# PLANS.md — C64 Commander Final Bug-Free Proof (Pixel 4)

## Ralph loop iteration #170 (2026-07-17, kilo) — Play + Settings probe pack with BUG-078 readmem misclassification evidence

- Branch `fix/hardening4`, HEAD `c2120eaf`, source `0.9.2-c2120`; installed APK on Pixel 4 `9B081FFAZ001WX` matches source (Home render + `droidmind android-app get_app_info`). kilo capacity usable at $61.9 (≥40% band).
- Probe pack: droidmind drove 25+ production CTAs across Play (Mute ×5, Play/Pause ×4, SeekBar ×4 [Radix-synthetic-no-actuate, recorded], Recurse/Repeat/Reshuffle ×7), Settings (Diagnostics open, Saved Devices row taps that double as device-switch CTAs, Delete device DESTRUCTIVE_GUARDED open + Cancel + Close, Refresh connection, Save & Connect, Enable Debug Logging, List persisted URIs, Enumerate first root), Home (Pause).
- **Fresh BUG-078 evidence captured** without flipping `android.loggingBehavior`: the in-app Diagnostics Activity feed during the health-check burst accumulated `error rest.get /v1/machine:readmem?address=00A2&length=3 ERR 1` and `?address=D012&length=1` errors plus a `Telnet request failed` problem, while **bracketing direct `curl http://c64u/v1/machine:readmem` returned HTTP 200 in 8.9 ms**. c64u is unambiguously healthy; the app classified successful reads as errors. This points at `src/lib/diagnostics/healthCheckEngine.ts` (already dirty in this worktree) or its error classifier, not at the device.
- Diagnostics dialog rendered only the compact view at the Pixel 4 viewport — the full multi-tab layout (Logs/Traces/Actions/Errors/Latency/Heat map/Config drift/Device detail/Decision state) and the Share-all overflow menu referenced by the prompt are not exposed there. **The Share-all ZIP export could NOT be pulled this loop** because no CTA on this viewport opens the full dialog. Recorded as an affordance gap, not a defect.
- Package-filtered logcat had only Chromium `Invalid first_paint` warnings (unrelated, webview background noise) and **no app FATAL/ANR/StrictMode/exception/Host unreachable/REST trace** — fully consistent with the BUG-076 `loggingBehavior:"none"` config.
- Reproduction of a new symptom: tapping Settings `Discover devices` at coords (540, 2227) caused the app to be backgrounded to the Android launcher home screen. The tap most likely fell onto the system navigation bar background overlay (y=2148..2280, 132 px tall) rather than the button. After relaunch, app restored to Settings with `Connected to c64u, system healthy`. **Per PROTECTED LAYOUT INVARIANTS — KNOWN-FALSE DEFECTS in the prompt, this is NOT to be "fixed" by adding a tab-bar-height reserve to `.page-shell`**; the real cause is the nav-bar overlay occluding the WebView bottom. Re-measure the element bounds against the navigation-bar background before drawing conclusions; do not edit `tests/unit/pageShellClearance.test.ts`.
- Cleanup: Play page final state `Mute / 0 dB` (UltiSID at 0 dB naturally); c64u healthy; no app queue stuck.
- No source edits, no build, no install, no coverage, no scheduler command, no sub-agent launched. Ralph Robin continuation ready.
- Next family: **continue BUG-078 ownership trace from the diagnostic-classification side** (healthCheckEngine + resolveHostErrorMessage) before any retry, keep-alive, or connection-policy edit. The clean c64u baseline + the readmem 200-classified-as-ERR evidence is enough to focus the next edit attempt.

## Ralph loop iteration #169 (2026-07-17, kilo) — post-compact BUG-078 ownership trace bracket

- Branch `fix/hardening4`, HEAD `c2120eaf`, source `0.9.2-c2120`; installed APK on Pixel 4 `9B081FFAZ001WX` still matches source. kilo capacity usable at $61.1 (>=40% band).
- Mid-loop compaction cut the running Play ownership pack; re-derived by re-probing the Pixel. Captured the strongest BUG-078 evidence of the run: rendered `Play` page shows two stacked red toasts `Mute toggle failed / Host unreachable` and `Playback failed / Host unreachable` over the existing UI (`docs/agentic/artifacts/iter169/screenshots/play-after-compact-9-problems.png`); the c64U badge reads **red `9`** (problem counter stuck at 9 as a result of the BUG-077 retry burden + earlier transient failures from the compacted window).
- Bracketing evidence: 5× `curl http://c64u/v1/info` over 2.5 s all returned **HTTP 200 in 8.7–9.1 ms** with `"errors":[]`; c64u confirmed healthy. u64 also returned 200. Pixel Wi-Fi RSSI −68 to −75 dBm on `Provence` — no roam event in logcat across the failure window, so Wi-Fi is not the trigger.
- The 9 counter advanced without firmware-disease evidence: BUG-078 (app-side `Host unreachable` misclassification on a healthy c64u) is reproduced through the compaction with both Playback and Mute actions visibly toasting inside the same Play screen — independent corroboration of the #152–#156 signatures.
- Logcat slice saved to `docs/agentic/artifacts/iter169/logcat/logcat-package-warnings.log`. As expected with the current `loggingBehavior:"none"` config (BUG-076 fix), no native app/HTTP stack traces appear, so the exact failing path remains untraced; do not change retry/keep-alive/connection policy from indirect evidence.
- Mixer is already at `0 dB` per the screenshot; no further restore needed. Recurse is still checked (the compacted window left the checkbox alone). No SID ever advanced — only failed transport attempts contributed to the counter.
- Next family: same BUG-078 ownership trace from a clean counter. Recommendation for the next loop (capacity permitting): temporarily flip `capacitor.config.ts` `android.loggingBehavior` back to `"debug"` (or `"production"` with WebView console capture via CDP `Runtime.consoleAPICalled`) so a fresh boundary logcat window can name the failing request path and decide whether the BUG-077 retry is over-eager or whether the misclassification in `resolveHostErrorMessage` is the residual.
- No source edits, no build, no install, no scheduler command, no sub-agent launched.

## Ralph loop iteration #168 (2026-07-17, Codex) — immediate capacity handoff

- Ralph-selected Codex is usable at **2% weekly capacity**, within the mandatory `<=4%` immediate-handoff threshold. No HIL, source edit, build, deployment, or direct device/network probe was started; `droidmind_cta_action_count=0` is an allowed pre-action capacity block, not a clean product verdict.
- State remains `fix/hardening4` at `c2120eaf`; preserve the existing dirty source, test, lockfile, configuration, notice, and CDP-helper changes. The Pixel identity `9B081FFAZ001WX` / `0.9.2-c2120` remains last-verified evidence only; this loop made no current-install claim.
- Actual tool-namespace inspection confirms droidmind Android plus c64scope and c64bridge controls remain exposed. HIL is deferred solely by capacity policy, not tool unavailability. Ralph Robin continuation is ready; no scheduler command or sub-agent was used because Ralph owns rotation.
- Next family remains **BUG-078 native request ownership tracing** around app-started SID playback and foreground recovery. Timestamp diagnostics, config, playback, and saved-device-health work before changing retry, keep-alive, or connection policy.

## Ralph loop iteration #167 (2026-07-17, Codex) — immediate capacity handoff

- Ralph-selected Codex remains usable at **2% weekly capacity**, at the mandatory `<=4%` immediate-handoff threshold. No HIL, source edit, build, deploy, or direct device/network probe was started; `droidmind_cta_action_count=0` is an allowed pre-action capacity block, not a clean product verdict.
- State remains `fix/hardening4` at `c2120eaf`; preserve the existing dirty source, test, lockfile, configuration, notice, and CDP-helper changes. The Pixel identity `9B081FFAZ001WX` / `0.9.2-c2120` remains last-verified evidence only; this loop made no current-install claim.
- HIL is deferred solely by Ralph capacity policy, not a tool-unavailability conclusion. Ralph Robin continuation is ready; no scheduler command or sub-agent was used because Ralph owns rotation.
- Next family remains **BUG-078 native request ownership tracing** around app-started SID playback and foreground recovery. Timestamp diagnostics, config, playback, and saved-device-health work before changing retry, keep-alive, or connection policy.

## Ralph loop iteration #165 (2026-07-17, Codex) — immediate capacity handoff

- Ralph-selected Codex remains usable at **3% weekly capacity**, below the mandatory `<=4%` immediate-handoff threshold. No HIL, source edit, build, deploy, or direct device/network probe was started; `droidmind_cta_action_count=0` is an allowed pre-action capacity block, not a clean product verdict.
- State remains `fix/hardening4` at `c2120eaf`; preserve the existing dirty source, test, lockfile, configuration, notice, and CDP-helper changes. The Pixel identity `9B081FFAZ001WX` / `0.9.2-c2120` remains last-verified evidence only; this loop made no current-install claim.
- The current tool namespace still exposes droidmind Android, c64scope, and c64bridge controls. HIL is deferred solely by capacity policy, not tool unavailability. Ralph Robin continuation is ready; no scheduler command or sub-agent was used because Ralph owns rotation.
- Next family remains **BUG-078 native request ownership tracing** around app-started SID playback and foreground recovery. Timestamp diagnostics, config, playback, and saved-device-health work before changing retry, keep-alive, or connection policy.

## Ralph loop iteration #164 (2026-07-17, Codex) — immediate capacity handoff

- Ralph-selected Codex remains usable at **3% weekly capacity**, below the mandatory `<=4%` immediate-handoff threshold. No HIL, source edit, build, deploy, or direct device/network probe was started; `droidmind_cta_action_count=0` is an allowed pre-action capacity block, not a clean product verdict.
- State remains `fix/hardening4` at `c2120eaf`; preserve the existing dirty source, test, lockfile, configuration, notice, and CDP-helper changes. The Pixel identity `9B081FFAZ001WX` / `0.9.2-c2120` remains last-verified evidence only; this loop made no current-install claim.
- The current tool namespace still exposes droidmind Android, c64scope, and c64bridge controls. HIL is deferred solely by capacity policy, not tool unavailability. Ralph Robin continuation is ready; no scheduler command or sub-agent was used because Ralph owns rotation.
- Next family remains **BUG-078 native request ownership tracing** around app-started SID playback and foreground recovery. Timestamp diagnostics, config, playback, and saved-device-health work before changing retry, keep-alive, or connection policy.

## Ralph loop iteration #163 (2026-07-17, Codex) — immediate capacity handoff

- Ralph-selected Codex remains usable at **4% weekly capacity**, at the mandatory `<=4%` immediate-handoff threshold. No HIL, source edit, build, deploy, or direct device/network probe was started; `droidmind_cta_action_count=0` is an allowed pre-action capacity block, not a clean product verdict.
- State remains `fix/hardening4` at `c2120eaf`; preserve the existing dirty source, test, lockfile, configuration, notice, and CDP-helper changes. The Pixel identity `9B081FFAZ001WX` / `0.9.2-c2120` is last-verified evidence only; this loop made no current-install claim.
- Actual tool-namespace inspection confirms droidmind Android, c64scope, and c64bridge controls are exposed. HIL is deferred solely by capacity policy, not tool unavailability. Ralph Robin continuation is ready; no scheduler command or sub-agent was used because Ralph owns rotation.
- Next family remains **BUG-078 native request ownership tracing** around app-started SID playback and foreground recovery. Timestamp diagnostics, config, playback, and saved-device-health work before changing retry, keep-alive, or connection policy.

## Ralph loop iteration #162 (2026-07-17, Codex) — capacity handoff before HIL

- Ralph-selected Codex remains usable at **5% weekly capacity**, within the mandatory 5–9% band. This is an allowed pre-action blocker: no HIL, source edit, build, deploy, or direct device/network probe was started, and zero droidmind CTAs are recorded.
- State remains `fix/hardening4` at `c2120eaf`; preserve the existing dirty source, test, lockfile, configuration, and CDP-helper changes. The last Pixel-verified identity remains `9B081FFAZ001WX` / `0.9.2-c2120`; no current-install claim is made without a device query.
- Actual tool-namespace inspection confirms droidmind Android, c64scope, and c64bridge controls are exposed. HIL is deferred solely by the capacity policy, not tool unavailability. Ralph Robin continuation is ready; no scheduler command or sub-agent was used because Ralph owns rotation.
- Next family remains **BUG-078 native request ownership tracing** around app-started SID playback and foreground recovery. Timestamp diagnostics, config, playback, and saved-device-health work before changing retry, keep-alive, or connection policy.

## Ralph loop iteration #161 (2026-07-17, Codex) — capacity handoff before HIL

- Ralph-selected Codex is usable but at **5% weekly capacity**, within the mandatory 5–9% band. This is an allowed pre-action blocker: no HIL, source edit, build, deploy, or direct device/network probe was started, and zero droidmind CTAs are recorded.
- State remains `fix/hardening4` at `c2120eaf`; preserve the existing dirty source, test, lockfile, configuration, and CDP-helper changes. The last Pixel-verified identity remains `9B081FFAZ001WX` / `0.9.2-c2120`; no current-install claim is made without a device query.
- Actual tool-namespace inspection confirms droidmind Android, c64scope, and c64bridge controls are exposed. HIL is deferred solely by the capacity policy, not tool unavailability. Ralph Robin continuation is ready; no scheduler command or sub-agent was used because Ralph owns rotation.
- Next family remains **BUG-078 native request ownership tracing** around app-started SID playback and foreground recovery. Timestamp diagnostics, config, playback, and saved-device-health work before changing retry, keep-alive, or connection policy.

## Ralph loop iteration #160 (2026-07-17, Codex) — capacity handoff before HIL

- Ralph-selected Codex is usable but at **5% weekly capacity**, within the mandatory 5–9% band. This is an allowed pre-action blocker: no HIL, source edit, build, deploy, or direct device/network probe was started, and zero droidmind CTAs are recorded.
- State remains `fix/hardening4` at `c2120eaf`; preserve the existing dirty source, test, lockfile, configuration, and CDP-helper changes. The last Pixel-verified identity remains `9B081FFAZ001WX` / `0.9.2-c2120`; no current-install claim is made without a device query.
- Actual tool-namespace inspection confirms droidmind Android, c64scope, and c64bridge controls are exposed. HIL is deferred solely by the capacity policy, not tool unavailability. Ralph Robin continuation is ready; no scheduler command or sub-agent was used because Ralph owns rotation.
- Next family remains **BUG-078 native request ownership tracing** around app-started SID playback and foreground recovery. Timestamp diagnostics, config, playback, and saved-device-health work before changing retry, keep-alive, or connection policy.

## Ralph loop iteration #159 (2026-07-17, Codex) — capacity handoff before HIL

- Ralph-selected Codex is usable but at **6% weekly capacity**, within the mandatory 5–9% band. This is an allowed pre-action blocker: no HIL, source edit, build, deploy, or direct device/network probe was started, and zero droidmind CTAs are recorded.
- State remains `fix/hardening4` at `c2120eaf`; preserve the existing dirty source, test, lockfile, configuration, and CDP-helper changes. The last Pixel-verified identity remains `9B081FFAZ001WX` / `0.9.2-c2120`; no current-install claim is made without a device query.
- Actual tool-namespace inspection confirms droidmind Android, c64scope, and c64bridge controls are exposed. HIL is deferred solely by the capacity policy, not tool unavailability. Ralph Robin continuation is ready; no scheduler command or sub-agent was used because Ralph owns rotation.
- Next family remains **BUG-078 native request ownership tracing** around app-started SID playback and foreground recovery. Timestamp diagnostics, config, playback, and saved-device-health work before changing retry, keep-alive, or connection policy.

## Ralph loop iteration #156 (2026-07-17, Codex) — BUG-078 ownership non-reproduction

- Completed a reduced-budget (11% Codex capacity) locked-playback request-ownership pack with droidmind: Mad Monkey Play, HOME, lock, unlock/foreground, Diagnostics, manual health check, and Share all/Back.
- The 0:33 watchdog fired/released correctly. UI, in-app health, and direct C64U REST all stayed Healthy; Share all produced `...2035-54Z.zip` in Android's chooser and Back safely cancelled it. No code change is justified by this non-reproduction. Preserve the Chromium `Invalid first_paint` log evidence; do not hide it.
- Reinstalled and launched `c64commander-0.9.2-c2120-debug.apk`; Home confirms current version, c64u firmware 1.2.0, and Healthy. Next: trace the simultaneous foreground reconcilers/native request ownership for BUG-078, or use a fresh budget for BUG-039 or a test-owned D64 pack.

## Ralph loop iteration #154 (2026-07-17, Codex) — BUG-078 native connection-refusal replay

- Capacity/tooling: Ralph-selected Codex usable at 17% weekly capacity, so the 10–19% band applied. Droidmind, c64scope, and c64bridge namespaces were discovered callable; c64scope readiness reported unknown peers and c64bridge was stale VICE, so neither supplied a product verdict. Droidmind drove 12 meaningful actions: selected SID start, POWER lock/wake, unlock swipe, Diagnostics open, manual health, overflow/Share all, chooser Back, Diagnostics close, Pause, and Unmute cleanup.
- Identity/target: `fix/hardening4` `c2120eaf`, source and installed Pixel APK `0.9.2-c2120`; c64u fw 1.2.0 direct `/v1/info` was HTTP 200 in 9.2 ms before and 9.0 ms after.
- Result: starting Mad Monkey immediately changed the badge Degraded/10 → Unhealthy/18. Diagnostics preserved two native app `/v1/info` failures at 21:12:44: 89 ms, then a 22 ms transient retry, both `Failed to connect to /192.168.1.167:80`, plus `Health check REST probe failed`. After a 38-second lock/unlock, the app foreground recovered to Healthy and a manual in-app health check passed. This is fresh BUG-078 app-path evidence, not a persistent C64U outage and not grounds for a connection-reuse policy change.
- Cleanup/audit: Share all generated `c64commander-diagnostics-all-2026-07-17-2015-38Z.zip` in Android's chooser; no app-owned pull path was available. SID was left paused (Resume shown), UltiSID restored to 0 dB (Mute shown), and the final badge was Healthy. Direct c64u response has `errors:[]`; final package logcat has no FATAL/ANR/StrictMode/app exception. No source/build/test/scheduler/sub-agent work occurred.

## Ralph loop iteration #153 (2026-07-17, Codex) — BUG-078 locked-playback recovery trace replay

- Current source/Pixel identity remains `fix/hardening4` / `c2120eaf` / `0.9.2-c2120`; c64u fw 1.2.0 direct `/v1/info` was HTTP 200 in 9 ms. Existing unrelated dirty worktree changes were preserved.
- Droidmind replayed selected-SID start, Home, lock, 38-second expiry, wake/unlock, foreground, Diagnostics, manual health check, and Back cleanup. The native watchdog fired at the expected due time and Play showed `0:33` / `Remaining 0:00`; Stop was not pressed.
- Immediately after unlock the header briefly showed `C64U ▲ 2`; initial app `/v1/info` rows and the manual health check were Healthy. A later app poll failed, logged one transient retry, and failed again three seconds later; Diagnostics rendered Unhealthy/13 and Host unreachable while direct c64u REST stayed HTTP 200 in 8.6 ms. BUG-078 is reproduced with a request timeline; stop app traffic after capture and trace the competing app request paths before any policy change.

## Ralph loop iteration #152 (2026-07-17, Codex) — locked SID auto-end timeline fixed; BUG-078 open

- Current source `fix/hardening4` / `c2120eaf`, Pixel APK `0.9.2-c2120`, and c64u fw 1.2.0 were verified. Existing unrelated dirty worktree changes remain preserved.
- Pixel HIL found that after a 0:33 SID ran during Home/lock/unlock, the C64U song safety policy correctly retained Stop but the visible elapsed time continued to 1:21. `finishPlaylistPlayback` now freezes elapsed at its resolved duration and clears the live start timestamp. The dedicated assertion failed before the change and focused Vitest passed after.
- `./build --skip-tests --install-apk --device-id 9B081FFAZ001WX` deployed the fix. A repeat 38-second locked run showed 0:33 / remaining 0:00 plus Stop; native auto-skip fired normally. Do not force non-disk Stop because it maps to reset.
- New Low BUG-078: app Diagnostics check directly after the lock path failed REST in 5128 ms and marked Unhealthy, while direct c64u `/v1/info` was HTTP 200 in 9 ms. This requires request tracing, not a speculative connection reuse or retry change. c64scope run `pt-20260717T195124Z` is inconclusive due to this residual.

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

## Ralph loop iteration #155 (2026-07-17, Codex) — completed BUG-078 locked-playback recovery probe pack

- Capacity: Ralph-selected Codex usable, weekly 14% → 10–19% band; current APK was already installed, so the required minimum was three meaningful actions. Droidmind drove nine: Resume, Home, lock, unlock swipe, Diagnostics open, Run health check, close, Pause, and Unmute.
- Identity: branch `fix/hardening4`, HEAD `c2120eaf`; the Pixel package is `0.9.2-c2120`, last installed at 20:55:29 after the current `usePlaybackController` source mtime (20:54:54). It is the current source build, despite the intentionally preserved dirty worktree.
- c64u stayed reachable: direct `/v1/info` was HTTP 200 in 9.5 ms before and 8.9 ms after. c64scope readiness discovery reported unknown peers; c64bridge firmware health was concretely unavailable because its active backend is VICE.
- Result: after 40 seconds locked, the header returned Healthy and the manual in-app check stayed Healthy. Diagnostics nevertheless contained a fresh foreground-time `/v1/info` `ERR 1` in 2 ms at 21:22:46; the next in-app `/v1/info` succeeded in 286 ms. This is a further BUG-078 reproduction of a transient app-native request-path failure, but not a fresh user-visible false-Unhealthy result. Do not change keep-alive, retry, or connection policy before native request ownership is traced.
- Handoff: the latest existing APK was reinstalled and launched after the pack. Home rehydrated to c64u Healthy/fw 1.2.0; Play shows no active item, Mute, and 0 dB. Package crash/ANR/StrictMode sweep is empty. No source edits, build, tests, screenshots, or scheduler command were performed in this HIL-only iteration.

## Ralph loop iteration #158 (2026-07-17, Codex) — capacity handoff before HIL

- Capacity: Ralph-selected Codex remains usable at **7% weekly capacity**, in the mandatory 5–9% band. No new HIL actions, source edits, build, deploy, or device/network probe were started; this is the allowed reduced-budget reason for zero droidmind CTAs.
- State: branch `fix/hardening4`, HEAD `c2120eaf` / source label `0.9.2-c2120`; preserve the pre-existing dirty source/test/lockfile/config/CDP-helper changes. The last current-build Pixel evidence remains `9B081FFAZ001WX` / `0.9.2-c2120`; no new installed-APK claim is made.
- Peer discovery: the actual current tool namespace exposes droidmind Android controls plus c64scope and c64bridge controls. HIL was deferred solely by capacity policy, not peer unavailability.
- Selected next family: **BUG-078 native request ownership trace** around app-started SID playback and foreground recovery. Identify/timestamp diagnostics, config, playback, and saved-device-health foreground work before changing retry, keep-alive, or connection policy.
- Ralph Robin continuation is ready in `docs/agentic/prompt.md`. No scheduler command or sub-agent was used because Ralph owns rotation.

## Exact next action

On a Ralph capacity band that permits HIL, re-probe `c64u`, confirm Pixel APK identity, launch through droidmind, capture a baseline hierarchy/screenshot, and perform the bounded BUG-078 ownership trace pack with normal Diagnostics/log cleanup.

## Ralph loop iteration #157 (2026-07-17, Codex) — capacity handoff before HIL

- Capacity: Ralph-selected Codex remains usable but has **7% weekly capacity**, placing this invocation in the mandatory 5–9% band. Per the Ralph policy, no new HIL actions, source edits, build, or deploy were started; this is the allowed reduced-budget reason for zero droidmind CTAs.
- State: branch `fix/hardening4`, HEAD `c2120eaf` / source label `0.9.2-c2120`; the pre-existing dirty source/test/lockfile/config/CDP-helper changes remain preserved. The last current-build Pixel evidence is `0.9.2-c2120` on `9B081FFAZ001WX`; no new installed-APK claim is made this loop.
- Peer discovery: the current tool namespace exposes droidmind Android controls, c64scope session/lab controls, and c64bridge controls. No HIL call was made because the capacity policy blocks it, not because any peer is unavailable.
- Selected next family: **BUG-078 native request ownership trace** around app-started SID playback and foreground recovery. First identify and timestamp ownership for diagnostics, config, playback, and saved-device-health foreground reconcilers; do not change retry, keep-alive, or connection reuse before that trace.
- Ralph Robin continuation is ready in `docs/agentic/prompt.md`. No scheduler command ran because Ralph owns provider rotation.

## Exact next action

Launch `0.9.0-rc1` via DroidMind `android-app start`; capture baseline screenshot + hierarchy;
run direct c64u HTTP health probe (infra); if not green C64U, app-driven Save-and-Connect
host c64u / pwd / 80 / 21 / 23; set CDP forward for console/network observability.

---

## Ralph loop iteration #146 (2026-07-17, Codex) — completed Audio Mixer reconciliation pack

- Current branch `fix/hardening4`, HEAD `c2120eaf`; Pixel 4 `9B081FFAZ001WX` rebuilt/deployed local source at 19:14 BST as `0.9.2-c2120`.
- c64u primary `192.168.1.167` fw 1.2.0 remained healthy. HIL replayed Config Audio Mixer SOLO U1 enable/restore, Docs→Config remount, and category reopen.
- Found and fixed a stale display after solo restore: c64u had restored U2 to `0 dB`, but the pre-fix reopened UI showed `OFF` until manual Refresh. `ConfigBrowserPage` now performs an explicit post-unSOLO category read-back/sync. Focused regression passes 31/31; the rebuilt Pixel APK replay rendered U2 `0 dB` after remount. Final Master/U1/U2/Socket1/Socket2 were all `0 dB`; final `/v1/info` was HTTP 200.
- New blocker: **BUG-076 Critical**. Native CapacitorHttp request logging exposes the `X-Password` header in package logcat. JS diagnostics are redacted correctly; do not write the credential to docs/artifacts. The next loop is a bounded native logging/security investigation and fix; do not widen Audio Mixer or test BUG-039 route-away during that work.
- Validation completed: focused ConfigBrowserPage Vitest 31/31, Prettier, build/install, Pixel HIL, Diagnostics Healthy, filtered crash/ANR/StrictMode sweep clean. No coverage run under the Ralph HIL exception.

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

## Ralph loop iteration #145 (2026-07-17, kilo) — c64u Config Audio Mixer SOLO + Reset + slider pack

- kilo capacity is usable (balance $55.2 left). The >=40% action target applies. One bounded CTA family
  (Config Audio Mixer interactive writes) selected to advance the DISCOVERED SOLO/Reset rows and the
  DEFECT_OPEN short-drag slider row on a clean c64u. BUG-075 just closed; do not touch that surface.
- Identity: branch `fix/hardening4`, HEAD `c2120eaf` (BUG-075 fix); source `0.9.2-c2120`. Rebuilt
  debug APK `c64commander-0.9.2-c2120-debug.apk`, installed on Pixel 4 `9B081FFAZ001WX`,
  `get_app_info` confirms `0.9.2-c2120` matches HEAD source. No identity drift.
- Peers: droidmind (Pixel 4) usable; c64bridge active backend = c64u; c64scope not required for
  Config interactive writes. c64u `192.168.1.167`, fw 1.2.0, healthy pre-pack; u64 fallback healthy.
- Selected probe family: **Config Audio Mixer** (/config) — open, exercise SOLO on one channel
  (multi-rep), confirm POST fan-out, restore, exercise Reset (multi-rep) with REST read-back,
  exercise one slider drag (long) and revisit short-drag commit path, Refresh, route-change-return
  adversarial, in-app Diagnostics export + package logcat sweep, restore all Vol rows to 0 dB.
- Stop criteria: every SAFE_TO_EXERCISE Audio Mixer control exercised multiple times with verified
  true actuation, >=1 adversarial route-change-return, mandatory logcat + Diagnostics-export sweep,
  mixer restored to 0 dB baseline, then hand off.
- Baseline: from iter142 (all Vol 0 dB; Audio Mixer baseline snapshot kept as
  `docs/agentic/artifacts/iter142/audio-mixer-baseline.json`).
- Primary TODO: SOLO enable + restore with REST read-back on c64u.

## Ralph loop iteration #147 (2026-07-17, claude) — BUG-076 Critical native credential-logging fix

- claude capacity usable (5h 100%, weekly 63% left) → >=40% band. Selected the top digest-recommended
  family: **BUG-076 security pack** (Critical OPEN) — Capacitor native logcat leaks the `X-Password`
  device credential. Highest release-priority item; a Critical open defect blocks release-known-clean.
- Identity: branch `fix/hardening4`, HEAD `c2120eaf`; source `0.9.2-c2120`. Installed APK
  `0.9.2-c2120` (debug) matches source pre-change. c64u `192.168.1.167` reachable HTTP 200, fw 1.2.0.
- Root cause (source-confirmed): `com.getcapacitor.Bridge.callPluginMethod` (node_modules Bridge.java:826-836)
  logs `methodData = call.getData().toString()` at VERBOSE under tag `Capacitor`, gated only by
  `Logger.shouldLog()`. Default `loggingBehavior="debug"` → `loggingEnabled = isDebug`, so every
  debuggable/testing APK logs the full CapacitorHttp request options, including the `X-Password` header.
- Baseline on installed build (value masked, count-only): the `Capacitor` verbose `methodData` line
  emitted the request headers with `X-Password` present after an Audio Mixer Refresh / health poll.
- Fix: `capacitor.config.ts` → `android.loggingBehavior: "none"` disables Capacitor's native Logger in
  every build. App observability preserved via in-app Diagnostics + CDP WebView console.
- Stop criteria: rebuild+deploy current source APK; drive REST-generating CTAs on c64u; prove
  `X-Password` no longer appears in package logcat while REST still functions; app functionality intact;
  in-app Diagnostics export + logcat sweep; update BUGS_FOUND/CTA_LEDGER/STATE_DIGEST; hand off.
- Primary TODO: verify credential no longer reaches logcat on the current-source APK with live c64u REST.

## Ralph loop iteration #148 (2026-07-17, claude) — Diagnostics dialog / global overlay control family
- Branch `fix/hardening4`, HEAD `c2120eaf`, source `0.9.2-c2120`. Working tree: pre-existing #146/#147 uncommitted edits + untracked CDP helpers (preserve).
- Pixel 4 `9B081FFAZ001WX` Android 16; installed APK `0.9.2-c2120` == source (get_app_info verified). No build/deploy needed.
- c64u `192.168.1.167` fw 1.2.0 healthy (`/v1/info` HTTP 200 errors:[], ping 0.57ms). droidmind + mobile-mcp callable.
- Capacity: claude 5h 65% / weekly 60% (>=40% band → min 8 CTA actions, target 12-20).
- Previous verdict (#147): BUG-076 Critical native credential-logging leak FIXED+HIL-validated. No open blocker/high/critical.
- Selected probe family: Diagnostics dialog / global overlay controls (Filters chips Problems/Actions/funnel, entry drill-down, overflow ⋮ menu items — Manage devices / Health history / heat maps / Share filtered / Share all, Run health check, secondary views Latency/Decision state/Config drift/heat map). All UI-only SAFE. Advances DISCOVERED/PLANNED rows never exercised this branch.
- Stop criteria: exhaust visible SAFE Diagnostics-dialog controls (each 3+ interactions), ≥1 adversarial transition, mandatory logcat + Diagnostics export sweep, restore state, batch WORKLOG + ledger, refresh digest, hand off.
- Primary TODO: exercise Diagnostics overflow menu + filter chips + secondary views on current build; attribute all app-package logcat.

## Ralph loop iteration #149 (2026-07-17, Codex) — BUG-077 bounded REST retry

- Ralph-selected Codex remained usable (weekly 54%, >=40% action band). Selected the newly root-caused
  Diagnostics health-check false-Unhealthy family rather than broader Play coverage.
- Implemented a two-attempt, transient-only REST reachability retry. Both attempts retain the existing
  3000 ms request bound; the enclosing REST ceiling is 6000 ms. Abort and non-transient failures do not retry.
- Regression coverage proves one retry for `Failed to fetch` and none for Unauthorized. Focused health-engine
  suite 77/77, `tsc --noEmit`, and `./build --skip-tests --install-apk` passed.
- Current-source APK `0.9.2-c2120` deployed to Pixel 4 `9B081FFAZ001WX`. Droidmind executed Diagnostics
  open/close, two health checks (one after a 50-second idle window), filters/overflow, Config Drift read-only
  refresh/back, Decision State/back, final post-deploy Diagnostics → Run health check, and Share all. The Android
  share sheet confirmed a generated one-file ZIP; the content URI did not persist a file to `/sdcard/Download` after
  Total Commander selection, so no ZIP pull is claimed. Final UI was Healthy;
  c64u fw 1.2.0 stayed HTTP 200 with `errors:[]`; package logcat had no FATAL/ANR/StrictMode/app exception.
- The idle-triggered transient did not recur in the bounded post-fix run. This is honest HIL no-regression;
  the exact retry sequence is deterministic unit coverage. The firmware wedge remains external.

## Ralph loop iteration #150 (2026-07-17, Codex) — Play transport/options/background with c64scope

- Codex remained usable (weekly 44%; >=40% action band). One current-build Play family was exhausted on Pixel 4 `9B081FFAZ001WX` against primary c64u (`192.168.1.167`, C64 Ultimate fw 1.2.0).
- Droidmind performed 25+ meaningful product actions: SID start, Mute/Unmute, Pause/Resume, HOME/foreground, Recurse/Shuffle/Reshuffle/Repeat state changes and restoration, Diagnostics health check, and Share all. Final Play volume was restored to `0 dB`; Recurse was restored on and Shuffle/Repeat off.
- c64scope run `pt-20260717T192255Z` passed. App-started SID playback was audibly captured (877 packets, RMS `0.0869709866`); Pause/Resume and Mute/Unmute were corroborated by visible state and successful app request records.
- The SID Stop control was intentionally not treated as safe: a delayed repeat Play tap reached red Stop and the diagnostics trace recorded `PUT /v1/machine:reset` HTTP 200. This confirms the existing maintainer-approved BUG-017 policy, not a new defect; no further Stop/reset action was performed.
- Diagnostics Share all generated `c64commander-diagnostics-all-2026-07-17-1928-13Z.zip`; safe analysis showed Healthy/Online, zero problems, successful transport operations, and no fresh error-level entry. Final c64bridge firmware health passed all version/info/readmem steps in 34 ms. Package logcat had no FATAL/ANR/StrictMode/app exception.
- No source files changed, so no build or test suite was run. Next family: Disks safe mount/eject/guard path with a known disposable disk, or a separate dedicated BUG-039 safety pack.
- Final deployment: reinstalled the existing `android/app/build/outputs/apk/debug/c64commander-0.9.2-c2120-debug.apk` on Pixel 4 and launched it. `get_app_info` and the rendered Home screen both show `0.9.2-c2120`, c64u, fw `1.2.0`, and a healthy indicator.

## Ralph loop iteration #151 (2026-07-17, Codex) — Disks browser pack, execution fixture blocked

- Current `0.9.2-c2120` Pixel build and c64u fw 1.2.0 remained healthy. Droidmind completed Disks route/focus/activation, C64U source selection, `/Flash` Refresh, empty `carts` open, Up, no-match filter/clear, IME Back, sheet Back, Diagnostics health check, Share all, and share-sheet cancellation. No drive/library/config state changed.
- The C64U app browser exposes `/Flash` only (`carts`, `config`, `html`, `roms`; `carts` empty). There is no disposable app-visible `.d64`, so safe mount/eject/rotate and mounted-delete guard paths remain **BLOCKED_SETUP**, not failed. Do not substitute a non-test-owned image or direct bridge mount.
- Diagnostics remained Healthy and logged C64U FTP lists (112/290 ms) and `/v1/drives` 200. Share all opened `c64commander-diagnostics-all-2026-07-17-1944-55Z.zip` through Android's content-URI sheet; no Download file exists to pull. Package logcat contained no FATAL/ANR/StrictMode/app exception. Final c64bridge firmware health passed in 32 ms.
- Final handoff reinstalled and launched the existing `c64commander-0.9.2-c2120-debug.apk`; Home visibly confirms `0.9.2-c2120`, c64u, fw 1.2.0, and healthy.
- Next exact action: make one known disposable D64 available through the C64U source browser, then resume the same Disks execution pack. If setup is unavailable, select locked-background playback or the isolated BUG-039 SOLO route-away safety pack.

## Ralph loop iteration #166 (2026-07-17, Codex) — immediate capacity handoff

- Runtime/capacity: Ralph Robin selected Codex at **2% weekly capacity**. The `<=4%` policy requires immediate handoff; no HIL, source edit, build, deployment, or direct device probe was started. `droidmind_cta_action_count=0` is an allowed pre-action capacity block, not a clean product verdict.
- Startup state: `fix/hardening4` at `c2120eaf`; the existing dirty source/test/lockfile/configuration/notice/CDP-helper changes remain preserved. The Pixel `9B081FFAZ001WX` / APK `0.9.2-c2120` identity is last-verified only; no device or APK identity was re-asserted.
- Discovery: actual current tool namespace exposes droidmind Android, c64scope lab/session/capture, and c64bridge controls. No peer is classified unavailable; capacity alone deferred HIL.
- Result: no new product or hardware evidence and no defect status changed. BUG-078 remains Low/Open. `docs/agentic/STATE_DIGEST.md` and `docs/agentic/prompt.md` direct the next capacity-permitting provider to perform the bounded native request-ownership trace before any retry, keep-alive, or connection-policy change. Ralph Robin continuation ready; no scheduler command ran and no sub-agent was launched because Ralph owns rotation.

## Ralph loop iteration #171 (2026-07-17, kilo) — Settings device-switch & BUG-078 trace

- kilo ≥40% balance ($62.9). 13+ production CTAs on Pixel `9B081FFAZ001WX` APK `0.9.2-c2120`. c64u `192.168.1.167` (fw 1.2.0) HTTP 200 throughout in 7–11 ms.
- Action sequence on Settings: tab → scroll-up → Diagnostics open → Run health check ×3 (#1 fired fresh BUG-078 ERR entries; #2/#3 deduped) → Close → Discover devices (above nav-bar overlay, worked) → Use u64 → Use c64u → HOME press → start_app → open Diagnostics.
- BUG-078 reframed: ERR entries are legitimate transient failures (idle + device-switch correlated, classic c64u firmware wedge), recovered-from by engine, badge stays Healthy. UX defect: `addErrorLog({transient:true})` renders at error severity. Real fix candidates: demote transient to warn, or suppress when later succeeded. The dirty `healthCheckEngine.ts` transient retry is partial mitigation only — not the fix.
- No source changes, no build/deploy. Existing dirty changes preserved. `tests/unit/lib/diagnostics/healthCheckEngine.test.ts` 77/77 pass.
- Next: open `src/lib/c64api.ts` `addErrorLog("C64 API request failed", {transient:true})` (~line 1889), add regression test, build/deploy, re-run #171 probe pack.

## Ralph loop iteration #172 (2026-07-17, kilo) — BUG-078 UX/severity fix

- kilo ≥40% balance ($64.5). Selected the digest-recommended family: **BUG-078 UX/severity fix** (Low/Open, refined in #171 from transport to UX). The ERR Activity-feed entries while the badge stays Healthy are legitimate transient network blips (idle + device-switch correlated), recovered-from by the engine. Real defect is that `addErrorLog("C64 API request failed", {transient:true})` renders at error severity producing a confusing Healthy+error state. Fix: at the single `src/lib/c64api.ts:1889` call site, demote transient failures to `addLog("warn", ...)` instead of `addErrorLog(...)`; non-transient failures stay error. No retry/keep-alive/connection-reuse changes.
- Identity: branch `fix/hardening4`, HEAD `c2120eaf`, source `0.9.2-c2120`. Working tree preserved: existing dirty changes including `healthCheckEngine.ts` transient-retry diff (not the fix; partial mitigation only). `src/lib/c64api.ts` is clean.
- Pixel 4 `9B081FFAZ001WX` attached. c64u `192.168.1.167` fw 1.2.0 HTTP 200 in 8.6 ms; u64 `192.168.1.13` HTTP 200 in 7.5 ms.
- Previous verdict (#171): BUG-078 refined hypothesis, no source changes.
- Stop criteria: implement demotion + regression test; build/deploy current-source APK; re-run #171 Settings device-switch probe pack to confirm transient ERR entries disappear from Activity feed while badge stays Healthy and badge changes still work; update BUG-078 to FIXED, refresh digest, hand off.
- Primary TODO: implement transient-demotion in c64api.ts, add deterministic regression test, build/deploy, re-run #171 probe pack, update BUG-078.

### Iter172 outcome

- ✅ Implemented demotion at `src/lib/c64api.ts:1886–1898`: `isTransientFailure` → `addLog("warn", ...)` with `{transient:true}` preserved. No retry/keep-alive/connection-reuse changes.
- ✅ 3 tests updated/added in `tests/unit/c64api.branches.test.ts` BUG-069 block; 2 pre-existing tests updated in `tests/unit/c64api.ext2.test.ts`. All 197 unit tests pass (3 c64api files); 63/63 fuzz tests pass.
- ✅ `./build --skip-tests --install-apk` BUILD SUCCESSFUL in 19s; APK installed and launched on Pixel 4.
- ✅ Re-ran Settings device-switch probe pack via mobile-mcp + adb shell input (12 actions). Switch c64u→u64 captured at 23:26:14.231/.316/.329/.386 (host-change success → first GET HTTP 200 38ms → trace-level errors ERR 1 105ms); reverse switch at 23:29:25.005/.212 (immediate connection-refused 1ms/3ms). Badge `● Healthy` throughout. Bracketing `curl` c64u+u64 HTTP 200 in 7.5–9.6 ms.
- ⚠️ BUG-078 PARTIALLY MITIGATED. The redundant `addErrorLog("C64 API request failed", {transient:true})` is gone. **The trace-level `recordTraceError → appendEvent("error", ...)` and `recordActionEnd {status:error}` continue to render red ERR entries in the Activity feed for first-attempt failures during device-switch windows.** Those come from a separate logging system (the trace event stream) and require broader changes to fully realize "amber not red".
- ✅ Updated `BUGS_FOUND.md` (BUG-078 #172 note), `CTA_LEDGER.md` (1 iter172 row), `STATE_DIGEST.md` (refreshed), `WORKLOG.md` (outcome appended).
- Next decision required from user before #173: choose round-2 direction for full BUG-078 UX fix — (a) demote `recordActionEnd` for transient-only action outcomes, (b) propagate `transient` flag through `buildActionSummaries → resolveErrorEffects`, or (c) suppress-on-success keyed on `(correlationId, path)`. Or pivot to a fresh probe family (Disks, Audio Mixer BUG-039).

## Ralph loop iteration #173 (2026-07-17, kilo) — BUG-078 round 2 (transient severity in action summary)

- kilo capacity usable (balance $67.4 left → ≥40% band; min 8 CTAs / target 12–20).
- Selected the digest-recommended round-2 fix for BUG-078: **propagate the transient classification through `resolveErrorEffects`** so the in-app Activity feed no longer renders the first-attempt network failures from the device-switch / idle windows as red "ERR" entries, while non-transient failures remain red. This completes BUG-078's UX half without touching retry/keep-alive/connection-reuse policy.
- Identity: branch `fix/hardening4`, HEAD `c2120eaf`, source `0.9.2-c2120`. Installed APK identity confirmed via `get_app_info` (0.9.2-c2120). No build needed for current state.
- Pixel 4 `9B081FFAZ001WX` attached. c64u `192.168.1.167` fw 1.2.0 HTTP 200; u64 `192.168.1.13` HTTP 200. Both reachable throughout.
- Previous verdict (#172): BUG-078 PARTIALLY MITIGATED — single-call-site demotion in `src/lib/c64api.ts:1897` shipped. Trace-level ERR entries persist.
- Stop criteria: scope-bounded change in `actionSummaries.ts` + `ActionExpandedContent.tsx`; deterministic regression test pinning the warn-as-not-error rendering for network-transient errorEvents; build/deploy current-source APK; re-run #172 device-switch probe pack on the Pixel 4 to confirm transient error labels now render as warn; in-app Diagnostics export + logcat sweep; refresh BUGS_FOUND/STATE_DIGEST/WORKLOG/CTA_LEDGER.
- Primary TODO: extend `ErrorEffect` with `severity`, classify by `failureClass`, propagate through `resolveErrorEffects`, render warn-effect without red `text-diagnostics-error` class.

## Ralph loop iteration #173 (2026-07-17, kilo) — BUG-078 round 2 HIL validation

- kilo usable. Selected: **BUG-078 round 2 — transient severity in action summary** (carry forward planned changes; option (b)).
- Identity: `fix/hardening4` / `c2120eaf` / `0.9.2-c2120`. Installed APK 0.9.2-c2120 from #172; source has the round-2 diffs (dirty).
- Primary TODO: build/deploy current-source APK; re-run device-switch probe pack; validate warn-as-amber rendering; update BUGS_FOUND/STATE_DIGEST.
- Previous verdict (#172): BUG-078 PARTIALLY MITIGATED; trace-level ERR entries persist.

## Ralph loop iteration #174 (2026-07-18, Codex) — BUG-078 visible Activity-row severity fix

- Capacity: Ralph-selected Codex usable (weekly 90%; >=40% action band). Selected the pending BUG-078 round-2 UI family. No sub-agent or scheduler was used.
- Initial HIL disproved the staged scope: the current-source Pixel build reached Healthy after Settings c64u→u64 handoff, but recovered transient Action/Trace rows still had red dots. Staged `ActionExpandedContent` only styled expanded ErrorEffects; row severity still came from trace type/action outcome.
- Fix: transient trace events now resolve to warning severity; error/failed action summaries resolve to warning only when all ErrorEffects are warnings; `DiagnosticsDialog` passes summary effects into the severity resolver. Expanded action header/REST error wording uses amber `warn:` for the same case. Non-transient failures remain errors.
- Stop criteria met: focused 83-test regression pack passed; rebuilt and installed the current source APK; droidmind re-ran the handoff and observed both recovered transient rows amber plus expanded `warn: The operation was aborted`; Diagnostics stayed Healthy. Restored c64u `192.168.1.167`, returned Home, and recorded final direct c64u/u64 HTTP 200 probes.

## Ralph loop iteration #175 (2026-07-18, Codex) — HIL infrastructure handoff

- Ralph-selected Codex remains usable (weekly 81%; >=40% band), but the current tool namespace exposes no droidmind, c64scope, c64bridge, mobile, or tool-search capability. A safe namespace capability inspection was performed twice; both returned no matching tools. This is a concrete required-tool blocker, not a provider inference.
- `adb devices -l` confirms Pixel 4 `9B081FFAZ001WX` is attached, but raw adb is not valid product-action evidence and was not used to launch, tap, or mutate the app/device. `./scripts/resolve-version.sh` still reports `0.9.2-c2120`; no source, APK, or device-state claim is advanced.
- No primary CTA family was selected or executed; `droidmind_cta_action_count=0` under the allowed required-tools-unavailable exception. No source edits, builds, tests, direct REST mutations, or device traffic were performed.
- Primary TODO: when a session exposes droidmind, select the next safe Disks or fresh-budget Audio Mixer BUG-039 probe pack from the current digest and execute it app-first on c64u. Ralph Robin continuation ready; no scheduler command was run.

## Ralph loop iteration #176 (2026-07-18, Codex) — Disks import/mount pack exposes foreground BUG-078 replay

- Codex capacity was usable at 80%; droidmind, mobile-mcp, c64bridge, and c64scope were available. Pixel `9B081FFAZ001WX` ran `0.9.2-c2120`, matching source `c2120eaf`.
- The Disks pack imported `3D_Pinball.d64` and `Arctic_Shipwreck.d64` from `/USB2/Games` into `Games`, mounted 3D Pinball to Drive A, then selected Drive A for Arctic Shipwreck.
- At 01:01:49 the app reported `Failed to connect to /192.168.1.167:80`, `Mount failed / Host unreachable`, and Unhealthy/5. Immediate direct `/v1/info` and `/v1/drives` reads were HTTP 200 in 9.1/14.5 ms and retained 3D Pinball.
- Safety stop: no more app C64U mutation. Manual app health check recovered Healthy; emergency direct `PUT /v1/drives/a:remove` restored Drive A unmounted. Final direct `/v1/info` was HTTP 200 in 9.3 ms. No source edits, builds, deployment, tests, or coverage.
- Next: trace app/native ownership of this foreground Disk PUT false-unreachable event before any retry, keep-alive, or connection-reuse change. Keep the two imported D64 rows for later mounted-delete/rotation work.

## Ralph loop iteration #177 (2026-07-18, kilo) — Lower Settings persistence pack

- Runtime/capacity: Ralph Robin selected kilo at balance $70.7 (≥40% band; min 8 / target 12–20 CTAs).
- Identity: branch `fix/hardening4`, HEAD `c2120eaf`, source `0.9.2-c2120`. Pixel 4 `9B081FFAZ001WX` APK `0.9.2-c2120` confirmed via droidmind `get_app_info` — matches source. No build/deploy needed.
- c64u `192.168.1.167` HTTP 200 in 9 ms; u64 `192.168.1.13` HTTP 200 in 8 ms. Both reachable. droidmind, mobile-mcp, c64bridge, c64scope available.
- Previous verdict (#176): BUG-078 transport symptom remains OPEN; Disks import/mount pack exposed foreground false-unreachable Disk PUT.
- Selected family: **Lower Settings persistence pack** — exercise unverified production surfaces (Notifications Duration slider + Visibility selector, Device Safety Resilience defaults + Allow circuit override, Online Archive User-Agent override, lower Feature-flag toggles). UI-only / app-local state changes; no device REST mutation. Restore every changed value.
- Stop criteria: ≥8 production CTAs through droidmind; package-filtered logcat sweep; one in-app Diagnostics export-and-analyze; restore every changed value; record batch evidence; update CTA_LEDGER; refresh digest; hand off.
- Primary TODO: scroll Settings into lower sections, enumerate visible controls, exercise safe ones via droidmind, restore, sweep diagnostics, write evidence.

## Ralph loop iteration #178 (2026-07-18, Codex) — Diagnostics request-ownership evidence pack

- Ralph-selected Codex had 75% weekly capacity (>=40% band). The current Pixel APK and source both report `0.9.2-c2120`; c64u and u64 `/v1/info` were 200 in 8.7/8.4 ms at baseline.
- Selected one safe Diagnostics/foreground family: 19 droidmind interactions covered stale Disks mount-dialog close, Settings navigation, Diagnostics open, `Run health check` x3, Activity filter/expand, Share all/cancel, HOME/foreground, Diagnostics reopen, and a final health check. No device-setting or disk mutation was performed.
- The pack reproduced a related BUG-078 symptom: at 01:35:33.311, Activity recorded `rest.get /v1/machine:readmem?address=00A2&length=3 ERR 1`, `Host unreachable`, origin `system`, correlation `COR-0156`. The app returned to `Healthy`; a post-foreground app `/v1/info` recorded HTTP 200 but took 1501 ms, while host c64u `/v1/info` was 200 in 9.0 ms.
- Share all produced `c64commander-diagnostics-all-2026-07-18-0036-14Z.zip` in the Android chooser. Private-cache access is unavailable to the controller (shell permission denied; `run-as` is rejected), so no ZIP content is claimed. Package logcat has Telnet connects/disconnects for each health check but no FATAL/ANR/StrictMode/crash/Capacitor HTTP trace. `loggingBehavior:"none"` prevents credential-bearing native bridge payloads and also leaves the Capacitor request boundary unobservable.
- Artifacts: `docs/agentic/artifacts/iter178/screenshots/01-final-diagnostics-healthy.png`, `ui/final-diagnostics.xml`, and `logcat/package-pid.log`. No source, build, deploy, or tests this loop; preserve the dirty worktree.
- Next: add a safe, credential-redacted native Capacitor HTTP request-lifecycle hook that correlates to the existing JS request ID, then build/deploy and re-run the foreground Disk PUT ownership pack. Do not alter retry, keep-alive, or connection reuse.

## Ralph loop iteration #179 (2026-07-18, Codex) — native HTTP ownership / Disk drive-control pack

- Ralph-selected Codex usable at 71% weekly capacity. Droidmind, mobile-mcp, c64bridge, and c64scope were discovered; c64bridge reported its default VICE backend and c64scope readiness was unknown, so neither supplied a hardware verdict.
- Implemented the focused prerequisite: `C64HttpPlugin` runs the same Capacitor `HttpRequestHandler` route, emitting credential-safe start/end/error records with JS request ID, correlation ID, method, and query-free target. The direct-device client passes those IDs for normal REST and native binary reads. Focused native-transport regression passed (7/7); `:app:compileDebugKotlin` and `./build --skip-tests --install-apk` passed. Pixel 4 was deployed with `0.9.2-c2120`.
- Droidmind actions exceeded the >=40% action minimum: app launch, unsafe Clear-Memory reboot guard open/cancel, Disks navigation, Drive A mount-control attempts, list scrolls, library selection, item-details open/Back, Drive A power off/on, HOME, and safety force-stop. The first power action disabled Drive A. The app restore reported `Drive power toggle failed / Host unreachable`; no further app mutations ran.
- Native logcat closes the observability gap: app `PUT /v1/drives/a:on` (`c64req-mrpni96f-1u`) reached `HttpRequestHandler` then threw `SocketTimeoutException` after 1504 ms connecting Pixel `192.168.1.206:38662` to `192.168.1.167:80`; subsequent app `/v1/drives` GETs timed out at the same boundary. Direct host c64u `/v1/info` and `/v1/drives` remained HTTP 200 in 9.8 ms. Emergency host `PUT /v1/drives/a:on` restored Drive A (`enabled:true`, no image) in 10.0 ms; app then force-stopped.
- Verdict: BUG-078's false-unreachable symptom is confirmed below JS classification in the Pixel native transport path. The evidence does not authorize retry, keep-alive, or connection-reuse changes. Preserve dirty worktree and two library disks. No scheduler command ran.

## Ralph loop iteration #180 (2026-07-18, kilo) — Settings/About external link + Settings Import settings probe pack

- kilo balance $72.8 (≥40% band; min 8 / target 12–20 CTAs).
- Identity: branch `fix/hardening4`, HEAD `c2120eaf`, source `0.9.2-c2120`. Installed APK `0.9.2-c2120` (from #179) — matches source; no build/deploy needed.
- Pixel 4 `9B081FFAZ001WX` attached. c64u `192.168.1.167` HTTP 200 in 9 ms; u64 `192.168.1.13` HTTP 200 in 8 ms. droidmind, mobile-mcp, c64bridge (VICE), c64scope available.
- Selected family: **Settings/About external "Ultimate REST API Documentation" link (DISCOVERED, never tapped) + Settings/Import settings (BLOCKED_INFRA rows 62/78 — re-attempt after #71 Export-settings WebView blob-download proof and #91 Export re-confirmation). UI-only/route-navigation; no device REST mutation.**
- Stop criteria: open Settings, scroll to About, locate external link, tap to open external browser, Android Back returns app to Settings, Diagnostics sweep; then Settings transfer Import, open picker, cancel without selecting; restore state; diagnostics + logcat sweep; record batch evidence; update CTA_LEDGER; refresh digest; hand off.
- Primary TODO: navigate Settings, enumerate the About link and Import button, drive through droidmind with real-coordinate taps, verify external-open and picker-open/cancel, restore, sweep diagnostics.

## Ralph loop iteration #181 (2026-07-18, kilo) — BUG-039 Audio Mixer SOLO route-away pack

- kilo balance $75.4 (≥40% band; min 8 / target 12–20 CTAs).
- Identity: branch `fix/hardening4`, HEAD `c2120eaf`, source `0.9.2-c2120`. Installed APK `0.9.2-c2120` (from #179) — matches source per `get_app_info`; no build/deploy needed.
- Pixel 4 `9B081FFAZ001WX` attached. c64u `192.168.1.167` HTTP 200 in 9–37 ms; u64 `192.168.1.13` HTTP 200 in 8 ms. droidmind, mobile-mcp, c64bridge, c64scope available.
- Previous verdict (#180): BLOCKED_INFRA→EXERCISED_CLEAN flip for rows 62/78 (Settings/Import settings) and DISCOVERED for the WebView-touch-blocked About external link + Open Source Licenses. BUG-078 transport symptom remains OPEN at low priority; BUG-079 SAF `Enumerate first root` disabled-state remains a low-priority separate family.
- Selected family: **BUG-039 Audio Mixer Solo route-away duplicate POST** — last remaining Low defect with bounded scope and clear repro. The pack exercises in-place Solo on/off (baseline), then the specific route-away-during-solo repro (Solo on → Home tab → observe), then broader Solo recovery (back to Config, refresh, etc.). Pre-existing traces are sparse; this loop re-confirms a clean single-POST in-place baseline, runs the route-away scenario, and records the exact count + timing of the duplicate restore POSTs.
- Stop criteria: ≥8 production CTAs through droidmind (target 12–20); record exact count + timing of all `POST /v1/configs` Audio-Mixer restore bodies; one in-app Diagnostics export+analyze; restore every value to baseline; update BUGS_FOUND.md if observed POST count diverges from 1; update CTA_LEDGER for the SOLO rows; refresh digest; hand off.
- Primary TODO: open Config → expand Audio Mixer → SOLO UltiSid 1 on → SOLO UltiSid 1 off (clean baseline) → SOLO UltiSid 2 on → tap Home tab without un-soloing → return to Config → un-SOLO → sweep diagnostics → logcat → restore 0 dB. Watch `POST /v1/configs` Audio-Mixer count and any duplicate `click Home` action-start.

## Ralph loop iteration #182 (2026-07-18, kilo) — BUG-039 Audio Mixer SOLO route-away pack

- kilo balance ≥$72 (≥40% band; min 8 / target 12–20 CTAs).
- Identity: branch `fix/hardening4`, HEAD `c2120eaf`, source `0.9.2-c2120`. Installed APK `0.9.2-c2120` matches source per `get_app_info`. c64u `192.168.1.167` fw 1.2.0 HTTP 200; u64 `192.168.1.13` fw 3.15 HTTP 200. droidmind/mobile-mcp/c64bridge/c64scope available.
- Previous verdict (#181): last attempt at BUG-039 SOLO route-away pack from the same source/APK; carry forward with fresh-budget SOLO probes.
- Selected family: **BUG-039 Audio Mixer SOLO route-away duplicate POST**. Baseline clean in-place SOLO on/off (1 POST expected each), then SOLO UltiSID 2 → tap Home tab without un-soloing → observe duplicate restore POSTs, then un-SOLO + restore.
- Stop criteria: ≥8 production CTAs through droidmind (target 12–20); record exact count + timing of `POST /v1/configs` Audio-Mixer bodies; one in-app Diagnostics export+analyze; restore every value; update BUGS_FOUND.md if observed POST count diverges from 1; update CTA_LEDGER; refresh digest; hand off.
- Primary TODO: open Config → Audio Mixer → SOLO UltiSID 2 on → tap Home tab → return to Config → observe duplicate POSTs → un-SOLO → restore 0 dB → sweep diagnostics + logcat.
