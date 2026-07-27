# SID Radio + Local Playback Engine — Implementation Execution Prompt

## ROLE

You are an expert Capacitor, Android WebView, React, TypeScript, Web Worker, WASM,
IndexedDB, Vitest, Playwright, performance-engineering, and hardware-in-the-loop engineer
working in the **C64 Commander** repository (also shipped as the **C64U Remote** variant).

You are implementing **SID Radio** (endless similarity stations from HVSC + the user's
Likes) and its companion **Local Playback Engine** (on-device libsidplayfp WASM), exactly
as specified. You will drive the work to **full convergence** — you do not stop until the
Definition of Done is entirely green — using a strict, test-first, ledger-tracked loop
that **preserves every increment of finished work**.

---

## SINGLE SOURCE OF TRUTH (read these first, in this order)

1. **`spec.md`** — the complete, authoritative specification. Everything you build is
   defined there: concept (§1), data & memory model (§2), packaging (§3), principles
   (§4), UX (§5), architecture (§6), **test-first rollout (§7)**, test strategy (§8),
   **performance & Pixel-4→C64U HIL (§9)**, risks (§10), decisions D1–D15 (§11), the
   **Local engine (§12)**, and verified touchpoints (Appendix A). **The spec's §0.3
   Definition-of-Done gate table (G1–G12, L1–L4) is the finish line.** If anything here
   conflicts with `spec.md`, `spec.md` wins — fix this prompt, don't diverge.
2. **`PLANS.md`** (this folder) — the **live task board**: the ordered checklist mirroring
   the spec's milestones and DoD gates. It is the working memory of "what's left." You
   keep it current.
3. **`WORKLOG.md`** (this folder) — the **append-only history**: what was done, why, with
   evidence. You append; you never rewrite past entries.

> **Ledger location is folder-scoped by repo convention.** Use
> `docs/plans/sid-station/PLANS.md` and `docs/plans/sid-station/WORKLOG.md`. The **root
> `PLANS.md` / `WORKLOG.md` / `AGENTS.md` are project-wide and OFF LIMITS — never edit or
> overwrite them** (this mirrors `docs/plans/keyboard-input/`).

---

## PRIME DIRECTIVES (non-negotiable invariants — everything is subordinate to these)

These are the spec's principles (§4), restated as release blockers. A violation is never a
"polish later" item.

1. **Ride the existing Play engine.** A station is a **queue provider** and the Local
   engine is a **route selector above `executePlayPlan`** — never a parallel transport.
   Reuse `usePlaybackController` (`startPlaylist`/`playItem`/auto-advance), the playlist
   model, `usePlaybackPersistence`, and `playbackRouter`. **Do not create parallel
   playback systems.**
2. **Off the main thread.** Bundle parse, cold→hot transform, reverse-index build, BFS,
   and WASM render run in **Web Workers**. There is **no Web Worker precedent in the repo
   yet** — M0 proves the vite-worker → Capacitor-WebView path before any engine logic
   depends on it. The engine must never block the UI or starve Remote Input
   (regression class: `hvsc-hydration-starved-remote-input`).
3. **Determinism is an engine property, not a user toggle.** `stationEngine` is a pure
   function of `(seed, rankingSnapshot, shuffleSeed)` — stable tie-break, no wall-clock /
   insertion-order / Set-iteration inputs (spec §2.3, principle 9).
4. **Radio is lean-back — never overload "Shuffle."** A station exposes no shuffle
   control; transport Shuffle/Repeat **disable while a station drives the queue** and keep
   their normal meaning for finite lists (playlists, Liked Tunes). Variety = fresh random
   `shuffleSeed` per start (spec §5.3, D7).
5. **Content-addressed & offline.** Everything keys on MD5; no network at play time; the
   `md5PathIndex` rides the HVSC finalize hook and survives updates (spec §2.5).
6. **Prove it on hardware.** Every claim about continuity, latency, skip, determinism, and
   non-starvation is asserted by the **Pixel-4 → C64U HIL** (`tools/hil/sid_radio_hil.py`)
   against machine-readable **pinned** thresholds (`ci/perf/sid-radio-perf-thresholds.json`),
   measured-then-pinned (spec §9). Unit tests prove logic; HIL proves the product.
7. **Flags off during rollout.** `sidRadioEnabled`, `sidRankingEnabled`,
   `localPlaybackEnabled` default **off** until their milestone's GA gate is green; with a
   flag off, the app is byte-for-byte unchanged. `c64u_playback_engine` defaults `"c64"`.
8. **Test-Driven Development is the method, not an afterthought.** For every unit of work:
   write the failing test and fixtures **first**, implement to green, then verify. No
   production code lands without a test that would fail without it.
9. **Preserve finished work.** Never rewrite green code or passing tests without a
   spec-justified reason recorded in `WORKLOG.md`. Extend; don't restart.

---

## THE CONVERGENCE LOOP (your execution heartbeat — repeat until DoD is all green)

Run this loop continuously. **Do not stop, summarize-and-pause, or ask for confirmation
between tasks.** Only the Stop Condition below ends the loop.

```
LOOP:
  1. SELECT  → Open PLANS.md. Take the FIRST unchecked task in strict order
              (Implementation Order below). Never skip ahead; never parallelise
              past an unmet dependency. Mark it in-progress in PLANS.md.
  2. RED     → Write the failing test(s) + fixtures the spec requires for this task
              (spec §7 "Tests & fixtures first", §8). Run them; SEE them fail for
              the right reason.
  3. GREEN   → Implement the smallest change that makes them pass, reusing existing
              infrastructure (Appendix A). Nothing more than the task demands.
  4. REFACTOR→ Clean up while green (naming, dedupe) without changing behavior.
  5. VERIFY  → Run the scoped checks for this task, then (at each milestone exit) the
              full VERIFICATION COMMANDS. A task is not done until its checks pass.
  6. GATE    → If this task completes a spec DoD gate (G-/L-), run its exit proof
              (unit + HIL as the spec dictates) and only then mark the gate green.
  7. LOG     → Append a WORKLOG.md entry: task, files changed, key decisions (link
              spec D-numbers), commands run + real output/evidence, gate status.
  8. CHECK   → Tick the task in PLANS.md; update the DoD gate row status.
  9. COMMIT  → Commit the increment on the feature branch with a conventional message
              referencing the milestone/gate. Push when a milestone completes.
  GOTO LOOP
```

**Convergence rules**

- **One task at a time, in order.** The Implementation Order is a total order; respect it.
- **Never skip a gate to reach a later one.** A red gate blocks everything downstream of it.
- **If blocked**, do not stall: record the blocker in WORKLOG.md, then take the _smallest_
  step that removes it (a spike, a fixture, a narrower test). The M0 worker/asset harness
  exists precisely to remove the biggest unknown early.
- **Measured-then-pinned perf.** On the first M2 HIL run, MEASURE the budgets, then PIN
  them (with headroom) into `ci/perf/sid-radio-perf-thresholds.json`. Never auto-rewrite a
  baseline to make a regression pass (spec §9.2).
- **Idempotent & resumable.** PLANS.md + WORKLOG.md must let a fresh session resume with
  zero context loss. Assume you may be interrupted after any task; leave the ledgers
  truthful every iteration.

---

## LEDGER DISCIPLINE

**`PLANS.md`** — the live board. States per task: `[ ]` todo, `[~]` in-progress, `[x]`
done, `[!]` blocked (with a one-line reason). Mirror the spec's DoD gate table with a
Status column. Keep it in the Implementation Order below. When the spec changes, reconcile
PLANS.md to it (spec is truth).

**`WORKLOG.md`** — append-only. One dated entry per task/gate. Each entry:
`Task · Files changed · Decisions (link spec D#) · Commands + evidence · Gate status`.
Never delete or rewrite prior entries; corrections are new entries.

**Never touch** the repo-root `PLANS.md` / `WORKLOG.md` / `AGENTS.md`.

---

## IMPLEMENTATION ORDER (the exact spine — do these in this order)

Cut branch **`feat/sid-radio`** from `main`. Each milestone is test-first (spec §7) and is
"done" only when its **exit gate** (spec §0.3) is green. SID Radio (M-series) is the
primary line; the Local engine (Track B, LE-series) is independent and may proceed in
parallel _after_ M0 lands the shared worker/asset harness, but must not delay the M-series.

### Phase M0 — Data plumbing + worker/asset harness → gates G1, G2, G3(partial)

0.1 `scripts/fetch-sidcorr.mjs` + committed `SIDCORR_BUNDLE_SHA256`; wire into build &
`cap copy`; git-ignore the asset; `THIRD_PARTY_NOTICES.md` attribution.
0.2 Fixtures: `tests/fixtures/sidcorr/buildTinyFixture.ts` (synthetic valid bundle) +
opt-in `SIDCORR_REAL=1` golden manifest check.
0.3 `sidcorrTiny.ts` (parser + header validation + cold→hot transform, spec §2.6) — TDD.
0.4 `md5PathIndex.ts` from `Songlengths.md5`; rebuild on `reloadHvscSonglengthsOnConfigChange`
finalize hook; deterministic tie-break (D14) — TDD.
0.5 **Worker/asset harness spike**: minimal `sidRadio.worker.ts` that fetches + parses the
bundle and posts `{type:"ready", stats}` — prove it **builds under vite and loads in
the Capacitor WebView on Android** (and web/iOS). Off-main-thread guard (§8.6).
**Exit:** parser round-trips the real bundle; `md5_48 → virtualPath` resolves `Commando.sid`
on device; worker posts `ready` from a background thread (`engineThreadIsMain=false`).

### Phase M1 — Ambient ranking + Liked Tunes → gate G4

1.1 `rankingStore.ts` (IndexedDB, full-MD5 key, broadcast) — TDD.
1.2 ♥/✕ on the Now Playing card (`now-playing-like`/`now-playing-notforme`); "Clear my
rankings" in Settings.
1.3 **Liked Tunes** playable list (`liked-tunes`) via `likedTunes.ts` → `startPlaylist`
(normal Shuffle/Repeat apply); un-like; grey unresolved tunes (spec §5.5) — TDD.
**Exit:** likes persist across restart; Liked Tunes plays as a finite list; HIL soak shows
zero Remote-Input starvation while rapidly rating.

### Phase M2 — Song Radio → gates G5, G6, G9(partial), G11

2.1 `stationEngine.ts` in the worker: reverse index, seed resolution, style-mask admission,
exclude/dedupe, scoring, `notForMe` down-weight (future-refill, D8), empty fallbacks,
and the `shuffleSeed` permutation — TDD incl. the **determinism test (G11)**.
2.2 `stationQueueProvider.ts` (lookahead ~10 refill; skip-a-candidate when path unresolved).
2.3 `useSidRadio.ts`; "Start Radio" from a tune; `sid-radio-chip` + Stop + "why this tune";
**transport Shuffle/Repeat disabled while a station drives** (principle 9).
2.4 `sidRadioStats.ts` DOM blob; worker contract test (§8.3).
2.5 `tools/hil/sid_radio_hil.py` + `ci/perf/sid-radio-perf-thresholds.json` — **MEASURE
then PIN** the §9.2 budgets on Pixel 4 → C64U; `--shuffle-replay` proves determinism +
controls-disabled.
**Exit:** ≥ 30-track continuity, ✕ skip < one track, refill main-thread < 16 ms, all on HW.

### Phase M3 — Style & Taste Radio (incl. Style × Likes composition) → gate G7

3.1 Extend `stationEngine`: diversity-sampled Taste aggregation (D12); **composed style ×
Likes admission (D10)**; Like-boosted `seedWeight` — TDD.
3.2 Launcher `AppSheet`: 9 style tiles, `sid-radio-likes-toggle` ("based on my likes"),
Taste unlock at threshold (D1), Surprise.
**Exit:** style stations play on-vibe; "Fast-Paced from my Likes" composes correctly; Taste
unlocks and reflects likes.

### Phase M4 — Persistence & polish → GA → gates G8, G9(full), G10, G12

4.1 Persist the station descriptor `(seedKind, seedLabel, styleBit?, shuffleSeed,
    rankingSnapshotId, excludeSet)` → **exact recompute-on-restart** (D15); resume the chip.
4.2 Empty/degraded states; Settings two-version status line (§2.5, §6.4); optional Home
quick-action (D3).
4.3 HVSC-update continuity: `--hvsc-update` HIL soak (G12); full §9.2 budgets green.
4.4 Manual chapter (new `###` under **In Depth**, beside Live View); patch coverage ≥ 91 %.
**Exit:** every DoD row G1–G12 green → flags default **on**; PR green.

### Track B — Local Playback Engine (parallel, independent) → gates L1–L4

LE0 Licence & feasibility spike (dist/LICENSE + residfp audit; render one PSID to PCM on the
**Pixel 4** — the phone-side venue for every gate; the Callback 8020 is unreleased and must never
be named as a venue, see AGENTS.md) → **L1**.
LE1 `localSidEngine.ts` + `localSid.worker.ts` + chunked Web Audio sink; gapless play →
**L2** (zero underruns, `renderMsPerSec` recorded).
LE2 `c64u_playback_engine` setting + Play-page segmented control
(`playback-engine-c64`/`playback-engine-local`) + route selection in `playItem` +
ROM-less fallback + clean engine-switch → **L3**.
LE3 On-device perf/battery gate; **SID Radio end-to-end on the Local engine with NO C64
powered on** (`sid_radio_hil.py --engine local`); manual chapter → **L4**.

---

## WHAT ALREADY EXISTS — DO NOT RE-CREATE (verify in code; extend only)

Per spec Appendix A (all verified 2026-07-24):

- **Playback:** `usePlaybackController.ts` (`startPlaylist`/`playItem`/auto-advance guard),
  `usePlaylistManager.ts`, `PlayFilesPage.tsx`, `playbackRouter.ts` (`executePlayPlan` —
  the Local engine routes _around_ this single point).
- **Model:** `types.ts` (`PlaylistItem`), `fileTypes.ts` (`PlayFileCategory` incl. `sid`).
- **HVSC:** `hvscSongLengthService.ts` (`Songlengths.md5`,
  `reloadHvscSonglengthsOnConfigChange` — the `md5PathIndex` rebuild hook),
  `getHvscDurationsByMd5Seconds`, `sidUtils.ts` (`computeSidMd5`).
- **HVSC updates:** `hvscReleaseService.ts` / `hvscStateStore.ts` /
  `hvscIngestionRuntime.ts` (finalize at 615/809).
- **Settings:** `appSettings.ts` (`c64u_*` localStorage + `broadcast`), `SettingsPage.tsx`.
- **Persistence:** `indexedDbRepository.ts`, `usePlaybackPersistence.ts`.
- **Native/streaming precedent:** `streamUdp.ts` (Capacitor plugin bridge),
  `audioNativeSink.ts` (native audio sink — the §12 escape hatch).
- **WASM:** `@sidflow/libsidplayfp-wasm` (`SidAudioEngine`) + `sidflow-web`
  `worklet-player.ts` / `sid-renderer.worklet.ts` reference integration.
- **No Web Worker precedent** exists (only the PWA _service_ worker) — M0 establishes it.

---

## VERIFICATION COMMANDS (run scoped per task; full set at each milestone exit)

- Format/lint/types: `npm run format:check:ts` · `npm run lint` (runs prettier + eslint +
  `npm run typecheck` + variant/flags/menu checks).
- Unit: `npm test` (Vitest). Scoped: `npx vitest run <path>`. Real-bundle golden:
  `SIDCORR_REAL=1 npx vitest run <sidcorrTiny test>`.
- Coverage gate (≥ 91 %): `npm run test:coverage` then `npm run coverage:gate`.
- E2E: `npm run test:e2e` (Playwright).
- Build: `npm run build`; Android: `./build --skip-tests --install-apk` for device loops.
- **HIL (Pixel 4 → C64U), the authoritative product proof:**
  `python3 tools/hil/sid_radio_hil.py --serial <ADB_SERIAL> --station song --soak-tracks 30 --skips 5`
  (+ `--station style --style fast_paced`, `--shuffle-replay`, `--hvsc-update`,
  `--soak-seconds`, and `--engine local` for Track B). It reads `sid-radio-stats` via CDP
  and **exits 1** on any §9.2 threshold regression.
- Perf harness precedent to follow: `tools/hil/av_sync_hil.py`,
  `ci/perf/stream-perf-thresholds.json`, `scripts/assert-stream-perf.mjs`.

---

## DEFINITION OF DONE — the STOP CONDITION (do not stop before ALL of this holds)

1. **Every DoD gate G1–G12 (and L1–L4 for Track B) in PLANS.md is `[x]` green**, each
   backed by a WORKLOG.md entry with real evidence (unit output + HIL stats).
2. `npm run format:check:ts`, `npm run lint`, `npm test`, `npm run test:e2e`,
   `npm run build` all pass; `npm run coverage:gate` ≥ 91 % patch; no new console
   warnings/errors.
3. The **Pixel-4 → C64U HIL** asserts the pinned §9.2 budgets green (SID Radio) and, for
   Track B, the §12.6 Local budgets — or any unreachable item is documented as an explicit
   external/hardware limitation in WORKLOG.md (never silently skipped).
4. `spec.md` DoD table, `PLANS.md`, and `WORKLOG.md` are mutually consistent and truthful.
5. Docs updated (manual chapter; Settings status line documented).
6. Branch `feat/sid-radio` committed & pushed; a PR is open against `main`; all required
   PR checks are green (`gh pr checks`); review comments present at evaluation time are
   resolved; GitHub reports the PR mergeable; **the PR is NOT merged.**

Until all six hold, return to the CONVERGENCE LOOP. Partial completion is not completion.

---

## ANTI-SHORTCUT CHECKS (any true ⇒ NOT done)

- A parallel playback/transport path was created instead of reusing
  `usePlaybackController` / `executePlayPlan` (Prime Directive 1).
- Parse/BFS/WASM run on the main thread, or `engineThreadIsMain` is ever `true`, or Remote
  Input is starved during a station soak.
- A station exposes a shuffle control, or transport Shuffle/Repeat are _not_ disabled while
  a station drives the queue, or they are disabled for a finite Liked-Tunes list.
- The engine is non-deterministic for a fixed `(seed, rankingSnapshot, shuffleSeed)`
  (`--shuffle-replay` differs run-to-run).
- Perf budgets were invented/relaxed instead of measured-then-pinned, or a baseline was
  auto-rewritten to hide a regression.
- `md5PathIndex` doesn't rebuild on the HVSC finalize hook, or a moved tune loses its radio,
  or a removed tune errors instead of being skipped.
- Production code landed without a failing-first test; or a real-bundle claim without the
  `SIDCORR_REAL=1` golden test; or an HW claim without HIL `sid-radio-stats` evidence.
- The **root** `PLANS.md`/`WORKLOG.md`/`AGENTS.md` were edited, or the folder ledgers were
  left stale/untruthful after a task.
- ROM images were bundled (Prime Directive: ROMs are non-redistributable — §12.3).
- Flags defaulted on before their GA gate, or the app changed with a flag off.
- Local checks pass but the branch is unpushed, PR checks are failing/pending, comments are
  unresolved, or success is claimed without command/GitHub evidence.

---

## FINAL RESPONSE REQUIREMENT

When (and only when) the Stop Condition holds, give a concise report: (1) what shipped per
milestone M0–M4 and LE0–LE3; (2) files changed; (3) the station model (seed × style, Likes
steer) and how determinism + the no-shuffle-for-radio behavior work; (4) the measured-then-
pinned §9.2 / §12.6 budgets with actual HIL numbers; (5) HVSC-update behavior proven; (6)
Local-engine capability (ROM-less, fallback) and the "SID walkman, no C64" proof; (7) tests
added; (8) exact commands run + results; (9) HIL runs performed or documented HW
limitations; (10) docs updated; (11) commit SHA, branch, PR URL, CI status, comment status,
mergeability; (12) the final DoD gate table state. Then stop.
