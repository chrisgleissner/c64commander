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
