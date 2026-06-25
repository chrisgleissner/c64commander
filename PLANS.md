# PLANS.md — C64 Commander Exhaustive Bug Hunt (Pixel 4)

## Identity (verified this session 2026-06-25T12:58Z)

- Branch: `test/full-cta-coverage`
- Git SHA: `cf84d8e565cbc1511bfe9758887af7c9ae07fba8`
- Working tree: DIRTY. Product-code delta: `src/lib/c64api.ts` (Connection: close, c64-only). QA docs/test files dirty (expected).
- Installed APK: `0.8.9-cf84d`, versionCode `2044`, SHA-256 `462bfa1578c219d1f753311695688863c68bdda27480a449823ce60b36d49a07` = committed HEAD (not rebuilt; delta is c64-only, untestable while c64u down).
- Installed app: **FULL C64 Commander** (package `uk.gleissner.c64commander`), NOT the stripped C64U Remote variant.
- Pixel 4: `9B081FFAZ001WX`, Pixel 4, Android 16 / SDK 36, 1080x2280 @ 440dpi.
- C64 target `c64u` (192.168.1.167): L2 REACHABLE, **HTTP 000 (web stack DOWN)** — C64U-dependent flows BLOCKED.
- `u64` (192.168.1.13): HTTP 200 — FORBIDDEN for closure.
- UI: WebView app. DOM visible only via **CDP** (Chrome/148 @ http://localhost/). Product input via **DroidMind**.

## Artifact root

`c64scope/artifacts/bughunt-20260625T125855Z-pixel4-c64u-cf84d8e565cb/`

## Prior discovery baseline (515e2 run): 290 CTAs

Home 106, Play 24, Disks 40, Config 28, Settings 74, Docs 18.

## Active phase

FIXES COMPLETE + VERIFIED ON DEVICE (2026-06-25). All identified issues (S2, C1, C2, C3) fixed in product code and verified on Pixel 4 → c64u (u64 fallback). Fixed build APK SHA-256 `5c6625f7c42f4c8b73e6be8d13b563ec602be24df7a8e84a346c94eba168aca7`. Gates: typecheck + 7458 unit tests + lint all PASS. See `fix-report.md`. App left connected/clean. No commit made (not requested).

Earlier: `bug-hunt-report.md` (focused-deep bug hunt) found S2 + validated S1.

### Key outcomes
- **S2-DISKS-DRIVE-A-STATUS-STUCK-HOST-UNREACHABLE** PROVEN (2/5): Drive A status sticks on "Host unreachable" after slow/failed mount; Drive B unaffected; clears only on page re-mount.
- **S1** catastrophic connection-reset NOT reproduced in 5 rapid cycles (c64u 403/7-8ms throughout); `Connection: close` fix appears effective; idle-path replay still recommended.
- Diagnostics password redaction PASS; keypad shortcuts work; no crashes/exceptions.

### Remaining for a true exhaustive run
per-CTA accounting of ~290 controls; all Config sub-pages/rows; Play file browser/playlist/playback; keyboard-aware negative-path form validation; lifecycle (lock/rotate/relaunch/bg); reliability 20× reps; native picker/share; full touch-vs-keypad parity; S1 idle-path replay; C64U Remote *variant* build.

## Blocker list

1. **c64u HTTP stack DOWN (HTTP 000)** — blocks ALL C64U-dependent flows: Home device/firmware status, Play C64U/HVSC/CommoServe, Disks mount/eject (incl. S1 replay), Config device reads, Save-and-Connect success, gate3, gate7. NOT a stop condition. Re-probe periodically; may need user power-cycle (S1 is this failure mode).
2. C64U Remote variant not installed (full app installed) — variant-specific scope deferred / SPEC noted.

## Execution strategy

- **Engine 1 — c64scope offline gates**: discoverRoutes → keypad → gate4 → gate5 → gate6 → gate65. gate3/gate7 → expect BLOCKED. Pass `--device=9B081FFAZ001WX --target=c64u --start-app`.
- **Engine 2 — CDP observation**: enumerate real CTA DOM per route; capture console errors/exceptions/network across all routes & interactions (richest bug source in a WebView app).
- **Engine 3 — manual DroidMind**: negative-path form validation (invalid/empty host, bad ports — app-local), disconnected-state UI quality, Diagnostics redaction, Docs accordions, Device Switcher, lifecycle, performance.

## Task ledger (high-level)

| # | Area | Status | Engine |
|---|------|--------|--------|
| 1 | Infra: state files, identity, artifact root | DONE | - |
| 2 | scope:check validation | DONE (exit 0) | - |
| 3 | Baseline launch capture | DONE (Home, Not connected) | - |
| 4 | discoverRoutes (CTA inventory all 6 tabs) | IN_PROGRESS | 1 |
| 5 | keypad canary matrix | NOT_STARTED | 1 |
| 6 | gate4/5/6/65 (mutation, contracts, page waves) | NOT_STARTED | 1 |
| 7 | gate3/gate7 (expect BLOCKED, record) | NOT_STARTED | 1 |
| 8 | CDP per-route DOM + console error sweep | NOT_STARTED | 2 |
| 9 | Settings negative-path validation | NOT_STARTED | 3 |
| 10 | Disconnected-state UI quality (Home/Play/Disks/Config) | NOT_STARTED | 3 |
| 11 | Diagnostics (open all routes, tabs, export, redaction) | NOT_STARTED | 3 |
| 12 | Docs/Licenses accordions | NOT_STARTED | 3 |
| 13 | Device Switcher | NOT_STARTED | 3 |
| 14 | Lifecycle (cold/warm/home/lock/rotate/relaunch/bg) | NOT_STARTED | 3 |
| 15 | Performance + reliability repetitions | NOT_STARTED | 1/3 |
| 16 | S1 Drive A mount/eject replay | SAFETY_BLOCKED (c64u down) | 3 |
| 17 | Cleanup + final state restore | NOT_STARTED | 3 |
| 18 | Final bug-hunt report | NOT_STARTED | - |

## Remaining counts (live estimate)

- Routes: 6 main + overlays (Diagnostics, Device Switcher, mount sheet, source chooser, native picker).
- CTA: ~290 prior; awaiting fresh discoverRoutes inventory.
- Negative paths: ~12 app-local executable now; ~10 C64U-dependent blocked.
- Lifecycle: ~12 cases. Cleanup: full app-local restore list.

## Exact next action

Launch offline gate sequence in background (discoverRoutes first) with `--device=9B081FFAZ001WX --target=c64u --start-app`, capturing stdout/stderr to artifact logs/commands.
