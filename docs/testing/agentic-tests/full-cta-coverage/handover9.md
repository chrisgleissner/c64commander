# Handover 9 — 3 app fixes landed; c64u firmware FTP wedge root-caused; broad matrix remains

## State (2026-06-26, end of session)

- Branch `test/full-cta-coverage-2`, HEAD `fe212a59`. **Working tree dirty with 3 fixes + tests (uncommitted).**
- Installed APK: **`0.9.0-rc1-fe212`** vc2036 SHA `56ec881f` — HEAD + the 3 fixes. App connected to **c64u**, HEALTHY, Home. Device clean (no disks, empty playlist, theme Auto).
- c64u healthy (HTTP 200, FTP 226). u64 was DOWN this session (ICMP/HTTP 000, no fixtures).
- Artifact root: `c64scope/artifacts/final-bugfree-20260626T062957Z-pixel4-c64u-fe212a59/`.

## The 3 fixes (verify green before any commit)

1. `src/hooks/useC64Connection.ts` — health-poll self-halt (test in useC64Connection.test.ts, 52 pass).
2. Songlengths no-timeout read — FtpClientPlugin.kt readFile streaming + cancelRead; ftpClient.ts/.web.ts/native; addFileSelections.ts (6 MiB cap + progress + abort). Tests in ftpClient.test.ts, addFileSelectionsBatching.test.ts, FtpClientPluginTest.kt.
3. FtpClientPlugin.kt resolveListing — cascade cut on SocketTimeoutException (test listDirectoryDoesNotCascadeToMlsdOrNlstOnTimeout).

Gates: `npx tsc -p tsconfig.app.json --noEmit` clean; touched dirs `npx vitest run tests/unit/lib/ftp tests/unit/pages/playFiles tests/unit/hooks tests/unit/query tests/unit/lib/config tests/unit/lib/native` = 1577 pass; `cd android && ./gradlew :app:testDebugUnitTest --tests '*FtpClientPluginTest*'` BUILD SUCCESSFUL. (Full JS suite: 1 unrelated failure in a non-changed area — likely flaky; identify before committing.)

## ⚠️ c64u FTP wedge — CRITICAL operating rule

The c64u fw-1.1.0 firmware FTP **wedges under rapid FTP connect/PASV churn** (issue #364). It was power-cycled TWICE this session by the songlengths discovery's listing burst. RULES:
- NEVER fire bursts of FTP listings. Browse ONE folder at a time, spaced out. The wedge needs a burst; single gentle navigations are safe (proven).
- HTTP ops (/v1/info, /v1/drives, /v1/configs, mount/eject) are SAFE — they don't use the fragile FTP.
- Re-probe c64u (HTTP+FTP) before/after any FTP-touching step; if FTP returns 000 → wedged → STOP, preserve evidence, request power-cycle.
- The cascade-cut fix reduces churn but **does NOT guarantee no wedge on fw-1.1.0**. Real cure = firmware (u64 3.14x).

## Exact next actions (priority order)

1. **Disks mount/eject (S1, release-critical, HTTP-safe mount).** Disks → "Add disks" (coords drift; re-derive via CDP — last attempt at (872,2092) misfired to Settings). Browse C64U GENTLY → /USB2/test-data/d64 → select one disk (Frogger.d64, 174 KB) → add → mount to Drive A (HTTP) → verify mounted + Home drive summary → eject → verify No-disk → re-probe c64u health. Repeat 5× only if stable. Screenshot+hierarchy before/after each activation.
2. **Locked-screen auto-advance** (needs a playlist — add 1-2 PRGs/SIDs gently, no big songlengths). Inspect logcat for `backgroundAutoSkipDue`.
3. Full transport (next/prev/repeat/shuffle/rapid); playlist + disk **filtering** (text/label/unicode/zero/many).
4. Config safe mutation+restore (single-item via PUT — see led-slider memory); Settings negative-path connect (invalid host/port/pwd → graceful error → restore); Device Switcher entry point (Pound didn't work — try tapping the device badge or Settings device section); Docs/Licenses; lifecycle; reliability reps; **variant (C64U Remote) checks**.
5. Songlengths c64u-no-wedge: only re-test if willing to risk a power-cycle, or verify on u64 when it's back + has /USB2/test-data/SID/.../Songlengths.md5.

## Tooling recap

- Input: DroidMind MCP (`mcp__droidmind__android-ui` tap/swipe/input_text/press_key; android-app start/stop). KEYBOARD TRAP: WebView viewport does NOT reflow for the soft keyboard — after typing in a field, press BACK (keycode 4) to dismiss the keyboard BEFORE tapping a button, or the pre-keyboard coord lands on a keyboard key.
- Coords: device_px = css_px × (1080/innerWidth ≈ 2.755). Get via CDP `getBoundingClientRect`.
- Observe: `node scripts/bughunt-cdp.mjs eval/dom/listen` (CDP, read-only) + `adb exec-out screencap` to file + `adb logcat`. Tab coords: Home 107 / Play 275 / Disks 440 / Config 611 / Settings 797 / Docs 978, all y=2034. Keypad: digits 1-6 → tabs (KEYCODE 8-13); Star(17)→Diagnostics.
- Connect c64u: discovery dialog → "Use" on c64u → tap pw field → input_text "pwd" → verify len=3 via CDP → BACK → "Use Device".
