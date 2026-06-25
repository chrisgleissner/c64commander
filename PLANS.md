# PLANS.md — C64 Commander Exhaustive Bug Hunt (Pixel 4)

## Identity (verified this session 2026-06-25T16:46Z)

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

## Artifact root

`c64scope/artifacts/bughunt-20260625T164637Z-pixel4-c64u-b86877f43589/`

## Gates passed

- `npm run scope:check`: 55 files / 361 tests PASS (exit 0).
- APK build from HEAD: `BUILD SUCCESSFUL` (gradle assembleDebug, exit 0).
- Install: `Success`.

## Why this run differs from the prior bug-hunt

Prior `bug-hunt-report.md` tested the **buggy** `cf84d` APK and found S2 + C1/C2/C3, validated S1's catastrophic aspect not-reproduced (rapid path only). Those issues were then **fixed and committed** to HEAD. This run tests the **fixed** HEAD build to (a) verify the fixes hold on-device, (b) close the never-replayed **S1 idle-path**, and (c) hunt for new bugs across the surface that prior runs left untested.

This is a QA bug-search run. Per prompt: do NOT fix product bugs this run — find them with evidence.

## Prior discovery baseline (515e2 run): 290 CTAs

Home 106, Play 24, Disks 40, Config 28, Settings 74, Docs 18.

## Active phase

**COMPLETE (2026-06-25).** Session delivered the headline result: the months-long S1 catastrophic c64u wedge was reproduced, **root-caused (HttpURLConnection keep-alive reusing a stale idle socket), fixed (`http.keepAlive=false` in MainActivity), and verified on-device (A/B).** Plus a breadth bug hunt (6-route CDP error sweep, keypad parity, Config/Settings/Disks/Docs/Diagnostics/Switcher, lifecycle, perf) and cleanup. See `bug-hunt-report.md`, `cleanup-report-bughunt.md`, `defects/S1-ROOTCAUSE-*.md`, `defects/S4-*.md`.

Gates: scope:check PASS, lint+tsc PASS, Kotlin MainActivityTest PASS, APK build OK. Working tree dirty with the fix (uncommitted; no commit requested). Device left clean/healthy.

### Original Phase B (superseded)
Phase B: launch HEAD build, prove c64u-green baseline, set up CDP.

## Blocker list

(none hard) — both hardware preconditions green. Environmental risk: Pixel4↔c64u WiFi/DNS flakiness (caused S2 trigger in prior run); re-probe c64u before each C64U-dependent flow.

## Execution plan (priority order)

1. **[DONE]** Setup: state files, artifact root, scope:check, build+install HEAD APK.
2. Baseline: launch, prove green C64U / device c64u / fw 1.1.0 / Drive A ON No-disk, CDP forward.
3. **S1 idle-path replay** (highest value; never closed): mount Drive A readonly → ~200s idle → eject → verify c64u stays healthy. The original repro was `idleMs=197050,wasIdle=true`.
4. **S2 fix verification**: 5 mount/eject cycles; watch per-drive status recovery on poll (must clear without page re-mount).
5. CDP console/network/exception sweep across all 6 routes + overlays; keypad parity matrix (digits 1-6, star, pound, dpad, sliders, focus); touch parity.
6. Deep page coverage: Config categories+sub-pages+rows (+1 safe mutation/restore); Play source chooser/file browser/playlist/playback; Settings negative-path form validation (keyboard-aware); saved devices; Diagnostics redaction; Docs/Licenses accordions; Device Switcher.
7. Lifecycle (cold/warm/home/lock/rotate/relaunch/bg); performance timings; reliability reps (20x tab, 10x diag/switcher).
8. Cleanup + restore all mutated state; final bug-hunt report + ledgers.

## Remaining counts (live estimate)

- Routes: 6 main + overlays (Diagnostics, Device Switcher, mount sheet, source chooser, native picker).
- CTA: ~290 prior discovery; fresh per-route DOM enumeration via CDP this run.
- Negative paths: ~22 (C64U-dependent now executable).
- Lifecycle: ~12. Cleanup: full app-local + c64-config restore list.

## Exact next action

Launch `0.8.9-b8687` via DroidMind `android-app start`; capture baseline screenshot+hierarchy+DOM; if not green C64U, app-driven Save-and-Connect host c64u/pwd/80/21/23; set `adb forward tcp:9333 localabstract:webview_devtools_remote_<pid>`.
