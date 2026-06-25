# Bug-Hunt Report — C64 Commander on Pixel 4

**Recommendation: `BUGHUNT-COMPLETE-MAJOR-BUGS-FOUND`** (for the surface covered this session)
**Coverage caveat:** this was a focused-deep session (critical S1/S2 + a breadth pass), **not** a full per-CTA exhaustive accounting of all ~290 controls. Remaining scope is listed in §"Coverage completeness".

Run: `bughunt-20260625T125855Z`. Date 2026-06-25. Author: autonomous QA session.

## 1. Executive summary

- The previously-open **S1** ("repeated Drive A mount/eject resets the C64U connection / downs the device") **did NOT reproduce** across 5 rapid mount + 4 eject cycles. `c64u` stayed healthy (HTTP 403 in 7–8 ms) at every step; no `Connection reset` in logcat. The `Connection: close` native-REST hardening (present in this APK) appears effective for the catastrophic aspect. **Caveat:** the original failure was *idle-triggered* (~197 s idle then eject); this session ran rapid cycles and did not specifically replay that idle path.
- A **new, distinct, confirmed major defect (S2)** was found: after a slow or failed Drive A mount, the **Drive A status indicator sticks on "Host unreachable"** while Drive B shows "OK" on the same page and the device is fully reachable; it does not self-recover on the periodic poll (clears only on page re-mount). Reproduced 2/5.
- The app is **stable**: zero crashes/ANRs, zero uncaught JS exceptions, only one *caught* console error (a transient phone-side DNS blip) across the whole session.
- **Security: PASS** — Diagnostics does not leak the device password (`pwd`/`x-password` absent from both the activity log and expanded request detail; password input is type=password).
- Keypad shortcuts (digits 1–6 → tabs, `*` → Diagnostics, `#` → Device Switcher, Back → dismiss overlay) all work.

## 2. Scope
Pixel 4 (`9B081FFAZ001WX`), touch + injected Android key events via **DroidMind**; DOM/console/network observation via **CDP** (the app is a WebView; uiautomator is opaque). C64 target `c64u`.

## 3–7. App / build / git / device / target identity
- App: **C64 Commander (FULL build)**, package `uk.gleissner.c64commander`. (Not the stripped C64U Remote variant — see §"Variant".)
- APK `0.8.9-cf84d`, versionCode 2044, SHA-256 `462bfa1578c219d1f753311695688863c68bdda27480a449823ce60b36d49a07` (= committed HEAD; built from working tree incl. the uncommitted `src/lib/c64api.ts` Connection: close change).
- Git: branch `test/full-cta-coverage`, HEAD `cf84d8e565cbc1511bfe9758887af7c9ae07fba8` (working tree dirty — QA docs/tests + the c64api.ts fix).
- Pixel 4, Android 16 / SDK 36, 1080×2280 @ 440dpi.
- c64u: 192.168.1.167, fw 1.1.0. Health timeline: **HTTP 000 (down) at session start → user power-cycled c64u mid-session → HTTP 403/7-8 ms (healthy) for the rest of the session.** u64 (192.168.1.13) healthy but unused for closure (forbidden).

## 8. C64U health timeline
| Time (local) | c64u | Note |
|---|---|---|
| 13:58 start | HTTP 000 | web stack down (worse than prior 403); blocked C64U flows |
| ~14:05 | HTTP 200 / 403 | user restarted c64u → recovered |
| 14:18–14:25 (S1 cycles) | 403 / 7-8 ms every step | no reset during 5 mount/eject |
| 14:41 end | 403 / 8 ms | healthy |

## 9–11. Commands / artifacts / tooling compliance
- Artifact root: `c64scope/artifacts/bughunt-20260625T125855Z-pixel4-c64u-cf84d8e565cb/` (environment.json, apk-identity.json, installed-package-identity.json, 29 screenshots, 28 hierarchies, 29 logcat snapshots, inventory, `logs/c64scope/cdp-console-network.jsonl` = 188 events).
- All product input via DroidMind (taps/keys). CDP used only for observation. Raw REST used only for target health probes + drive-state readback (ground truth), never as a product pass. `npm run scope:check` PASS (exit 0).
- QA tooling added (no product code touched): `scripts/bughunt-capture.sh`, `scripts/bughunt-snap.sh`, `scripts/bughunt-cdp.mjs`.

## 12. All-route inventory (CDP, this session)
6 main routes confirmed + overlays. Full DOM enumerated for Home (190 elements), Settings (169), Disks, Config menu, Play, Docs, Diagnostics sheet (172 evidence entries), Device Switcher, mount sheet. Prior runs counted ~290 CTAs (Home 106, Play 24, Disks 40, Config 28, Settings 74, Docs 18); not re-accounted per-CTA this session.

## 13–25. Area results
- **Global shell / nav:** Tabs reachable by touch and by digit keys 1–6. Back dismisses overlays and returns to prior route. ✔
- **Keypad:** `*`→Diagnostics, `#`→Device Switcher, digits→tabs, Back→dismiss — all functional. ✔
- **Home (connected):** badge green C64U ●, device c64u, fw 1.1.0; Quick Actions enabled; "Power Off" appears only when connected. ✔ **(Disconnected):** header/badge correctly "Not connected/OFFLINE", destructive controls disabled — BUT body shows a *mix* of "Not available" placeholders and **stale concrete cached values** (Drive A "Type 1541/Status OK", SID "ARMSID", LED "Blue/31", Streams "192.168.1.185:11000"). Candidate finding C1 (S4) — inconsistent disconnected rendering.
- **Play:** renders; playback controls (Prev/Play/Pause/Next) correctly disabled with empty playlist; volume/Recurse/Shuffle present. Sources/file-browser not deep-tested.
- **Disks:** see §S1/S2 below — deepest area this session.
- **Config:** device exposes **22** categories; app presents a curated ~19-page menu + `config-advanced-fallback` ("Advanced REST-only settings") that surfaces unmapped categories (addresses the "render all REST configs" concern). Sub-page ("Video setup") renders **live** device values (PAL, HDMI 1024×768, Analog CVBS+SVideo, etc.). ✔ Not all 19 sub-pages opened.
- **Settings:** Appearance/Display/Orientation/Full-screen, saved devices (c64u selected, u64), connection form (host/http/ftp/telnet/password), discovery, Diagnostics, Export/Import, feature flags (all telnet flags present + on — confirms full variant). Enumerated, not all mutated.
- **Diagnostics:** star shortcut works; live activity/REST/health log (172 entries); **password redaction PASS**; expandable detail; Back closes. ✔
- **Device Switcher:** pound shortcut opens it; both devices health-verified; closed via Back with **no accidental device switch** (c64u preserved). ✔
- **Docs:** accordion cards render and expand with content. ✔

## 26. Negative-path results
- **Disconnected state** (session start, c64u down): app showed "Not connected/OFFLINE" correctly; no crash.
- **DNS failure (organic):** cycle-5 mount hit `UnknownHostException` (phone couldn't resolve `c64u`) — app caught it (logged, no crash) but hung ~10 s with no visible timeout/progress, and left the drive status stuck (→ S2). Candidate C3 (minor UX).
- **No auto-reconnect:** after c64u recovered, the app stayed OFFLINE until a manual Save & Connect. Candidate C2 (possibly by-design).
- **Empty/invalid host validation:** INCONCLUSIVE — soft-keyboard layout shift made blind-coordinate Save & Connect taps unreliable; the invalid value was typed but never applied (discarded on nav; persisted host stayed `c64u`, no corruption, no crash). Needs re-test via the gate7 harness or a keyboard-aware input method.

## 27–30. Lifecycle / performance / reliability / soak
- **Reliability:** 5× Drive A mount/eject; ~10 navigations; Diagnostics/Switcher open/close; no crash/leak observed. (Full 20× tab cycles etc. not run.)
- **Performance:** mount PUT 819–1774 ms (slow); eject PUT 150–259 ms (fast); failed mount hung 10,032 ms (DNS). Route nav and overlay open felt responsive (<1.5 s). No request storm in steady state (CDP idle = quiet).
- **Lifecycle (cold/warm/home/lock/rotate/relaunch/bg):** not exercised this session.

## 31. Defect summary by severity
| ID | Sev | Status | Summary |
|----|-----|--------|---------|
| S1-DISKS-MOUNT-EJECT-RESETS-C64U | S1 | Catastrophic aspect NOT reproduced (5 cycles); fix appears effective; idle path not retested | updated with session replay |
| S2-DISKS-DRIVE-A-STATUS-STUCK-HOST-UNREACHABLE | S2 | **PROVEN (2/5)** | Drive A status sticks on "Host unreachable" after slow/failed mount; doesn't self-recover; Drive B unaffected |
| C1 (candidate) | S4 | needs confirm | Disconnected Home mixes "Not available" + stale cached values |
| C2 (candidate) | S3 | needs confirm | No auto-reconnect after transient outage |
| C3 (candidate) | S3 | needs confirm | ~10 s hang + no feedback on mount DNS failure |

## 32. Full-log index
Per-case: `screenshots/<case>.png`, `hierarchies/<case>.xml`, `logs/logcat/<case>.log`. Session: `logs/c64scope/cdp-console-network.jsonl`, `logs/logcat/session-continuous.log`, `logs/commands/*.log`. S1 cases: `s1-c1..c5-*`. Negative: `neg-01/02-*`. Diagnostics: `diag-01/02-*`.

## 33–34. Cleanup / residual differences
See `cleanup-report-bughunt.md`. App left connected/healthy, Drive A `No disk mounted`/OK (device readback `image_file=''`), no setting drift. Only net change vs start: c64u now connected (it was down at start) — the correct baseline.

## 35. Working-tree status
Dirty: M PLANS.md, WORKLOG.md, docs/cta-inventory.md, S1 defect, progress-ledger.md, src/lib/c64api.ts (+ regression test), several playwright/variant/test files (pre-existing). New (??): defects/S2-*.md, runs/bug-hunt-ledger.md, this report, cleanup-report-bughunt.md, scripts/bughunt-*.{sh,mjs}, plus prior handover/report files.

## 36. Highest-risk open issues
1. **S2** — misleading persistent "Host unreachable" on a healthy, just-mounted Drive A (P1 to fix: clear per-drive status error on next successful poll).
2. **S1 idle-path** — recommend one dedicated mount → ~200 s idle → eject replay to fully close the catastrophic case.
3. Pixel 4 ↔ c64u WiFi/DNS flakiness (environmental) interacts badly with the app's slow mount + sticky status.

## 37. Recommended next developer fixes
1. Reset the Drive A (and all per-drive) status error state on the next successful `/v1/drives` (or per-drive config) poll — don't let a transient failure stick until page re-mount. (Fixes S2.)
2. Add a request timeout + visible progress/timeout feedback to disk mount (the 10 s DNS hang). 
3. Consider auto-reconnect (or a one-tap "Reconnect" on the OFFLINE badge) after a transient outage.
4. Review disconnected-state rendering so cached device values are clearly marked stale (or hidden) rather than showing "Status OK".
5. Validate the S1 `Connection: close` fix against the idle-triggered path before closing S1.

## Coverage completeness (honest accounting — NOT a full exhaustive run)
**Done:** S1 5-cycle replay (deep, full evidence) → S2 found; connected + disconnected Home; Config structure + 1 sub-page + device-category comparison; Settings form/appearance enumeration; Diagnostics redaction + star shortcut; Device Switcher pound shortcut; Play render; Docs accordion; keypad digits/star/pound/back; basic perf timings; cleanup proven.
**Not done (remaining for a true exhaustive run):** per-CTA activation accounting of all ~290 controls; all 19 Config sub-pages + every row; Play source chooser/file browser/playlist build/playback; robust negative-path form validation (needs keyboard-aware input); lifecycle (lock/rotate/relaunch/background); reliability repetitions (20× cycles); native picker/share sheets; full touch-vs-keypad parity matrix; S1 idle-path replay; C64U Remote *variant* build (only the full app was installed).
