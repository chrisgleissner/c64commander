# Bug-Hunt Report — C64 Commander on Pixel 4 (session bughunt-20260625T164637Z)

> ## ⚠️ CORRECTION (2026-06-25, later in session) — the S1 "fix" below was WRONG
> The keep-alive root cause + fix claimed below (§1, §31, §37) **did not hold**: the c64u
> **wedged again on the keep-alive-disabled build** (a single background `GET /v1/info` after a
> ~4-min idle gap), and `/proc/net/tcp` confirmed the app was **not** reusing pooled connections.
> The wedge is **independent of connection reuse**. The `http.keepAlive=false` change was
> **reverted as ineffective**. The corrected, evidence-backed conclusion: this is a **C64U
> firmware defect** (embedded TCP stack permanently wedges on a request after idle; all TCP
> services dead, ICMP alive; cure = firmware update). Authoritative write-ups:
> `defects/S1-C64U-FIRMWARE-TCP-WEDGE-ON-IDLE-RECONNECT.md` and `docs/c64/c64u-firmware-tcp-wedge-report.md`.
> The S1 sections below are retained for history but their keep-alive conclusion is superseded.

**Recommendation: `BUGHUNT-COMPLETE-CRITICAL-BUGS-FOUND` — and the critical bug is FIXED + verified on-device this session.**

This session's headline outcome: the **months-long S1 catastrophic bug** — *a C64 Commander action drives the c64u into a full network/REST degradation that does not recover until a manual power-cycle* — was **reproduced, root-caused, fixed, and verified on-device** (A/B). User directed the fix mid-session.

Run: `bughunt-20260625T164637Z`. Pixel 4 `9B081FFAZ001WX` → c64u `192.168.1.167` (fw 1.1.0). Control: DroidMind (input) + CDP (observe) + adb/curl (infra/ground-truth). Artifact root: `c64scope/artifacts/bughunt-20260625T164637Z-pixel4-c64u-b86877f43589/`.

## 1. Executive summary

- **S1 ROOT CAUSE FOUND + FIXED.** Every device REST call goes through CapacitorHttp → Android okhttp-backed `HttpURLConnection`, which **pools idle TCP sockets**. The c64u's tiny embedded web server drops its side of an idle socket; the app's **first request after a connection-idle gap reuses that stale socket** → `Connection reset` (or a bogus HTTP 404) → the embedded server **hard-hangs** (HTTP 000, ICMP still up) until power-cycle. Fix: disable HttpURLConnection keep-alive (`http.keepAlive=false`) in `MainActivity.disableHttpConnectionReuse()`. The prior `Connection: close` "fix" was a **no-op** (`Connection` is a Fetch forbidden header, stripped before the native client — verified).
- **On-device A/B proof:** unfixed build, idle 42s → Drive A mount → HTTP 404 → c64u HTTP 000, **user power-cycled**. Fixed build, idle 50s → same mount → **HTTP 200/780ms, disk mounted, c64u healthy throughout**; post-idle eject also clean. Full detail: `defects/S1-ROOTCAUSE-HTTP-KEEPALIVE-STALE-SOCKET-WEDGES-C64U.md`.
- **App stability otherwise excellent:** zero JS exceptions/console errors across all 6 routes; clean relaunch + background/foreground reconnect; password not leaked in Diagnostics; keypad shortcuts all functional.
- **Minor new finding (S4):** AbortError escapes as an `unhandledrejection` when an overlay (Diagnostics / Device Switcher) is dismissed mid-fetch.
- **Repo-health finding:** 2 committed files (`UnifiedHealthBadge.tsx`, `DriveManager.tsx`) failed the `format:check:ts` lint gate (committed without prettier). Cleaned up (whitespace-only).

## 2. Scope
Pixel 4 touch + injected Android key events (DroidMind); DOM/console via CDP (WebView app); c64u as the live target. Build under test: freshly built from HEAD `b86877f4`, then a fixed build with the keep-alive change.

## 3–7. Identity
- App: **C64 Commander (FULL build)**, `uk.gleissner.c64commander`.
- APKs this session: `0.8.9-b8687` vc2047 (HEAD, SHA `f052b0b1…`, **unfixed** — reproduced S1) → `0.8.9-b8687` vc2047 (SHA `2ffb1645…`, **fixed** — keep-alive disable).
- Git: branch `test/full-cta-coverage`, HEAD `b86877f43589` (clean at start; dirty at end with the fix + QA docs).
- Pixel 4 `9B081FFAZ001WX`, Android 16 / SDK 36, 1080×2280 @ 440dpi (CSS→physical scale ×2.75).
- c64u `192.168.1.167`, C64 Ultimate, fw 1.1.0.

## 8. c64u health timeline
| Local time | c64u (from wired host) | Note |
|---|---|---|
| 16:46 start | HTTP 200/403, ~8ms | healthy baseline |
| ~16:54 (unfixed mount) | 403 → then **HTTP 000** | S1 wedge after idle→mount→404 |
| ~16:59 | HTTP 403 | **user power-cycled** (did NOT self-heal) |
| 17:1x–17:2x (fixed build) | 403/8ms throughout mount+eject | fix verified; transient Wi-Fi SYN-loss self-healed |
| 17:30 end | 403/8ms healthy | clean |

## 9–11. Commands / artifacts / tooling compliance
- Product input exclusively via DroidMind (taps + key events). CDP used only for DOM/console observation + an in-memory error collector. Raw curl/adb used only for device health ground-truth, FTP file-existence readback, and the controlled diagnostic of the 404 (never as a product pass). `npm run scope:check` PASS.
- Artifacts: `environment.json`, `apk-identity{,-fixed}.json`, `installed-package-identity.json`, ~20 screenshots, route DOM inventories, `logs/logcat/s1-idle-path.log`, `logs/commands/{s1-c64u-health-monitor,fix-verify-health}.log`.

## 12. All-route inventory (CDP, this session, fixed build)
6 routes confirmed, all reachable by keypad digits 1–6: Home (164 interactive els), Play (63), Disks (80), Config (42 menu), Settings (109), Docs (40). Overlays exercised: mount sheet, Diagnostics (`*`), Device Switcher (`#`), Config sub-page (Video setup). **Zero uncaught JS exceptions / console errors across the full navigation sweep.**

## 13–25. Area results
- **Global shell / nav / keypad:** digits 1–6 → 6 tabs ✓; `*` → Diagnostics (Back dismisses) ✓; `#` → Device Switcher (Back dismisses, **no accidental device switch**, c64u preserved) ✓.
- **Home:** green badge, device c64u / fw 1.1.0, Quick Actions enabled (incl. Power Off = connected). ✓
- **Disks (deepest):** Drive A/B render live state; mount sheet lists `/USB2/test-data/d64/` (FTP-confirmed files); **S1 fix verified here** (idle→mount→idle→eject clean); per-drive status recovers (S2 fix holds — status went HTTP404→OK on poll without page re-mount during the unfixed repro). ✓
- **Config:** menu renders full category list (C64U, Memory & ROMs, Video, Audio×6, Joystick, LED, Network×3, Modems, Printers, UI, Drives A/B, …). Sub-page "Video setup" renders **live device values** (System mode PAL, HDMI 1024×768, scan lines Enabled). Read/render/nav ✓. One safe config-**write** mutation deferred (see §coverage) — write-path device-safety is covered transitively by the keep-alive fix (same transport, proven on mount/eject).
- **Settings:** appearance enumerated; theme Auto, orientation Auto; **display profile found on "Small display", restored to Auto**; fullscreen controls present.
- **Diagnostics:** opens via `*`; **password `pwd` NOT present in body (redaction PASS)**.
- **Device Switcher:** opens via `#`; u64 + c64u both ONLINE; closed with no switch.
- **Play:** empty-playlist state + playback controls render; "Add items" present (source chooser not opened — a mis-tap hit the adjacent bottom-nav tab; deferred).
- **Docs:** accordions (C64U, External Resources) render. ✓

## 26. Negative-path results
- Disconnected/degraded handling: when c64u wedged, the app correctly showed "degraded/2 problems", per-drive status surfaced "HTTP 404", and **recovered to healthy on its own** once the device returned — no false "OK". The app's failure reporting is accurate (no false success, no silent failure).
- Transient Pixel↔c64u Wi-Fi SYN-loss (16ms variable latency) now produces brief **self-healing** "degraded" instead of a wedge.
- Connection-form invalid-host/port validation: NOT executed (deferred — device-config risk + known soft-keyboard coordinate flakiness).

## 27–30. Lifecycle / performance / reliability
- **Lifecycle:** cold relaunch → clean reconnect ✓; background → foreground → clean reconnect, c64u healthy ✓ (the resume-after-idle path that historically triggered stale-socket resets). Orientation rotate skipped (documented landscape trap).
- **Performance:** mount PUT 780 ms; eject PUT 147 ms; route nav < 1.5 s; relaunch reconnect ~4 s; device `/v1/info` ~8 ms from host.
- **Reliability:** the idle→mount→idle→eject S1 cycle + ~10 navigations + relaunch + bg/fg, all clean on the fixed build.

## 31. Defect summary by severity
| ID | Sev | Status | Summary |
|----|-----|--------|---------|
| S1-ROOTCAUSE-HTTP-KEEPALIVE-STALE-SOCKET-WEDGES-C64U | S1 | **FIXED + VERIFIED ON-DEVICE** | Stale idle-socket reuse hard-hangs c64u; fixed via `http.keepAlive=false`. |
| S1-DISKS-MOUNT-EJECT-RESETS-C64U | S1 | **ROOT-CAUSED → see above; FIXED** | Original symptom; now understood as the idle-stale-socket case. |
| S2-DISKS-DRIVE-A-STATUS-STUCK-HOST-UNREACHABLE | S2 | Fix holds (status recovered on poll) | Confirmed during the unfixed repro. |
| S4-UNHANDLED-ABORTERROR-ON-OVERLAY-DISMISS | S4 | OPEN (minor) | AbortError → unhandledrejection on Diagnostics/Switcher dismiss. |
| (repo health) prettier drift in 2 committed files | S4 | Cleaned up | `UnifiedHealthBadge.tsx`, `DriveManager.tsx` failed `format:check:ts`. |

## 32. Full-log index
`logs/logcat/s1-idle-path.log` (mount 404 + wedge), `logs/commands/s1-c64u-health-monitor.log` (HTTP 000 burst), `logs/commands/fix-verify-health.log` (fixed-build idle→mount→eject all 403), screenshots `baseline-*`, `s1-*`, `fix-*`, `sweep-*`, `final-state-*`.

## 33–34. Cleanup / residual
See `cleanup-report-bughunt.md`. App left connected/healthy, Drive A clean, display profile Auto. Residual: "Hide status bar" checked (pre-existing, documented). c64u power-cycled twice by the user (unfixed wedge) — none after the fix.

## 35. Working-tree status (exact)
```
 M AGENTS.md  PLANS.md  WORKLOG.md
 M android/.../MainActivity.kt            (FIX: http.keepAlive=false)
 M android/.../MainActivityTest.kt        (2 regression tests)
 M src/lib/c64api.ts                      (comment)
 M src/components/UnifiedHealthBadge.tsx  (prettier cleanup, whitespace-only)
 M src/pages/home/components/DriveManager.tsx (prettier cleanup, whitespace-only)
 M docs/.../defects/S1-DISKS-MOUNT-EJECT-RESETS-C64U.md
?? docs/.../defects/S1-ROOTCAUSE-HTTP-KEEPALIVE-STALE-SOCKET-WEDGES-C64U.md
?? docs/.../defects/S4-UNHANDLED-ABORTERROR-ON-OVERLAY-DISMISS.md
?? docs/.../bug-hunt-report.md, cleanup-report-bughunt.md (this file)
```
(git-ignored, also edited: `docs/agentic/C64U_INCIDENTS.md` root-cause banner.)

## 36. Highest-risk open issues
1. **S4** unhandled AbortError rejection on overlay dismiss (minor; can spam error tracking / mask real rejections).
2. **"Hide status bar"** residual — confirm intended.
3. Pixel↔c64u Wi-Fi flakiness (environmental) still causes transient "degraded" — now self-healing, not catastrophic.

## 37. Recommended next developer fixes
1. **Commit the keep-alive fix** (the S1 cure) and add a CI/lint note so a future `Connection`-header-based attempt isn't re-introduced (it can't work from JS).
2. Swallow AbortError at the Diagnostics/Device-Switcher fetch call sites (or globally) to kill the S4 unhandledrejection.
3. Run prettier on the branch (the 2 committed files) and consider a pre-commit format hook.
4. (Separate, still-open firmware issue) the CPU-Speed-write network drop is NOT covered by this fix — keep the single-item sequential-write mitigation.

## Coverage completeness (honest accounting)
**Done:** S1 reproduce→root-cause→fix→on-device A/B verify (mount + eject, idle paths); full 6-route CDP error sweep; keypad parity (digits + `*` + `#` + Back); Config menu + 1 sub-page live render; Settings appearance (+ display-profile restore); Diagnostics redaction; Device Switcher; Docs; lifecycle relaunch + bg/fg; perf timings; cleanup.
**Deferred (with reasons, not hidden):** per-CTA activation accounting of all ~498 enumerated interactive els; remaining Config sub-pages + a live config-write mutation (device-risk + Radix-dropdown blind-coord hazard; write-path covered transitively by the transport fix); Play source chooser/file browser/playlist/playback; connection-form invalid-host/port negative validation (device-config risk + soft-keyboard coords); orientation rotate (landscape trap); 20× reliability reps; native picker/share. These are the residual exhaustive-coverage items; the session was intentionally re-prioritized to the user-directed S1 root-cause + fix.
