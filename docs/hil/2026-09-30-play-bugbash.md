# Play HIL bug bash — 30 September 2026

**Partial result: two defects repaired and checked on the Pixel 4. Remote playback,
Both output, and program launches remain unverified because the hardware rig was
occupied by another campaign. This is not a bug-free certification.**

## Bench and isolation

- Pixel 4 `9B081FFAZ001WX`, Android 16, native 1080×2280 geometry; no density override.
- Source revision `23cba3a27`, with the working-tree fixes below; displayed build
  `1.0.7-rc1-23cba`. The debug APK was built, installed and launched twice, including
  the repaired code. Repaired APK SHA-256:
  `ccd2312985a013d478bc69f928d26bc71938e502ea7f3d9b1ef91468e4401ea3`.
- A preflight info read found C64U firmware `1.2.1RC` / core `1.50`, and U2 firmware
  `3.15`. Neither was driven during this session. U64 was left alone.
- An existing `1541ultimate` deep firmware campaign held the C64U device lock. U2
  shares that computer physically, so it was unavailable too. Its log was
  `/home/chris/dev/c64/1541ultimate/scratch/fpga-verify/official-deep/run.log`.
  Phone Wi-Fi was disabled to prevent app traffic interfering with that campaign.
- Android operations used droidctl. CDP supplied observations and test setup;
  playback actions used physical taps and Android key events. Fixture imports used
  the actual Android Storage Access Framework folder picker.
- Media volume was 3/25, briefly 5/25 for transition measurements, then restored
  to 3/25. It never exceeded 5. Notifications were denied at the system prompt.

Raw evidence is in the ignored local directory
`artifacts/play-bugbash-2026-09-30/`; the c64scope session is
`pt-20260930T141953Z`. `actions.jsonl` records physical control actions. JSON
snapshots contain visible text, playback session state, sink counters, engine
state and recent logs. WAV files contain microphone or native PCM evidence as
named; these are different observation points.

## Confirmed defects and repairs

### Paused seeking leaves elapsed time stale and miscounts subsequent seeks

Severity: medium. With local playback paused at 7.825 seconds, keypad seeking
moved the audio target to 11.425 seconds but left elapsed time unchanged after
settling. Resume exposed the new position. Repeated paused bar seeks reproduced
the same stale display and incorrectly increased cumulative played time when
seeking backward, because the previous position remained stale.

Both seek entry points in
`src/pages/playFiles/hooks/usePlaybackController.ts` now update elapsed state and
its reference after rebasing the clocks. Regression tests cover relative and
fractional paused seeks, plus a forward/backward sequence preserving the time
played by earlier tunes. The initial two regression cases failed without the fix.

The repaired APK was checked with paused targets approximately 90.030, 36.147 and
176.513 seconds. Cumulative played values moved 90.787 → 36.904 → 177.270 seconds,
preserving the earlier contribution rather than adding the backward distance.
After preparation, the final visible elapsed time was 2:56. Evidence:
`keypad-seek-paused-settled.json`, `paused-seek-back.json`,
`fixed-paused-seek-*.json`, `fixed-seek-final-settled.json`.

### Seek bar is smaller than the required touch target

Severity: medium. The seek button measured 36 CSS pixels high on the Pixel 4 and
32 on the compact browser profile. It now has a minimum height of 44 pixels.
The compact-screen regression starts a valid generated SID locally and measures
the rendered target. Removing the fix made it fail at 32 pixels; restoring the
fix passed. The repaired Pixel target also measured at least 44 pixels.

CTA documentation was updated. Only the changed control screenshots were kept:

- `docs/img/app/play/sid-radio/profiles/compact/01-controls.png`
- `docs/img/app/play/sid-radio/profiles/medium/01-controls.png`

## Exercised behavior

| Area                             | Actual result and limits                                                                                                                                                                                                                                                                                                                          |
| -------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Offline HVSC search and playback | Installed HVSC v85 contained 61,157 indexed songs. Searching Galway, selecting a result and starting Here playback worked; the microphone recorded audible music.                                                                                                                                                                                 |
| Pause/resume                     | Paused elapsed remained 109.081 seconds for over 34 seconds, then resumed to 112.091 seconds. Repeated pause/resume also worked after waking and with notifications denied.                                                                                                                                                                       |
| Seeking while playing            | Backward and forward bar seeks moved within the current tune. Cached seeks landed; cold seeks displayed preparation progress.                                                                                                                                                                                                                     |
| Screen sleep/wake                | Actual screen-off interval of approximately 169 seconds. Elapsed moved 28.286 → 197.292 seconds; native sink reported zero starvation seconds. A 20-second microphone tail remained audible. This proves continuity across this interval, not overnight Doze reliability or absence of every audible defect.                                      |
| Local folder import              | Real SAF permission flow imported two generated SIDs, one PRG and one MOD from Download/Play-QA-20260930. Import preserved the paused tune. PRG/MOD launch was not attempted against occupied hardware.                                                                                                                                           |
| Local transport                  | Physical Next and Previous selected the adjacent QA SIDs. ReSIDfp and SIDLite both started, paused, resumed and changed tracks.                                                                                                                                                                                                                   |
| Keypad navigation                | Section traversal and an inner control walk reached the transport, seek, output chooser, mute/volume, shuffle/repeat, station/search actions, and sleep controls. Selected controls scrolled into view. Seeking by arrow keys worked, exposing the paused-seek defect above. This was a sampled walk, not an exhaustive navigation certification. |
| HVSC batch addition              | Monty on the Run, Commando and Delta added together while the active QA tune remained paused. Monty played locally with credits, a 5:50 first-tune duration and 19 subtunes.                                                                                                                                                                      |
| Subtunes and auto-advance        | Selecting Monty's second subtune displayed 2/19 and 0:12, and started the correct engine tune index. On completion the playlist advanced to Commando.                                                                                                                                                                                             |
| After-this-tune sleep timer      | Arming This tune on the 12-second subtune stopped local playback at its end, cleared the playback session and reset the timer to Off rather than advancing.                                                                                                                                                                                       |
| Offline CommoServe               | Search reported the DNS failure, preserved playback state and allowed closing the browser. Online results, downloads and archive launches were not tested.                                                                                                                                                                                        |
| Offline device browser           | C64U import was disabled with “Needs a connected device”, while Local and installed HVSC remained available.                                                                                                                                                                                                                                      |

## Transition evidence

Generated 550 Hz and 900 Hz triangle-tone SIDs used master volume 4/15. Phone
volume remained low. Music microphone samples were band-limited to 300–6000 Hz
for level assessment; a broadband room-noise reading was not used as a dropout
oracle.

- ReSIDfp, configured 1.5-second crossfade, Next: native PCM graded
  **SEAMLESS CROSSFADE**, zero gap, 1.2 seconds above the tone-presence threshold,
  23/23 falling and rising steps. See `paired-residfp-next-pcm.wav` and its grade.
- SIDLite, Next: the original recording included the tail of a preceding warm-up
  transition. Excluding its first two seconds isolated the intended join, which
  graded seamless with zero gap and 23/23 monotonic steps.
- SIDLite, Previous: measured bins show an uninterrupted linear exchange over
  approximately 1.5 seconds, with zero gap. The default room-oriented grader said
  RAGGED: its transient rejection used the nearly-zero digital reference floor
  and held presence flags through fade sidebands. A separately labelled tonal-only
  diagnostic, retaining independent percentile floors and continuity checks,
  graded 1.2 seconds of overlap and 23/23 monotonic steps. Both outputs are retained;
  this diagnostic adjustment is not a change to the production grader.
- Microphone trials produced RAGGED or short GAP verdicts despite clean paired
  PCM. Room/speaker effects remain unresolved. These recordings do **not** establish
  a production transition defect, and do **not** prove end-to-end speaker joins
  universally smooth. With crossfade off, one microphone join measured a 0.1-second
  gap; that observation has not been attributed to a pipeline layer.

The engine, native sink, and speaker are separate observation points. Clean PCM
must not be reported as clean sound on every output route.

## Usability limitation

Uncached ReSIDfp seeks near the end of a three-minute tune required tens of seconds
of rendering. The UI showed preparation progress and an estimate around 64
seconds for one near-end request. Cached seeks were much faster. This is an
observed delay, not a newly proven implementation defect; improving it needs a
separate performance investigation. During preparation the UI may show the prior
audible position alongside the requested target.

## Validation and remaining work

- Focused controller and playback-card Vitest suites: **169 tests passed**.
- TypeScript checks and focused Prettier/ESLint checks passed.
- Compact seek-target Playwright regression passed; removing the fix failed at
  32 pixels; restoring it passed again. Its first harness run failed because the
  older remote-upload fixture was truncated for real emulation; the test now
  generates a valid SID with the repository's generator.
- SID Radio screenshot capture passed; unchanged or unrelated screenshots were
  discarded from this change.
- Web/Capacitor/Android debug builds succeeded. No local iOS build was claimed.
  The APK with both repairs was installed and exercised on the Pixel 4.
- Coverage and broad suites were not run while HIL objectives remained open,
  following the repository's HIL-loop exception.

Build warnings were traced to mixed static/dynamic imports (the modules remain
in their existing chunks), an unavailable local iOS toolchain, and the existing
debuggable/minified Gradle variant. They do not provide evidence of a playback
failure. A separate c64scope dependency audit found one existing moderate
`fast-uri` advisory, GHSA-hrr3-gc8f-f4qj, affecting versions before 3.1.8; no
dependency files were changed in this playback repair.

Cleanup was verified by relaunching offline: the original Tone-Low/Tone-High
playlist contained two items, playback was stopped, output preference was C64,
and renderer/crossfade/developer settings were restored. The original recently
played history was restored. Wi-Fi and normal screen timeout behavior were
restored after force-stopping the app, avoiding renewed rig traffic. Media volume
was confirmed at 3/25. Notification permission remains denied, and the QA fixture
folder/SAF grant remains available for continuation. The unused device-lock waiter
was cancelled; the firmware campaign was left running.

Required continuation after the firmware campaign releases **both** device locks:

1. C64U device browsing and SID/PRG/MOD/CRT/disk launches from local and remote
   sources, with representative valid content rather than import-only evidence.
2. Remote and Both playback: output routing, pause/resume, skips, sleep/wake,
   reconnect, cached-device SID handover, and measured sound transitions.
3. U2 playback and unsupported-stream capability gates; U64 remains reserved.
4. Online CommoServe searches, downloads, archive extraction and launches.
5. Longer background/Doze soak; repeat/shuffle, rapid transport, held scrubbing,
   ranking and station generation, sleep-timer boundaries, playlist edits during
   playback, corrupt/unavailable files and interruption recovery.
6. Resolve speaker-level transition uncertainty with repeatable microphone
   measurements. Then run final validation and coverage if converging this change.

The session's hardware blocker prevents an exhaustive or merge-ready claim.
