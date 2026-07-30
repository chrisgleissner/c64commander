# SID Radio — HIL bug bash and production hardening (execution prompt)

Optimised against the repository as it stands on `feat/station-drifting-query` at `8be7e51b`
(2026-07-30). Every path, testid, command, constant and CLI flag below was checked against the
working tree; the sections marked **PREMISE CHECK** state what the repository contains today, which
in three places differs from the draft this prompt was derived from.

---

## 0. Premise checks — read these before anything else

### 0.1 The corpus target is `sidflow-data` 0.8.2, which was not published yet at authoring time

**Expected identity of the Tiny bundle to adopt:**

```text
release tag:            0.8.2
asset:                  sidcorr-hvsc-full-sidcorr-tiny-1.sidcorr
sha256:                 62097331d89c5f3bbfbfbdb4930bde7b139950732335e055e7d164be1c62d294
schema:                 sidcorr-tiny-1
binary format version:  2
file count:             61,157
track count:            87,868
neighbours per track:   3
style/category count:   9
```

**What the repository pins today.** `src/lib/sidRadio/sidcorrRelease.ts` pins release `0.8.0` with
sha256 `64bee4464c89f605ea15e468168ff39b9f00bb8bf659da2af59ad0004f7c9c6d`, and on 2026-07-30
`gh release list --repo chrisgleissner/sidflow-data` returned 0.8.0 (2026-07-27) as `Latest` — so
the current pin is correct for the corpus that existed then, and 0.8.2 is a forward dependency that
is expected to land before or during this run.

Note that every count above is identical to the `SIDCORR_EXPECTED` block already in
`sidcorrRelease.ts`. The migration changes **edges, not membership**.

**First action of the run: re-check the release list.** Three outcomes, and they are not
interchangeable:

| Outcome | What to do |
| --- | --- |
| 0.8.2 published, identity matches the block above | Run §4 in full. |
| 0.8.2 published, identity differs (digest, counts, schema, format version) | A concrete discrepancy. Report it with both observed and expected values, do **not** guess which is right, and do **not** re-pin to bytes you could not verify. |
| 0.8.2 still unpublished | §4 is blocked on an external dependency. Complete **every other workstream in full**, then report the run as complete except the corpus gate, naming the exact check performed and its result. |

That third outcome is the one part of this prompt that may legitimately not finish. It must be
reported as **blocked**, never as done, skipped, deferred without explanation, or worked around by
synthesising a fixture and treating it as the real bundle.

**What 0.8.2 changes, precisely.** It is not a style-mask or category-classification change. For
the Tiny bundle it changes the neighbour table, the graph flags, the orientation of the neighbour
graph, and it adds a declared flow successor in neighbour slot 0. Unchanged from 0.8.0: `md5_48`
identities, per-file track counts, packed ratings, style masks, binary format version, section
layout, and overall bundle size. The graph remains acyclic. Neighbour slot 0 becomes a corpus-wide
flow successor, giving a deterministic non-repeating continuation through the corpus.

### 0.2 The branch is not a corpus upgrade — it is a new continuation model. Preserve it.

`main..HEAD` is three functional commits (`e6f75c7e`, `19f20eb4`, `f7b3cc54`) touching
`stationEngine.ts`, `stationQueueProvider.ts`, `rankingStore.ts`, `sidRadioSession.ts`,
`sidRadioStats.ts` and their tests. They implement:

- **the drifting query (spec E1)** — recently played ordinals are re-seeded into the walk at a
  recency-decayed weight, so the retrieval centre moves with the listener;
- **tune-level dedupe (spec E2)** — exclusion is by `.sid` file, not track ordinal, so subsongs 1–3
  of one file are one tune;
- **a stated aim/roam balance** — `DEFAULT_STATION_BALANCE` in `stationEngine.ts`, swept by
  `scripts/sidRadio/measure-station-depth.ts`.

Measured on the pinned 0.8.0 bundle: median distinct tracks before self-reported exhaustion went
from **1,676 (fixed seed) to 59,704 (drifting query)**, against a 61,157-file ceiling
(`docs/plans/sid-station/spec.md` §2.3, as amended on this branch).

The draft's diagnosis — "a bounded neighbourhood around an unmoving seed may report exhaustion
while many valid tracks remain" — was true of `main` and has already been fixed, by a different
mechanism than the flow successor. So: the flow successor is an **addition to evaluate** (§4.4),
not a replacement to install, and the 100-song traversal requirement (§8) is a hardware
**verification** task, not a re-implementation task.

### 0.3 Style-constrained similarity is half-built, and "category" is the wrong word here

The engine, the worker protocol and the session descriptor already carry the constraint:
`StationEngineOptions.styleFilter` (`stationEngine.ts:154`), `StationRequest.styleFilter`
(`sidRadioWorkerProtocol.ts:29`), forwarded at `sidRadioWorkerCore.ts:84`, persisted as
`styleBit`. What is missing is exactly one thing: the song entry point hardcodes it to null.

```ts
// src/pages/playFiles/hooks/useSidRadio.ts:357
const startSongRadio = useCallback(
  (md5_48: string, seedLabel: string) => start({ kind: "song", md5_48 }, null, "song", seedLabel),
  [start],
);
```

Naming: the nine things the draft calls "categories" are **style tiles** in code
(`SID_RADIO_STYLE_TILES` in `useSidRadio.ts:111`, testids `sid-radio-style-<bit>`), and the
launcher calls them **moods** on screen ("pick a mood, your taste, or both",
`SidRadioLauncherSheet.tsx:61`). `category` is already taken: `PlayFileCategory` is the file type
(`sid`/`mod`/`prg`/`crt`/`disk`) and every `PlaylistItem` carries `category: "sid"`. Do not
introduce a second meaning. Use **mood** on screen and **style bit** in code. The nine, with their
bits and keys, are fixed by `SID_RADIO_STYLE_TILES`:

```text
0 fast_paced Fast-Paced · 1 slow_ambient Chill / Ambient · 2 melodic Melodic
3 experimental Experimental · 4 nostalgic Nostalgic · 5 composer_focus Composer Deep-Dive
6 era_explorer Era Explorer · 7 deep_discovery Deep Cuts · 8 theme_hunter Game Themes
```

### 0.4 The pending-seek UX is partly shipped. Complete it; do not redesign it.

`PlaybackControlsCard.tsx` already renders a translucent rendered-ahead fill
(`playback-rendered-ahead`, `data-rendered-percent`), a target marker while playback waits
(`playback-awaited-marker`, `data-awaited-percent`) and an `⏳` prefix on the elapsed label
(line 417). `localSidEngine.ts` already defers the seek and resumes "the moment coverage passes
it" rather than re-rendering (see the comment at `localSidEngine.ts:501`, and the pre-render worker
at `:513`). `renderThroughput.ts` already keeps a smoothed render ratio. AGENTS.md §"Seeking costs
a full re-render" states the design rules that produced this.

§6 lists what is genuinely missing against that baseline. Rebuilding the parts that exist would
destroy a design that was arrived at by shipping the opposite twice.

---

## 1. Role, rig and hard rules

You are a senior engineer on **C64 Commander** (also shipped as **C64U Remote**), working
autonomously on the existing branch `feat/station-drifting-query`. Expertise assumed: Capacitor and
Android, React/TypeScript, Web Workers, deterministic state machines, concurrent audio, libsidplayfp
and SID rendering, HVSC metadata and subsongs, similarity/recommendation systems, and
hardware-in-the-loop testing driven from ADB and CDP.

**Do not** reset to `main`, recreate the branch work, or revert §0.2. **Do not** commit, push, open
a PR or touch remote state unless separately instructed — except that you may read GitHub
(`gh release list`, `gh pr view`) and download the pinned release asset.

### Rig

- Pixel 4, serial `9B081FFAZ001WX`. DPR 2.75, viewport 392×829 CSS, physical = CSS × 2.75, no
  offset, full-screen WebView.
- **`c64u` only.** The u64 is in use by the owner and must not be touched at all — no REST, FTP,
  Telnet, streams, config reads or "just checking it is up". This **overrides** AGENTS.md
  §"Exploratory investigations", which prefers the u64. If the c64u is unreachable or wedged, stop
  and report; do not fall back.
- **Always re-read `/etc/hosts`** before believing an IP. They are DHCP-volatile and a stale one is
  indistinguishable from a device dropout.
- Startup discovery lists every machine on the network. Match on device id, not position:
  **`5d0464` is the c64u**; `38c1ba` is the u64; `f13e69` is the u2. Testids are
  `startup-use-discovered-device-id:<id>`.
- **Media volume must never exceed 10 of 25.** Hard limit, comfort and hearing safety, outranks any
  measurement that would be easier with more level (AGENTS.md, Phase 5b). If you change it,
  restore it to ≤10 immediately and say so. At volume 10 a microphone at normal distance is not a
  usable dropout detector (6 dB SNR); put the mic against the grille, take a line feed, or —
  better — instrument the audio path and timestamp the buffer callbacks.
- The Callback 8020 does not exist. The Pixel 4 stands in for every phone. Never gate work on it.

### Method rules

- **Every fix gets a regression test, and you must watch it fail without the fix.** Assert the
  substring you are about to remove actually exists before removing it — a `replace` that silently
  does not match "proves" a fix for the wrong reason (see `docs/agentic/hil-rc4/FINDINGS.md`).
- **Before amending a failing test, ask whether the new behaviour makes sense to a user.** If not,
  the production code is wrong. If you do amend one, say why in a comment.
- **Never `git add -A`.** A local build rewrites `package-lock.json`,
  `c64scope/package-lock.json` and `THIRD_PARTY_NOTICES.md`; sweeping that churn into a commit has
  broken CI here. Add explicit paths.
- **`npm run typecheck`, never bare `tsc --noEmit`** — CI typechecks two tsconfig projects and bare
  `tsc` passes things the app project rejects.
- Do not run two device drivers at once; an orphaned scenario script corrupts both runs. Kill by
  explicit PID (`pgrep -f` matches its own shell and has killed the agent's own bash here).

---

## 2. Sources of truth (read in this order)

1. `docs/plans/sid-station/spec.md` — authoritative for SID Radio. §2.3 (engine + drifting query),
   §2.6 (bundle parse), §3 (packaging and the digest pin), §5 (UX), §6.3 (persistence and what a
   resume does and does not guarantee), §9.2 (budgets), D1–D15 (§11), §12 (local engine).
2. `AGENTS.md` — repo law. Especially: "Seeking costs a full re-render", "Async guards, gates and
   supervisors", "A test that does not fail without the fix is not a test", the screenshot rules,
   Phase 5b/5c (deploy the newest APK, version identity from Git).
3. `docs/plans/sid-station/HANDOVER-HIL-0.9.4.md` — the current campaign handover: rig, harness,
   traps that cost real time, and the u64 rule.
4. `docs/agentic/hil-rc4/FINDINGS.md` — the seven hardware defects already found and fixed, plus
   the things that looked like defects and were not. Git-ignored, present on this machine.
5. `docs/plans/sid-station/WORKLOG.md` / `PLANS.md` — folder-scoped ledgers. Append to WORKLOG;
   keep PLANS current. **Never edit the repo-root `PLANS.md` / `WORKLOG.md` / `AGENTS.md`.**
6. `tools/hil/README.md` — what each harness measures and how to read a failure.
7. `REVIEW.md`, `.github/copilot-instructions.md`, `docs/ux-guidelines.md`.

---

## 3. What already exists — verify, extend, do not rebuild

| Area | Where | State |
| --- | --- | --- |
| Corpus pin | `src/lib/sidRadio/sidcorrRelease.ts` (app-facing), `scripts/fetch-sidcorr.mjs` (`SIDCORR_RELEASE`, build-side copy), `tests/unit/scripts/fetchSidcorr.test.ts` (drift test) | Pinned 0.8.0; fetch hard-fails on digest mismatch (exit 1) and re-downloads a cached bundle that predates the pin |
| Parser | `src/lib/sidRadio/sidcorrTiny.ts` | Header + section validation, u24→u32 neighbour expansion, reverse-CSR index; synthetic fixture at `tests/fixtures/sidcorr/buildTinyFixture.ts`; opt-in real-bundle golden via `SIDCORR_REAL=1` |
| Pure engine | `src/lib/sidRadio/stationEngine.ts` (`computeStation`, `StationBalance`, `admit`, `styleFilter`) | Drifting query, deterministic in `(seed, recent, rankingSnapshot, shuffleSeed, exclude)` |
| Queue provider | `src/lib/sidRadio/stationQueueProvider.ts` | Lookahead 10, batch 24, file-level retire, `minSeconds` post-filter, `shortTracksSkipped` |
| Worker | `sidRadio.worker.ts`, `sidRadioWorkerCore.ts`, `sidRadioWorkerProtocol.ts`, `sidRadioWorkerClient.ts` | Off-main-thread; contract test at `tests/contract/sidRadioWorker.contract.test.ts` |
| Hook | `src/pages/playFiles/hooks/useSidRadio.ts` | Station lifecycle, resume, steer, `SID_RADIO_STYLE_TILES` |
| Transport | `src/pages/playFiles/hooks/usePlaybackController.ts` | `handleNext`/`handlePrevious`/auto-advance/`seekToFraction`; station items are ordinary playlist items, so history is the playlist |
| Progress UI | `src/pages/playFiles/components/PlaybackControlsCard.tsx` | `playback-progress-seek`, `playback-rendered-ahead`, `playback-awaited-marker`, `playback-progress`, `playback-elapsed` |
| Local engine | `src/lib/playback/localSidEngine.ts`, `localSid.worker.ts`, `localSidNativeSink.ts`, `renderedTuneCache.ts`, `renderThroughput.ts` | Dedicated pre-render worker, coverage-gated resume, native AudioTrack sink |
| Settings | `src/lib/config/appSettings.ts` (`c64u_sid_radio_min_seconds`, `DEFAULT_SID_RADIO_MIN_SECONDS = 15`, `MAX_… = 600`), `src/pages/settings/SidRadioSettingsSection.tsx` | Clamped 0…600, broadcast on write |
| Stats blob | `src/lib/sidRadio/sidRadioStats.ts` (`SID_RADIO_STATS_TESTID = "sid-radio-stats"`) | 20+ fields incl. `emittedSequence`, `refillMainThreadMaxMs`, `audioUnderruns` |
| Budgets | `ci/perf/sid-radio-perf-thresholds.json` + `scripts/assert-sid-radio-perf.mjs` | Measured-then-pinned; each entry carries its measurement note |
| HIL | `tools/hil/sid_radio_hil.py`, `seek_latency_hil.py`, `sid_radio_depth_hil.py` (untracked), `mic_dropout_scan.py` (untracked), `audio_overlap_hil.py`, `sid_audio_match.py` | See §9 |
| Depth harness | `scripts/sidRadio/measure-station-depth.ts` | Drives the **production** provider + engine against the real bundle, host-side, no device |
| Campaign harness | `docs/agentic/hil-rc4/` (`taptid.sh`, `snap.sh`, `campaign/*.sh`) | Git-ignored; present here; copy forward if you need it after a clone |

Unit and component tests live in `tests/unit/sidRadio/` (26 files) and `tests/unit/playback/`; the
worker contract test is in `tests/contract/`.

---

## 4. Workstream A — adopt and verify the 0.8.2 corpus

Gated on §0.1. If 0.8.2 is unpublished, this workstream is blocked; everything else proceeds.

### 4.1 Re-pin, coordinated

The pin exists in more than one place by design, with a test that stops them drifting. Update all
of them together:

- `src/lib/sidRadio/sidcorrRelease.ts` — `SIDCORR_RELEASE_TAG`, `SIDCORR_BUNDLE_SHA256`, and
  `SIDCORR_EXPECTED` only if the published manifest genuinely differs (per §0.1 the counts should
  not change; if they do, that is a discrepancy to report, not to absorb).
- `scripts/fetch-sidcorr.mjs` — the build-side `SIDCORR_RELEASE` copy.
- `tests/unit/scripts/fetchSidcorr.test.ts` — the drift test already asserts the two copies agree
  and that the digest is 64 lower-case hex; it should keep passing on the new values without
  structural change.
- Any manifest expectation or generated/packaged asset that names the release.

The build already fails loudly on a digest mismatch (`fetch-sidcorr.mjs` exits 1) and re-downloads
a cached bundle that predates the current pin. Verify that path against the new asset rather than
rebuilding it, and confirm the bundle is still git-ignored and still reaches the native asset
bundle through `public/` → `dist/` → `cap copy`.

### 4.2 Parser reality check — establish what actually has to change

Read `sidcorrTiny.ts` against the real 0.8.2 bytes before writing any parser code. Three facts
about today's parser that determine the size of this task:

- **The header has unread space.** It reads magic (0–7), version u16 @8, header bytes u16 @10,
  track count u32 @12, file count u32 @16, style count u16 @20, neighbours-per-track u16 @22,
  section offsets @32–48 and section byte-lengths @52–60. **Bytes 24–31 are never read.** If 0.8.2
  declares graph flags there, the parser must be taught to read and expose them. "Unknown flag bits
  are ignored" is currently true only by omission, which is not the same as being correct.
- **It hard-rejects some shapes.** `neighborsPerTrack !== 3` and `version ∉ {1,2}` both throw, and
  `hasNeighborSimilarity` / `hasPackedRatings` are inferred from byte-length arithmetic and offset
  layout. If 0.8.2 keeps binary format version 2, the section layout and the overall size — as
  §0.1 says it does — the existing parser accepts the new bytes unchanged. Confirm that against the
  real asset; it is the difference between a pin bump and a parser change.
- **There is no lower-ordinal rule to remove.** Neither `sidcorrTiny.ts` nor `stationEngine.ts`
  contains a rule that neighbour targets must have lower alphabetical track ordinals. The test in
  §4.3 asserts that it stays absent; this is not a removal task.

### 4.3 Real-bundle graph tests

Test against the **actual published bytes** (opt-in `SIDCORR_REAL=1`), not only the synthetic
fixture from `tests/fixtures/sidcorr/buildTinyFixture.ts`. Assert:

1. the parser accepts the exact real bundle;
2. schema id and binary format version are as expected;
3. the graph declares acyclicity;
4. the graph declares the flow-successor capability;
5. slot 0 is interpreted as the flow successor;
6. no lower-alphabetical-ordinal rule is enforced anywhere;
7. every track except the final flow track has a valid successor;
8. exactly one track is the final flow track;
9. following slot 0 from the flow root visits all **87,868** tracks exactly once;
10. the flow walk never repeats a track ordinal;
11. adjacent flow steps never move directly between two subsongs of the same `.sid` file;
12. unknown graph-flag bits are ignored unless required for an explicitly used capability;
13. style-mask populations match the corpus — and, since masks are unchanged from 0.8.0, match the
    0.8.0 populations, which is a free cross-check that the migration touched only edges;
14. no style bits are lost, shifted or reinterpreted by the parser.

Record the measured graph flags and the complete flow-chain coverage in the final report.

### 4.4 The flow successor does not replace the drifting query

Updating the pin is necessary and not sufficient, but the converse trap matters more here: the
branch already reaches a median depth of 59,704 distinct tracks (§0.2), so any use of slot 0 has to
earn its place.

- **Measure before and after** with `scripts/sidRadio/measure-station-depth.ts` on the same seeds.
  Adopting slot 0 must not reduce depth, must not break determinism, and must not turn a similarity
  station into a corpus-order playlist.
- **Re-measure the drifting query on the new bundle regardless.** The 59,704 figure describes
  0.8.0, and 0.8.2 changes the neighbour table. Re-run the sweep and re-state the number in the
  spec and the report; a depth regression caused by the new edges is itself a finding.
- If slot 0 is adopted, use it as the **continuation of last resort behind the similarity
  neighbourhood** — local musical relevance from the neighbourhood, slot 0 as the long-term
  backbone, the remaining slots for local alternatives — and document the transition policy
  exactly: when the walk falls back, what it does on return, and how it stays deterministic.
- Every admission predicate (minimum length, style bit, ✕, file-level dedupe, already-played) must
  apply to flow-successor candidates too. A continuation path that bypasses admission is a
  regression dressed as a feature.
- Whatever is adopted must remain: deterministic for fixed inputs, incremental, non-repeating,
  bounded in memory, off the main thread for expensive work, capable of at least 100 accepted
  songs, compatible with station restore, and independent of alphabetical SID path ordering.

### 4.5 Ordinal stability across the re-pin

Persisted station descriptors store **track ordinals** (`excludeSet`, `recentOrdinals`). If ordinals
changed meaning between 0.8.0 and 0.8.2, every restored station would silently aim at the wrong
tracks — precisely the class of defect this campaign exists to find, and invisible without a
deliberate check. Since `md5_48` identities and per-file track counts are unchanged, ordinals should
be stable: prove it by resolving a sample of ordinals under both bundles and comparing identities,
and decide explicitly what a descriptor written under an older bundle should do if they are not.

---

## 5. Workstream B — the minimum-length rule is not enforced end to end

### The rule

```text
duration <  configured minimum → reject
duration == configured minimum → accept
configured minimum == 0        → filtering disabled
```

Default 15 s (`DEFAULT_SID_RADIO_MIN_SECONDS`). A rejected tune must never appear as the current
track, in the visible upcoming queue, during a transition, via Next, via Previous, via
auto-advance, via ✕ (Not for me), via refill, after a restart, or in restored history once a
stricter minimum takes effect.

### Two specific leads — confirm or refute each on hardware before fixing

1. **`admit` is dead code.** `StationEngineOptions.admit` exists (`stationEngine.ts:183`) and is
   applied inside the walk (`:339`, `:400`), but **no caller ever passes it**:
   `computeStationResponse` (`sidRadioWorkerCore.ts:76-94`) forwards `seed`, `styleFilter`,
   `likes`, `notForMe`, `shuffleSeed`, `exclude`, `recent`, `limit` — and nothing else.
   `StationRequest` has no field that could carry duration knowledge into the worker. So the
   length rule is applied only as a post-filter in the provider
   (`stationQueueProvider.ts:157-167`). Per the standing rule that an admission filter must be
   passed *into* the walk so the walk widens to pay for it, this is the shape that makes a station
   report exhaustion while candidates remain.
2. **Unknown durations are admitted by design.** `stationQueueProvider.ts:161` — "An unknown
   length is admitted — never drop a tune because the songlengths are thin." That is a deliberate
   choice, and it is also the most likely way a 3-second tune reaches the queue: if the
   `virtualPath` + `songIndex` pair fails to resolve against HVSC songlengths, the tune is
   admitted with no length at all. Establish empirically which resolution failures occur on the
   device (path normalisation, one-based vs zero-based subsong index, MD5 fallback, async
   resolver rejection) before changing the policy. If the policy stays, the reject/accept
   accounting must still show unknown-length admissions separately.

### Reproduction (baseline APK, before any code change)

Set the shortest-tune value through the real Settings UI, start several real stations, navigate
hard with Next/Previous, and capture for any tune that plays or queues below the cutoff: virtual
path, full MD5, `md5_48`, subsong, the duration as resolved by the production songlength service
(`src/lib/hvsc/hvscSongLengthService.ts`, not the UI label), station type, seed, playlist index,
and how it entered the queue (initial generation / refill / restore / history). Preserve the
evidence before you touch code.

### Dynamic changes to the setting during an active station

Queued-but-unplayed items and unplayed forward history must be revalidated; backward history must
not replay a now-forbidden item; refill results computed under the old minimum must be rejected;
the station continues from the next valid item, or — if the current item became invalid —
transitions to the next valid item or ends with a truthful explanation. Use an explicit
admission-generation id so superseded work cannot re-enter the queue.

### Required tests

14 s rejected at a 15 s cutoff · exactly 15 s accepted · 0 disables filtering · per-subsong
durations · one-based/zero-based boundaries · missing duration · malformed duration · async
resolution · many rejections before a hit · refill after many rejections · restored station ·
minimum raised mid-playback · minimum lowered mid-playback · stale refill from the old minimum ·
forward and backward navigation · every station entry point · composed with a style filter ·
composed with ✕. Mocked-provider tests are not sufficient on their own: include one integration
path through the real `hvscSongLengthService` resolution.

---

## 6. Workstream C — seeking past the render head

### Already shipped (§0.4) — verify on device, then extend

Translucent rendered fill, target marker, `⏳` elapsed prefix, deferred seek that resumes when
pre-render coverage passes the target, smoothed render ratio in `renderThroughput.ts`.

### The state model to make explicit

Represent these independently rather than deriving them from one slider value:

| Name | Meaning | Drives |
| --- | --- | --- |
| `audiblePosition` | what is being heard now | solid fill, elapsed clock |
| `renderedPosition` | furthest immediately seekable position | translucent fill, instant-seek eligibility |
| `pendingSeekTarget` | requested position beyond coverage | target marker; never shown as audible |
| `renderedPositionAtRequest` | render watermark when the target was accepted | denominator of preparation progress |
| `trackInstanceId` | identity of the active track instance | rejects cross-track completions |
| `seekGeneration` | monotonic | rejects stale completions |

### Gaps to close

1. **A determinate inline status under the bar**, not a tooltip — this is a touch UI. Format:
   `Preparing audio for 0:27 · 68% · about 4 s`, degrading to `… · 68%`, then
   `Almost ready to continue at 0:27` below ~1 s. Whole seconds only; no ETA until the render-rate
   sample is valid; remove the ETA when it stops being valid.
2. **Progress is `(renderedPosition − renderedPositionAtRequest) / (pendingSeekTarget −
   renderedPositionAtRequest)`, clamped to [0,1].** It must start near zero, increase
   monotonically for an unchanged target, never be derived from the audible playhead, reach 100%
   when the target becomes seekable, and reset when a new target supersedes it.
3. **ETA is `(pendingSeekTarget − renderedPosition) / renderedAudioSecondsPerWallSecond`** using
   the smoothed rate from `renderThroughput.ts` — do not add a second rate estimator.
4. **The target marker needs an accessible identity.** It is currently a 2 px `aria-hidden` line
   with no label and no timestamp. Give it a distinct cap, the requested timestamp, and a label.
5. **A polite live region** for the pending state, throttled:
   `Rendering audio for position 27 seconds. 68 percent ready. About 4 seconds remaining.`
6. **An animated pending region** from the render head towards the target, honouring
   `prefers-reduced-motion`. Do not use an hourglass metaphor; do not distinguish states by colour
   alone.

### Preferred interaction, and the permitted fallback

Preferred, unless hardware evidence proves it unsafe: keep playing from the current audible
position, hold the requested target separately, keep rendering, show the pending state, and perform
one atomic seek when coverage reaches the target. If normal playback reaches the target first, do
not seek backwards and do not apply the target twice.

Permitted fallback if the engine cannot safely continue while preparing: freeze the audible
position at the last genuinely audible location, stop advancing the elapsed clock, show the target
separately with determinate progress, and resume automatically. A silent wait with a normally
advancing playhead is forbidden, and so is requiring a second Play tap.

### Gesture semantics — one open question to settle first

`PlaybackControlsCard.tsx:432-437` calls `onSeekToFraction` on **every pointer move**, while
AGENTS.md says "Never seek on a gesture sample… The gesture moves the bar; the release seeks
once." Establish what `usePlaybackController.seekToFraction` (`:2370`) actually does with those
samples — if it coalesces or defers, the code is consistent with the rule and the comment is what
needs correcting; if it does not, this is a defect and the drag must preview only, committing one
seek on release from the final finger position, cancelling cleanly on pointer cancel.

While a target is pending: a new drag replaces it; a target inside coverage seeks immediately;
dragging back to the audible position may cancel it; Next, Previous, Stop, station change, route
change, engine change and natural track completion all cancel it first; stale completions from an
older track or generation are ignored; Pause preserves the target but must not auto-resume against
an explicit paused state. The latest valid user intent wins.

**Near-end seeks** must either play the remainder and auto-advance exactly once, or auto-advance
immediately when the target is effectively at the end. They must not stall, report the song ended
before the target was reached, advance twice, leave the cursor on the wrong item, or apply an old
seek after the next song has started.

### Pixel 4 scenarios (real touch on the bar — see §9)

Seek inside coverage · slightly beyond · far beyond · replace pending with nearer · replace with
farther · move back into coverage · Next while rendering · Previous while rendering · Stop while
rendering · Pause while rendering · Resume while rendering · into the final 10% · repeated rapid
drags faster than rendering · track change as rendering reaches the target · background/foreground
while pending · app restart while pending · route change while pending.

Screenshots at: target accepted · roughly halfway · immediately before readiness · immediately
after playback resumes. They must be understandable without a developer explaining them.

---

## 7. Workstream D — a song station constrained by one mood

### Semantics

```text
admissible ⟺ candidate is in the similarity-generated stream AND candidate has the selected style bit
```

Not OR, not a score boost, not a post-generation visual filter, not a fallback from similarity to
mood, not a mood station seeded by the current song. The predicate participates in **admission and
continuation**: when nearby candidates fail it, the walk must widen rather than report exhaustion.
`computeStation` already applies `styleFilter` inside the walk — confirm that by reading it, and
keep it that way.

### UI

The song-station launcher gains `All moods` plus one option per tile. The active station label
shows both constraints, e.g. `Similar to Bouncy_Balls.sid · Melodic`. Changing the constraint keeps
the song seed, supersedes the station generation, cancels in-flight refills and candidate
resolution, starts a fresh deterministic station, resets station history, rejects results from the
superseded generation, and never appends old-constraint items. An empty intersection is reported
truthfully — never silently relaxed to `All moods`, switched to OR, or served from an old queue.

`useSidRadio.ts:295-301` already refuses a station whose style tile has zero population, ahead of
any compute; reuse that check rather than adding a second one.

### Tests

For every emitted item in a constrained station, prove both predicates independently, using an
oracle built directly over the Tiny bundle's style mask — never by calling the production station
function to compute its own expected answer. Cover: `All moods` · each of the nine · broad
intersections · sparse intersections · empty intersections · constraint changed during playback,
during refill, during a pending seek, during duration resolution · restored after restart ·
composed with the minimum length · composed with ✕ · composed with already-played exclusion ·
deterministic replay for fixed inputs · different `shuffleSeed` giving different valid orderings ·
superseded-generation results rejected.

---

## 8. Workstream E — continuation and exactly reversible history

### What "working" means

A station is working only when the real bundle is loaded, the seed resolves, every emitted item
resolves to an installed HVSC path with the right subsong and an admissible duration, the style
predicate holds where active, the selected engine accepts playback and playback actually begins,
Next/Previous/auto-advance/refill/continuation all work, history stays reversible, no track and no
`path+subsong` identity repeats, no prohibited adjacent sibling subsong is emitted, no false
exhaustion occurs, and Stop restores ordinary playlist behaviour.

Validate every entry point: song station · song station × each mood · each mood station · taste ·
surprise. Use several deterministic seed songs from substantially different parts of HVSC — a
single well-connected seed proves nothing.

### The 100-song matrix

Define `H = [s0 … s100]`, each identity recording track ordinal, full MD5 where available,
`md5_48`, virtual path, subsong, style mask, resolved duration and station generation id.

- **Forward:** 100 real Next taps. After each: the current item is exactly the next expected one,
  the engine accepted playback, playback began, one tap advanced exactly once, no ordinal repeat,
  no `path+subsong` repeat, no prohibited sibling transition, no forbidden short tune, the style
  intersection holds where active, refills did not alter earlier history, and no false exhaustion
  before `s100`. Do not assign the playlist index or call a navigation handler directly.
- **Backward:** from `s100`, 100 real Previous taps, observing `s100, s99, …, s0`. Backward
  navigation replays recorded history exactly: no replacement item, no reshuffle, no subsong
  change, no new similarity decision for an old position, no refill triggered solely to
  reconstruct an old item, exact across refill boundaries.
- **Forward replay:** 100 Next taps from `s0` reproduce `s1 … s100` exactly. New generation happens
  only once the cursor reaches the end of retained history.
- **Invariant:** `Previous(Next(x)) == x` and `Next(Previous(x)) == x` wherever the neighbouring
  history item exists and no station-changing action intervened.

Because station items are appended to the ordinary playlist and `handlePrevious` moves the playlist
cursor, this should already hold structurally. Verify it rather than assuming it, and find the
boundary where it stops holding (retention limits, restore, refill).

### Ranking versus history

♥ may influence future not-yet-generated items. ✕ may skip the current item and influence future
generation. Neither may rewrite visited history. Test this explicitly.

### Restart

Navigate ≥30 forward, record identities and position, terminate, relaunch, restore, navigate back,
then forward again — identities must match. Note that spec §6.3 (as amended on this branch) states
what a resume does **not** guarantee: the resumed sequence need not equal what an uninterrupted
station would have produced, because a refill computes a larger batch than it emits and the
un-emitted tail lives only in memory. It guarantees the continuation is a pure function of the
persisted descriptor, and that nothing is repeated or lost across the interruption. Test against
that contract; if the persisted history window is bounded, document the limit and test below it, at
it, and beyond it. If the corpus was re-pinned, §4.5 applies here.

### Matrix

Run the full 100/100/100 proof for: one unconstrained song station on the C64U route; one
mood-constrained song station; one local-playback route on the Pixel 4. Run shorter but still real
traversals for every mood station, taste, surprise, and `Both` where supported. Every selected
track needs positive evidence that the playback transition was accepted.

Host-side, `scripts/sidRadio/measure-station-depth.ts` drives the production provider and engine
against the real bundle and reports distinct tracks before exhaustion, same-file adjacency and
duplicates. Use it to pick seeds and to bound expectations before spending device time — it is an
upper bound, because it applies neither `minSeconds` nor `md5_48 → virtualPath` resolution.

---

## 8b. Workstream F — an audible dropout, and station CPU that grows with depth

Raised by the user on 2026-07-30 against branch build `0.9.4-f7b3c`, after the drifting-query change
landed. Two findings, one of which is a user-visible defect and blocks a clean bill of health.

### 8b.1 The report

"There was a short gap ca. 2s into the song (`No_way_out.sid`) just now. I thought this was fixed;
apparently it reoccurred." Corrected shortly after: **the gap was about 0.1 s, estimated by ear.**
He then played `Sam_2.sid` and heard nothing wrong, so **it is intermittent**.

100 ms is starvation, not a click at a buffer seam. Do not spend time on sample-level discontinuity
hunting as the primary line.

### 8b.2 Why it is plausibly a recurrence, and the falsifiable version

`ci/perf/sid-radio-perf-thresholds.json` records that `audioUnderruns` regressed to 1 once before,
when the G11 determinism sequence moved to emit time and put `querySelector` plus a full
`JSON.stringify` on the main thread once per emitted item. The fix made `recordEmitted` update memory
only and left the following `recordRefill` to flush.

**That fix reduced how often the main thread stringifies. It did not reduce what it costs, and the
cost has since grown roughly 40x**, because a station now excludes ~59,700 tracks where it used to
exclude ~1,400. Two seconds into a track is about when `StationQueueProvider` tops up its lookahead,
which is when `recordRefill` and the session save run.

The prediction that makes this testable rather than a story: **the dropout should recur roughly once
per refill (not once per track), early in the track, and should scale with station depth — rare or
absent on a fresh station, reliable on a deep one.** Test that before fixing anything.

**A competing mechanism that fits the duration better.** 100 ms is long for the CPU involved: at a
3-5x Pixel 4 multiplier the measured desktop costs give 11-19 ms, not 100. A major GC pause on a
Pixel 4 is very plausibly 50-150 ms, and the allocation profile at depth is exactly what provokes
one — a ~344 KB string, a 60,000-element `Set` and a 60,000-element array clone churned per refill.
If it is GC, then making the code faster is not sufficient; it has to allocate less. Capture ART and
V8 GC events from `logcat` during playback and correlate them against refills. "We made it 20x
faster" is not evidence the dropout is gone.

### 8b.2a MEASURED AFTER THIS SECTION WAS WRITTEN — read before acting on 8b.2

The hypotheses above were written before the device measurements existed. Several are now settled or
refuted. **Trust this subsection over 8b.2 where they disagree.**

**The `audioUnderruns` counter was structurally blind, and the listener was right.** It reported 0
because `localSidNativeSink` read `bufferedMs` out of the plugin payload and discarded the rest,
so `AudioTrack.underrunCount` — AudioFlinger's own count of the output running dry, which
`AudioPipeline.kt` has always reported — never crossed the plugin boundary. What the metric actually
reported was `LocalSidChunkScheduler` accounting, which is correct for the Web Audio sink where the
schedule *is* the output, and meaningless on the native sink where a ring drains on its own thread.
Fixed in `a4d82efa`. On otherwise identical builds it now reads **2 underruns at depth 1,000 and 2 at
depth 60,000**, where it read 0 before.

**So the strong form of the depth prediction in 8b.2 is refuted.** Underruns occur at depth 1,000 as
well as 60,000. Depth aggravates; it is not necessary. Do not go looking only at deep sessions.

**The main-thread budget is not the problem.** Measured on device: 0.5 ms at depth 1,000 rising to
5.8-11.1 ms at 60,000, against the 16 ms `refillMainThreadMaxMs` pin. Never breached. The desktop
extrapolations that suggested 24-40 ms were wrong. A bitset is still worth doing, but not to rescue
this budget, and shipping it will not on its own remove the underruns.

**`lastRefillMs` is breached at every depth, including 1,000** — 1.4 s at depth 1,000 rising to
3.9 s, against a 150 ms pin. That is where the CPU actually goes, and it is not the per-compute cost:
a single `computeStation` at 84k exclusions is about 14 ms, so a 3.8 s refill is roughly **25
computes**. `StationQueueProvider.refill` recomputes whenever its 24-candidate buffer empties, and at
depth most candidates are consumed without being emitted, because path resolution against a partial
HVSC and the `minSeconds` rule discard them. **The multiplier is the defect, not the per-compute
cost.** Shrinking each compute helps a little; dividing the number of computes helps a lot. Raising
the refill batch, or lifting path resolution and the length filter into the engine so the walk stops
producing candidates that will be thrown away, are the two obvious directions.

**Worker CPU at depth: about 99% + 50% of a core, with the main thread at 72%** — roughly 2.2 cores
in the renderer process, contending with the SID render on a thermally throttled device.
`renderMsPerSec` stayed 497-593 against its 850 pin throughout, so the early warning never fired.

**One unresolved contradiction, and the first thing to investigate.** `__localSinkDebug()` reported
`queuedSec: 0` with `pumping: 1` — a 15 s ring showing empty while live — and over a 300 s trace the
ring was at <=0.05 s in 104 of 215 samples while the elapsed clock advanced. That is far more severe
than two underruns. Either the ring is genuinely running dry far more often than `underrunCount`
says, or that debug field is stale or cached. Settle which before optimising anything, because the
two readings imply very different problems.

**Station depth when the user heard the gap: 84,282 exclusions.** Read over CDP. But that was a
depth-probe descriptor installed by the measurement harness, so his listening and the test load
coincided — it supports the depth hypothesis without isolating it.

### 8b.3 The costs, measured on desktop

87,868-track corpus, scattered ordinals, 20 repeats after a warm-up:

| depth | session `JSON.stringify` | payload | `structuredClone` of exclude | worker `new Set(...)` |
|---:|---:|---:|---:|---:|
| 1,000 | 0.05 ms | 6 KB | 0.06 ms | 0.09 ms |
| 10,000 | 0.38 ms | 58 KB | 0.48 ms | 0.70 ms |
| 30,000 | 1.35 ms | 172 KB | 0.93 ms | 2.08 ms |
| 60,000 | 2.07 ms | **344 KB** | 1.80 ms | **4.03 ms** |

A fixed bitset over the corpus is **10,984 bytes at any depth**: 0.02 ms and 14 KB to persist,
0.002 ms to transfer, and no set to build at all because membership becomes a bit test. That turns
all three from O(depth) into O(1). Note it is marginally *slower* below about 5,000 exclusions, so
ship it unconditionally rather than behind a depth threshold.

Two cautions. The desktop figures above are 2-4x lower than an earlier set taken on the same machine
under heavy load; at a Pixel 4 multiplier the two extrapolations straddle the 16 ms
`refillMainThreadMaxMs` budget from opposite sides, so **neither settles it and the device decides**.
And the largest single cost is the worker's set rebuild, which never touches
`refillMainThreadMaxMs` at all but does contend with the audio render — measure worker CPU, or the
headline metric will look fine while the user's actual constraint goes unmeasured.

### 8b.4 Measure at depth, or do not bother

A 40-minute soak advances about 45 tracks. The risk lives at tens of thousands of exclusions, which
is days of listening. **A clean run at shallow depth proves nothing and must not be reported as a
pass.** Pre-seed the persisted session descriptor with a large, realistically scattered exclusion set
— that is exactly the state a resumed deep session is in, and the resume tests already establish that
a station continues from the persisted descriptor. Sweep 1k / 10k / 30k / 60k so the growth curve is
visible rather than a single verdict.

Also read `localStorage["c64u_sid_radio_session"].excludeOrdinals.length` and report it. Nobody has
established how deep the station was when the user heard the gap, and if it was shallow the whole
depth hypothesis is wrong.

### 8b.5 Two instruments are provided. Use them.

**`tools/hil/make_dropout_probe_sid.py`** generates a synthetic SID built for this measurement, and
it exists because *real music cannot answer the question*. A dropout is a collapse in level; SID
music collapses in level constantly and on purpose, so a detector run against a real tune found five
candidates on a 98 s recording and not one could be attributed. The probe removes the ambiguity:

- **Amplitude is constant.** Three voices gated on once at init and never gated off, fastest attack,
  no decay, maximum sustain, master volume never rewritten. Rendered and measured through
  `sidplayfp`: **0.34 dB peak-to-peak over 19 seconds.** Any dip in a recording of this is the
  playback path failing. There is no musical event that could explain one.
- **The write load is high**, so it exercises what real playback exercises rather than idling: the
  play routine runs five times per frame and rewrites all three voice frequencies each pass —
  **1,500 SID register writes per second**, against roughly 50-150 for a typical tune. The passes are
  spread across the frame by a calibrated delay (about 15,300 of 19,656 cycles), so the SID sees five
  distinct values per frame instead of holding the last one for 19 ms.
- **It is meant to be listenable**, because someone has to sit next to it. Triangle waves, a major
  triad at A5/C#6/E6, gentle vibrato of ±6 cents at slightly different rates per voice so they drift
  and shimmer. The register was raised an octave deliberately: at A4 only 0.9% of the energy sat
  above 1 kHz, where a phone speaker is efficient. As built, **99.9% of the energy is in the
  300-6000 Hz detection band and 66% is in 1-3 kHz**. Tuning knobs are at the top of the file; if it
  grates, change `CHORD_HZ` or `VIBRATO_CENTS`, not the waveform.

**`tools/hil/detect_dropouts.py`** analyses a raw s16le 48 kHz mono capture. It band-limits, requires
a fast collapse *and* a fast recovery *and* loud audio either side, and refuses to report at all when
the SNR is too low rather than emitting noise.

**Validate the detector against a known positive before trusting it.** Induce one deliberate ~100 ms
main-thread block during playback of the probe, confirm the detector finds it, and only then report
true positives. An unvalidated detector has already produced 400 false candidates in this
investigation.

### 8b.6 The microphone method — read this or you will repeat a wasted hour

Two constraints, one hard and one methodological. Both are in `AGENTS.md`; they are repeated here
because getting either wrong invalidates the result.

**Never raise the Pixel 4's media volume above 10 of 25.** Hard limit, comfort and hearing safety,
outranks any measurement. See `AGENTS.md` Phase 5b.

**Band-limit to 300-6000 Hz before judging signal-to-noise.** The room's noise is almost entirely
sub-300 Hz rumble in a band the phone speaker barely reproduces. Measured 4 mm from the grille in
silence: broadband floor **-40.8 dBFS**, but 300-700 Hz **-83.9 dBFS**. A broadband reading therefore
understates the usable range by more than 30 dB — it led to a wrong conclusion that the microphone
could not work at the permitted volume. Band-limited, 98 s of real playback at volume 10 with the
microphone 4 mm from the grille gives **27 dB median SNR and 33 dB on loud passages**. Ample.
`tools/hil/local_vs_mirror_mic.py` already band-limits and says why.

Capture on the host with the USB microphone
(`alsa_input.usb-MUSIC-BOOST_SF-558-00.mono-fallback`, s16le 48 kHz mono), not from the device.

### 8b.7 Definition of done for this workstream

- The mechanism is identified, not guessed: either the depth prediction in 8b.2 holds and the
  evidence shows it, or it is refuted and a different cause is named with evidence.
- The dropout is gone, demonstrated with the probe at 60k depth, with the detector validated against
  an induced positive.
- `refillMainThreadMaxMs`, `renderMsPerSec` and `audioUnderruns` reported at 1k/10k/30k/60k, before
  and after, on device.
- Worker CPU reported, separately from the audio render.
- If the fix changes the persisted session format, a session written by the current build still
  loads, and the station it produces is unchanged.
- Any residual risk stated with its measurement, not waved at.

## 9. HIL interaction rules

### Real touch is the authoritative proof

Use genuine touch for: launcher and mood selection, Next, Previous, Pause, Play, Stop, progress-bar
drags, Settings changes, backgrounding/foregrounding, tab navigation.

- `docs/agentic/hil-rc4/taptid.sh <testid>` taps by `data-testid` via `adb shell input tap`, having
  scrolled the element into the interactive band and **hit-tested it with `elementFromPoint`**, so
  an overlay cannot silently eat the tap. `--check` hit-tests only; `--noscroll` for fixed
  elements. The toast viewport swallowing transport taps was a real defect here — when a visible,
  enabled button "does nothing", hit-test before blaming the handler.
- The progress bar **must** be driven with real `input tap`/`input swipe`. It reads the pointer's x
  against its own rect, so `el.click()` lands at the element centre — `seek_latency_hil.py:175-180`
  documents exactly this, having watched a synthetic click produce a marker and stop playback.
- **Note the inconsistency:** `sid_radio_hil.py:175` drives transport with `el.click()`. Its
  budget assertions remain valid; its transport steps are **not** authoritative touch proof. Either
  route those steps through real input or state plainly in the report which claims rest on
  synthetic clicks.

Never use as authoritative interaction proof: `HTMLElement.click()`, direct React state mutation,
direct handler invocation, playlist-index assignment, CDP mouse events for touch controls, or
internal transport calls that bypass the UI.

### CDP is for reading

`adb forward tcp:9333 localabstract:webview_devtools_remote_<pid>`, then
`node scripts/bughunt-cdp.mjs eval '<js>'`. Read element geometry, labels, the `sid-radio-stats`
blob, playlist identity, history position, worker metrics, console errors, accessibility state.
**Re-establish the forward after every `./build --install-apk`** — a rebuild replaces the process
and silently invalidates it, so the next eval either times out or reads a stale page.

The app's REST goes through native CapacitorHttp, so it never appears in CDP Network and release
builds log nothing useful to logcat. The in-app Diagnostics log is authoritative; it is
newest-first, clearing it does not stick, and its timestamps come from the **device** clock, which
is hours from the host's — filter by a watermark read from the device.

### The harness must not repair the product

No auto-Play after a stall, no retrying a failed tap until one works, no silent station restart or
page reload, no skipping an invalid track, no treating a missing metric as success, no continuing
past an invariant failure. A stall, a timeout or a missing state is a failure: preserve evidence
and stop that scenario. Every asynchronous wait has a bounded timeout, and a timeout is a failure.

### C64U wedge handling

If HTTP, FTP and Telnet all go unavailable while ICMP still answers, that is the known **firmware**
wedge, not an app defect and not something to fix in the app. Stop sending traffic to that device,
preserve request timing and app diagnostics, classify it per AGENTS.md §"CRUCIAL", do not mask it
with retries, and do not fall back to the u64 (§1). Separately: the c64u reported "unhealthy" is
usually the app — under heavy tab churn the JS thread starves and the 3 s health poll times out
while the c64u answers the host in ~13 ms. Check from the host before believing the badge.

---

## 10. Diagnostics to add (delta only)

`sidRadioStats.ts` already publishes `bundleLoadMs`, `reverseIndexMs`, `firstCandidateMs`,
`lastRefillMs`, `refillMainThreadMaxMs`, `skipToLaunchMs`, `queueLookahead`, `candidatesEmitted`,
`tracksAutoAdvanced`, `skips`, `engineThreadIsMain`, `memoryEstimateBytes`, `stationActive`,
`seedKind`, `styleBit`, `shuffleSeed`, `emittedSequence`, `transportShuffle/RepeatDisabled`,
`renderMsPerSec`, `audioUnderruns`, `engineSwitchMs`.

Add only what the assertions in §4–§8 actually need:

- **Corpus:** release tag, bundle sha256, schema version, binary format version, graph flags,
  flow-successor capability, track/file/style counts — so a run's evidence names the corpus it ran
  against, and so a device can be checked against the pin without a rebuild.
- **Station:** generation id, seed identity and label, style constraint, ranking-snapshot identity,
  continuation cursor, current flow position and flow-successor ordinal where applicable, refill
  generation id, exhaustion reason, and candidate accounting split by reason: already used ·
  already in history · unresolved path · too short · **unknown duration** · style mismatch ·
  Not-for-me · duplicate track · sibling-subsong retire · stale generation.
- **Playlist/history:** per retained item — item id, track ordinal, full MD5 where available,
  `md5_48`, path, subsong, resolved duration, style mask, origin (initial / refill / restored /
  existing history); plus history position, history length, and whether the last navigation reused
  history or generated a new item.
- **Seek:** track instance id, seek generation, audible position, rendered position, rendered
  position at request, preview target, committed target, pending target, pending percentage, ETA
  where valid, waiting state, cached coverage, completion reason, cancellation reason.

Constraints, learned the hard way here: the stats mirror is written on a hot path — `recordEmitted`
fires once per emitted item, and a full `JSON.stringify` plus `querySelector` per emission once
caused a real audio underrun. Keep additions bounded, passive, off high-frequency paths, free of
localStorage churn and unbounded log growth, and safe in production.

---

## 11. The deterministic soak

Extend the HIL tooling rather than starting a new script where one fits —
`tools/hil/sid_radio_hil.py` owns budget assertions, `sid_radio_depth_hil.py` (untracked) owns
depth, `seek_latency_hil.py` owns speaker-measured seek cost. A new
`tools/hil/sid_radio_bug_bash_hil.py` is appropriate for the combined soak; reuse the proven
coordinate conversion and touch helpers.

Generate the whole action sequence up front from a recorded random seed, with the expected state
after each action, so the run is replayable exactly. Minimum content: 120 Next · 120 Previous · one
uninterrupted 100-song forward traversal · its complete reverse · its exact forward replay · 60
progress-bar seeks · 20 seeks into the final 10% · 20 pause/resume cycles · several station
stop/restart cycles · several refills · several mood changes · several minimum-length changes · one
constrained station spanning ≥100 accepted songs · one background/foreground cycle · one app
restart with restoration · one route change where supported · one local run · one C64U run. Mix
sequential actions, short bursts, alternation, and actions issued while previous asynchronous work
is still pending. Assert the relevant invariants after every action.

Report, with every count required to be zero shown explicitly:

```text
forbidden short tracks: 0        stale seek completions: 0
style violations: 0              stale station results: 0
unexpected duplicate tracks: 0   double auto-advances: 0
duplicate transitions: 0         uncaught JavaScript errors: 0
false exhaustion events: 0       native crashes: 0
unexplained playback stalls: 0   ANRs: 0
harness recovery actions: 0
```

Plus: an advancing playback clock whenever playback is expected; a stable audible or explicitly
waiting state throughout seek preparation; correct final item, history position, station label,
style constraint, minimum-length value and corpus identity.

### Race combinations to search

Rapid Next · rapid Previous · alternating · Next or Previous coinciding with auto-advance · seek
then Next · seek then Previous · Next/Previous/Stop while a seek is pending · mood or
minimum-length change while a seek is pending · mood or minimum-length change during refill · ✕
during refill · station switch during refill · pause/seek/resume in both orders · repeated station
starts · background/foreground during playback · restart with an active station · route changes
during playback · local↔remote switching · delayed C64U responses · delayed duration lookups ·
worker completion after station replacement.

For each additional defect: minimal deterministic reproduction, preserved evidence, root cause, a
regression test that fails before the fix, the smallest correct fix, the exact hardware
reproduction re-run, and inclusion in the final soak. Do not expand into unrelated areas.

---

## 12. Execution order

1. Record the baseline: branch, commit, latest tag, working-tree state, installed package versions
   and their commit identity, ADB serial, Android version, selected c64u address and identity,
   firmware, playback route, HVSC release, corpus release and digest.
2. Read §2's sources.
3. **Check the release list for 0.8.2** and take the branch in §0.1. If it is published, run §4 now
   — the corpus is upstream of every station assertion, and re-pinning after the traversal proofs
   would invalidate them. If it is not, record the check verbatim and continue; re-check once more
   before the final report, because it may land mid-run.
4. Build and install the baseline APK; attach CDP.
5. Reproduce the §5 and §6 defects on hardware. Capture evidence **before** changing code.
6. Add failing regression tests.
7. Apply the smallest coherent fixes.
8. Rebuild, reinstall, re-attach CDP, repeat the exact reproductions.
9. Exploratory discovery (§11), fixing every confirmed in-scope defect the same way.
10. Run the 100-song matrix (§8) and the deterministic soak (§11).
11. Run the repository validation (§13).
12. Build and install the final APK; re-run the final HIL matrix against **that exact** artifact.
13. Write the report (§16).

Do not spend the device window running broad suites before the user-visible behaviour works on the
Pixel 4.

---

## 13. Validation commands

```bash
npm run lint            # prettier + eslint + typecheck + variant/flags/menu checks
npm run typecheck       # never bare `tsc --noEmit` — CI checks two projects
npm test                # vitest
npx vitest run tests/unit/sidRadio tests/unit/playback tests/contract/sidRadioWorker.contract.test.ts
SIDCORR_REAL=1 npx vitest run tests/unit/sidRadio/sidcorrTiny.test.ts   # real-bundle golden
node scripts/fetch-sidcorr.mjs                                          # digest pin, exits 1 on drift
npm run test:coverage && npm run coverage:gate                          # patch gate 91%
npm run test:e2e        # playwright
npm run build
./build --skip-tests --install-apk                                      # Android, single variant
node scripts/build-android-apks.mjs --variant all                       # both editions
```

Device and host harnesses:

```bash
gh release list --repo chrisgleissner/sidflow-data --limit 5            # the §0.1 check
python3 tools/hil/sid_radio_hil.py --serial 9B081FFAZ001WX --station song --soak-tracks 30 --skips 5
python3 tools/hil/sid_radio_hil.py --serial 9B081FFAZ001WX --station style --style fast_paced --shuffle-replay
python3 tools/hil/sid_radio_hil.py --serial 9B081FFAZ001WX --engine local --soak-seconds 2400
python3 tools/hil/seek_latency_hil.py --serial 9B081FFAZ001WX --station style --style fast_paced
python3 tools/hil/sid_radio_depth_hil.py --serial 9B081FFAZ001WX --engine local
npx vite-node --script scripts/sidRadio/measure-station-depth.ts -- --stations=60 --cap=25000
node scripts/assert-sid-radio-perf.mjs
```

Screenshots: regenerate only the files whose visible output actually changed
(`npm run screenshots`, then measure per-file diffs and `git checkout --` the machine render drift —
this corpus does not reproduce byte-identically here, and a bulk run rewrites ~203 PNGs). Never
bulk-revert `docs/img/`; list the files.

Version identity of the final APK must derive from the latest Git tag plus the current commit
(AGENTS.md Phase 5c), and the final HIL numbers must come from that exact artifact.

---

## 14. Evidence

Store run evidence under `ci-artifacts/sid-radio-bug-bash/`. Per important run: commit, branch, APK
version identity, Pixel serial, Android version, c64u identity and firmware, engine, route, station
type, seed, style constraint, minimum length, corpus release and digest, graph flags, random seed,
the complete action sequence, assertion results, track identities with durations and style masks,
history positions, refill boundaries, seek-state transitions, screenshots, a screen recording where
practical, logcat excerpts, JS console errors, device request traces, audio evidence where
available, and the failure reason where applicable.

Do not commit bulky generated artifacts. Durable source, tests, scripts, small fixtures and concise
documentation only, and only when instructed to commit.

---

## 15. Definition of done

- **Corpus:** either 0.8.2 is adopted — pin re-coordinated across all copies, digest enforced by
  the build, the real bundle parses, graph flags read and interpreted, the flow chain validated,
  style masks unchanged and verified, ordinal stability proven, depth re-measured — or the run
  reports the corpus gate as **blocked**, naming the release check performed, its timestamp and its
  result. A run that silently ships 0.8.0 as though it were the target is not done.
- **Minimum length:** reproduced, root-caused, fixed; no forbidden tune in queue, history,
  transitions or playback; dynamic changes handled; real HVSC duration and subsong resolution
  proven; unknown-duration policy stated and accounted for.
- **Seek:** reproduced; audible/rendered/requested separated; determinate feedback with progress
  and ETA; automatic resume with no false elapsed position; near-end behaviour correct; stale seek
  work cannot touch another track; Pixel 4 screenshots show the whole waiting lifecycle.
- **Stations:** every entry point starts and plays; paths and subsongs resolve; refill and
  auto-advance work; no false exhaustion in the required traversal; no duplicates.
- **Mood-constrained similarity:** `All moods` and all nine work; strict AND proven by an
  independent oracle for every emitted item; no silent fallback; constraint changes cancel stale
  work; empty intersections reported truthfully.
- **History:** 100 forward, 100 backward, 100 forward replay, identical identities; refill
  boundaries do not alter history; ♥/✕ affect future generation only; restoration matches the
  documented contract.
- **Hardware:** final APK installed; local passes; C64U passes; `Both` passes where supported; the
  soak passes with zero harness recovery.
- **Automated:** focused regression tests pass; `npm run lint`, `npm test`, `npm run build` and the
  coverage gate pass; every fix has a test watched failing without it.

---

## 16. Final report

Sections, in this order:

**Baseline** — branch, start and end commits, working tree, Pixel identity, c64u identity and
firmware, initial APK.

**Corpus** — which of the three §0.1 outcomes occurred, with the release check quoted and
timestamped; detected release, digest, manifest identity, graph flags, real-bundle graph results,
flow-chain coverage, style-mask validation, ordinal-stability result, re-measured station depth on
the new bundle, and every file changed to re-coordinate the pin. If blocked: what was checked, when,
what was found, and exactly which assertions remain unproven as a result.

**Known defects** — each with reproduction, root cause, fix, regression tests, Pixel evidence,
C64U evidence.

**Additional defects** — severity, minimal reproduction, root cause, fix, test, HIL result.

**Continuation** — algorithm, drifting-query parameters used, whether the flow successor was
adopted and the measurement that justified the decision either way, determinism rules, exclusion
and admission order, measured distance before exhaustion, memory behaviour, refill latency.

**Mood intersection** — UI, exact predicate, oracle, seed/mood pairs tested, emitted counts,
violations (zero).

**Reversible history** — `s0…s100` artifact path, reverse result, replay result, refill boundaries
crossed, restoration result, mismatch count (zero).

**Seek UX** — state model, visuals, progress and ETA maths, screenshots, local-engine
measurements, stale-cancellation proof, near-end result.

**Automated validation** — exact commands and results.

**Hardware validation** — scenarios, route, station type, action counts, timing, pass/fail,
artifact paths.

**Soak** — seed, action count, station and engine matrices, max Next/Previous/refill latency,
memory growth, worker count, audio stream count, invariant violations, each required-zero count
shown.

**Residual risks** — concrete, evidence-based, with external blockers named.

State exact observations, measurements and outcomes. Do not write "appears fixed", "seems stable",
"probably works" or "tests look good".
