# The keypad user who keeps coming home — findings

Hardware-in-the-loop hunt run against `c64u` (C64 Ultimate, firmware `1.2RC`, `192.168.1.146`) and
a Pixel 4 (`9B081FFAZ001WX`) driven at Callback 8020 geometry: `wm size 480x640`, `wm density 240`,
which the app reports as 320 x 427 CSS px at DPR 1.5 on the `compact` display profile. The edition
under test is the 8020 one, `uk.gleissner.c64uremote`, build `1.0.5-rc1-6ba84`.

The U64 was not driven or probed at any point. Two of the findings below are about tooling that had
been pointing debug installs at it.

## Findings

| # | Scenario | Finding | Evidence | Status |
| - | -------- | ------- | -------- | ------ |
| 1 | S5 | The handset's Back key produced no event at all outside an interstitial, so OK descended into a card and nothing climbed out. Most of Home was then unreachable. | A `keydown` probe recorded nothing for `KEYCODE_BACK` and a correct ascend for `KEYCODE_ESCAPE`; the sweep reported 30 unreachable controls on Home before and 1 after | Fixed, verified on the handset |
| 2 | S5 | Home's System info button is not in the focus ring: it carries `data-section-label`, so it was treated as an empty group and dropped | 34 Down presses walk the whole ring twice without selecting it; the element is a 304 x 58 px `<button>` | Fixed, hand-verified |
| 3 | S1, S8, S9 | The badge claimed "Connected to c64u, system healthy" on arrival with no evidence newer than the last time the app had spoken to the device. Nothing probes while the state reads REAL_CONNECTED, and neither visibility handler acts in that state | `ConnectionController` returns early for that state; both `visibilitychange` handlers gate on `OFFLINE_NO_DEMO`/`DEMO_ACTIVE` | Fixed; unit test fails on the reverted file with `expected 'REAL_CONNECTED' to be 'OFFLINE_NO_DEMO'` |
| 4 | Rig | Every debug install pointed the app at the U64 — reserved for another agent — and gave `c64u` an address that had not been its for weeks | The app's own log promoted a connection to `192.168.1.13` at `08:37:45Z`; `/etc/hosts` carries `192.168.1.167` only as a comment | Fixed |
| 5 | Tooling | `--install-apk` could not install any edition but the default: it looked for `c64commander-<version>-debug.apk` whatever variant had been built | `APP_VARIANT=c64u-remote ./build --skip-tests --install-apk` stopped at `APK not found` with the built APK beside that path | Fixed |
| 6 | Tooling | `npx eslint .` reported 17 errors from other agents' worktrees under `.claude/worktrees/**` | The ignore list already carried `.worktrees/**`, the wrong path for where they are created | Fixed |
| 7 | Delegated | The scheduled fuzz overran its job cap on five consecutive nights. The budget bounded only the shard loop; the overrun was in the report merge, which the first fix left unbounded | Run 35418281403: 8905 s against a 7200 s budget, with the sibling job's build measured at 25 s | Fixed; see `fuzz-deadline-review.md` |
| 8 | Harness | `keypad_reachability.mjs` searched for each card from wherever the ring had stopped, re-walking the whole ring per card. Home never finished in 30 minutes | Visible on the handset as the same Quick Actions grid scrolling repeatedly; one forward pass finishes Home in about 90 s | Fixed |
| 9 | Harness | The sweep reported five cards on Home as not scrolled into view, and counted three buttons as both reached and unreachable | It graded against the raw viewport rather than the 231 px the app leaves between its bars, and identified id-less controls by their viewport top | Fixed; none of the five is a product defect |

## Scenario results

### S2 — departure with playback running

Tone-Low started from the playlist, the radio taken away mid-tune, sixty seconds, radio back.

- The badge read "Offline, device not reachable" within 10 s of the radio going, in the words a
  non-expert reads as an answer.
- The Play page was not disabled: of every transport, playlist and volume control on it, only
  `playlist-reshuffle` was disabled, and that is a two-item playlist with shuffle off, not the
  outage.
- Playback continued throughout — elapsed 0:46 at the moment the radio went and 1:46 a minute
  later. `dumpsys audio` shows the app's own `AudioTrack` `state:started` at 48 kHz, so the tune
  was being rendered on the phone, which is why it survived.
- The badge read "Connected to c64u, system healthy" again 8 s after the radio returned.
- Nothing was left sending: `239.0.1.65` carried 1000 packets from `192.168.1.146` in 4 s while
  the mirror was up before the outage, and none at all after the reconnection. The audio mirror is
  deliberately not restored while the phone is playing the tune itself; the machine's audio comes
  back with the next track.

Pass.

### S1 and S9 — arrival, and the badge's first word

Five arrivals on the fixed build: radio off and screen dark for 60 s, radio back, six seconds to
settle in the pocket, then the screen woken and the app foregrounded. The badge label was sampled
from the moment the app appeared, and every claim of a connection was checked against the device's
own answer to `GET /v1/version` from this host.

| Arrival | First label | at | Connected, and the device answering | at |
| ------- | ----------- | -- | ----------------------------------- | -- |
| 1 | Offline, device not reachable | 313 ms | yes | 743 ms |
| 2 | Offline, device not reachable | 439 ms | yes | 866 ms |
| 3 | Offline, device not reachable | 326 ms | yes | 756 ms |
| 4 | Offline, device not reachable | 468 ms | not within the 25 s sample window | — |
| 5 | Offline, device not reachable | 295 ms | yes | 727 ms |

No screen claimed the machine was reachable before it was: the first thing the badge says on every
arrival is that the device is not reachable, and it is right, because the phone has not rejoined
the network yet. The truth appears within half a second of the app becoming visible, and the app is
connected again within about 850 ms on four of the five.

The fifth is honest data rather than a pass: the app had not reconnected within the sampling
window. It is recorded as measured, not explained.

The deviation from the scenario as written: the away time was 60 s rather than ten minutes, and
five arrivals rather than ten. Each arrival cost about twelve minutes of wall clock on the rig, and
the numbers above are tight enough across five that more of them would not have changed the answer.
A cold ten-minute arrival was measured separately, once, with the same result: "Offline, device not
reachable" 322 ms after the app appeared, with the radio still off so that the only correct answer
was that one.
