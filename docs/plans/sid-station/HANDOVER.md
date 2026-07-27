# SID Radio + Local Engine — Handover: the remaining work

**Written 2026-07-25.** Everything that can be built and proven without hardware is **done, merged-ready,
and green.** What remains is **on-device validation on the physical rig** — it cannot run in CI and needs
a fresh APK on a phone plus a live C64 Ultimate. This file is a self-contained prompt: read it, do the
device passes below, record the measurements, and close out the four device gates (L1, L2, L4) and the
SID-Radio §9.5 HIL soaks.

---

## Where things stand (do not redo this)

- **PR #320** (`feat/sid-radio`, working tree at `/home/chris/dev/c64/c64commander-sid-radio`) is **green,
  MERGEABLE, CLEAN, and not a draft** — mergeable as-is. Tip `9854e1e2`.
- **GA is live in the code:** the feature flags default **ON**
  (`DEFAULT_SID_RADIO_ENABLED` / `DEFAULT_SID_RANKING_ENABLED` / `DEFAULT_LOCAL_ENGINE_ENABLED = true`;
  `DEFAULT_PLAYBACK_ENGINE` stays `"c64"` — the on-device engine is *offered*, C64 stays the default).
- **SID Radio M0–M4:** complete. Endless stations (song / style / taste), ♥/✕ ranking, Liked Tunes,
  station queue provider over the existing Play engine, off-main-thread worker. Device-proven at M0.
- **Track B — Local libsidplayfp-WASM engine:**
  - LE0 licence audit **PASS** (GPL-2.0-or-later, no GPL-2.0-only). Vendored
    `@sidflow/libsidplayfp-wasm` 0.3.10 → `public/wasm/libsidplayfp/` (not on npm → static assets;
    see its `VENDORING.md`). ROMs never bundled.
  - LE1/LE2 **code-complete + host-tested (98.7% coverage):** chunked Web-Audio sink, worker engine,
    routing, `c64u_playback_engine` choice + Play-page `PlaybackEngineToggle`, Settings row,
    `usePlaybackController.playItem`/`handleStop` route SID → on-device when selected (RSID / non-SID /
    unsupported fall back to the C64 with a one-time notice).
  - LE3 budgets are **pinned + host-asserted** in `ci/perf/sid-radio-perf-thresholds.json` (the
    `localEngine` block) via `tests/unit/scripts/assertSidRadioPerf.test.ts`. The **measured** device
    values are still `null` — that is exactly what this handover fills in.
- **Docs:** README has a SID Radio section; the manual **generator** `scripts/build-manuals.mjs` has a
  dedicated `## SID Radio` chapter (both variants) — edit there, never the generated `.md`; rebuild with
  `npm run manuals:build`. Screenshots: `docs/img/app/play/sid-radio/*` + `settings/sid-radio.png`.

---

## The rig

- **Phone:** the app runs on a physically-connected Android device over the WebView CDP socket. The HIL
  drives real `data-testid` elements — no raw ADB product input. Pixel 4 (`flame`) is the reference.
- **Primary rollout device:** the **Commodore Callback 8020** (SailfishOS Android layer) — the device
  L1/L3 must ultimately be proven on, and the perf floor.
- **C64:** a live **C64 Ultimate** (`c64u`) on the LAN. **Device IPs are DHCP-volatile — always re-read
  `/etc/hosts` first;** a stale IP mimics a dropout. c64u password is `pwd` (X-Password header). **u64 is
  OFF LIMITS.** See `[[device-ips-current]]`, `[[hil-physical-power-cycle-minimize-user-involvement]]`.
- The C64 reaches the app over the network: **C64 Ultimate → Ethernet → your Wi-Fi router → phone on
  Wi-Fi.** Station audio played on the C64 comes back via the multicast **audio mirror**
  (`[[av-mirror-multicast-not-unicast]]`). The on-device engine needs no C64 and no network stream.

Build + install a fresh APK: `cd /home/chris/dev/c64/c64commander-sid-radio && ./build --install-apk`
(Android needs JDK21 — `./build` selects it; validate deps with `npm ci`, see `[[cap8-jdk21-and-lockfile]]`).

---

## Remaining work — do these on the rig, in order

The harness reads a hidden `data-testid="sid-radio-stats"` JSON blob each tick and asserts the
**measured-then-pinned** budgets. **Never auto-rewrite a pinned baseline to hide a regression** (spec §9.2).
Record every measurement back into `ci/perf/sid-radio-perf-thresholds.json` (`measured.value` + `note`),
commit, and let the host test keep it honest.

### 1. LE1 L1 — WASM instantiates + renders on the primary device
Prove the vendored engine loads and renders one HVSC PSID → PCM **on the Callback 8020 / SailfishOS**
(and Pixel 4). This is the last unproven LE0/LE1 claim (bundle load, `renderSeconds` → Int16, audible).
- On device, Settings → enable "On-device playback engine"; pick a ROM-independent PSID; Play → "This device".
- Exit gate: WASM instantiates, audio plays, no GPL-2.0-only component loaded.

### 2. LE1 L2 + LE3 L4 — on-device audio soak (`--engine local`)
```bash
pip install websocket-client
python3 tools/hil/sid_radio_hil.py --serial <ADB_SERIAL> --engine local --station song --soak-tracks 30
```
Fill in `ci/perf/sid-radio-perf-thresholds.json → localEngine`:
- `renderMsPerSec` — p99 **< 250 ms/sec** (≥ 4× realtime). Pin the measured p99.
- `audioUnderruns` — **0** over a 3-min PSID (gapless).
- `engineSwitchMs` — C64 ↔ Local switch → audio resumes, p99 **< 1500 ms**.
- Also record on-device **CPU %** (p95) and battery over the soak on the Callback 8020 (§12.6, the floor).

### 3. LE2 refinement — clean instant mid-track engine switch + foreground wake lock
Shipped behaviour today: the Play-page "Play on: C64 / This device" toggle **persists** the choice and it
takes effect on the **next** track. Spec §12.5 wants an **instant** mid-track switch (stop current engine +
restart the current tune on the chosen one) and a **foreground wake lock** during local playback. Wire the
toggle's `onChange` to restart the current item, and add a screen/CPU wake lock while a local tune plays;
verify press→resume on the rig. (`handleStop` already stops the correct engine; `currentPlaybackIsLocalRef`
tracks which one owns the track.)

### 4. SID Radio §9.5 device HIL soaks (the C64 path)
```bash
python3 tools/hil/sid_radio_hil.py --serial <ADB_SERIAL> --station song  --soak-tracks 30 --skips 5
python3 tools/hil/sid_radio_hil.py --serial <ADB_SERIAL> --station style --style fast_paced --soak-tracks 30
python3 tools/hil/sid_radio_hil.py --serial <ADB_SERIAL> --shuffle-replay   # G11: byte-identical replay, controls disabled during a station
python3 tools/hil/sid_radio_hil.py --serial <ADB_SERIAL> --hvsc-update      # G12: continuity while md5PathIndex rebuilds
```
Fill in the main `thresholds` block's `null` measured values: `firstCandidateMs` (<300), `lastRefillMs`
(<150), `skipToLaunchMs` (<400), `tracksAutoAdvanced` (≥30, zero gaps). `coldLoadMs` (145), `engineThreadIsMain`
(false), `memoryEstimateBytes` (5.0 MB) are already device-proven from M0.

---

## Key files & pointers

- Perf budgets: `ci/perf/sid-radio-perf-thresholds.json` (+ `.schema.json`); host gate
  `scripts/assert-sid-radio-perf.mjs`, test `tests/unit/scripts/assertSidRadioPerf.test.ts`.
- HIL harness + README: `tools/hil/sid_radio_hil.py`, `tools/hil/README.md`.
- Local engine: `src/lib/playback/localSid{Engine,ChunkScheduler,PlaybackController,WorkerCore,WorkerProtocol}.ts`,
  `localSid.worker.ts`; routing `src/lib/playback/playbackEngineRouting.ts`; wiring in
  `src/pages/playFiles/hooks/usePlaybackController.ts` (`routeToLocal`, `currentPlaybackIsLocalRef`).
- Stats blob: `src/lib/sidRadio/sidRadioStats.ts` (`data-testid="sid-radio-stats"`).
- Spec: `docs/plans/sid-station/spec.md` (§9 SID Radio perf/HIL, §12 Track B). Ledgers PLANS.md / WORKLOG.md.
  The authoritative, up-to-date ledgers are in the **`c64commander-sid-radio`** checkout.
- Method (if you continue the convergence loop): `docs/plans/sid-station/prompt.md`.

## Relevant memories
`[[sid-radio-and-local-engine-plan]]` (full status), `[[machine-input-drives-cia-matrix]]`,
`[[live-view-native-audio-off-js-thread]]`, `[[av-mirror-multicast-not-unicast]]`,
`[[device-ips-current]]`, `[[c64u-flakiness]]`, `[[cap8-jdk21-and-lockfile]]`,
`[[hil-physical-power-cycle-minimize-user-involvement]]`.

## Definition of done for this handover
All four device passes above measured on the rig (Callback 8020 primary), every `localEngine` and
`thresholds` `measured.value` filled from a real run and within its pinned budget, the instant-switch +
wake-lock refinement landed and verified, and the numbers committed on `feat/sid-radio` (or its successor)
with the host perf test still green.
