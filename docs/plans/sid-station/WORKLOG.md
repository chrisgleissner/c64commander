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

### 2026-07-24 — pre-M0 side-task: sidflow tiny-spec accuracy (user request)
- Task: Make the `sidflow`/`sidflow-data` tiny spec match what the code actually
  produces, before building the parser against it.
- Findings: The generator (`sidflow/packages/sidflow-common/src/similarity-export-tiny.ts`)
  emits **binary_format_version 2**, but `sidflow/doc/similarity-export-tiny.md` described
  v1. Verified against the real 1.8 MB release bundle and a local 796-track dev export
  (both v2, graph_flags `0x0007`, 12-byte neighbor rows, packed rating table). Divergences:
  (a) header version 1→2; (b) neighbor record is `u24` target **+ `u8` quantized similarity**
  (12-byte rows, not 9); (c) a **RATING_TABLE** (`u16`/track packed nibbles) sits between
  STYLE_MASK_TABLE and NEIGHBOR_TABLE; (d) FILE_IDENTITY_TABLE has **no** section mini-header
  (bare 6-byte records); (e) size table was stale.
- Files: `sidflow/doc/similarity-export-tiny.md` (only). Added §5.4 Binary Format Versions
  with offset-only v1/v2 detection matching `openTinySimilarityDataset`; new §9.1 RATING_TABLE;
  §10.2 v2 neighbor layout + quantization formulas; corrected §7.1; v2 size table (=1,818,171 B).
- Decisions: Update the **doc** to match the **code** (user directive), not vice-versa. Doc-only.
  `sidflow-data` needs no change — its README already defers all format specs to `sidflow`,
  and there is no local `sidflow-data` checkout (confirmed with the user).
- Commands + evidence: probed the real bundle (magic SIDTINY1, ver 2, tracks 87073, files 60571,
  styles 9, neighborsBytes=1,044,876=87073·12, end offset == file size, sum(fileTrackCount)==trackCount).
  `git -C /home/chris/dev/c64/sidflow commit` → `4f41ed2` (doc-only, not pushed).
- Gate: n/a (external repo doc; unblocks M0 parser correctness).

### 2026-07-24 — M0.1 fetch-sidcorr + pinned sha + build wiring + notices
- Task: `scripts/fetch-sidcorr.mjs`, committed `SIDCORR_BUNDLE_SHA256`, build wiring,
  git-ignore asset, `THIRD_PARTY_NOTICES.md` attribution. (TDD: RED test first.)
- Files: `scripts/fetch-sidcorr.mjs` (new), `src/lib/sidRadio/sidcorrRelease.ts` (new, app
  source of truth for the pin), `tests/unit/scripts/fetchSidcorr.test.ts` (new, RED→GREEN),
  `scripts/generate-third-party-notices.mjs` (+DATA_NOTICES curated section),
  `THIRD_PARTY_NOTICES.md` (regenerated), `package.json` (prebuild += `sidcorr:fetch`;
  new `sidcorr:fetch` script), `.gitignore` (`public/data/sidcorr/`).
- Decisions (spec §3, D4/D9): ship the raw `.sidcorr` as a fetched-at-build web asset,
  git-ignored, verified against a committed sha256 pin. Single source of truth = TS constants;
  the `.mjs` build-side copy is drift-guarded by a test. Fetch is idempotent (cached+sha-ok =
  skip, no network) and offline-tolerant (soft-skip when the net is down, since SID Radio flags
  default off during rollout); sha **mismatch** is a hard fail. Notices attribution added via
  the generator (not a hand-edit) so `notices:check` stays green; credits sidflow-data
  (GPL-3.0-or-later) and HVSC, and explicitly states no SID files / no ROMs are bundled.
- Commands + evidence:
  - Downloaded real bundle → `public/data/sidcorr/hvsc-tiny.sidcorr`, sha256
    `37ceb567…5d7d1b` == manifest pin; 1,818,171 bytes; magic `SIDTINY1`.
  - `npx vitest run tests/unit/scripts/fetchSidcorr.test.ts` → 4 passed (pin is 64-hex;
    mjs↔ts no-drift; verify true/false; git-ignored public path).
  - `node scripts/fetch-sidcorr.mjs` → `up to date (1818171 bytes, sha ok)`, exit 0 (idempotent).
  - `npm run notices:generate && npm run notices:check` → check passed (811 entries).
  - `npx eslint` on new files → clean; generator diff = +17 lines only (no reformat churn).
- Gate: G1/G2 partial (asset acquisition + pin). Parser round-trip is M0.3; device resolve is M0.4.

### 2026-07-24 — M0.2 synthetic fixture builder (`buildTinyFixture.ts`)
- Task: Byte-exact synthetic `.sidcorr` emitter so unit tests never load the real
  1.8 MB bundle and assertions are exact (spec §8.5).
- Files: `tests/fixtures/sidcorr/buildTinyFixture.ts` (new — declarative spec →
  ArrayBuffer, v1 & v2, `DEFAULT_TINY_STYLES`, `buildDefaultTinyFixture`),
  `tests/unit/sidRadio/buildTinyFixture.test.ts` (new — self-test via raw DataView,
  independent of the production parser).
- Decisions: Mirror the real generator's v2 layout exactly (header offsets, 12-byte
  section header + 28-byte style records + UTF-8 payload, bare identity/mask/rating
  arrays, u24+u8 neighbor records, graph_flags `0x0007`). Builder enforces the DAG
  invariant (neighbor target < ordinal) so fixtures can't encode illegal graphs.
  Also supports v1 (no rating table, 3-byte neighbor rows) so the parser can be
  tested against both. The opt-in `SIDCORR_REAL=1` golden test parses the *real*
  bundle and therefore ships with the parser (0.3), not here.
- Commands + evidence: `npx vitest run tests/unit/sidRadio/buildTinyFixture.test.ts`
  → 9 passed (header/counts, contiguous v2 offsets incl. rating table, 9 canonical
  styles in order, fileTrackCount sum, raw md5_48, mask+rating round-trip, backward
  neighbor edges + similarity byte + sentinel, DAG rejection, v1 3-byte rows).
  prettier + eslint clean.
- Gate: infra for G1/G3 (feeds the M0.3 parser + M2 engine tests).

### 2026-07-24 — M0.3 `sidcorrTiny.ts` parser + cold→hot transform (+ golden)
- Task: Zero-copy parser + one-time cold→hot transform (spec §2.6, §6.1) — RED→GREEN.
- Files: `src/lib/sidRadio/sidcorrTiny.ts` (new), `tests/unit/sidRadio/sidcorrTiny.test.ts`
  (new — 12 synthetic + 1 opt-in golden).
- Decisions: Header validation (magic/version{1,2}/neighbors==3/bounds/`fileIdentityBytes
  == fileCount*6`). v1↔v2 detected from offsets/lengths exactly like the reference decoder
  (`hasNeighborSimilarity`, `hasPackedRatings`). Cold→hot: expand u24 targets → aligned
  `Uint32Array` (hot sentinel `0xFFFFFFFF`; also treats `raw>=trackCount` as empty), aligned
  copies of style-mask/ratings (styleMaskOffset is odd on the real bundle so a Uint16Array
  *view* is impossible — copy instead), build the reverse CSR once, and a `md5_48→fileOrdinal`
  map for O(1) seed resolution. `resolveTrack` uses upper_bound over `fileTrackStart`.
- Commands + evidence:
  - `npx vitest run tests/unit/sidRadio/sidcorrTiny.test.ts` → 12 passed, 1 skipped
    (magic/version/truncation/out-of-bounds rejection; neighbour expand + hot sentinel;
    aligned mask/ratings; reverse CSR sources; resolveTrack (fileOrdinal, songIndex, md5_48);
    md5_48→ordinals; v1 compat).
  - `SIDCORR_REAL=1 npx vitest run … -t "real bundle"` → **1 passed** (G1 host-side): parses
    the real 1.8 MB bundle, version 2, file_count 60571, track_count 87073, 9 styles in order,
    reverseSource.length == edgeCount.
  - Real-bundle timing (vite-node, min of 5): parse+reverse **38.9 ms** (host), reverseIndex
    3.8 ms, **261,213** edges, memoryEstimate **5.00 MB** (< ~8 MB target §2.6). Device budget
    (<1500 ms) is HIL measured-then-pinned in M2.
  - `eslint` + `tsc -p tsconfig.app.json --noEmit` → clean.
- Gate: **G1 (host + web/Node parse) proven**; G1 Android/iOS device-load is the M0.5 worker
  spike; G3 partial (pure, worker-ready). G2 (`md5_48→virtualPath` on device) is M0.4.

### 2026-07-24 — M0.4 `md5PathIndex.ts` + finalize-hook wiring + `sidRadioEnabled`
- Task: `md5_48 → virtualPath[]` index from `Songlengths.md5`, D14 tie-break, rebuild on the
  songlengths finalize hook, gated by the master flag — RED→GREEN.
- Files: `src/lib/sidRadio/md5PathIndex.ts` (new), `tests/unit/sidRadio/md5PathIndex.test.ts`
  (new, 9), `src/lib/config/appSettings.ts` (+`sidRadioEnabled`, key `c64u_sid_radio_enabled`,
  default **false**), `tests/unit/config/appSettings.test.ts` (+default/save/event cases),
  `src/lib/hvsc/hvscSongLengthService.ts` (`loadInternal.discover` also rebuilds the index
  from the same `.md5` read, gated).
- Decisions (spec §2.4/§2.5, D14, §0.4, Prime Directive 7): pure `parseMd548PathIndex` walks
  Songlengths.md5 exactly like `parseSonglengths` (path comment → `<full_md5>=…`), keys on the
  first 12 hex, and sorts multi-path prefixes (HVSC dupes) lexicographically. `resolveVirtualPath`
  applies D14 (installed-path-preferred, then lowest sorted). The singleton rebuilds on the
  **same** finalize hook via `rebuildMd548PathIndexFromFiles` inside the existing `discover`
  closure (no extra I/O); skips an unchanged rebuild (FNV-1a hash) and **never clobbers a
  populated index with an empty pre-commit discovery** (mirrors HARD19-016). Gated on
  `sidRadioEnabled` (default off) so the hardened songlengths path is byte-for-byte unchanged
  and adds no JS-thread work with the flag off ([[hvsc-hydration-starved-remote-input]]).
  §0.4 models these as appSettings booleans (not the YAML registry) → followed `appSettings.ts`.
- Commands + evidence:
  - `npx vitest run` (md5PathIndex, both appSettings suites, hvscSongLengthService,
    songlengths/*) → **144 passed** (incl. the 33 hvscSongLengthService tests — wiring safe).
  - md5PathIndex 9: md5_48 derivation, Commando line, multi-path sorted array, D14 installed
    tie-break, unchanged-skip/force, empty-no-clobber, moved-tune re-map (§2.5), multi-file.
  - `eslint` + `tsc -p tsconfig.app.json --noEmit` clean.
- Gate: **G2 code path complete** (index + finalize-hook rebuild + D14). On-device
  `Commando.sid` resolution is the HIL/device proof at M0 EXIT (needs installed HVSC + the
  worker spike M0.5). G12 re-map behaviour unit-proven (moved-tune test).

### 2026-07-24 — spec §2.2 v2-layout fix + decision D16 (format audit, doc-only)
- Task: Independent format audit flagged that spec §2.2 still described the **v1** layout
  (u24-only 9-byte neighbor rows "~783 KB", no RATING_TABLE) while §2.1 pins the **v2**
  bundle — contradicting the shipped M0 parser and misleading M2. Doc + one decision only;
  no code/fixture refactor (parser & fixture are already correct v2).
- Files: `docs/plans/sid-station/spec.md` §2.2 (true v2 section order incl. RATING_TABLE
  u16/track between STYLE_MASK_TABLE and NEIGHBOR_TABLE; NEIGHBOR_TABLE = 12-byte rows
  u24 target + u8 quantized cosine, ~1.02 MiB; parser is offset-driven and infers record
  width from `neighbors_bytes`; v1 still readable) + new decision **D16**.
- Decision D16: the two v2-only fields the parser exposes are **parsed-but-unused by GA** —
  scoring stays **rank-based** `Σ seedWeight×(3−rank)` (needs only presence + rank; integer
  determinism protects the G11 `--shuffle-replay` gate). `neighborSimilarity`/`reverseSimilarity`
  are an optional magnitude-weighted Song-Radio upgrade; `ratings` (e/m/c/p) stay unused
  (Style Radio uses STYLE_MASK_TABLE; ♥/✕ is the user's own full-MD5 signal). Keep consuming
  v2 (RAM-irrelevant, ~+435 KB mostly DEFLATE-absorbed, zero hot-path cost, keeps upgrade
  paths open as pure code changes). Do not request a v1 variant from sidflow.
- Commands + evidence: doc-only; no tests affected (parser/fixture unchanged and already v2,
  proven by the M0.3 golden + M0.2 self-test).
- Gate: n/a (spec/parser now mutually consistent; unblocks M2 stationEngine design).

### 2026-07-24 — M0.5 Web Worker / asset harness spike (the biggest unknown)
- Task: Prove the vite-worker → Capacitor-WebView path before any engine logic depends on
  it (principle 5, G3). The repo had **no Web Worker precedent**.
- Files: `src/lib/sidRadio/sidRadioWorkerProtocol.ts` (typed `load`→`ready`/`error` contract,
  §6.5 subset), `sidRadioWorkerCore.ts` (pure `buildReadyStats`/`toWorkerErrorMessage`/
  `isWorkerGlobalScope`, Node-testable), `sidRadio.worker.ts` (thin worker entry: fetch
  `SIDCORR_BUNDLE_URL` → parse → post `ready` w/ `engineThreadIsMain:false`; sets
  `__runsInWorker`), `sidRadioWorkerClient.ts` (injectable-factory client; promise `load()`;
  **off-main-thread guard** — no synchronous fallback, throws `SidRadioWorkerUnavailableError`
  when `Worker` is absent), `sidRadioProbe.ts` (flag-gated `window.__sidRadioProbe` device
  hook + pulls the worker into the build graph), `src/main.tsx` (calls `registerSidRadioProbe`
  in the deferred bootstrap). Tests: `sidRadioWorkerCore` (5), `sidRadioWorkerClient` (5,
  fake-worker driven), `sidRadioProbe` (3).
- Decisions: Keep all parse/BFS in pure importable modules; the `.worker.ts` shell only wires
  `self`. Engine runs **only** in a worker — the client refuses main-thread execution (§8.6)
  rather than risk starving Remote Input ([[hvsc-hydration-starved-remote-input]]). Probe is
  flag-gated so the app is inert with the flag off; the worker chunk ships dormant.
- Commands + evidence:
  - `npx vitest run tests/unit/sidRadio/` → **43 passed, 1 skipped** (whole sidRadio suite).
  - `npm run build` → **exit 0**; **`dist/assets/sidRadio.worker-vbj2HbZD.js` (5,572 B)**
    emitted as a module-worker chunk containing the `SIDTINY1` parser; `prebuild`'s
    `sidcorr:fetch` shipped the real bundle to `dist/data/sidcorr/hvsc-tiny.sidcorr`
    (1,818,171 B) — the worker's `fetch('/data/sidcorr/hvsc-tiny.sidcorr')` target.
  - `eslint` + `tsc -p tsconfig.app.json --noEmit` clean.
- Gate: **G3 host/web proven** (worker builds under vite; engine off the main thread by
  construction; guard tested). The Android WebView `ready` / `engineThreadIsMain=false`
  device proof is the M0 EXIT (HIL via `window.__sidRadioProbe`).

### 2026-07-24 — M0.6 packaging test (§8.4) + fetch-sidcorr testability refactor
- Task: Assert `.sidcorr` is never in `androidResources`/`aaptOptions` `noCompress` (so AGP
  DEFLATE-compresses it in the APK) and that the sha256 pin fails loudly on drift.
- Files: `tests/unit/scripts/sidcorrPackaging.test.ts` (new, node), `scripts/fetch-sidcorr.mjs`
  (made fs injectable — `readFileImpl`/`writeFileImpl`/`mkdirImpl`; moved the exit-code
  decision out of the function into the CLI via new `isFatalStatus`, so tests never mutate the
  shared `process.exitCode`).
- Decisions: `android/app/build.gradle` has no `noCompress` block → default DEFLATE already
  applies (spec §3), so the test locks in "no `noCompress` line mentions `sidcorr`". Drift is
  tested without the real asset (inject ENOENT + a tampered download → `sha-mismatch`, no
  write); a happy-path write test runs only when the git-ignored asset is present.
- Commands + evidence: `npx vitest run tests/unit/scripts/{sidcorrPackaging,fetchSidcorr}.test.ts`
  → **8 passed** (no-`noCompress`-sidcorr; drifted download refused + fatal; drifted cache
  refused; correctly-hashed write matches the pin). `node scripts/fetch-sidcorr.mjs` still
  `up to date … exit 0`. eslint clean.
- Gate: §8.4 packaging assertions green (feeds G1).

### 2026-07-24 — M0 EXIT: on-device worker/asset proof (Pixel 4) → G1 (Android) + G3 GREEN
- Task: Prove the vite-worker → Capacitor-WebView path on real hardware (the M0 exit gate).
- Method: `./build --skip-tests --install-apk` built the debug APK (BUILD SUCCESSFUL, 1m3s) —
  the vite build's worker chunk (`sidRadio.worker-*.js`) and the 1.8 MB `.sidcorr` asset are
  synced into the APK. Install needed `adb install -r -d` (device had a newer versionCode 2220
  vs this branch's 2154; downgrade allowed for the debug build). Launched
  `uk.gleissner.c64commander`, forwarded the WebView CDP socket
  (`@webview_devtools_remote_22082` → tcp:9222; Chrome 150 WebView, Android 16, Pixel 4),
  set `localStorage c64u_sid_radio_enabled=1`, reloaded, and invoked `window.__sidRadioProbe()`.
- Evidence (real device, `window.__sidRadioProbe()` return):
  `{"bundleLoadMs":131.4,"reverseIndexMs":13.6,"memoryEstimateBytes":5247024,
    "fileCount":60571,"trackCount":87073,"edgeCount":261213,"styleCount":9,
    "engineThreadIsMain":false}`
  → the real bundle **fetched + parsed + reverse-indexed inside the Capacitor WebView, OFF
  the main thread** (`engineThreadIsMain:false` = **G3**), counts match the manifest
  (**G1 Android**), device cold load+reverse ≈ **145 ms** (« <1500 ms §9.2 target) and
  **5.0 MB** hot (< ~8 MB, §2.6). The repo's first Web Worker works on hardware — biggest M0
  unknown de-risked.
- Gate status: **G1 = web/host + Android device ✓** (iOS device untested — no iOS hardware
  here; WKWebView supports module workers, flag for a pre-iOS-release check). **G3 = GREEN**
  (off-main on device). **G2** = code + unit-proven (Commando resolves in `md5PathIndex.test`);
  the device resolve against installed HVSC is exercised naturally by the M2 station HIL (needs
  installed HVSC + Commando's md5_48). First **G9** device data point recorded (load budget).
- Notes: the concurrent `./build`/npm-install pruned `@emnapi` optional deps from
  `package-lock.json` ([[cap8-jdk21-and-lockfile]]) and regenerated `THIRD_PARTY_NOTICES.md`
  from it — both reverted to HEAD (never committed). A pre-existing branch-tip prettier drift
  in `usePlaybackController.autoAdvance.test.tsx` (unrelated to SID Radio) was formatted so
  `npm run lint` is green. Device left with the SID Radio flag enabled for later M2 HIL.

### 2026-07-24 — spec D17 bundle-size decision (doc-only)
- Task: Record the measured v2-vs-v1 bundle-size decision (paste-in steering).
- Measurement (real pinned bundle, 536.7 KiB gzip): stripping the unused v2 fields
  (RATING_TABLE + per-edge similarity byte) saves only **18.9 KiB gzip** (~3.5 % asset,
  < 0.1 % APK; FILE_IDENTITY md5_48 = 355 KiB gzip / 66 %, NEIGHBOR = 160 KiB, RATING = 7.7 KiB,
  similarity ≈ 0.4–11 KiB). Re-pins per release (D4) → 0 in most OTA deltas.
- Decision: **ship v2 as-is** (new §11 row D17). No build-time strip, no v1 asset request;
  the saving isn't worth the build machinery / two-artifact sha story / lost v2 optionality
  (D16). If the asset must shrink, the lever is the md5_48 table (upstream 6→5-byte prefix),
  not the v2 fields.
- Confirmed §2.2 already matches the v2 layout (RATING_TABLE present, 12-byte neighbor rows,
  offset-driven parser) — landed in commit `ae1b1067`, so no §2.2 change here.
- Files: `docs/plans/sid-station/spec.md` (§11 D17). Doc-only; no code/parser/fixture change.
- Gate: n/a.

### 2026-07-24 — M1.2 ♥/✕ Now Playing affordance + Settings group
- Task: Ambient ♥/✕ ranking on the Now Playing card + "Clear my rankings" in Settings (spec §5.1, §6.4).
- Files: `appSettings.ts` (+`sidRankingEnabled`, key `c64u_sid_ranking_enabled`, default off),
  `useNowPlayingRanking.ts` (reactive ranking state over rankingStore), `useSidRadioFlags.ts`
  (reactive master+ranking flags), `NowPlayingRanking.tsx` (♥/✕ buttons, testids
  `now-playing-like`/`now-playing-notforme`, a11y labels, `onNotForMe` station-skip hook),
  `useCurrentTuneMd5.ts` (computes the current SID's full MD5 once per tune via `computeSidMd5`),
  `PlaybackControlsCard.tsx` (+`rankingControls` slot), `PlayFilesPage.tsx` (wires the affordance,
  flag-gated), `settings/SidRadioSettingsSection.tsx` (enable toggles + Clear), `SettingsPage.tsx`
  (renders the section). Tests: NowPlayingRanking (7), SidRadioSettingsSection (3), appSettings (+2).
- Decisions: ✕ only *records* with no active station (D8); `onNotForMe` (station skip) is wired in
  M2. Flag-gated (both `sidRadioEnabled` && `sidRankingEnabled`) so the card is byte-for-byte
  unchanged with flags off. MD5 computed once per tune-change (not on the render hot path) from the
  item's local bytes (`request.file.arrayBuffer()`), reusing `computeSidMd5`.
- Commands + evidence: 14 tests pass (toggle on/off + persist, a11y labels, disabled-until-MD5,
  ✕-records-without-station, ✕-skips-only-when-newly-marking, Like→✕ replace; Settings renders,
  master toggle reveals ranking toggle, Clear wipes rankings). `tsc` + `eslint` clean.
- Gate: G4 affordance + persistence proven (unit/component); jank/starvation is the M1 HIL soak.

### 2026-07-24 — M1.3 Liked Tunes (materialiser + list + sheet)
- Task: Liked Tunes playable collection (spec §5.5) — materialise ranking likes → PlaylistItems
  via md5PathIndex; play via startPlaylist; un-like; grey unresolved.
- Files: `likedTunes.ts` (listLikedTunes/buildLikedTunePlaylistItems — full-md5 → md5_48 →
  resolveVirtualPath, D14 installed-preference, sorted, greys unresolved §2.5),
  `LikedTunesList.tsx` (`liked-tunes` list; per-row play/un-like; subscribes to ranking
  changes), `LikedTunesSheet.tsx` (bottom sheet), `PlayFilesPage.tsx` (flag-gated
  "Liked Tunes" entry + sheet; onPlay → existing `startPlaylist`, so normal Shuffle/Repeat
  apply). Tests: likedTunes (5), LikedTunesList (4).
- Decisions: Liked Tunes is a finite list, not a radio — it reuses `startPlaylist` wholesale
  (no new transport). Un-like = `clearRanking` (drops from list AND stops steering). Play
  starts the whole liked list at the tapped tune. Entry gated by `sidRadioEnabled`.
- Commands + evidence: 9 tests (materialise resolved, exclude notForMe, grey removed-tune,
  build HVSC items resolved-only, D14 installed preference; list plays from tapped index,
  un-like removes row + clears ranking, greyed-disabled unresolved, empty state). `tsc` +
  `eslint` clean; full sidRadio suite 69 passed.
- Gate: G4 Liked Tunes finite-list behaviour proven (unit/component). Restart-persistence
  and HIL soak are the M1 EXIT.

### 2026-07-24 — M1 EXIT (ambient ranking + Liked Tunes) → G4 (code/unit)
- Task: Close M1. Likes persist across restart; Liked Tunes plays as a finite list; verify.
- Evidence: full unit suite **720 files / 8786 passed / 1 skipped** (`npm test`), `npm run lint`
  exit 0, `npm run build` exit 0 (worker chunk + asset still emitted). rankingStore restart
  test proves durable persistence; LikedTunes plays via `startPlaylist` (normal Shuffle/Repeat).
  Two regressions from the M1 UI were fixed before EXIT: the catch-block guardrail (rankingStore
  localStorage catches now log) and the SettingsPage test's full appSettings mock (added the new
  sid-radio exports).
- Gate: **G4** = ranking persistence + affordance + Liked Tunes finite-play proven by
  unit/component tests. The on-device "zero Remote-Input starvation while rapidly rating" soak
  is trivial I/O and folds into the M2 HIL harness (which drives the device end-to-end).
- Push: milestone complete → pushed to `origin/feat/sid-radio`.

### 2026-07-24 — M2.1/2.2 stationEngine + determinism (G11 unit)
- Task: The pure, deterministic station engine (spec §2.3) + the G11 determinism test.
- Files: `src/lib/sidRadio/stationEngine.ts` (new), `tests/unit/sidRadio/stationEngine.test.ts` (10).
- Design: seed → BFS over forward + reverse edges (reverse CSR from the bundle),
  rank-weighted hop-decayed scoring `Σ seedWeight×(neighbors−rank)`. Likes always steer
  (added as steer-seeds for song/style; the primary seeds for taste); Not-for-me hard-excludes
  the tune + down-weights its neighbourhood (future-refill only, D8). Optional style-mask
  admission (D10). `primaryExclude` = the "you started here" seed(s) only, so liked/steer
  tunes can still appear. Determinism (G11/D16): integer-rank scoring (per-edge similarity
  byte intentionally unused); the only randomness is `shuffleSeed`, applied as a deterministic
  Efraimidis–Spirakis weighted permutation with an ascending-ordinal tie-break.
- Evidence: 10 tests (song related+no-replay, no-neighbours empty, style-filter admission,
  exclude dedupe, notForMe exclude+downweight, taste seeds-from-likes, likes-steer-song;
  G11: byte-identical for fixed inputs, varies-but-overlaps for a new shuffleSeed, stable
  tie-break). Real-bundle smoke (vite-node): seed md5_48 e19ea943bb62 → **42 candidates in
  0.09 ms** on the 87k-track bundle, deterministic — far under the §9.2 refill budget.
- Gate: **G11 determinism proven (unit)**; the on-device `--shuffle-replay` + controls-disabled
  proof is M2.7 HIL. Feeds G5 (continuity).

### 2026-07-24 — M2.3 stationQueueProvider (lookahead refill + skip-unresolved)
- Task: Resolve the engine's candidate stream → playable PlaylistItems, keep ~10 lookahead,
  skip a candidate whose path no longer resolves (spec §6.1, §2.5).
- Files: `stationQueueProvider.ts` (new — async `refill(count)`; injected computeCandidates
  (worker)/resolvePath (md5PathIndex)/buildItem; consumes each ordinal once so no double-append;
  bounded guard against unresolved loops; `no-neighbours`/`exhausted` reasons; `initialExclude`
  for resume), `stationQueueProvider.test.ts` (6).
- Evidence: 6 tests — next-N + exclude advance, skip-unresolved-no-gap (removed tune §2.5),
  default lookahead=10, exhausted, no-neighbours passthrough, initial-exclude resume. eslint+tsc clean.
- Gate: feeds G5 continuity + G12 removed-tune skip.

### 2026-07-24 — M2.5 worker compute + contract test + sidRadioStats
- Task: Extend the worker to compute candidate batches; pin the message contract (§8.3);
  add the `sid-radio-stats` DOM blob (§9.4).
- Files: `sidRadioWorkerProtocol.ts` (+compute/candidates/empty, id-correlated),
  `sidRadioWorkerCore.ts` (+`computeStationResponse`, `readyStatsFromBundle`),
  `sidRadio.worker.ts` (holds the parsed bundle across messages; handles `compute`),
  `sidRadioWorkerClient.ts` (persistent id-routed handler; `compute(request)` promise),
  `sidRadioStats.ts` (new — §9.4 counters mirrored to a hidden `sid-radio-stats` DOM element;
  refill/auto-advance/skip aggregators; node-safe), `tests/contract/sidRadioWorker.contract.test.ts`
  (new, 5 — round-trips through the real core), `tests/unit/sidRadio/sidRadioStats.test.ts` (new, 4).
- Decisions: engine stays pure — a `compute` request carries the full station state each time;
  the worker only holds the bundle. Client correlates responses by id (concurrent computes safe).
  Stats DOM blob is the HIL/CDP read surface (mirrors Live View) and doubles as Diagnostics.
- Evidence: contract 5 + stats 4 pass; existing worker core/client 10 still pass; eslint + tsc clean.
- Gate: worker contract (§8.3) green; feeds G5/G6/G9 HIL (the stats surface).

### 2026-07-24 — M2.4 useSidRadio hook + sid-radio-chip + Start Radio + transport disable
- Task: Orchestrate a station over the existing Play engine; the chip; Start Radio; disable
  transport Shuffle/Repeat while a station drives (spec §6.1, §5.3, principle 9).
- Files: `useSidRadio.ts` (new — owns worker client + StationQueueProvider; startSong/Style/Taste,
  steer, stop; fresh random shuffleSeed/start; lookahead refill on cursor-near-tail via
  appendItems; ✕ steer records + skips (D8); records sidRadioStats), `SidRadioChip.tsx` (new —
  `sid-radio-chip`/`sid-radio-stop`, "why this tune" expansion), `PlaybackControlsCard.tsx`
  (+`stationActive` → Shuffle/Repeat/Reshuffle disabled, "Radio picks the order"),
  `PlayFilesPage.tsx` (wires useSidRadio to startPlaylist/setPlaylist/handleNext; renders the
  chip; flag-gated Start Radio (`sid-radio-start`) from the current tune's md5_48; NowPlaying ✕
  skips when a station is active). Tests: useSidRadio (5), SidRadioChip (3).
- Decisions: a station is a **queue provider**, never a parallel transport (principle 1) — it
  calls the existing `startPlaylist`/`setPlaylist`. Variety = fresh random shuffleSeed per start
  (§2.3). The chip carries name/stop/why; ♥/✕ stay on the Now Playing card (no duplication).
- Commands + evidence: useSidRadio 5 + SidRadioChip 3 pass; existing playFiles page/card suites
  (31 files / 257) still pass; tsc + eslint clean.
- Gate: feeds G5 (continuity), G6 (✕ skip), G11 (controls-disabled) — device proofs are M2.6/2.7 HIL.

### 2026-07-24 — M2.6/2.7 HIL harness + pinned §9.2 thresholds + asserter
- Task: `tools/hil/sid_radio_hil.py` + `ci/perf/sid-radio-perf-thresholds.json` (MEASURE→PIN)
  + `--shuffle-replay`; the host-deterministic budget check.
- Files: `ci/perf/sid-radio-perf-thresholds.json` (new — §9.2 + §12.6 localEngine block, each
  threshold profile/metric/unit/bound/aggregation/pinned/measured), `scripts/assert-sid-radio-perf.mjs`
  (new — validates a captured `sid-radio-stats` blob against the pins, composite metrics, exit 1
  on regress; importable + unit-tested), `tests/unit/scripts/assertSidRadioPerf.test.ts` (new, 6),
  `tools/hil/sid_radio_hil.py` (new — CDP driver: enable flags, start a station via testids, soak
  N auto-advances firing ✕, read `sid-radio-stats`, assert budgets; `--station/--style/--soak-tracks/
  --skips/--soak-seconds/--shuffle-replay/--hvsc-update/--engine`), `tools/hil/README.md`.
- Decisions (§9.2/§9.5): pins are the spec's proposed targets, which already carry headroom over
  the on-device measurements (M0: coldLoad 145 ms « 1500; engineThreadIsMain false; 5.0 MB;
  M2: compute 0.09 ms host « refill budgets). Never auto-rewrite a baseline. The deterministic
  asserter runs in CI (unit test); the device driver is manual/local (§9.5).
- Evidence: asserter 6 tests pass (pass-within-budget, cold-load regress, off-main-fail,
  continuity-shortfall, skip-unmeasured); `python3 -m py_compile` OK; eslint clean.
- Gate: G9 thresholds pinned + asserter green (host); the full continuity/skip on-device soak
  needs a fresh APK + live C64U → documented manual HIL. Engine-side budgets device-proven.

### 2026-07-24 — M2 EXIT (Song Radio) → G5/G6/G11 code+unit; G9 pinned
- Task: Close M2. Verify Song Radio end-to-end at the code level; the device continuity/skip
  soak is a manual HIL (live C64U).
- Evidence: full unit suite **727 files / 8825 passed / 1 skipped**; `npm run lint` exit 0;
  `npm run build` exit 0 (worker chunk + asset still emitted). Song Radio proven at code+unit:
  deterministic engine (G11), endless queue-provider refill with skip-unresolved (G5), ✕ steer
  records + skips + future-refill down-weight (G6/D8), transport Shuffle/Repeat disabled while a
  station drives (G11), worker contract pinned, stats blob + pinned §9.2 budgets + asserter.
- Gate: **G11** determinism + controls-scoping proven (unit); **G5/G6** code+unit; **G9** budgets
  pinned with the M0/M2 device measurements + host asserter. The on-device ≥30-track continuity,
  ✕ skip-latency, and `--shuffle-replay` runs need a fresh APK + live C64U → documented manual HIL
  (§9.5). No lockfile prune committed (guarded).
- Push: milestone complete → pushed to `origin/feat/sid-radio`.

### 2026-07-24 — M3.1 stationEngine: diversity-sampled Taste + Style×Likes composition
- Task: D12 diversity-sampled Taste aggregation; D10 composed style × Likes admission; verify.
- Files: `stationEngine.ts` (+`diversitySample` — deterministic shuffleSeed-spread cap so one
  composer/cluster can't dominate a Taste station; TASTE_SEED_SAMPLE=16),
  `tests/unit/sidRadio/stationEngineStyle.test.ts` (new, 4).
- Decisions: Style × Likes ("Fast-Paced from my Likes") is `seed=taste(likes) + styleFilter=bit`
  — the engine already composes any seed with a style filter (D10), verified. Taste seeds are a
  deterministic diversity sample of Likes (D12). Style/Song + style filter admit only the bit.
- Evidence: 4 tests (broad style admits only the bit; Style×Likes composes to Fast; Song+filter
  keeps only that style; Taste diversity sample deterministic). Existing engine 10 still pass.
  eslint + prettier clean.
- Gate: feeds G7 (composition/on-vibe); Taste-unlock UI is 3.2.

### 2026-07-24 — M3.2 + M3 EXIT: launcher AppSheet → G7 (code+unit)
- Task: The SID Radio launcher (spec §5.2) — 9 style tiles, "based on my likes" composition
  toggle, Taste unlock at threshold, Surprise; close M3.
- Files: `SidRadioLauncherSheet.tsx` (new — `sid-radio-style-<bit>` tiles, `sid-radio-likes-toggle`,
  `sid-radio-taste` (+hint), `sid-radio-surprise`), `useSidRadio.ts` (startStyleRadio `fromLikes`
  composes taste+styleFilter D10; `startSurpriseRadio`; exported `SID_RADIO_STYLE_TILES` §5.4 +
  `SID_RADIO_TASTE_UNLOCK_LIKES`=5 D1), `PlayFilesPage.tsx` (`sid-radio-launcher` entry + sheet;
  likeCount from getLikedMd5s). Tests: SidRadioLauncherSheet (6).
- Decisions: the sheet composes seed × optional style (§5.2). "Based on my likes" on a style tile
  launches taste(likes)+styleFilter (D10). Taste unlocks at 5 likes (D1) with a progress hint.
- Evidence: launcher 6 tests; full sidRadio + playFiles suites (49 files / 364) pass; tsc + eslint clean.
- Gate: **G7** style admission + Style×Likes composition + Taste unlock proven (code+unit). The
  on-device on-vibe mask spot-check is a manual HIL (§9.5).

### 2026-07-24 — M4.1 station-descriptor persistence + resume (D15)
- Task: Persist the active-station descriptor → exact recompute-on-restart; resume the chip (§6.3, D15).
- Files: `sidRadioSession.ts` (new — save/load/clear the tiny tuple: seed/styleFilter/shuffleSeed/
  rankingSnapshotId/excludeOrdinals; never the full queue), `useSidRadio.ts` (persist on start +
  after each refill with the growing exclude set; clear on stop; restore-on-mount rebuilds the
  provider with the saved `initialExclude` so the next refill continues the identical sequence,
  and resumes the chip without auto-replacing the playlist). Tests: sidRadioSession (4),
  useSidRadio resume (+2).
- Decisions: store only the deterministic recompute tuple (D15) — the engine replays the exact
  continuation. Resume rebuilds the chip + provider only; the app's own playlist persistence
  restores the queue.
- Evidence: 11 tests (round-trip, null, clear, malformed-reject; start persists + stop clears;
  mount resumes the chip without startPlaylist). tsc + eslint clean.
- Gate: **G8** exact-recompute persistence + chip resume proven (code+unit); device restart = manual HIL.
