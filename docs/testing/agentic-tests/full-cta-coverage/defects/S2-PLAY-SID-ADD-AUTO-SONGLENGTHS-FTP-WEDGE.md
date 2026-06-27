# S2-PLAY-SID-ADD-AUTO-SONGLENGTHS-FTP-WEDGE — Adding SIDs auto-reads a Songlengths.md5 over FTP; the c64u FTP data channel wedges → 60s+ "scan", red error, health UNHEALTHY, ~13 min no auto-repoll

- Severity: **S2** (functional add still succeeds; but bad UX + drives device FTP into a wedge needing power-cycle)
- Status: **OPEN — root cause is a c64u FIRMWARE FTP defect (external); app-side behaviors flagged for review/fix**
- Build: `0.9.0-rc1` vc2036 (HEAD fe212a59). Pixel 4 `9B081FFAZ001WX` → c64u 192.168.1.167 fw 1.1.0.
- First reproduced UTC: 2026-06-26T06:38Z. Artifact root: `c64scope/artifacts/final-bugfree-20260626T062957Z-pixel4-c64u-fe212a59/`.

## Reproduction (exact)

1. Connected, healthy baseline (badge HEALTHY, device c64u, fw 1.1.0).
2. Play → Add items → **C64U** → browse `/USB2/test-data/SID/`.
3. Select 3 small SIDs (10_Orbyte.sid 1584B, 12th_Sector_Music.sid 9982B, 1982.sid 4920B) via their selection circles → "3 selected".
4. **Add to playlist.**

## Observed

- The add triggers a **"Scanning… 3 items"** progress that **climbs past 01:00** (60s+) for 3 tiny files.
- During the scan, a **burst of ~13 `/v1/configs` reads** fires (Audio Mixer / SID Sockets / SID Addressing / Vol UltiSid 1-2 / Vol Socket 1-2 / SID Socket 1-2 / UltiSID 1-2 Address) — SID playback-setup reads — serialized ~50–80ms apart (consistent with restMaxConcurrency=1).
- The app **auto-selects a `Songlengths.md5`** (`/USB2/test-data/SID/.../Songlengths.md5`) and **reads it over FTP**.
- The FTP read fails: page shows red **"FTP readFile timed out after connect 1500ms / transfer 8000ms"**.
- Health badge flips to **`◆ 5 UNHEALTHY`** (5 = consecutive failures).
- The 3 SIDs **are still added** (Total 9:00 = 3 × default 3:00; durations NOT resolved from songlengths).
- After the failure, the app **stops auto-polling `/v1/info`** (last poll 06:40:14; next only at 06:53:06 — **~13 min gap**); badge stays UNHEALTHY the whole time even though HTTP `/v1/info` returns 200 within seconds.
- **Navigating Home→ forces a fresh `/v1/info`+`/v1/drives` poll and the badge immediately recovers to HEALTHY.** So the badge is NOT permanently stuck — it recovers on re-poll/interaction.

## Root cause split

**Firmware (external, unfixable in-app):** the c64u FTP control channel works (220/230/257/250) but **`PASV` times out (10–12s, 0 bytes)** — the firmware's FTP data subsystem wedges. After this, all FTP data transfers fail until **power-cycle** (HTTP stays fully healthy: /v1/info, /v1/drives = 200 fast). Matches 1541ultimate firmware issue #364 (repeated FTP cycles fail until power-cycle). The app's timed-out songlengths read is the trigger.

**App-side behaviors to review (candidate fixes):**
1. **Auto songlengths FTP read on SID add.** Adding SIDs auto-discovers a `Songlengths.md5` and reads it over the fragile c64u FTP synchronously inside the add flow. Consider: making it opt-in, caching, reading via HTTP if available, or at minimum not blocking the add / not letting its failure dominate the health signal. (HVSC `Songlengths.md5` can be multi-MB; on the slow c64u FTP an 8000ms transfer cap will routinely time out.)
2. **~13 min health-poll gap after failures.** After the consecutive failures the app appears to back off auto-polling and only resumes on user navigation, so the badge reads UNHEALTHY long after HTTP recovered. If this is an intentional circuit-breaker backoff, the backoff window may be too long / should resume sooner once a single probe succeeds.
3. **60s+ "Scanning…" for 3 tiny files** is dominated by the FTP timeout(s); acceptable only if the FTP read is made non-blocking/bounded.

## Evidence

- `wedge-evidence/wedge-01-badge-healthy-device-000.png` (mid-burst: my infra probe collided → HTTP 000 transient)
- `screenshots/11-after-scan-playlist.png` (red "FTP readFile timed out…", badge `◆ 5 UNHEALTHY`, Songlengths auto-selected, Total 9:00)
- `wedge-evidence/wedge-02-home-recovered-healthy.png` (badge recovered HEALTHY after Home nav)
- `logs/cdp-console-stream.jsonl` (the /v1/configs burst at 06:38:12-13; poll gap 06:40:14→06:53:06; 2 console.error at 06:45)
- FTP PASV-timeout transcript in WORKLOG (220/230/257/250 then PASV 10s timeout).

## Impact

- The C64U **FTP** source (Play C64U browse, Disk import-from-C64U) becomes **unusable until the device is power-cycled**, after a routine "add SIDs" action.
- Confusing UX: a 60s+ scan, a scary red FTP error, and a red UNHEALTHY badge that lingers ~13 min, for a successful add.

## UPDATE 2026-06-26 — wedge reproduced WITH the no-timeout fix; true root cause = FTP listing churn

After implementing the no-timeout streaming read (6 MiB cap + `timeoutMs:0` + progress + abort) and reinstalling (`0.9.0-rc1-fe212`), re-running the exact add (3 SIDs from `/USB2/test-data/SID/`) **still catastrophically wedged the c64u** (HTTP+FTP both `000` refused, ICMP 0% loss → power-cycle required). User power-cycled (2nd time this session).

**The no-timeout read change was NOT the trigger.** Logcat (`wedge2-evidence/full-logcat.log`) shows the wedge onset was in the songlengths **DISCOVERY directory-listing scan**, BEFORE the read:
- 08:46:11→08:47:08: **9 × `SocketTimeoutException: Read timed out`** on FTP listings, each cycling `LIST (8s) → MLSD fallback (8s) → NLST fallback (8s)` — i.e. **3 PASV data-channel connections per folder**, unpaced (the cascade is internal to one native `listDirectory` call; the 800 ms `ftpListCooldownMs` pacing only spaces *between* calls, not the internal cascade).
- 08:47:08: the no-timeout `readFile(Songlengths.md5, timeoutMs:0, totalBytes:5151881)` then started.
- 08:48:42 & 08:49:42: `E Capacitor: Connection reset` — device wedged.

The songlengths-path folders are SMALL (16/98/1 entries, <1 s from a spaced-out host listing), so size is NOT the cause. The cause is **rapid repeated FTP connect/PASV/disconnect cycling** — the discovery fires a burst of folder listings and the `LIST→MLSD→NLST` cascade triples the PASV churn — which the single-threaded fw-1.1.0 firmware FTP cannot take (1541ultimate issue #364). Spaced single host listings never wedge it; the app's discovery burst does.

Note: the read DID resolve at least one real duration (`12th_Sector_Music = 03:11`, not the default 3:00) before/while the device died, confirming the read path itself works when the firmware is alive.

## Fix (this update)

**App-side prevention (reduce FTP churn — the trigger):**
- **FtpClientPlugin.kt `resolveListing`: do NOT cascade to MLSD/NLST after a `SocketTimeoutException`.** A timeout means the firmware data channel is buckling; opening two more PASV connections that also time out triples the wedge-inducing churn and never succeeds. Fail fast on timeout; cascade only for genuine LIST-unsupported/capability errors. This cuts per-struggling-listing PASV cycles 3→1.

**Recommended follow-ups (not all done this session):**
- Reduce songlengths DISCOVERY listing count for ultimate sources (cap folders listed, early-exit once found, prefer a single targeted read of the known candidate path over listing).
- Consider firmware-aware FTP pacing bump for fw ≤ 1.1.0.
- **Real cure = firmware:** u64's 3.14x firmware fixed this FTP class. fw-1.1.0 remains fundamentally fragile to FTP churn; the app can only reduce the trigger, not guarantee no wedge. Best-effort + graceful degradation (already present) is the realistic ceiling on fw-1.1.0.

## Honest limitation

The cascade-cut prevention is verified by unit test + reduces churn 3×, but **c64u-no-wedge cannot be GUARANTEED on fw-1.1.0** and was deliberately NOT re-tested on the device (re-wedging would force another power-cycle). Functional verification of songlengths resolution is done on **u64 (3.14x, robust FTP)**.

## Not yet determined

- Whether the app's FTP read pattern (PASV per read, connection handling) *contributes* to wedging the firmware FTP vs. merely exposing it.
- Whether durations would resolve correctly if the songlengths read succeeded (cannot test until FTP restored).
