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
| G1 | Real `.sidcorr` loads & parses on web + Android + iOS | ☐ |
| G2 | `md5_48 → virtualPath` resolves a known tune on device | ☐ |
| G3 | Parse/BFS off the main thread (never block a frame) | ☐ |
| G4 | Ranking persists across restart; ♥/✕ never janks; Liked Tunes plays | ☐ |
| G5 | Song Radio auto-advances ≥ 30 tracks, related, no stall | ☐ |
| G6 | ✕ skips within one track and down-weights | ☐ |
| G7 | Style plays on-vibe; Style×Likes composes; Taste unlocks | ☐ |
| G8 | Station survives restart & resumes the chip (exact recompute) | ☐ |
| G9 | All §9.2 perf budgets measured-then-pinned & asserted on Pixel 4 → C64U | ☐ |
| G10 | Patch coverage ≥ 91 %; manual chapter updated | ☐ |
| G11 | Lean-back radio: no shuffle control; transport Shuffle/Repeat scoped correctly; engine deterministic given `shuffleSeed` | ☐ |
| G12 | Station survives an HVSC baseline/update (moved keeps radio; removed skipped) | ☐ |
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
- [ ] 0.6 Packaging test: `.sidcorr` absent from `androidResources.noCompress`; sha256 verify fails loudly on drift (§8.4)
- [ ] **M0 EXIT** — parser round-trips real bundle; `Commando.sid` resolves on device; worker posts `ready` w/ `engineThreadIsMain=false` → tick **G1, G2, G3(partial)**

## M1 — Ambient ranking + Liked Tunes  (→ G4)

- [ ] 1.1 `rankingStore.ts` (IndexedDB, full-MD5 key, broadcast) — **RED→GREEN**
- [ ] 1.2 ♥/✕ on Now Playing card (`now-playing-like`/`now-playing-notforme`); "Clear my rankings" in Settings
- [ ] 1.3 `likedTunes.ts` materialiser + **Liked Tunes** list (`liked-tunes`) via `startPlaylist` (normal Shuffle/Repeat); un-like; grey unresolved (§5.5) — **RED→GREEN**
- [ ] **M1 EXIT** — likes persist across restart; Liked Tunes plays finite; HIL soak: zero Remote-Input starvation while rating → tick **G4**

## M2 — Song Radio  (→ G5, G6, G9 partial, G11)

- [ ] 2.1 `stationEngine.ts` (worker): reverse index, seed resolution, style-mask admission, exclude/dedupe, scoring, `notForMe` down-weight (future-refill D8), empty fallbacks, `shuffleSeed` permutation — **RED→GREEN**
- [ ] 2.2 **Determinism test (G11)**: fixed `(seed, rankingSnapshot, shuffleSeed)` = byte-identical; random seed varies; tie-break (D14)
- [ ] 2.3 `stationQueueProvider.ts` (lookahead ~10 refill; skip-a-candidate when unresolved)
- [ ] 2.4 `useSidRadio.ts`; "Start Radio" from a tune; `sid-radio-chip` + Stop + "why this tune"; **transport Shuffle/Repeat disabled while a station drives** (principle 9)
- [ ] 2.5 `sidRadioStats.ts` DOM blob; worker contract test (§8.3); off-main-thread guard green
- [ ] 2.6 `tools/hil/sid_radio_hil.py` + `ci/perf/sid-radio-perf-thresholds.json`; **MEASURE→PIN** §9.2 budgets on Pixel 4 → C64U
- [ ] 2.7 HIL `--shuffle-replay`: determinism + controls-disabled asserted
- [ ] **M2 EXIT** — ≥ 30-track continuity, ✕ skip < 1 track, refill main-thread < 16 ms on HW → tick **G5, G6, G9(partial), G11**

## M3 — Style & Taste Radio (+ Style × Likes)  (→ G7)

- [ ] 3.1 `stationEngine`: diversity-sampled Taste aggregation (D12); **composed style × Likes admission (D10)**; Like-boosted `seedWeight` — **RED→GREEN**
- [ ] 3.2 Launcher `AppSheet`: 9 style tiles (`sid-radio-style-<bit>`), `sid-radio-likes-toggle`, Taste unlock at threshold (D1), `sid-radio-surprise`
- [ ] **M3 EXIT** — style on-vibe (HIL mask spot-check); "Fast-Paced from my Likes" composes; Taste unlocks & reflects likes → tick **G7**

## M4 — Persistence & polish → GA  (→ G8, G9 full, G10, G12)

- [ ] 4.1 Persist station descriptor `(seedKind, seedLabel, styleBit?, shuffleSeed, rankingSnapshotId, excludeSet)` → **exact recompute-on-restart** (D15); resume the chip
- [ ] 4.2 Empty/degraded states; Settings two-version status line (§2.5/§6.4); optional Home quick-action (D3)
- [ ] 4.3 HIL `--hvsc-update` soak: continuity while `md5PathIndex` rebuilds → **G12**
- [ ] 4.4 Full §9.2 budgets green on HW → **G9**
- [ ] 4.5 Manual chapter (new `###` under **In Depth**, beside Live View); patch coverage ≥ 91 % → **G10**
- [ ] **M4 EXIT / GA** — all G1–G12 green → flags default **on**; PR green

## Track B — Local Playback Engine (parallel after M0; independent)  (→ L1–L4)

- [ ] LE0 Licence audit (`dist/LICENSE` + residfp + transitive = v2-or-later/permissive); render one PSID → PCM on Callback 8020 / SailfishOS → **L1**
- [ ] LE1 `localSidEngine.ts` + `localSid.worker.ts` + chunked Web Audio sink; gapless scheduling; position events — **RED→GREEN** → **L2**
- [ ] LE2 `c64u_playback_engine` setting + Play-page segmented control (`playback-engine-c64`/`playback-engine-local`); route in `playItem`; ROM-less fallback + one-time notice; clean instant switch; foreground wake lock → **L3**
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
