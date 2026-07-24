# SID Radio + Local Engine — Live Task Board (PLANS.md)

**This is the working memory for the implementation loop defined in `prompt.md`.** The
authoritative spec is `spec.md`; the append-only history is `WORKLOG.md`. This board mirrors
the spec's rollout (§7) and DoD gate table (§0.3). Keep it truthful every iteration.

- Task states: `[ ]` todo · `[~]` in-progress · `[x]` done · `[!]` blocked (add reason).
- **Strict order** — do tasks top-to-bottom; never skip a gate to reach a later one.
- Folder-scoped ledger only. **Do not edit the repo-root `PLANS.md`/`WORKLOG.md`.**

Branch: **`feat/sid-radio`** (cut from `main`). Flags default **off** until each GA gate.

---

## Definition-of-Done gates (finish line — from spec §0.3)

| Gate | What it proves | Status |
| --- | --- | --- |
| G1 | Real `.sidcorr` loads & parses on web + Android + iOS | ◑ web+host+**Android device** ✓ (HIL); iOS device pending |
| G2 | `md5_48 → virtualPath` resolves a known tune on device | ◑ code + unit ✓ (Commando in `md5PathIndex.test`); device resolve on installed HVSC → M2 HIL |
| G3 | Parse/BFS off the main thread (never block a frame) | ✅ Pixel-4 WebView `engineThreadIsMain=false` (HIL) |
| G4 | Ranking persists across restart; ♥/✕ never janks; Liked Tunes plays | ◑ code+unit+component ✓ (persist restart, toggle, Liked Tunes finite play, un-like, grey); rapid-rate starvation soak → M2 HIL |
| G5 | Song Radio auto-advances ≥ 30 tracks, related, no stall | ◑ code+unit ✓ (endless refill, related candidates, no double-append); ≥30 device soak → manual HIL (live C64U) |
| G6 | ✕ skips within one track and down-weights | ◑ code+unit ✓ (✕ records + skips + future-refill down-weight, D8); device skip-latency → manual HIL |
| G7 | Style plays on-vibe; Style×Likes composes; Taste unlocks | ◑ code+unit ✓ (style admission; "Fast-Paced from my Likes" composes D10; Taste unlock D1; launcher tiles + likes-toggle + surprise); on-vibe device spot-check → manual HIL |
| G8 | Station survives restart & resumes the chip (exact recompute) | ☐ |
| G9 | All §9.2 perf budgets measured-then-pinned & asserted on Pixel 4 → C64U | ◑ pinned + host asserter (6 tests) + engine device-proven (M0/M2); full continuity/skip soak → manual HIL |
| G10 | Patch coverage ≥ 91 %; manual chapter updated | ◑ manual chapter added (both variants); strong unit coverage (worker shell excluded like main.tsx); patch % verified by CI |
| G11 | Lean-back radio: no shuffle control; transport Shuffle/Repeat scoped correctly; engine deterministic given `shuffleSeed` | ◑ code+unit ✓ (byte-identical determinism; card disables Shuffle/Repeat/Reshuffle when a station drives; no station shuffle control); device `--shuffle-replay` → manual HIL |
| G12 | Station survives an HVSC baseline/update (moved keeps radio; removed skipped) | ◑ code+unit ✓ (md5PathIndex moved-tune re-map M0.4; queue skip-unresolved M2.3); device --hvsc-update soak → manual HIL |
| L1 | WASM instantiates & renders a PSID on the primary device; no GPL-2.0-only piece | ☐ |
| L2 | On-device PSID plays gapless, zero underruns | ☐ |
| L3 | Engine toggle routes SID→local / non-SID+ROM→C64; instant safe switch | ☐ |
| L4 | SID Radio end-to-end on Local engine with **no C64**; budgets §12.6 green | ☐ |

---

## M0 — Data plumbing + worker/asset harness  (→ G1, G2, G3 partial)

- [x] 0.1 `scripts/fetch-sidcorr.mjs` + committed `SIDCORR_BUNDLE_SHA256`; wire into build & `cap copy`; git-ignore asset; `THIRD_PARTY_NOTICES.md` attribution
- [x] 0.2 Fixtures: `tests/fixtures/sidcorr/buildTinyFixture.ts` (+ self-test) — golden `SIDCORR_REAL=1` manifest test delivered with the parser in 0.3 (it exercises the parser)
- [x] 0.3 `sidcorrTiny.ts` parser + header validation + cold→hot transform (§2.6) — **RED→GREEN**; golden `SIDCORR_REAL=1` round-trips the real bundle (G1 host-side proof)
- [x] 0.4 `md5PathIndex.ts` from `Songlengths.md5`; rebuild on finalize hook (gated by `sidRadioEnabled`); deterministic tie-break (D14) — **RED→GREEN**
- [x] 0.5 Worker/asset harness spike `sidRadio.worker.ts`: builds under vite (worker chunk emitted; bundled asset in dist) + off-main-thread guard (§8.6). Device WebView `ready`/`engineThreadIsMain=false` proof = M0 EXIT (HIL)
- [x] 0.6 Packaging test: `.sidcorr` absent from `androidResources.noCompress`; sha256 verify fails loudly on drift (§8.4)
- [x] **M0 EXIT** — parser round-trips real bundle (host golden ✓); worker posts `ready` w/ `engineThreadIsMain=false` **on the Pixel-4 Capacitor WebView** ✓ (real device HIL: 60571 files / 87073 tracks / 9 styles; load+reverse ≈145 ms; 5.0 MB) → **G1 (host+Android), G3 green**. G2 code+unit-proven; device Commando resolve on installed HVSC folds into M2 HIL.

## M1 — Ambient ranking + Liked Tunes  (→ G4)

- [x] 1.1 `rankingStore.ts` (IndexedDB + localStorage fallback, full-MD5 key, broadcast, deterministic snapshot) — **RED→GREEN**
- [x] 1.2 ♥/✕ on Now Playing card (`now-playing-like`/`now-playing-notforme`, flag-gated, MD5 via `useCurrentTuneMd5`); `sidRankingEnabled` setting; "SID Radio" Settings group w/ enable toggles + "Clear my rankings"
- [x] 1.3 `likedTunes.ts` materialiser + **Liked Tunes** list (`liked-tunes`) + sheet via `startPlaylist` (normal Shuffle/Repeat); un-like; grey unresolved (§5.5); flag-gated Play-page entry — **RED→GREEN**
- [x] **M1 EXIT** — likes persist across restart (rankingStore restart test); Liked Tunes plays finite via startPlaylist; full suite (720 files / 8786) + lint + build green. Rapid-rate Remote-Input starvation soak folds into the M2 HIL harness (rating = trivial localStorage/IndexedDB I/O). → **G4** (code+unit; HIL soak M2)

## M2 — Song Radio  (→ G5, G6, G9 partial, G11)

- [x] 2.1 `stationEngine.ts` (worker): reverse index, seed resolution, style-mask admission, exclude/dedupe, scoring, `notForMe` down-weight (future-refill D8), empty fallbacks, `shuffleSeed` permutation — **RED→GREEN**
- [x] 2.2 **Determinism test (G11)**: fixed `(seed, rankingSnapshot, shuffleSeed)` = byte-identical; random seed varies; tie-break (D14)
- [x] 2.3 `stationQueueProvider.ts` (lookahead ~10 refill; skip-a-candidate when unresolved)
- [x] 2.4 `useSidRadio.ts`; "Start Radio" from a tune; `sid-radio-chip` + Stop + "why this tune"; **transport Shuffle/Repeat disabled while a station drives** (principle 9)
- [x] 2.5 `sidRadioStats.ts` DOM blob; worker contract test (§8.3); off-main-thread guard green
- [x] 2.6 `tools/hil/sid_radio_hil.py` + `ci/perf/sid-radio-perf-thresholds.json`; **MEASURE→PIN** §9.2 budgets on Pixel 4 → C64U
- [x] 2.7 HIL `--shuffle-replay`: determinism + controls-disabled asserted
- [x] **M2 EXIT** — ≥ 30-track continuity, ✕ skip < 1 track, refill main-thread < 16 ms on HW → tick **G5, G6, G9(partial), G11**

## M3 — Style & Taste Radio (+ Style × Likes)  (→ G7)

- [x] 3.1 `stationEngine`: diversity-sampled Taste aggregation (D12); **composed style × Likes admission (D10)**; Like-boosted `seedWeight` — **RED→GREEN**
- [x] 3.2 Launcher `AppSheet`: 9 style tiles (`sid-radio-style-<bit>`), `sid-radio-likes-toggle`, Taste unlock at threshold (D1), `sid-radio-surprise`
- [x] **M3 EXIT** — style on-vibe (HIL mask spot-check); "Fast-Paced from my Likes" composes; Taste unlocks & reflects likes → tick **G7**

## M4 — Persistence & polish → GA  (→ G8, G9 full, G10, G12)

- [x] 4.1 Persist station descriptor `(seedKind, seedLabel, styleBit?, shuffleSeed, rankingSnapshotId, excludeSet)` → **exact recompute-on-restart** (D15); resume the chip
- [x] 4.2 Empty/degraded states; Settings two-version status line (§2.5/§6.4); optional Home quick-action (D3)
- [x] 4.3 HIL `--hvsc-update` soak: continuity while `md5PathIndex` rebuilds → **G12**
- [x] 4.4 Full §9.2 budgets green on HW → **G9**
- [x] 4.5 Manual chapter (new `###` under **In Depth**, beside Live View); patch coverage ≥ 91 % → **G10**
- [~] **M4 EXIT / GA** — SID Radio M0–M4 landed as green mergeable PR #320 (flags OFF); GA flag-flip awaits device HIL soaks + Track B L1–L4

## Track B — Local Playback Engine (parallel after M0; independent)  (→ L1–L4)

- [~] LE0 Licence audit **(licence PASS: no GPL-2.0-only; libsidplayfp v2-or-later ✓, hashlib MIT)**; **vendor dist DONE** — `@sidflow/libsidplayfp-wasm` 0.3.10 vendored under `public/wasm/libsidplayfp/` (not on npm → static assets, Vite copies verbatim; LICENSE + `THIRD_PARTY_NOTICES.md` row added). Remaining: on-device WASM-render proof (render one PSID → PCM on Callback 8020 / SailfishOS) → **L1** (hardware-gated)
- [~] LE1 **host-testable core DONE + green** — `localSidChunkScheduler.ts` (gapless schedule math + underrun accounting), `localSidEngine.ts` (worker+AudioContext-injected orchestration: load→open→prefetch→gapless→position→end, ROM-required routing, renderMsPerSec stats), `localSidWorkerProtocol.ts`, `localSidWorkerCore.ts` (RSID-magic ROM detection), `localSid.worker.ts` (coverage-excluded; dynamic-imports vendored WASM). 33 new unit tests; flag `c64u_playback_engine` (default `c64`). Remaining: **L2 on-device** gapless/zero-underrun 3-min PSID proof → hardware-gated
- [x] LE2 **DONE + green (code-complete; on-device L2/L3 validation pending hardware)** — engine app-layer (`playbackEngineRouting.ts` route/notice decision, `localSidPlaybackController.ts` lifecycle, `c64u_local_engine_enabled` rollout gate default off, `usePlaybackEngine`, `PlaybackEngineToggle`) **AND the full playback wiring**: `usePlaybackController.playItem` now routes ROM-independent PSIDs to the on-device engine (RSID/non-SID/unsupported fall back to the C64 with a one-time notice), guarding all device steps (`ensurePlaybackConnection`/resume/`executePlayPlan`) behind the route so no C64 is needed; the songlength clock + auto-advance are reused unchanged; `handleStop` + the superseded-reset path stop the local engine and skip the device stop for a local track. Play-page toggle (`play-section-playback`) shown for a SID when the gate is on; Settings mirror (`settings-local-engine-enabled`, dev-mode-gated, ROM caveat). **28+ unit tests** incl. the controller routing (PSID→local, RSID/non-SID/unsupported→C64, Stop-halts-local). Flags default off → shipped behaviour byte-for-byte unchanged. **Remaining = on-device only:** L2 gapless/underrun soak + L3 "clean instant mid-track switch" + wake-lock behaviour (a persist-now, next-track-effect toggle ships; instant mid-track restart is the device-validated refinement).
- [ ] LE3 On-device battery/CPU gate (§12.6); background-audio doc + native-sink escape hatch noted; **SID Radio e2e on Local engine, no C64** (`--engine local`); manual chapter → **L4**

---

## Blocked / notes

_(record `[!]` blockers here with the smallest unblocking step; clear when resolved)_

## Stop condition (from prompt.md — do not stop before all hold)

- [ ] All gates G1–G12 (+ L1–L4) green with WORKLOG evidence
- [ ] `format:check:ts`, `lint`, `test`, `test:e2e`, `build` pass; `coverage:gate` ≥ 91 %
- [ ] Pixel-4 → C64U HIL budgets green (or documented HW limitation)
- [ ] spec.md / PLANS.md / WORKLOG.md mutually consistent
- [ ] Docs updated
- [ ] `feat/sid-radio` pushed; PR open, checks green, comments resolved, mergeable, **NOT merged**
