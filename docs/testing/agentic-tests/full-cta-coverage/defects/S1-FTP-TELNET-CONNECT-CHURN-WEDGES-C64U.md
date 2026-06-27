# S1-FTP-TELNET-CONNECT-CHURN-WEDGES-C64U — recursive FTP browse + telnet capability discovery fire bursts of connect/PASV cycles that wedge the fragile c64u firmware

- Severity: **S1** (recurring real-world trigger of the c64u TCP-stack wedge → physical power-cycle)
- Status: **ROOT-CAUSED → app-side hardening (connection reuse) is the fix; firmware fragility is external**
- Build context: discovered on `0.9.0-rc1-fe212` (HEAD fe212a59 + prior fixes). Pixel 4 → c64u fw 1.1.0.
- Supersedes the "songlengths read timeout" framing — the wedge trigger is **connection-cycle COUNT**, not the read.

## Root cause (from full FTP/Telnet code audit + 2 on-device wedges this session)

The c64u fw-1.1.0 embedded (lwIP) FTP/TCP stack wedges under **rapid connect/PASV churn** (1541ultimate issue #364). Two app paths generate bursts of connect cycles:

### FTP — every directory listing is a full connect→login→PASV→disconnect cycle
- `FtpClientPlugin.kt` `listDirectory`/`readFile`/`writeFile`/`pingFtp` each do a **complete connect+login+PASV+op+disconnect per call**. No session/keep-open API exists.
- `src/lib/sourceNavigation/ftpSourceAdapter.ts:129 listFilesRecursive` recurses by calling `listEntries(folder)` **per directory** → **N connect-cycles per recursive scan**.
- Triggers: Play "Add items" C64U browse (`addFileSelections.ts:751`), Disks "Add disks" C64U browse (`HomeDiskManager.tsx:1196`), **songlengths discovery** (`addFileSelections.ts:869` — a 2nd full recursive pass).
- The `ftpListCooldownMs=800` pacing only spaces *between* native calls; it **cannot reduce the number of connect cycles**, and 800ms pacing already wedged the device. **Connection-cycle COUNT is the binding constraint.**
- No depth/total-listing cap on the recursion (`visited` cycle-guard only).
- Native NLST fallback (`resolveListingFromNames:582`) does up to ~4 commands per entry (`mlistFile` + PWD+CWD+CWD-restore) — an unbounded per-directory command storm when reached (only on LIST=null + MLSD-empty).

### Telnet — capability discovery opens a fresh session PER category
- `src/lib/telnet/telnetCapabilityDiscovery.ts:325` `discoverInitialMenu` calls `runner.withSession` **once for root + once per top-level category** (`:340`) = **~7-11 connect/auth/disconnect cycles back-to-back**, all inside ONE telnetScheduler slot, **UNPACED** (`withTelnetInteraction` has no `applyFtpConnectPacing` analog). Per firmware #364, repeated telnet cycles wedge the stack too.
- The telnet **session** layer (`telnetSession.ts`) already reuses one connection correctly for action-execute and config/REU workflows — only the *discovery* layer churns.

## Why this is the residual hardening gap

Prior fixes (songlengths no-timeout read; LIST→MLSD→NLST cascade-cut on timeout) reduced amplification but did NOT remove the underlying **N-connect-cycle bursts** of the recursive browse and telnet discovery. These bursts are the dominant recurring wedge trigger against a real c64u.

## Fix (this defect) — collapse the connect-cycle bursts via reuse + caps

1. **[FTP, highest leverage] Native recursive listing on ONE connection.** Add a native `listDirectoryRecursive(host, port, path, maxDepth, maxEntries)` that opens a SINGLE connection and walks the tree internally (reusing the cascade-cut `resolveListing` per folder on the same FTPClient), bounded by depth/total. Route `ftpSourceAdapter.listFilesRecursive` through it → **N connect-cycles → 1** per scan. Preserve abort + partial-failure semantics.
2. **[FTP] Recursion cap** (max depth + max total listings) — guardrail against pathological trees.
3. **[TELNET, high leverage] Reuse ONE session in capability discovery** — open the menu once and navigate to each category within a SINGLE `runner.withSession` instead of one per category → **~10 cycles → 1**.
4. **[TELNET] Telnet connect pacing** — add `telnetConnectCooldownMs` (deviceSafetySettings conservative ≈800ms) applied per host in `withTelnetInteraction`, so discovery/action/health connects can't cluster.
5. **[FTP] Bound the NLST per-name probe storm** (cap probes / drop the CWD round-trip that mutates server cwd).

## Already-hardened (audit confirmed SAFE — no action)

Single-file FTP reads/writes (playback/origin/config-ref/RAM save-load, 1 cycle, graceful); FTP+telnet health probes (sequential ~60s, circuit-broken); telnet session reuse for action-execute + config/REU workflows; FTP scheduler concurrency=1 + connect cooldown + circuit breaker + single-retry-then-fail; songlengths streaming read (fix a); cascade-cut (fix). Legacy `ftpDiskImport.walkFtpFolder` is test-only/unreachable (least hardened — remove or ignore).

## Verification plan

Unit: `FtpClientPluginTest.kt` (recursive-list reuse + caps), `ftpSourceAdapter.test.ts` (single native call + abort + caps), `telnetCapabilityDiscovery.test.ts` (one session), `deviceInteractionManager.scheduling.test.ts`/`deviceSafetySettings.test.ts` (telnet pacing). On-device (attended, power-cycle-ready): recursive C64U browse fires **one** FTP connect cycle (logcat) and does NOT wedge; reconnect (telnet discovery) fires one telnet session.
