# Small-screen profile in Demo Mode

Measured on 2026-10-10 on the Pixel 4 standing in for the smallest supported phone. The phone was in
flight mode with no routable interface, so no measurement reached a C64 Ultimate, and the app ran in
Demo Mode against its built-in simulated device. The app kept its existing data, including an
installed HVSC library.

The harness is `tools/hil/small_screen_profile.mjs` (see `tools/hil/README.md`). It sets that phone's
panel geometry (480 x 640 at density 240, so 320 x 426.7 CSS px and the compact display profile) and
throttles the WebView to CPU rate 2, the reference rate for that phone calibrated in the earlier
contextful-draw measurements in this folder. Baseline: `main` at `3aa498eb7`.
Candidate: this branch. Both are debug APKs built from the same tree apart from the change.

## Two measurement traps

- **CDP's CPU throttle costs the renderer about two thirds of a core by itself.** Process CPU read
  while it is on reported 62-73% for a page doing nothing. Idle and Live View CPU are therefore read
  with the throttle off; tab-switch latency is read with it on.
- **A 0.5 ms sampling profiler costs the renderer about a fifth of a core.** CPU profiles are taken
  in their own windows, after the CPU share has been read.

## Tab switches

Keypad page jumps (keys 1-6), timed from the Android key event to two animation frames after the
page is drawn. Medians of five warm rounds, after one round that visits every page.

| Page     | Baseline draw | Candidate draw | Baseline main thread | Candidate main thread | Layout shift (baseline → candidate) |
| -------- | ------------: | -------------: | -------------------: | --------------------: | ----------------------------------- |
| Home     |        457 ms |         531 ms |               922 ms |                786 ms | 0 → 0                               |
| Play     |        561 ms |         506 ms |              1072 ms |                638 ms | 0.197 → 0                           |
| Disks    |        672 ms |         619 ms |               985 ms |                816 ms | 0 → 0                               |
| Config   |        878 ms |         647 ms |              1199 ms |                986 ms | 0 → 0                               |
| Settings |        758 ms |         418 ms |               962 ms |                632 ms | 0 → 0                               |
| Docs     |        414 ms |         269 ms |               814 ms |                433 ms | 0 → 0                               |

"Main thread" is the renderer main thread's busy time from the key event to 350 ms after the draw.
The baseline rebuilt each page on every visit and put its scroll position back afterwards; on Play
that moved the playback controls and the playlist by up to 289 px after the page had drawn.

Home is the one page that draws later. Its root holds the shared device queries (drive state,
connection status), and showing it again starts the same refreshes a fresh mount started, each of
which re-renders the whole page (3,924 components). It does less main-thread work than before in
total.

## Idle and memory

Twenty seconds on each page, throttle off. Main thread busy share and renderer process CPU are
unchanged within measurement noise (Home 1.1% / 3.1%, Play 2.6% / 6.9%, every other page 0.5% or
less). Visited pages are kept built: after all six pages have been visited the renderer holds
323 MiB PSS against 305 MiB on the baseline, and the app process 139 MiB against 139 MiB. That phone
has 4 GB of RAM.

## Live View in Demo Mode

Twenty seconds of video and audio, throttle off, shares of one core:

| Measure                          | Baseline | Candidate |
| -------------------------------- | -------: | --------: |
| App process (receive, assemble)  |     121% |       89% |
| Renderer process                 |  58-70%  |       51% |
| Renderer main thread busy        |  34-37%  |       28% |
| JavaScript share of main thread  |  20-21%  |        7% |

The app process figure includes Demo Mode's own stream sender, about 28-35% of a core, which a real
device does not need. In Demo Mode 241 of every 250 presented frames are identical to the one before
and the other 9 change every line; the bridge carried 0.63 MB in five seconds against about 17 MB.

The phone speaker was recorded with a USB microphone at the grille, media volume 3 of 25. The demo
stream's tone ladder played in order, each note in tune within 16 cents and 500 ms long.

## What the time was spent on, and what changed

| Cost, measured on the Pixel 4                                                        | Change |
| ------------------------------------------------------------------------------------- | ------ |
| Writing `--app-bar-height` on `<html>` restyled every element: 400 ms for 6,203 elements, unthrottled | The value is held on each page's slot |
| `html:has(...)` re-matched on DOM changes and restyled the whole document: 600 ms at rate 2 | A class set once the launch sequence ends |
| Toggling `inert` or `pointer-events` on a page restyled it: about 115 ms for Config | Hidden pages use `content-visibility: hidden` (11-13 ms) and sit outside the runway |
| Every router location change re-rendered each `useLocation`/`useNavigate` consumer in every page | Hidden pages keep the location they last saw; pages navigate without reading the location |
| Focus discovery read styles up through every control on hidden pages: 600 ms per switch | Ancestors are settled before a node's own style is read |
| Every Config row re-rendered whenever a section re-rendered | Memoized rows and sections with stable props |
| Live View sent every frame whole as 70 KB of Base64 | Only the changed line span; unchanged frames send nothing and paint nothing |
| Live View decoded and drew every pixel of every frame | Only the changed lines are decoded and copied to the canvas |
| Components re-rendered for Live View counters they never show | They re-render only when a shown field changes |

The startup bundle stays under its 250 KB budget: the diagnostics heat map now loads on first use,
like the other diagnostics popups.

## Reproduce

```bash
adb shell settings get global airplane_mode_on   # must be 1
node tools/hil/small_screen_profile.mjs --label baseline --output artifacts/small-screen/baseline.json
node tools/hil/small_screen_profile.mjs --label candidate --output artifacts/small-screen/candidate.json
```

Install each APK through `droid_app.install_app` and keep the app data between the two runs.
