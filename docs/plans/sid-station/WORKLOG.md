# SID Radio + Local Engine — Worklog (append-only)

This is the **durable, append-only history** of the implementation. One entry per task or
gate. Never rewrite prior entries; corrections are new entries. The live board is
`PLANS.md`; the spec is `spec.md`. Do not edit the repo-root `WORKLOG.md`.

**Entry format:**
```
### <date> — <Mx.y / gate> <title>
- Task: <what>
- Files: <changed/added>
- Decisions: <link spec D#/§; why>
- Commands + evidence: <exact commands + real output / HIL stats>
- Gate: <G#/L# → status>
```

---

## Context (start of implementation — before M0)

- **Spec** `spec.md` is the authoritative source (convergence pass 2026-07-24): concept
  §1, data/memory §2, packaging §3, principles §4, UX §5, architecture §6, test-first
  rollout §7, tests §8, perf + Pixel-4→C64U HIL §9, decisions D1–D15 §11, Local engine
  §12, verified touchpoints Appendix A. Finish line = §0.3 DoD (G1–G12, L1–L4).
- **Branch to cut:** `feat/sid-radio` from `main`. (This planning work was authored while
  on `feat/live-view-governor-stats`; SID Radio gets its own branch off `main`.)
- **Verified touchpoints exist and are unchanged** (spec Appendix A): `usePlaybackController`
  (`startPlaylist`/`playItem`/auto-advance), `playbackRouter.executePlayPlan`,
  `PlayFileCategory` incl. `sid`, `hvscSongLengthService` (`Songlengths.md5`,
  `reloadHvscSonglengthsOnConfigChange` finalize hook at `hvscIngestionRuntime.ts:615,809`),
  `computeSidMd5`, `getHvscDurationsByMd5Seconds`, `appSettings` `c64u_*` pattern,
  `indexedDbRepository`, `usePlaybackPersistence`, `streamUdp`, `audioNativeSink`,
  `THIRD_PARTY_NOTICES.md`.
- **Known unknown (biggest risk):** the repo has **no Web Worker precedent** (only the PWA
  service worker in `vite.config.ts`). M0.5 spike de-risks the vite-worker → Capacitor
  WebView path before any engine logic depends on it. It also unblocks the Local engine.
- **HIL/perf harness to mirror:** `tools/hil/av_sync_hil.py` (CDP + `data-testid` on a
  physically-connected Pixel 4), `ci/perf/stream-perf-thresholds.json` (machine-readable
  pinned thresholds), `scripts/assert-stream-perf.mjs`.
- **Data dependency:** `@sidflow-data` Tiny `sidcorr-tiny-1` (~1.8 MB, `bundle_sha256`
  `37ceb567…5d7d1b`, `file_count` 60,571, `track_count` 87,073). **Code dependency (§12):**
  `@sidflow/libsidplayfp-wasm` (GPL-2.0-or-later; compatible with this GPL-3.0 app).

## Key design decisions carried from the spec (do not relitigate without a new entry)

- **Radio is lean-back (D7, principle 9):** stations expose **no** shuffle control;
  transport Shuffle/Repeat disable while a station drives and keep normal meaning for
  finite lists (playlists, Liked Tunes). Determinism is an internal engine property
  (`(seed, rankingSnapshot, shuffleSeed)`) powering exact resume + reproducible HIL — not a
  user toggle. Variety = fresh random `shuffleSeed` per start.
- **Station model is seed × optional style, Likes always steer (D10):** Song/Style/Taste
  are compositions, not fixed kinds; "Fast-Paced from my Likes" is first-class.
- **Memory (§2.6):** 2 GiB RAM budget → hold the ~3.3 MB resident; the packed `.sidcorr`
  is cold-optimized, so do a one-time off-thread **cold→hot transform** (expand u24→Uint32,
  full reverse CSR, `md5_48→ordinal` map) for O(1) refill lookups.
- **HVSC updates (§2.5):** `md5PathIndex` rebuilds on the songlengths finalize hook; moved
  tunes keep radio (content-addressed), new tunes playable-but-not-seedable, removed tunes
  skipped; rankings survive on full MD5; two version lines shown in Settings.
- **Steer timing (D8):** ♥/✕ affects future refills; ✕ also skips now.
- **Resume (D15):** persist the seed tuple + `shuffleSeed` + exclusions and **recompute**,
  not the whole queue.
- **ROMs (§12.3):** never bundled; ROM-less PSID v1; ROM-dependent → "Play on C64".

## Progress log

_(append entries below as tasks/gates complete — newest last)_
