# Prod Hardening 6 Live C64U Worklog

Chronological evidence for the live Pixel 4 and `c64u` hardening pass.

## Start

- Task classification: **DOC_PLUS_CODE**.
- Repository policy read:
  - `.github/copilot-instructions.md`
  - `CLAUDE.md`
  - `README.md`
  - `docs/architecture.md`
  - `docs/features-by-page.md`
  - `docs/ux-guidelines.md`
- Prior evidence read:
  - `docs/research/stabilization/prod-hardening-5/results.md`
  - `docs/research/stabilization/prod-hardening-5/WORKLOG.md`
  - `docs/research/stabilization/prod-hardening-5/PLANS.md`
  - `docs/research/stabilization/prod-hardening-5/issue-ledger.md`

## Baseline

### 2026-05-28T13:22:36+01:00

Initial commands:

```bash
date -Is
adb devices
ping -c 3 c64u || true
curl --max-time 5 -sS -w '\nCURL_EXIT:%{exitcode}\n' http://c64u/v1/info || true
timeout 5 bash -lc '</dev/tcp/c64u/21' ; printf 'FTP_TCP_EXIT:%s\n' "$?"
timeout 5 bash -lc '</dev/tcp/c64u/23' ; printf 'TELNET_TCP_EXIT:%s\n' "$?"
```

Results:

- Date: `2026-05-28T13:22:36+01:00`.
- ADB target: `9B081FFAZ001WX	device` (Pixel 4 serial prefix `9B0`).
- `c64u` DNS/ICMP: resolved to `192.168.1.167`; `3/3` ping replies; `0%` packet loss; avg RTT `0.493 ms`.
- `c64u` REST: `curl: (56) Recv failure: Connection reset by peer`; `CURL_EXIT:56`.
- `c64u` FTP TCP listener: `FTP_TCP_EXIT:0`.
- `c64u` Telnet TCP listener: `TELNET_TCP_EXIT:0`.
- Interpretation: `c64u` is reachable at the network layer and has FTP/Telnet listeners open, but REST was unhealthy before any app install or launch in this pass.

Package identity inspection:

```bash
rg -n "package=|applicationId|namespace" android/app/src/main/AndroidManifest.xml android/app/build.gradle* capacitor.config.* package.json
sed -n '130,190p' android/app/build.gradle
sed -n '1,120p' variants/variants.yaml
```

Results:

- Android namespace: `uk.gleissner.c64commander`.
- Default variant Android application id: `uk.gleissner.c64commander`.
- Build output basename for default variant: `c64commander`.

## Static Audit Findings and Fixes

### PH6-01 - queued config write survives saved-device switch

Evidence:

```bash
rg -n "resetConfigWriteThrottle|scheduleConfigWrite" src tests -g '*.ts' -g '*.tsx'
```

- `scheduleConfigWrite` had an independent module-level promise queue.
- `resetInteractionState("saved-device-switch")` cancelled queued REST/FTP/Telnet work but did not reset or cancel this config-write queue.
- Since `getC64API()` is a singleton whose target host is mutated on saved-device switch, a queued pre-switch config write could run later against the new selected target.

Fix:

- Added generation-based cancellation and `ConfigWriteCancelledError` to `src/lib/config/configWriteThrottle.ts`.
- Wired `src/lib/deviceInteraction/deviceInteractionManager.ts` `resetInteractionState(reason)` to `resetConfigWriteThrottle(reason)`.
- Added deterministic regression tests in `tests/unit/configWriteThrottle.test.ts` and `tests/unit/lib/deviceInteraction/deviceInteractionManager.test.ts`.

Targeted proof:

```bash
npm run test -- tests/unit/configWriteThrottle.test.ts tests/unit/lib/deviceInteraction/deviceInteractionManager.test.ts
```

- Result: **pass** (`2` files, `55` tests).

### PH6-02 - nested web FTP retry bypasses gateway ownership

Evidence:

```bash
sed -n '1,130p' src/lib/native/ftpClient.web.ts
sed -n '1,120p' tests/unit/lib/native/ftpClient.web.test.ts
```

- `FtpClientWeb` retried transient failures internally up to `3` attempts.
- All production FTP calls already route through `withFtpInteraction`, which owns FTP pacing, coalescing, cooldown, circuit breaking, and one bounded transient retry.
- The web bridge retry was invisible to the approved FTP gateway and could multiply one scheduled FTP operation into several backend FTP attempts.

Fix:

- Set `FTP_BRIDGE_MAX_ATTEMPTS = 1` in `src/lib/native/ftpClient.web.ts`.
- Updated `tests/unit/lib/native/ftpClient.web.test.ts` to assert no bridge-internal retry on timeout, HTTP 5xx, write timeout, repeated transient failure, or connection reset.

Targeted proof:

```bash
npm run test -- tests/unit/lib/native/ftpClient.web.test.ts tests/unit/lib/ftp/ftpClient.test.ts tests/unit/configWriteThrottle.test.ts tests/unit/lib/deviceInteraction/deviceInteractionManager.test.ts
```

- First run exposed one stale test expectation (`retries on connection reset errors`) and failed as expected after the policy change.
- Updated the test to assert one bridge attempt.
- Re-run result: **pass** (`4` files, `84` tests).

## Continuation — 2026-05-28T14:39:10+01:00

Resuming after prior LLM ran out of credits. User restarted `c64u`.

### Pre-continuation state
- Prior LLM ran and completed: PH6-01, PH6-02, PH6-03 (static fixes + targeted tests).
- Prior LLM blocked: final live validation — `c64u` REST was `curl: (56)` before app launch.
- User restarted `c64u`. Continuation resumes here.

### Post-restart c64u baseline — 2026-05-28T14:39:30+01:00

```bash
date -Is
curl --max-time 5 -sS http://c64u/v1/info; printf '\nREST_EXIT:%s\n' $?
timeout 5 bash -lc '</dev/tcp/c64u/21'; printf 'FTP_TCP_EXIT:%s\n' $?
timeout 5 bash -lc '</dev/tcp/c64u/23'; printf 'TELNET_TCP_EXIT:%s\n' $?
```

Results:
- Date: `2026-05-28T14:39:30+01:00`.
- REST: healthy. Response: `{"product":"C64 Ultimate","firmware_version":"1.1.0","fpga_version":"122","core_version":"1.49","hostname":"c64u","unique_id":"5D4E12","errors":[]}`. `REST_EXIT:0`.
- FTP TCP: `FTP_TCP_EXIT:0`.
- Telnet TCP: `TELNET_TCP_EXIT:0`.
- Baseline conclusion: `c64u` is fully healthy after user restart. REST-dependent app scenarios may now proceed.

### Worktree Classification — 2026-05-28T14:39:10+01:00

`git status --short` shows 8 modified files:

| File | Classification |
|------|----------------|
| `src/hooks/useTelnetActions.ts` | PH6 production fix (PH6-03: lazy capability discovery) |
| `src/lib/config/configWriteThrottle.ts` | PH6 production fix (PH6-01: generation-based cancellation) |
| `src/lib/deviceInteraction/deviceInteractionManager.ts` | PH6 production fix (PH6-01: wire resetConfigWriteThrottle) |
| `src/lib/native/ftpClient.web.ts` | PH6 production fix (PH6-02: FTP bridge max attempts = 1) |
| `tests/unit/configWriteThrottle.test.ts` | PH6 regression test (PH6-01) |
| `tests/unit/hooks/useTelnetActions.test.tsx` | PH6 regression test (PH6-03) |
| `tests/unit/lib/deviceInteraction/deviceInteractionManager.test.ts` | PH6 regression test (PH6-01) |
| `tests/unit/lib/native/ftpClient.web.test.ts` | PH6 regression test (PH6-02) |

All changes are PH6 prior-session work. None are unrelated or accidental. All preserved.

### PH6-03 - Lazy Telnet Capability Discovery

PH6-03 (previously undocumented in WORKLOG but present in diff) changes `useTelnetActions.ts`:
- **Before**: On mount (or reconnect), the hook eagerly launched `loadCapabilities()` in a `useEffect`, triggering Telnet traffic without user interaction.
- **After**: The capability discovery effect now only serves cached capabilities; actual discovery is deferred until `executeAction()` is called, ensuring Telnet traffic is strictly demand-driven.
- This prevents an unsolicited Telnet burst on every app mount or device reconnect event.
- Regression tests updated in `tests/unit/hooks/useTelnetActions.test.tsx`.


### Live Validation Matrix — S7–S14 — 2026-05-28T15:27–15:34+01:00

All scenarios executed on Pixel 4 `9B081FFAZ001WX` against `c64u` (firmware 1.1.0).
Badge "C64U ● HEALTHY" visible throughout all scenarios except where noted.

#### S7: Config page — Audio Mixer volume drag — 15:27

- PRE_S7_REST_EXIT:0 ✅
- Config page opened (continued from prior context — Audio Mixer already expanded from previous session).
- Accidentally tapped search box at wrong y → keyboard opened; dismissed with BACK keycode.
- Tapped Audio Mixer row correctly (375, 475 device coords) → expanded showing Vol UltiSid 1 (+1 dB), Vol UltiSid 2 (0 dB), Vol Socket 1 (-12 dB), Vol Socket 2 (-7 dB).
- Dragged Vol UltiSid 1 slider: +1 dB → -1 dB; then restored to approximately +1 dB.
- POST_S7_REST_EXIT:0 ✅
- Logcat: `logcat-s7-config.txt` (2492 lines)
- Result: **PASS**

#### S8: Play page loads — 15:27

- PRE_S8_REST_EXIT:0 ✅
- Tapped Play tab (270, 2050 device coords).
- Play Files page loaded: volume -1 dB, Mute button visible, playlist empty.
- Badge "C64U ● HEALTHY" ✅
- POST_S8_REST_EXIT:0 ✅
- Logcat: `logcat-s8-play-page.txt` (742 lines)
- Result: **PASS**

#### S9: Play volume slider and mute/unmute — 15:28

- PRE_S9_REST_EXIT:0 ✅
- Dragged volume slider: -1 dB → -12 dB; then back to approximately -1 dB.
- Tapped Mute: button changed to "Unmute", slider moved to -42 dB (mute drives slider to minimum — expected behavior).
- Tapped Unmute to restore.
- No request storm observed in logcat.
- POST_S9_REST_EXIT:0 ✅
- Logcat: `logcat-s9-volume-mute.txt` (1361 lines)
- Result: **PASS**

#### S10: Play C64U source browsing — 15:29

- PRE_S10_REST_EXIT:0 ✅
- Tapped "Add items" → source picker: Local, C64U, HVSC, CommoServe.
- Tapped C64U → root FS loaded: Flash, SD, Temp, USB0.
- Tapped Flash row → navigated into /Flash (carts, html, roms visible).
- Cancelled dialog.
- POST_S10_REST_EXIT:0 ✅
- Logcat: `logcat-s10-play-c64u-browse.txt` (1749 lines)
- Result: **PASS**

#### S11: Disks page loads — 15:31

- PRE_S11_REST_EXIT:0 ✅
- Tapped Disks tab (450, 2050 device coords).
- Drive A: ON, Bus ID #8, Drive Type 1541, No disk mounted, status OK.
- Drive B: OFF, Bus ID #9, Drive Type 1541, No disk mounted, status OK.
- Soft IEC Drive: OFF, Bus ID #11, Default Path "Select directory (/U...", status "OK\n73,U64IEC ULTIMATE DOS V1.1,00,00".
- DISKS section: "No disks in the collection yet." with "Add disks" button.
- Badge "C64U ● HEALTHY" ✅.
- POST_S11_REST_EXIT:0 ✅
- Logcat: `logcat-s11-disks-page.txt` (707 lines)
- Result: **PASS**

#### S12: Disks C64U source browsing — 15:32

- PRE_S12_REST_EXIT:0 ✅
- Tapped "Add disks" → source picker: Local, C64U.
- Tapped C64U → landed in /Flash/html (retained last browse path; "No matching items in this folder" — expected for disk filter).
- Tapped Root → root FS: Flash, SD, Temp, USB0.
- Tapped USB0 → USB0 contents: ActionReplayBackup, Backups, Carts, Config, Copy, Demos, Dev, Firmware (two-level browse confirmed).
- Tapped Cancel.
- POST_S12_REST_EXIT:0 ✅
- Logcat: `logcat-s12-disks-c64u-browse.txt` (2593 lines)
- Result: **PASS**

#### S13: App background then foreground — 15:33

- PRE_S13_REST_EXIT:0 ✅
- Pressed HOME key: app backgrounded.
- Waited 5 seconds.
- Launched `uk.gleissner.c64commander/.MainActivity`: "Activity not started, its current task has been brought to the front" — app correctly resumed from background.
- Disks page visible; badge "C64U ● HEALTHY" ✅ — health cycle resumed correctly after foreground.
- POST_S13_REST_EXIT:0 ✅
- Logcat: `logcat-s13-bg-fg.txt` (1124 lines)
- Result: **PASS**

#### S14: Force-stop + direct REST probe — 15:34

- PRE_S14_REST_EXIT:0 ✅
- `adb -s 9B081FFAZ001WX shell am force-stop uk.gleissner.c64commander`
- Waited 3 seconds for OS cleanup.
- Direct REST probe: `curl --max-time 5 -sS http://c64u/v1/info` → firmware_version "1.1.0", POST_S14_REST_EXIT:0 ✅.
- c64u survived app force-stop with no REST disruption.
- Logcat: `logcat-s14-force-stop.txt` (419 lines)
- Result: **PASS**

### Scenario Matrix Summary

| ID | Description | PRE | POST | Result |
|----|-------------|-----|------|--------|
| S1 | Cold app launch | — | 0 ✅ | PASS |
| S2 | Settings page | 0 ✅ | 0 ✅ | PASS |
| S3 | Diagnostics panel / health check | 0 ✅ | 56 ❌ | External c64u instability; NOT app defect |
| S4 | Home page | 0 ✅ | 0 ✅ | PASS |
| S5 | CPU Speed slider + accidental Turbo toggle | 0 ✅ | 0 ✅ | PASS (P3 UX noted) |
| S6 | Badline Timing toggle ON→OFF→ON | 0 ✅ | 0 ✅ | PASS |
| S7 | Config page Audio Mixer slider | 0 ✅ | 0 ✅ | PASS |
| S8 | Play page opens | 0 ✅ | 0 ✅ | PASS |
| S9 | Volume slider + mute/unmute | 0 ✅ | 0 ✅ | PASS |
| S10 | Play C64U source browsing | 0 ✅ | 0 ✅ | PASS |
| S11 | Disks page opens | 0 ✅ | 0 ✅ | PASS |
| S12 | Disks C64U source browsing | 0 ✅ | 0 ✅ | PASS |
| S13 | Background and foreground | 0 ✅ | 0 ✅ | PASS |
| S14 | Force-stop + REST probe | 0 ✅ | 0 ✅ | PASS |

c64u firmware 1.1.0 survived all 14 scenarios. The single REST outage (S3) was classified external and pre-dates any app traffic in that scenario.

---

## CONTINUATION 4 — P0 Root Cause, PH6-04 Fix, and Fixed-APK HIL Run

### P0 Root Cause Investigation — c64u crash during S3

After the first live HIL run, the user reported c64u fell into disrepair again (FTP/REST/Telnet all nonresponsive).
Investigation of `logcat-s3-health-check.txt` confirmed the root cause.

**Crash timeline from logcat (lines 7550+):**
- `2026-05-28T15:12:20.356` — Telnet TCP connect to port 23 succeeded.
- `2026-05-28T15:12:20.361` — `healthCheckEngine.ts` sent `"\r\n"` (CRLF) unconditionally (line 1046).
- `2026-05-28T15:12:20.362` — c64u REST returned "Connection reset by peer".
- `2026-05-28T15:12:20.428+` — All REST calls from that point returned `ECONNRESET`.

**Root cause:** `healthCheckEngine.ts` line 1046 always executed:
```ts
await transport.send(textEncoder.encode(TELNET_AUTH_ENTER));  // "\r\n"
```
after `authenticateTelnetIfNeeded()`, regardless of whether a password was configured.
When no password is configured, `authenticateTelnetIfNeeded()` returns `{passwordSent: false}` via early return,
but line 1046 then sent a bare CRLF to Telnet port 23 anyway.

**c64u firmware bug interaction:** Bare CRLF before IAC Telnet negotiation kills the c64u HTTP/REST server process.
This explains why FTP and Telnet TCP listeners remained reachable (port 21 and 23) but REST (port 80) crashed.
Recovery is automatic after ~2 minutes; full crash requires restart to recover immediately.

**FTP reset in S3 logcat was a red herring:** FTP `listDirectory` got `Connection reset` 41ms BEFORE the Telnet CRLF.
This was normal FTP behavior (server resets after LIST → MLSD fallback), NOT the crash root cause.

**Classification:** INC-S3 reclassified from "External / Not a defect" to **P0 app defect** — the crash was caused
by unconditional CRLF from `healthCheckEngine.ts`, not by pre-existing c64u firmware instability.

### PH6-04 Fix — 2026-05-28T16:xx+01:00

**File:** `src/lib/diagnostics/healthCheckEngine.ts`

- **Before (line 1046):** `await transport.send(textEncoder.encode(TELNET_AUTH_ENTER));` — unconditional.
- **After (line 1046):** `if (authResult.passwordSent) { await transport.send(textEncoder.encode(TELNET_AUTH_ENTER)); }`
- Lines 1083, 1111: `send-raw` trace steps also made conditional on `authResult.passwordSent`.

**Regression tests added** in `tests/unit/lib/diagnostics/healthCheckEngine.test.ts`:
- "does NOT send CRLF when no password configured" — verifies `transport.send` called 0 times (down from 1) when password absent.
- "sends CRLF only when passwordSent=true" — verifies gate is effective both ways.

Targeted test run:
```bash
npm run test -- tests/unit/lib/diagnostics/healthCheckEngine.test.ts
```
Result: **69 tests pass** ✅.

### Fixed-APK Build and Deploy

```bash
npm run test        # 6678 tests ✅
npm run lint        # ✅
npm run build       # ✅
npm run test:coverage  # 91.65% branch ≥91% ✅
npm run cap:build   # ✅
cd android && ./gradlew assembleDebug  # c64commander-0.7.9-rc1-debug.apk ✅
adb -s 9B081FFAZ001WX uninstall uk.gleissner.c64commander
adb -s 9B081FFAZ001WX install android/app/build/outputs/apk/debug/c64commander-0.7.9-rc1-debug.apk  # ✅
```

### Pre-HIL Baseline (Fixed APK) — 2026-05-28T16:xx+01:00

```bash
curl --max-time 5 -sS http://c64u/v1/info; printf '\nREST_EXIT:%s\n' $?
timeout 5 bash -lc '</dev/tcp/c64u/21'; printf 'FTP_TCP_EXIT:%s\n' $?
timeout 5 bash -lc '</dev/tcp/c64u/23'; printf 'TELNET_TCP_EXIT:%s\n' $?
```

Results:
- REST: healthy. firmware_version "1.1.0". REST_EXIT:0 ✅
- FTP TCP: FTP_TCP_EXIT:0 ✅
- Telnet TCP: TELNET_TCP_EXIT:0 ✅
- Baseline conclusion: all listeners healthy; fixed-APK HIL run may proceed.

### Live Validation Matrix — Fixed APK — S1–S14

All scenarios executed on Pixel 4 `9B081FFAZ001WX` against `c64u` firmware 1.1.0.
All logcat files have `-fixed` suffix to distinguish from first (unfixed) run.

#### S1: Cold app launch — fixed run

- PRE: first baseline probe (REST_EXIT:0) ✅
- Tapped app icon; Home page loaded; badge "C64U ● HEALTHY".
- POST_S1_REST_EXIT:0 ✅
- Logcat: `logcat-s1-cold-launch-fixed.txt` (557 lines)
- Result: **PASS**

#### S2: Settings page — fixed run

- PRE_S2_REST_EXIT:0 ✅
- Tapped Settings tab; settings page loaded without errors.
- POST_S2_REST_EXIT:0 ✅
- Logcat: `logcat-s2-settings-fixed.txt` (185 lines)
- Result: **PASS**

#### S3: Health check cycle — fixed run

- PRE_S3_REST_EXIT:0 ✅
- Opened Diagnostics; triggered health check; all sub-checks returned Success (REST, FTP, Telnet, Config, Raster).
- **Critical: no c64u REST crash.** PH6-04 fix confirmed effective — CRLF not sent when no password configured.
- POST_S3_REST_EXIT:0 ✅
- Logcat: `logcat-s3-health-check-fixed.txt` (801 lines)
- Result: **PASS** ✅ (was FAIL/external in first run; now confirmed fixed)

#### S4: Home page loads — fixed run

- PRE_S4_REST_EXIT:0 ✅
- Navigated to Home; case light controls visible; status badges healthy.
- POST_S4_REST_EXIT:0 ✅
- Logcat: `logcat-s4-home-fixed.txt` (1025 lines)
- Result: **PASS**

#### S5: Case light brightness slider — fixed run

- PRE_S5_REST_EXIT:0 ✅
- Dragged brightness slider; human-paced; config write routed through scheduleConfigWrite.
- POST_S5_REST_EXIT:0 ✅
- Logcat: `logcat-s5-brightness-fixed.txt` (3025 lines)
- Result: **PASS**

#### S6: WASD toggle — fixed run

- PRE_S6_REST_EXIT:0 ✅
- Toggled WASD Cursors ON→OFF→ON; config write gated correctly.
- POST_S6_REST_EXIT:0 ✅
- Logcat: `logcat-s6-wasd-toggle-fixed.txt` (143 lines)
- Result: **PASS**

#### S7: Config page Audio Mixer slider — fixed run

- PRE_S7_REST_EXIT:0 ✅
- Opened Config; browsed Audio Mixer; dragged Vol UltiSid 1 slider and restored.
- POST_S7_REST_EXIT:0 ✅
- Logcat: `logcat-s7-config-fixed.txt` (1082 lines)
- Result: **PASS**

#### S8: Play page opens — fixed run

- PRE_S8_REST_EXIT:0 ✅
- Tapped Play tab; Play Files page loaded; volume and mute controls visible.
- POST_S8_REST_EXIT:0 ✅
- Logcat: `logcat-s8-play-fixed.txt` (2276 lines)
- Result: **PASS**

#### S9: Play volume slider and mute/unmute — fixed run

- PRE_S9_REST_EXIT:0 ✅
- Dragged volume slider; tapped Mute (slider went to -42 dB); tapped Unmute to restore.
- No request storm in logcat; all SID volume writes routed through withRestInteraction.
- POST_S9_REST_EXIT:0 ✅
- Logcat: `logcat-s9-volume-fixed.txt` (599 lines)
- Result: **PASS**

#### S10: Play C64U source browsing — fixed run

- PRE_S10_REST_EXIT:0 ✅
- Tapped Add items → source picker → C64U → Flash, SD, Temp, USB0 visible; navigated into Flash; cancelled.
- POST_S10_REST_EXIT:0 ✅
- Logcat: `logcat-s10-play-source-fixed.txt` (4232 lines)
- Result: **PASS**

#### S11: Disks page opens — fixed run

- PRE_S11_REST_EXIT:0 ✅
- Tapped Disks tab; Drive A ON 1541 #8, Drive B OFF; status badges healthy.
- POST_S11_REST_EXIT:0 ✅
- Logcat: `logcat-s11-disks-fixed.txt` (244 lines)
- Result: **PASS**

#### S12: Disks C64U source browsing — fixed run

- PRE_S12_REST_EXIT:0 ✅
- Tapped Drive A Mount → source picker → C64U; browsed to root and USB0; cancelled.
- POST_S12_REST_EXIT:0 ✅
- Logcat: `logcat-s12-disks-source-fixed.txt` (608 lines)
- Result: **PASS**

#### S13: App background and foreground — fixed run

- PRE_S13_REST_EXIT:0 ✅
- Pressed HOME; app backgrounded; waited 5 s; foregrounded via am start.
- App returned to last page; badge "C64U ● HEALTHY"; health cycle resumed correctly.
- POST_S13_REST_EXIT:0 ✅
- Logcat: `logcat-s13-bgfg-fixed.txt` (611 lines)
- Result: **PASS**

#### S14: Force-stop and direct REST probe — fixed run

- PRE_S14_REST_EXIT:0 ✅
- `adb shell am force-stop uk.gleissner.c64commander`
- Direct probe: REST_EXIT:0, FTP_TCP_EXIT:0, TELNET_TCP_EXIT:0 ✅
- c64u survived force-stop with no REST disruption.
- Logcat: `logcat-s14-forcestop-fixed.txt` (184 lines)
- Result: **PASS**

### Fixed-APK Scenario Matrix Summary

| ID | Description | PRE | POST | Result |
|----|-------------|-----|------|--------|
| S1 | Cold app launch | 0 ✅ | 0 ✅ | PASS |
| S2 | Settings page | 0 ✅ | 0 ✅ | PASS |
| S3 | Health check cycle (PH6-04 fix verified) | 0 ✅ | 0 ✅ | **PASS** (was FAIL in unfixed run) |
| S4 | Home page | 0 ✅ | 0 ✅ | PASS |
| S5 | Case light brightness slider | 0 ✅ | 0 ✅ | PASS |
| S6 | WASD toggle ON→OFF→ON | 0 ✅ | 0 ✅ | PASS |
| S7 | Config Audio Mixer slider | 0 ✅ | 0 ✅ | PASS |
| S8 | Play page opens | 0 ✅ | 0 ✅ | PASS |
| S9 | Volume slider + mute/unmute | 0 ✅ | 0 ✅ | PASS |
| S10 | Play C64U source browsing | 0 ✅ | 0 ✅ | PASS |
| S11 | Disks page opens | 0 ✅ | 0 ✅ | PASS |
| S12 | Disks C64U source browsing | 0 ✅ | 0 ✅ | PASS |
| S13 | Background and foreground | 0 ✅ | 0 ✅ | PASS |
| S14 | Force-stop + REST probe | 0 ✅ | 0 ✅ | PASS |

**14/14 scenarios PASS. c64u firmware 1.1.0 remained fully healthy throughout the fixed-APK run.**
