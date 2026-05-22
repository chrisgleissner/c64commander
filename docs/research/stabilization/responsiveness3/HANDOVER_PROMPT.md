# HANDOVER_PROMPT — C64 Commander Responsiveness 3 Handoff

Written 2026-05-18. Resume from this file if context is compacted or the agent
is restarted between investigation and implementation.

## What this folder is

Responsiveness3 is a **second-tier investigation** that picks up after
PR #258 (responsiveness2) closed the badge-truthfulness contract. The
investigation found that with the badge fixed, the **cold-boot REST storm
is now the dominant defect** — 95 sequential CapacitorHttp requests inside
the first 11 s of cold boot on Pixel 4 against c64u. Responsiveness2's
F-HTTP-2 fix only collapsed `LED Strip Settings` and `Keyboard Lighting`;
the same root cause (per-item enrichment because Ultimate firmware returns
flat strings) still applies to every other Home category.

This is a documents-only handoff. No code in this repo was modified by this
investigation.

## What lives here

- `PLANS.md` — scope, what was investigated, what was out of scope.
- `FINDINGS.md` — 16 numbered findings with code loci, root causes, evidence.
- `DIAGNOSTICS_ROOT_CAUSE_MATRIX.md` — defect → cause table.
- `FEATURE_INVENTORY.md` — priority ranking with implementation order.
- `RESPONSIVENESS_NOTES.md` — responsiveness contract + acceptance criteria.
- `IMPLEMENTATION_PROMPT.md` — the execution-ready brief for stage 2.
- `evidence/` — Pixel 4 logcats, screenshots, command outputs.

## Hardware state (as of 2026-05-18 17:45)

- Pixel 4 serial: `9B081FFAZ001WX`. Online, app installed
  (`uk.gleissner.c64commander` v0.7.9-rc1, lastUpdate 2026-05-18 13:19).
- `u64` reachable: `Ultimate 64 Elite`, fw `3.14e`, IP 192.168.1.13,
  unique_id `38C1BA`.
- `c64u` reachable: `C64 Ultimate`, fw `1.1.0`, IP 192.168.1.167,
  unique_id `5D4E12`.
- Active saved device at investigation time: `c64u` (badge reads
  `C64U · HEALTHY` at +12 s).

## Top 5 findings (read in IMPLEMENTATION_PROMPT.md for the full list)

1. **F3-HTTP-1** — Cold-boot REST storm of 95 requests / 11 s. Same root
   cause as responsiveness2's F-HTTP-2 but unscoped: every Home category
   pays per-item enrichment. Highest leverage to fix.
2. **F3-CACHE-1** — `configCategoryItemsCache` is in-memory only; cleared
   on every host change; lost on every cold boot. Pair fix with F3-HTTP-1.
3. **F3-TELNET-1 + F3-TELNET-2** — Capability discovery runs 1-4 times
   per cold boot because the cache key races `deviceInfo` population, and
   the cache itself never survives a process kill.
4. **F3-PAUSE-1 / F3-HTTP-3 / F3-HTTP-4 / F3-PAUSE-2** — `pollingPause
   Registry` only one consumer wired in; volume mute, drives polling, info
   polling, capability discovery all race user interaction.
5. **F3-RESUME-1** — `runConfigReconciler` replays the cold-boot storm on
   every WebView visibility resume; drop `refetchActive` from the
   visibility-resume invalidator.

## Next agent's first commands

```bash
# Confirm hardware
adb devices
curl --max-time 4 -sS http://u64/v1/info
curl --max-time 4 -sS http://c64u/v1/info

# Confirm baseline storm still reproduces against current main
adb -s 9B081FFAZ001WX shell logcat -c
adb -s 9B081FFAZ001WX shell am force-stop uk.gleissner.c64commander
adb -s 9B081FFAZ001WX shell am start -W -n uk.gleissner.c64commander/.MainActivity
sleep 12
adb -s 9B081FFAZ001WX shell logcat -d > /tmp/baseline.txt
grep -c 'Handling CapacitorHttp request' /tmp/baseline.txt
grep -c 'pluginId: TelnetSocket' /tmp/baseline.txt
```

Expected: ~95 HTTP, ~74 Telnet calls. If significantly different, capture
new evidence and amend `FINDINGS.md` before proceeding.

## What this investigation did NOT do

- No code changes. The repo state at the time of this handoff is identical
  to `d7325920`.
- No screenshot regeneration under `docs/img/**`.
- No widening of test coverage in `tests/**`.
- No firmware probing beyond `GET /v1/info` and `GET /v1/configs/...`
  (read-only) against u64 and c64u.

## What stage 2 must do

Follow `IMPLEMENTATION_PROMPT.md` in order. Phase 1 has the biggest leverage;
Phases 2-5 are independent and can land in any order after Phase 1; Phase 6
is the full validation sweep before merging.

Acceptance criteria for each phase are explicit in `IMPLEMENTATION_PROMPT.md`.
Do not declare a phase complete without Pixel 4 evidence captured under
`evidence/phase<N>-<finding-id>-<host>-<artifact>`.

## Non-negotiables

- Do not silence diagnostics to make badges look healthy.
- Do not weaken or delete tests to make failures pass.
- Do not skip root-cause investigation for warnings/errors introduced by
  these changes.
- Do not claim Pixel validation unless the installed APK was launched and
  evidence captured after the code change.
- Do not regenerate screenshot docs.

## Anti-patterns to watch for in stage 2

- Parallelising `getConfigItems` with more `Promise.allSettled` will NOT help.
  CapacitorHttp serialises through a single bridge thread (F3-HTTP-5).
  Solutions must REDUCE request count.
- Caching enriched values "until the user opens settings" is not enough —
  the storm fires on cold boot for cards the user does not open (e.g.
  Printer Settings during the cold-boot fan-out from `usePrinterData`).
  Default-skip enrichment for Home tier; lazy-enrich for detail editors.
- Adding `staleTime` doesn't help. The first read still pays the full storm.
  The fix is per-item-on-demand, not whole-category-cached.
