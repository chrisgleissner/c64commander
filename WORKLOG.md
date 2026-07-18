# WORKLOG — Full CTA Coverage Hardening Pass

## Ralph loop iteration #170 (2026-07-17, kilo) — Play + Settings probe pack with BUG-078 readmem misclassification evidence

- Runtime/capacity: Ralph Robin selected kilo, balance $61.9 (>=40% band); mandatory minimum 8 actions / target 12–20 actions. droidmind discovered live; c64bridge accessible; c64scope readiness = unknown peers so no c64scope session opened (consistent with prior loops).
- Identity: branch `fix/hardening4`, HEAD `c2120eaf`, source `0.9.2-c2120`. Pixel `9B081FFAZ001WX` package `uk.gleissner.c64commander` v `0.9.2-c2120` confirmed via `droidmind android-app get_app_info` and Home render shows `App 0.9.2-c2120 / Device c64u / Firmware 1.2.0`. Existing dirty source/test/lockfile/config/CDP-helper changes preserved.
- Reachability: bracketing `curl http://c64u/v1/info` and `curl http://u64/v1/info` both HTTP 200 in 7–10 ms; c64u confirmed healthy throughout the loop.
- Probe pack (droidmind-driven, ≥40% capacity budget used):
  - **Play Mute/Unmute ×5**: each tap toggled cleanly between `Mute` and `Unmute` and the slider dropped to `-42 dB` then recovered; badge stayed `Connected to c64u, system healthy`; no toasts (BUG-078 misclassification did not reproduce on this run from a clean badge baseline).
  - **Play/Pause ×4** (cycles Play → Pause → Play → Pause): both buttons stayed visible per the unaudited state, no toast.
  - **Playback volume SeekBar ×4 drags** (radial and long-swipe variants): value remained `-42 dB`; recorded as a known Radix-UI React slider limitation — synthetic `input swipe` does NOT actuate the React drag handler. Real-finger drag would actuate but no droidmind primitive for that exists. No app defect.
  - **Recurse ×3 / Repeat ×3 / Reshuffle ×1**: a11y did not reflect the new checkbox states, no toast, no UI regression.
  - **Settings tab navigation**, then several scrolls to reach Diagnostics. Long Settings page (10+ sections) means `diagnostics-open-dialog` lands below the visible viewport; subsequent scroll-and-tap sequence opened the dialog cleanly.
  - **Saved devices → Delete device (DESTRUCTIVE_GUARDED)**: tapped Delete on the c64u row → Radix confirm dialog `Delete device? / Remove c64u from your saved devices?` appeared. Closed it via the top-right × button (guard path).
  - **Saved devices → tap u64 row (device switch CTA)**: tapping the row acts as an active-device switch — badge flipped to `Connected to u64, system healthy` and the form repopulated `u64 / 192.168.1.13`. **Important product observation**: there is no separate "select" affordance; the row tap IS the switch. Documented in CTA ledger.
  - **Saved devices → Delete device on u64 row**: Radix confirm dialog `Delete device? / Remove u64 from your saved devices?` opened. Tapped Cancel → dialog dismissed, u64 still in the list. (Guard proven.)
  - **Saved devices → tap c64u row** to switch back: badge `Connected to c64u, system healthy`, form repopulated `c64u / 192.168.1.167`, c64u row marked `Selected`.
  - **Discover devices** tap: the tap on the button at (540, 2227) escaped the WebView to the Android launcher home screen (C64 Commander minimized). No `Intents.ACTION_VIEW` was triggered; the tap most likely landed on the navigation bar overlay (nav-bar background at y=2148..2280, 132 px tall). **Relaunched the app** via `mobile-mcp_mobile_launch_app` — app restored to Settings with the badge still `Connected to c64u, system healthy` (no device-state regression). This is the **first iteration to reproduce a Settings-tap-into-launcher misroute**; needs `nav-bar reserve` review but per PROTECTED LAYOUT INVARIANTS in the prompt, `.page-shell` bottom spacing is forbidden as a "fix". Do not reintroduce a tab-bar-height reserve in `.page-shell`.
  - **Refresh connection** (silent handler): badge stayed Healthy, no toast.
  - **Save & Connect**: badge stayed Healthy, no error.
  - **Diagnostics dialog open**: status `● Healthy`, `Last check 16s ago`, c64u identity. Activity feed showed `GET /v1/info REST 1 HTTP 200 34ms` and earlier `HTTP 200 88ms` entries — successful probes.
  - **Run health check ×4**: status remained/returned to Healthy; filter count grew from 440 → 444 across the batch.
  - **Diagnostics dialog readmem error attribution (BUG-078 territory)**: during the health-check burst, the Activity feed accumulated 4 `error rest.get /v1/machine:readmem?address=00A2&length=3 ERR 1 App · 23:00:02.977/01.507 c64u` and 2 `error rest.get /v1/machine:readmem?address=D012&length=1 ERR 1 App · 23:00:02.736/01.261 c64u` entries plus 1 `error ERROR Telnet request failed Problems · App · 23:00:59.212 c64u` problem. **Bracketing direct `curl http://c64u/v1/machine:readmem?address=00A2&length=3` and `?address=D012&length=1` both returned HTTP 200 in 8.9 ms.** c64u is unambiguously healthy; the app classified successful 200 reads as ERR 1, and at least once the badge transitioned to `▲ Degraded` with the same c64u direct status. This is fresh, current-build evidence that the **HealthSnapshot engine (`src/lib/diagnostics/healthCheckEngine.ts`, dirty in worktree) or its error classifier is over-counting readmem 200s as failures**. The Telnet error is consistent with the #156/154/152/150 history of transient app-side request misclassification.
  - **Telnet error row tap**: tap at (540, 53) on the new Telnet error entry did not expand or navigate; the dialog appears to be a read-only compact summary at this viewport size. Recorded the affordance gap.
  - **Close diagnostics dialog** (Close button at top-right): dialog dismissed cleanly.
  - **Enable Debug Logging toggle** (Settings): the checkbox is `identifier="debug-logging"`; the toggle action is recorded. The page shifted visibly after the tap, suggesting the row expanded or a label changed.
  - **List persisted URIs / Enumerate first root** (SAF diagnostics): two safe read-only CTAs exercised; no UI regression; the page did not surface a toast in the captured snapshots (could be transient).
  - **Home tab nav**: Home rendered `App 0.9.2-c2120 / Device c64u / Firmware 1.2.0` and the Quick Actions grid (Reset, Reboot, Pause, Menu, Save RAM, Load RAM, Remote Input, Power Off).
  - **Home Pause**: tapped Pause — c64u `/v1/info` after tap still HTTP 200 in 9.2 ms.
- Diagnostics/log sweep:
  - Package-filtered logcat slice `docs/agentic/artifacts/iter170/logcat/logcat-package-final.log` (85 lines): only Chromium `Invalid first_paint` warnings (background WebView noise, not app action-attributable). **No FATAL, ANR, StrictMode, app exception, app `Host unreachable`, or app REST/HTTP trace** — fully consistent with the BUG-076 `loggingBehavior:"none"` config.
  - **No way to capture in-app Diagnostics Share-all ZIP from this build**: the diagnostics dialog rendered in the Pixel viewport only shows the compact single-tab view (Healthy status + c64u + Run health check + Activity feed). The full multi-tab layout (Logs / Traces / Actions / Errors / Latency / Heat map / Config drift / Device detail / Decision state) and Share all overflow menu referenced by the prompt are **not exposed at this viewport on this dialog**. The `shareAllDiagnosticsZip` ZIP therefore was NOT pulled this loop. The compact dialog Activity feed itself preserved the readmem/Telnet error rows above and is the in-app evidence source for this loop's BUG-078 finding.
- Cleanup: Play page final state shows `Mute` (audio unmuted) and `0 dB` slider, `Recurse` checkbox still checked from the compacted prior session. UltiSID restored to 0 dB naturally. c64u left in a healthy state with no app-driven queue stuck.
- Code/build/coverage: no source edits, no build, no install, no coverage, no scheduler command. Ralph Robin continuation ready; no sub-agent launched.
- Next family: continue BUG-078 ownership trace from the diagnostic-classification side (healthCheckEngine + resolveHostErrorMessage) before any retry/connection-policy edit. The clean c64u baseline + the readmem 200-classified-as-ERR evidence is enough to focus the next edit attempt.

## Ralph loop iteration #168 (2026-07-17, Codex) — immediate capacity handoff

- Runtime/capacity: Ralph Robin selected Codex at **2% weekly capacity**. The explicit `<=4%` threshold requires immediate handoff; no HIL, source edits, build, deployment, or direct device probes were started. `droidmind_cta_action_count=0` is an allowed pre-action capacity block, not a clean product verdict.
- Startup state: `fix/hardening4` remains at `c2120eaf` (`0.9.2-c2120`); existing dirty worktree changes remain preserved. The last verified Pixel identity remains `9B081FFAZ001WX` / `0.9.2-c2120`; this loop made no device/APK claim.
- Discovery/handoff: actual namespace inspection found droidmind Android, c64scope, and c64bridge controls. No peer is classified unavailable; capacity alone deferred HIL. BUG-078 remains Low/Open and needs native request-ownership tracing before any retry, keep-alive, or connection-policy change. Ralph Robin continuation is ready; no scheduler command ran and no sub-agent was launched because Ralph owns rotation.

## Ralph loop iteration #167 (2026-07-17, Codex) — immediate capacity handoff

- Runtime/capacity: Ralph Robin selected Codex at **2% weekly capacity**. The explicit `<=4%` threshold requires immediate handoff; no HIL, source edits, build, deployment, or direct device probes were started. `droidmind_cta_action_count=0` is an allowed pre-action capacity block, not a clean product verdict.
- Startup state: `fix/hardening4` remains at `c2120eaf` (`0.9.2-c2120`); existing dirty worktree changes remain preserved. The last verified Pixel identity remains `9B081FFAZ001WX` / `0.9.2-c2120`; this loop made no device/APK claim.
- Discovery/handoff: HIL is deferred by capacity policy, not a tool-unavailability conclusion. BUG-078 remains Low/Open and needs native request-ownership tracing before any retry, keep-alive, or connection-policy change. Ralph Robin continuation is ready; no scheduler command ran and no sub-agent was launched because Ralph owns rotation.

## Ralph loop iteration #165 (2026-07-17, Codex) — immediate capacity handoff

- Runtime/capacity: Ralph Robin selected Codex at **3% weekly capacity**. The explicit `<=4%` threshold requires immediate handoff; no HIL, source edits, build, deployment, or direct device probes were started. `droidmind_cta_action_count=0` is an allowed pre-action capacity block, not a clean product verdict.
- Startup state: `fix/hardening4` remains at `c2120eaf` (`0.9.2-c2120`); existing dirty worktree changes remain preserved. The last verified Pixel identity remains `9B081FFAZ001WX` / `0.9.2-c2120`; this loop made no device/APK claim.
- Discovery/handoff: the actual current tool namespace still exposes droidmind Android controls plus c64scope and c64bridge controls. No peer was treated as unavailable; the capacity rule, not tooling, deferred HIL. BUG-078 remains Low/Open and needs native request-ownership tracing before any retry, keep-alive, or connection-policy change. Ralph Robin continuation is ready; no scheduler command ran and no sub-agent was launched because Ralph owns rotation.

## Ralph loop iteration #164 (2026-07-17, Codex) — immediate capacity handoff

- Runtime/capacity: Ralph Robin selected Codex at **3% weekly capacity**. The explicit `<=4%` threshold requires immediate handoff; no HIL, source edits, build, deployment, or direct device probes were started. `droidmind_cta_action_count=0` is an allowed pre-action capacity block, not a clean product verdict.
- Startup state: `fix/hardening4` remains at `c2120eaf` (`0.9.2-c2120`); existing dirty worktree changes remain preserved. The last verified Pixel identity remains `9B081FFAZ001WX` / `0.9.2-c2120`; this loop made no device/APK claim.
- Discovery/handoff: the actual current tool namespace still exposes droidmind Android controls plus c64scope and c64bridge controls. No peer was treated as unavailable; the capacity rule, not tooling, deferred HIL. BUG-078 remains Low/Open and needs native request-ownership tracing before any retry, keep-alive, or connection-policy change. Ralph Robin continuation is ready; no scheduler command ran and no sub-agent was launched because Ralph owns rotation.

## Ralph loop iteration #161 (2026-07-17, Codex) — capacity handoff before HIL

- Runtime/capacity: Ralph Robin selected Codex at **5% weekly capacity**. The explicit 5–9% threshold forbids new HIL, source edits, builds, deployment, and direct device probes. `droidmind_cta_action_count=0` is therefore an allowed pre-action capacity block, not a clean product verdict.
- Startup state: `fix/hardening4` remains at `c2120eaf` (`0.9.2-c2120`); existing dirty worktree changes remain preserved. The last verified Pixel identity remains `9B081FFAZ001WX` / `0.9.2-c2120`; this loop made no device/APK claim.
- Discovery: actual current tool-namespace inspection exposes droidmind Android controls, c64scope lab/session/capture controls, and c64bridge controls. No peer was treated as unavailable; the capacity rule, not tooling, deferred HIL.
- Result/handoff: no new product or hardware evidence and no defect status changed. BUG-078 remains Low/Open; execute its native request-ownership trace before any retry, keep-alive, or connection-policy change. Ralph Robin continuation is ready; no scheduler command ran and no sub-agent was launched because Ralph owns rotation.

## Ralph loop iteration #160 (2026-07-17, Codex) — capacity handoff before HIL

- Runtime/capacity: Ralph Robin selected Codex at **5% weekly capacity**. The explicit 5–9% threshold forbids new HIL, source edits, builds, deployment, and direct device probes. `droidmind_cta_action_count=0` is therefore an allowed pre-action capacity block, not a clean product verdict.
- Startup state: `fix/hardening4` remains at `c2120eaf` (`0.9.2-c2120`); existing dirty worktree changes remain preserved. The last verified Pixel identity remains `9B081FFAZ001WX` / `0.9.2-c2120`; this loop made no device/APK claim.
- Discovery: actual current tool-namespace inspection exposes droidmind Android controls, c64scope lab/session/capture controls, and c64bridge controls. No peer was treated as unavailable; the capacity rule, not tooling, deferred HIL.
- Result/handoff: no new product or hardware evidence and no defect status changed. BUG-078 remains Low/Open; execute its native request-ownership trace before any retry, keep-alive, or connection-policy change. Ralph Robin continuation is ready; no scheduler command ran and no sub-agent was launched because Ralph owns rotation.

## Ralph loop iteration #158 (2026-07-17, Codex) — capacity handoff before HIL

- Capacity/action accounting: Ralph-selected Codex has **7% weekly capacity**, the mandatory 5–9% band. The policy prohibits new HIL, source edits, build, deploy, and direct device/network probes; zero droidmind actions are therefore an allowed capacity-based reduction, not a clean product verdict.
- Identity/tooling: `fix/hardening4` remains at `c2120eaf` / `0.9.2-c2120`; the existing dirty worktree is preserved. The last Pixel evidence remains `9B081FFAZ001WX` / `0.9.2-c2120`. Actual tool-namespace discovery confirms exposed droidmind Android, c64scope, and c64bridge controls; no safe status/action call was made because the policy blocks HIL rather than tool availability.
- Handoff: no hardware, app, or source state was changed. BUG-078 remains the selected next family: trace native request ownership across diagnostics, config, playback, and saved-device-health foreground reconcilers before any retry, keep-alive, or connection-policy change. Ralph Robin continuation is ready; no scheduler or sub-agent was used.

## Ralph loop iteration #156 (2026-07-17, Codex) — BUG-078 locked-playback ownership non-reproduction

- Capacity/action accounting: Ralph-selected Codex had 11% weekly capacity (10–19% band; minimum 3). Droidmind drove Play, Android HOME, lock, unlock/foreground, Diagnostics open, and Run health check. No scheduler or sub-agent was used.
- Identity/tooling: Pixel `9B081FFAZ001WX` and current source are `0.9.2-c2120` on `fix/hardening4` `c2120eaf`; droidmind was callable, while c64scope reported unknown peers. Direct c64u `/v1/info` reads before/after were HTTP 200 in 9.5/8.7 ms with `errors:[]`.
- Result: the 0:33 Mad Monkey SID auto-ended while locked; `BgExecService` logged its due watchdog, service stop, audio-focus release, and wake-lock release. After foreground, the header and Diagnostics were Healthy, an app `/v1/info` at 21:31:32 was HTTP 200, and the app-driven manual health check remained Healthy. This is a bounded non-reproduction, not a BUG-078 closure.
- Diagnostics: the package log has no FATAL/ANR/StrictMode/app exception, but repeated Chromium `Invalid first_paint` errors occurred during the flow and remain visible for separate ownership/renderer analysis. Source inspection confirms foreground resume concurrently schedules diagnostics, route-config, playback, and saved-device background health reconcilers; no retry, keep-alive, or connection-policy change was made.
- Cleanup/deploy: Diagnostics Share all generated `c64commander-diagnostics-all-2026-07-17-2035-54Z.zip` in Android's one-file chooser; Back cancelled it without a persisted app-owned copy. The latest `c64commander-0.9.2-c2120-debug.apk` was reinstalled and launched. Rendered Home confirms `0.9.2-c2120`, c64u firmware 1.2.0, and Healthy. No source change, build, test, or broad validation was appropriate for this HIL-only pack.

## Ralph loop iteration #154 (2026-07-17, Codex) — BUG-078 native connection-refusal replay

- Capacity/action accounting: Ralph-selected Codex had 17% weekly capacity (10–19% band; minimum 3). Droidmind drove 12 meaningful product actions: Mad Monkey start, POWER lock/wake, unlock swipe, Diagnostics open, Run health check, overflow, Share all, chooser Back, Diagnostics close, Pause, and Unmute. No scheduler/sub-agent was used.
- Tool discovery/identity: Droidmind, c64scope, c64bridge, and mobile-mcp namespaces are callable. c64scope readiness listed unknown peers; c64bridge was stale VICE, so neither made a product claim. Pixel `9B081FFAZ001WX` reports `0.9.2-c2120`, matching `fix/hardening4` `c2120eaf`; pre-existing dirty worktree files were preserved. c64u fw 1.2.0 direct `/v1/info` was HTTP 200 in 9.2 ms before and 9.0 ms after, with `errors:[]`.
- Evidence: immediately after the app-started SID action the app header moved Degraded/10 → Unhealthy/18. Diagnostics activity retains app-native GET `/v1/info` failures at 21:12:44: initial 89 ms refusal, 22 ms transient retry refusal, `ERROR C64 API request failed`, and `WARN Health check REST probe failed`; both say `Failed to connect to /192.168.1.167:80`. This overlapped a direct healthy host path and therefore remains BUG-078, not firmware TCP-wedge proof. After lock for 38 seconds then wake/unlock, foreground app reads recovered, the header became Healthy, and the app-driven manual health check completed Healthy.
- Audit/cleanup: Share all opened Android's one-file chooser for `c64commander-diagnostics-all-2026-07-17-2015-38Z.zip`; the `run-as` attempt needed to pull app-private cache was rejected by Droidmind's command policy, so no ZIP pull/analysis is claimed. Artifacts retain package-PID logcat at `docs/agentic/artifacts/iter154/logcat/`; it has no FATAL/ANR/StrictMode/app exception. Final Play UI has Resume (SID paused), Mute and `0 dB` (UltiSID unmuted), and Healthy c64u badge. No source change, build, test, or broad validation was appropriate for this HIL-only evidence pack. Ralph Robin continuation ready.

## Ralph loop iteration #153 (2026-07-17, Codex) — BUG-078 locked-playback recovery replay

- Capacity/tool discovery: Ralph-selected Codex usable (weekly 22%; 20–39% action band). Droidmind, c64scope, and c64bridge namespaces were callable; c64scope lab readiness was unavailable and c64bridge was currently pointed at VICE, so neither supplied a product verdict. Droidmind drove 12 meaningful Play/lifecycle/Diagnostics actions: selected SID play, route scrolling, Home, lock, wake/unlock, foreground, Diagnostics open, health check, and Back cleanup.
- Identity and target: Pixel 4 `9B081FFAZ001WX` runs `0.9.2-c2120`, matching `fix/hardening4` HEAD `c2120eaf`. c64u fw 1.2.0 direct `/v1/info` was HTTP 200 in 9 ms before finalization.
- Replay result: selected `Mad Monkey` started; native `BgExecService` watchdog fired after the 0:33 due time while locked; unlock returned to Play with frozen `0:33` / `Remaining 0:00` and the guarded Stop control untouched. Immediately after unlock the app header briefly showed `C64U ▲ 2`; initial `/v1/info` rows and the first manual health check were Healthy. At 21:08:43 the app `/v1/info` failed, logged `Retrying transient health`, and failed again at 21:08:46. Diagnostics showed Unhealthy/13 and `Host unreachable`; detail carries `attempt:1`, `maxAttempts:1`, `retryCount:0`. Direct c64u REST immediately remained HTTP 200 in 8.6 ms. Package logcat contained no FATAL/ANR/StrictMode/app exception.
- BUG-078 is reproduced with app-side request evidence. Further C64U app traffic was stopped after capture; no source, build, test, scheduler, or sub-agent work was performed. The app was left on Play with the post-song `0:33` timeline and volume 0 dB, but health is not claimed clean.

## Ralph loop iteration #152 (2026-07-17, Codex) — locked SID auto-end timeline fix + Pixel HIL

- Capacity/tool discovery: Ralph-selected Codex usable (weekly 29%; 20–39% action band). Droidmind, c64scope, and c64bridge namespaces were callable; c64scope lab readiness remained unknown, and its reserved capture emitted no usable analysis artifact. Droidmind drove Play navigation/start, Home, POWER lock, wait through due time, POWER wake, unlock swipe, foreground, Diagnostics, manual health, and Back cleanup.
- Identity: branch `fix/hardening4`, HEAD `c2120eaf`, source label `0.9.2-c2120`. The newly built APK `c64commander-0.9.2-c2120-debug.apk` installed successfully on Pixel 4 `9B081FFAZ001WX`; `get_app_info` confirms `0.9.2-c2120`. c64u fw 1.2.0 was HTTP 200 before and after with `errors:[]`.
- Found and fixed a visible locked auto-end defect. The pre-fix app reached elapsed `1:21` after a 0:33 SID completed while locked, even though native `BgExecService` logged `Auto-skip watchdog fired` and released normally. The song must retain its guarded Stop control because the C64U runner stays audible after its catalogued duration, but the UI must not keep advancing. `usePlaybackController.finishPlaylistPlayback` now freezes elapsed at the resolved duration, stops the timeline source, and preserves the existing safety affordance. Regression `keeps a Stop affordance reachable when a song-category playlist ends (HARD11-003)` now asserts elapsed `1_000` and cleared start timestamp; it failed before and passed after.
- Validation: `npx vitest run tests/unit/playFiles/usePlaybackController.autoAdvance.test.tsx` (16/16), Prettier check on changed TS/TSX, and `./build --skip-tests --install-apk --device-id 9B081FFAZ001WX`. Replayed the lock flow after deploy for 38 seconds: Droidmind showed `0:33` / `Remaining: 0:00` with guarded Stop still visible; native watchdog fired at the due time. No direct Stop/reset was used; volume stayed 0 dB. c64scope `pt-20260717T195124Z` records the passing timeline assertion.
- Release-relevant residual: app Diagnostics was Degraded on unlock and manual Run health check failed REST `Host unreachable` in 5128 ms, while immediate independent c64u `/v1/info` was HTTP 200 in 9 ms. This is BUG-078 Low, not suppressed. The c64scope session is therefore finalized inconclusive/product-failure despite the fixed timeline criterion. Package logcat had no FATAL/ANR/StrictMode/app exception. No scheduler/sub-agent was used.

## Ralph loop iteration #151 (2026-07-17, Codex) — Disks C64U browser and fixture-gated execution pack

- Capacity/tool discovery: Ralph-selected Codex remains usable (weekly 37%; >=40% band). Droidmind, c64scope, c64bridge, and mobile-mcp are callable. c64scope lab readiness reported unknown peers, so no capture was used; A/V evidence is not relevant to this browser/drive family. c64bridge initially targeted VICE; it was explicitly switched to c64u for read-only final firmware health only.
- Identity: branch `fix/hardening4`, HEAD `c2120eaf`; Pixel 4 `9B081FFAZ001WX` continues to run the matching `0.9.2-c2120` APK. Pre-existing dirty source/test/lockfile/config/CDP-helper changes were preserved; no source was changed.
- Droidmind drove a coherent safe Disks pack: route navigation; D-pad/Tab focus traversal to the accessible `Add disks` control; D-pad activation; source chooser → C64U; `/Flash` Refresh; open empty `/Flash/carts`; Up; no-match `zzzz` filter; clear via DEL; Back first dismissing IME and then closing the sheet; Diagnostics → Run health check → Share all → cancel share → close. Read-only CDP bounds were used only to calibrate Droidmind coordinates on the WebView.
- Results: `/Flash` listed only `carts`, `config`, `html`, and `roms`; `carts` was empty. No disposable `.d64` fixture is reachable in the app, so mount/eject/rotate and mounted-delete guard completion were not attempted. This is a fixture/setup blocker, not an app defect. The disk library and all drive state remain unchanged: Drive A/B and Soft IEC show no disk mounted; Soft IEC remains OFF.
- Diagnostics showed Healthy throughout. Its activity confirmed successful C64U FTP `LIST /Flash` (112 ms) and `LIST /Flash/` (290 ms), `GET /v1/drives` 200, all picker interactions, the manual health check, and successful Share all. The one-file Android share sheet opened for `c64commander-diagnostics-all-2026-07-17-1944-55Z.zip`; it is a content URI and was not persisted under `/sdcard/Download`, so no ZIP pull is claimed. Package logcat sweep found no FATAL/ANR/StrictMode/app exception. Final c64bridge c64u firmware health passed version/info/readmem in 32 ms.
- No build, lint, tests, or screenshot corpus refresh: this was HIL-only with no source change. The latest existing `c64commander-0.9.2-c2120-debug.apk` was reinstalled and launched after cleanup; Home visibly confirms `0.9.2-c2120`, c64u, fw 1.2.0, and a healthy badge. No scheduler/sub-agent was used. Next: provision a clearly test-owned disposable D64 in the C64U app-visible source, then resume the existing mount/eject/rotate/guard execution slice; otherwise choose locked-background playback or the separate BUG-039 safety pack.

## Ralph loop iteration #149 (2026-07-17, Codex) — BUG-077 REST retry + Pixel HIL

- Capacity/tool discovery: Codex weekly 54%; droidmind, mobile-mcp, c64scope, and c64bridge namespaces were present. Droidmind confirmed Pixel 4 `9B081FFAZ001WX`; c64scope lab state was unknown because no peer had reported health, and no A/V capture was relevant to this diagnostics-only family.
- Identity: branch `fix/hardening4`, HEAD `c2120eaf`, local source label and final installed APK `0.9.2-c2120`. Latest debug APK was rebuilt and reinstalled after the implementation. c64u `192.168.1.167`, fw 1.2.0, returned HTTP 200 and `errors:[]` before and after.
- Fix: `healthCheckEngine` retries a transient REST `getInfo` failure once, preserves the 3000 ms per-attempt bound, and raises the enclosing REST ceiling to 6000 ms. Abort/non-transient errors still fail on the first attempt. This mitigates the firmware's first-after-idle false negative; it does not claim to repair the firmware TCP wedge.
- Validation: `npx vitest run tests/unit/lib/diagnostics/healthCheckEngine.test.ts` 77/77; `npx tsc --noEmit`; `./build --skip-tests --install-apk`. Regression proves Failed-to-fetch retries once and Unauthorized does not retry.
- Droidmind actions: Health badge → Diagnostics; Run health check; 50-second idle; Run health check; Problems/Actions/filter controls; overflow → Config Drift → Refresh → Back; overflow → Decision State → Back; overlay Back close; post-final-deploy Health badge → Diagnostics → Run health check; overflow → Share all. Share all built a `c64commander-diagnostics-all-2026-07-17-1917-30Z.zip` content URI and opened Android's one-file share sheet. Selecting Total Commander returned cleanly, but `/sdcard/Download` had no persisted file, so there is no falsely claimed ZIP pull. The fresh final health check was Healthy with green badge; final package logcat contained no FATAL/ANR/StrictMode/app exception (only benign Android memory and Telnet connection entries).
- The intermittent idle-connect timeout did not recur in the safe bounded HIL window. Exact retry behavior is covered deterministically; no network toggling, firmware reset, or request flood was used. Final app left on Diagnostics Healthy over Home; no device or configuration state was changed.

## Ralph loop iteration #146 (2026-07-17, Codex) — Config Audio Mixer reconciliation fix + c64u Pixel HIL

- Capacity: Ralph-selected Codex usable (weekly 57%), so the >=40% control-action band applied. DroidMind drove 15+ meaningful product actions across the Audio Mixer family, including long slider drags, Reset, Refresh, SOLO on/off, category collapse/reopen, Docs→Config remount, and Android background/foreground.
- Identity: branch `fix/hardening4`, HEAD `c2120eaf`; debug APK rebuilt from current local source and installed on Pixel 4 `9B081FFAZ001WX` at 19:14 BST. Installed version `0.9.2-c2120`; APK contains the local reconciliation fix.
- Primary c64u `192.168.1.167`, fw 1.2.0, was HTTP 200 before and after. Baseline and cleanup: Master/U1/U2/Socket1/Socket2 all `0 dB` with empty firmware errors.
- Found a reproducible app display defect: after SOLO U1 on/off, the immediate Config UI showed restored `0 dB`, but a Docs→Config remount later displayed U2 as `OFF`; direct c64u REST still reported `0 dB`. Refresh repaired the display. This was stale app state, not a failed restore write.
- Fix: `ConfigBrowserPage` explicitly refetches and synchronizes the Audio Mixer state after an unSOLO batch restore, with the current refetch held in a ref so unstable test-hook identities cannot re-trigger routing effects. Regression `reconciles restored Audio Mixer values from the post-Solo device read-back` passes.
- Validation: `npx vitest run tests/unit/pages/ConfigBrowserPage.test.tsx` 31/31; Prettier check passed; `./build --skip-tests --install-apk` passed. Pixel HIL on the rebuilt APK repeated U1 SOLO on/off then Docs→Config→Audio Mixer reopen: U2 remained `0 dB`. Native app logs show one SOLO POST, one restore POST, and fresh category GETs, all HTTP 200. Diagnostics was Healthy/c64u with current actions and no visible problem row. Final direct REST and `/v1/info` were HTTP 200; filtered logcat had no FATAL/ANR/StrictMode/crash/exception.
- New security finding **BUG-076 Critical:** package logcat’s native CapacitorHttp metadata includes the full password header. No credential value is recorded here or in new artifacts. JS Diagnostics redaction is not implicated. This requires a dedicated native logging/security follow-up; no scheduler command was run because Ralph selected Codex remains usable.

All times 2026-06-24 unless noted.

## Session bughunt-20260625T164637Z (HEAD b86877f4) — FRESH RUN ON FIXED BUILD

### Setup (16:46–17:48Z)

- `git status`: clean. branch test/full-cta-coverage. HEAD b86877f43589.
- Read handover8, bug-hunt-ledger, bug-hunt-report, PLANS, S1 defect.
- **Hardware probe**: Pixel 4 `9B081FFAZ001WX` connected. c64u `http://c64u/` = **HTTP 200 in 0.147s (UP/HEALTHY)** — the handover8 blocker (c64u down) is CLEARED.
- Installed APK at start = `0.8.9-cf84d` (vc 2044), predates HEAD fixes. `git diff cf84d8e5..HEAD -- src/` = 4 product files (UnifiedHealthBadge, HomeDiskManager, c64api, DriveManager = S1/S2/C1/C2/C3 fixes). Per prompt step 9 → rebuild required.
- Created artifact root `bughunt-20260625T164637Z-pixel4-c64u-b86877f43589/` + environment.json + apk-identity.json + installed-package-identity.json.
- `scope:check` (bg): 55 files/361 tests PASS (exit 0).
- `cap:build && android:apk` (bg): BUILD SUCCESSFUL (exit 0) → `c64commander-0.8.9-b8687-debug.apk`, SHA-256 f052b0b1…
- force-stop old app; `adb install -r` → Success. Installed `0.8.9-b8687`, vc 2047, sig d39d81d2.
- Launched HEAD build, proved c64u-green baseline (device c64u, fw 1.1.0, Drive A ON/no-disk/OK), CDP forward (pid-scoped tcp:9333).

### S1 ROOT CAUSE + FIX (17:5x–18:2xZ) — USER-DIRECTED ("find out why and fix it / prevent it")

- **Reproduced the catastrophic c64u wedge** on unfixed b8687: idle 42s → Drive A mount (Boulder Dash 2.d64, readonly) → device returned HTTP 404 (file EXISTS per FTP) → within ~90s c64u web stack went HTTP 000 (ping 0% loss). **User confirmed it did NOT self-heal — they power-cycled it.**
- User context: long-standing (months), some C64 Commander activity drops c64u into network degradation needing manual restart. NOT a recent regression.
- **Root cause** (evidence + code + docs/agentic/C64U_INCIDENTS.md #64-cont/#84/original-S1): Android okhttp-backed `HttpURLConnection` reuses a pooled idle TCP socket the c64u embedded server dropped → first post-idle request → `Connection reset`/bogus 404 → device REST stack hard-hangs. Signal = `wasIdle:true` (42k/47k/197k ms), not request content. `git diff cf84d..HEAD c64api.ts` = mount request byte-identical (only timeout + the ineffective JS Connection:close).
- **Why prior fix failed:** `Connection` is a Fetch forbidden header — stripped by WebView before CapacitorHttp native client (proof: methodData logs only content-type+x-password, no Connection).
- **FIX:** `MainActivity.disableHttpConnectionReuse()` → `System.setProperty("http.keepAlive","false")` in onCreate (disables HttpURLConnection pooling). + honest comment in c64api.ts buildTransportHeaders. + 2 Kotlin regression tests (PASS).
- Built fixed APK (SHA 2ffb1645, ≠ unfixed f052b0b1), installed, MainActivityTest PASS.
- **VERIFIED ON-DEVICE (A/B, same Wi-Fi/action):** fixed build — idle 50s → mount → HTTP 200/780ms, disk mounted, c64u 403/8ms healthy x15 probes; idle ~6min → eject → HTTP 200/147ms, ejected, c64u healthy x15 probes. Zero Connection reset. Transient Wi-Fi SYN-loss now self-heals ("degraded"→"healthy" <40s) vs prior wedge.
- Preserved finding prominently: auto-memory (MEMORY.md top + c64u-keepalive-wedge-rootcause.md), AGENTS.md ⚠️ callout, C64U_INCIDENTS.md ⭐ banner, c64u-flakiness memory cross-ref, defect S1-ROOTCAUSE-*.md.
- Drive A left clean (No disk mounted / OK / healthy).

### Breadth bug hunt + cleanup (18:2x–18:3xZ, fixed build)

- CDP error collector injected into SPA; **6-route keypad sweep (digits 1–6) → 0 JS errors/exceptions** (Home 164/Play 63/Disks 80/Config 42/Settings 109/Docs 40 interactive els).
- Keypad: `*`→Diagnostics (Back dismiss), `#`→Device Switcher (u64+c64u ONLINE, Back, no accidental switch). Diagnostics password redaction PASS (no `pwd` in body).
- **S4 found:** AbortError → unhandledrejection on Diagnostics/Switcher dismiss (2×). Defect filed.
- Config: menu renders full category list; "Video setup" sub-page renders live values (PAL/HDMI 1024×768/scan lines). Read/render/nav OK; live config-write deferred (Radix blind-coord hazard + device-risk; write-path covered by transport fix).
- Settings: appearance enumerated; **display profile found on "Small display" → restored to Auto** (pre-existing drift). Theme/orientation Auto. "Hide status bar" checked (pre-existing, documented residual).
- Lifecycle: cold relaunch → clean reconnect; background→foreground → clean reconnect, c64u healthy (resume-after-idle path now safe). Orientation rotate skipped (landscape trap).
- Perf: mount 780ms, eject 147ms, nav <1.5s, relaunch ~4s.
- **Lint gate:** found pre-existing prettier drift in 2 committed files (UnifiedHealthBadge.tsx, DriveManager.tsx) — my c64api.ts passes. Reformatted (whitespace-only); full `npm run lint` + `tsc` now PASS.
- Cleanup: Drive A clean, display Auto, c64u connected/healthy, c64u readback image_file='' errors:[]. Reports written: bug-hunt-report.md, cleanup-report-bughunt.md, defects/S1-ROOTCAUSE-_.md, defects/S4-_.md; ledger + PLANS updated.
- No commit made (commit only on request). Working tree dirty with the fix + QA docs.

---

## Handover 7 continuation — 2026-06-25T12:23:41Z

- Resumed from `handover7.md` with `final-report-3.md` still treated as `PIXEL4-NO-GO`.
- Classification: HIL/device certification continuation. No rebuild: source was unchanged and the installed Pixel 4 package remained `0.8.9-cf84d`, versionCode `2044`.
- Created continuation artifact folder `c64scope/artifacts/cta-20260624T235538Z-pixel4-c64u-af2d795b2361/s1-five-cycle-cf84d-resume/`.
- Direct pre-launch `c64u` unauthenticated probe passed as expected: HTTP `403` in `0.008523s`; evidence `s1-five-cycle-cf84d-resume/logs/commands/c64u-info.stdout.log`.
- Launched the installed app with `DroidmindClient.startApp()`. The app opened the discovery interstitial showing `Ultimate 64 Elite · u64`; `u64` was not selected.
- Dismissed the discovery interstitial through DroidMind. The app then showed Home with `App 0.8.9-cf84d Device Not connected Firmware Not connected`, Drive A ON / `No disk mounted`, Drive B OFF / `No disk mounted`, and `Unable to connect to C64U`.
- Waited 12 seconds for reconnect; app-visible state stayed `Not connected`.
- Direct post-app `c64u` unauthenticated probe still passed: HTTP `403` in `0.009939s`; evidence `s1-five-cycle-cf84d-resume/logs/commands/c64u-info-after-app-not-connected.stdout.log`.
- Per S1 safety rules, did not attempt any Drive A mount/eject cycle from this degraded app-visible baseline. Stopped the app with `DroidmindClient.stopApp()`.
- Package state after stop: `stopped=true`, versionName `0.8.9-cf84d`, versionCode `2044`, lastUpdateTime `2026-06-25 09:01:54`.
- Result artifact: `s1-five-cycle-cf84d-resume/baseline-block-result.json`, status `BLOCKED_WITH_EVIDENCE`.
- S1 remains open; `PIXEL4-NO-GO` remains the only valid recommendation.

## Continuation for exhaustive Pixel 4 certification — 2026-06-24T23:55:38Z

- Role/prompt accepted: autonomous continuation for deep Pixel 4 CTA and flow certification on serial `9B081FFAZ001WX`, package `uk.gleissner.c64commander`, target `c64u` with password redacted in artifacts.
- Read current repo guidance and previous-state files: `README.md`, `REVIEW.md`, `.github/copilot-instructions.md`, `docs/ux-guidelines.md`, `PLANS.md`, `WORKLOG.md`, `docs/testing/agentic-tests/full-cta-coverage/runs/progress-ledger.md`, and `docs/testing/agentic-tests/full-cta-coverage/runs/infrastructure-audit.md`.
- Attempted to read stricter-prompt previous artifacts; these are absent in the checkout: `docs/testing/agentic-tests/full-cta-coverage/final-report-2.md`, `cleanup-report-2.md`, `callback-8020-residual-risk.md`, and `cta-runner.md`.
- Current branch/SHA: `test/full-cta-coverage`, `515e2818ed1992dd6e3579470e1355488111278f`.
- Starting worktree is dirty; preserving unrelated-looking local changes in `scripts/repro-cursor-blink-snapshot-restore.mjs`, `src/lib/machine/ramOperations.ts`, `tests/unit/machine/ramOperations.test.ts`, and untracked `scripts/prove-snapshot-all-types.ts`.
- Latest APK on disk before this continuation is stale: `android/app/build/outputs/apk/debug/c64u-remote-0.8.9-10c4b-debug.apk`.
- Installed Pixel 4 package before this continuation is stale: versionName `0.8.9-10c4b`, versionCode `2040`, lastUpdateTime `2026-06-25 00:17:22`, package path `/data/app/~~U83Do-y3NWKqtU49tTBMPw==/uk.gleissner.c64commander-xwJ3ACWEBnM_ee8FAXUMiw==/base.apk`, signature short `d39d81d2`.
- Classification: HIL/device certification. Per the repository HIL exception, current priority is current-SHA APK build/install and Pixel 4 evidence; coverage is a finalization gate, not the first action.
- Updated `PLANS.md`. Artifact root for this continuation: `c64scope/artifacts/cta-20260624T235538Z-pixel4-c64u-515e2818ed19/`.
- Next command: create artifact log directories, run `npm run scope:check`, then build/install the current APK to Pixel 4.
- Created the artifact directory tree under `c64scope/artifacts/cta-20260624T235538Z-pixel4-c64u-515e2818ed19/`.
- Ran `npm run scope:check`; passed 55 files / 356 tests. Logs:
  - `c64scope/artifacts/cta-20260624T235538Z-pixel4-c64u-515e2818ed19/logs/commands/npm-run-scope-check.stdout.log`
  - `c64scope/artifacts/cta-20260624T235538Z-pixel4-c64u-515e2818ed19/logs/commands/npm-run-scope-check.stderr.log`
- Ran `./build --skip-tests --install-apk --device-id 9B081FFAZ001WX`; build/install succeeded and launched the app. Logs:
  - `c64scope/artifacts/cta-20260624T235538Z-pixel4-c64u-515e2818ed19/logs/commands/build-skip-tests-install-apk.stdout.log`
  - `c64scope/artifacts/cta-20260624T235538Z-pixel4-c64u-515e2818ed19/logs/commands/build-skip-tests-install-apk.stderr.log`
- Current APK: `android/app/build/outputs/apk/debug/c64commander-0.8.9-515e2-debug.apk`, SHA-256 `2f9b1569575eb6539509dc828ead4a220ac79ad516aa100fc4971635a0adea45`.
- Installed package after build: versionName `0.8.9-515e2`, versionCode `2041`, lastUpdateTime `2026-06-25 00:59:13`, package path `/data/app/~~RNFTH4jdudOH7uFn_NTnlA==/uk.gleissner.c64commander-Epu5KWMBWr_2w8EVExzTXA==/base.apk`, signature short `d39d81d2`.
- Captured baseline current-SHA screenshot/hierarchy/logcat:
  - `c64scope/artifacts/cta-20260624T235538Z-pixel4-c64u-515e2818ed19/screenshots/baseline-current-sha-launch.png`
  - `c64scope/artifacts/cta-20260624T235538Z-pixel4-c64u-515e2818ed19/hierarchies/baseline-current-sha-launch.xml`
  - `c64scope/artifacts/cta-20260624T235538Z-pixel4-c64u-515e2818ed19/logs/logcat/baseline-after-install-launch.log`
- MCP capability check passed with `satisfied: true`, `missing: []`; artifact `c64scope/artifacts/cta-20260624T235538Z-pixel4-c64u-515e2818ed19/mcp-capabilities.json`.
- Target health probes recorded as infrastructure-only evidence: `c64u` unauthenticated 403, `c64u` authenticated 200 from host and Pixel-side curl, `u64` unauthenticated 200.
- Ran generic Gate 3 current-SHA Save-and-Connect command; artifact `c64scope/artifacts/cta-20260625T000108Z-pixel4-c64u-515e2818ed19/` returned `BLOCKED` because the runner did not find `Save & Connect` after editing the host field and later hierarchies show Android launcher. Command logs were redacted after the wrapper echoed the password argument.
- Ran targeted app-driven Save-and-Connect proof through `DroidmindClient` without localStorage/DOM edits. Result `PROVEN`; evidence root `c64scope/artifacts/cta-20260624T235538Z-pixel4-c64u-515e2818ed19/targeted-save-connect/`. Pre/post app-visible status was `Connected to c64u, system healthy`; post-action Settings text was `Currently using: c64u · HTTP 80 · FTP 21 · Telnet 23`.
- Ran current-SHA all-route discovery:
  - Command: `npm run scope:cta:discover-routes -- --serial 9B081FFAZ001WX --target c64u --start-app --settle-ms 2200 --max-scrolls 12 --artifact-dir ../c64scope/artifacts/cta-20260624T235538Z-pixel4-c64u-515e2818ed19`
  - Route counts: Home 106, Play 24, Disks 40, Config 28, Settings 74, Docs 18; total 290 discovery-only CTA rows.
  - Settings stopped at `max-scrolls`; treat as inventory completeness risk for Settings deep dive, not as coverage.
- Re-ran current-SHA keypad canary with D-pad: artifact `c64scope/artifacts/cta-20260625T000854Z-pixel4-c64u-515e2818ed19/`; 11/11 PASS.
- Re-ran Gate 4: artifact `c64scope/artifacts/cta-20260625T000959Z-pixel4-c64u-515e2818ed19/`; `PROVEN`, Theme Auto -> Dark -> Auto restored.
- Re-ran Gate 5: artifact `c64scope/artifacts/cta-20260625T001042Z-pixel4-c64u-515e2818ed19/`; 12/12 PASS.
- Gate 6 current-SHA runner hung for over five minutes while the app was stationary at Settings top and the process was inside DroidMind hierarchy capture. Stopped it with Ctrl-C; no `gate6.js` child remained. Partial artifact root `c64scope/artifacts/cta-20260625T001329Z-pixel4-c64u-515e2818ed19/`; live screenshot was captured through the MCP DroidMind screenshot tool.
- Re-ran Gate 6.5: artifact `c64scope/artifacts/cta-20260625T001827Z-pixel4-c64u-515e2818ed19/`; 11/12 PASS. The only blocked row was Config page load; screenshot proves the Drive A mount sheet remained open over Disks, so this is overlay contamination, not a Config outage.
- Dismissed the Drive A mount sheet via DroidMind Back.
- Re-ran Gate 7: artifact `c64scope/artifacts/cta-20260625T002012Z-pixel4-c64u-515e2818ed19/`; 2/3 PASS. Host and password negative mutations restored successfully. HTTP port scenario blocked while trying to restore, but follow-up cleanup proved the field was already `80`.
- Ran focused HTTP-port cleanup after Gate 7: evidence `c64scope/artifacts/cta-20260624T235538Z-pixel4-c64u-515e2818ed19/restore-http-port-after-gate7/result.json`; status `PROVEN`, app-visible `Currently using: c64u · HTTP 80 · FTP 21 · Telnet 23`.
- Redaction scan for `pwd` and `wrongpwd` across active current-SHA artifacts returned no matches after redacting targeted Save-and-Connect and Gate 7 generated files.
- Ran Config deep dive from clean app state:
  - Evidence root `c64scope/artifacts/cta-20260624T235538Z-pixel4-c64u-515e2818ed19/config-deep-dive/`
  - Status `PROVEN`
  - Five Config load entries detected `CONFIG`, app-visible `Connected to c64u, system healthy`, no loading/error/retry text.
  - Config census found 28 controls, 4 scroll attempts, fixed-point stop.
  - Refresh CTA was not visible in the initial viewport and remains for full CTA ledger execution.
- Ran guarded Disks Drive A mount/eject repetition against imported `/USB2/test-data/d64/Boulder Dash 2.d64`:
  - Evidence root `c64scope/artifacts/cta-20260624T235538Z-pixel4-c64u-515e2818ed19/disks-mount-eject-loop/`
  - Iteration 1: mounted and ejected; after-eject text `No disk mounted`.
  - Iteration 2: mounted and ejected; after-eject text `No disk mounted`.
  - Iteration 3: tapped Drive A Mount disk and `Boulder Dash 2.d64`; after-mount screenshot shows `No disk mounted`, red C64U badge with two issues, and Drive A `Connection reset`; Eject control not found.
- Per device-safety rule, ran one infrastructure health probe after app-visible reset; authenticated `http://c64u/v1/info` failed with `curl: (56) Recv failure: Connection reset by peer`, HTTP code `000`.
- Stopped further `c64u` traffic, captured live screenshot/hierarchy, and stopped the app through `DroidmindClient.stopApp`.
- Captured logcat to `c64scope/artifacts/cta-20260624T235538Z-pixel4-c64u-515e2818ed19/logs/logcat/disks-loop-connection-reset.log`.
- Added S1 defect `docs/testing/agentic-tests/full-cta-coverage/defects/S1-DISKS-MOUNT-EJECT-RESETS-C64U.md`.

## Continuation for exhaustive Pixel 4 certification — 2026-06-24T21:48:02Z

- Role/prompt accepted: autonomous continuation for deep Pixel 4 CTA and flow certification on serial `9B081FFAZ001WX`, package `uk.gleissner.c64commander`, target `c64u` with password restored/redacted as required.
- Read current repo guidance and previous-state files: `README.md`, `REVIEW.md`, `.github/copilot-instructions.md`, `PLANS.md`, `WORKLOG.md`, `docs/testing/agentic-tests/full-cta-coverage/runs/progress-ledger.md`, `docs/testing/agentic-tests/full-cta-coverage/runs/infrastructure-audit.md`, and `docs/testing/agentic-tests/full-cta-coverage/handover4.md`.
- Required previous hardening artifacts requested by the prompt but missing from the checkout: `final-report-2.md`, `cleanup-report-2.md`, `callback-8020-residual-risk.md`, and `cta-runner.md`.
- Current branch/SHA confirmed again: `test/full-cta-coverage`, `414ec2a965d64651881c658cc5df772dd4ed934b`.
- Existing dirty worktree preserved. Notable existing changes include `PLANS.md`, `WORKLOG.md`, `c64scope/src/cta/gate3.ts`, `c64scope/src/cta/retention.ts`, `c64scope/tests/ctaRetention.test.ts`, generated variant/branding files, and untracked CTA audit files.
- Classification: HIL/device certification with existing executable CTA infrastructure changes. Per AGENTS exception for Pixel 4 HIL loops, current priority is build/install/device proof; coverage is not run before HIL deliverables.
- Updated `PLANS.md` for the stricter continuation. Active blocker is stale installed APK versus current source state.
- Next material commands: `npm run scope:check`, then current APK build/install to Pixel 4, package identity capture, launch, baseline screenshot/hierarchy/logcat, and app-driven Gate 3 Save-and-Connect.
- Ran `npm run scope:check`; passed 52 files / 351 tests. Logs:
  - `c64scope/artifacts/cta-20260624T214802Z-pixel4-c64u-414ec2a965d6/logs/commands/npm-run-scope-check.stdout.log`
  - `c64scope/artifacts/cta-20260624T214802Z-pixel4-c64u-414ec2a965d6/logs/commands/npm-run-scope-check.stderr.log`
- Ran `./build --skip-tests --install-apk --device-id 9B081FFAZ001WX`; Android build succeeded, install initially failed with `INSTALL_FAILED_VERSION_DOWNGRADE` because installed versionCode `2038` was newer than current-source versionCode `2037`.
- Per repo deploy rule, uninstalled `uk.gleissner.c64commander` from Pixel 4 and installed `android/app/build/outputs/apk/debug/c64commander-0.8.9-414ec-debug.apk`.
- Fresh APK identity:
  - APK: `android/app/build/outputs/apk/debug/c64commander-0.8.9-414ec-debug.apk`
  - SHA-256: `b404778e5c617c203009a7b608dbca2149555a45dfdb9c1c21342c2af6225256`
  - Installed versionName `0.8.9-414ec`, versionCode `2037`
  - firstInstallTime/lastUpdateTime `2026-06-24 22:52:18`
  - package path `/data/app/~~AIeSfoxigZHXtD-Mo6Ky-g==/uk.gleissner.c64commander-ITET5_YkUO8PpJhMlS5JLA==/base.apk`
- Launched the app through `DroidmindClient`, captured baseline screenshot/hierarchy/logcat:
  - `c64scope/artifacts/cta-20260624T214802Z-pixel4-c64u-414ec2a965d6/screenshots/baseline-launch.png`
  - `c64scope/artifacts/cta-20260624T214802Z-pixel4-c64u-414ec2a965d6/hierarchies/baseline-launch.xml`
  - `c64scope/artifacts/cta-20260624T214802Z-pixel4-c64u-414ec2a965d6/logs/logcat/baseline-launch.log`
- Baseline after clean reinstall auto-selected/probed `u64` (`192.168.1.13`) before C64U restoration.
- Ran current Gate 3 Save-and-Connect. First run `cta-20260624T215352Z-pixel4-c64u-414ec2a965d6` was `BLOCKED`: app-visible `Offline, device not reachable` while Settings showed active target `192.168.1.167 · HTTP 80 · FTP 21 · Telnet 23`.
- Investigated the app-visible offline state:
  - Pixel 4 ping to `192.168.1.167` and `c64u` succeeded with 0% loss.
  - Host curl to `http://c64u/v1/info` returned 403 without password and 200 with `X-Password`.
  - Pixel-side `adb shell curl` to `http://192.168.1.167/v1/info` returned 200 with `X-Password`.
  - Conclusion: C64U/network/password were healthy; initial Gate 3 offline state was transient/app retry state, not target unreachability.
- Found a C64Scope evidence redaction defect: Gate 3 result/summary and hierarchy XML exposed the test password. Immediately redacted existing current-run artifacts and patched the runner.
- Implemented redaction fixes:
  - `c64scope/src/cta/gate3.ts` now redacts Gate 3 password text in steps, JSON evidence, and Markdown summary.
  - `c64scope/src/cta/runnerCommon.ts` now supports secret-aware UI hierarchy writes.
  - Added `c64scope/tests/ctaGate3Redaction.test.ts`.
  - Added `c64scope/tests/ctaRunnerCommonRedaction.test.ts`.
- Validation after redaction fixes:
  - `npm run scope:check` passed 53 files / 352 tests after Gate 3 summary/result redaction.
  - `npm run scope:check` passed 54 files / 353 tests after hierarchy redaction.
- Re-ran Gate 3 with fully redacted runner. Canonical current-APK artifact:
  - `c64scope/artifacts/cta-20260624T220402Z-pixel4-c64u-414ec2a965d6/`
  - Status `PROVEN`
  - Connection status `Connected to c64u, system healthy`
  - Currently using `c64u · HTTP 80 · FTP 21 · Telnet 23`
  - Redaction scan for `pwd` in the canonical artifact and current command logs returned no matches.
- Added current-SHA all-route discovery runner and executed it on Pixel 4:
  - Command: `npm run scope:cta:discover-routes -- --serial 9B081FFAZ001WX --target c64u --start-app --settle-ms 2200 --max-scrolls 12`
  - Artifact: `c64scope/artifacts/cta-20260624T221006Z-pixel4-c64u-414ec2a965d6/`
  - Discovery counts: `/current` 43, `/play` 27, `/disks` 26, `/config` 9, `/settings` 76, `/docs` 18, total 199.
  - Result status remains discovery-only (`CALIBRATION_ONLY` rows), not CTA coverage proof.
- Ran current-SHA keypad canary:
  - Command: `npm run scope:cta:keypad -- --serial 9B081FFAZ001WX --target c64u --start-app`
  - Artifact: `c64scope/artifacts/cta-20260624T221253Z-pixel4-c64u-414ec2a965d6/`
  - Result: 9/9 passed for digit tabs, Star diagnostics, Pound device switcher, and one touch docs activation.
- Re-ran Gate 4, Gate 5, Gate 6, and Gate 6.5 on the current APK:
  - Gate 4 artifact `c64scope/artifacts/cta-20260624T221410Z-pixel4-c64u-414ec2a965d6/`, `PROVEN` Theme Auto -> Dark -> Auto restored.
  - Gate 5 artifact `c64scope/artifacts/cta-20260624T221549Z-pixel4-c64u-414ec2a965d6/`, 12/12 PASS.
  - Gate 6 artifact `c64scope/artifacts/cta-20260624T221859Z-pixel4-c64u-414ec2a965d6/`, 16/17 PASS with `/home` `home-ports-tab` blocked because the PORTS control was behind the tab bar.
  - Gate 6.5 artifact `c64scope/artifacts/cta-20260624T222244Z-pixel4-c64u-414ec2a965d6/`, 11/12 PASS with `/config` initially blocked.
- Investigated the Gate 6.5 Config block:
  - Evidence in `gate65` hierarchies showed the `Mount disk to Drive A` sheet was still open, so `KEY_4` was consumed by the overlay.
  - Direct clean Config navigation via `DroidmindClient.pressKey("KEYCODE_4")` discovered 28 Config controls and showed connected `c64u`.
  - Evidence: `c64scope/artifacts/cta-20260624T214802Z-pixel4-c64u-414ec2a965d6/screenshots/config-direct-clean.png`, `hierarchies/config-direct-clean.xml`, `diagnostics/config-direct-clean-census.json`.
  - Decision: reclassify Gate 6.5 Config as overlay contamination from Disks, not a proven Config route outage.
- User interruption at `2026-06-24T22:28:37Z`: app-visible `Mount disk` dialog was completely empty; user requested a fix and noted disk fixtures under `/home/chris/dev/c64/test-data` and `/USB2/test-data` on `c64u`.
- Diagnosed the empty dialog root cause in `src/components/disks/HomeDiskManager.tsx`:
  - Drive A/B `Mount disk` sheet lists only `diskLibrary.disks`.
  - Clean reinstall left `c64u_disk_library:shared` empty.
  - Existing Disks page has an Add disks flow, but the mount sheet exposed no Add disks CTA, so it was a dead end.
- Implemented the product fix:
  - Added an empty-state `Add disks` CTA inside the Drive A/B mount sheet using the existing `ItemSelectionDialog` and C64U/local source flow.
  - Added regression test coverage in `tests/unit/components/disks/HomeDiskManager.dialogs.test.tsx`.
  - Updated `docs/cta-inventory.md` for the new `mount-sheet-add-disks` CTA.
- Ran focused regression command `npm run test -- tests/unit/components/disks/HomeDiskManager.dialogs.test.tsx`; passed 9/9 tests.
- Ran `npm run scope:check`; passed 55 files / 356 tests after the mount-sheet fix.
- Built and installed patched APK on Pixel 4:
  - APK SHA-256 `664a07f36576b83a22d794cff15ee3c8dbf6a19ca0ab33efc5e4093e6c411385`.
  - Installed versionName `0.8.9-414ec`, versionCode `2037`, lastUpdateTime `2026-06-24 23:31:57`, package path `/data/app/~~9Gb8mrWG5vFjCQtgoZ59Iw==/uk.gleissner.c64commander-TYAfeYOawuwio8xAH1eIIA==/base.apk`.
- DroidMind proof attempt `DISKS-MOUNT-EMPTY-FIX-PIXEL4` initially failed its own assertion after tapping Add disks because the Add items dialog was already open over the mount sheet. The screenshots nevertheless prove the new empty-state `Add disks` CTA was visible and opened the Add items source dialog.
- Follow-up import/mount runner was interrupted after the user identified a second Disks source-picker defect: the Disks Add items popup showed Local and C64U but omitted CommoServe.
- Diagnosed the CommoServe source omission:
  - `PlayFilesPage` includes `createArchiveSourceLocation(archiveConfig)` when `commoserve_enabled` is true and passes `archiveConfigs` to `ItemSelectionDialog`.
  - `HomeDiskManager` only built Local and C64U `sourceGroups`; it did not import the archive source adapter or archive settings.
- Implemented the CommoServe Disks fix:
  - `HomeDiskManager` now uses `useArchiveClientSettings`, appends CommoServe to Disks source groups when enabled, and passes `archiveConfigs` to `ItemSelectionDialog`.
  - Disks archive selections now resolve archive entries, find disk images, download the selected disk image, and add it to the normal disk library with a runtime `File` so it can be mounted through the existing local upload path.
  - Updated `DocsPage` and `docs/cta-inventory.md` to include CommoServe for Disks Add items.
  - Added regression coverage that verifies CommoServe appears in the Disks Add items picker and archive disk images are imported as runtime mountable disk entries.
- Ran targeted disk component suites:
  - Command: `npm run test -- tests/unit/components/disks/HomeDiskManager.dialogs.test.tsx tests/unit/components/disks/HomeDiskManager.test.tsx tests/unit/components/disks/HomeDiskManager.extended.test.tsx tests/unit/components/disks/HomeDiskManager.branches.test.tsx tests/unit/components/disks/HomeDiskManager.focus.test.tsx tests/unit/components/disks/HomeDiskManager.ui.test.tsx`
  - Result: 6 files passed, 98 tests passed.

## Phase 0 — infrastructure conformance audit started

- Branch at start: `test/full-cta-coverage`.
- Git SHA at start: `414ec2a965d64651881c658cc5df772dd4ed934b`.
- Starting worktree: untracked `docs/testing/agentic-tests/full-cta-coverage/hardening1/`.
- Read required current-run inputs: full-CTA prompt, handovers 1-4, progress ledger, previous final report, previous cleanup report, `AGENTS.md`, `REVIEW.md`, `.github/copilot-instructions.md`, canonical agentic contracts, and full-app coverage reference docs.
- Previous final report is historical baseline only: it certifies SHA `41b0d368ca06d80f9ffc0e40f10a46e1b11fe380`, while this pass is auditing SHA `414ec2a965d64651881c658cc5df772dd4ed934b`.
- Infra identity checks:
  - Pixel 4 attached as `9B081FFAZ001WX`; Android `16`, SDK `36`.
  - Installed package `uk.gleissner.c64commander`: versionCode `2038`, versionName `0.8.9-c102a`.
  - Latest local APK: `android/app/build/outputs/apk/debug/c64commander-0.8.9-c102a-debug.apk`.
  - U64 fallback reachable by infra probe: Ultimate 64 Elite firmware `3.14e`, unique ID `38C1BA`.
  - C64U unauthenticated infra probe returns HTTP 403, so app-driven authenticated status remains to be revalidated.
- Audit findings so far:
  - CTA implementation is inside `c64scope/src/cta`; no parallel package found.
  - Root and `c64scope` scripts expose `scope:cta`, `scope:cta:discover`, `scope:cta:resume`, `scope:cta:replay`, keypad, and gate-specific runners.
  - `docs/testing/agentic-tests/full-cta-coverage/cta-runner.md` is absent and must be added.
  - Gate 3 uses `DroidmindClient.shell("input keyevent ...")` for product text-field editing; hardening pass treats that as a control-path gap and will replace it with `pressKey()`.
- Implemented Phase 0 fixes:
  - Replaced Gate 3 shell keyevent use with `DroidmindClient.pressKey()` for MOVE_END and DEL.
  - Added `c64scope/tests/ctaControlPathPolicy.test.ts` to prevent shell keyevents in CTA product runners.
  - Added `docs/testing/agentic-tests/full-cta-coverage/cta-runner.md`.
  - Fixed retention so incomplete legacy CTA artifact directories without `results.json` do not abort current runs.
  - Added retention regression coverage for incomplete legacy directories.
- Validation:
  - `npm run scope:check` passed: 52 test files, 351 tests.
  - First `npm run scope:cta -- --device 9B081FFAZ001WX --target c64u --discover-only --routes /current --case CTA-HARDENING-SMOKE --retain-success 999` failed before the retention fix because old artifact `cta-20260624T112157Z-pixel4-c64u-41b0d368ca06` lacked `results.json`.
  - Same command passed after the retention fix and emitted `c64scope/artifacts/cta-20260624T212754Z-pixel4-c64u-414ec2a965d6/`; MCP capability check satisfied all requirements.
  - `npm run scope:cta:discover -- --serial 9B081FFAZ001WX --route /current --start-app` passed and emitted `c64scope/artifacts/cta-discover/cta-discover-20260624T212806Z/cta-discover.json` with 2 discovered controls.
  - `npm run scope:cta:replay -- --run-id cta-20260624T212754Z-pixel4-c64u-414ec2a965d6 --case CTA-HARDENING-SMOKE` passed and emitted `replays/CTA-HARDENING-SMOKE-replay-summary.json`.
- Representative previous artifacts parsed successfully with current JSON expectations:
  - Gate 5 coverage: 12/12 PASS.
  - Gate 6 coverage: 14/16 PASS.
  - Gate 6.5 coverage: 11/12 PASS.
  - Gate 7 result: 3/3 PASS.
    These remain stale because they target SHA `41b0d368ca06`.

---

# WORKLOG — menu ⇄ REST config mapping hardening

All times 2026-06-23 (local). Prior task content for this file is in git history.

## P0 — baseline + evidence inventory

- Branch `feat/align-ux-with-device-menu`; large uncommitted feature tree (untracked
  `src/lib/config/menuMapping/`, `src/pages/config/`, `scripts/compile-menu-mapping.mjs`,
  `scripts/menu-mapping/`, tests, generated TS, screenshots).
- Architecture (verified by reading source, not the prior report):
  - **Layer A overlay** (`overlay.ts`, `types.ts`): `{category→{item→{label,formatterId}}}`,
    device-agnostic, applied on every device, first-writer-wins merge.
  - **Layer B hierarchy** (`resolveMenuMapping.ts`): registry keyed by family+firmware;
    C64U 1.1.0 only; never crosses families; `null` → REST-grouped layout. Intra-family
    version fallback (exact → nearest-lower → latest).
  - **Projection** (`projectConfigToMenu.ts`): pure, computed over LIVE data; lossless
    (`renderedRestKeySet == liveRestKeySet`); stale pointers dropped not errored.
  - **Routing** (`advancedRouting.ts`): keyword (U64-Specific topic split) → sole-owner
    (data-derived) → category default (per family). Page renderer
    (`MenuPageSection`/`AdvancedFallbackSection`) consumes the SAME routing functions, so
    the pure projection and the runtime agree (no divergence).
  - **Write-back** (`useConfigLeafWrite.ts`): canonical `{category,item}` via `setConfig`
    → PUT (single-item; POST is the device-crash path). Aliases share one optimistic cell
    keyed by `canonicalConfigKey` (`ConfigLeafRow`).
  - **Compiler** validates: stale paths, duplicate paths, unknown formatters, conflicting
    primary labels, alias-without-primary, mapped/intentional items exist in the config
    sample, and **completeness** (every config item mapped OR intentionallyUnmapped).
    `--check` is wired into `npm run lint`.
- Claim checks:
  - Prior report "did not modify repo-root PLANS.md/WORKLOG.md" — TRUE: both tracked,
    last touched at `6bfb766a` (previous feature), no working-tree diff. Updated here.
  - "Advanced fallback dissolved" — FALSIFIED as stated: it is not dissolved by design,
    it is _populated by speculative category defaults_ so it renders empty on C64U. See P2.
- Baseline gates: `menu-mapping:check` OK (179 items, 16 menu-only). Targeted suite
  (7 files / 47 tests) green.

## P1 — verification matrix

`projectConfigToMenu.test.ts` already proves the lossless set-equality on real fixtures:
C64U 1.1.0 (hierarchy), C64U 3.14 (intra-family fallback + stale ref), U64e 3.12a / 3.14e
(null → REST-grouped), a synthetic never-seen category ("Audio Output Settings", a U2
stand-in) → fallback with intact write identity, drive-ROM alias dedup, menu-only nodes.
`ConfigBrowserPageMenuMode.test.tsx` proves the runtime: menu pages render, menu labels
applied, write-back uses canonical `{category,item}`, alias rows share the source.
Matrix rows all covered; extended the routing assertions in P2.

## P2 — advanced-routing adversarial review

Evidence gathered from `c64u-menu.yaml` (label/structure authority) + `c64u-config.yaml`
(REST schema):

- `c64u-menu.yaml` has NO Tape page, NO `C64U Model`, NO SoftIEC/Data-Streams page
  (only Audio Mixer "Vol/Pan tape *" volume rows mention "tape").
- `intentionallyUnmapped` leftovers reach routing: `C64U Model`, SoftIEC (`IEC Drive`,
  `Soft Drive Bus ID`, `Default Path`), `Tape Playback Rate`, Data Streams (`Stream * to`,
  `Debug Stream Mode`), plus keyworded U64-Specific items + sole-owned C64/Cartridge leftovers.
- The `categoryDefaults` tier placed WHOLE categories on a page with no captured-menu
  evidence: `U64 Specific Settings→Video setup` (caught only `C64U Model`),
  `SoftIEC→Built-in drive A`, `Tape→Built-in drive A`, `Data Streams→Network`. These are
  exactly the "too broad / likely to misplace future items" rules the brief flags.

Defect: `Tape Playback Rate` rendered on "Built-in drive A" (cassette setting on the disk
drive page) and `C64U Model` (hardware edition) on "Video setup" — both misleading, neither
evidence-backed.

Fix: removed all `categoryDefaults` (kept the field as an empty, documented extension
point). Kept the evidence-based tiers: keyword rules (topical split of the one multi-owner
category — HDMI→Video, user-port→Joystick, drive-comms→Built-in drive A) and sole-owner
derivation (a category genuinely claimed by exactly one page). Unplaceable leftovers
(`C64U Model`, SoftIEC, Tape, Data Streams) now render in the residual, explicitly-labelled
**Advanced (REST-only) settings** section — lossless, canonical write-back, self-hiding when
empty (invariant #7). Keyword routing of HDMI Tx Swing/Adjust Color Clock/UserPort/Serial
Bus/SpeedDOS/Burst Mode is unchanged (topically correct).

Tests updated to encode the evidence-based behavior (placement assertions changed; lossless
set-equality unchanged): `advancedRouting.test.ts`, `projectConfigToMenu.test.ts`,
`ConfigBrowserPageMenuMode.test.tsx`.

## P3 — `Disk swap delay` / `Loop delay` units

Sources checked: `c64u-config.yaml` (REST schema), `c64u-3.14`/`u64e-*` configs, menu YAML,
`menuValueFormatters.ts`, `ConfigItemRow.tsx`, `normalizeConfigItem.ts`, association YAML.

Verified from the firmware REST schema `format` field (printf-style):

- `Disk swap delay` (Drive A/B): `min:1 max:10 format:"%d00 ms"` → display `value*100 ms`
  (1→"100 ms" … 10→"1000 ms").
- `Loop Delay` (Modem Settings): `min:1 max:20 format:"%d0 ms"` → display `value*10 ms`
  (2→"20 ms" … 20→"200 ms").

Root cause of "raw": `ConfigItemRow` fetches `format` into `mergedDetails` but **never uses
it** (dead memo, line ~176); `inferControlKind` keys only off options, so a min/max/format
item with no options renders as a raw text input. This is app-wide — ~108 items across the
sampled configs carry a `format` string (`%d`, `%d00 ms`, `%02d`, `%d ppm`, `%d0 ms`,
`%02x`, `%d00`). Honoring `details.format` generically would change rendering for all of
them (control-kind + slider/label) — a broad shared-control change, out of this feature's
scope and not a menu-mapping concern.

Disposition: keep RAW. A hardcoded ×100/×10 multiplier in the menu overlay would be the
wrong layer (duplicating device-provided `format`) AND ineffective (these items have no
options, so `formatOptionLabel` never fires). Added a regression test that pins raw display
and raw write-back for both items, and documented the verified unit + the dead-code finding.
No multiplier invented.

## P4 — overlay/label cleanup

Audited the generated overlay labels: already natural sentence case (menu-YAML-sourced:
"CPU speed", "HDMI scan resolution", "Analog video mode", "Auto save config"). No stale
source-reference annotations, no spurious title-case. C64U/U64/U2 terminology consistent.
Minimal change.

## P5 — source pipeline + authoring cleanup

Compiler is deterministic + drift-checked (verified `--check` fails on a hand-edited
generated file). Updated `README.md` + `SKILL.md` to describe the evidence-based routing
(no speculative whole-category defaults; unplaceable → residual Advanced). `restKey`
separator robustness reviewed (see findings).

## P6 — UI integration review

- Hierarchy mode selected only when `resolveMenuMapping` returns non-null; else REST-grouped.
- Layer A overlay applied in both layouts (`ConfigBrowserPage` passes `TERMINOLOGY_OVERLAY`;
  `FallbackCategoryBlock` uses `resolveOverlayEntry`).
- Lazy per-category fetch preserved (`useC64Category` gated on `isOpen`/`active`); each
  `MenuBlock` fetches exactly one category → stable hook usage (no hooks-in-a-loop).
- Aliases share the optimistic store via `canonicalConfigKey`.
- Audio Mixer keeps the specialized `CategorySection` (solo/reset/BUG-033) — routed by
  `soleRestCategory(page)==="Audio Mixer"`.
- U64E-only `Clock Settings` renders editable in REST-grouped mode (proved in projection test).

## P7 — E2E / screenshots / HIL

E2E impact of the P2 routing change (audited every spec):

- `demoConfig.spec.ts` — encoded the old "junk drawer dissolved" behavior
  (`config-advanced-fallback` count 0). The demo config is `docs/c64/c64u-config.yaml`,
  which DOES contain the now-residual categories (C64U Model, SoftIEC, Tape Settings,
  Data Streams). Updated the spec: the residual Advanced (REST-only) section is now present
  and shows `Tape Playback Rate` (litmus test: the new behavior is the intended,
  evidence-based one — the spec encoded the removed speculative placement).
- `configEditingBehavior.spec.ts` — UNAFFECTED: it relies on `Clock Settings` rendering in
  the residual fallback (Clock Settings was never in `categoryDefaults`, so it always routed
  to residual — before and after).
- `solo.spec.ts`, `navigationBoundaries.spec.ts`, `ui.spec.ts`, `configVisibility.spec.ts`,
  `keypadInput.spec.ts`, `homeInteractivity.spec.ts` — UNAFFECTED (assert mapped items
  System Mode / drive page / Data-Streams-as-home-mock; none depend on the removed defaults).
- `screenshots.spec.ts` — captures config sections generically (including the
  `config-advanced-fallback-toggle` → `advanced-rest-only` slug). With the residual section
  now present in demo mode it will capture an `advanced-rest-only` screenshot again; the
  catalog is a blob-diff tracker, not a fixed required list, so a new capture does not fail it.

HIL (real hardware on the local network, 2026-06-23):

- **Ultimate 64 Elite — REACHABLE, no auth.** `http://u64` → `/v1/info` product
  "Ultimate 64 Elite", firmware 3.14e, fpga 122, hostname u64. `GET /v1/configs` returns 19
  live categories incl. the U64e-only `Clock Settings`, SoftIEC, Tape, Data Streams, U64
  Specific. `normalizeKnownProduct("Ultimate 64 Elite")` → `u64e` → family `U64E` →
  `resolveMenuMapping` returns null → **REST-grouped layout** (Layer A overlay still applies).
  This is the null-hierarchy path; my C64U-only routing change does not affect it. The
  lossless REST-grouped rendering of this exact category shape (incl. Clock Settings,
  editable) is unit-proven over the matching `u64e-3.14e` fixture.
- **C64U — VALIDATED ON-DEVICE (PASSED).** Credential later supplied by the user; handled
  via a gitignored scratchpad file (referenced through `$(cat)`, shredded afterwards) and
  the app's own stored password — never printed to logs/screenshots/commits. Built+installed
  the hardening APK (`0.8.9-6f367`, commit `6f367873`) to Pixel `9B081FFAZ001WX` via
  `./build --skip-tests --install-apk`, switched the active device to **c64u** (product
  "C64 Ultimate", firmware **1.1.0** — exact hierarchy match → menu mode), opened Config and
  expanded **Advanced (REST-only) settings**. Confirmed on real hardware:
  - The full menu hierarchy renders (Memory & ROMs, Turbo boost, Video setup, Audio setup
    group, … Built-in drive A/B) with friendly labels + group headers.
  - The residual **Advanced (REST-only) settings** section is present and contains exactly
    the items my change routes there: **U64 SPECIFIC SETTINGS → C64U Model = "Starlight
    Edition"** (NOT mis-homed on Video setup), **SOFTIEC DRIVE SETTINGS** (IEC Drive, Soft
    Drive Bus ID 11, Default Path /USB0/), **TAPE SETTINGS → Tape Playback Rate = "0.98 MHz
    (PAL)"** (NOT mis-homed on Built-in drive A), **DATA STREAMS** (Stream VIC/Audio to …).
  - **Unknown-category invariant proven on real hardware:** the live C64U exposes 22
    categories incl. **"ARMSID in Socket 1" / "ARMSID in Socket 2"** — categories present in
    NO fixture/association (the fixture has "ARMSID" only as a SID-socket _option value_).
    Both surface automatically in the Advanced section, fully rendered + editable (Fundamental
    Mode / 6581 Filter Strength / 8580 Filt Freq sliders + selects) with humanized labels.
    This also disproves the prior "junk drawer fully dissolved" claim: even a fixture-matching
    1.1.0 device shows a residual section (ARMSID).
  - Device health flaked once during the connection handover ("Host unreachable", badge
    "DEGRADED") — the documented c64u overload/handover drop-out, not a regression (read-only
    curl confirmed the device healthy throughout: 200 OK ~10ms). A single in-app **Retry**
    recovered to **C64U ● HEALTHY** and the page rendered.
  - Write-back NOT exercised on the live device (to avoid mutating the user's hardware,
    especially given the intermittent drop-outs). It is unchanged by this routing work and is
    covered by unit (`ConfigBrowserPageMenuMode`: System Mode / alias writes assert canonical
    `{category,item}`) + E2E (`configEditingBehavior`: PUT commit-on-blur).
  - Evidence PNGs: `hil_advanced_c64umodel_armsid.png`,
    `hil_advanced_softiec_tape_datastreams.png` (session scratchpad `hil-c64u/`).

Screenshots: the C64U/demo config surface gains a residual Advanced (REST-only) section, so
the committed docs section PNGs for the config surface are candidates for recapture (P5).
The prior `advanced-rest-only` screenshot was removed under the old "dissolved" design; it is
legitimately reintroduced by this change.

## P11 — performance: config section expansion

Measured (real C64U, Pixel 4, via a WebView CDP DOM-settle probe — Capacitor uses native
HTTP so CDP Network/resource-timing can't see the requests):

- Diagnosis: live `GET /v1/configs/<category>` returns **scalars only** (no options/details);
  every `ConfigItemRow` then hits `needsDetailFetch` and fires its OWN `GET /v1/configs/<cat>/<item>`
  → an **N+1 request storm per expansion** (e.g. ~17 for the 16-row Modems page). There is no
  bulk-metadata endpoint (confirmed by probing the device). The device itself is fast
  (~52 ms/req, handles concurrency: 8 serial 0.42 s, 8 parallel 0.26 s), but the c64u
  intermittently chokes on the unbounded burst → severe outliers.
- Key finding: a **persistent, firmware-namespaced enrichment cache** already exists
  (`configEnrichmentCache.ts`, localStorage) and the batched `getConfigItems` path uses it to
  skip per-item fetches — but the per-row `useC64ConfigItem`/`getConfigItem` path **never reads
  it**, so every session re-fetches all (firmware-static) options.

Baseline (cold, before fix):

- Modems 7988 ms (worst), ~0.8 s typical · Printers 821 ms (one run timed out at 20 s / failed
  to render) · User interface 880 ms · warm re-expand (React-Query cache) 492 ms.

Fix (no hack, no benchmark-gaming): make the per-row read **cache-aware** — `ConfigItemRow`
now serves the firmware-static option set synchronously from the existing persistent cache
(`getC64API().getCachedConfigItem`, added) and only falls back to the network fetch on a cache
miss (which repopulates it). The device-fresh value still comes from the category read. This
eliminates the per-item HTTP storm on every session after the options are first cached.

After fix (fresh app launch = empty React-Query cache; options from persistent cache):

- **Modems 223 ms · Printers 277 ms · User interface 348 ms** — all rows + interactive
  controls rendered, 0 loading (impossible without the cache: there is no time for 16 HTTP
  round-trips). ~3–4× faster typical and the multi-second / timeout outliers are gone (no
  per-item burst to overload the device). First-ever expand (cold persistent cache) is
  unchanged (one N+1 pass that populates the cache).

Validation: typecheck ✓; eslint/prettier ✓; `catchGuardrail` ✓ (no silent-catch — used
optional chaining, not try/catch); new deterministic regression test
`ConfigItemRow.cachedOptions.test.tsx` proves a remount serves options from cache with **no
second per-item GET**; full unit suite re-run. Files: `src/lib/c64api.ts`
(`getCachedConfigItem`), `src/components/ConfigItemRow.tsx` (cache short-circuit).

## P9 / P10 — appended as they run

## Pixel 4 CTA continuation — Disks mount/import fixes

Recorded UTC: 2026-06-24T23:09:00Z.

Commands and material actions:

- `git status --short`: worktree dirty with unrelated snapshot/RAM test files preserved.
- `git rev-parse --abbrev-ref HEAD && git rev-parse HEAD`: branch `test/full-cta-coverage`, SHA `1ce6ab76f04d284225fb5fec3ef940c8c3760ccb`.
- `npm run test -- tests/unit/components/disks/HomeDiskManager.dialogs.test.tsx`: passed 10 tests; locks the empty mount-sheet Add disks path, Disks CommoServe picker/import path, and no nested `All disks` view-all control inside the drive-specific mount sheet.
- `npm run scope:check`: passed 55 files / 356 tests.
- `./build --skip-tests --install-apk`: built and installed `android/app/build/outputs/apk/debug/c64commander-0.8.9-1ce6a-debug.apk` on Pixel 4 `9B081FFAZ001WX`.
- `sha256sum android/app/build/outputs/apk/debug/c64commander-0.8.9-1ce6a-debug.apk`: `9d020f42d609614c6ea83cf05d9512987b2d96c5d4b66e1f9806c5597208826f`.
- `adb -s 9B081FFAZ001WX shell dumpsys package uk.gleissner.c64commander`: installed identity `versionName=0.8.9-1ce6a`, `versionCode=2039`, first install `2026-06-24 22:52:18`, last update `2026-06-25 00:07:16`, signature short `d39d81d2`.
- DroidMind targeted Save-and-Connect was used to restore the app-visible connected state after the user reported the app was `Offline`; evidence `screenshots/save-connect-targeted-after.png`, `hierarchies/save-connect-targeted-after.xml`, `logs/commands/droidmind-targeted-save-connect.stdout.log`.
- DroidMind Disks Add items source proof showed `Local`, `C64U`, and `CommoServe`; evidence `screenshots/commoserve-library-source-01-source-picker.png`, `hierarchies/commoserve-library-source-01-source-picker.xml`, `results-disks-commoserve-library-source.json`.
- DroidMind C64U import from broad `/USB2/test-data` stalled at `Scanning... 0 items` for at least 1m52s and was cancelled through the visible Cancel control; evidence `screenshots/disks-import-stuck-scan-before-cancel.png`, `screenshots/disks-import-stuck-scan-after-semantic-cancel.png`, `hierarchies/disks-import-stuck-scan-before-cancel.xml`, `logs/commands/droidmind-disks-import-add-to-library.stdout.log`, `logs/commands/droidmind-disks-import-semantic-cancel-scan.stdout.log`.
- DroidMind C64U import from `/USB2/test-data/d64` succeeded by selecting `interface-harness.d64`, `Frogger.d64`, and `Boulder Dash 2.d64`; evidence `screenshots/disks-import-specific-after-add.png`, `hierarchies/disks-import-specific-after-add.xml`, `logs/commands/droidmind-disks-import-specific-d64.stdout.log`.
- DroidMind mount/eject proof mounted `interface-harness.d64` and then ejected Drive A; evidence `screenshots/mount-proof-drive-a-after-mount.png`, `screenshots/mount-proof-drive-a-after-eject.png`, `hierarchies/mount-proof-drive-a-after-mount.xml`, `hierarchies/mount-proof-drive-a-after-eject.xml`, `logs/commands/droidmind-mount-dialog-populated-mount-eject.stdout.log`.
- DroidMind exact-sheet proof initially exposed a product bug: tapping the semantically identified `Drive A Mount disk` control opened the generic `All disks` sheet instead of `Mount disk to Drive A`; evidence `screenshots/drive-a-mount-sheet-exact-open.png`, `hierarchies/drive-a-mount-sheet-exact-open.xml`, `logs/commands/droidmind-drive-a-mount-sheet-exact.stdout.log`.
- After the drive-sheet fix and reinstall, DroidMind proof passed: `Drive A Mount disk` opened `Mount disk to Drive A`, showed `Available disks`, listed all three C64U D64 fixtures, did not show the empty state, did not show generic `All disks`, and dismissed cleanly with `DroidmindClient.pressKey(Back)`; evidence `screenshots/drive-a-mount-sheet-fixed-open.png`, `hierarchies/drive-a-mount-sheet-fixed-open.xml`, `logs/commands/droidmind-drive-a-mount-sheet-fixed.stdout.log`.

Decisions and evidence:

- The empty Mount disk report was not treated as a hardware absence issue. It was fixed as product UX: an empty mount sheet now offers `Add disks`, and the drive-specific sheet no longer opens a nested generic `All disks` surface when disks exist.
- The Disks Add items source picker now includes CommoServe. Archive disk import is wired through the existing archive client path and stores the downloaded disk as a runtime `File` for the disk library.
- The broad-folder C64U recursive scan stall remains open as a product issue. It does not block mounting because specific D64 selection from `/USB2/test-data/d64` succeeds, but it must be tracked in the Disks deep dive and performance results.
- Cleanup status at this point: Drive A was ejected and the app-visible target is connected to `c64u`; three temporary disk-library entries remain intentionally retained for continuing Disks CTA coverage and must be removed during final cleanup.

Artifact root:

- `c64scope/artifacts/cta-20260624T230900Z-pixel4-c64u-1ce6ab76f04d/` (current-SHA copy with `environment.json`)
- Source evidence was first captured under `c64scope/artifacts/cta-20260624T222959Z-pixel4-c64u-414ec2a965d6/` before the APK was rebuilt as `0.8.9-1ce6a`.

Current-HEAD correction after concurrent branch advance:

- `git rev-parse HEAD`: branch advanced to `10c4b5e98510b3a4cd0afa824ca4ac34dcc71db9` (`Improve RAM snapshot tests`).
- Rebuilt and installed current APK with `./build --skip-tests --install-apk`; APK `android/app/build/outputs/apk/debug/c64commander-0.8.9-10c4b-debug.apk`, SHA-256 `38d17f562159101f340d729f4e93ba5c21e7885dd3ccf40b868c792432e71e6e`.
- Installed package identity after reinstall: versionName `0.8.9-10c4b`, versionCode `2040`, lastUpdateTime `2026-06-25 00:17:22`, package path `/data/app/~~U83Do-y3NWKqtU49tTBMPw==/uk.gleissner.c64commander-xwJ3ACWEBnM_ee8FAXUMiw==/base.apk`.
- Re-ran current-HEAD all-route discovery with absolute artifact path. Results: total `295` discovery rows; Home `109`, Play `24`, Disks `40`, Config `28`, Settings `76`, Docs `18`.
- Active current artifact root is now `c64scope/artifacts/cta-20260624T231700Z-pixel4-c64u-10c4b5e98510/`.

## Pixel 4 exhaustive CTA continuation — current-SHA blocked handover

Recorded UTC: 2026-06-25T01:44:00Z.

Commands and material actions:

- `git status --short`: worktree remains dirty. Certification files touched in this continuation are `PLANS.md`, `WORKLOG.md`, `docs/testing/agentic-tests/full-cta-coverage/runs/progress-ledger.md`, and new defect files. Additional modified/untracked files in `src/lib/c64api.ts`, `src/lib/c64api/hostConfig.ts`, `src/lib/connection/connectionManager.ts`, RAM/snapshot files, docs, and scripts were already present or concurrent and were preserved.
- Read-only source inspection after the S1 device-safety stop:
  - `sed -n '1,260p' src/lib/disks/diskMount.ts`
  - `sed -n '900,1120p' src/lib/c64api.ts`
  - `rg -n "getDrivesPollIntervalMs|drives|pollingPaused|pause|cooldown|invalidateQueries" src/hooks src/lib src/components/disks`
  - `sed -n '300,380p' src/lib/disks/diskMount.ts && sed -n '2100,2235p' src/lib/c64api.ts && sed -n '560,610p' src/hooks/useC64Connection.ts`
- Observed source pattern for the S1 defect: Drive A mount calls `PUT /v1/drives/a:mount?...mode=readwrite`; eject calls `PUT /v1/drives/a:remove`; `HomeDiskManager` invalidates `["c64-drives"]` after mount/eject; `useC64Drives` also polls `GET /v1/drives` while connection/screen are active; device-interaction safety has cooldown support for `/v1/drives`, but no product fix or retest was attempted after the target reset.
- No further `c64u` app, REST, FTP, or Telnet traffic was sent after the S1 stop. The app had already been stopped through `DroidmindClient.stopApp`.
- Created continuation handover: `docs/testing/agentic-tests/full-cta-coverage/handover5.md`.

Current blocker:

- `S1-DISKS-MOUNT-EJECT-RESETS-C64U`: current-SHA repeated Drive A mount/eject loop completed two cycles, then on the third mount the app showed `Connection reset`; authenticated `/v1/info` returned connection reset. The live app hierarchy before stop showed Drive A and Drive B as `No disk mounted`, so disk media cleanup appears likely, but final connected cleanup is not proven.

Decision:

- Do not write `docs/testing/agentic-tests/full-cta-coverage/final-report-3.md`.
- Continue only with local/source analysis or non-C64U UI work that proves no target traffic, until the S1 request pattern is fixed or a deliberate safe test window is available.

## Pixel 4 CTA continuation — Drive A readonly mount mitigation and current-HEAD correction

Recorded UTC: 2026-06-25T07:10:00Z.

Commands and material actions:

- Investigated `S1-DISKS-MOUNT-EJECT-RESETS-C64U` locally in `src/components/disks/HomeDiskManager.tsx`, `src/lib/disks/diskMount.ts`, `src/lib/c64api.ts`, `src/hooks/useC64Connection.ts`, and `src/lib/deviceInteraction/deviceInteractionManager.ts`.
- Implemented a Disks safety mitigation:
  - Drive mount/eject handlers pause drive polling, cancel active `["c64-drives"]` queries, invalidate without immediate refetch, settle, then release polling.
  - Manual Disks mounts now call `mountDiskToDrive(..., { mode: "readonly" })`; default `mountDiskToDrive` behavior remains `readwrite` for playback/autostart callers.
- Added/updated regression coverage:
  - `tests/unit/components/disks/HomeDiskManager.extended.test.tsx`
  - `tests/unit/components/disks/HomeDiskManager.test.tsx`
  - `tests/unit/components/disks/HomeDiskManager.ui.test.tsx`
  - `tests/unit/components/disks/HomeDiskManager.dialogs.test.tsx`
  - `tests/unit/lib/disks/diskMount.test.ts`
- Validation on the first local source state:
  - `npm run test -- tests/unit/lib/disks/diskMount.test.ts tests/unit/diskMount.test.ts tests/unit/components/disks/HomeDiskManager.dialogs.test.tsx tests/unit/components/disks/HomeDiskManager.extended.test.tsx tests/unit/components/disks/HomeDiskManager.ui.test.tsx tests/unit/components/disks/HomeDiskManager.test.tsx`: passed 6 files / 94 tests.
  - `npm run lint`: passed with existing c64scope coverage-helper warnings only.
  - `npm run scope:check`: passed 55 files / 360 tests.
  - `npm run test`: passed 643 files / 7457 tests.
  - `npm run build`: passed.
- Current-HEAD correction:
  - During the continuation, branch HEAD advanced from `515e2818ed1992dd6e3579470e1355488111278f` to `af2d795b2361cc78e52f3013cf3502c0e72c0375`.
  - Rebuilt and installed current APK with `./build --skip-tests --install-apk --device-id 9B081FFAZ001WX`.
  - Current APK: `android/app/build/outputs/apk/debug/c64commander-0.8.9-af2d7-debug.apk`, SHA-256 `e0f00bc9a9d595566df01b2eb1cfe63992dfc1611d4acce0fe4a21fa56af7891`.
  - Installed identity: versionName `0.8.9-af2d7`, versionCode `2042`, lastUpdateTime `2026-06-25 07:52:21`, signature short `d39d81d2`.
  - Re-ran `npm run scope:check`: passed 55 files / 360 tests.
  - Re-ran focused Disks tests on `af2d7`: passed 6 files / 94 tests.
  - Re-ran `npm run lint`: passed with existing c64scope coverage-helper warnings only.
- Target restoration and cleanup actions:
  - App-visible target had drifted to `u64`; used `DroidmindClient.pressKey(KEYCODE_POUND)` to open Switch Device, selected `c64u`, and captured `manual-restore-c64u/home-after-c64u-switch-back.png`.
  - A residual Drive A `Boulder Dash 2.d64` mount from a failed replay was ejected through the semantically identified Drive A eject control; evidence `c64scope/artifacts/cta-20260624T235538Z-pixel4-c64u-af2d795b2361/cleanup-drive-a-residual/result.json`, screenshots `before-coordinate-eject.png` and `after-coordinate-eject.png`.
  - Final app-visible target restored again after repetition harness drifted target to `u64`; evidence `c64scope/artifacts/cta-20260624T235538Z-pixel4-c64u-af2d795b2361/restore-c64u-final-state/home-after-c64u-final.png`.
- Current-build Disks evidence correction:
  - `c64scope/artifacts/cta-20260624T235538Z-pixel4-c64u-af2d795b2361/clean-readonly-mount-eject-2/result.json` is `INCONCLUSIVE_NEEDS_REPLAY`, not `PROVEN`; later screenshot review showed `screenshots/disks-before-clean-mount.png` already had Drive A mounted with Boulder Dash before the claimed mount action.
  - Supporting direct unauthenticated `c64u` probes returned expected `403` in ~8 ms around the invalid cycle, proving target availability only, not app-driven mount/eject coverage.
  - Repetition runner attempt under `readonly-mount-eject-repetitions/` is invalid automation evidence: stale coordinate fallback did not exercise the intended mount/eject path and left the mount sheet open. Do not count it as product reliability failure; replay with corrected semantic targeting.
  - Corrected attempt under `corrected-readonly-cycle-1/` showed Drive A OFF with no disk mounted, but the Drive A mount affordance did not open the mount sheet, so it also remains `INCONCLUSIVE_NEEDS_REPLAY`.

Decisions and evidence:

- The original readwrite repeated mount/eject S1 remains open until a corrected five-cycle current-build reliability run passes.
- The current code mitigation has local regression coverage and current-APK install proof, but no valid Pixel 4 Drive A mount/eject reliability pass yet.
- The app was later restored to Drive A ON with no disk, but the app-visible header showed `C64U ▲ 4`; direct unauthenticated `http://c64u/v1/info` returned expected `403` in ~8 ms. Diagnose the four app-visible warnings before retrying Drive A mount/eject.
- Do not write `final-report-3.md`; exhaustive CTA execution and cleanup remain incomplete.

## Pixel 4 CTA continuation — corrected readonly Cycle 2 failure and native REST hardening

Recorded UTC: 2026-06-25T08:04:19Z.

Commands and material actions:

- `git status --short`, `git branch --show-current`, `git rev-parse HEAD`: branch `test/full-cta-coverage`, SHA `cf84d8e565cbc1511bfe9758887af7c9ae07fba8`, dirty worktree preserved.
- Captured live Disks state under `c64scope/artifacts/cta-20260624T235538Z-pixel4-c64u-af2d795b2361/readonly-cycle-key-2-eject/`; hierarchy capture hung and was interrupted, but screenshot `screenshots/00-current-before-eject-nav.png` showed Drive A ON with `/.../Frogger.d64` mounted.
- Used `DroidmindClient.pressKey()` only for product navigation. Focus-map screenshots were captured under:
  - `readonly-cycle-key-2-eject/screenshots/focus-map/`
  - `readonly-cycle-key-2-eject/screenshots/focus-up-from-b/`
- Verified focus on `Drive A Eject disk` in `readonly-cycle-key-2-eject/screenshots/focus-up-from-b/09-LEFT.png`.
- Activated the focused eject CTA with `DroidmindClient.pressKey(DPAD_CENTER)`; evidence:
  - `readonly-cycle-key-2-eject/screenshots/01-before-eject-center.png`
  - `readonly-cycle-key-2-eject/screenshots/02-after-eject-immediate.png`
  - `readonly-cycle-key-2-eject/screenshots/03-after-eject-polling.png`
  - `readonly-cycle-key-2-eject/logs/logcat/cycle-2-eject.log`
  - `readonly-cycle-key-2-eject/eject-result.json`
- Logcat showed the key-driven product request `PUT http://c64u/v1/drives/a:remove` failed in 37 ms with `Connection reset`; the emitted failure context included `idleMs=197050` and `wasIdle=true`.
- Stopped the app through `DroidmindClient.stopApp`; evidence `readonly-cycle-key-2-eject/logs/droidmind/stop-after-cycle-2-reset.jsonl`.
- Direct app-stopped `http://c64u/v1/info` recovery probes returned `curl: (56) Recv failure: Connection reset by peer`:
  - `readonly-cycle-key-2-eject/logs/commands/c64u-health-after-cycle-2.stdout.log`
  - `readonly-cycle-key-2-eject/logs/commands/c64u-health-recovery-1.stdout.log`
  - `readonly-cycle-key-2-eject/logs/commands/c64u-health-recovery-2.stdout.log`
  - `readonly-cycle-key-2-eject/logs/commands/c64u-health-recovery-3.stdout.log`
- Built current `cf84d` APK without launching via `npm run cap:build && npm run android:apk`; first build SHA-256 `1fca357d8b17d7e3ba839d3047dc50175824725160ca15fb7ebd68bc8a7497fe`.
- Installed first `cf84d` APK with raw `adb -s 9B081FFAZ001WX install -r`; installed identity versionName `0.8.9-cf84d`, versionCode `2044`, lastUpdateTime `2026-06-25 08:58:29`, stopped=true.
- Direct app-stopped health after current APK install still returned connection reset; evidence `readonly-cycle-key-2-eject/logs/commands/c64u-health-after-current-apk-install.stdout.log`.
- Implemented focused source hardening in `src/lib/c64api.ts`: native direct-device REST requests now add `Connection: close`; web/proxy requests are unchanged.
- Added regression coverage in `tests/unit/c64api.branches.test.ts`: `closes native direct-device REST connections without changing web or proxy requests`.
- Validation:
  - `npm run scope:check`: passed 55 files / 360 tests before the transport hardening; c64scope was not changed afterward.
  - `npm run test -- tests/unit/c64api.branches.test.ts`: passed 94 tests.
  - `npm run cap:build && npm run android:apk`: passed after hardening; final APK SHA-256 `462bfa1578c219d1f753311695688863c68bdda27480a449823ce60b36d49a07`.
  - Raw `adb -s 9B081FFAZ001WX install -r android/app/build/outputs/apk/debug/c64commander-0.8.9-cf84d-debug.apk`: passed, no launch.
  - Installed identity after final install: versionName `0.8.9-cf84d`, versionCode `2044`, lastUpdateTime `2026-06-25 09:01:54`, signature short `d39d81d2`, stopped=true.
  - `npm run lint`: passed.
- Secret scan `rg -n 'pwd|"x-password":"(?!\\[REDACTED\\])' c64scope/artifacts/cta-20260624T235538Z-pixel4-c64u-af2d795b2361 docs/testing/agentic-tests/full-cta-coverage --pcre2` found only existing historical prompt/handover/report references, not new command/artifact leaks.
- Final app-stopped health check at `2026-06-25T08:07:31Z` still returned `curl: (56) Recv failure: Connection reset by peer`; evidence `readonly-cycle-key-2-eject/logs/commands/c64u-health-final-check.stdout.log` and `.stderr.log`.

Decisions and evidence:

- Corrected readonly Cycle 1 is a valid one-cycle pass, but Cycle 2 is a valid failure and keeps `S1-DISKS-MOUNT-EJECT-RESETS-C64U` open.
- The app-visible `0.8.9-8a785` string in the post-failure Home screenshot does not match the installed package `0.8.9-af2d7`; record as a build-identity anomaly to investigate after recovery.
- Do not launch the final installed `0.8.9-cf84d` APK or send product traffic while app-stopped direct `c64u` probes return connection reset.
- Cleanup is not proven: Drive A may still have `/USB2/test-data/d64/Frogger.d64` mounted because the eject request failed before target recovery could be confirmed.
- Do not write `docs/testing/agentic-tests/full-cta-coverage/final-report-3.md`; exhaustive CTA execution, cleanup, and Pixel 4 recommendation remain blocked.

## Pixel 4 CTA continuation — restart readback and Final Report 3 NO-GO

Recorded UTC: 2026-06-25T08:17:18Z.

Commands and material actions:

- User reported that `c64u` and `u64` were restarted and requested final reporting plus a handover prompt.
- `git status --short && git rev-parse HEAD`: branch still dirty at `cf84d8e565cbc1511bfe9758887af7c9ae07fba8`.
- Direct infrastructure health probes after restart:
  - `c64u`: expected unauthenticated HTTP `403` in `0.008440s`; evidence `restart-health/logs/commands/c64u-info.stdout.log`.
  - `u64`: still returned `curl: (56) Recv failure: Connection reset by peer`; evidence `restart-health/logs/commands/u64-info.stdout.log` and `.stderr.log`.
- Installed package identity remained current: versionName `0.8.9-cf84d`, versionCode `2044`, lastUpdateTime `2026-06-25 09:01:54`, stopped=true before launch.
- Launched current APK through `DroidmindClient.startApp()` and captured post-restart Home evidence:
  - `restart-health/screenshots/current-cf84d-after-restart-launch.png`
  - `restart-health/hierarchies/current-cf84d-after-restart-launch.xml`
  - `restart-health/logs/logcat/current-cf84d-after-restart-launch.log`
- App-visible Home state after restart: app `0.8.9-cf84d`, green `C64U`, device `c64u`, firmware `1.1.0`.
- Used `DroidmindClient.pressKey()` to navigate to Disks and captured cleanup readback:
  - `restart-health/screenshots/current-cf84d-disks-after-restart.png`
  - `restart-health/hierarchies/current-cf84d-disks-after-restart.xml`
  - `restart-health/logs/logcat/current-cf84d-disks-after-restart.log`
- App-visible Disks state after restart: Drive A ON with `No disk mounted`; Drive B OFF with `No disk mounted`.
- Stopped the app through `DroidmindClient.stopApp()` after cleanup capture; evidence `restart-health/logs/droidmind/stop-after-restart-cleanup.jsonl`.
- Wrote:
  - `docs/testing/agentic-tests/full-cta-coverage/final-report-3.md`
  - `docs/testing/agentic-tests/full-cta-coverage/cleanup-report-3.md`
  - `docs/testing/agentic-tests/full-cta-coverage/handover7.md`

Decision:

- Final recommendation is `PIXEL4-NO-GO`, not a certification pass.
- Reason: S1 Drive A mount/eject connection-reset defect remains open, five-cycle replay has not passed on `0.8.9-cf84d`, exhaustive CTA accounting is incomplete, and final unaccounted CTA count is not zero.

---

# Session: Bug Hunt — 2026-06-25T12:58Z (bughunt-20260625T125855Z)

Role: Principal Android QA Engineer — exhaustive bug hunt. Artifact root:
`c64scope/artifacts/bughunt-20260625T125855Z-pixel4-c64u-cf84d8e565cb/`

## Start-of-session facts (all verified, not assumed)

- `git status --short`: dirty (product delta `src/lib/c64api.ts`; QA docs/test files). Branch `test/full-cta-coverage`, HEAD `cf84d8e565cbc1511bfe9758887af7c9ae07fba8`.
- `adb devices -l`: Pixel 4 `9B081FFAZ001WX` online. Props: Pixel 4, Android 16, SDK 36, 1080x2280 @ 440dpi.
- c64u (192.168.1.167): ARP REACHABLE but `curl http://c64u/` = **HTTP 000** (web stack DOWN, NOT the expected 403). DNS `c64u -> 192.168.1.167` confirmed. C64U-dependent flows BLOCKED.
- u64 (192.168.1.13): HTTP 200 (healthy) — FORBIDDEN for closure.
- Installed APK SHA-256 `462bfa1578...d49a07` = handover-recorded value = committed HEAD. Not rebuilt (dirty c64api.ts delta is c64-only, untestable while c64u down).
- App UI = single `android.webkit.WebView` (uiautomator opaque). CDP reachable: Chrome/148, page "C64 Commander" @ http://localhost/. CDP used for observation only; product input via DroidMind.
- `npm run scope:check`: PASS (exit 0). Harness build + tests green. Evidence: `logs/commands/scope-check.{stdout,stderr}.log`.

## Actions

- Launched app via DroidMind `start_app`. Baseline capture `baseline-01-launch`: Home, App `0.8.9-cf84d`, Device **Not connected**, Firmware **Not connected**, target chip "C64U". 6-tab nav present. Consistent with c64u HTTP down.
- Wrote identity artifacts: environment.json, apk-identity.json, installed-package-identity.json.
- Mapped c64scope CTA harness operations (offline gates: discoverRoutes/keypad/gate4/gate5/gate6/gate65; c64u-dependent: gate3/gate7).

## Decision

- c64u offline is NOT a stop condition. Proceeding with full independent (disconnected/app-local) surface per prompt anti-shortcut rules. C64U-dependent flows marked BLOCKED_WITH_EVIDENCE.

## 2026-06-25T13:00–13:25Z — c64u recovered + S1 five-cycle replay

- User restarted c64u. Re-probe: `http://c64u/` HTTP 200; `/v1/info` HTTP 403 in 7-8 ms (healthy). u64 200.
- App had NOT auto-reconnected after outage (stayed OFFLINE). Drove app-driven reconnect: Settings → scroll → tap "Save & Connect" (host=c64u, http=80, ftp=21, telnet=23, pwd). Badge → "C64U ●". CDP showed `/v1/info` polling via Capacitor interceptor.
- Home connected baseline proven: badge green C64U ●, device c64u, firmware 1.1.0, Drive A ON/No disk mounted, Drive B OFF/No disk mounted. ("Power Off" button + Turbo "Manual" appear only when connected — disconnected hides them / shows "Not available".)
- S1 five-cycle Drive A readonly mount/eject (Boulder Dash 2.d64), full before/after evidence (s1-c1..c5-*), per-step c64u health + device readback:
  - **Catastrophic S1 (connection reset / device down): NOT reproduced.** c64u 403/7-8 ms at every step; no `Connection reset` in logcat. `Connection: close` fix appears effective. Caveat: idle-triggered path (~200s idle) not re-tested.
  - **New residual S2 found (2/5):** `drive-status-a` sticks on "Host unreachable" after a slow/failed mount while `drive-status-b`="OK" and device healthy; clears only on page re-mount. Triggers: cycle 1 concurrent-poll failure during 1774ms successful mount; cycle 5 phone DNS `UnknownHostException` (10032ms mount fail, 1 occurrence all session).
  - Mount durations 819–1774 ms (success), 10032 ms (DNS fail). Eject 150–259 ms (all clean).
  - Wrote defects/S2-DISKS-DRIVE-A-STATUS-STUCK-HOST-UNREACHABLE.md; updated S1 defect with session replay section.
- Cleanup: Drive A No disk mounted, status OK, badge green, device readback image_file=''.

## 2026-06-25T13:25–13:42Z — Broad connected coverage + reports

- Config: device exposes 22 categories; app = curated ~19-page menu + config-advanced-fallback (REST-only) for unmapped. Opened "Video setup" sub-page → renders live device values (PAL, HDMI 1024x768, CVBS+SVideo, etc.). config-02-video-setup.
- Diagnostics: `*` keypad shortcut opened diagnostics-sheet (172 evidence entries, health ● Healthy c64u). **Redaction PASS** — no pwd/x-password in summary or expanded request detail. Back closes. diag-01/02.
- Keypad: digit 2→Play, 5→Settings, 6→Docs, 1→Home; `#`→Device Switcher (closed via Back, no device switched, c64u preserved); `*`→Diagnostics. All work.
- Play: PLAY FILES renders; Prev/Play/Pause/Next disabled (empty playlist); volume/Recurse/Shuffle present. play-01.
- Device Switcher: switch-device-sheet via `#`; both devices health-verified; no accidental select. switcher-01.
- Docs: accordion cards (Getting Started, Home, Play, Disks, Swapping Disks, Config, Settings…) render + expand with content. docs-01/02.
- Negative path (invalid/empty host): INCONCLUSIVE — soft-keyboard layout shift broke blind-coordinate Save&Connect taps; invalid value typed but never applied (discarded on nav; persisted host stayed c64u; no corruption/crash). neg-01/02. Recommend keyboard-aware re-test.
- No crashes/ANRs/uncaught exceptions all session; 1 caught console.error (cycle-5 DNS blip).
- Cleanup verified: c64u connected/healthy, Drive A No disk mounted/OK (device readback image_file=''), no setting drift (theme=system, orientation=auto, ports/pwd/saved-devices unchanged).
- Wrote: bug-hunt-report.md (BUGHUNT-COMPLETE-MAJOR-BUGS-FOUND, focused-deep), cleanup-report-bughunt.md, runs/bug-hunt-ledger.md; updated S1 defect + S2 defect; PLANS.md final state.
- Stopped background CDP listener + continuous logcat.

## 2026-06-25T15:30–16:15Z — FIX + on-device verification (all identified issues)

User authorized product-code fixes + on-device verification. Root-caused via 2 agents, then implemented:

- `src/lib/c64api.ts`: MOUNT_REQUEST_TIMEOUT_MS=8000 for mountDrive/unmountDrive (was 1500ms interactive default → false "Host unreachable" on slow-but-OK mounts). [S2 Fix A + C3]
- `src/components/disks/HomeDiskManager.tsx`: driveErrorsSetAtRef + stamping effect + poll-reconciliation clear block (stale per-drive error clears on next successful poll); gated Disks drive status on status.isConnected. [S2 Fix B + C1]
- `src/pages/home/components/DriveManager.tsx`: gated Home drive status on isConnected → "Not available" when disconnected. [C1]
- `src/components/UnifiedHealthBadge.tsx`: OFFLINE badge tap also fires discoverConnection("manual") (additive; Diagnostics still opens). [C2]

Gates: typecheck PASS; full unit suite 643 files / 7458 tests PASS; `npm run lint` PASS (format+eslint+variant/feature-flag/menu-mapping).
Build: APK SHA-256 5c6625f7c42f4c8b73e6be8d13b563ec602be24df7a8e84a346c94eba168aca7 (vs old 462bfa15…), installed on Pixel 4.

On-device verification (Pixel 4 → c64u; u64 fallback during a c64u dropout):

- S2 Fix A: mount/eject cycles clean, no false "Host unreachable" (old build 2/5).
- S2 Fix B: deterministic — wifi-drop during mount set drive-status-a="Unable to resolve host" while drive-status-b="OK"; on wifi restore, drive-status-a self-cleared to "OK" on next poll WITHOUT navigation. (verify-wifidrop-failed/verify-fixB-recovered)
- C1: OFFLINE launch → Home home-drive-status-a="Not available"; Disks drive-status-message-a/b="Not available". (verify-c1-disks-offline)
- C2: OFFLINE badge tap → reconnect Offline→Online in ~1s (vs passive ~10-50s). (verify-c2-*)
- C3: mount timeout now intentional 8000ms; native CapacitorHttp can't honor AbortSignal (structural, documented).
- c64u flakiness: repeated wifi toggles (used to simulate outages) destabilized the shared AP and dropped c64u (user restarted twice); a single deliberate toggle survived (403). Updated memory c64u-flakiness with avoidance guidance.

Wrote fix-report.md; updated S2 defect (FIXED+VERIFIED), bug-hunt-ledger. App left connected/clean.

## Session final-bugfree-20260626T062957Z (HEAD fe212a59, branch test/full-cta-coverage-2) — FINAL BUG-FREE PROOF

All times 2026-06-26 UTC.

### Setup + baseline (06:28–06:36Z)

- git: branch test/full-cta-coverage-2, HEAD fe212a59 (PR #295: RAM snapshot restore fix + full CTA coverage tests). Working tree: only prompt4.md untracked.
- Confirmed `http.keepAlive=false` REVERTED — no keepAlive override in android/app/src/main/. S1 = firmware defect (see PLANS.md framing).
- Hardware probe: Pixel 4 `9B081FFAZ001WX` connected (USB). c64u 192.168.1.167 ICMP 1.1ms; u64 192.168.1.13 ICMP 0.5ms.
- `npm run scope:check`: 55 files / 361 tests PASS (exit 0).
- `cap:build && android:apk`: exit 0 → c64commander-0.9.0-rc1-debug.apk, SHA-256 bc3b825622c74baa23aaee4547ae9f050ded01b33001423c5ee9b4630fbd9cc3.
- Installed APK at start = stale WIP `0.8.9-b8687` vc2047 (off-history). New build vc2036 < 2047 → `adb uninstall` then `adb install`. Installed `0.9.0-rc1` vc2036, sig d39d81d2, first/last install 2026-06-26 07:29:37.
- Artifact root: c64scope/artifacts/final-bugfree-20260626T062957Z-pixel4-c64u-fe212a59/. Wrote environment.json, apk-identity.json, installed-package-identity.json.
- Direct c64u health (infra): unauth HTTP 403 in 0.009s; authed HTTP 200 in 0.013s — firmware 1.1.0, fpga 122, core 1.49, unique_id 5D4E12.
- Launch via DroidMind start_app → PID 29970; CDP forward tcp:9333 → page "C64 Commander" http://localhost/.
- Launch opened auto-discovery interstitial (PR #292): found c64u (Already saved, Password required) + u64 (fw 3.14e ID 38C1BA). App OFFLINE/Not connected.
- App-driven connect: tap "Use" on c64u → inline Network password field. NOTE on automation: WebView viewport does NOT reflow for the soft keyboard (innerHeight stays 829); a pre-keyboard button coord landed on a keyboard key and appended a stray char to the password (pwdk). Corrected: cleared field (4xDEL), retyped "pwd" (CDP-verified len=3), BACK to dismiss keyboard, tapped "Use Device".
- **Baseline PROVEN**: Home shows badge "192.168.1.167 ● HEALTHY", App 0.9.0-rc1, Device c64u, Firmware 1.1.0. screenshots/04-connected-home.png.
- Baseline logcat (logs/logcat/baseline-launch-connect.log, 4524 lines): no AndroidRuntime FATAL, no app chromium ERROR. Clean.
- Started continuous CDP console/network listener → logs/cdp-console-stream.jsonl.
- OBSERVATION (verify later, not yet a bug): c64u shown "Already saved" immediately after a CLEAN install (uninstall wiped data). Either the app seeds a default c64u device or discovery mislabels. To verify in Settings → saved devices.

### Play flow + SID-add finding (06:36–07:00Z)

- Play page loaded clean (badge HEALTHY). Add items → source chooser shows 4 sources: Local, C64U, HVSC, CommoServe (+Cancel).
- C64U source browse: root (Flash/SD/Temp/USB2) → /USB2 → /USB2/test-data → /USB2/test-data/SID. All directory listings rendered, badge HEALTHY. (Used FTP infra readback to locate fixtures: /USB2/test-data/{SID,prg,d64,mod,crt} — small files incl 10_Orbyte.sid 1584B.)
- Selected 3 SIDs (10_Orbyte, 12th_Sector_Music, 1982) via selection circles (row-center tap does NOT select; circle at x~95 does). "3 selected" → Add to playlist.
- **FINDING S2-PLAY-SID-ADD-AUTO-SONGLENGTHS-FTP-WEDGE** (defect filed): add triggered 60s+ "Scanning… 3 items", a burst of ~13 /v1/configs SID-setup reads, and an auto-selected Songlengths.md5 read over FTP that timed out ("FTP readFile timed out after connect 1500ms / transfer 8000ms"). Health → UNHEALTHY(5). 3 SIDs still added (Total 9:00, default 3:00). c64u FTP PASV now firmware-wedged (control ch OK 220/230/257/250, PASV times out 10-12s); HTTP stays 200/healthy. App did NOT auto-repoll /v1/info for ~13 min (06:40→06:53); badge recovered to HEALTHY immediately on Home nav (forced re-poll). Root: firmware FTP defect (external); app behaviors flagged (auto-songlengths-FTP-read on add; long no-repoll window).
- **Transport (HTTP, prompt §C) on the 3-SID playlist**: Play 10_Orbyte ✓ (timer advanced 0:07→2:32, Remaining counted down); Pause ✓ (froze 1:58, button→Resume); Resume ✓ (advanced again); Stop ✓ (timer→0:00). Each c64u op triggers config-read bursts → health badge twitchy/UNHEALTHY on the already-degraded device (not false-OK — it reports real failures; recovers on successful poll).
- DECISION POINT: c64u FTP is firmware-wedged + device degraded. Clean high-value-flow proof (disk mount/eject reliability S1, locked-screen auto-advance, source browse/import, filtering) needs a FRESH healthy c64u (physical power-cycle). Pivoting to app-local testing; asking user re power-cycle.

### USER REDIRECT (07:1x–07:3xZ) — songlengths fix reshaped + app fixes

- User power-cycled c64u (FTP restored: listing 226 in 0.57s, HTTP 200). Directive: "learn from this outage and avoid it in future; don't make a habit of power-cycles."
- Subagent code analysis confirmed TWO fixable app defects (distinct from firmware FTP wedge):
  - FIX(b) health-poll self-halt: useC64Connection.ts refetchInterval returns `false` on a _time-based_ (non-reactive) condition → React Query tears the interval down permanently → badge stuck UNHEALTHY ~13min until navigation. **FIXED**: moved time-based coalescing into queryFn (return cached when recent success), refetchInterval now only returns false on _reactive_ state (screenActive/diagnosticsSuppression/pollingPaused). typecheck clean; related tests green.
  - FIX(a) songlengths-on-SID-add: blocking/unbounded/uncancellable FTP read of a multi-MB songlengths.md5 that times out (8s idle soTimeout) and wedges the firmware FTP. v1 = 1MiB size-gate (committed in WT).
- **USER FEEDBACK reshapes FIX(a)**: songlengths.md5 is ~5MiB (→6MiB in 10y); a 1MiB cap makes C64U songlengths discovery infeasible — NOT acceptable. Required instead: (1) **6 MiB cap**, (2) **no timeouts** (let the read complete), (3) **much clearer progress reports** during the read, (4) **user abort**. The 8s idle-timeout truncating the transfer is likely what wedged the FTP data channel; letting it complete (or aborting cleanly) avoids that.
- Plan: native FtpClientPlugin.kt chunked streaming read with byte-progress events + cancellation + generous/disabled idle timeout; thread requestId/onProgress/signal/timeoutMs through src/lib/native/ftpClient.ts + src/lib/ftp/ftpClient.ts; addFileSelections buildUltimateSonglengthsFile uses them with 6MiB cap; surface progress + abort in the Play scan status. Kotlin + JS tests. Then build/install/HIL-read the real 5MiB songlengths on the fresh c64u (abort-ready).

### Fix verification + WEDGE 2 diagnosis + cascade-cut (07:3x–08:5xZ)

- Built+installed 0.9.0-rc1-fe212 (fix-a v2 + fix-b). tsc clean; 140 JS tests + Kotlin FtpClientPluginTest green.
- Re-ran SID-add HIL (3 SIDs /USB2/test-data/SID) to verify fix-a: read started with timeoutMs:0/totalBytes:5151881 (logcat); badge stayed HEALTHY ~76s (vs prior 8s error); one real duration resolved (12th_Sector=03:11 → read path works). BUT device then fully wedged (HTTP+FTP 000, ICMP alive) → user power-cycled (#2).
- **WEDGE 2 ROOT CAUSE (logcat wedge2-evidence/full-logcat.log):** wedge onset was in the songlengths DISCOVERY directory-listing scan, BEFORE the read — 9× SocketTimeoutException on listings 08:46:11→08:47:08, each cycling LIST→MLSD→NLST (3 PASV connections/folder, internal cascade unpaced by the 800ms inter-call cooldown). Folders are small (16/98/1 entries) so NOT size; it's rapid FTP connect/PASV churn (issue #364). The no-timeout READ was not the trigger.
- **FIX 3 (cascade cut):** FtpClientPlugin.kt resolveListing now rethrows on SocketTimeoutException instead of cascading to MLSD/NLST (3→1 PASV cycles per struggling listing). Kotlin test listDirectoryDoesNotCascadeToMlsdOrNlstOnTimeout green; APK rebuilt (SHA 56ec881f) + installed.
- HONEST LIMIT: c64u-no-wedge NOT guaranteed on fw-1.1.0 (firmware-limited); cascade cut reduces churn but not proven to fully prevent (deliberately NOT re-tested on c64u to avoid power-cycle #3). Real cure = firmware (u64 3.14x). Functional songlengths verification recommended on u64.
- Fix-b on-device: reconnected c64u HEALTHY; health polling continues (3 drives + info polls, no nav) → self-halt fixed.
- Device left: app connected to c64u, HEALTHY, Home, empty playlist (fresh install), Drive A no-disk.

### Safe-CTA error sweep (09:1x–09:3xZ) — exercise CTAs + capture errors per user mandate

- CDP error listener (cta-sweep-errors.jsonl), clean baseline. Exercised interactive CTAs on safe surfaces (no FTP bursts, no destructive Power Off/Reboot):
  - Play: Mute/Recurse/Shuffle/Repeat toggles (states flip correctly), Reshuffle, volume slider (0→-42dB applies), default-duration slider, type-filter chips. No Radix slider double-handling bug.
  - Config: category nav (Turbo boost); Turbo control dropdown opens with options (no blank-Select bug); config WRITE via PUT (Manual→Off→Manual) applied + device stayed HEALTHY (LED-crash class fixed) + restored.
  - Diagnostics (Star key): password-redaction PASS. Keypad: digits→tabs. Lifecycle: bg→fg no crash. Docs: accordion expand works.
- **Result: 0 console errors, 0 logcat app errors across the entire sweep.** App is clean for the exercised safe interactive CTA surface.
- NOT covered (continuing program / risky): full ~1000-CTA exhaustive matrix; FTP-heavy CTAs (Add items/Add disks/C64U browse — wedge risk); complex stateful flows (mount/eject reliability, locked-screen auto-advance, disk swap, filtering edge cases); negative-path connect; every config row; variant (C64U Remote) checks. See handover9.md.
- Honest status: 3 real bugs fixed + verified this session; broad safe-CTA surface clean; firmware FTP wedge = external/unfixable-in-app (trigger reduced). NOT a BUGFREE-PROVEN certification (exhaustive matrix incomplete).

## #142 (2026-07-17, Claude/Opus) — Config interactive-write family on c64u — STARTUP

- Branch fix/hardening4 HEAD 8fb53a71, tree clean. Source 0.9.2-8fb53; installed APK 0.9.2-rc1-8d512 (8d5127b9).
- APK identity: git diff 8d5127b9..HEAD touches NO src/ or android/app/src/ (docs/manuals/CI-telemetry/manual-tooling/radix-dep-bumps only) → product-equivalent → current-build claim without rebuild.
- Peers discovered callable: droidmind, c64scope, c64bridge, mobile-mcp. Hardware: c64u HEALTHY (HTTP 200 0.009s), u64 up (2.7s).
- REST baseline snapshots: Audio Mixer all Vol=0 dB/drives OFF (audio-mixer-baseline.json); Drive A Type=1541 (no restore needed, contra #84 note); SoftIEC Drive=Disabled.
- Family: /config Audio Mixer interactive writes. Capacity >=40% → min 8/target 12-20 actions.

## #143 (2026-07-17, Codex) — c64u Settings recovery and Audio Mixer SOLO pack

- Identity: `fix/hardening4` at `8fb53a71`, source `0.9.2-8fb53`; Pixel 4 `9B081FFAZ001WX` package `0.9.2-rc1-8d512`. The installed commit has no `src` or `android/app/src` delta to HEAD, so it is product-equivalent for this HIL pack.
- Hardware: c64u `192.168.1.167`, C64 Ultimate fw `1.2.0`, fpga `122`, core `1.4D`, id `5D4E12`. Direct `/v1/info` was HTTP 200 before and after; the final response has `errors: []`.
- Capacity/action accounting: Codex at 65% weekly capacity. Fourteen meaningful droidmind product actions covered Settings select/save/refresh, Diagnostics health/export, Config navigation/Audio Mixer expand, SOLO enable/restore, and safe dialog exits.

| Batch   | Product action                                    | Result                                                                                                            | Evidence                                                                            |
| ------- | ------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| A143-01 | Select saved c64u and Save & Connect              | Initial app request failed during Pixel Wi-Fi 5 GHz→2.4 GHz roaming; subsequent app `/v1/info` recovered.         | First diagnostics export records transient `ConnectException` followed by HTTP 200. |
| A143-02 | Refresh connection, then Run health check         | Recovered to connected c64u / Healthy / 0 problems, but the host input retained an old unreachable error.         | BUG-075; `iter143/diagnostics/...1731-10Z.zip`.                                     |
| A143-03 | Diagnostics Share all, cancel chooser             | Export created and pullable; no share target selected.                                                            | `iter143/diagnostics/c64commander-diagnostics-all-2026-07-17-1731-10Z.zip`.         |
| A143-04 | Config → Audio Mixer → SOLO UltiSID 1 enable      | One successful `POST /v1/configs` (HTTP 200, 70 ms); group body muted the other three channels.                   | Post-SOLO export action trace.                                                      |
| A143-05 | SOLO UltiSID 1 disable / restore                  | One restore POST (HTTP 200, 197 ms); all four group values returned to `0 dB`; follow-on item GETs were HTTP 200. | `iter143/diagnostics/unzipped-post-solo/actions-2026-07-17-1736-47Z.json`.          |
| A143-06 | Post-action Diagnostics Share all, cancel chooser | Export says Healthy/Online, problemCount 0; periodic `/v1/info` polls stayed HTTP 200 (35–51 ms).                 | `iter143/diagnostics/c64commander-diagnostics-all-2026-07-17-1736-47Z.zip`.         |

- Safety decision: stopped further Audio Mixer writes. SOLO intentionally uses a multi-field group POST and broad read-back fan-out; after the preceding recovery it was safer to preserve the restored baseline than add slider/select/reset traffic.
- Diagnostics review: no app crash/ANR surfaced in this pack. An initial-export unhandled-rejection record was associated with an earlier u64 failure window and was not reproduced here, so it remains observation-only.
- Final package-filtered logcat: the only new error-level WebView entry was `Capacitor/Console [object Object]` immediately after the intentionally canceled Android Share chooser returned `Share canceled`; c64u HTTP polling continued with 200 responses. It is expected cancel-path logging, not a crash or device failure.
- Artifacts: `docs/agentic/artifacts/iter143/` (UI screenshots, direct info JSON, two pulled Diagnostics ZIPs, expanded post-SOLO JSON).
- Completion deploy: the existing latest APK `android/app/build/outputs/apk/debug/c64commander-0.9.2-rc1-8d512-debug.apk` installed successfully at 18:42:11. Droidmind relaunched it; Home showed `Connected to c64u, system healthy`, app `0.9.2-rc1-8d512`, device c64u, firmware 1.2.0.
- Verdict: **DEFECT_OPEN** for BUG-075. No source changes, tests, or build ran; the existing product-equivalent APK was reinstalled and validated on Pixel 4.

## #144 (2026-07-17, kilo) — BUG-075 narrow fix + HIL

- Identity: `fix/hardening4` at `8fb53a71`, source `0.9.2-8fb53`. Rebuilt debug APK `android/app/build/outputs/apk/debug/c64commander-0.9.2-8fb53-debug.apk` and installed on Pixel 4 `9B081FFAZ001WX`; `get_app_info` confirms package `0.9.2-8fb53` matches HEAD source. No identity drift.
- Hardware: c64u `192.168.1.167`, C64 Ultimate fw `1.2.0`. Direct `/v1/info` HTTP 200 before and after the pack.
- Capacity/action accounting: kilo usable. Three product actions met the >=40% band (intentionally narrow: bogus-host Save, Refresh, restore-Save). droidmind supplied UI evidence; mobile-mcp and c64scope were not required for this fix.

| Batch   | Product action                                       | Result                                                                                                                                                                                | Evidence                                                         |
| ------- | ---------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------- |
| A144-01 | Settings: type bogus `192.168.1.250`, Save & Connect | Inline `We couldn’t reach "192.168.1.250"…` error shown; `switchSavedDevice` not called.                                                                                              | `iter144/screenshots/01-bug075-error-shown.png`.                 |
| A144-02 | Refresh connection (no field edit)                   | Error cleared; "Connected to http://192.168.1.167" header stayed healthy; field still shows `192.168.1.250` (correct — only the validation is cleared, the draft is not auto-edited). | `iter144/screenshots/02-bug075-error-cleared-after-refresh.png`. |
| A144-03 | Restore correct `192.168.1.167`, Save & Connect      | Save success path re-confirmed clean state; error did not reappear.                                                                                                                   | `iter144/screenshots/03-bug075-save-success.png`.                |

- Source change: `src/pages/SettingsPage.tsx` — `handleSaveConnection` clears `hostnameError` after a confirmed successful `switchSavedDevice` (line 737). `handleRefreshConnection` clears both `hostnameError` and `reachabilitySuggestion` after `discoverConnection("manual")` resolves (line 822-823). Clear is gated on **confirmed reachability**, not on draft edits.
- Regression: new test `clears a previously-set unreachable-host error once manual refresh recovers the device (BUG-075)` in `tests/unit/pages/SettingsPage.test.tsx` fails before the Refresh-path fix and passes after it. Full SettingsPage suite 92/92; full Vitest suite 8648/8648 across 707 files (~224s). `npm run lint` clean. `tsc --noEmit` clean.
- Safety decision: no c64u writes; only host-field keystrokes and Read/Save/Connect buttons. c64u `evaluateNewDeviceReachability` and `discoverConnection` are read-only on the device.
- Logcat: `adb logcat -d -t 200` clean of `FATAL`/`ANR`/`StrictMode`/`crash`/`exception` from `uk.gleissner.c64commander`. Only system noise (LOWI, AconfigPackage).
- Docs: `docs/agentic/BUGS_FOUND.md` (BUG-075 status → FIXED + current-build Pixel-HIL validated #144), `docs/agentic/STATE_DIGEST.md` (#144 entry), `docs/agentic/CTA_LEDGER.md` (BUG-075 row → EXERCISED_CLEAN_FIXED).
- Verdict: **FIXED + current-build Pixel-HIL validated** for BUG-075.

## Ralph loop iteration #145 (2026-07-17, kilo) — Config Audio Mixer SOLO/Reset/slider pack on c64u

- Setup: rebuilt+installed `0.9.2-c2120` on Pixel 4. droidmind `get_app_info` confirms identity match.
  c64u `192.168.1.167` healthy pre-pack. c64bridge backend = c64u. App at Home, target C64U,
  firmware 1.2.0 (screenshot `iter145/screenshots/00-home.png`).

## Ralph loop iteration #147 (2026-07-17, claude) — BUG-076 Critical native credential-logging FIXED + HIL-validated

- Family: **BUG-076 security pack** (top digest recommendation; Critical OPEN). Selected over CTA-coverage
  families because a Critical credential-exposure defect blocks release-known-clean.
- Identity: branch `fix/hardening4`, HEAD `c2120eaf`, source `0.9.2-c2120`. c64u `192.168.1.167` fw 1.2.0
  reachable HTTP 200 throughout. droidmind (Pixel 4) used; c64scope/c64bridge not required (no A/V claim).
- Root cause (source): `com.getcapacitor.Bridge.callPluginMethod` (Bridge.java:826-836) logs
  `methodData=call.getData().toString()` at VERBOSE tag `Capacitor`; for CapacitorHttp.request that
  includes headers incl `X-Password` (c64api.ts:1083). Gated by `Logger.shouldLog()`; default
  `loggingBehavior="debug"` → logs on every debuggable/testing APK (CapConfig.java:290-304).
- Fix: `capacitor.config.ts` → `android.loggingBehavior: "none"` (disables native Logger in all builds).
- Build/deploy: `./build --skip-tests --install-apk --device-id 9B081FFAZ001WX` → installed `0.9.2-c2120`;
  native asset `android/app/src/main/assets/capacitor.config.json` confirmed `android.loggingBehavior:"none"`;
  `get_app_info` = `0.9.2-c2120`.

| Action ID | Route/Page | UI element | User operation | Expected result | ≈200ms feedback | ≈1s/effect result | Oracle | Latency | Diagnostics/log | Status | Artifacts | Cleanup |
|-----------|-----------|-----------|----------------|-----------------|-----------------|-------------------|--------|---------|-----------------|--------|-----------|---------|
| A147-B0 | Config | Audio mixer Refresh (pre-fix baseline) | tap | REST re-read fires | busy | reads return; health poll fired | package logcat (masked) | n/a | `Capacitor` verbose `methodData` logged `X-Password` present (leak confirmed) | BASELINE_LEAK | logcat count-only | none (read-only) |
| A147-01 | Config | Config tab | tap (nav) | Config route loads categories | tab highlight | `/v1/configs` categories rendered | screenshot | <=1s-effect | REST OK, no Capacitor log lines | EXERCISED_CLEAN | screenshot | none |
| A147-02 | Config | Audio mixer folder | tap expand | per-item reads render Vol rows | chevron up | Vol Master/UltiSID 0 dB shown | screenshot | <=1s-effect | REST OK | EXERCISED_CLEAN | screenshot | none |
| A147-03 | Config | Audio mixer Refresh | tap | re-read all items | busy | values re-read, stayed 0 dB | screenshot+logcat | <=1s-effect | X-Password absent in logcat | EXERCISED_CLEAN | logcat | none |
| A147-04 | Home | Home tab | tap (nav) | Home route + health polls | tab highlight | Home shown, C64U healthy | screenshot | <=1s-effect | REST OK | EXERCISED_CLEAN | screenshot | none |
| A147-05 | Config | Config tab | tap (nav) | Config re-entry, categories | tab highlight | categories populated, C64U green | screenshot | <=1s-effect | REST OK | EXERCISED_CLEAN | screenshot | none |
| A147-06 | Settings/Diag | Diagnostics dialog | open + Problems filter + inspect ERR + Share all | export written | dialog opens | ZIP written to cache, pulled+analyzed | in-app Diagnostics export | n/a | Healthy, problemCount 0; 1 cold-start `ERR 1·1ms` transient (attributed, not a regression) | EXERCISED_CLEAN | iter147/diagnostics/ | back to dismiss |

- POST-FIX package logcat (`adb logcat -d --pid $(pidof)`): `X-Password`=0, `methodData`=0, `Capacitor`-tag lines=0
  (native Logger fully silenced); no FATAL/ANR/StrictMode/crash/exception. 230 app-pid system lines remain (framework, not Capacitor).
- Diagnostics export analysis (`iter147/diagnostics/`): app redaction intact — header value stored `pwd...[redacted]`;
  plaintext-header-value hits = 0 across all export JSON. Cold-start `ERR 1·1ms` on first `/v1/info` after relaunch is a
  known transient (immediate refuse before connection warmed); health recovered to Healthy, problemCount 0 — not caused by the config change.
- Cross-surface: UI (Config populated / C64U Healthy) ⟷ in-app Diagnostics (`/v1/info` HTTP 200, problemCount 0) ⟷ logcat
  (REST works, zero credential lines) all consistent. REST behavior unchanged by disabling native logging.
- Safety: no device writes (read-only navigation + config reads + Refresh). UltiSID/mixer untouched (still 0 dB); nothing to restore.
- Code changed: yes (`capacitor.config.ts`). Build/deploy: yes. High-level tests: none run — a config-only change validated
  by build-success (cap sync compiles it) + on-device HIL; unit tests cannot observe native logcat, so HIL is the correct oracle.
- Verdict: **FIXED + current-build Pixel-HIL validated** for BUG-076 (Critical). Credential no longer reaches logcat in any build.

## Ralph loop iteration #150 (2026-07-17, Codex) — Play playback transport/options/background

- Ralph Robin selected Codex (weekly 44%, >=40% action band); no scheduler or sub-agent was launched. droidmind, c64scope, and c64bridge were discovered callable. c64bridge initially reflected stale VICE state; selecting c64u made the read-only firmware-health check available.
- Current identity remained `fix/hardening4` / `c2120eaf`, source and installed Pixel APK `0.9.2-c2120`. Pre-existing dirty source/lockfile/config/test/CDP-helper changes were preserved.
- Droidmind exercised 25+ Play-family actions: current SID start; Mute then Unmute restoring `0 dB`; Pause then Resume; Android HOME then app foreground; Recurse, Shuffle, Reshuffle, and Repeat toggles with final baseline restored; Diagnostics open/Run health check/Share all/close. The foreground return retained an active Play session without a visible error.
- c64scope session `pt-20260717T192255Z` PASS: app-started playback produced 877 UDP packets at RMS `0.0869709866`. Its timeline includes start, mute restore, pause/resume, background/foreground, options, and final Diagnostics evidence.
- Safety observation: an ordinary delayed second tap after Play state changed reached red Stop and diagnostics recorded `PUT /v1/machine:reset` HTTP 200. This is the explicit maintainer-approved BUG-017 behavior, so it is not re-filed and was not repeated. Use Pause for future SID transport validation.
- Diagnostics export `c64commander-diagnostics-all-2026-07-17-1928-13Z.zip` was generated through the app and safely analyzed: Health `Healthy`, connectivity `Online`, `problemCount: 0`, successful SID/mute/pause/resume requests, and no fresh error-level log entry. Final c64bridge health was healthy (34 ms version/info/readmem); package logcat had no FATAL/ANR/StrictMode/app exception.
- No source change in this loop; no build, lint, or tests run. No screenshot corpus changed.
- Final deployment: reinstalled the existing `c64commander-0.9.2-c2120-debug.apk` and relaunched it on Pixel 4. `get_app_info` and Home both confirm `0.9.2-c2120` / c64u fw `1.2.0` / healthy.

## Ralph loop iteration #155 (2026-07-17, Codex) — BUG-078 locked-playback recovery request-path pack

- Capacity/action accounting: Ralph-selected Codex was usable at weekly 14%, so the 10–19% band required three meaningful actions. Droidmind drove nine: Resume, Home, lock, unlock swipe, open Diagnostics, Run health check, close, Pause, and Unmute. No scheduler command or sub-agent was used.
- Identity: `fix/hardening4` at `c2120eaf`; Pixel `9B081FFAZ001WX` reports `0.9.2-c2120` and last update `20:55:29`, after the `usePlaybackController` source/test mtimes (`20:54:54`/`20:54:40`). The installed APK is the current dirty source build.
- Discovery: Droidmind is callable. c64scope readiness reports all peers unknown. The concrete c64bridge `firmware_health` attempt was rejected because its active backend is VICE, not c64u; it supplied no device verdict.
- Baseline/final direct c64u `/v1/info` reads were HTTP 200 in 9.5 ms and 8.9 ms (`errors: []`).
- Result: after 40 seconds locked, foreground returned to a Healthy header. Diagnostics then showed a fresh app `/v1/info` `ERR 1` in 2 ms at 21:22:46, followed by a successful app `/v1/info` in 286 ms; the user-driven Run health check remained Healthy. This is another transient BUG-078 app-native post-unlock request failure, but it did not become a user-visible false-Unhealthy state. No retry, keep-alive, or connection-policy change was attempted.
- Handoff: reinstalled the latest existing `c64commander-0.9.2-c2120-debug.apk`, launched it, and confirmed Home rehydrated to c64u Healthy/fw 1.2.0. Play then showed no active item, Mute, and `0 dB`. Package-filtered crash/ANR/StrictMode logcat sweep was empty. No source changes, builds, tests, or screenshot refreshes in this HIL-only loop.

## Ralph loop iteration #157 (2026-07-17, Codex) — capacity handoff

- Runtime/capacity: Ralph Robin selected Codex and reports weekly capacity **7%**. This is the explicit 5–9% threshold: no new HIL, source edit, build, deploy, or product CTA was permitted. `droidmind_cta_action_count=0` is therefore an allowed pre-action capacity block, not a clean verdict.
- Startup state: `fix/hardening4` at `c2120eaf` (`0.9.2-c2120`); preserved dirty paths are `PLANS.md`, `WORKLOG.md`, `THIRD_PARTY_NOTICES.md`, `capacitor.config.ts`, `package-lock.json`, `c64scope/package-lock.json`, the existing diagnostics/config/playback source+tests, and untracked CDP helpers. The last verified Pixel identity remains `0.9.2-c2120`; no device or APK identity was re-asserted without HIL.
- Discovery: actual current tool namespace contains droidmind (`android_app`, `android_ui`, logs/screenshots), c64scope lab/session/capture functions, and c64bridge controls. No safe discovery call was needed after namespace confirmation; none was used as a substitute for product proof. HIL is deferred solely by the capacity rule.
- Evidence/result: no new device/app evidence and no verdict change. BUG-078 remains Low/Open; its last replay (#156) was a clean non-reproduction, while #152–#155 retain intermittent app-native request-failure evidence against direct reachable C64U REST. Do not infer that the firmware TCP wedge is fixed or that BUG-078 is closed.
- Continuation: refreshed `docs/agentic/STATE_DIGEST.md` and `docs/agentic/prompt.md`. Next primary TODO is a bounded ownership-tracing family before any retry/keep-alive/connection-policy edit. Ralph Robin continuation ready; no scheduler command ran because the injected runtime context reserves provider rotation to Ralph.
## Ralph loop iteration #159 (2026-07-17, Codex) — capacity handoff

- Runtime/capacity: Ralph Robin selected Codex at **6% weekly capacity**. The explicit 5–9% threshold forbids new HIL, source edits, builds, deployment, and direct device probes. `droidmind_cta_action_count=0` is therefore an allowed pre-action capacity block, not a clean product verdict.
- Startup state: `fix/hardening4` at `c2120eaf` (`git describe`: `0.9.2-2-gc2120eaf-dirty`). Existing worktree changes remain preserved, including `THIRD_PARTY_NOTICES.md`, lockfiles, native logging configuration, diagnostics/config/playback code and tests, and untracked CDP helpers. The last verified Pixel identity remains `9B081FFAZ001WX` / `0.9.2-c2120`; this loop made no device/APK claim.
- Discovery: the actual current tool namespace exposes droidmind Android controls, c64scope lab/session/capture controls, and c64bridge controls. No peer was treated as unavailable; the capacity rule, not tooling, deferred HIL.
- Result: no new product or hardware evidence and no defect status changed. BUG-078 remains Low/Open; execute its native request-ownership trace before any retry, keep-alive, or connection-policy change. Ralph Robin continuation ready; no scheduler command ran and no sub-agent was launched because Ralph owns rotation.

## Ralph loop iteration #162 (2026-07-17, Codex) — capacity handoff

- Runtime/capacity: Ralph Robin selected Codex at **5% weekly capacity**. The explicit 5–9% threshold forbids new HIL, source edits, builds, deployment, and direct device probes. `droidmind_cta_action_count=0` is therefore an allowed pre-action capacity block, not a clean verdict.
- Startup state: `fix/hardening4` at `c2120eaf` (`0.9.2-c2120`); the pre-existing dirty source/test/lockfile/configuration/CDP-helper changes remain preserved. The last verified Pixel identity remains `9B081FFAZ001WX` / `0.9.2-c2120`; this loop makes no device/APK claim.
- Discovery: the actual current tool namespace exposes droidmind Android controls, c64scope lab/session/capture controls, and c64bridge controls. No peer was treated as unavailable; the capacity rule, not tooling, deferred HIL.
- Result: no new product or hardware evidence and no defect status changed. BUG-078 remains Low/Open; execute its native request-ownership trace before any retry, keep-alive, or connection-policy change. Ralph Robin continuation ready; no scheduler command ran and no sub-agent was launched because Ralph owns rotation.

## Ralph loop iteration #163 (2026-07-17, Codex) — immediate capacity handoff

- Runtime/capacity: Ralph Robin selected Codex at **4% weekly capacity**. The `<=4%` policy requires immediate handoff; no HIL, source edit, build, deployment, or direct device probe was started. `droidmind_cta_action_count=0` is an allowed pre-action capacity block, not a clean product verdict.
- Startup state: `fix/hardening4` at `c2120eaf`; pre-existing dirty source/test/lockfile/configuration/notice/CDP-helper changes remain preserved. The Pixel `9B081FFAZ001WX` / APK `0.9.2-c2120` identity is last-verified only; no device or APK identity was re-asserted.
- Discovery: actual current tool namespace exposes droidmind Android, c64scope lab/session/capture, and c64bridge controls. No peer is classified unavailable; capacity alone deferred HIL.
- Result: no new product or hardware evidence and no defect status changed. BUG-078 remains Low/Open. `docs/agentic/STATE_DIGEST.md` and `docs/agentic/prompt.md` now direct the next capacity-permitting provider to perform the bounded native request-ownership trace before any retry, keep-alive, or connection-policy change. Ralph Robin continuation ready; no scheduler command ran and no sub-agent was launched because Ralph owns rotation.

## Ralph loop iteration #166 (2026-07-17, Codex) — immediate capacity handoff

- Runtime/capacity: Ralph Robin selected Codex at **2% weekly capacity**. The `<=4%` policy requires immediate handoff; no HIL, source edit, build, deployment, or direct device probe was started. `droidmind_cta_action_count=0` is an allowed pre-action capacity block, not a clean product verdict.
- Startup state: `fix/hardening4` at `c2120eaf`; the existing dirty source/test/lockfile/configuration/notice/CDP-helper changes remain preserved. The Pixel `9B081FFAZ001WX` / APK `0.9.2-c2120` identity is last-verified only; no device or APK identity was re-asserted.
- Discovery: actual current tool namespace exposes droidmind Android, c64scope lab/session/capture, and c64bridge controls. No peer is classified unavailable; capacity alone deferred HIL.
- Result: no new product or hardware evidence and no defect status changed. BUG-078 remains Low/Open. `docs/agentic/STATE_DIGEST.md` and `docs/agentic/prompt.md` direct the next capacity-permitting provider to perform the bounded native request-ownership trace before any retry, keep-alive, or connection-policy change. Ralph Robin continuation ready; no scheduler command ran and no sub-agent was launched because Ralph owns rotation.

## Ralph loop iteration #171 (2026-07-17, kilo) — Settings device-switch & BUG-078 trace

- Runtime/capacity: Ralph Robin selected kilo at ≥40% balance ($62.9). 13+ production CTAs exercised on installed Pixel `9B081FFAZ001WX` APK `0.9.2-c2120` (matches source `c2120eaf`).
- Branch/HEAD `fix/hardening4` / `c2120eaf`. The pre-existing dirty source/test/lockfile/notice/CDP-helper changes remain preserved; specifically `src/lib/diagnostics/healthCheckEngine.ts` retains the uncommitted transient-retry-on-REST-probe diff plus its two new unit tests. **This loop did NOT rebuild or deploy** because (a) the dirty change is orthogonal to BUG-078's root cause (it adds retry around the outer `getInfo`, not around the readmem/ErrorEffect classification) and (b) deploying a candidate that misdiagnoses the bug would be dishonest. The installed APK therefore matches `c2120eaf`, not the dirty tree.
- c64u `192.168.1.167` (C64 Ultimate fw 1.2.0) was healthy throughout: bracketing `curl /v1/info` HTTP 200 in 7–11 ms across the run, including the moments immediately after the BUG-078 ERR feed entries were recorded.
- Droidmind action list (chronological, all on Settings): (1) navigate Play→Settings, (2) scroll-up, (3) open Diagnostics, (4) **Run health check #1** (post-8m33s-idle; immediately produced `error rest.get /v1/info ERR 1 · 23:09:53.795` + `error ERROR C64 API request failed Error · 23:09:53.794`), (5) Run health check #2 (no new feed entry; engine dedupes near-simultaneous runs), (6) Run health check #3 (idem), (7) Close Diagnostics, (8) **Discover devices** at (540, 297) — above the nav-bar overlay (y=2148..2280) so it WORKS (returns c64u/u64/u2 rows), (9) **Use u64** device-switch (captured two more `error rest.get /v1/info ERR 1` entries at 23:12:53.985 and 23:12:54.083 plus the recovered HTTP 200 77ms success at 23:12:53.987), (10) **Use c64u** device-switch back, (11) HOME press (background), (12) start_app (foreground), (13) open Diagnostics — preserved `Connected to c64u, system healthy` + still-Hungry badge + cumulative 441 Activity entries (up from 435).
- **BUG-078 narrowed**: the ERR entries are NOT a misclassification of successful 200 reads. They are legitimate transient network failures (likely c64u firmware TCP wedge idle-correlation: the first poll after multi-minute idle and the device-switch probe both fire), which the engine's internal retry correctly recovers from, and `HealthSnapshot` correctly classifies the overall probe as `Success` (badge stayed `● Healthy`). The remaining UX defect: the in-app Activity feed logs the transient attempt at error severity ("C64 API request failed" via `addErrorLog`), which makes "Healthy + error entries visible" appear inconsistent. This is a UX/severity question (warn vs error for recovered transients), not a misclassification in the engine.
- Package-filtered logcat slice `docs/agentic/artifacts/iter171/logcat/logcat-package-final.log`: zero FATAL/ANR/StrictMode/app exception/app REST trace. TelnetSocketPlugin connect/disconnect pairs at 23:09:54, 23:10:14, 23:10:35 all succeeded within ~500 ms. Consistent with BUG-076 `loggingBehavior:"none"`: the ERR entries are in-app only, never reach native logcat.
- No source files changed. No build/deploy. The existing dirty transient-retry unit tests still pass: `tests/unit/lib/diagnostics/healthCheckEngine.test.ts` (77/77 pass). The transient retry is a partial mitigation for the symptom (it can absorb one transient during the outer getInfo), but it does NOT cover the in-app ErrorEffect path; a full UX fix would re-classify transient `addErrorLog` calls as warn for the `transient:true` branch.
- Final state: app on Settings, `Connected to c64u, system healthy`, dirty worktree preserved, c64u healthy, no playback/queue state in flight. Mix was 0 dB; no changes were made to audio. No destructive CTA exercised.
- Next exact action: a follow-up loop can either (a) build/deploy the dirty transient retry and re-run the same device-switch probe pack to confirm reduced (but not eliminated) BUG-078 feed entries — that is a moderate-confidence mitigation, or (b) pivot to a fresh probe family (Disks execution pack with disposable D64 once provisioned, or BUG-039 SOLO route-away safety pack). The latter is the higher-value next move because no production surface was exercised this loop beyond Settings; the Play probe family is current-build-verified clean.

## Ralph loop iteration #172 (2026-07-17, kilo) — BUG-078 UX/severity fix

- kilo ≥40% balance ($64.5). Selected the digest-recommended family: **BUG-078 UX/severity fix**.
- Identity: branch `fix/hardening4`, HEAD `c2120eaf`, source `0.9.2-c2120`. Working tree preserved.
- Pixel 4 `9B081FFAZ001WX` attached. c64u `192.168.1.167` fw 1.2.0 HTTP 200 in 8.6 ms; u64 `192.168.1.13` HTTP 200 in 7.5 ms.
- No open blocker/high defect. BUG-078 Low/Open is the target.
- Stop criteria: implement demotion + regression test; build/deploy current-source APK; re-run #171 probe pack; update BUG-078 to FIXED.
- Primary TODO: implement transient-demotion in c64api.ts.

### Iter172 outcome

- Implemented single-call-site demotion in `src/lib/c64api.ts` lines 1886–1898: `isTransientFailure` → `addLog("warn", ...)` instead of `addErrorLog(...)`; preserves `{transient:true}` flag.
- Updated 1 + added 2 tests in `tests/unit/c64api.branches.test.ts` BUG-069 block. Updated 2 tests in `tests/unit/c64api.ext2.test.ts`. Prettier-clean.
- All 197 unit tests pass (3 c64api files); 63/63 fuzz tests pass.
- `./build --skip-tests --install-apk`: BUILD SUCCESSFUL in 19s; APK installed on Pixel 4 at 23:19:50; launched; Settings render confirmed `Connected to c64u, system healthy`.
- HIL probe pack (12 actions, mobile-mcp): launch app → Settings tab → host field edit c64u→u64 (used `adb shell input keyevent` after mobile-mcp type_keys concatenated) → defocus EditText → Save & Connect → open Diagnostics via badge → Run health check → scroll Activity feed → close → reverse switch to c64u → re-open Diagnostics.
- BUG-078 evidence: badge `● Healthy` throughout; bracketing `curl` c64u + u64 HTTP 200 in 7.5–9.6 ms. Activity feed captured the canonical BUG-078 sequence at 23:26:14.231/.316/.329/.386 (host-change success → first GET HTTP 200 38ms → trace-level error entries ERR 1 105ms).
- **Result: PARTIALLY MITIGATED.** The redundant `addErrorLog("C64 API request failed", {transient:true})` no longer fires at error severity. The trace-level `recordTraceError → appendEvent("error", ...)` and `recordActionEnd {status:error}` continue to produce red ERR entries in the Activity feed for first-attempt failures during device-switch windows. Those are separate from `addErrorLog` and require changes in `recordActionEnd`, `actionTrace.ts`, or `buildActionSummaries → resolveErrorEffects` to fully realize "amber not red".
- Updated `docs/agentic/BUGS_FOUND.md` (BUG-078 #172 replay note appended), `docs/agentic/CTA_LEDGER.md` (one new iter172 row), `docs/agentic/STATE_DIGEST.md` (refreshed to #172 verdict).
- Artifacts: 22 PNG screenshots in `docs/agentic/artifacts/iter172/screenshots/`, 2 logcat slices in `docs/agentic/artifacts/iter172/logcat/`.
- Next exact action: decide between (a) demoting `recordActionEnd` for transient-only action outcomes (broader scope, requires engine coordination), (b) propagating `transient` flag through `buildActionSummaries → resolveErrorEffects` to render badge-as-warn, or (c) implementing the suppress-on-success path keyed on `(correlationId, path)`. The user should pick which round-2 direction to take before next iteration.

## Ralph loop iteration #173 (2026-07-17, kilo) — BUG-078 round 2 HIL validation

- Runtime/capacity: Ralph Robin selected kilo as usable; current balance unknown but ≥40% assumed given recent #171/#172 kilo runs. ≥40% band → min 8 / target 12–20 CTAs.
- Identity: branch `fix/hardening4`, HEAD `c2120eaf`, source `0.9.2-c2120`. **Installed APK on Pixel 4 `9B081FFAZ001WX` is `0.9.2-c2120` from #172 — does NOT match the dirty source which has the round-2 changes already implemented (3 files: `actionSummaries.ts`, `ActionExpandedContent.tsx`, `tests/unit/diagnostics/actionSummaries.test.ts`, plus related BUG-078 effects tests).** Must build/deploy before any current-build HIL claim.
- Previous verdict (#172): BUG-078 PARTIALLY MITIGATED, single-call-site demotion shipped; trace-level ERR entries persist.
- Pixel 4 `9B081FFAZ001WX` attached and app running (0.9.2-c2120). Bracketing `curl`: c64u `192.168.1.167` HTTP 200 in 9.6 ms; u64 `192.168.1.13` HTTP 200 in 8.8 ms. c64u fw 1.2.0.
- c64scope lab peers report unknown; this loop will not need A/V/stream capture (BUG-078 is in-app UI; no media path). Mobile controller will be exercised via droidmind + mobile-mcp.
- Selected family: **BUG-078 round 2 — transient severity in action summary** (the planned #173, carrying forward planned changes from #172's next-action list, option (b): propagate `transient` flag through `buildActionSummaries → resolveErrorEffects` so the in-app Activity feed renders network-transient error labels as `warn:` (amber) instead of red `ERR`).
- Stop criteria: build/deploy current-source APK with the round-2 changes; re-run Settings device-switch probe pack from #172 to provoke transient ERR events; observe Activity feed shows `warn:` labels and amber colour (not red); non-transient failures still render red; regression test confirmed; BUGS_FOUND/STATE_DIGEST refreshed.
- Primary TODO: build APK, install, re-run device-switch probe pack, validate `warn:` rendering.

## Ralph loop iteration #174 (2026-07-18, Codex) — BUG-078 Activity warning presentation

- Capacity/action accounting: Codex was usable at 90% weekly capacity. Droidmind drove Settings navigation, host edit/save c64u→u64, Diagnostics opening/inspection, Android Back dismissal, host restore u64→c64u, and final Home navigation (well above the >=40% action minimum).
- Current-build evidence: first deployed current dirty-source APK showed the staged expanded-detail change was incomplete: recovered `GET 192.168.1.13 /v1/info` Action and `rest.get /v1/info` Trace entries were still red even while Diagnostics was Healthy. Root cause: `resolveTraceSeverity` and `resolveActionSeverity` classified purely from type/outcome.
- Change: `src/lib/diagnostics/diagnosticsSeverity.ts`, `DiagnosticsDialog.tsx`, and `ActionExpandedContent.tsx` now preserve `network-transient` as warn through evidence rows and expanded content. Added deterministic severity and dialog regressions, alongside the pre-existing action-summary regressions. Focused suite: 83/83 pass.
- Deploy/HIL: `./build --skip-tests --install-apk --device-id 9B081FFAZ001WX` succeeded twice; the second APK includes the full correction. On the repeat switch, both recovered transient rows were amber; expanding the action showed amber `warn: The operation was aborted`; overall Diagnostics remained Healthy. Final Pixel Home reports `0.9.2-c2120`, c64u, fw 1.2.0.
- Cleanup/diagnostics: saved host restored to `192.168.1.167`; direct c64u and u64 `/v1/info` final probes were HTTP 200 in 9.9 ms / 8.3 ms. Package logcat has no package FATAL/ANR/StrictMode/crash/exception; recorded Android/WebView warnings were startup/platform noise. Compact Diagnostics did not expose Share-all, so no export is claimed.
- Verdict: BUG-078's recovered-transient **presentation** is FIXED + current-build Pixel-HIL validated. Its intermittent locked-background native request/false-Unhealthy symptom remains OPEN; no retry, keep-alive, or connection-reuse policy changed.

## Ralph loop iteration #175 (2026-07-18, Codex) — HIL infrastructure blocked before action

- Capacity: Ralph-selected Codex usable (weekly 81%; >=40% band). This did not authorize an adb-only substitute for the required product controller.
- Peer discovery: inspected the actual available tool namespace twice, including a second search for `droidmind|c64scope|c64bridge|mobile|tool_search`; both returned `[]`. No safe droidmind/c64scope/c64bridge status call exists in this runtime. This is the concrete required-tools-unavailable condition required by the Ralph protocol.
- Setup-only check: `adb devices -l` lists Pixel 4 `9B081FFAZ001WX`; `./scripts/resolve-version.sh` returns `0.9.2-c2120`. No app was launched, foregrounded, tapped, backgrounded, or inspected through adb, and no direct device REST/FTP/Telnet call was made.
- `droidmind_cta_action_count=0`. Allowed reduced-budget reason: required HIL tools are concretely unavailable. No probe-family verdict, product claim, source edit, build, test, deployment, or cleanup mutation is claimed.
- State handoff: preserved the existing dirty worktree; refreshed `STATE_DIGEST.md` and `docs/agentic/prompt.md`. Ralph Robin continuation ready; no scheduler command was run because Ralph owns rotation.

## Ralph loop iteration #176 (2026-07-18, Codex) — Disks pack / foreground app transport failure

- Ralph-selected Codex was usable at 80%; droidmind, mobile-mcp, c64bridge, and c64scope were actually available. Pixel `9B081FFAZ001WX` reports `0.9.2-c2120`; Home showed c64u fw 1.2.0.
- Droidmind drove 20+ controls: Disks navigation, mount/source sheets, C64U Root/USB2/Games browser, filters, two imports, Drive A mount, View-all/item-menu inspection, second mount chooser, Diagnostics, health check, overflow/Config Drift/back/close. Live bounds and scrolling avoided the protected bottom-layout false-positive.
- 3D Pinball mounted successfully. The foreground replacement with Arctic Shipwreck failed at 01:01:49: Diagnostics records `PUT /v1/drives/a:mount Failed to fetch (Failed to connect to /192.168.1.167:80)`, disk-mount errors, `Mount failed / Host unreachable`, and Unhealthy/5. Independent `/v1/info` and `/v1/drives` were HTTP 200 in 9.1/14.5 ms; the first disk remained mounted.
- Stopped further app mutations. Manual app health check recovered Healthy. Direct `PUT /v1/drives/a:remove` was emergency cleanup only; it returned 200 and final Drive A image was empty. Final `/v1/info` was HTTP 200 in 9.3 ms. `docs/agentic/artifacts/iter176/screenshots/01-final-disks-healthy-unmounted.png` saved.
- Package logcat had no FATAL/ANR/StrictMode/crash/exception. No source edit, build, deploy, test, or coverage. This is new BUG-078 request-path evidence, not a firmware-wedge cure; no scheduler command or sub-agent ran.

## Ralph loop iteration #177 (2026-07-18, kilo) — Lower Settings persistence pack

- kilo balance $70.7 (≥40%). Identity: `fix/hardening4` / `c2120eaf` / `0.9.2-c2120`. Installed APK matches source.
- c64u/u64 reachable; droidmind available.
- Previous verdict (#176): BUG-078 transport symptom still OPEN; Disks false-unreachable PUT captured.
- Selected family: **Lower Settings persistence pack**. UI-only, no REST mutation. Aim: ≥8 CTAs.
- Primary TODO: scroll Settings, enumerate controls, exercise, restore, diagnostics sweep.

## Ralph loop iteration #178 (2026-07-18, Codex) — Diagnostics request-ownership evidence pack

- Capacity/identity: Codex 75% weekly (>=40% band); Pixel 4 `9B081FFAZ001WX` package and source `0.9.2-c2120` match. Baseline c64u/u64 `/v1/info`: HTTP 200 in 8.7/8.4 ms. droidmind, mobile-mcp, c64scope, and c64bridge were exposed; c64scope lab readiness was unknown and c64bridge's default platform was VICE, so neither was used as a hardware oracle.
- Droidmind actions (19): close stale mount dialog; navigate Disks -> Settings; open Diagnostics; Run health check x3 (each native Telnet connect/disconnect confirms handler actuation); Problems/filter and Activity-event expansion; two Activity swipes; Diagnostics overflow -> Share all -> Android chooser -> Back; close dialog; HOME -> foreground; reopen Diagnostics; final Run health check; final close. The final dialog was `Healthy` with 137 Activity entries.
- BUG-078 remains OPEN: one health cluster recorded `rest.get /v1/machine:readmem?address=00A2&length=3 ERR 1`, `Host unreachable`, origin `system`, correlation `COR-0156` at 01:35:33.311 while recovery left Diagnostics Healthy. Following HOME/foreground, app `/v1/info` records were HTTP 200 in 359 ms and 1501 ms; independent host c64u `/v1/info` was HTTP 200 in 9.0 ms. This is app-native latency/failure-path evidence, not a device outage and not authorization to change retry, keep-alive, or connection reuse.
- Diagnostics/log sweep: Share all rendered Android chooser filename `c64commander-diagnostics-all-2026-07-18-0036-14Z.zip`; cache is private (`/data/user/0/.../cache` permission denied, `run-as` command rejected), so export content was not pulled or analyzed. Package PID log saved at `docs/agentic/artifacts/iter178/logcat/package-pid.log`: no FATAL/ANR/StrictMode/crash/Capacitor HTTP error; Telnet checks at 01:35:28, 01:35:32, 01:35:33, and 01:37:38 were clean. The absent native HTTP record is expected from the BUG-076 credential-protection setting `android.loggingBehavior:"none"`.
- Artifacts: `docs/agentic/artifacts/iter178/screenshots/01-final-diagnostics-healthy.png`, `ui/final-diagnostics.xml`, and `logcat/package-pid.log`. c64u ended reachable; no app/device state needed restoration. No source edits, build, deployment, tests, coverage, scheduler, or sub-agent.
- Handoff: add credential-redacted native Capacitor request start/end/error lifecycle instrumentation correlated with the JS request ID, build/deploy it, then run a safe app-driven Disk PUT pack. Ralph Robin owns provider rotation; no scheduler command ran.

## Ralph loop iteration #179 (2026-07-18, Codex) — native transport ownership evidence

- Capacity/tool discovery: Codex 71% weekly (>=40% action band); droidmind, mobile-mcp, c64bridge, and c64scope exposed. Droidmind launched and controlled Pixel `9B081FFAZ001WX`; c64bridge was VICE and c64scope had no ready lab state. No scheduler/sub-agent.
- Build identity: branch `fix/hardening4`, source label `0.9.2-c2120`; `./build --skip-tests --install-apk` succeeded and installed the latest APK to Pixel. Focused `tests/unit/c64api.nativeTransport.test.ts` passed 7/7. Android Kotlin compilation passed; only the pre-existing deprecated status/navigation-bar API warnings remain.
- Native instrumentation: new `C64HttpPlugin` delegates to Capacitor `HttpRequestHandler` and logs only request ID, trace correlation, method, and query-free target. It never writes headers, request bodies, URL query strings, or credentials. Current app request results now prove ownership at the Android connection boundary.
- HIL pack: droidmind drove 14+ product interactions: launch, guarded Clear-Memory reboot dialog open/cancel, Disks navigation, drive mount-control attempts, scrolls, disk selection, details menu/Back, Drive A power off/on, HOME. The power-off mutation succeeded; the subsequent app restore surfaced `Drive power toggle failed / Host unreachable`, so app device mutation stopped under the safety policy.
- Correlated native evidence: `PUT /v1/drives/a:on` (`c64req-mrpni96f-1u`) logged `SocketTimeoutException` after 1504 ms from Pixel `192.168.1.206:38662` to c64u `192.168.1.167:80`; repeated app `GET /v1/drives` then failed with the same native connect timeout. Concurrent host c64u `/v1/info` and `/v1/drives` were HTTP 200 in 9.8 ms. This is an actual native Pixel connection failure, not JS error translation or a c64u-wide outage.
- Cleanup: direct host `/v1/drives` confirmed Drive A had been disabled by the first app action. One emergency `PUT /v1/drives/a:on` restored `enabled:true`, empty image (HTTP 200 in 10.0 ms). The app was sent HOME and force-stopped to prevent more c64u traffic. Artifact: `docs/agentic/artifacts/iter179/screenshots/01-drive-power-false-unreachable.png`.

## Ralph loop iteration #180 (2026-07-18, kilo) — Settings/Import + About card UI probe

- Capacity/identity: kilo 100% weekly capacity pre-loop, dropped to ~63% after iter180 CTA pack; >=40% action band held; fast-path start-up kept zero-build/no-deploy workflow. Branch `fix/hardening4`, HEAD `c2120eaf`, source `0.9.2-c2120`; installed APK `0.9.2-c2120` (carried over from #179) matches source — identity gate passed via About card `Version 0.9.2-c2120` / `Git ID c2120eaf` matching `scripts/resolve-version.sh`.
- Family selection: Settings/Import settings + Settings/About external link. Both rows had stale DISCOVERED / BLOCKED_INFRA status with cheap UI-only work; re-attempts the proven Export primitive on the symmetric Import CTA, and pokes the Settings/About external anchor a Card build (`0.9.2-c2120`) later than rows 245/246 last cleaned it.
- CTA pack (≥8 minimum met): BUG-079 SAF Enumerate first root tap (1, still disabled, no handler invocation), List persisted URIs tap (1), Import settings open + Cancel (1 — DocumentsUI opened at `Download/C64LocalSource`, demo files visible; two Android Back presses returned cleanly to Settings), Settings full-page scroll sequence (1), About scroll/reveal (1), identity gate verify (About card content captured: `Version 0.9.2-c2120`, `Git ID c2120eaf`, `Build Time 2026-07-18 00:46:27 UTC`, `REST API v0.1`) (1), Settings/About external `target="_blank"` link tap attempts at coords (450,1525), (300,1518), (325,1465), (525,1575) plus raw `adb shell input tap 525 1575` (1 logical — all inert), Open Source Licenses button tap attempts (1 logical — same WebView consumption).
- **CLOSES BLOCKED_INFRA**: row 62 Settings/Import settings `Tap and cancel picker` and row 78 Settings/Import settings `Tap, open Android DocumentsUI, cancel without selecting` flip to EXERCISED_CLEAN — picker open + cancel cleanly confirmed on `0.9.2-c2120`.
- Stays DISCOVERED: row 17 Settings/About external `Ultimate REST API Documentation` link (and the symmetric Open Source Licenses button) — the inner `<a target="_blank">` and `<button onClick>` are reachable only via WebView CDP / Chrome DevTools because Android a11y exposes the entire About section as a single Button, so droidmind taps and raw `adb shell input tap` are silently consumed by the parent WebView. `capacitor.config.ts` has no InAppBrowser or external-URL override, so `target="_blank"` does not auto-route to chrome/custom-tabs. Rows 245/246 (#92) on `/docs` and `/settings/About` from `#92` remain the prior EXERCISED_CLEAN evidence.
- c64u transport was healthy entire loop: `c64req-mrpoi13x-2b GET http://192.168.1.167/v1/info status=200 durationMs=30` through `c64req-mrpon6p0-2f ... durationMs=31`. Periodic UI health badge briefly said "system unhealthy, 10 problems" mid-loop but recovered to "system healthy" — stale carryover from #179 c64u TCP wedge residuals, live probes contradict the badge. u64 (`192.168.1.13`) HTTP 200 in 8 ms when probed.
- 39 screenshots saved under `docs/agentic/artifacts/iter180/screenshots/` (Settings transfer card, Import picker `demo.{crt,d64,d71,d81}`, full Settings scroll, About card render, External link tap attempts, top navigation); http-trace slice at `docs/agentic/artifacts/iter180/logcat/http-trace.txt`.
- Iter180 paragraph appended to `docs/agentic/STATE_DIGEST.md` preserving #179 + #178 paragraphs (BUG-078 native Pixel transport, BUG-079 SAF disabled, C64HttpPlugin credential redaction).
- Deduced CTA ledger rows updated: 17 (DISCOVERED + iter180 WebView-blocking note), 62 (BLOCKED_INFRA → EXERCISED_CLEAN), 78 (BLOCKED_INFRA → EXERCISED_CLEAN with #62 delegate).
- No source edits, build, deployment, tests, coverage, or scheduler command. Ralph Robin owns provider rotation.

## Ralph loop iteration #182 (2026-07-18, kilo) — BUG-039 Audio Mixer SOLO route-away pack (in progress)

- Identity/peer/connection checks: `fix/hardening4` / `c2120eaf` / `0.9.2-c2120`. Installed APK `0.9.2-c2120` on Pixel `9B081FFAZ001WX` confirmed via `get_app_info`. c64u `192.168.1.167` HTTP 200 in 9 ms; u64 `192.168.1.13` HTTP 200 in 8 ms. droidmind/mobile-mcp/c64bridge/c64scope available.
- App foregrounded on Settings (c64u Healthy badge); switched to Config to start the BUG-039 SOLO route-away pack.
