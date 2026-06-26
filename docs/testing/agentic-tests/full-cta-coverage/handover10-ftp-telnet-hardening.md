# Handover 10 — FTP/Telnet connection-churn hardening (continuation prompt)

You are a Principal Android QA + Capacitor + C64U integration engineer. Continue the program to make C64 Commander bug-free against a **real, fragile C64U (fw 1.1.0)**, focused now on the **FTP-heavy and Telnet-heavy flows** — the final code areas not yet hardened. **Exercise them, record flaws in `docs/testing/agentic-tests/full-cta-coverage/defects/`, then fix them.** Do not stop until the FTP/Telnet hardening is implemented, verified, and (attended) on-device-proven, then resume the broader CTA matrix.

## Current state (2026-06-26)

- Repo `/home/chris/dev/c64/c64commander`, branch `test/full-cta-coverage-2`.
- **HEAD = `18e4f991`** "fix: harden c64u health polling + songlengths FTP read against fragile firmware" — the THREE fixes from this session are COMMITTED: (1) health-poll self-halt `useC64Connection.ts`; (2) songlengths no-timeout streaming read (FtpClientPlugin.kt + ftpClient.ts + native bridge + addFileSelections.ts); (3) FTP `resolveListing` cascade-cut on SocketTimeoutException. All unit-verified (tsc clean; changed-area suites green; Kotlin FtpClientPluginTest green).
- Working tree still has UNCOMMITTED docs: PLANS.md, WORKLOG.md, runs/final-bugfree-ledger.md, final-bugfree-report.md, cleanup-report-final.md, handover9.md, this file, defects/S1-FTP-TELNET-CONNECT-CHURN-WEDGES-C64U.md, defects/S2-PLAY-SID-ADD-... (the S2 one is committed in 18e4f991).
- Installed APK `0.9.0-rc1-fe212` (vc2036) ≈ HEAD code. **Rebuild from HEAD before on-device work** (`npm run cap:build && npm run android:apk`; vc may conflict → `adb uninstall uk.gleissner.c64commander` first).
- Pixel 4 `9B081FFAZ001WX` connected. c64u `192.168.1.167` fw 1.1.0 HEALTHY (HTTP 200, FTP 226, Telnet open). u64 `192.168.1.13` was DOWN this session. App connected to c64u, Home, clean (empty playlist, no disks). Note: Play page left with Shuffle/Repeat on + volume -42 dB (empty playlist; restore if desired).

## ⚠️ CRITICAL operating rule (2 power-cycles this session)

The c64u fw-1.1.0 FTP/TCP stack **wedges under bursts of connect/PASV cycles** (1541ultimate issue #364): all TCP (HTTP+FTP+Telnet) dies, ICMP stays alive, only a **physical power-cycle** recovers it. The user can power-cycle but said "don't make it a habit." RULES:
- NEVER fire bursts of FTP listings or telnet connects. Single gentle navigations (one folder, seconds apart) are SAFE (proven). The wedge needs a BURST.
- HTTP machine commands (/v1/info, /v1/drives, /v1/configs incl. PUT writes, Reset/Reboot/Pause/Menu — these route through HTTP "Web Remote Control", not telnet) are SAFE.
- Re-probe c64u (HTTP+FTP+Telnet) before/after any FTP/telnet-touching step. If FTP/HTTP return 000 + ICMP alive → wedged → STOP, preserve evidence (UTC, route, action, logcat, screenshot, `defects/`), request power-cycle.
- On-device proof of the hardening must be done ATTENDED (someone to power-cycle). Until then, verify by unit test + logcat connect-cycle counts.

## THE WORK — implement the FTP/Telnet hardening (full code audit done; flaw recorded in defects/S1-FTP-TELNET-CONNECT-CHURN-WEDGES-C64U.md)

Root flaw: every FTP directory listing is a full connect→login→PASV→disconnect cycle; a recursive C64U browse fires **N connect-cycles**; telnet capability discovery opens **~7-11 sessions (one per category)**. Connection-cycle COUNT is the binding constraint — pacing (800ms) cannot fix it; **connection REUSE** can.

Implement these fixes, smallest-safe / highest-leverage first. Each with a focused unit test; then `npm run typecheck` + targeted `vitest` + Kotlin tests + APK rebuild.

1. **[TELNET, high leverage, small] Reuse ONE session in capability discovery.** `src/lib/telnet/telnetCapabilityDiscovery.ts:325 discoverInitialMenu` calls `runner.withSession` per category (`:340`). Open the menu once and navigate to each category (RIGHT/select → read → ESC-back) within a SINGLE `runner.withSession`. Collapses ~10 connect/disconnect cycles → 1. Test: `tests/unit/telnet/telnetCapabilityDiscovery.test.ts`.

2. **[TELNET] Add telnet connect pacing.** `src/lib/deviceInteraction/deviceInteractionManager.ts:990 withTelnetInteraction` has no `applyFtpConnectPacing` analog. Add `telnetConnectCooldownMs` (new field in `src/lib/config/deviceSafetySettings.ts` presets; conservative ≈800ms) applied per host before each telnet connect. Tests: `deviceInteractionManager.scheduling.test.ts`, `deviceSafetySettings.test.ts`.

3. **[FTP, single highest leverage] Native recursive listing on ONE connection.** Add native `listDirectoryRecursive(host, port, path, maxDepth, maxEntries, ...)` to `android/app/src/main/java/uk/gleissner/c64commander/FtpClientPlugin.kt` that opens a SINGLE connection and walks the tree internally (reuse the cascade-cut `resolveListing` per folder on the same FTPClient), returning a flat entry list. Route `src/lib/sourceNavigation/ftpSourceAdapter.ts:129 listFilesRecursive` through it (one native call instead of N `listEntries`). Preserve abort signal + partial-failure list. Collapses N connect-cycles → 1 — **THE fix for the recursive-browse wedge.** Tests: `FtpClientPluginTest.kt` (+ MockFtpServerTest.kt), `tests/unit/sourceNavigation/ftpSourceAdapter.test.ts`.

4. **[FTP] Recursion cap** (max depth + max total listings) in the native recursive method / adapter — guardrail. Same tests as #3.

5. **[FTP] Bound the NLST per-name probe storm.** `FtpClientPlugin.kt resolveListingFromNames` (~:582) does up to ~4 commands/entry (`mlistFile` + PWD+CWD+CWD-restore via `synthesizeFileFromDirectoryProbe`). Cap the probe count and/or drop the CWD round-trip (it mutates server cwd). Only fires on LIST=null+MLSD-empty but is unbounded per dir. Test: `FtpClientPluginTest.kt`.

Lower priority (audit items #6/#7): align `ftpSourceAdapter.ts:137 maxConcurrent=3` to `config.ftpMaxConcurrency`; delete/harden test-only `src/lib/disks/ftpDiskImport.ts:34 walkFtpFolder` (unbounded, no abort — unreachable today). Already-SAFE (do NOT touch): single-file FTP reads/writes, FTP+telnet health probes, telnet session reuse for action-execute/config/REU workflows, songlengths streaming read, cascade-cut.

## On-device exercising (ATTENDED) after the fixes build

- **FTP recursive browse:** Play → Add items → C64U → browse into /USB2/test-data (gentle); confirm via logcat that the recursive scan fires ~ONE FTP connect cycle (not N) and c64u stays HEALTHY (HTTP+FTP). Then the wedge-prone path (add SIDs → songlengths discovery) should also be gentle.
- **Disks:** Add disks → C64U browse → /USB2/test-data/d64 → select Frogger.d64 → add → mount Drive A (HTTP) → verify → eject → re-probe health. 5 cycles if stable (S1 reliability).
- **Telnet:** reconnect (triggers capability discovery) → confirm ONE telnet session (logcat TelnetSocketPlugin) not ~10; exercise telnet-only actions (REU save/load with a RAM folder set, power-cycle/reboot if web service disabled) and confirm no churn/wedge.
- Record any flaw in `defects/`, fix, rebuild, re-verify.

## Then resume the broad CTA matrix (handover9.md)

Disks mount/eject reliability, locked-screen auto-advance, filtering (text/label/unicode/edge), negative-path Save-and-Connect, Device Switcher entry point, Docs/Licenses, full keypad matrix, lifecycle lock/rotate, performance/reliability reps, variant (C64U Remote) checks. Exhaustive ~1000-CTA coverage is a continuing program. Status report: `final-bugfree-report.md` (NOT BUGFREE-PROVEN — honest).

## Tooling recap

- Input: DroidMind MCP (`mcp__droidmind__android-ui` tap/swipe/input_text/press_key; `android-app` start/stop). **KEYBOARD TRAP:** WebView viewport does NOT reflow for the soft keyboard — after typing in a field, press BACK (keycode 4) to dismiss it BEFORE tapping a button (else the pre-keyboard coord hits a keyboard key; it corrupted the password as "pwdk" early on).
- Coords: device_px = css_px × (1080/innerWidth ≈ 2.755). Get via CDP `getBoundingClientRect`.
- Observe: `node scripts/bughunt-cdp.mjs eval|dom|listen` (CDP, read-only) + `adb exec-out screencap -p > file.png` + `adb logcat`. Telnet/FTP are native sockets — observe via logcat tags `FtpClientPlugin` / `TelnetSocketPlugin`, NOT CDP network.
- Tabs: Home 107 / Play 275 / Disks 440 / Config 611 / Settings 797 / Docs 978, all y=2034. Keypad digits 1-6 → tabs (KEYCODE 8-13); Star(17)→Diagnostics; Pound(18) did NOT open Switcher this build.
- Connect c64u: discovery dialog → "Use" on c64u → tap pw field → input_text "pwd" → CDP-verify len=3 → BACK → "Use Device". Health probes: `curl -H "X-password: pwd" http://c64u/v1/info`; `curl ftp://c64u/USB2/ -u user:pwd`; `bash -c 'echo > /dev/tcp/c64u/23'`.
- Artifact root: `c64scope/artifacts/final-bugfree-20260626T062957Z-pixel4-c64u-fe212a59/`.

## Honest framing

The connect-churn wedge is the residual hardening gap; reuse (fixes #1, #3) is the real lever. The firmware fragility itself is **external/unfixable in-app** (u64's 3.14x firmware fixed issue #364) — the app can only stop generating bursts. Do not claim BUGFREE-PROVEN until the exhaustive matrix + attended FTP/telnet on-device proof are complete.
