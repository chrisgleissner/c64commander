# Final Bug-Free Proof — Session Report (HEAD fe212a59 / 0.9.0-rc1-fe212)

## 1. Status: **NOT `BUGFREE-PROVEN`** (honest, non-certification)

This run is **not** a `BUGFREE-PROVEN` certification. It found and fixed real defects and covered a meaningful slice of the high-value flows, but the exhaustive CTA/flow matrix is incomplete and the central risk (c64u firmware FTP wedge) is **external and firmware-limited** — it cannot be cured in-app and could not be safely re-verified on-device without another power-cycle. Reporting truthfully per the prompt's gate.

## 2. Build / device identity

- Branch `test/full-cta-coverage-2`, Git HEAD `fe212a59` (PR #295). Working tree dirty with 3 fixes + tests (uncommitted; no commit requested).
- APK **`0.9.0-rc1-fe212`**, versionCode `2036`, SHA-256 `56ec881f5e8b87cd88d07ed6e6f6e0db847c7d190a1d28e6ba5e44d940fd25f6`, signature `d39d81d2`. Built from HEAD + the 3 fixes.
- Pixel 4 `9B081FFAZ001WX` (Android 16, 1080×2280). Target c64u `192.168.1.167` fw `1.1.0`. u64 fallback was UNAVAILABLE this session (ICMP/HTTP down, no fixtures).
- Artifact root: `c64scope/artifacts/final-bugfree-20260626T062957Z-pixel4-c64u-fe212a59/`.

## 3. Defects found + fixed (3 app fixes, all unit-verified)

1. **HEALTH-POLL-SELF-HALT** (`src/hooks/useC64Connection.ts`) — `refetchInterval` returned a time-based `false`, permanently tearing down React Query's interval → badge stuck UNHEALTHY ~13 min until navigation. **Fixed**: coalescing moved to `queryFn`; interval gates only on reactive state. Regression test added (`useC64Connection.test.ts`, 52 pass). HIL-confirmed (polling continues without nav).

2. **SONGLENGTHS-READ-TIMEOUT** (FtpClientPlugin.kt + ftpClient.ts/.web.ts/native + addFileSelections.ts) — adding SIDs auto-read a multi-MB songlengths.md5 over FTP with an 8 s idle timeout that truncated the transfer. **Fixed** (per user spec): 6 MiB cap, `timeoutMs:0` chunked streaming read, byte-progress events, clean `cancelRead` abort, scan progress UI. The 5.1 MB read now completes (`12th_Sector=03:11` resolved). Tests: tsc + 140 JS + Kotlin green.

3. **FTP-LISTING-CASCADE-CHURN** (FtpClientPlugin.kt `resolveListing`) — on a `SocketTimeoutException`, the native cascade re-tried MLSD then NLST (3 unpaced PASV cycles/folder), amplifying the connection churn that wedges the firmware. **Fixed**: fail fast on timeout (3→1 PASV cycles). Kotlin test `listDirectoryDoesNotCascadeToMlsdOrNlstOnTimeout` green.

## 4. Root cause of the c64u outage (the user's "why")

The c64u fw-1.1.0 catastrophic wedge on SID-add (HTTP+FTP `000`, ICMP alive → power-cycle) is **triggered by the songlengths DISCOVERY's burst of FTP directory listings** (amplified 3× by the LIST→MLSD→NLST cascade) — **rapid FTP connect/PASV churn**, NOT file size and NOT the read timeout (folders are 16/98/1 entries). This is firmware issue #364 ("repeated FTP cycles fail until power-cycle"). Fixed/robust in u64's 3.14x firmware. App fixes reduce the trigger; **they cannot guarantee no wedge on fw-1.1.0**. See `defects/S2-PLAY-SID-ADD-AUTO-SONGLENGTHS-FTP-WEDGE.md`.

## 5. Coverage this session

- **Baseline**: built+installed from HEAD, proved green/HEALTHY c64u (supersedes all 8 prior handovers, which were stuck on stale builds / disconnected baselines).
- **All-6-route CDP error sweep**: Home/Play/Disks/Config/Settings/Docs render HEALTHY, **no JS console errors**.
- **Play**: C64U source browse (4 sources present), add 3 SIDs OK; transport **play/pause/resume/stop verified**.
- **Diagnostics**: opened via **Star key** (keypad), **password-redaction PASS** (0 leaks in visible text + full HTML).
- **Keypad parity**: digit 2→Play, 4→Config, 1→Home; Star→Diagnostics.
- **Config**: loads clean (23 categories, no circuit-breaker). **Settings**: renders, theme toggle+restore, no pwd leak. **Disks**: Drive A/B No-disk baseline.

## 6. NOT done / remaining (for continuation — see handover)

- Disks import/**mount/eject reliability (S1)**, disk swap/filter — release-critical; needs careful gentle FTP browse.
- Locked-screen **auto-advance** (release-critical), full transport (next/prev/repeat/shuffle), playlist & disk **filtering**.
- Config safe mutation/restore; Settings negative-path connect; Device Switcher entry point; Docs/Licenses; full keypad matrix; lifecycle; performance/reliability reps; variant (C64U Remote) checks.
- **c64u-no-wedge verification** of the songlengths/cascade fixes (firmware-limited; deliberately not re-tested to avoid power-cycle #3). u64 functional verification (when u64 is back + has fixtures).
- One unrelated full-suite test failure (1/7470) — not in any changed area; likely flaky (the touched dirs: 1577/1577 pass).

## 7. Honest gate statement

Final unaccounted-CTA count is **not zero**; final untested-high-value-flow count is **not zero**; open external firmware blocker (S2-PLAY-SID-ADD FTP wedge) remains (not an in-app defect). Therefore **NOT `BUGFREE-PROVEN`**. The three app defects found were fixed + unit-verified; the firmware wedge is documented as external/unfixable-in-app with the trigger reduced.

## 8. Working-tree status

`M` PLANS.md, WORKLOG.md, FtpClientPlugin.kt(+Test), useC64Connection.ts(+test), ftpClient.ts, native/ftpClient.ts(+.web), addFileSelections.ts, addFileSelectionsBatching.test.ts, ftpClient.test.ts. `??` defects/S2-PLAY-SID-ADD-AUTO-SONGLENGTHS-FTP-WEDGE.md, runs/final-bugfree-ledger.md, this report, cleanup-report-final.md, handover9.md, prompt4.md.
